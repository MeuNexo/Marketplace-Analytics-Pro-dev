-- Phase 86 — DRE de Resultado (fase 1/3): Competência no Contas a Pagar
--
-- Adiciona public.cash_outflows.competence_date (date, 1º dia do mês, derivado do
-- campo `dataCompetencia` "YYYY-MM" do detalhe /contas-pagar/{id} do Tiny) e estende o
-- pipeline de enriquecimento da Phase 61 para gravá-lo junto de category/supplier.
--
-- APLICAR VIA Supabase MCP apply_migration no projeto ckcdevcxgvueywivefgx.
-- NUNCA `supabase db push` (não há token CLI para este projeto).
--
-- Os corpos das 3 funções foram transcritos do ESTADO REAL de produção (pg_get_functiondef,
-- 2026-07-06) para não reverter nenhum drift, + a lógica de competência. Não toca
-- outflow_date, get_cashflow, sync-tiny-payables nem os cron jobs (treasury_cat_enqueue /
-- treasury_cat_tick permanecem chamando enrich_enqueue_new() / enrich_payable_step(6)).

-- (1) Coluna aditiva, nullable (dataCompetencia pode faltar em lançamentos antigos; meta ≥90%, não 100%).
ALTER TABLE public.cash_outflows ADD COLUMN IF NOT EXISTS competence_date date;

-- (2) Índice aditivo para a leitura da DRE por competência+categoria.
--     NÃO altera/mescla/remove o índice existente de outflow_date (usado pela DFC/Phase 60).
CREATE INDEX IF NOT EXISTS cash_outflows_org_competence_category_idx
  ON public.cash_outflows (organization_id, competence_date, category);

-- (3) enqueue: re-enfileira também linhas com competence_date IS NULL — sem isso, as linhas já
--     enriquecidas na Phase 61 (category/supplier preenchidos) nunca voltariam à fila e o
--     backfill de competência seria um no-op silencioso.
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
  WHERE (co.category IS NULL OR TRIM(co.category) = '' OR co.supplier IS NULL OR co.competence_date IS NULL)
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

-- (4a) harvest standalone: grava competence_date no MESMO UPDATE de category/supplier.
CREATE OR REPLACE FUNCTION public.enrich_harvest()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r          record;
  v_status   int;
  v_content  jsonb;
  v_cat      text;
  v_supplier text;
  v_competence date;
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
      -- "YYYY-MM" -> 1º dia do mês; blank/ausente -> NULL (nunca cast direto de "YYYY-MM"::date).
      v_competence := to_date(NULLIF(TRIM(COALESCE(v_content->>'dataCompetencia','')), '') || '-01', 'YYYY-MM-DD');
      UPDATE public.cash_outflows
        SET category = v_cat, supplier = v_supplier, competence_date = v_competence
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
END $function$;

-- (4b) drainer (chamado pelo cron treasury_cat_tick a cada 15s): grava competence_date no
--      MESMO UPDATE de category/supplier do bloco de harvest. Bloco de disparo inalterado.
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
  v_competence date;
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
      -- "YYYY-MM" -> 1º dia do mês; blank/ausente -> NULL (nunca cast direto de "YYYY-MM"::date).
      v_competence := to_date(NULLIF(TRIM(COALESCE(v_content->>'dataCompetencia','')), '') || '-01', 'YYYY-MM-DD');
      UPDATE public.cash_outflows
        SET category = v_cat, supplier = v_supplier, competence_date = v_competence
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

-- (5) Privilégio: re-emite REVOKE (defesa em profundidade — CREATE OR REPLACE preserva grants,
--     mas garantimos que anon/authenticated/PUBLIC não executem estas SECURITY DEFINER).
REVOKE EXECUTE ON FUNCTION public.enrich_enqueue_new() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enrich_harvest() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enrich_payable_step(integer) FROM PUBLIC, anon, authenticated;
