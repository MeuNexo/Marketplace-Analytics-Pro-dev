-- ── pg_cron: Caixa sempre atualizado — ambos os crons a cada 3h ──────────────
--
-- CASHFIX-03 (2026-06-25): ambos os crons de fluxo de caixa passam a rodar
-- a cada 3h ('0 */3 * * *') para manter entradas (MP) e saídas (Tiny) atualizadas.
-- Mantém os MESMOS nomes de job (renomear quebraria o unschedule idempotente em
-- re-runs e foi travado pelo Wesley):
--   sync-mp-releases-daily  (era '0 7 * * *'  → agora '0 */3 * * *')
--   sync-tiny-payables-6h   (era '0 */6 * * *' → agora '0 */3 * * *')
--
-- Pré-requisito Pattern B (vault.secrets name='service_role_key' com sb_secret_*)
-- já satisfeito pelas migrations 20260618110000 e 20260618115000.
--
-- NUNCA via SQL Editor — somente esta migration versionada
-- (regra feedback_no_drift_via_sql_editor).
--
-- Idempotente: unschedule (ignora erro se não existir) e depois schedule.
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Bloco 1: sync-mp-releases-daily ─────────────────────────────────────────

DO $$ BEGIN
  PERFORM cron.unschedule('sync-mp-releases-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-mp-releases-daily',
  '0 */3 * * *',
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

-- ── Bloco 2: sync-tiny-payables-6h ──────────────────────────────────────────

DO $$ BEGIN
  PERFORM cron.unschedule('sync-tiny-payables-6h');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-tiny-payables-6h',
  '0 */3 * * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-tiny-payables',
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
