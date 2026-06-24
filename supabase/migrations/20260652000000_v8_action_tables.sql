-- ============================================================
-- Phase 52 v8.0 — Tabelas de ações: proposed_actions + action_audit_log
-- ============================================================
--
-- Cria 2 tabelas que sustentam o motor de ações do Consultor v2:
--
--   1. proposed_actions  — fila de ações propostas pelo motor de regras,
--                          com state-machine de 6 estados (proposed/approved/
--                          rejected/executing/done/failed) modelada via CHECK
--                          (não enum nativo — Pitfall P5). Dedup de ações
--                          abertas via índice UNIQUE PARCIAL (SC-2).
--                          As colunas de auditoria (approved_by/approved_at/
--                          executed_at/result_summary) entram JÁ AGORA, não em
--                          patch posterior (Pitfall P6).
--
--   2. action_audit_log  — log append-only/imutável de transições de estado.
--                          Imutabilidade = AUSÊNCIA de policy de INSERT/UPDATE/
--                          DELETE para authenticated (default-deny). Escrita só
--                          via service_role, que ignora RLS. Sem trigger.
--
-- State-machine (6 estados) e quem pode transicionar (Pitfall P7 / Anti-Pattern 3):
--   proposed --owner approve--> approved --EF claim--> executing --> done | failed
--      |                            |
--      +--owner reject--> rejected  +--owner reject--> rejected
--   - proposed→approved|rejected e approved→rejected: UPDATE authenticated (owner),
--     gated pela RLS WITH CHECK (status IN ('approved','rejected')).
--   - approved→executing e executing→done|failed: EXCLUSIVAMENTE service_role
--     (executor da fase 54). O WITH CHECK do UPDATE authenticated NUNCA permite
--     executing/done/failed — senão um owner forjaria 'done' sem tocar o ML.
--
-- RLS org-first: segue exatamente o padrão de
--   supabase/migrations/20260645000000_consultor_tables.sql.
--   is_org_member para SELECT; get_org_role = 'owner' para o UPDATE restrito.
--
-- Cap de ~4KB no action_audit_log.detail é responsabilidade do EXECUTOR
--   (fase 54), NÃO um CHECK no schema (Q4 do research) — um CHECK rígido faria
--   o INSERT de auditoria FALHAR com resposta ML grande, pior que truncar.
--
-- Idempotência: CREATE TABLE IF NOT EXISTS, CHECK via DO/EXCEPTION
--   duplicate_object, índices IF NOT EXISTS, DROP POLICY IF EXISTS antes de
--   CREATE POLICY. Seguro re-aplicar via MCP apply_migration.
--
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- ============================================================

-- ============================================================
-- TABELA 1: proposed_actions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proposed_actions (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id           text        NULL,
  insight_id           uuid        NULL REFERENCES public.insights(id) ON DELETE SET NULL,
  rule_key             text        NOT NULL,
  action_type          text        NOT NULL,
  target_ref           text        NOT NULL,
  current_value        jsonb       NULL,
  proposed_value       jsonb       NOT NULL,
  estimated_impact_brl numeric     NULL,
  status               text        NOT NULL DEFAULT 'proposed',
  proposed_by          uuid        NOT NULL,
  -- Colunas de auditoria entram AGORA, não em patch posterior (Pitfall P6):
  approved_by          uuid        NULL,
  approved_at          timestamptz NULL,
  executed_at          timestamptz NULL,
  result_summary       text        NULL,
  dry_run_preview      jsonb       NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- CHECK idempotente: status controla o ciclo de vida (6 estados). Text+CHECK,
-- nunca enum nativo (Pitfall P5 — ALTER TYPE ADD VALUE não roda em transação).
DO $$ BEGIN
  ALTER TABLE public.proposed_actions
    ADD CONSTRAINT proposed_actions_status_check
    CHECK (status IN ('proposed', 'approved', 'rejected', 'executing', 'done', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CHECK idempotente: action_type restringe os 5 tipos de ação suportados.
DO $$ BEGIN
  ALTER TABLE public.proposed_actions
    ADD CONSTRAINT proposed_actions_action_type_check
    CHECK (action_type IN ('update_price', 'pause_ads_campaign', 'update_ads_budget', 'activate_listing', 'pause_listing'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- DEDUP PARCIAL (SC-2): no máximo uma ação ABERTA por (org, rule_key, target_ref).
-- WHERE status IN ('proposed','approved','executing') permite re-propor após
-- done/failed/rejected sem violar a unique.
CREATE UNIQUE INDEX IF NOT EXISTS proposed_actions_open_dedup
  ON public.proposed_actions (organization_id, rule_key, target_ref)
  WHERE status IN ('proposed', 'approved', 'executing');

-- Índice de query frequente: listar ações por org+status, mais recentes primeiro.
CREATE INDEX IF NOT EXISTS proposed_actions_org_status_idx
  ON public.proposed_actions (organization_id, status, created_at DESC);

ALTER TABLE public.proposed_actions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "proposed_actions_select" ON public.proposed_actions';
  EXECUTE 'DROP POLICY IF EXISTS "proposed_actions_insert" ON public.proposed_actions';
  EXECUTE 'DROP POLICY IF EXISTS "proposed_actions_update" ON public.proposed_actions';
END $$;

-- SELECT: qualquer membro da org pode ler as ações da própria org.
CREATE POLICY "proposed_actions_select"
  ON public.proposed_actions
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT: membro propõe; força proposed_by = auth.uid() e status = 'proposed'.
CREATE POLICY "proposed_actions_insert"
  ON public.proposed_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(auth.uid(), organization_id)
    AND proposed_by = auth.uid()
    AND status = 'proposed'
  );

-- UPDATE: OWNER only; só pode mover para 'approved' ou 'rejected'.
-- executing/done/failed ficam EXCLUSIVAMENTE no executor (service_role).
-- O WITH CHECK NUNCA permite esses estados (Pitfall P7 / Anti-Pattern 3).
CREATE POLICY "proposed_actions_update"
  ON public.proposed_actions
  FOR UPDATE
  TO authenticated
  USING  (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role)
  WITH CHECK (
    public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role
    AND status IN ('approved', 'rejected')
  );

-- DELETE: nenhuma policy para authenticated (default-deny). Sem remoção de ações.


-- ============================================================
-- TABELA 2: action_audit_log
-- ============================================================
-- Log append-only de transições de estado das ações.
-- IMUTABILIDADE = AUSÊNCIA de policy de INSERT/UPDATE/DELETE para authenticated
-- (default-deny). Escrita só via service_role (que ignora RLS) — o executor
-- nunca emite UPDATE/DELETE nesta tabela, apenas INSERT.
-- O cap de ~4KB em `detail` é responsabilidade do executor (fase 54), NÃO um
-- CHECK no schema (Q4) — um CHECK rígido faria o INSERT de auditoria falhar
-- com resposta ML grande. Sem trigger de imutabilidade (padrão do projeto =
-- ausência-de-grant, igual insights/snapshots).

CREATE TABLE IF NOT EXISTS public.action_audit_log (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action_id       uuid        NOT NULL REFERENCES public.proposed_actions(id) ON DELETE CASCADE,
  actor_id        uuid        NULL,   -- null = transição de sistema/EF
  from_status     text        NOT NULL,
  to_status       text        NOT NULL,
  detail          jsonb       NULL,   -- resposta ML trimada ≤ ~4KB pelo executor (fase 54)
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices: histórico por ação e por org, mais recentes primeiro.
CREATE INDEX IF NOT EXISTS audit_log_action_idx
  ON public.action_audit_log (action_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_org_idx
  ON public.action_audit_log (organization_id, created_at DESC);

ALTER TABLE public.action_audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "audit_log_select" ON public.action_audit_log';
END $$;

-- SELECT: qualquer membro da org pode ler o histórico de auditoria.
CREATE POLICY "audit_log_select"
  ON public.action_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- SEM policy de INSERT/UPDATE/DELETE para authenticated → append-only por
-- default-deny. Escrita exclusivamente via service_role.
