-- ── pg_cron: sync-ml-questions and sync-ml-claims schedules ──────────────────
--
-- Pattern B (Bearer service_role_key via vault.decrypted_secrets).
-- DO NOT use X-Cron-Secret (Pattern A) for these EFs — they check
--   `auth !== "Bearer " + SUPABASE_SERVICE_ROLE_KEY`
-- and would 401 if passed the anon/sb_secret_ key (Pitfall 1 / D-02).
--
-- PREREQUISITE (from 42-01-SUMMARY.md Wave-2 note):
--   vault.secrets must have a row WHERE name = 'service_role_key'
--   before this migration is applied. If absent, every cron invocation
--   will silently 401.
--   Verify: SELECT name FROM vault.secrets WHERE name = 'service_role_key';
--   Insert:  SELECT vault.create_secret('<service_role_key_value>', 'service_role_key', 'Service role key para pg_cron');
--
-- Both jobs use idempotent unschedule-then-schedule pattern (no exception
-- if the job does not exist yet).
--
-- D-01: questions every 15min (urgent), claims every 30min.
-- T-42-06: anon-key POST to these EFs must return 401 (requireServiceRole guard).

-- ── Job 1: sync-ml-questions every 15min ─────────────────────────────────────

DO $$ BEGIN
  PERFORM cron.unschedule('sync-ml-questions-every-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-ml-questions-every-15min',
  '*/15 * * * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-questions',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $cmd$
);

-- ── Job 2: sync-ml-claims every 30min ────────────────────────────────────────

DO $$ BEGIN
  PERFORM cron.unschedule('sync-ml-claims-every-30min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-ml-claims-every-30min',
  '*/30 * * * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-claims',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $cmd$
);
