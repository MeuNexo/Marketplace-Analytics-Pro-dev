-- ── pg_cron: sync-tiny-payables a cada 6h ─────────────────────────────────────
--
-- Phase 49, CASH-02 (Wesley 2026-06-18): agenda a EF sync-tiny-payables para
-- ingestão automática de contas a pagar do Tiny ERP em cash_outflows.
--
-- Schedule: '0 */6 * * *' (a cada 6 horas — contas a pagar mudam com menos
-- frequência que liberações MP; 4x ao dia é suficiente para o MVP).
--
-- Pattern B (Bearer service_role_key via vault.decrypted_secrets).
-- A EF usa verify_jwt=false + guard interno requireServiceRole():
--   Bearer service_role_key → OK
--   Qualquer outro header   → 401
--
-- PRÉ-REQUISITO OBRIGATÓRIO (Pattern B):
--   vault.secrets deve ter uma linha WHERE name = 'service_role_key'
--   com o valor sb_secret_* (NÃO o JWT legado eyJ...).
--   Verificar antes de aplicar:
--     SELECT name FROM vault.secrets WHERE name = 'service_role_key';
--   Inserir se ausente:
--     SELECT vault.create_secret('<sb_secret_key>', 'service_role_key', 'Service role key para pg_cron');
--
-- PRÉ-REQUISITO: a tabela cash_outflows deve existir (criada na migration
--   20260618100000_cash_flow_tables.sql — plano 49-01).
--
-- Idempotente: unschedule (ignora erro se não existir) → schedule.
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  PERFORM cron.unschedule('sync-tiny-payables-6h');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-tiny-payables-6h',
  '0 */6 * * *',
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
