-- ── pg_cron: consultor-insights daily schedule ────────────────────────────────
--
-- Pattern B (Bearer service_role_key via vault.decrypted_secrets).
-- The EF consultor-insights uses verify_jwt=false but authenticates internally:
--   Bearer service_role_key → mode all_orgs (cron path)
--   Bearer user JWT         → mode org_only (frontend on-demand path)
--   Anything else           → 401
--
-- Pattern B is used here (NOT Pattern A / X-Cron-Secret) because:
--   The EF compares auth === "Bearer " + SUPABASE_SERVICE_ROLE_KEY.
--   Passing any other secret would result in a 401 (T-45-06 guard).
--
-- PREREQUISITE (from 42-01-SUMMARY.md / Pattern B):
--   vault.secrets must have a row WHERE name = 'service_role_key'
--   and the value must be the sb_secret_* key (NOT the legacy JWT).
--   Verify before applying:
--     SELECT name FROM vault.secrets WHERE name = 'service_role_key';
--   Insert if absent:
--     SELECT vault.create_secret('<sb_secret_key>', 'service_role_key', 'Service role key para pg_cron');
--
-- Schedule: '30 8 * * *' = 08:30 UTC daily.
--   Runs AFTER:
--     07:03 nexo_report_v2 / sync principal
--     07:30 scores
--     07:45 indicators --skip-fetch
--   So the consultor engine has fresh data to evaluate when it runs.
--
-- Idempotent: unschedule (ignore error if not exists) then schedule.
-- Supabase project: ckcdevcxgvueywivefgx.
-- ──────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  PERFORM cron.unschedule('consultor-insights-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'consultor-insights-daily',
  '30 8 * * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/consultor-insights',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{"mode":"all_orgs"}'::jsonb
    ) AS request_id;
  $cmd$
);
