-- ============================================================
-- Fluxo de Caixa — Regra de projeção 7d (CASHFIX-01)
-- ============================================================
-- Bug: accumulated_balance_sma usava v_sma (média 15d) em TODOS os dias,
-- incluindo os primeiros 7 dias onde os recebimentos do MP já estão
-- confirmados em cash_inflows. Isso inflava a linha âmbar no curto prazo
-- porque a venda de hoje só vira caixa ~14d depois e já está em d.inc.
--
-- Fix (duas alterações cirúrgicas):
--   1. accumulated_balance_sma: CASE que usa d.inc nos dias 1-7 e nos dias
--      com recebimento (d.inc > 0); v_sma apenas nos buracos futuros (d.inc = 0)
--      a partir do 8º dia. d.exp subtraído por fora, window function preservada.
--   2. daily_projection: CASE que retorna 0 nos dias 1-7 e nos dias com
--      recebimento (consistência entre tooltip e linha âmbar).
--
-- NÃO alterado: accumulated_balance (janela cumulativa de inc-exp) — linha confirmada
-- verde reconciliada ao centavo com a DFC do Wesley (Phase 49). Aparece exatamente
-- 1 vez nesta migration, inalterada.
--
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
         -- daily_projection: 0 nos dias 1-7 e nos dias com recebimento confirmado;
         -- v_sma apenas nos buracos futuros sem recebimento (a partir do 8º dia)
         (CASE
            WHEN d.d_date <= v_today + 7 THEN 0::NUMERIC
            WHEN d.inc > 0               THEN 0::NUMERIC
            ELSE v_sma
          END),
         (d.inc - d.exp),
         -- accumulated_balance: INTOCADO — reconciliado ao centavo com a DFC do Wesley
         (v_initial + SUM(d.inc - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC,
         -- accumulated_balance_sma: regra de projeção 7d (CASHFIX-01)
         -- dias 1-7: usa só o confirmado (d.inc), sem previsão/média
         -- dia 8+ COM recebimento (d.inc > 0): usa o real
         -- dia 8+ SEM recebimento (d.inc = 0): preenche com média 15d (v_sma)
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
