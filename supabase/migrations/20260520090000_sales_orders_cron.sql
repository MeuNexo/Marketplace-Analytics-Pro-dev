-- ─── dispatch_sales_jobs() ───────────────────────────────────────────────────
-- Creates daily_cache jobs for D-1 for all orgs with active ML tokens.
-- Skips if a pending/running job for the same (ml_user_id, job_type, date_from) exists.
-- Called by pg_cron at 09:00 UTC (06:00 BRT) daily.
CREATE OR REPLACE FUNCTION public.dispatch_sales_jobs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r         RECORD;
  yesterday date := CURRENT_DATE - 1;
BEGIN
  FOR r IN
    SELECT DISTINCT ml_user_id, organization_id
    FROM public.ml_tokens
    WHERE access_token IS NOT NULL
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.sync_jobs
      WHERE ml_user_id = r.ml_user_id
        AND job_type   = 'daily_cache'
        AND date_from  = yesterday
        AND status IN ('pending', 'running')
    ) THEN
      INSERT INTO public.sync_jobs (ml_user_id, organization_id, job_type, status, date_from, date_to)
      VALUES (r.ml_user_id, r.organization_id, 'daily_cache', 'pending', yesterday, yesterday);
    END IF;
  END LOOP;
END;
$$;

-- ─── dispatch_orders_jobs() ──────────────────────────────────────────────────
-- Creates orders jobs for D-1 for all orgs with active ML tokens.
CREATE OR REPLACE FUNCTION public.dispatch_orders_jobs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r         RECORD;
  yesterday date := CURRENT_DATE - 1;
BEGIN
  FOR r IN
    SELECT DISTINCT ml_user_id, organization_id
    FROM public.ml_tokens
    WHERE access_token IS NOT NULL
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.sync_jobs
      WHERE ml_user_id = r.ml_user_id
        AND job_type   = 'orders'
        AND date_from  = yesterday
        AND status IN ('pending', 'running')
    ) THEN
      INSERT INTO public.sync_jobs (ml_user_id, organization_id, job_type, status, date_from, date_to)
      VALUES (r.ml_user_id, r.organization_id, 'orders', 'pending', yesterday, yesterday);
    END IF;
  END LOOP;
END;
$$;

-- ─── pg_cron: vendas diárias às 09:00 UTC (06:00 BRT) ────────────────────────
DO $$ BEGIN PERFORM cron.unschedule('sync-sales-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'sync-sales-daily',
  '0 9 * * *',
  'SELECT public.dispatch_sales_jobs()'
);

-- ─── pg_cron: pedidos diários às 09:00 UTC (06:00 BRT) ───────────────────────
DO $$ BEGIN PERFORM cron.unschedule('sync-orders-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'sync-orders-daily',
  '0 9 * * *',
  'SELECT public.dispatch_orders_jobs()'
);
