-- Transforma ml_ads_products_cache de snapshot para série histórica diária.
-- Antes: delete+insert a cada sync (sobrescreve tudo)
-- Depois: upsert por (organization_id, ml_user_id, item_id, date)

-- 1. Adiciona coluna date (existentes ficam com data de hoje = dia do snapshot atual)
ALTER TABLE ml_ads_products_cache
  ADD COLUMN IF NOT EXISTS date DATE NOT NULL DEFAULT CURRENT_DATE;

-- 2. Atribui data correta para rows existentes (usa data do synced_at)
UPDATE ml_ads_products_cache
SET date = synced_at::date
WHERE date = CURRENT_DATE;

-- 3. Constraint única para upsert diário por produto
ALTER TABLE ml_ads_products_cache
  DROP CONSTRAINT IF EXISTS ml_ads_products_cache_pkey CASCADE;

ALTER TABLE ml_ads_products_cache
  ADD CONSTRAINT ml_ads_products_org_user_item_date_key
  UNIQUE (organization_id, ml_user_id, item_id, date);

-- 4. Índice para queries de período no useMLProductMargins
CREATE INDEX IF NOT EXISTS idx_ads_products_org_user_date
  ON ml_ads_products_cache (organization_id, ml_user_id, date);
