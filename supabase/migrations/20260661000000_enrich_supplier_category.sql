-- ============================================================
-- Phase 61 — Fonte única de category + supplier em cash_outflows
-- ============================================================
-- CASHFIX-07 (opção A travada em 61-CONTEXT):
--   1. enrich_enqueue_new: WHERE inclui supplier IS NULL; ON CONFLICT DO UPDATE
--      re-marca done/error → todo para recuperar linhas zeradas pelo sync.
--   2. enrich_payable_step: grava supplier = contato.nome além de category.
--   3. enrich_harvest: idem, por consistência.
--
-- NÃO recria os crons treasury_cat_tick / treasury_cat_enqueue — eles existem em
-- prod via DRIFT e passam a usar a nova implementação automaticamente (Pitfall 3).
-- Apply via MCP apply_migration no projeto ckcdevcxgvueywivefgx (não supabase db push).
-- ============================================================

-- ── 1. enrich_enqueue_new ────────────────────────────────────────────────────
-- Mudança 1: WHERE inclui co.supplier IS NULL (antes só filtrava category).
-- Mudança 2: ON CONFLICT DO UPDATE re-marca done/error como todo (idempotente, re-enfileira).
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
  WHERE (co.category IS NULL OR TRIM(co.category) = '' OR co.supplier IS NULL)
    AND co.tiny_payable_id IS NOT NULL
  ON CONFLICT (tiny_payable_id) DO UPDATE
    SET status = 'todo', updated_at = now()
    WHERE cat_backfill_queue.status IN ('done', 'error');
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN jsonb_build_object(
    'enqueued_now', v_added,
    'queue_open',  (SELECT count(*) FROM public.cat_backfill_queue WHERE status IN ('todo','sent')),
    'done_total',  (SELECT count(*) FROM public.cat_backfill_queue WHERE status='done')
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.enrich_enqueue_new() FROM PUBLIC, anon, authenticated;

-- ── 2. enrich_payable_step ───────────────────────────────────────────────────
-- Mudança: declaração de v_supplier text (Pitfall 4); harvest grava supplier=v_supplier
-- além de category=v_cat no UPDATE de cash_outflows.
CREATE OR REPLACE FUNCTION public.enrich_payable_step(p_batch integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token    text;
  r          record;
  v_cat      text;
  v_supplier text;
  v_status   int;
  v_content  jsonb;
  v_done     int := 0;
  v_retry    int := 0;
  v_err      int := 0;
  v_fired    int := 0;
BEGIN
  -- harvest das respostas pendentes
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='sent' AND req_id IS NOT NULL LOOP
    SELECT resp.status_code, resp.content::jsonb INTO v_status, v_content
    FROM net._http_response resp WHERE resp.id = r.req_id;

    IF v_status IS NULL THEN
      CONTINUE;
    ELSIF v_status = 200 THEN
      v_cat      := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
      v_supplier := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');
      UPDATE public.cash_outflows
        SET category = v_cat, supplier = v_supplier
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

  -- dispara novas requisicoes: token da propria loja de cada item (r.ml_user_id)
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

REVOKE EXECUTE ON FUNCTION public.enrich_payable_step(integer) FROM PUBLIC, anon, authenticated;

-- ── 3. enrich_harvest ────────────────────────────────────────────────────────
-- Por consistência: mesmo pipeline que enrich_payable_step, agora grava supplier.
-- Mantém assinatura, SECURITY DEFINER, REVOKE exatamente como 20260650000100.
CREATE OR REPLACE FUNCTION public.enrich_harvest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  r          record;
  v_status   int;
  v_content  jsonb;
  v_cat      text;
  v_supplier text;
  v_done     int := 0; v_retry int := 0; v_err int := 0; v_pending int := 0;
BEGIN
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='sent' AND req_id IS NOT NULL LOOP
    SELECT resp.status_code, resp.content::jsonb INTO v_status, v_content
    FROM net._http_response resp WHERE resp.id = r.req_id;

    IF v_status IS NULL THEN
      v_pending := v_pending + 1; CONTINUE;
    ELSIF v_status = 200 THEN
      v_cat      := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
      v_supplier := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');
      UPDATE public.cash_outflows
        SET category = v_cat, supplier = v_supplier
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
