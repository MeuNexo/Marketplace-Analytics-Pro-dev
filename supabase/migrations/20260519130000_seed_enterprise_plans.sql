-- Seed: garante que todas as organizações existentes tenham plano enterprise com limites ilimitados (-1).
-- Operação idempotente: ON CONFLICT (organization_id) DO NOTHING evita duplicatas.
-- Executar novamente após inserir novas organizações é seguro.

INSERT INTO public.organization_plans (organization_id, plan_tier, sync_interval_minutes, history_days)
SELECT id, 'enterprise', -1, -1
FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;
