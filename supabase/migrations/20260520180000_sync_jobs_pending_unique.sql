-- Partial unique index: prevents duplicate pending/running jobs
-- for the same (ml_user_id, job_type, date_from).
-- bulk-dispatch-sync-jobs relies on this for atomic idempotency via ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_jobs_pending_unique
  ON public.sync_jobs (ml_user_id, job_type, date_from)
  WHERE status IN ('pending', 'running');
