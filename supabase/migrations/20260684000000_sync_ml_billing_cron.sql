-- ── pg_cron: re-sync do billing (mode=daily) do mês-calendário anterior ──────
--
-- Debug sync-ml-billing-rate-limit (2026-07-03), Layer 3: nada re-sincronizava
-- ml_billing_daily do mês anterior depois que ele deixava de ser o mês corrente.
-- Combinado com a paginação por offset instável (Layer 1, corrigida na mesma
-- sessão), um sync que parava no meio (ex.: dia 12) ficava CONGELADO para
-- sempre — o guard do frontend (Layer 2) só reage quando o usuário abre a
-- página, então sem esse cron o dado só se corrige por ação manual.
--
-- Ciclo de fatura ML é 06→05 (consumo do mês N fecha na fatura N+1, disponível
-- a partir do dia ~06 do mês seguinte). Este cron roda diariamente do dia 6 ao
-- dia 12 do mês (~7 dias de janela) — cobre o atraso normal de fechamento/
-- disponibilização da fatura no ML sem depender de um dia exato.
--
-- Body {"mode":"daily"} SEM ml_user_id aciona o fan-out multi-conta da EF
-- (runAllAccountsDailySync — varre ml_tokens, service-role only) — não precisa
-- listar ml_user_id aqui; period_month não informado = mês-calendário anterior
-- (calculado dentro da EF, no momento da execução).
--
-- Pré-requisito Pattern B (vault.secrets name='service_role_key' com sb_secret_*)
-- já satisfeito pelas migrations 20260618110000 e 20260618115000.
--
-- NUNCA via SQL Editor — somente esta migration versionada
-- (regra feedback_no_drift_via_sql_editor).
--
-- Idempotente: unschedule (ignora erro se não existir) e depois schedule.
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
--
-- DEPLOY: só via MCP `apply_migration` no projeto Supabase `ckcdevcxgvueywivefgx`
-- (sem token de CLI disponível neste ambiente).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  PERFORM cron.unschedule('sync-ml-billing-prev-month');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-ml-billing-prev-month',
  '0 8 6-12 * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-billing',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := jsonb_build_object('mode', 'daily')
    ) AS request_id;
  $cmd$
);
