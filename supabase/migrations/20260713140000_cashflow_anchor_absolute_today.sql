-- ============================================================
-- Phase 95 (fecho / gap-closure) — âncora é o saldo ABSOLUTO de hoje
-- ============================================================
-- Decisão do Wesley (2026-07-13): quando ele ajusta o saldo, o valor digitado é
-- o saldo REAL de hoje — já reflete tudo que entrou/saiu hoje (as contas que ele
-- já pagou hoje já saíram da conta; os recebíveis que já caíram já estão lá).
-- O sistema NÃO pode, em cima desse número, re-aplicar os movimentos do próprio
-- dia. Fazia isso e gerava desconto/soma em dobro:
--   card "saldo de hoje" = v_initial + entradas_hoje − saídas_hoje(TODOS status,
--   inclusive PAGAS) → subtraía de novo contas já pagas embutidas no saldo.
--   (ex. Pé Vermeio 13/07: digitaria −1.495,45; card mostrava −8.667,24 porque
--    re-abatia R$8.375,40 de contas JÁ pagas hoje.)
--
-- Regra nova (travada por Wesley — opção "hoje = exatamente meu número"):
--   • O ponto de HOJE (dia da consulta = início da curva, sempre >= hoje via
--     GREATEST) = v_initial cru (o saldo âncora rolado). Nada de hoje re-aplicado.
--   • A projeção acumula fluxos SOMENTE de amanhã pra frente (d_date > hoje).
--   • Vale para os 3 consumidores: get_cashflow (linha acumulada),
--     get_projected_balance_summary (current_balance) e get_treasury_panel
--     (v_current base da projeção).
--
-- Escopo: mudança cirúrgica. As barras diárias (daily_income/daily_expense) e
-- todo o resto do corpo permanecem verbatim de 20260713000100 (Phase 95). Só a
-- ORIGEM do "saldo de hoje" e a JANELA de acumulação mudam. Assinaturas públicas
-- idênticas — nenhuma mudança de frontend.
--
-- Nota: isto SUPERSEDE a não-regressão "âncora=hoje → curva idêntica à anterior"
-- da Phase 95 — é uma mudança de comportamento PEDIDA pelo Wesley (o comportamento
-- antigo estava errado: re-abatia contas pagas). A forma da projeção futura
-- (deltas dia-a-dia de amanhã em diante) fica inalterada; só o ponto-base de hoje
-- passa a ser o saldo absoluto.
--
-- SECURITY INVOKER em todas (sem checagem manual de org — RLS is_org_member).
-- Apply via MCP apply_migration no projeto ckcdevcxgvueywivefgx.
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- get_cashflow — acumulação só de amanhã (d_date > hoje); hoje = v_initial cru
-- ───────────────────────────────────────────────────────────
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
  v_initial := public.get_rolled_opening_balance(p_org_id);
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
      AND co.status = 'pending'
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
         (CASE
            WHEN d.d_date <= v_today + 7 THEN 0::NUMERIC
            ELSE GREATEST(0, v_sma - d.inc)::NUMERIC
          END),
         (d.inc - d.exp),
         -- accumulated_balance: HOJE = v_initial cru (saldo absoluto); acumula
         -- líquido só de amanhã em diante (d_date > hoje). Contas pagas/recebíveis
         -- de hoje NÃO re-aplicados (já estão embutidos na âncora). — Wesley 07-13
         (v_initial + SUM(
            CASE WHEN d.d_date > v_today THEN (d.inc - d.exp) ELSE 0 END
          ) OVER (ORDER BY d.d_date ASC))::NUMERIC,
         -- accumulated_balance_sma: mesma regra; hoje = v_initial; projeção com a
         -- média como piso (dias 1-7 confirmado; dia 8+ GREATEST) só de amanhã.
         (v_initial + SUM(
            CASE WHEN d.d_date > v_today
                 THEN (CASE
                         WHEN d.d_date <= v_today + 7 THEN d.inc
                         ELSE GREATEST(d.inc, v_sma)
                       END) - d.exp
                 ELSE 0 END
          ) OVER (ORDER BY d.d_date ASC))::NUMERIC
  FROM daily d
  ORDER BY d.d_date ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE,BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE,BOOLEAN) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- get_projected_balance_summary — current_balance = v_initial (absoluto)
-- ───────────────────────────────────────────────────────────
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
  v_initial := public.get_rolled_opening_balance(p_org_id);
  -- current_balance = saldo ABSOLUTO de hoje (a âncora). NÃO re-aplica entradas
  -- nem saídas de hoje — já estão embutidas no saldo digitado. — Wesley 07-13
  v_current := v_initial;
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
-- get_treasury_panel — v_current = v_initial (absoluto); resto inalterado
-- ───────────────────────────────────────────────────────────
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
  SELECT COALESCE(fs.alert_threshold, 30000)
  INTO v_alert_thresh FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1;

  v_initial := public.get_rolled_opening_balance(p_org_id);

  -- v_current = saldo ABSOLUTO de hoje (âncora). Base da projeção que segue de
  -- amanhã em diante. NÃO re-aplica movimentos de hoje. — Wesley 07-13
  v_current := v_initial;

  SELECT COALESCE(SUM(co.amount),0)/3.0 INTO v_burn FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.outflow_date >= v_today - 90 AND co.outflow_date < v_today AND co.status='paid';
  SELECT COALESCE(SUM(ci.net_amount),0) INTO v_entrada FROM cash_inflows ci
   WHERE ci.organization_id=p_org_id AND ci.release_date >= v_today - 30 AND ci.release_date <= v_today;
  SELECT COALESCE(SUM(co.amount),0) INTO v_saida FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.outflow_date >= v_today - 30 AND co.outflow_date <= v_today AND co.status='paid';

  SELECT COALESCE(SUM(co.amount),0) INTO v_f30 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending' AND co.outflow_date <= v_today + 30;
  SELECT COALESCE(SUM(co.amount),0) INTO v_f60 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending' AND co.outflow_date <= v_today + 60;
  SELECT COALESCE(SUM(co.amount),0) INTO v_f90 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending' AND co.outflow_date <= v_today + 90;
  SELECT COALESCE(SUM(co.amount),0) INTO v_total FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending';

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
