-- TENANT-03 (pré-gate): garantir que as orgs internas existentes fiquem em enterprise
-- (ilimitado) ANTES de ativar o gate check_quota no process-sync-job.
--
-- Contexto: o seed 20260519130000_seed_enterprise_plans.sql usava ON CONFLICT DO NOTHING,
-- então orgs que já tinham uma linha 'free' (ex.: Pé Vermeio) NÃO foram promovidas.
-- Auditoria via MCP (2026-06-14) encontrou:
--   Pé Vermeio: free / interval=120  → gate bloquearia a operação real após 12 syncs/dia
--   Thales    : sem plano (NULL)
--
-- Esta migration re-aplica enterprise para TODAS as orgs existentes com DO UPDATE
-- (idempotente). Tiers pagos reais (free/starter/pro) passam a ser geridos pela
-- monetização Stripe na Phase 44 — esta correção cobre apenas as orgs internas atuais.

INSERT INTO public.organization_plans (organization_id, plan_tier, sync_interval_minutes, history_days)
SELECT id, 'enterprise', -1, -1
FROM public.organizations
ON CONFLICT (organization_id) DO UPDATE
  SET plan_tier             = 'enterprise',
      sync_interval_minutes = -1,
      history_days          = -1,
      updated_at            = now();
