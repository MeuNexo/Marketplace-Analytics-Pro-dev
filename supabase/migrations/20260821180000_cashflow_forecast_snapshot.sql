-- ============================================================
-- cashflow_forecast_snapshot — o que a previsao dizia, congelado
-- (Fase 224 — ERR-02, criterio 2 do ROADMAP)
-- ============================================================
-- Hoje nenhuma RPC de caixa guarda o que a previsao dizia ontem: todas
-- recalculam na hora. get_cashflow_data_health mede FRESCOR ("o dado esta
-- fresco?"), nunca ACERTO ("o numero que eu dei ontem estava certo?").
--
-- D-5 (nao-negociavel): linha de snapshot e IMUTAVEL. O job so insere e
-- nunca atualiza snapshot_date passado. Sobrescrever destroi exatamente o
-- dado que o backtest precisa.
--
-- DOIS MECANISMOS INDEPENDENTES para a mesma garantia:
--   1. Padrao declarado do projeto (20260652000000_v8_action_tables.sql:148-189):
--      RLS ligada + policy SO de SELECT para authenticated. Sem policy de
--      INSERT/UPDATE/DELETE, o default-deny torna a tabela append-only para
--      quem passa pela RLS. SEM TRIGGER — busca por trigger de
--      imutabilidade neste repositorio retorna zero ocorrencias.
--   2. Reforco de privilegio: service_role ignora RLS mas NAO ignora GRANT
--      de tabela, e o default privilege do Supabase lhe daria UPDATE/DELETE.
--      Sem o REVOKE, "o job promete nao atualizar" e promessa de codigo; com
--      ele, o banco recusa. Extensao de um padrao existente
--      (20260805013000_fechar_tabelas_de_trabalho.sql:52-64 revoga em laco
--      sobre public), nao invencao. Medido em producao no Q2 do 224-01:
--      sr_pode_update=false e sr_pode_delete=false apos o REVOKE
--      (224-MEDICOES.md).
--
-- ENABLE + REVOKE + POLICY + GRANT SAEM JUNTOS (padrao sec07,
-- 20260803230657:11-23) — ENABLE orfao deixaria a tabela negando tudo para
-- todos.
--
-- ALCANCE owner/admin, nao todo membro. Precedente:
-- orders_status_reconciliation, trilha de auditoria financeira, escolheu o
-- mesmo alcance. Alargar depois e trocar a expressao de uma policy.
--
-- organization_id NA CHAVE: o briefing especificou
-- (snapshot_date, target_date, fonte), que colidiria entre Pe Vermeio,
-- Junior e Thales na mesma linha.
--
-- QUATRO FONTES GRAVADAS. mercado_pago (a agenda, ja deflacionada, que e o
-- que a tela mostra), faturamento_medio (a parcela que a media injeta a
-- partir do decimo dia), saida_prevista (contas a pagar em aberto) e
-- saldo_projetado (a linha confirmada acumulada). Entradas e saidas
-- SEPARADAS e nao um numero de saldo so: sem isso, os ~R$ 16.958/mes de
-- pendencias fantasma do Tiny podem cancelar o excesso da agenda e produzir
-- um saldo "quase certo" errado dos dois lados. meta_deflacionada fica na
-- restricao, reservada pelo briefing, sem ninguem gravando hoje.
--
-- deflator: o valor vigente no dia em que a previsao foi feita. Com ele, a
-- agenda BRUTA e recuperavel a partir da deflacionada. NULL quando
-- get_estorno_deflator nao mediu — nunca 1,00 por omissao.
--
-- Volume: ~31 dias x 4 fontes = 124 linhas/dia/org. Cerca de 45 mil
-- linhas/ano/org. Desprezivel.
--
-- ATENCAO A QUEM LER DEPOIS: RLS sozinho NUNCA protegeria esta tabela.
-- service_role tem rolbypassrls=true (medido no Q2 do 224-01) — quem
-- segura a imutabilidade e a AUSENCIA DE GRANT (o REVOKE abaixo), nao a
-- policy. Se um dia alguem "reforcar a seguranca" acrescentando uma policy
-- de escrita aqui, a D-5 volta a valer zero: o service_role da edge
-- function ignoraria a policy do mesmo jeito, e so o REVOKE de tabela o
-- impede.
--
-- Projeto: ckcdevcxgvueywivefgx (NAO usar gionpsuunfkkzzjdubfy).
-- Aplicar via MCP apply_migration. NUNCA `supabase db push`.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cashflow_forecast_snapshot (
  organization_id uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot_date   date          NOT NULL,   -- dia em que a previsao foi FEITA
  target_date     date          NOT NULL,   -- dia previsto
  horizon_days    int GENERATED ALWAYS AS (target_date - snapshot_date) STORED,
  fonte           text          NOT NULL,
  valor_previsto  numeric(14,2) NOT NULL,
  deflator        numeric(6,4),             -- NULL = nao medido, nunca 1,00 por omissao
  created_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, snapshot_date, target_date, fonte),
  CONSTRAINT cfs_horizonte_nao_negativo CHECK (target_date >= snapshot_date),
  CONSTRAINT cfs_fonte_valida CHECK (fonte IN ('mercado_pago','faturamento_medio',
                                               'saida_prevista','saldo_projetado',
                                               'meta_deflacionada')),
  CONSTRAINT cfs_deflator_plausivel CHECK (deflator IS NULL
                                           OR (deflator >= 0.80 AND deflator <= 1.00))
);

CREATE INDEX IF NOT EXISTS cfs_org_horizonte_alvo_idx
  ON public.cashflow_forecast_snapshot (organization_id, fonte, horizon_days, target_date);

CREATE INDEX IF NOT EXISTS cfs_org_snapshot_idx
  ON public.cashflow_forecast_snapshot (organization_id, snapshot_date);

-- ENABLE + REVOKE + POLICY + GRANT juntos
ALTER TABLE public.cashflow_forecast_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cashflow_forecast_snapshot FROM PUBLIC, anon, authenticated;

CREATE POLICY "cashflow_forecast_snapshot org select"
  ON public.cashflow_forecast_snapshot FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id) IN ('owner','admin')
  );

GRANT SELECT ON public.cashflow_forecast_snapshot TO authenticated;

-- SEM policy de INSERT/UPDATE/DELETE para authenticated -> append-only por
-- default-deny. Escrita exclusivamente pela edge function com service_role.
REVOKE UPDATE, DELETE, TRUNCATE ON public.cashflow_forecast_snapshot FROM service_role;
GRANT  SELECT, INSERT ON public.cashflow_forecast_snapshot TO service_role;

COMMENT ON TABLE public.cashflow_forecast_snapshot IS
  'Fase 224 ERR-02. Append-only: o job diario so insere, com ON CONFLICT DO NOTHING. '
  'UPDATE/DELETE revogados de service_role — a imutabilidade e do banco, nao do codigo.';

-- ============================================================
-- A view de saude. A AUSENCIA de linha e o alarme: se o job parar, ninguem
-- percebe ate o backtest ficar com buracos meses depois — que e a
-- assinatura do bug da Fase 211 (20260805020000_billing_sync_state.sql:1-22).
--
-- security_invoker: DIVERGENCIA DELIBERADA em relacao a
-- ml_billing_sync_health (20260805020000:50-77), que nao usa. View sem essa
-- opcao roda com os privilegios do dono e contorna a RLS de baixo —
-- toleravel para estado de sincronizacao, nao para saldo de caixa por dia.
-- ============================================================
CREATE OR REPLACE VIEW public.cashflow_forecast_snapshot_health
WITH (security_invoker = true) AS
SELECT
  s.organization_id,
  o.name                                                   AS organizacao,
  min(s.snapshot_date)                                     AS primeiro_snapshot,
  max(s.snapshot_date)                                     AS ultimo_snapshot,
  ((now() AT TIME ZONE 'America/Sao_Paulo')::date
     - max(s.snapshot_date))                               AS dias_desde_o_ultimo,
  count(DISTINCT s.snapshot_date)                          AS dias_congelados,
  count(*)                                                 AS linhas,
  (max(s.snapshot_date)
     < (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) AS parou_de_congelar,
  (count(DISTINCT s.snapshot_date) < 15)                   AS amostra_ainda_provisoria
FROM public.cashflow_forecast_snapshot s
LEFT JOIN public.organizations o ON o.id = s.organization_id
GROUP BY s.organization_id, o.name;

REVOKE ALL  ON public.cashflow_forecast_snapshot_health FROM PUBLIC, anon;
GRANT SELECT ON public.cashflow_forecast_snapshot_health TO authenticated, service_role;
