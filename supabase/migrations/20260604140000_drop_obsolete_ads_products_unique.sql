-- FIX: ml_ads_products_cache tinha índice único obsoleto SEM a coluna date
--   ml_ads_products_cache_unique (user_id, ml_user_id, item_id)
-- O modelo atual é série por dia (uma linha por item POR DIA). O upsert usa
-- onConflict (organization_id, ml_user_id, item_id, date), mas o índice antigo
-- sem date bloqueava inserir o mesmo item em datas diferentes → upsert falhava
-- (erro logado, não lançado) e a tabela travava na 1ª data de cada item (05-23).
-- Solução: remover o índice obsoleto; manter ml_ads_products_org_user_item_date_key.
ALTER TABLE public.ml_ads_products_cache
  DROP CONSTRAINT IF EXISTS ml_ads_products_cache_unique;
