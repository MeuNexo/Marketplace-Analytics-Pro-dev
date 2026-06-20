-- ============================================================
-- Phase 47 (Go-Live QA) — hardening de seguranca
-- Aplicado em prod ckcdevcxgvueywivefgx via MCP:
--   phase47_security_hardening_rls_revoke (+ REVOKE PUBLIC complementar)
-- ============================================================
-- 1. RLS em cat_backfill_queue — advisor ERROR rls_disabled_in_public.
--    Sem policy = deny anon/authenticated; service_role (cron) e funcoes
--    enrich_* (SECURITY DEFINER) seguem acessando. Frontend nao usa a tabela.
-- 2. REVOKE total (anon, authenticated, PUBLIC) nas RPCs SECURITY DEFINER de
--    ESCRITA de pedidos. Chamadas só pelas EFs de sync via service_role
--    (que ignora o REVOKE). Antes, anon podia injetar/sobrescrever orders.
-- ============================================================

ALTER TABLE public.cat_backfill_queue ENABLE ROW LEVEL SECURITY;

REVOKE EXECUTE ON FUNCTION public.batch_upsert_orders(jsonb) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.upsert_order_preserve_cost(
  text, text, text, text, text, text, uuid, text, text, text, integer, numeric,
  numeric, numeric, text, text, text, text, text, text, timestamptz, numeric,
  numeric, numeric, text, numeric, numeric, text
) FROM PUBLIC, anon, authenticated;
