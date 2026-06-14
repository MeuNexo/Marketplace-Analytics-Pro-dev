-- ============================================================
-- Phase 45 Consultor v1 — Tabelas de dados do motor de regras
-- ============================================================
--
-- Cria 3 tabelas:
--
--   1. insights             — onde o engine grava insights por org (RLS org-first).
--                             Um insight por (organization_id, rule_key, ml_user_id_key).
--                             INSERT/DELETE restritos a service role (engine escreve);
--                             SELECT e UPDATE (dismiss) liberados para membros autenticados.
--
--   2. consultor_config     — limiares configuráveis dos 12 alertas, 1 linha por org.
--                             SELECT = qualquer membro; ALL (escrita) = owner only.
--                             Defaults sensatos: editável só via SQL no v1.
--
--   3. consultor_health_snapshots — histórico de score 0-100 por org+mês.
--                             1 linha por (organization_id, snapshot_month).
--                             SELECT = qualquer membro; INSERT/UPDATE = service role only.
--
-- Dedup de insights (Pitfall 7 do RESEARCH.md):
--   PostgreSQL não suporta UNIQUE inline com COALESCE. Em vez disso, a tabela
--   usa a coluna helper `ml_user_id_key text NOT NULL DEFAULT ''` (o engine
--   preenche com ml_user_id ou '') + CREATE UNIQUE INDEX funcional normal.
--   Mais robusto que índice funcional com COALESCE (resolve A4/Q3 do RESEARCH).
--
-- RLS org-first: segue exatamente o padrão de
--   supabase/migrations/20260614123000_tenant04_onboarding_progress.sql.
--   is_org_member para SELECT; get_org_role = 'owner' para escrita restrita.
--
-- Idempotência: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS antes de
--   recriar, constraints via DO/EXCEPTION WHEN duplicate_object THEN NULL.
-- Seguro rodar múltiplas vezes.
--
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- ============================================================

-- ============================================================
-- TABELA 1: insights
-- ============================================================

CREATE TABLE IF NOT EXISTS public.insights (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id       text        NULL,
  -- Coluna helper para dedup sem COALESCE no índice (Pitfall 7):
  -- O engine preenche com ml_user_id quando insight é por loja específica, '' caso contrário.
  ml_user_id_key   text        NOT NULL DEFAULT '',
  rule_key         text        NOT NULL,
  category         text        NOT NULL,
  severity         text        NOT NULL,
  title            text        NOT NULL,
  body             text        NOT NULL,
  action_label     text        NOT NULL,
  action_href      text        NOT NULL,
  impact_brl       numeric     NULL,
  status           text        NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz NULL,
  dismissed_at     timestamptz NULL
);

-- CHECK idempotente: severity deve ser um dos 3 níveis definidos
DO $$ BEGIN
  ALTER TABLE public.insights
    ADD CONSTRAINT insights_severity_check
    CHECK (severity IN ('critical', 'high', 'medium'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CHECK idempotente: status controla o ciclo de vida do insight
DO $$ BEGIN
  ALTER TABLE public.insights
    ADD CONSTRAINT insights_status_check
    CHECK (status IN ('active', 'resolved', 'dismissed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Índice único de dedup: (org, rule_key, ml_user_id_key).
-- ml_user_id_key='' para insights de org inteira; =ml_user_id para insights por loja.
CREATE UNIQUE INDEX IF NOT EXISTS insights_dedup_idx
  ON public.insights (organization_id, rule_key, ml_user_id_key);

-- Índice de query frequente: listar insights ativos por org, ordenados por severidade
CREATE INDEX IF NOT EXISTS insights_org_status_idx
  ON public.insights (organization_id, status, severity);

ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "insights_select" ON public.insights';
  EXECUTE 'DROP POLICY IF EXISTS "insights_dismiss" ON public.insights';
END $$;

-- SELECT: qualquer membro da org pode ler insights (card + painel)
CREATE POLICY "insights_select"
  ON public.insights
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- UPDATE (dismiss): membro da org pode dispensar insight manualmente.
-- Engine nunca re-ativa um dismissed (status='dismissed' permanece).
CREATE POLICY "insights_dismiss"
  ON public.insights
  FOR UPDATE
  TO authenticated
  USING  (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- INSERT/DELETE: service role only (engine escreve; service role ignora RLS).
-- Nenhuma policy de INSERT/DELETE para 'authenticated'.


-- ============================================================
-- TABELA 2: consultor_config
-- ============================================================
-- Limiares configuráveis por org para as ~12 regras do Consultor v1.
-- 1 linha por org (PK = organization_id).
-- Defaults sensatos (D-02 do CONTEXT.md).
-- Editável via SQL no v1; UI de edição fica para fase futura.

CREATE TABLE IF NOT EXISTS public.consultor_config (
  organization_id          uuid    NOT NULL PRIMARY KEY
                                   REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Margem (D-03): 2 níveis — crítico (prejuízo) e alerta (abaixo da meta)
  margin_critical_pct      numeric NOT NULL DEFAULT 0,
  margin_alert_pct         numeric NOT NULL DEFAULT 10,
  -- Ads (D-04): TACoS, ACoS/ROAS, janela de campanha sem venda
  tacos_alert_pct          numeric NOT NULL DEFAULT 15,
  acos_alert_pct           numeric NOT NULL DEFAULT 30,
  roas_min                 numeric NOT NULL DEFAULT 3,
  ads_no_sale_days         integer NOT NULL DEFAULT 7,
  -- Estoque (D-05): cobertura crítica e alerta em dias
  stock_critical_days      integer NOT NULL DEFAULT 7,
  stock_alert_days         integer NOT NULL DEFAULT 15,
  -- Tendências (D-07): queda de ticket médio e spike de cancelamentos
  ticket_drop_pct          numeric NOT NULL DEFAULT 10,
  claims_spike_pct         numeric NOT NULL DEFAULT 20,
  -- Meta do mês (D-06): run-rate abaixo de x% da meta dispara alerta
  goal_risk_pct            numeric NOT NULL DEFAULT 10,
  -- Lookback para anúncio pausado com histórico de venda (D-08)
  paused_ads_lookback_days integer NOT NULL DEFAULT 30,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consultor_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "consultor_config_select" ON public.consultor_config';
  EXECUTE 'DROP POLICY IF EXISTS "consultor_config_write" ON public.consultor_config';
END $$;

-- SELECT: qualquer membro da org lê os limiares (engine + UI futura)
CREATE POLICY "consultor_config_select"
  ON public.consultor_config
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- ALL (escrita): somente owner pode modificar os limiares de configuração
CREATE POLICY "consultor_config_write"
  ON public.consultor_config
  FOR ALL
  TO authenticated
  USING  (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role)
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role);


-- ============================================================
-- TABELA 3: consultor_health_snapshots
-- ============================================================
-- Histórico de score de saúde 0-100 por org+mês (D-12).
-- 1 linha por (organization_id, snapshot_month).
-- Upsert a cada run do engine; engine sempre sobrescreve o mês atual.
-- Leitura dos 2 últimos meses permite mostrar tendência ▲/▼ (D-12).

CREATE TABLE IF NOT EXISTS public.consultor_health_snapshots (
  id               uuid    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  score            integer NOT NULL,
  score_margin     integer NOT NULL DEFAULT 0,
  score_ads        integer NOT NULL DEFAULT 0,
  score_estoque    integer NOT NULL DEFAULT 0,
  score_reputacao  integer NOT NULL DEFAULT 0,
  score_completude integer NOT NULL DEFAULT 0,
  insights_total   integer NOT NULL DEFAULT 0,
  insights_critical integer NOT NULL DEFAULT 0,
  snapshot_month   char(7) NOT NULL,   -- 'YYYY-MM'; um snapshot por org+mês
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT snapshots_org_month UNIQUE (organization_id, snapshot_month)
);

-- Índice para buscar os 2 últimos snapshots de uma org (tendência)
CREATE INDEX IF NOT EXISTS snapshots_org_month_idx
  ON public.consultor_health_snapshots (organization_id, snapshot_month DESC);

ALTER TABLE public.consultor_health_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "snapshots_select" ON public.consultor_health_snapshots';
END $$;

-- SELECT: qualquer membro da org pode ler o score histórico
CREATE POLICY "snapshots_select"
  ON public.consultor_health_snapshots
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT/UPDATE: service role only (engine escreve via upsert).
-- Nenhuma policy de escrita para 'authenticated'.
