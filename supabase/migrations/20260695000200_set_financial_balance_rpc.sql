-- ============================================================
-- Phase 95 (Parte A) — set_financial_balance: escrita atômica da âncora
-- ============================================================
-- Resolve o Pitfall 1 do 95-RESEARCH.md: hoje o dialog AdjustBalanceDialog
-- (src/pages/mercadolivre/MLFluxoCaixa.tsx) grava initial_balance via
-- .upsert({ organization_id, initial_balance }, { onConflict: "organization_id" })
-- — upsert PARCIAL que NUNCA toca balance_anchor_date nem updated_at (não há
-- trigger de updated_at nesta tabela). Sem esta RPC, toda vez que Wesley
-- reancora o saldo na UI, balance_anchor_date fica parado na data do backfill
-- inicial — o roll-forward soma um intervalo cada vez maior a partir de uma
-- âncora cada vez mais desatualizada, e o alerta "âncora > 7 dias" nunca mais
-- reflete a realidade.
--
-- set_financial_balance(p_org_id, p_amount) grava initial_balance +
-- balance_anchor_date + updated_at ATOMICAMENTE (mesma instrução INSERT ...
-- ON CONFLICT DO UPDATE). A data BRT ("hoje") é calculada NO SERVIDOR — mesma
-- fonte que get_rolled_opening_balance usa — para não confiar no relógio do
-- browser (Anti-Pattern do RESEARCH; mesmo bug já corrigido para get_cashflow
-- em 20260619020000_cashflow_brt_timezone.sql).
--
-- SEGURANÇA: SECURITY INVOKER, sem checagem manual de owner dentro da função.
-- O guard real é a policy RLS "financial_settings_write" (FOR ALL, USING/WITH
-- CHECK get_org_role(auth.uid(), organization_id) = 'owner') já existente em
-- 20260618100000_cash_flow_tables.sql — herdada automaticamente via INVOKER.
--
-- Apply via MCP apply_migration no projeto ckcdevcxgvueywivefgx.
-- NUNCA `supabase db push` (sem token de CLI para este projeto).
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_financial_balance(p_org_id UUID, p_amount NUMERIC)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.financial_settings (organization_id, initial_balance, balance_anchor_date, updated_at)
  VALUES (
    p_org_id,
    p_amount,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    now()
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET initial_balance     = EXCLUDED.initial_balance,
        balance_anchor_date = EXCLUDED.balance_anchor_date,
        updated_at          = now();
END;
$$;

-- RLS financial_settings_write (get_org_role=owner) continua sendo o guard —
-- INVOKER preserva isso automaticamente. Nenhuma checagem redundante aqui.
REVOKE EXECUTE ON FUNCTION public.set_financial_balance(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_financial_balance(UUID, NUMERIC) TO authenticated;
