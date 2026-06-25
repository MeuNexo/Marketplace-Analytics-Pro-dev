-- ── Phase 58-03: pg_cron diário re-sync ml_billing_daily do mês corrente ────────
--
-- OBJETIVO (FIN-2 da 58-AUDIT):
--   ml_billing_daily estava defasada (parou 06-12, sem cron). O Nexo usava dados
--   antigos no get_dre_monthly → divergência com o card DRE do painel que mostra
--   tarifas do mês-calendário corrente. Este cron re-sincroniza o mês corrente
--   diariamente para que o Nexo e o painel falem a mesma fonte (VERAC-04).
--
-- FONTE DO CARD DRE DO PAINEL:
--   ml_billing_daily (competência = data de lançamento, 01–fim do mês-calendário).
--   A EF sync-ml-billing mode="daily" popula esta tabela. O get_dre_monthly do
--   Nexo (após 58-03) agrega ml_billing_daily, espelhando o mesmo número.
--
-- IMPORTANTE (W-2): sync-ml-billing processa UMA LOJA POR CHAMADA.
--   Body: { ml_user_id: "<seller_id>", period_month: "YYYY-MM", mode: "daily" }
--   Por isso este job itera TODOS os ml_user_id com token ativo e dispara um
--   net.http_post por loja. Não é possível uma única chamada para todas as lojas.
--
-- AUTH (Pattern B — Bearer service_role_key via vault.decrypted_secrets):
--   sync-ml-billing autentica: `token === SUPABASE_SERVICE_ROLE_KEY`.
--   O vault.decrypted_secrets deve ter name = 'service_role_key' com o sb_secret_*.
--   PRÉ-REQUISITO: verificar/inserir o secret no vault antes de aplicar:
--     SELECT name FROM vault.secrets WHERE name = 'service_role_key';
--     -- Se ausente:
--     SELECT vault.create_secret('<sb_secret_value>', 'service_role_key',
--            'Service role key para pg_cron');
--
-- IDEMPOTENTE: unschedule (ignora erro) + CREATE OR REPLACE da função auxiliar.
-- Supabase project: ckcdevcxgvueywivefgx.
--
-- ⚠️  NÃO APLICAR MANUALMENTE:
--   Esta migration é aplicada pelo orquestrador via MCP (apply_migration) no
--   checkpoint 58-06. O executor do plano 58-03 apenas ESCREVE o arquivo.
-- ──────────────────────────────────────────────────────────────────────────────

-- Função auxiliar: dispara um net.http_post por ml_user_id ativo para re-sincronizar
-- o ml_billing_daily do mês corrente. Chamada pelo cron abaixo.
CREATE OR REPLACE FUNCTION public.resync_billing_daily_current_month()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'vault'
AS $$
DECLARE
  rec         record;
  v_srk       text;
  v_month     text;
  v_body      jsonb;
BEGIN
  -- mês corrente em UTC no formato YYYY-MM
  v_month := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');

  -- ler service_role_key do vault (Pattern B)
  SELECT decrypted_secret INTO v_srk
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF v_srk IS NULL THEN
    RAISE WARNING 'resync_billing_daily_current_month: service_role_key ausente no vault; abortando.';
    RETURN;
  END IF;

  -- iterar todos os ml_user_id com token ativo (W-2: uma chamada por loja)
  FOR rec IN
    SELECT DISTINCT ml_user_id
    FROM public.ml_tokens
    WHERE refresh_token IS NOT NULL
    ORDER BY ml_user_id
  LOOP
    v_body := jsonb_build_object(
      'ml_user_id',    rec.ml_user_id,
      'period_month',  v_month,
      'mode',          'daily'
    );

    PERFORM net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-billing',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_srk
      ),
      body    := v_body
    );
  END LOOP;
END $$;

-- Revogar execução pública (só o cron/service_role chama diretamente)
REVOKE EXECUTE ON FUNCTION public.resync_billing_daily_current_month() FROM PUBLIC, anon, authenticated;

-- Agendar diariamente às 06:40 UTC (após cron de brand 06:00, antes do report 07:03).
-- Horário escolhido para que ml_billing_daily do mês corrente esteja fresco
-- quando o relatório e o Nexo consultarem get_dre_monthly às 07:xx.
DO $$ BEGIN
  PERFORM cron.unschedule('billing-daily-resync');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'billing-daily-resync',
  '40 6 * * *',
  $$SELECT public.resync_billing_daily_current_month();$$
);
