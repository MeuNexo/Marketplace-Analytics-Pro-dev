-- Phase 97 — DRE: pipeline Tiny→dash confiável (2026-07-16)
--
-- Causa-raiz descoberta no debug dre-cartao-billing-ml-persiste:
--   1. treasury_cat_tick (enrich_payable_step a cada 15s) consumia o rate limit
--      do Tiny (~100 req/min) e derrubava o sync-tiny-payables com 429 SILENCIOSO.
--      → EF v7 ganhou retry/backoff; aqui o tick é espaçado 15s → 30s.
--   2. Recategorização no Tiny NUNCA re-sincronizava: enrich_enqueue_new() só
--      enfileira linhas com categoria NULL/vazia. Lançamento corrigido pelo dono
--      (ex.: Outros → Fornecedores) ficava fossilizado no dash.
--      → Novo enrich_reenqueue_outros(): re-enfileira diariamente o balde 'Outros'
--        (o balde de má-classificação, pequeno e decrescente) para re-leitura do
--        detalhe no Tiny. Custo: ~1 chamada de detalhe por linha 'Outros'/dia.

-- ── 1. Re-enrich diário do balde 'Outros' ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enrich_reenqueue_outros()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_added int := 0;
BEGIN
  -- Re-enfileira toda linha atualmente categorizada como 'Outros': é o balde
  -- onde recategorizações do dono no Tiny ficam presas (a categoria local só
  -- muda via enriquecimento-detalhe, e enrich_enqueue_new ignora não-vazias).
  INSERT INTO public.cat_backfill_queue (tiny_payable_id, organization_id, ml_user_id, status)
  SELECT DISTINCT co.tiny_payable_id, co.organization_id, t.ml_user_id, 'todo'
  FROM public.cash_outflows co
  JOIN LATERAL (
    SELECT ml.ml_user_id FROM public.ml_tokens ml
    WHERE ml.organization_id = co.organization_id
      AND ml.tiny_access_token IS NOT NULL
    LIMIT 1
  ) t ON true
  WHERE co.category = 'Outros'
    AND co.tiny_payable_id IS NOT NULL
  ON CONFLICT (tiny_payable_id) DO UPDATE
    SET status = 'todo', updated_at = now()
    WHERE cat_backfill_queue.status IN ('done', 'error');
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN jsonb_build_object('reenqueued', v_added);
END $function$;

REVOKE ALL ON FUNCTION public.enrich_reenqueue_outros() FROM PUBLIC, anon, authenticated;

-- ── 2. Cron diário do re-enrich (05:00 UTC, antes do sync das 06:00) ─────────
SELECT cron.schedule(
  'enrich-reenqueue-outros-daily',
  '0 5 * * *',
  $$SELECT public.enrich_reenqueue_outros();$$
);

-- ── 3. Espaçar o treasury_cat_tick: 15s → 30s ────────────────────────────────
-- Halveia a pressão contínua no rate limit do Tiny (24 → 12 req/min de detalhe),
-- deixando folga para a paginação dos syncs. Com o retry da EF v7, colisões
-- residuais se auto-curam.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'treasury_cat_tick'),
  schedule := '30 seconds'
);
