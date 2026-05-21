-- Phase 14 gap-fix: RLS policies + correct unique constraint on public.orders
-- Table pre-existed before migration tracking; RLS was enabled but had no policies.
-- Old constraint (ml_order_id, variation_id) misses item_id/ml_user_id — upsert conflict key mismatch.

-- 1. Fix unique constraint: drop narrow key, add the 4-column key the upserts expect
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_ml_order_id_variation_id_key;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_upsert_key
    UNIQUE (ml_order_id, ml_user_id, item_id, variation_id);

-- 2. RLS policies — same pattern as ml_daily_cache / ml_product_daily_cache
-- SELECT: any org member can read orders from their org
CREATE POLICY "orders org select"
  ON public.orders FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND is_org_member(auth.uid(), organization_id)
  );

-- INSERT/UPDATE: service_role (supabaseAdmin) bypasses RLS — no client policy needed
-- DELETE: owners and admins only (safety net)
CREATE POLICY "orders org delete"
  ON public.orders FOR DELETE
  USING (
    organization_id IS NOT NULL
    AND get_org_role(auth.uid(), organization_id) = ANY (
      ARRAY['owner'::org_role, 'admin'::org_role]
    )
  );
