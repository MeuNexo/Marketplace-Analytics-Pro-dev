-- ============================================================
-- CR-01 (completo) — pipeline REAL de backfill de categoria em prod
-- ============================================================
-- O arquivo 20260650000100 documentava enrich_drain/enrich_harvest (crons
-- treasury_cat_drain/harvest a cada minuto). O pipeline em prod evoluiu (fora
-- do repo — DRIFT) para:
--   cron treasury_cat_enqueue (*/30 min) -> enrich_enqueue_new()
--   cron treasury_cat_tick    (15 seg)   -> enrich_payable_step(batch)  (harvest + dispara)
-- Ambas ainda tinham token/ml_user_id hardcoded '1639558873' (vaza cross-conta
-- quando 2a loja conectar Tiny) e EXECUTE aberto a PUBLIC/anon/authenticated.
-- Este arquivo consolida a versao multi-tenant-safe aplicada via MCP
-- (migration treasury_fix_cr01_backfill_pipeline_multitenant).
-- ============================================================

-- enqueue: ml_user_id correto por org (join ml_tokens), nao literal.
-- SEM filtro de data: enfileira TODA conta sem categoria com tiny_payable_id
-- (passada, presente, futura) — garante que nada fique descategorizado e que
-- contas novas entram no proximo tick do cron. Idempotente (ON CONFLICT).
CREATE OR REPLACE FUNCTION public.enrich_enqueue_new()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_added int := 0;
BEGIN
  INSERT INTO public.cat_backfill_queue (tiny_payable_id, organization_id, ml_user_id, status)
  SELECT DISTINCT co.tiny_payable_id, co.organization_id, t.ml_user_id, 'todo'
  FROM public.cash_outflows co
  JOIN LATERAL (
    SELECT ml.ml_user_id FROM public.ml_tokens ml
    WHERE ml.organization_id = co.organization_id
      AND ml.tiny_access_token IS NOT NULL
    LIMIT 1
  ) t ON true
  WHERE (co.category IS NULL OR TRIM(co.category) = '')
    AND co.tiny_payable_id IS NOT NULL
  ON CONFLICT (tiny_payable_id) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN jsonb_build_object(
    'enqueued_now', v_added,
    'queue_open',  (SELECT count(*) FROM public.cat_backfill_queue WHERE status IN ('todo','sent')),
    'done_total',  (SELECT count(*) FROM public.cat_backfill_queue WHERE status='done')
  );
END $function$;

-- step: token por linha da fila (r.ml_user_id), nao token fixo de 1639558873
CREATE OR REPLACE FUNCTION public.enrich_payable_step(p_batch integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token   text;
  r         record;
  v_cat     text;
  v_status  int;
  v_content jsonb;
  v_done    int := 0;
  v_retry   int := 0;
  v_err     int := 0;
  v_fired   int := 0;
BEGIN
  -- harvest das respostas pendentes
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='sent' AND req_id IS NOT NULL LOOP
    SELECT resp.status_code, resp.content::jsonb INTO v_status, v_content
    FROM net._http_response resp WHERE resp.id = r.req_id;

    IF v_status IS NULL THEN
      CONTINUE;
    ELSIF v_status = 200 THEN
      v_cat := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
      UPDATE public.cash_outflows SET category = v_cat
        WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id;
      UPDATE public.cat_backfill_queue SET status='done', updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_done := v_done + 1;
    ELSIF v_status = 429 THEN
      UPDATE public.cat_backfill_queue SET status='todo', req_id=NULL, attempts=attempts+1, updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_retry := v_retry + 1;
    ELSE
      UPDATE public.cat_backfill_queue
        SET status=CASE WHEN attempts >= 4 THEN 'error' ELSE 'todo' END,
            req_id=NULL, attempts=attempts+1, updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_err := v_err + 1;
    END IF;
  END LOOP;

  -- dispara novas requisicoes: token da PROPRIA loja de cada item (r.ml_user_id)
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='todo' ORDER BY updated_at LIMIT p_batch LOOP
    SELECT tiny_access_token INTO v_token FROM public.ml_tokens WHERE ml_user_id = r.ml_user_id LIMIT 1;
    IF v_token IS NULL THEN
      UPDATE public.cat_backfill_queue SET status='error', updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      CONTINUE;
    END IF;
    UPDATE public.cat_backfill_queue
      SET status='sent', updated_at=now(),
          req_id = net.http_get(
            url := 'https://api.tiny.com.br/public-api/v3/contas-pagar/' || r.tiny_payable_id,
            headers := jsonb_build_object('Authorization','Bearer '||v_token,'Accept','application/json'))
      WHERE tiny_payable_id = r.tiny_payable_id;
    v_fired := v_fired + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'harvested_done', v_done, 'retry_429', v_retry, 'errors', v_err, 'fired', v_fired,
    'remaining', (SELECT count(*) FROM public.cat_backfill_queue WHERE status IN ('todo','sent')),
    'done_total', (SELECT count(*) FROM public.cat_backfill_queue WHERE status='done')
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.enrich_enqueue_new()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enrich_payable_step(integer) FROM PUBLIC, anon, authenticated;
