-- ============================================================
-- Phase 51: Painel de Tesouraria — alert_threshold + 3 RPCs
-- ============================================================
--
-- Blocos:
--   A) ADD COLUMN alert_threshold em financial_settings (idempotente, D-10, TESO-03)
--   B) get_treasury_panel(uuid) — 9 escalares + min_balance_date + alert_date (D-02..D-09b, TESO-04)
--   C) get_cost_by_month(uuid, int) — composicao de custos por mes+categoria (D-12)
--   D) get_supplier_exposure(uuid, int) — exposicao por fornecedor 30/60/90d (D-13)
--   E) REVOKE EXECUTE FROM PUBLIC, anon / GRANT TO authenticated — todas as 3 funcoes
--
-- Supabase project: ckcdevcxgvueywivefgx (NAO usar gionpsuunfkkzzjdubfy).
-- Aplicar via MCP apply_migration em ckcdevcxgvueywivefgx.
-- NUNCA usar `supabase db push` (CLI linkado ao projeto ERRADO gionpsuunfkkzzjdubfy).
-- ============================================================


-- ============================================================
-- BLOCO A: Coluna alert_threshold em financial_settings (D-10)
-- ============================================================
-- Idempotente: EXCEPTION WHEN duplicate_column THEN NULL.
-- Herda as policies SELECT/ALL existentes de financial_settings — sem nova policy.

DO $$ BEGIN
  ALTER TABLE public.financial_settings
    ADD COLUMN alert_threshold numeric NOT NULL DEFAULT 30000;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;


-- ============================================================
-- BLOCO B: get_treasury_panel(p_org_id uuid)
-- ============================================================
-- Retorna 1 linha com os 9 escalares do painel de tesouraria:
--   burn_rate, alert_threshold, alert_date, min_balance_date,
--   entrada_real_30d, saida_real_30d, fornec_30d, fornec_60d,
--   fornec_90d, total_exposicao
--
-- SECURITY INVOKER: a RLS org-first das tabelas faz o isolamento.
-- NUNCA usar SECURITY DEFINER com p_org_id como param — risco IDOR.
-- BRT timezone: (now() AT TIME ZONE 'America/Sao_Paulo')::date.
--
-- D-07 — Saida Real 30d: status='paid' (saida REALIZADA).
--   Empiricamente: na janela de 30d, paid == todos os status
--   (R$208.127,35 identico) pois contas pending tem outflow_date futuro.
-- D-08 — Burn Rate: SUM(amount, 90d passados) / 3.0 (todos status — run-rate de obrigacoes).
-- D-09 — Fornec 30/60/90d: CUMULATIVO (<= today+N), supplier IS NOT NULL, status='pending'.
-- D-09b — Total Exposicao: todas as contas a pagar pendentes a fornecedores, qualquer data.
-- D-05 — min_balance_date: dia do menor saldo projetado no horizonte 90d.
-- D-06 — alert_date: 1o dia em que o saldo projetado cruza abaixo de alert_threshold.
--   DISTINTO de min_balance_date (ver Pitfall 1 no RESEARCH — para Pe Vermeio
--   saldo nao fica negativo, mas cruza 30k em 23/06; logo critical_date do
--   get_projected_balance_summary seria NULL enquanto alert_date = 23/06).

CREATE OR REPLACE FUNCTION public.get_treasury_panel(p_org_id UUID)
RETURNS TABLE (
  burn_rate         NUMERIC,
  alert_threshold   NUMERIC,
  alert_date        DATE,
  min_balance_date  DATE,
  entrada_real_30d  NUMERIC,
  saida_real_30d    NUMERIC,
  fornec_30d        NUMERIC,
  fornec_60d        NUMERIC,
  fornec_90d        NUMERIC,
  total_exposicao   NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_today        DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_alert_thresh NUMERIC := 30000;
  v_initial      NUMERIC := 0;
  v_current      NUMERIC := 0;
  v_burn         NUMERIC := 0;
  v_entrada      NUMERIC := 0;
  v_saida        NUMERIC := 0;
  v_f30          NUMERIC := 0;
  v_f60          NUMERIC := 0;
  v_f90          NUMERIC := 0;
  v_total        NUMERIC := 0;
  v_alert_date   DATE    := NULL;
  v_min_bal_date DATE    := NULL;
  v_bal          NUMERIC;
  v_min_bal      NUMERIC;
  v_day_inc      NUMERIC;
  v_day_exp      NUMERIC;
  v_day          INT;
BEGIN
  -- alert_threshold e saldo inicial da org
  SELECT
    COALESCE(fs.alert_threshold, 30000),
    COALESCE(fs.initial_balance, 0)
  INTO v_alert_thresh, v_initial
  FROM financial_settings fs
  WHERE fs.organization_id = p_org_id
  LIMIT 1;

  -- Saldo atual (hoje BRT): initial_balance + entradas hoje - saidas hoje
  v_current := v_initial
    + COALESCE(
        (SELECT SUM(ci.net_amount)
         FROM cash_inflows ci
         WHERE ci.organization_id = p_org_id
           AND ci.release_date = v_today),
        0)
    - COALESCE(
        (SELECT SUM(co.amount)
         FROM cash_outflows co
         WHERE co.organization_id = p_org_id
           AND co.outflow_date = v_today),
        0);

  -- D-08 Burn Rate: media mensal das saidas dos ultimos 3 meses (90d / 3.0)
  -- Inclui todos os status (paid + pending) — run-rate de obrigacoes historicas
  SELECT COALESCE(SUM(co.amount), 0) / 3.0
  INTO v_burn
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date >= v_today - 90
    AND co.outflow_date <  v_today;

  -- D-07 Entrada Real 30d: cash_inflows realizados nos ultimos 30d
  SELECT COALESCE(SUM(ci.net_amount), 0)
  INTO v_entrada
  FROM cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date >= v_today - 30
    AND ci.release_date <= v_today;

  -- D-07 Saida Real 30d: apenas status='paid' (saida efetivamente realizada)
  SELECT COALESCE(SUM(co.amount), 0)
  INTO v_saida
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date >= v_today - 30
    AND co.outflow_date <= v_today
    AND co.status = 'paid';

  -- D-09 Fornec 30d: CUMULATIVO, pending, supplier IS NOT NULL, outflow_date <= today+30
  SELECT COALESCE(SUM(co.amount), 0)
  INTO v_f30
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.supplier IS NOT NULL
    AND co.status = 'pending'
    AND co.outflow_date <= v_today + 30;

  -- D-09 Fornec 60d: CUMULATIVO (inclui tudo ate +60d, ja inclui +30d)
  SELECT COALESCE(SUM(co.amount), 0)
  INTO v_f60
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.supplier IS NOT NULL
    AND co.status = 'pending'
    AND co.outflow_date <= v_today + 60;

  -- D-09 Fornec 90d: CUMULATIVO (inclui tudo ate +90d)
  SELECT COALESCE(SUM(co.amount), 0)
  INTO v_f90
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.supplier IS NOT NULL
    AND co.status = 'pending'
    AND co.outflow_date <= v_today + 90;

  -- D-09b Total Exposicao: TODAS as contas a pagar pendentes a fornecedores, qualquer data
  SELECT COALESCE(SUM(co.amount), 0)
  INTO v_total
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.supplier IS NOT NULL
    AND co.status = 'pending';

  -- D-05 + D-06: loop 90d projetando saldo para detectar
  --   alert_date  (1o dia v_bal < alert_threshold)
  --   min_balance_date (dia do menor saldo no horizonte)
  v_bal          := v_current;
  v_min_bal      := v_current;
  v_min_bal_date := v_today;   -- fallback: hoje se saldo so cai depois

  FOR v_day IN 1..90 LOOP
    SELECT COALESCE(SUM(ci.net_amount), 0)
    INTO v_day_inc
    FROM cash_inflows ci
    WHERE ci.organization_id = p_org_id
      AND ci.release_date = v_today + v_day;

    SELECT COALESCE(SUM(co.amount), 0)
    INTO v_day_exp
    FROM cash_outflows co
    WHERE co.organization_id = p_org_id
      AND co.outflow_date = v_today + v_day;

    v_bal := v_bal + v_day_inc - v_day_exp;

    -- D-06: primeiro dia abaixo do limite de alerta
    IF v_alert_date IS NULL AND v_bal < v_alert_thresh THEN
      v_alert_date := v_today + v_day;
    END IF;

    -- D-05: rastrear o menor saldo e sua data (arg-min)
    IF v_bal < v_min_bal THEN
      v_min_bal      := v_bal;
      v_min_bal_date := v_today + v_day;
    END IF;
  END LOOP;

  RETURN QUERY SELECT
    v_burn,
    v_alert_thresh,
    v_alert_date,
    v_min_bal_date,
    v_entrada,
    v_saida,
    v_f30,
    v_f60,
    v_f90,
    v_total;
END;
$$;


-- ============================================================
-- BLOCO C: get_cost_by_month(p_org_id uuid, p_months int)
-- ============================================================
-- Retorna composicao de custos por mes e categoria (formato long).
-- Frontend transforma em wide (pivot) para recharts stacked BarChart.
-- NULL/empty category → 'Outros' via COALESCE(NULLIF(TRIM(...),''),'Outros').
-- BRT: (now() AT TIME ZONE 'America/Sao_Paulo')::date inline (LANGUAGE sql, sem DECLARE).
-- Horizonte: p_months meses a partir do inicio do mes atual - (p_months-1) meses.

CREATE OR REPLACE FUNCTION public.get_cost_by_month(
  p_org_id UUID,
  p_months  INT DEFAULT 9
)
RETURNS TABLE (
  month    TEXT,
  category TEXT,
  total    NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = 'public'
AS $$
  SELECT
    TO_CHAR(co.outflow_date, 'YYYY-MM')                        AS month,
    COALESCE(NULLIF(TRIM(co.category), ''), 'Outros')          AS category,
    SUM(co.amount)                                             AS total
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date >= (
          DATE_TRUNC(
            'month',
            (now() AT TIME ZONE 'America/Sao_Paulo')::date
          ) - ((p_months - 1) || ' months')::INTERVAL
        )::date
  GROUP BY 1, 2
  ORDER BY 1, 3 DESC;
$$;


-- ============================================================
-- BLOCO D: get_supplier_exposure(p_org_id uuid, p_top_n int)
-- ============================================================
-- Retorna top-N fornecedores com exposicao cumulativa 30/60/90d.
-- Filtro: supplier IS NOT NULL, status='pending', outflow_date <= today+90.
-- Ordem: amount_90d DESC (maior exposicao total primeiro).
-- BRT timezone: v_today via (now() AT TIME ZONE 'America/Sao_Paulo')::date.

CREATE OR REPLACE FUNCTION public.get_supplier_exposure(
  p_org_id UUID,
  p_top_n  INT DEFAULT 10
)
RETURNS TABLE (
  supplier   TEXT,
  amount_30d NUMERIC,
  amount_60d NUMERIC,
  amount_90d NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  RETURN QUERY
  SELECT
    co.supplier,
    COALESCE(SUM(co.amount) FILTER (WHERE co.outflow_date <= v_today + 30), 0) AS amount_30d,
    COALESCE(SUM(co.amount) FILTER (WHERE co.outflow_date <= v_today + 60), 0) AS amount_60d,
    COALESCE(SUM(co.amount) FILTER (WHERE co.outflow_date <= v_today + 90), 0) AS amount_90d
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.supplier IS NOT NULL
    AND co.status = 'pending'
    AND co.outflow_date <= v_today + 90
  GROUP BY co.supplier
  ORDER BY COALESCE(SUM(co.amount) FILTER (WHERE co.outflow_date <= v_today + 90), 0) DESC
  LIMIT p_top_n;
END;
$$;


-- ============================================================
-- BLOCO E: REVOKE / GRANT — as 3 funcoes novas
-- ============================================================
-- Threat T-51-02: anon nao deve executar RPCs de agregacao financeira.
-- REVOKE EXECUTE FROM PUBLIC, anon (Postgres concede PUBLIC por padrao ao criar funcao).
-- GRANT EXECUTE TO authenticated (usuario logado pode chamar via /rest/v1/rpc).
-- Idempotente: REVOKE/GRANT podem rodar multiplas vezes sem erro.

REVOKE EXECUTE ON FUNCTION public.get_treasury_panel(UUID)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_cost_by_month(UUID, INT)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_supplier_exposure(UUID, INT) FROM PUBLIC, anon;

GRANT  EXECUTE ON FUNCTION public.get_treasury_panel(UUID)       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_cost_by_month(UUID, INT)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_supplier_exposure(UUID, INT) TO authenticated;
