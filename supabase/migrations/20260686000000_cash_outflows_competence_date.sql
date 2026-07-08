-- ============================================================
-- Phase 86 — competence_date em cash_outflows (DRE de Resultado, fase 1/3)
-- ============================================================
-- Objetivo: habilitar leitura de custos por MES DE COMPETENCIA (dataCompetencia do
-- Tiny), preservando 100% da DFC/Phase 60 (outflow_date intacto, get_cashflow
-- inalterado). competence_date e ADITIVO.
--
--   1. ALTER TABLE cash_outflows ADD COLUMN competence_date date (nullable).
--   2. Indice adicional (organization_id, competence_date, category) — NAO
--      substitui/altera o indice existente de outflow_date.
--   3. enrich_enqueue_new: WHERE ganha `OR co.competence_date IS NULL` — sem isto,
--      linhas ja enriquecidas (category/supplier preenchidos) nunca reentram na
--      fila de backfill (Pitfall 1, 86-RESEARCH.md).
--   4. enrich_payable_step + enrich_harvest: parseiam dataCompetencia ("YYYY-MM")
--      -> primeiro dia do mes via to_date(... || '-01', 'YYYY-MM-DD') (NUNCA
--      ::date direto — Pitfall 2) e gravam competence_date NA MESMA UPDATE que ja
--      grava category/supplier (single-writer, ON CONFLICT-safe). Atualizadas as
--      DUAS funcoes identicamente (Pitfall 3 — nao se sabe com certeza qual delas
--      o cron treasury_cat_tick chama em prod hoje).
--   5. REVOKE EXECUTE reemitido para as 3 funcoes (T-86-02 — CREATE OR REPLACE nao
--      garante preservar REVOKEs anteriores).
--
-- NAO recria os crons treasury_cat_tick / treasury_cat_enqueue — eles existem em
-- prod via DRIFT e passam a usar a nova implementacao automaticamente.
-- NAO toca outflow_date, get_cashflow, sync-tiny-payables ou cron.schedule/unschedule.
--
-- Apply via MCP apply_migration no projeto ckcdevcxgvueywivefgx.
-- NUNCA `supabase db push` (sem token de CLI para este projeto).
-- ============================================================

-- ── 1. Coluna nova, nullable ──────────────────────────────────────────────────
-- dataCompetencia pode faltar em lancamentos antigos — meta e >=90%, nao 100%
-- (86-CONTEXT.md aceita NULL residual).
ALTER TABLE public.cash_outflows ADD COLUMN IF NOT EXISTS competence_date date;

-- ── 2. Indice de suporte para a leitura da DRE por mes+categoria (Phase 87) ───
-- ADITIVO — nao substitui o indice existente de outflow_date (que serve a DFC).
CREATE INDEX IF NOT EXISTS cash_outflows_org_competence_category_idx
  ON public.cash_outflows (organization_id, competence_date, category);

-- ── 3. enrich_enqueue_new ──────────────────────────────────────────────────────
-- Mudanca: WHERE inclui `OR co.competence_date IS NULL` — sem isto, linhas ja
-- enriquecidas (category/supplier preenchidos) nunca reentram na fila.
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
  WHERE (co.category IS NULL OR TRIM(co.category) = '' OR co.supplier IS NULL
         OR co.competence_date IS NULL)
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

-- ── 4. enrich_payable_step ─────────────────────────────────────────────────────
-- Mudanca: v_competence date local; parse null-safe de dataCompetencia
-- ("YYYY-MM" -> primeiro dia do mes); grava competence_date na MESMA UPDATE que
-- ja grava category/supplier.
CREATE OR REPLACE FUNCTION public.enrich_payable_step(p_batch integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token      text;
  r            record;
  v_cat        text;
  v_supplier   text;
  v_competence date;
  v_status     int;
  v_content    jsonb;
  v_done       int := 0;
  v_retry      int := 0;
  v_err        int := 0;
  v_fired      int := 0;
BEGIN
  -- harvest das respostas pendentes
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='sent' AND req_id IS NOT NULL LOOP
    SELECT resp.status_code, resp.content::jsonb INTO v_status, v_content
    FROM net._http_response resp WHERE resp.id = r.req_id;

    IF v_status IS NULL THEN
      CONTINUE;
    ELSIF v_status = 200 THEN
      v_cat        := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
      v_supplier   := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');
      v_competence := NULL;
      IF NULLIF(TRIM(COALESCE(v_content->>'dataCompetencia', '')), '') IS NOT NULL THEN
        v_competence := to_date(TRIM(v_content->>'dataCompetencia') || '-01', 'YYYY-MM-DD');
      END IF;
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

REVOKE EXECUTE ON FUNCTION public.enrich_payable_step(integer) FROM PUBLIC, anon, authenticated;

-- ── 5. enrich_harvest ──────────────────────────────────────────────────────────
-- Por consistencia: mesma mudanca de enrich_payable_step (v_competence + UPDATE).
-- Mantem assinatura, SECURITY DEFINER, REVOKE exatamente como 20260661000000.
CREATE OR REPLACE FUNCTION public.enrich_harvest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  r            record;
  v_status     int;
  v_content    jsonb;
  v_cat        text;
  v_supplier   text;
  v_competence date;
  v_done       int := 0; v_retry int := 0; v_err int := 0; v_pending int := 0;
BEGIN
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='sent' AND req_id IS NOT NULL LOOP
    SELECT resp.status_code, resp.content::jsonb INTO v_status, v_content
    FROM net._http_response resp WHERE resp.id = r.req_id;

    IF v_status IS NULL THEN
      v_pending := v_pending + 1; CONTINUE;
    ELSIF v_status = 200 THEN
      v_cat        := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
      v_supplier   := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');
      v_competence := NULL;
      IF NULLIF(TRIM(COALESCE(v_content->>'dataCompetencia', '')), '') IS NOT NULL THEN
        v_competence := to_date(TRIM(v_content->>'dataCompetencia') || '-01', 'YYYY-MM-DD');
      END IF;
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
END $$;

REVOKE EXECUTE ON FUNCTION public.enrich_harvest() FROM PUBLIC, anon, authenticated;
