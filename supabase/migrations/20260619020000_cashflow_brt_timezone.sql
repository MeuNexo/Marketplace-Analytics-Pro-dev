-- ============================================================
-- Fluxo de Caixa — "hoje" passa a ser o dia BRT (America/Sao_Paulo), não UTC.
-- ============================================================
-- Bug: CURRENT_DATE no Postgres é UTC. À noite no Brasil (UTC−3) o dia UTC já
-- virou, então o caixa puxava a liberação de amanhã como "hoje" e o gráfico
-- começava um dia adiantado. Fix: usar (now() AT TIME ZONE 'America/Sao_Paulo')::date.
-- Afeta get_cashflow (eixo/série) e get_projected_balance_summary (cards).
-- get_daily_balance recebe a data do cliente (corrigido no front via brToday()).
-- Projeto: ckcdevcxgvueywivefgx.
-- ============================================================

-- ── get_cashflow: v_today BRT no lugar de CURRENT_DATE ──────────────────────
CREATE OR REPLACE FUNCTION public.get_cashflow(
  p_org_id UUID, p_start_date DATE, p_end_date DATE
)
RETURNS TABLE (
  date DATE,
  daily_income NUMERIC,
  daily_expense NUMERIC,
  daily_projection NUMERIC,
  daily_balance NUMERIC,
  accumulated_balance NUMERIC,
  accumulated_balance_sma NUMERIC
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_initial NUMERIC := 0;
  v_today   DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_start   DATE;
  v_sma     NUMERIC := 0;
BEGIN
  v_initial := COALESCE((SELECT fs.initial_balance FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1), 0);
  v_start := GREATEST(p_start_date, v_today);  -- futuro-only, base BRT

  v_sma := COALESCE((
    SELECT SUM(o.receita_bruta - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0)) / 15.0
    FROM orders o
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND LEFT(o.data_pedido, 10)::date BETWEEN v_today - 15 AND v_today - 1
  ), 0);

  RETURN QUERY
  WITH days AS (
    SELECT gs::date AS d_date
    FROM generate_series(v_start, p_end_date, INTERVAL '1 day') gs
  ),
  inc AS (
    SELECT ci.release_date AS d_date, SUM(ci.net_amount) AS amt
    FROM cash_inflows ci
    WHERE ci.organization_id = p_org_id AND ci.release_date BETWEEN v_start AND p_end_date
    GROUP BY ci.release_date
  ),
  exp AS (
    SELECT co.outflow_date AS d_date, SUM(co.amount) AS amt
    FROM cash_outflows co
    WHERE co.organization_id = p_org_id AND co.outflow_date BETWEEN v_start AND p_end_date
    GROUP BY co.outflow_date
  ),
  daily AS (
    SELECT d.d_date,
           COALESCE(i.amt, 0) AS inc,
           COALESCE(e.amt, 0) AS exp
    FROM days d
    LEFT JOIN inc i ON i.d_date = d.d_date
    LEFT JOIN exp e ON e.d_date = d.d_date
  )
  SELECT d.d_date,
         d.inc,
         d.exp,
         v_sma,
         (d.inc - d.exp),
         (v_initial + SUM(d.inc - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC,
         (v_initial + SUM(v_sma - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC
  FROM daily d
  ORDER BY d.d_date ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE) TO authenticated;

-- ── get_projected_balance_summary: v_today BRT ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_projected_balance_summary(p_org_id uuid, p_projection_days integer)
 RETURNS TABLE(current_balance numeric, pessimistic_balance numeric, realistic_balance numeric, critical_date date, min_balance numeric, confirmed_income numeric, total_expenses numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today        DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
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
$function$;
