
-- Dedupe rows per (organization_id, ml_user_id, date, item_id) keeping latest synced_at
DELETE FROM public.ml_product_daily_cache a
USING public.ml_product_daily_cache b
WHERE a.organization_id IS NOT NULL
  AND b.organization_id IS NOT NULL
  AND a.organization_id = b.organization_id
  AND a.ml_user_id = b.ml_user_id
  AND a.date = b.date
  AND a.item_id = b.item_id
  AND (a.synced_at < b.synced_at OR (a.synced_at = b.synced_at AND a.id < b.id));

-- Add the unique constraint expected by the upsert (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ml_product_daily_cache'::regclass
      AND conname = 'ml_product_daily_cache_org_mluser_date_item_unique'
  ) THEN
    ALTER TABLE public.ml_product_daily_cache
      ADD CONSTRAINT ml_product_daily_cache_org_mluser_date_item_unique
      UNIQUE (organization_id, ml_user_id, date, item_id);
  END IF;
END $$;
