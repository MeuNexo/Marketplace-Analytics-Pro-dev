-- ── pg_cron: sync-mp-releases agendamento diário ──────────────────────────────
--
-- Pattern B (Bearer service_role_key via vault.decrypted_secrets).
-- A EF sync-mp-releases usa verify_jwt=false mas autentica internamente:
--   Bearer service_role_key → executa sincronização de todos os orgs
--   Qualquer outra coisa    → 401
--
-- Pattern B é usado aqui porque a EF compara auth === "Bearer " + SERVICE_KEY.
-- Passar qualquer outro segredo resultaria em 401 (guard requireServiceRole).
--
-- PRÉ-REQUISITO (Pattern B — obrigatório antes de aplicar esta migration):
--   vault.secrets deve ter uma linha WHERE name = 'service_role_key'
--   e o valor deve ser o sb_secret_* (NÃO o JWT legado eyJ...).
--   Verificar antes de aplicar:
--     SELECT name FROM vault.secrets WHERE name = 'service_role_key';
--   Inserir se ausente:
--     SELECT vault.create_secret('<sb_secret_key>', 'service_role_key', 'Service role key para pg_cron');
--
-- Horário: '0 7 * * *' = 07:00 UTC diário.
--   Roda ANTES do relatório das 07:03 UTC (nexo_report_v2) para que as
--   liberações do dia já estejam no banco quando o relatório rodar.
--   Pé Vermeio é BRT (UTC-3) → execução às 04:00 BRT.
--
-- Idempotente: unschedule (ignora erro se não existir) e depois schedule.
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- ──────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  PERFORM cron.unschedule('sync-mp-releases-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-mp-releases-daily',
  '0 7 * * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-mp-releases',
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
