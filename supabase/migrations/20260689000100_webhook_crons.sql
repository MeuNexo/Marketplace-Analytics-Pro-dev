-- Webhook em tempo real: polling vira rede de segurança + retry-cron.
-- Pattern B (Bearer service_role_key via vault.decrypted_secrets).

-- Perguntas: 15min -> de hora em hora.
DO $$ BEGIN PERFORM cron.unschedule('sync-ml-questions-every-15min');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('sync-ml-questions-hourly');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('sync-ml-questions-hourly', '0 * * * *', $cmd$
  SELECT net.http_post(
    url := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-questions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body := '{}'::jsonb) AS request_id; $cmd$);

-- Claims: 30min -> a cada 2h.
DO $$ BEGIN PERFORM cron.unschedule('sync-ml-claims-every-30min');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('sync-ml-claims-2h');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('sync-ml-claims-2h', '0 */2 * * *', $cmd$
  SELECT net.http_post(
    url := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-claims',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body := '{}'::jsonb) AS request_id; $cmd$);

-- Retry: reprocessa eventos presos a cada 10min.
DO $$ BEGIN PERFORM cron.unschedule('reprocess-webhook-events');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('reprocess-webhook-events', '*/10 * * * *', $cmd$
  SELECT net.http_post(
    url := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/ml-webhook',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body := '{}'::jsonb) AS request_id; $cmd$);
