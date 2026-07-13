-- ============================================================
-- Phase 95 (Parte A) — get_cashflow / get_projected_balance_summary /
-- get_treasury_panel passam a derivar v_initial de get_rolled_opening_balance
-- ============================================================
-- Mudança cirúrgica: CREATE OR REPLACE das 3 funções, corpo copiado VERBATIM
-- da versão atual de cada uma (fontes abaixo), trocando SOMENTE a origem de
-- v_initial. Nenhuma assinatura pública muda, nenhuma outra linha de lógica
-- muda (projeção SMA, CASE de accumulated_balance_sma, daily_projection,
-- CTE `exp` com status='pending', toggle p_include_purchase_forecasts,
-- exposição por fornecedor, burn rate — tudo preservado).
--
-- Fontes do corpo ATUAL (lidas e copiadas verbatim, não reescritas):
--   - get_cashflow: supabase/migrations/20260660000000_cashflow_dfc_alignment.sql
--   - get_projected_balance_summary + get_treasury_panel:
--     supabase/migrations/20260660000200_cashflow_saldo_indicators_forecasts.sql
--
-- ANTES (repetido nas 3 — leitura direta de financial_settings.initial_balance):
--   v_initial := COALESCE((SELECT fs.initial_balance FROM financial_settings fs
--                           WHERE fs.organization_id = p_org_id LIMIT 1), 0);
-- DEPOIS:
--   v_initial := public.get_rolled_opening_balance(p_org_id);
--
-- get_treasury_panel é o caso especial: hoje lê fs.initial_balance E
-- fs.alert_threshold NA MESMA query (SELECT ... INTO v_alert_thresh, v_initial).
-- Aqui separamos: v_alert_thresh continua vindo de financial_settings (SELECT
-- direto, INALTERADO); v_initial passa a vir de get_rolled_opening_balance.
--
-- CTE `exp` de get_cashflow mantém status='pending' (série FUTURA — contas em
-- aberto ainda não pagas). Isto é INTENCIONALMENTE diferente do status='paid'
-- usado dentro de get_rolled_opening_balance (roll-forward do passado
-- âncora→hoje — dinheiro que JÁ SAIU). Ver Pitfall 5, 95-RESEARCH.md — os dois
-- filtros de status coexistem na mesma função por design, não é inconsistência.
--
-- Verificação de escopo (Assumption A3, 95-RESEARCH.md): rodei
--   grep -rn "initial_balance" supabase/migrations/
-- Achado: existe uma 4ª função que lê financial_settings.initial_balance
-- diretamente — get_daily_balance (última definição em
-- supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql),
-- ainda consumida pelo frontend em src/hooks/useTodayBalance.ts. Ela NÃO está
-- na lista travada por Wesley (get_cashflow / get_projected_balance_summary /
-- get_treasury_panel) e por isso fica FORA DE ESCOPO desta migration —
-- registrado no SUMMARY como risco/fora-de-escopo (não alterada aqui).
--
-- SEGURANÇA: as 3 funções continuam SECURITY INVOKER, sem checagem manual de
-- org — RLS is_org_member/get_org_role já é o guard (Pattern 1, RESEARCH).
--
-- Apply via MCP apply_migration no projeto ckcdevcxgvueywivefgx.
-- NUNCA `supabase db push` (sem token de CLI para este projeto).
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- get_cashflow — corpo verbatim de 20260660000000, só v_initial muda
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
      AND co.status = 'pending'   -- CASHFIX-04: só contas a pagar EM ABERTO (série futura;
                                   -- diferente do 'paid' usado no roll-forward de v_initial — Pitfall 5)
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
         -- EXPRESSÃO inalterada; só muda de valor porque v_initial agora vem
         -- do roll-forward em vez da leitura crua de initial_balance.
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

-- ───────────────────────────────────────────────────────────
-- get_projected_balance_summary — corpo verbatim de 20260660000200, só v_initial muda
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
-- get_treasury_panel — corpo verbatim de 20260660000200, só v_initial muda.
-- ATENÇÃO: a query original lê fs.initial_balance E fs.alert_threshold juntas
-- (SELECT ... INTO v_alert_thresh, v_initial). Separamos: v_alert_thresh
-- continua vindo do SELECT direto (inalterado); v_initial passa a vir de
-- get_rolled_opening_balance. Nenhuma outra leitura de initial_balance é
-- reintroduzida (Anti-Pattern do RESEARCH).
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
  -- alert_threshold continua vindo direto de financial_settings (inalterado).
  -- initial_balance NÃO é mais lido aqui: v_initial vem de get_rolled_opening_balance.
  SELECT COALESCE(fs.alert_threshold, 30000)
  INTO v_alert_thresh FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1;

  v_initial := public.get_rolled_opening_balance(p_org_id);

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
