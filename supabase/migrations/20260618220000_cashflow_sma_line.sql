-- ============================================================
-- Phase 49 — get_cashflow: 2ª linha "Projeção média 15d" (SMA)
-- ============================================================
-- Wesley quer uma segunda linha no gráfico além do saldo projetado
-- confirmado: o cenário "se eu mantiver a média de recebimento dos
-- últimos 15 dias". Adiciona a coluna accumulated_balance_sma.
--
--   v_sma = média diária de cash_inflows.net_amount dos últimos 15 dias
--           (CURRENT_DATE-15 .. CURRENT_DATE-1, dividido por 15).
--   accumulated_balance     = initial + Σ (entrada_confirmada - saída)   [pessimista/confirmado]
--   accumulated_balance_sma = initial + Σ (v_sma            - saída)      [realista/média 15d]
--
-- Série agora gerada por generate_series (1 ponto por dia-calendário) para
-- que a SMA acumule por dia, não só em dias com evento. Saídas = qualquer
-- status (mantém fix da migration 20260618210000). Futuro-only via v_start.
--
-- Muda RETURNS TABLE → DROP + CREATE. SECURITY INVOKER. Re-aplica GRANTs.
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
  v_start := GREATEST(p_start_date, CURRENT_DATE);  -- futuro-only

  -- média diária de entrada dos últimos 15 dias (corridos)
  v_sma := COALESCE((
    SELECT SUM(ci.net_amount) / 15.0
    FROM cash_inflows ci
    WHERE ci.organization_id = p_org_id
      AND ci.release_date BETWEEN CURRENT_DATE - 15 AND CURRENT_DATE - 1
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
         (d.inc - d.exp),
         (v_initial + SUM(d.inc   - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC,
         (v_initial + SUM(v_sma   - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC
  FROM daily d
  ORDER BY d.d_date ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE) TO authenticated;
