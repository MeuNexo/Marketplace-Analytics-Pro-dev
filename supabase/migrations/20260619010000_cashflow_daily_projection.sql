-- ============================================================
-- Phase 49 — get_cashflow: expõe daily_projection (entrada média projetada/dia)
-- ============================================================
-- O tooltip do gráfico precisa mostrar a "+ Previsão" do dia (a entrada diária
-- projetada pela média 15d = v_sma), além das entradas/saídas reais e dos 2 saldos.
-- v_sma é constante por dia; retornamos como coluna daily_projection em cada linha.
-- Único delta vs 20260619000000: nova coluna no RETURNS TABLE + no SELECT final.
-- DROP+CREATE (assinatura muda). SECURITY INVOKER. Re-GRANT.
-- Supabase project: ckcdevcxgvueywivefgx.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_cashflow(UUID, DATE, DATE);

CREATE FUNCTION public.get_cashflow(
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
  v_start   DATE;
  v_sma     NUMERIC := 0;
BEGIN
  v_initial := COALESCE((SELECT fs.initial_balance FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1), 0);
  v_start := GREATEST(p_start_date, CURRENT_DATE);

  v_sma := COALESCE((
    SELECT SUM(o.receita_bruta - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0)) / 15.0
    FROM orders o
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND LEFT(o.data_pedido, 10)::date BETWEEN CURRENT_DATE - 15 AND CURRENT_DATE - 1
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
