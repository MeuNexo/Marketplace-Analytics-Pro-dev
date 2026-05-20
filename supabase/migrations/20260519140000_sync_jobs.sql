-- ─── Enum ─────────────────────────────────────────────────────────────────────
CREATE TYPE public.sync_job_type AS ENUM ('daily_cache', 'orders', 'inventory');
CREATE TYPE public.sync_job_status AS ENUM ('pending', 'running', 'completed', 'failed');

-- ─── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE public.sync_jobs (
  id              uuid                   NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid                   NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id      text                   NOT NULL,
  job_type        public.sync_job_type   NOT NULL,
  date_from       date                   DEFAULT NULL,
  date_to         date                   DEFAULT NULL,
  status          public.sync_job_status NOT NULL DEFAULT 'pending',
  retries         integer                NOT NULL DEFAULT 0,
  error_msg       text                   DEFAULT NULL,
  started_at      timestamptz            DEFAULT NULL,
  finished_at     timestamptz            DEFAULT NULL,
  created_at      timestamptz            NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX sync_jobs_pending_created_idx
  ON public.sync_jobs (status, created_at)
  WHERE status = 'pending';

CREATE INDEX sync_jobs_open_lookup_idx
  ON public.sync_jobs (organization_id, ml_user_id, job_type, status)
  WHERE status IN ('pending', 'running');

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

-- SELECT: all members of the organisation (monitoring only)
CREATE POLICY "sync_jobs select"
  ON public.sync_jobs FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- No INSERT/UPDATE/DELETE for authenticated — only service_role and SECURITY DEFINER functions write

-- ─── Function: dispatch_sync_jobs() ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispatch_sync_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted        integer := 0;
  r                 record;
  v_interval_minutes integer;
  v_last_finished   timestamptz;
  v_has_open        boolean;
  v_job_types       text[] := ARRAY['daily_cache', 'orders', 'inventory'];
  v_jt              text;
BEGIN
  FOR r IN
    SELECT DISTINCT t.ml_user_id, t.organization_id
    FROM public.ml_tokens t
    WHERE t.access_token IS NOT NULL
  LOOP
    -- Get sync interval for this org (default 1440 if no plan row)
    SELECT op.sync_interval_minutes INTO v_interval_minutes
    FROM public.organization_plans op
    WHERE op.organization_id = r.organization_id
    LIMIT 1;

    IF v_interval_minutes IS NULL THEN
      v_interval_minutes := 1440; -- default: daily
    END IF;

    -- -1 means unlimited / manual-only; skip auto-dispatch
    IF v_interval_minutes = -1 THEN
      CONTINUE;
    END IF;

    FOREACH v_jt IN ARRAY v_job_types LOOP
      -- SYNC-07: Guard — skip if a pending or running job already exists
      SELECT EXISTS(
        SELECT 1 FROM public.sync_jobs
        WHERE organization_id = r.organization_id
          AND ml_user_id      = r.ml_user_id
          AND job_type        = v_jt::public.sync_job_type
          AND status IN ('pending', 'running')
      ) INTO v_has_open;

      IF v_has_open THEN CONTINUE; END IF;

      -- Check when the last completed job finished
      SELECT finished_at INTO v_last_finished
      FROM public.sync_jobs
      WHERE organization_id = r.organization_id
        AND ml_user_id      = r.ml_user_id
        AND job_type        = v_jt::public.sync_job_type
        AND status          = 'completed'
      ORDER BY finished_at DESC
      LIMIT 1;

      -- Insert if: no prior completed job OR elapsed >= configured interval
      IF v_last_finished IS NULL
         OR v_last_finished + (v_interval_minutes || ' minutes')::interval <= now() THEN
        INSERT INTO public.sync_jobs
          (organization_id, ml_user_id, job_type, status, retries)
        VALUES
          (r.organization_id, r.ml_user_id, v_jt::public.sync_job_type, 'pending', 0);
        v_inserted := v_inserted + 1;
      END IF;

    END LOOP;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- ─── Function: claim_next_sync_job() ──────────────────────────────────────────
-- Atomic claim using FOR UPDATE SKIP LOCKED — concurrency-safe for multiple
-- simultaneous pg_cron invocations. Called via sb.rpc('claim_next_sync_job').
CREATE OR REPLACE FUNCTION public.claim_next_sync_job()
RETURNS public.sync_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job public.sync_jobs;
BEGIN
  UPDATE public.sync_jobs
  SET status     = 'running',
      started_at = now()
  WHERE id = (
    SELECT id
    FROM public.sync_jobs
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

-- ─── pg_cron Schedules ────────────────────────────────────────────────────────

-- SYNC-05: Dispatch every 30 minutes — insert pending jobs for all active stores
DO $$ BEGIN PERFORM cron.unschedule('sync-dispatch-every-30min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'sync-dispatch-every-30min',
  '*/30 * * * *',
  $$ SELECT public.dispatch_sync_jobs(); $$
);

-- SYNC-06: Drain every 5 minutes — invoke process-sync-job via net.http_post
DO $$ BEGIN PERFORM cron.unschedule('sync-process-job-every-5min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'sync-process-job-every-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://gionpsuunfkkzzjdubfy.supabase.co/functions/v1/process-sync-job',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdpb25wc3V1bmZra3p6amR1YmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTc2NDgsImV4cCI6MjA4ODEzMzY0OH0.mHbEEnXlynQopAd5j7A4B4emYwalXqvyVcvEh_G5gUk',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- SYNC-03: Watchdog retry every 5 minutes — re-queue failed jobs with exponential backoff
DO $$ BEGIN PERFORM cron.unschedule('sync-job-retry-watchdog'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'sync-job-retry-watchdog',
  '*/5 * * * *',
  $$
  INSERT INTO public.sync_jobs
    (organization_id, ml_user_id, job_type, status, retries, date_from, date_to)
  SELECT
    organization_id, ml_user_id, job_type, 'pending', retries + 1, date_from, date_to
  FROM public.sync_jobs
  WHERE status     = 'failed'
    AND retries    < 3
    AND finished_at + (
      CASE retries
        WHEN 0 THEN interval '5 minutes'
        WHEN 1 THEN interval '15 minutes'
        WHEN 2 THEN interval '30 minutes'
        ELSE interval '999 hours'
      END
    ) <= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.sync_jobs j2
      WHERE j2.organization_id = sync_jobs.organization_id
        AND j2.ml_user_id      = sync_jobs.ml_user_id
        AND j2.job_type        = sync_jobs.job_type
        AND j2.status IN ('pending', 'running')
    );
  $$
);
