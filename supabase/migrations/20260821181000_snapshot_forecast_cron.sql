-- ============================================================
-- Cron do snapshot diario de previsao de caixa (Fase 224 — ERR-02)
-- ============================================================
-- Pattern B (20260659000200_cashflow_crons_3h.sql:22-45): unschedule
-- idempotente dentro de DO/EXCEPTION, depois schedule com net.http_post e
-- o service_role_key lido do vault.
--
-- NOME DO JOB E DEFINITIVO. Renomear quebraria o unschedule idempotente em
-- reexecucoes — regra travada pelo Wesley.
--
-- Cron e UTC: '0 7 * * *' = 04:00 BRT, depois da ultima passada noturna do
-- sync-mp-releases (que roda de 3 em 3 horas, entao a de 03:00 BRT ja
-- passou) e antes de qualquer uso da tela pela manha.
--
-- ORDEM OBRIGATORIA: publicar a edge function ANTES de aplicar esta
-- migration. Cron apontando para funcao inexistente dispara contra 404
-- todo dia, em silencio — assinatura do bug da Fase 211.
--
-- Projeto: ckcdevcxgvueywivefgx (NAO usar gionpsuunfkkzzjdubfy).
-- Aplicar via MCP apply_migration. NUNCA `supabase db push`.
-- ============================================================

DO $$ BEGIN
  PERFORM cron.unschedule('snapshot-cashflow-forecast-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'snapshot-cashflow-forecast-daily',
  '0 7 * * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/snapshot-cashflow-forecast',
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
