-- ── TENANT-03 / Pitfall 4: Recriar cron sync-process-job com Pattern B ───────
--
-- O schedule 'sync-process-job-every-5min' criado em 20260519140000_sync_jobs.sql
-- aponta para a URL do projeto ERRADA e usa um anon JWT legado embutido.
-- Esta migration recria o job apontando para o projeto correto (ckcdevcxgvueywivefgx)
-- com autenticação Pattern B (vault.decrypted_secrets WHERE name = 'service_role_key').
--
-- Pattern B espelhado de 20260614110000_pg_cron_questions_claims.sql (correto e validado).
--
-- PREREQUISITE: vault.secrets deve ter uma linha WHERE name = 'service_role_key'
--   (sb_secret_ — chave nova, não o JWT legado) antes de aplicar esta migration.
--   Verificar: SELECT name FROM vault.secrets WHERE name = 'service_role_key';
--   Se ausente, inserir:
--     SELECT vault.create_secret('<sb_secret_value>', 'service_role_key', 'Service role key para pg_cron');
--
-- Os schedules 'sync-dispatch-every-30min' e 'sync-job-retry-watchdog' usam SQL
-- inline (sem HTTP) e já estão corretos — não são recriados aqui.
--
-- Idempotente: unschedule (ignora exceção) + schedule.

-- ── Recriar sync-process-job-every-5min com URL correta + Pattern B ──────────

DO $$ BEGIN
  PERFORM cron.unschedule('sync-process-job-every-5min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-process-job-every-5min',
  '*/5 * * * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/process-sync-job',
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
