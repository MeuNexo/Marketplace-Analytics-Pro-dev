-- ============================================================
-- Phase 51 — fechamento (code review) — fixes CR-01, HG-01, HG-03
-- Aplicado em prod ckcdevcxgvueywivefgx via MCP apply_migration:
--   treasury_fix_cr01_enrich_drain_security
--   treasury_fix_hg01_hg03_panel
-- Este arquivo consolida o estado final no repo (regra de drift).
-- ============================================================

-- ── CR-01: enrich_drain — token por org da fila (multi-tenant) + REVOKE ──
-- Antes: token hardcoded ml_user_id='1639558873' (vaza cross-conta quando uma
-- 2a loja conectar Tiny) e EXECUTE concedido a PUBLIC/anon/authenticated
-- (procedure DEFINER nao deve ser disparavel por usuario). Crons mantidos
-- (enriquecem contas Tiny futuras; fila vazia = no-op barato).

CREATE OR REPLACE PROCEDURE public.enrich_drain(p_limit int DEFAULT 50, p_sleep numeric DEFAULT 1.0)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_token text;
  r       record;
  v_req   bigint;
BEGIN
  FOR r IN SELECT q.tiny_payable_id, q.ml_user_id
           FROM public.cat_backfill_queue q
           WHERE q.status='todo' ORDER BY q.updated_at LIMIT p_limit LOOP
    SELECT tiny_access_token INTO v_token
    FROM public.ml_tokens WHERE ml_user_id = r.ml_user_id LIMIT 1;

    IF v_token IS NULL THEN
      UPDATE public.cat_backfill_queue
        SET status='error', updated_at=now()
        WHERE tiny_payable_id=r.tiny_payable_id;
      CONTINUE;
    END IF;

    v_req := net.http_get(
      url := 'https://api.tiny.com.br/public-api/v3/contas-pagar/' || r.tiny_payable_id,
      headers := jsonb_build_object('Authorization','Bearer '||v_token,'Accept','application/json')
    );
    UPDATE public.cat_backfill_queue
      SET status='sent', req_id=v_req, attempts=attempts+1, updated_at=now()
      WHERE tiny_payable_id=r.tiny_payable_id;
    COMMIT;
    PERFORM pg_sleep(p_sleep);
  END LOOP;
END $$;

REVOKE EXECUTE ON PROCEDURE public.enrich_drain(int, numeric) FROM PUBLIC, anon, authenticated;


-- ── HG-01 + HG-03: get_treasury_panel ──
-- HG-01: horizonte de projecao 30d (default) — onde ha receita confirmada; o card
--        "Saldo Min 30d" usa min_balance (VALOR) + min_balance_date (DATA), ambos do
--        MESMO modelo/horizonte (antes valor vinha de get_projected_balance_summary).
-- HG-03: burn_rate = apenas status='paid' (caixa efetivamente saído), consistente
--        com saida_real_30d. Decisao Wesley 2026-06-20.

DROP FUNCTION IF EXISTS public.get_treasury_panel(uuid);

CREATE OR REPLACE FUNCTION public.get_treasury_panel(p_org_id UUID, p_horizon INT DEFAULT 30)
RETURNS TABLE (
  burn_rate         NUMERIC,
  alert_threshold   NUMERIC,
  alert_date        DATE,
  min_balance_date  DATE,
  min_balance       NUMERIC,
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
  v_f30 NUMERIC := 0; v_f60 NUMERIC := 0; v_f90 NUMERIC := 0; v_total NUMERIC := 0;
  v_alert_date   DATE    := NULL;
  v_min_bal_date DATE    := NULL;
  v_bal NUMERIC; v_min_bal NUMERIC; v_day_inc NUMERIC; v_day_exp NUMERIC; v_day INT;
BEGIN
  SELECT COALESCE(fs.alert_threshold, 30000), COALESCE(fs.initial_balance, 0)
  INTO v_alert_thresh, v_initial
  FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1;

  v_current := v_initial
    + COALESCE((SELECT SUM(ci.net_amount) FROM cash_inflows ci
                WHERE ci.organization_id=p_org_id AND ci.release_date=v_today),0)
    - COALESCE((SELECT SUM(co.amount) FROM cash_outflows co
                WHERE co.organization_id=p_org_id AND co.outflow_date=v_today),0);

  -- HG-03: burn = media mensal das saidas PAGAS dos ultimos 3 meses
  SELECT COALESCE(SUM(co.amount),0)/3.0 INTO v_burn
  FROM cash_outflows co
  WHERE co.organization_id=p_org_id
    AND co.outflow_date >= v_today - 90 AND co.outflow_date < v_today
    AND co.status='paid';

  SELECT COALESCE(SUM(ci.net_amount),0) INTO v_entrada
  FROM cash_inflows ci
  WHERE ci.organization_id=p_org_id
    AND ci.release_date >= v_today - 30 AND ci.release_date <= v_today;

  SELECT COALESCE(SUM(co.amount),0) INTO v_saida
  FROM cash_outflows co
  WHERE co.organization_id=p_org_id
    AND co.outflow_date >= v_today - 30 AND co.outflow_date <= v_today
    AND co.status='paid';

  SELECT COALESCE(SUM(co.amount),0) INTO v_f30 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL
     AND co.status='pending' AND co.outflow_date <= v_today + 30;
  SELECT COALESCE(SUM(co.amount),0) INTO v_f60 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL
     AND co.status='pending' AND co.outflow_date <= v_today + 60;
  SELECT COALESCE(SUM(co.amount),0) INTO v_f90 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL
     AND co.status='pending' AND co.outflow_date <= v_today + 90;
  SELECT COALESCE(SUM(co.amount),0) INTO v_total FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending';

  -- HG-01: projecao no horizonte p_horizon (default 30d) -> valor+data+alerta consistentes
  v_bal := v_current; v_min_bal := v_current; v_min_bal_date := v_today;
  FOR v_day IN 1..p_horizon LOOP
    SELECT COALESCE(SUM(ci.net_amount),0) INTO v_day_inc FROM cash_inflows ci
     WHERE ci.organization_id=p_org_id AND ci.release_date = v_today + v_day;
    SELECT COALESCE(SUM(co.amount),0) INTO v_day_exp FROM cash_outflows co
     WHERE co.organization_id=p_org_id AND co.outflow_date = v_today + v_day;
    v_bal := v_bal + v_day_inc - v_day_exp;
    IF v_alert_date IS NULL AND v_bal < v_alert_thresh THEN v_alert_date := v_today + v_day; END IF;
    IF v_bal < v_min_bal THEN v_min_bal := v_bal; v_min_bal_date := v_today + v_day; END IF;
  END LOOP;

  RETURN QUERY SELECT v_burn, v_alert_thresh, v_alert_date, v_min_bal_date, v_min_bal,
                      v_entrada, v_saida, v_f30, v_f60, v_f90, v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_treasury_panel(UUID, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_treasury_panel(UUID, INT) TO authenticated;
