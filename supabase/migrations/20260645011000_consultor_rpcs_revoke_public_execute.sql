-- ============================================================
-- Phase 45 — Fix de segurança: revogar EXECUTE default de PUBLIC
-- nas 4 RPCs do Consultor (SECURITY DEFINER, sem checagem de
-- is_org_member; devem ser chamadas APENAS pelo engine/service_role).
--
-- Motivo: Postgres concede EXECUTE a PUBLIC por padrão ao criar a
-- função. O GRANT a service_role em 20260645010000 não removeu esse
-- default → anon/authenticated podiam invocar via /rest/v1/rpc com
-- p_org_id arbitrário (vazamento cross-org). Detectado por get_advisors
-- (anon/authenticated_security_definer_function_executable) na auditoria
-- pós-apply da Wave 1.
--
-- Idempotente: REVOKE/GRANT podem rodar múltiplas vezes.
-- Supabase project: ckcdevcxgvueywivefgx.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.get_consultor_margin_by_product(uuid, text[], date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_consultor_coverage(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_consultor_paused_with_sales(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_consultor_no_cost_count(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_consultor_margin_by_product(uuid, text[], date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_consultor_coverage(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_consultor_paused_with_sales(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_consultor_no_cost_count(uuid) TO service_role;
