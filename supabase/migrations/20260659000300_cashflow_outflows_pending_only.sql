-- ============================================================
-- Fluxo de Caixa — saídas só contam contas a pagar EM ABERTO (CASHFIX-04)
-- ============================================================
-- Decisão Wesley (2026-06-25): o caixa deve considerar SOMENTE contas a pagar
-- com status='pending' (em aberto). Fluxo dele mudou: em vez de pré-marcar tudo
-- como pago 1x/semana, ele dá baixa no Tiny no DIA em que cada pagamento ocorre.
-- Assim 'paid' = dinheiro que JÁ saiu (não entra na projeção futura) e 'pending'
-- = o que ainda vai sair. Antes a EXP somava todos os status, inflando a saída
-- (ex.: 05/07 mostrava R$36.707,80 incluindo um pró-labore R$10k já marcado pago;
-- o correto em aberto = R$26.707,80).
--
-- Única alteração vs 20260659000000: a CTE `exp` ganha `AND co.status = 'pending'`.
-- Tudo o mais preservado: regra de projeção 7d (accumulated_balance_sma + daily_projection),
-- data BRT, SECURITY INVOKER, REVOKE/GRANT.
-- Projeto: ckcdevcxgvueywivefgx.
-- ============================================================

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
  v_start := GREATEST(p_start_date, v_today);

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
    WHERE co.organization_id = p_org_id
      AND co.outflow_date BETWEEN v_start AND p_end_date
      AND co.status = 'pending'   -- CASHFIX-04: só contas a pagar EM ABERTO
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
         -- daily_projection: 0 nos dias 1-7 e nos dias com recebimento confirmado;
         -- v_sma apenas nos buracos futuros sem recebimento (a partir do 8º dia)
         (CASE
            WHEN d.d_date <= v_today + 7 THEN 0::NUMERIC
            WHEN d.inc > 0               THEN 0::NUMERIC
            ELSE v_sma
          END),
         (d.inc - d.exp),
         -- accumulated_balance: linha confirmada (inc real − saídas em aberto)
         (v_initial + SUM(d.inc - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC,
         -- accumulated_balance_sma: regra de projeção 7d (CASHFIX-01)
         (v_initial + SUM(
           (CASE
              WHEN d.d_date <= v_today + 7 THEN d.inc
              WHEN d.inc > 0               THEN d.inc
              ELSE v_sma
            END) - d.exp
         ) OVER (ORDER BY d.d_date ASC))::NUMERIC
  FROM daily d
  ORDER BY d.d_date ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE) TO authenticated;
