-- ============================================================
-- Phase 49 — RPCs fluxo de caixa: SAÍDAS SEM FILTRO DE STATUS
-- ============================================================
--
-- Esta migration substitui o filtro `status='pending'` nas queries
-- de cash_outflows das 3 RPCs (get_cashflow, get_daily_balance,
-- get_projected_balance_summary) por "qualquer status".
--
-- MOTIVO:
--   Wesley agenda pagamentos no Tiny com dataPagamento FUTURA.
--   A EF sync-tiny-payables normaliza o campo data_pagamento preenchido
--   para status='paid' — mesmo que a data de pagamento seja no futuro.
--   As RPCs anteriores filtravam co.status='pending', descartando
--   essas saídas agendadas (13 contas 'paid' futuras = R$44.064,95),
--   o que inflava artificialmente o saldo projetado.
--
-- SOLUÇÃO:
--   Remover TODOS os filtros `AND co.status = 'pending'` / `co.status='pending'`
--   das queries de cash_outflows. O recorte futuro-only CONTINUA GARANTIDO
--   pelas condições de data (BETWEEN v_start AND p_end_date, > v_today, = v_day_date, etc.).
--   Status não é mais critério de inclusão — data de saída é o único critério.
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION.
-- SECURITY INVOKER (NUNCA DEFINER — DEFINER + p_org_id = IDOR crítico).
-- Supabase project: ckcdevcxgvueywivefgx.
-- ============================================================

-- ============================================================
-- RPC 1: get_cashflow
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_cashflow(
  p_org_id UUID, p_start_date DATE, p_end_date DATE
)
RETURNS TABLE (date DATE, daily_income NUMERIC, daily_expense NUMERIC, daily_balance NUMERIC, accumulated_balance NUMERIC)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_initial NUMERIC := 0;
  v_start   DATE;
BEGIN
  v_initial := COALESCE((SELECT fs.initial_balance FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1), 0);
  v_start := GREATEST(p_start_date, CURRENT_DATE);  -- futuro-only

  RETURN QUERY
  WITH daily AS (
    SELECT x.d_date,
           COALESCE(SUM(x.d_income),0)  AS inc,
           COALESCE(SUM(x.d_expense),0) AS exp
    FROM (
      SELECT ci.release_date AS d_date, ci.net_amount AS d_income, 0 AS d_expense
      FROM cash_inflows ci
      WHERE ci.organization_id = p_org_id AND ci.release_date BETWEEN v_start AND p_end_date
      UNION ALL
      SELECT co.outflow_date, 0, co.amount
      FROM cash_outflows co
      WHERE co.organization_id = p_org_id
        AND co.outflow_date BETWEEN v_start AND p_end_date
    ) x
    GROUP BY x.d_date
  )
  SELECT d.d_date, d.inc, d.exp, (d.inc - d.exp),
         (v_initial + SUM(d.inc - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC
  FROM daily d ORDER BY d.d_date ASC;
END;
$$;

-- ============================================================
-- RPC 2: get_daily_balance
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_daily_balance(
  p_org_id UUID, p_target_date DATE
)
RETURNS TABLE (saldo_inicial NUMERIC, entradas_hoje NUMERIC, saidas_hoje NUMERIC, saldo_final_previsto NUMERIC)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_initial  NUMERIC := 0;
  v_entradas NUMERIC := 0;
  v_saidas   NUMERIC := 0;
BEGIN
  v_initial := COALESCE((SELECT fs.initial_balance FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1), 0);

  SELECT COALESCE(SUM(ci.net_amount),0) INTO v_entradas
  FROM cash_inflows ci
  WHERE ci.organization_id = p_org_id AND ci.release_date = p_target_date;

  SELECT COALESCE(SUM(co.amount),0) INTO v_saidas
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id AND co.outflow_date = p_target_date;

  RETURN QUERY SELECT v_initial, v_entradas, v_saidas, (v_initial + v_entradas - v_saidas);
END;
$$;

-- ============================================================
-- RPC 3: get_projected_balance_summary
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_projected_balance_summary(
  p_org_id UUID, p_projection_days INT
)
RETURNS TABLE (current_balance NUMERIC, pessimistic_balance NUMERIC, realistic_balance NUMERIC,
               critical_date DATE, min_balance NUMERIC, confirmed_income NUMERIC, total_expenses NUMERIC)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_today        DATE    := CURRENT_DATE;
  v_initial      NUMERIC := 0;
  v_current      NUMERIC := 0;
  v_pess         NUMERIC := 0;
  v_real         NUMERIC := 0;
  v_critical     DATE    := NULL;
  v_min          NUMERIC := 0;
  v_income       NUMERIC := 0;
  v_expenses     NUMERIC := 0;
  v_day          INT;
  v_day_date     DATE;
  v_day_inc      NUMERIC;
  v_day_exp      NUMERIC;
BEGIN
  v_initial := COALESCE((SELECT fs.initial_balance FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1), 0);

  SELECT v_initial
         + COALESCE((SELECT SUM(ci.net_amount) FROM cash_inflows ci WHERE ci.organization_id=p_org_id AND ci.release_date = v_today),0)
         - COALESCE((SELECT SUM(co.amount) FROM cash_outflows co WHERE co.organization_id=p_org_id AND co.outflow_date = v_today),0)
  INTO v_current;

  v_pess := v_current; v_real := v_current; v_min := v_current;

  SELECT COALESCE(SUM(ci.net_amount),0) INTO v_income
  FROM cash_inflows ci
  WHERE ci.organization_id=p_org_id AND ci.release_date > v_today AND ci.release_date <= v_today + p_projection_days;

  SELECT COALESCE(SUM(co.amount),0) INTO v_expenses
  FROM cash_outflows co
  WHERE co.organization_id=p_org_id AND co.outflow_date > v_today AND co.outflow_date <= v_today + p_projection_days;

  FOR v_day IN 1..p_projection_days LOOP
    v_day_date := v_today + v_day;
    SELECT COALESCE(SUM(ci.net_amount),0) INTO v_day_inc FROM cash_inflows ci
      WHERE ci.organization_id=p_org_id AND ci.release_date = v_day_date;
    SELECT COALESCE(SUM(co.amount),0) INTO v_day_exp FROM cash_outflows co
      WHERE co.organization_id=p_org_id AND co.outflow_date = v_day_date;

    v_pess := v_pess - v_day_exp;
    v_real := v_real + v_day_inc - v_day_exp;
    IF v_critical IS NULL AND v_real < 0 THEN v_critical := v_day_date; END IF;
    IF v_real < v_min THEN v_min := v_real; END IF;
  END LOOP;

  RETURN QUERY SELECT v_current, v_pess, v_real, v_critical, v_min, v_income, v_expenses;
END;
$$;

-- ============================================================
-- Controle de acesso: REVOKE PUBLIC + GRANT authenticated
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_daily_balance(UUID,DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_projected_balance_summary(UUID,INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_balance(UUID,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_projected_balance_summary(UUID,INT) TO authenticated;
