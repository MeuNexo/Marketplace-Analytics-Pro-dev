-- ============================================================
-- Fluxo de Caixa — Alinhamento da DFC (Phase 60: CASHFIX-05 + CASHFIX-06)
-- ============================================================
-- Continuação da Phase 59. Duas correções LOCKED pelo Wesley para alinhar a
-- projeção do /caixa à DFC/Tiny (diagnóstico fechado com dados live):
--
-- CASHFIX-05 — ENTRADA vira piso (GREATEST):
--   O MP só agenda liberações ~30d à frente; a cauda (ex.: 09-20/07) tem
--   recebimentos confirmados MINÚSCULOS (R$56-785/dia). A regra da Phase 59 no
--   dia 8+ usava d.inc onde d.inc>0, deixando esses trocados SUPRIMIREM a média
--   de R$5.880/dia. Agora o dia 8+ usa GREATEST(d.inc, v_sma): a média vira PISO.
--   Dias com confirmado genuinamente maior mantêm o real (max, não soma). Dias
--   1-7 continuam confirmado-only (regra travada na Phase 59 — INTACTA).
--
-- CASHFIX-06 — Toggle de "Previsões de compra" (4º parâmetro):
--   cash_outflows inclui ordens de compra não faturadas (category='Previsões de
--   compra'). São previsões, não contas firmes. Novo parâmetro
--   p_include_purchase_forecasts BOOLEAN DEFAULT false: quando false (padrão), a
--   CTE exp exclui essas linhas → caixa bate ao centavo com o "contas a pagar" do
--   Tiny (reconciliação provada: 05-12/07 OFF=R$87.105,79; ON=R$99.495,58; a
--   diferença R$12.389,79 = OC 383 + OC 410). Excluir também resolve a OC 383
--   contada 2x (09/07 previsão + 11/07 conta real faturada).
--
-- Mudança de assinatura: era get_cashflow(UUID,DATE,DATE); passa a ter um 4º
-- arg com default. É preciso DROPar a versão de 3 args ANTES do CREATE, senão o
-- Postgres acusa "function is not unique" ao ser chamada com 3 args.
--
-- NÃO alterado: a EXPRESSÃO de accumulated_balance (linha confirmada, window
-- v_initial + SUM(d.inc - d.exp)). Ela muda de VALOR só porque a CTE exp agora
-- exclui previsões — comportamento desejado (previsão não é caixa real).
--
-- Projeto: ckcdevcxgvueywivefgx.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_cashflow(UUID,DATE,DATE);

CREATE OR REPLACE FUNCTION public.get_cashflow(
  p_org_id UUID, p_start_date DATE, p_end_date DATE,
  p_include_purchase_forecasts BOOLEAN DEFAULT false
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
      -- CASHFIX-06: por padrão exclui ordens de compra não faturadas (previsões);
      -- toggle ON (p_include_purchase_forecasts=true) volta a somá-las.
      AND (p_include_purchase_forecasts OR COALESCE(co.category, '') <> 'Previsões de compra')
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
         -- daily_projection: 0 nos dias 1-7; do 8º dia em diante, o quanto a
         -- média (piso) acrescenta acima do confirmado (CASHFIX-05).
         (CASE
            WHEN d.d_date <= v_today + 7 THEN 0::NUMERIC
            ELSE GREATEST(0, v_sma - d.inc)::NUMERIC
          END),
         (d.inc - d.exp),
         -- accumulated_balance: linha confirmada (inc real − saídas em aberto).
         -- EXPRESSÃO inalterada; só muda de valor porque exp agora exclui previsões.
         (v_initial + SUM(d.inc - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC,
         -- accumulated_balance_sma: projeção com a média como PISO (CASHFIX-05)
         -- dias 1-7: confirmado-only (d.inc), regra travada na Phase 59 — INTACTA
         -- dia 8+: GREATEST(d.inc, v_sma) — a média de 15d vira piso
         (v_initial + SUM(
           (CASE
              WHEN d.d_date <= v_today + 7 THEN d.inc
              ELSE GREATEST(d.inc, v_sma)
            END) - d.exp
         ) OVER (ORDER BY d.d_date ASC))::NUMERIC
  FROM daily d
  ORDER BY d.d_date ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE,BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE,BOOLEAN) TO authenticated;
