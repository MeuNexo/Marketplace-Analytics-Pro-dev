-- ============================================================
-- Phase 49 Fluxo de Caixa — RPCs de cálculo de caixa real
-- ============================================================
--
-- Cria 3 funções SQL:
--
--   1. get_cashflow(p_org_id, p_start_date, p_end_date)
--      Série diária com saldo acumulado real (window function SUM OVER ORDER BY date).
--      Lê: cash_inflows (release_date) + cash_outflows (outflow_date) + financial_settings.
--      Sem LIMIT — evita truncamento PostgREST (Armadilha 2 do RESEARCH).
--
--   2. get_daily_balance(p_org_id, p_target_date)
--      Saldo do dia: saldo_inicial (acumulado até ontem) + entradas_hoje + saidas_hoje
--      + saldo_final_previsto. Retorna 1 linha por chamada.
--
--   3. get_projected_balance_summary(p_org_id, p_projection_days)
--      Projeção SMA: SMA = média dos últimos 15 dias de receita_bruta de `orders`
--      por organization_id (NÃO ml_daily_cache — scoped por user_id, Armadilha cross-org).
--      SMA ativa somente após dia 8 da projeção: max(0, dia - 8) dias com receita prevista.
--      Detecta critical_date (primeiro dia com saldo < 0) e min_balance.
--
-- SEGURANÇA (CRÍTICO — regra de projeto):
--   TODAS as funções são SECURITY INVOKER.
--   DEFINER + p_org_id por parâmetro = IDOR: caller poderia passar qualquer org_id e
--   obter dados de outra organização, bypassando o RLS completamente.
--   INVOKER preserva o contexto do caller e o RLS de cash_inflows/cash_outflows/orders
--   (is_org_member) filtra apenas os dados da org do caller — guard real.
--   Referência: feedback_supabase_security_invoker.md (memória do projeto).
--
-- BOUNDARY DE DATAS:
--   cash_inflows.release_date e cash_outflows.outflow_date são tipo DATE (sem timezone).
--   Comparações simples (=, <, BETWEEN) são seguras — sem conversão.
--   orders.data_pedido é TIMESTAMPTZ → usar < (p_today + 1) nunca <= string só-data.
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION.
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- ============================================================


-- ============================================================
-- RPC 1: get_cashflow
-- ============================================================
-- Retorna série diária com saldo acumulado real.
--
-- Lógica:
--   1. Busca initial_balance de financial_settings da org (default 0).
--   2. Calcula v_previous_balance = Σ entradas antes de p_start_date - Σ saídas antes.
--   3. CTE daily_data: UNION ALL de entradas (cash_inflows.release_date) e saídas
--      (cash_outflows.outflow_date), agrupado por dia.
--      d_balance = d_income - d_expense EXPLÍCITO (Armadilha 5 do RESEARCH:
--      diferente do nexointeligence onde amount é signed na mesma coluna).
--   4. Window function: accumulated_balance = v_initial + v_previous + SUM(d_balance)
--      OVER (ORDER BY d_date ASC) — acumulado crescente por dia.
--
-- Sem LIMIT — conjunto completo sem truncamento PostgREST.
-- Coluna outflow_date (não due_date — renomeada no 49-01 CASH-02).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_cashflow(
  p_org_id     UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE (
  date                DATE,
  daily_income        NUMERIC,
  daily_expense       NUMERIC,
  daily_balance       NUMERIC,
  accumulated_balance NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER          -- NUNCA DEFINER (DEFINER + p_org_id = IDOR crítico)
SET search_path = 'public'
AS $$
DECLARE
  v_initial_balance  NUMERIC := 0;
  v_previous_balance NUMERIC := 0;
BEGIN
  -- 1. Saldo inicial configurado pela org (parâmetro financeiro)
  SELECT COALESCE(fs.initial_balance, 0) INTO v_initial_balance
  FROM financial_settings fs
  WHERE fs.organization_id = p_org_id
  LIMIT 1;

  -- 2. Entradas acumuladas anteriores ao período solicitado
  SELECT COALESCE(SUM(ci.net_amount), 0) INTO v_previous_balance
  FROM cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date < p_start_date;

  -- Subtrair saídas anteriores ao período (outflow_date — coluna renomeada no 49-01)
  v_previous_balance := v_previous_balance - (
    SELECT COALESCE(SUM(co.amount), 0)
    FROM cash_outflows co
    WHERE co.organization_id = p_org_id
      AND co.outflow_date < p_start_date
  );

  -- 3. Série diária com acumulado via window function
  RETURN QUERY
  WITH daily_data AS (
    SELECT
      raw.d_date,
      COALESCE(SUM(raw.d_income), 0)  AS d_income,
      COALESCE(SUM(raw.d_expense), 0) AS d_expense,
      -- d_balance EXPLÍCITO: tabelas separadas (não signed amount como no nexointeligence)
      COALESCE(SUM(raw.d_income), 0) - COALESCE(SUM(raw.d_expense), 0) AS d_balance
    FROM (
      -- Entradas: liberações Mercado Pago ingeridas pela EF sync-mp-releases
      SELECT
        ci.release_date AS d_date,
        ci.net_amount   AS d_income,
        0               AS d_expense
      FROM cash_inflows ci
      WHERE ci.organization_id = p_org_id
        AND ci.release_date BETWEEN p_start_date AND p_end_date

      UNION ALL

      -- Saídas: contas a pagar do Tiny ingeridas pela EF sync-tiny-payables
      -- outflow_date = data efetiva da saída (pagamento ou vencimento)
      SELECT
        co.outflow_date AS d_date,
        0               AS d_income,
        co.amount       AS d_expense
      FROM cash_outflows co
      WHERE co.organization_id = p_org_id
        AND co.outflow_date BETWEEN p_start_date AND p_end_date
    ) raw
    GROUP BY raw.d_date
  )
  SELECT
    dd.d_date                                                           AS date,
    dd.d_income                                                         AS daily_income,
    dd.d_expense                                                        AS daily_expense,
    dd.d_balance                                                        AS daily_balance,
    -- Saldo acumulado: inicial + prévio + soma crescente do período
    (v_initial_balance + v_previous_balance
     + SUM(dd.d_balance) OVER (ORDER BY dd.d_date ASC))::NUMERIC      AS accumulated_balance
  FROM daily_data dd
  ORDER BY dd.d_date ASC;
END;
$$;


-- ============================================================
-- RPC 2: get_daily_balance
-- ============================================================
-- Retorna o resumo de caixa do dia para o card "Caixa Hoje".
-- 1 linha por chamada: saldo_inicial, entradas_hoje, saidas_hoje, saldo_final_previsto.
--
-- saldo_inicial = initial_balance + Σ entradas (release_date < p_target_date)
--                - Σ saídas (outflow_date < p_target_date)
-- saldo_final_previsto = saldo_inicial + entradas_hoje - saidas_hoje
--
-- Coluna outflow_date (não due_date — renomeada no 49-01).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_daily_balance(
  p_org_id      UUID,
  p_target_date DATE
)
RETURNS TABLE (
  saldo_inicial         NUMERIC,
  entradas_hoje         NUMERIC,
  saidas_hoje           NUMERIC,
  saldo_final_previsto  NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER          -- NUNCA DEFINER (DEFINER + p_org_id = IDOR crítico)
SET search_path = 'public'
AS $$
DECLARE
  v_initial_balance NUMERIC;
  v_saldo_inicial   NUMERIC;
  v_entradas        NUMERIC;
  v_saidas          NUMERIC;
BEGIN
  -- Saldo inicial configurado pela org
  SELECT COALESCE(fs.initial_balance, 0) INTO v_initial_balance
  FROM financial_settings fs
  WHERE fs.organization_id = p_org_id
  LIMIT 1;

  -- Saldo acumulado até ontem: entradas realizadas antes de hoje
  SELECT COALESCE(SUM(ci.net_amount), 0) INTO v_saldo_inicial
  FROM cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date < p_target_date;

  -- Subtrair saídas realizadas antes de hoje (outflow_date — coluna renomeada no 49-01)
  v_saldo_inicial := v_initial_balance + v_saldo_inicial - (
    SELECT COALESCE(SUM(co.amount), 0)
    FROM cash_outflows co
    WHERE co.organization_id = p_org_id
      AND co.outflow_date < p_target_date
  );

  -- Entradas de hoje
  SELECT COALESCE(SUM(ci.net_amount), 0) INTO v_entradas
  FROM cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date = p_target_date;

  -- Saídas de hoje (outflow_date — coluna renomeada no 49-01)
  SELECT COALESCE(SUM(co.amount), 0) INTO v_saidas
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date = p_target_date;

  RETURN QUERY
  SELECT
    v_saldo_inicial,
    v_entradas,
    v_saidas,
    v_saldo_inicial + v_entradas - v_saidas;
END;
$$;


-- ============================================================
-- RPC 3: get_projected_balance_summary
-- ============================================================
-- Retorna projeção de caixa para o card "Projeção Futura".
--
-- Lógica:
--   1. Saldo atual via get_daily_balance(p_org_id, today).
--   2. SMA de vendas = Σ receita_bruta de orders (últimos 15 dias) ÷ 15.
--      FONTE: tabela `orders` por organization_id (NÃO ml_daily_cache.approved_revenue,
--      que é scoped por user_id — causaria mismatch cross-conta/loja, ver RESEARCH A3/A5).
--      BOUNDARY: orders.data_pedido é TIMESTAMPTZ → comparar com < (hoje + 1 dia),
--      nunca com <= string só-data (Armadilha 3 do RESEARCH / feedback_timestamptz_date_filter).
--   3. Custo operacional = operational_cost_rate de financial_settings (default 0.22).
--      daily_income_projection = daily_sma × (1 - operational_cost_rate)
--      ATIVA SOMENTE após dia 8 da projeção: max(0, dia_numero - 8) dias com receita.
--      Racionale: liberações MP D+14; apenas após 8 dias a projeção tem base estatística.
--   4. Saídas projetadas = cash_outflows com outflow_date no período de projeção.
--   5. Loop dia a dia acumulando saldo projetado:
--      pessimistic (sem SMA) e realistic (com SMA).
--      critical_date = primeiro dia em que o saldo realístico < 0.
--      min_balance = mínimo do saldo realístico no período.
--
-- Retorno:
--   current_balance      — saldo atual (get_daily_balance, pessimistic)
--   pessimistic_balance  — saldo final sem nenhuma receita projetada
--   realistic_balance    — saldo final com SMA
--   critical_date        — data em que o saldo realístico fica negativo (NULL se não ocorrer)
--   min_balance          — menor saldo realístico no período de projeção
--   confirmed_income     — Σ entradas confirmadas nos próximos 30 dias
--   total_expenses       — Σ saídas projetadas (outflow_date) nos próximos 30 dias
--
-- Sem LIMIT — loop a dia inteiro conforme p_projection_days.
-- SECURITY INVOKER — RLS de orders/cash_outflows é o guard real (evita IDOR).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_projected_balance_summary(
  p_org_id          UUID,
  p_projection_days INT
)
RETURNS TABLE (
  current_balance     NUMERIC,
  pessimistic_balance NUMERIC,
  realistic_balance   NUMERIC,
  critical_date       DATE,
  min_balance         NUMERIC,
  confirmed_income    NUMERIC,
  total_expenses      NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER          -- NUNCA DEFINER (DEFINER + p_org_id = IDOR crítico)
SET search_path = 'public'
AS $$
DECLARE
  v_today                DATE    := CURRENT_DATE;
  v_initial_balance      NUMERIC := 0;
  v_cost_rate            NUMERIC := 0.22;
  v_current_balance      NUMERIC := 0;
  v_daily_sma            NUMERIC := 0;
  v_daily_sma_net        NUMERIC := 0;   -- SMA × (1 - operational_cost_rate)
  v_pessimistic          NUMERIC := 0;
  v_realistic            NUMERIC := 0;
  v_critical_date        DATE    := NULL;
  v_min_balance          NUMERIC := 0;
  v_confirmed_income     NUMERIC := 0;
  v_total_expenses       NUMERIC := 0;
  v_day_num              INT;
  v_day_date             DATE;
  v_day_expenses         NUMERIC;
  v_day_income_proj      NUMERIC;
  v_first                BOOLEAN := TRUE;
BEGIN
  -- 1. Parâmetros financeiros da org
  SELECT
    COALESCE(fs.initial_balance, 0),
    COALESCE(fs.operational_cost_rate::NUMERIC, 0.22)
  INTO v_initial_balance, v_cost_rate
  FROM financial_settings fs
  WHERE fs.organization_id = p_org_id
  LIMIT 1;

  -- 2. Saldo atual (acumulado até hoje inclusive)
  SELECT
    COALESCE(fb.saldo_inicial, 0) + COALESCE(fb.entradas_hoje, 0) - COALESCE(fb.saidas_hoje, 0)
  INTO v_current_balance
  FROM get_daily_balance(p_org_id, v_today) fb;

  v_pessimistic := v_current_balance;
  v_realistic   := v_current_balance;
  v_min_balance := v_current_balance;

  -- 3. SMA de receita dos últimos 15 dias via tabela orders por organization_id.
  --    FONTE CORRETA: orders.receita_bruta agregado por organization_id.
  --    NÃO usar ml_daily_cache.approved_revenue — scoped por user_id (vaza dados cross-conta).
  --    BOUNDARY: data_pedido é TIMESTAMPTZ → comparar com < v_today (não <= string só-data).
  --    Janela: [v_today - 15 dias, v_today) — 15 dias completos antes de hoje.
  SELECT
    COALESCE(SUM(o.receita_bruta), 0) / 15.0
  INTO v_daily_sma
  FROM public.orders o
  WHERE o.organization_id = p_org_id
    AND o.status IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::timestamptz >= (v_today - INTERVAL '15 days')
    AND o.data_pedido::timestamptz <  (v_today::TIMESTAMPTZ + INTERVAL '1 day');

  -- SMA líquida: descontar taxa de custo operacional
  v_daily_sma_net := v_daily_sma * (1.0 - v_cost_rate);

  -- 4. Entradas confirmadas nos próximos 30 dias (liberações já agendadas no MP)
  SELECT COALESCE(SUM(ci.net_amount), 0) INTO v_confirmed_income
  FROM cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date > v_today
    AND ci.release_date <= v_today + 30;

  -- 5. Saídas projetadas nos próximos 30 dias (outflow_date — renomeada no 49-01)
  SELECT COALESCE(SUM(co.amount), 0) INTO v_total_expenses
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date > v_today
    AND co.outflow_date <= v_today + 30;

  -- 6. Loop dia a dia para detectar critical_date e min_balance
  FOR v_day_num IN 1..p_projection_days LOOP
    v_day_date := v_today + v_day_num;

    -- Saídas confirmadas para este dia (outflow_date — renomeada no 49-01)
    SELECT COALESCE(SUM(co.amount), 0) INTO v_day_expenses
    FROM cash_outflows co
    WHERE co.organization_id = p_org_id
      AND co.outflow_date = v_day_date;

    -- Projeção realista: SMA ativa apenas após dia 8 (liberações MP D+8 a D+14)
    -- max(0, dia_numero - 8) garante 0 receita projetada nos primeiros 8 dias
    v_day_income_proj := v_daily_sma_net * GREATEST(0, v_day_num - 8);
    -- Limitar a 1 dia de SMA (cada dia projeta apenas 1 dia de receita média)
    v_day_income_proj := v_daily_sma_net * CASE WHEN v_day_num > 8 THEN 1 ELSE 0 END;

    -- Atualizar saldos projetados
    v_pessimistic := v_pessimistic - v_day_expenses;
    v_realistic   := v_realistic   + v_day_income_proj - v_day_expenses;

    -- Detectar critical_date: primeiro dia em que o saldo realístico fica < 0
    IF v_critical_date IS NULL AND v_realistic < 0 THEN
      v_critical_date := v_day_date;
    END IF;

    -- Rastrear menor saldo realístico
    IF v_first OR v_realistic < v_min_balance THEN
      v_min_balance := v_realistic;
      v_first       := FALSE;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    v_current_balance,
    v_pessimistic,
    v_realistic,
    v_critical_date,
    v_min_balance,
    v_confirmed_income,
    v_total_expenses;
END;
$$;


-- ============================================================
-- Controle de acesso: REVOKE PUBLIC + GRANT authenticated
-- ============================================================
--
-- PostgreSQL concede EXECUTE a PUBLIC por padrão ao criar uma função.
-- Para RPCs SECURITY INVOKER que expõem dados de tenant, isso significa
-- que qualquer usuário anônimo pode invocar via /rest/v1/rpc passando
-- p_org_id arbitrário — vazamento de dados se RLS não estiver perfeito.
-- Melhor prática: revogar PUBLIC e conceder apenas a authenticated.
--
-- Threat T-49-02-02: EXECUTE público das RPCs → REVOKE FROM PUBLIC + GRANT a authenticated.
-- Referência: 20260645011000_consultor_rpcs_revoke_public_execute.sql
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID, DATE, DATE)
  FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.get_daily_balance(UUID, DATE)
  FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.get_projected_balance_summary(UUID, INT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_cashflow(UUID, DATE, DATE)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_daily_balance(UUID, DATE)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_projected_balance_summary(UUID, INT)
  TO authenticated;
