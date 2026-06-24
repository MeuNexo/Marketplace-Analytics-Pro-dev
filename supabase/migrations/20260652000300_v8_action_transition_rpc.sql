-- ============================================================
-- Phase 52 v8.0 — RPC de transição atômica: claim_approved_action
-- ============================================================
--
-- Gate atômico TOCTOU-safe (SC-5) que move uma ação de 'approved' → 'executing'.
-- A fase 52 ENTREGA a função; o executor da fase 54 a chama via supabase.rpc().
--
--   UPDATE ... WHERE id = p_action_id AND status = 'approved' RETURNING *
--   - Se a linha estava 'approved' → retorna a linha (claim feito).
--   - Se já foi reivindicada por outro processo → 0 linhas → o executor aborta
--     ANTES de tocar a API do ML (anti-TOCTOU/dedup, Pitfall P6).
--   Único padrão correto; nunca SELECT-then-UPDATE.
--
-- POR QUE rodar como INVOKER (não DEFINER):
--   A RLS org-first de proposed_actions (is_org_member) enforça o escopo. Se a
--   RPC corre como INVOKER, passar um p_action_id de OUTRA org não casa nenhuma
--   linha visível ao caller → o UPDATE não afeta nada (anti-IDOR). Espelha o
--   padrão de 20260615120000_margin_with_ads_rpc.sql (RPCs de negócio = INVOKER,
--   feedback_supabase_security_invoker.md). SET search_path = public é mandatório.
--
-- POR QUE o REVOKE (Pitfall P4):
--   Postgres concede EXECUTE a PUBLIC por DEFAULT ao criar a função. Sem o
--   REVOKE explícito, get_advisors acusa anon/authenticated_security_definer_
--   function_executable (mesmo sendo INVOKER — o default grant é o problema).
--   Precedente exato: 20260645011000_consultor_rpcs_revoke_public_execute.sql.
--   Só o service_role (executor) deve invocar esta RPC.
--
-- Idempotência: CREATE OR REPLACE FUNCTION + REVOKE/GRANT (re-aplicáveis).
--   Esta migration opera sobre public.proposed_actions criada em M1
--   (20260652000000_v8_action_tables.sql) — aplicar M1 antes desta.
--
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_approved_action(p_action_id uuid)
RETURNS public.proposed_actions
LANGUAGE sql
SECURITY INVOKER          -- RLS de proposed_actions enforça escopo de org (anti-IDOR)
SET search_path = public
AS $$
  UPDATE public.proposed_actions
     SET status = 'executing', updated_at = now()
   WHERE id = p_action_id
     AND status = 'approved'
  RETURNING *;
$$;

-- Postgres concede EXECUTE a PUBLIC por default → revogar explicitamente (P4).
REVOKE EXECUTE ON FUNCTION public.claim_approved_action(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_approved_action(uuid) TO service_role;
