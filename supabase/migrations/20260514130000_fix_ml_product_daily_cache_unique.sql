
-- Fix ml_product_daily_cache duplicate-counting bug
-- ─────────────────────────────────────────────────────────────────────────────
-- Root cause: the unique constraint was (user_id, date, item_id).
-- The edge-function upsert specified onConflict:"user_id,ml_user_id,date,item_id"
-- which did NOT match any real constraint, so PostgreSQL treated each call as a
-- plain INSERT.  When two members of the same org synced the same store on the
-- same day, two rows were created for the same product/day, causing the Ranking
-- de Anúncios to double-count (e.g. 818 × 2 = 1636).
--
-- Fix: deduplicate existing rows, then replace the old constraint with a new one
-- on (organization_id, ml_user_id, date, item_id), which is both correct
-- (one row per org × store × day × product) and matches the edge-function call.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Remove duplicate rows — keep the one with the latest synced_at.
DELETE FROM public.ml_product_daily_cache
WHERE organization_id IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (organization_id, ml_user_id, date, item_id) id
    FROM public.ml_product_daily_cache
    WHERE organization_id IS NOT NULL
    ORDER BY organization_id, ml_user_id, date, item_id, synced_at DESC
  );

-- Step 2: Drop the old per-user constraint.
ALTER TABLE public.ml_product_daily_cache
  DROP CONSTRAINT IF EXISTS ml_product_daily_cache_user_id_date_item_id_key;

-- Step 3: Add the correct per-org constraint.
ALTER TABLE public.ml_product_daily_cache
  ADD CONSTRAINT ml_product_daily_cache_org_mluser_date_item_unique
  UNIQUE (organization_id, ml_user_id, date, item_id);

-- Step 4: Update the supporting index to match.
DROP INDEX IF EXISTS idx_ml_product_daily_cache_lookup;
CREATE INDEX IF NOT EXISTS idx_ml_product_daily_cache_lookup
  ON public.ml_product_daily_cache (organization_id, ml_user_id, date);
