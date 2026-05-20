-- ─── Table: ml_inventory_cache ────────────────────────────────────────────────
CREATE TABLE public.ml_inventory_cache (
  organization_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id           text        NOT NULL,
  item_id              text        NOT NULL,
  title                text,
  status               text,
  available_quantity   integer     NOT NULL DEFAULT 0,
  sold_quantity        integer     NOT NULL DEFAULT 0,
  price                numeric,
  currency_id          text        NOT NULL DEFAULT 'BRL',
  thumbnail            text,
  category_id          text,
  listing_type_id      text,
  health               numeric,
  visits               integer     NOT NULL DEFAULT 0,
  brand                text,
  seller_custom_field  text,
  has_variations       boolean     NOT NULL DEFAULT false,
  variations           jsonb       NOT NULL DEFAULT '[]',
  logistic_type        text,
  free_shipping        boolean     NOT NULL DEFAULT false,
  catalog_product_id   text,
  deal_ids             jsonb       NOT NULL DEFAULT '[]',
  synced_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, ml_user_id, item_id)
);

-- ─── Index ────────────────────────────────────────────────────────────────────
CREATE INDEX ml_inventory_cache_org_user_idx
  ON public.ml_inventory_cache (organization_id, ml_user_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.ml_inventory_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ml_inventory_cache select"
  ON public.ml_inventory_cache FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT/UPDATE/DELETE: service_role only (edge functions write)

-- ─── Function: dispatch_inventory_jobs() ─────────────────────────────────────
-- Inserts pending inventory jobs for every org with an active ML token.
-- Ignores sync_interval_minutes (inventory is a daily batch, not interval-based).
-- Guard: skips if a pending or running inventory job already exists (SYNC-07 equivalent).
CREATE OR REPLACE FUNCTION public.dispatch_inventory_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted integer := 0;
  r          record;
  v_has_open boolean;
BEGIN
  FOR r IN
    SELECT DISTINCT t.ml_user_id, t.organization_id
    FROM public.ml_tokens t
    WHERE t.access_token IS NOT NULL
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.sync_jobs
      WHERE organization_id = r.organization_id
        AND ml_user_id      = r.ml_user_id
        AND job_type        = 'inventory'
        AND status IN ('pending', 'running')
    ) INTO v_has_open;

    IF v_has_open THEN CONTINUE; END IF;

    INSERT INTO public.sync_jobs (organization_id, ml_user_id, job_type, status, retries)
    VALUES (r.organization_id, r.ml_user_id, 'inventory', 'pending', 0);
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- ─── pg_cron: daily inventory sync at 04:00 BRT (07:00 UTC) ──────────────────
DO $$ BEGIN PERFORM cron.unschedule('sync-inventory-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'sync-inventory-daily',
  '0 7 * * *',
  $$ SELECT public.dispatch_inventory_jobs(); $$
);
