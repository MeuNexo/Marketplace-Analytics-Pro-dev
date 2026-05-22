-- Phase 22: Ativar sync intraday (a cada 2h) para todas as orgs com ML conectado.
--
-- dispatch_sync_jobs() já roda a cada 30min e respeita sync_interval_minutes.
-- Com sync_interval_minutes = 120, o dispatcher cria um job quando elapsed >= 2h.
-- Jobs com date_from = NULL → mercado-libre-integration usa days = 1 (hoje em BRT).
--
-- Operação idempotente: ON CONFLICT atualiza somente sync_interval_minutes.
-- Orgs sem registro em organization_plans recebem novo registro (plan_tier = 'free' default).
-- Orgs que já têm registro (ex: enterprise com -1) são atualizadas para 120.
--
-- NOTA: Se uma org enterprise precisar manter intervalo customizado,
-- ajustar manualmente após esta migration.

INSERT INTO public.organization_plans (organization_id, sync_interval_minutes)
SELECT DISTINCT organization_id, 120
FROM public.ml_tokens
WHERE access_token IS NOT NULL
ON CONFLICT (organization_id)
  DO UPDATE SET
    sync_interval_minutes = 120,
    updated_at = now();
