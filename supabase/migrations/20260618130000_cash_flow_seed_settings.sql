-- ============================================================
-- Phase 49 Fluxo de Caixa — Seed de financial_settings por org
-- ============================================================
-- Os RPCs de fluxo de caixa (get_cashflow / get_daily_balance /
-- get_projected_balance_summary) leem financial_settings para a org. Sem uma
-- linha, o SELECT ... INTO deixa a variável NULL e o cálculo propaga NULL.
--
-- Garante 1 linha de parâmetros (defaults: initial_balance=0,
-- operational_cost_rate=0.22, safety_margin=10000) para toda org que tem conta
-- ML conectada. Idempotente (ON CONFLICT DO NOTHING — não sobrescreve ajustes
-- que o owner tenha feito). Novos tenants devem semear via onboarding ou re-rodar.
--
-- Supabase project: ckcdevcxgvueywivefgx.
-- ============================================================

INSERT INTO public.financial_settings (organization_id, initial_balance, operational_cost_rate, safety_margin)
SELECT DISTINCT organization_id, 0, 0.22, 10000
FROM public.ml_tokens
WHERE organization_id IS NOT NULL
ON CONFLICT (organization_id) DO NOTHING;
