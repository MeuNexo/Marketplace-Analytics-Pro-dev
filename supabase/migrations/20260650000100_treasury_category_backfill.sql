-- ============================================================
-- Phase 51: Backfill de cash_outflows.category via detalhe do Tiny
-- ============================================================
-- Descoberta: o endpoint LISTA /contas-pagar do Tiny NAO retorna categoria;
-- o detalhe /contas-pagar/{id} retorna `categoria.descricao` (plano de contas),
-- que corresponde as categorias do painel (Fornecedores, Salarios, Emprestimo...).
-- O EF sync-tiny-payables so via item.tipo/tipoOrdem (vazios) => category 100% NULL.
--
-- Mecanismo: fila + pg_net (fire throttled com COMMIT + harvest), resumivel,
-- retry automatico no 429 (rate limit do Tiny ~1-2/seg). Rodado por pg_cron.
-- Token fica server-side (lido de ml_tokens) — nunca exposto.
--
-- Aplicado em ckcdevcxgvueywivefgx via MCP apply_migration (migrations:
--   treasury_category_backfill_pump, _fix, treasury_category_drain_harvest,
--   treasury_cost_by_month_bounded). Este arquivo consolida o estado final.
-- ============================================================

-- Fila de enriquecimento
CREATE TABLE IF NOT EXISTS public.cat_backfill_queue (
  tiny_payable_id  text PRIMARY KEY,
  organization_id  uuid NOT NULL,
  ml_user_id       text NOT NULL,
  req_id           bigint,
  status           text NOT NULL DEFAULT 'todo', -- todo | sent | done | error
  attempts         int  NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Drain throttled: COMMIT entre cada http_get + pg_sleep => respeita rate limit
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
  SELECT tiny_access_token INTO v_token FROM public.ml_tokens WHERE ml_user_id='1639558873' LIMIT 1;
  IF v_token IS NULL THEN RETURN; END IF;

  FOR r IN SELECT tiny_payable_id FROM public.cat_backfill_queue
           WHERE status='todo' ORDER BY updated_at LIMIT p_limit LOOP
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

-- Harvest: colhe respostas, grava categoria.descricao, trata 429/erros
CREATE OR REPLACE FUNCTION public.enrich_harvest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  r        record;
  v_status int;
  v_content jsonb;
  v_cat    text;
  v_done int := 0; v_retry int := 0; v_err int := 0; v_pending int := 0;
BEGIN
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='sent' AND req_id IS NOT NULL LOOP
    SELECT resp.status_code, resp.content::jsonb INTO v_status, v_content
    FROM net._http_response resp WHERE resp.id = r.req_id;

    IF v_status IS NULL THEN
      v_pending := v_pending + 1; CONTINUE;
    ELSIF v_status = 200 THEN
      v_cat := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
      UPDATE public.cash_outflows SET category = v_cat
        WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id;
      UPDATE public.cat_backfill_queue SET status='done', updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_done := v_done + 1;
    ELSIF v_status = 429 THEN
      UPDATE public.cat_backfill_queue SET status='todo', req_id=NULL, updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_retry := v_retry + 1;
    ELSE
      UPDATE public.cat_backfill_queue
        SET status=CASE WHEN attempts >= 5 THEN 'error' ELSE 'todo' END, req_id=NULL, updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_err := v_err + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('done',v_done,'retry_429',v_retry,'err',v_err,'still_pending',v_pending,
    'remaining',(SELECT count(*) FROM public.cat_backfill_queue WHERE status IN ('todo','sent')),
    'done_total',(SELECT count(*) FROM public.cat_backfill_queue WHERE status='done'));
END $$;

REVOKE EXECUTE ON FUNCTION public.enrich_harvest() FROM PUBLIC, anon, authenticated;

-- get_cost_by_month com janela limitada (evita meses-outlier tipo 2030)
CREATE OR REPLACE FUNCTION public.get_cost_by_month(
  p_org_id UUID,
  p_months  INT DEFAULT 9
)
RETURNS TABLE (month TEXT, category TEXT, total NUMERIC)
LANGUAGE sql
SECURITY INVOKER
SET search_path = 'public'
AS $$
  WITH base AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje)
  SELECT
    TO_CHAR(co.outflow_date, 'YYYY-MM')                        AS month,
    COALESCE(NULLIF(TRIM(co.category), ''), 'Outros')          AS category,
    SUM(co.amount)                                             AS total
  FROM cash_outflows co, base
  WHERE co.organization_id = p_org_id
    AND co.outflow_date >= (DATE_TRUNC('month', base.hoje) - ((p_months - 1) || ' months')::INTERVAL)::date
    AND co.outflow_date <  (DATE_TRUNC('month', base.hoje) + INTERVAL '4 months')::date
  GROUP BY 1, 2
  ORDER BY 1, 3 DESC;
$$;

-- Agendamento (idempotente): drain + harvest a cada minuto enquanto a fila tem itens.
-- NOTE: jobs ja criados em prod (treasury_cat_drain=23, treasury_cat_harvest=24).
-- Desagendar manualmente quando remaining=0: SELECT cron.unschedule('treasury_cat_drain');
DO $$ BEGIN
  PERFORM cron.unschedule('treasury_cat_drain');  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('treasury_cat_harvest'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('treasury_cat_drain',  '* * * * *', $$CALL public.enrich_drain(50, 1.0);$$);
SELECT cron.schedule('treasury_cat_harvest','* * * * *', $$SELECT public.enrich_harvest();$$);
