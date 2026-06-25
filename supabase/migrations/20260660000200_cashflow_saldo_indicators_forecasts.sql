-- ============================================================
-- Fluxo de Caixa — toggle de Previsões de compra nos indicadores de SALDO/PROJEÇÃO
-- (Phase 60, CASHFIX-06 — extensão; decisão Wesley: escopo "Saldo/projeção")
-- ============================================================
-- Decisão do Wesley: o toggle "Incluir previsões de compra" deve mover os
-- indicadores de SALDO/PROJEÇÃO, mas NÃO a "Exposição por fornecedor" (que é
-- 100% previsões — as NFs reais não têm `supplier`, então filtrar zeraria o
-- painel) nem a "Composição de custos" (fica como está).
--
-- Por isso o parâmetro p_include_purchase_forecasts BOOLEAN DEFAULT false entra
-- só em:
--   • get_projected_balance_summary — saldo atual/pessimista/realista, data
--     crítica, saldo mínimo, total_expenses do horizonte.
--   • get_treasury_panel — APENAS v_current e o loop de projeção (alert_date,
--     min_balance_date, min_balance). Os KPIs de exposição de fornecedor
--     (fornec_30/60/90, total_exposicao) e os de pago (burn, saída real)
--     permanecem INALTERADOS — sempre incluem o que já incluíam.
--
-- get_supplier_exposure e get_cost_by_month NÃO mudam (revertidos ao original).
-- Filtro: AND (p_include_purchase_forecasts OR COALESCE(co.category,'') <> 'Previsões de compra').
-- DROP da assinatura de 2 args antes do CREATE (evita ambiguidade do PostgREST).
-- Projeto: ckcdevcxgvueywivefgx.
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- get_projected_balance_summary — todos os números são de saldo/projeção → toggle
-- ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_projected_balance_summary(UUID, INT);

CREATE OR REPLACE FUNCTION public.get_projected_balance_summary(
  p_org_id uuid,
  p_projection_days integer,
  p_include_purchase_forecasts BOOLEAN DEFAULT false
)
RETURNS TABLE(current_balance numeric, pessimistic_balance numeric, realistic_balance numeric, critical_date date, min_balance numeric, confirmed_income numeric, total_expenses numeric)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_initial NUMERIC := 0; v_current NUMERIC := 0; v_pess NUMERIC := 0; v_real NUMERIC := 0;
  v_critical DATE := NULL; v_min NUMERIC := 0; v_income NUMERIC := 0; v_expenses NUMERIC := 0;
  v_day INT; v_day_date DATE; v_day_inc NUMERIC; v_day_exp NUMERIC;
BEGIN
  v_initial := COALESCE((SELECT fs.initial_balance FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1), 0);
  SELECT v_initial
    + COALESCE((SELECT SUM(ci.net_amount) FROM cash_inflows ci WHERE ci.organization_id=p_org_id AND ci.release_date = v_today),0)
    - COALESCE((SELECT SUM(co.amount) FROM cash_outflows co WHERE co.organization_id=p_org_id AND co.outflow_date = v_today
                  AND (p_include_purchase_forecasts OR COALESCE(co.category,'') <> 'Previsões de compra')),0)
  INTO v_current;
  v_pess := v_current; v_real := v_current; v_min := v_current;
  SELECT COALESCE(SUM(ci.net_amount),0) INTO v_income FROM cash_inflows ci
   WHERE ci.organization_id=p_org_id AND ci.release_date > v_today AND ci.release_date <= v_today + p_projection_days;
  SELECT COALESCE(SUM(co.amount),0) INTO v_expenses FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.outflow_date > v_today AND co.outflow_date <= v_today + p_projection_days
     AND (p_include_purchase_forecasts OR COALESCE(co.category,'') <> 'Previsões de compra');
  FOR v_day IN 1..p_projection_days LOOP
    v_day_date := v_today + v_day;
    SELECT COALESCE(SUM(ci.net_amount),0) INTO v_day_inc FROM cash_inflows ci WHERE ci.organization_id=p_org_id AND ci.release_date = v_day_date;
    SELECT COALESCE(SUM(co.amount),0) INTO v_day_exp FROM cash_outflows co WHERE co.organization_id=p_org_id AND co.outflow_date = v_day_date
       AND (p_include_purchase_forecasts OR COALESCE(co.category,'') <> 'Previsões de compra');
    v_pess := v_pess - v_day_exp;
    v_real := v_real + v_day_inc - v_day_exp;
    IF v_critical IS NULL AND v_real < 0 THEN v_critical := v_day_date; END IF;
    IF v_real < v_min THEN v_min := v_real; END IF;
  END LOOP;
  RETURN QUERY SELECT v_current, v_pess, v_real, v_critical, v_min, v_income, v_expenses;
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_projected_balance_summary(UUID, INT, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_projected_balance_summary(UUID, INT, BOOLEAN) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────
-- get_treasury_panel — toggle SÓ em v_current + projeção (alert_date, min_balance).
-- fornec_30/60/90/total_exposicao e burn/saída real ficam INALTERADOS.
-- ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_treasury_panel(UUID, INT);

CREATE OR REPLACE FUNCTION public.get_treasury_panel(
  p_org_id UUID,
  p_horizon INT DEFAULT 30,
  p_include_purchase_forecasts BOOLEAN DEFAULT false
)
RETURNS TABLE (
  burn_rate NUMERIC, alert_threshold NUMERIC, alert_date DATE, min_balance_date DATE,
  min_balance NUMERIC, entrada_real_30d NUMERIC, saida_real_30d NUMERIC,
  fornec_30d NUMERIC, fornec_60d NUMERIC, fornec_90d NUMERIC, total_exposicao NUMERIC
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_alert_thresh NUMERIC := 30000; v_initial NUMERIC := 0; v_current NUMERIC := 0;
  v_burn NUMERIC := 0; v_entrada NUMERIC := 0; v_saida NUMERIC := 0;
  v_f30 NUMERIC := 0; v_f60 NUMERIC := 0; v_f90 NUMERIC := 0; v_total NUMERIC := 0;
  v_alert_date DATE := NULL; v_min_bal_date DATE := NULL;
  v_bal NUMERIC; v_min_bal NUMERIC; v_day_inc NUMERIC; v_day_exp NUMERIC; v_day INT;
BEGIN
  SELECT COALESCE(fs.alert_threshold, 30000), COALESCE(fs.initial_balance, 0)
  INTO v_alert_thresh, v_initial FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1;

  -- v_current respeita o toggle (é base da projeção)
  v_current := v_initial
    + COALESCE((SELECT SUM(ci.net_amount) FROM cash_inflows ci WHERE ci.organization_id=p_org_id AND ci.release_date=v_today),0)
    - COALESCE((SELECT SUM(co.amount) FROM cash_outflows co WHERE co.organization_id=p_org_id AND co.outflow_date=v_today
                  AND (p_include_purchase_forecasts OR COALESCE(co.category,'') <> 'Previsões de compra')),0);

  -- burn / saída real = PAGAS (inalterado)
  SELECT COALESCE(SUM(co.amount),0)/3.0 INTO v_burn FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.outflow_date >= v_today - 90 AND co.outflow_date < v_today AND co.status='paid';
  SELECT COALESCE(SUM(ci.net_amount),0) INTO v_entrada FROM cash_inflows ci
   WHERE ci.organization_id=p_org_id AND ci.release_date >= v_today - 30 AND ci.release_date <= v_today;
  SELECT COALESCE(SUM(co.amount),0) INTO v_saida FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.outflow_date >= v_today - 30 AND co.outflow_date <= v_today AND co.status='paid';

  -- Exposição por fornecedor = INALTERADA (não respeita o toggle — é a visão de OCs)
  SELECT COALESCE(SUM(co.amount),0) INTO v_f30 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending' AND co.outflow_date <= v_today + 30;
  SELECT COALESCE(SUM(co.amount),0) INTO v_f60 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending' AND co.outflow_date <= v_today + 60;
  SELECT COALESCE(SUM(co.amount),0) INTO v_f90 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending' AND co.outflow_date <= v_today + 90;
  SELECT COALESCE(SUM(co.amount),0) INTO v_total FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending';

  -- projeção (alert_date, min_balance) respeita o toggle
  v_bal := v_current; v_min_bal := v_current; v_min_bal_date := v_today;
  FOR v_day IN 1..p_horizon LOOP
    SELECT COALESCE(SUM(ci.net_amount),0) INTO v_day_inc FROM cash_inflows ci WHERE ci.organization_id=p_org_id AND ci.release_date = v_today + v_day;
    SELECT COALESCE(SUM(co.amount),0) INTO v_day_exp FROM cash_outflows co WHERE co.organization_id=p_org_id AND co.outflow_date = v_today + v_day
       AND (p_include_purchase_forecasts OR COALESCE(co.category,'') <> 'Previsões de compra');
    v_bal := v_bal + v_day_inc - v_day_exp;
    IF v_alert_date IS NULL AND v_bal < v_alert_thresh THEN v_alert_date := v_today + v_day; END IF;
    IF v_bal < v_min_bal THEN v_min_bal := v_bal; v_min_bal_date := v_today + v_day; END IF;
  END LOOP;

  RETURN QUERY SELECT v_burn, v_alert_thresh, v_alert_date, v_min_bal_date, v_min_bal, v_entrada, v_saida, v_f30, v_f60, v_f90, v_total;
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_treasury_panel(UUID, INT, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_treasury_panel(UUID, INT, BOOLEAN) TO authenticated, service_role;
