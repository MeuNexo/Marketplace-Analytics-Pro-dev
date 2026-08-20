-- ── pg_cron: regime corrente do rebate por pedido (mode=daily) ──────────────
--
-- Fase 223, plano 223-04. O rebate com o desconto por participação em
-- campanha comercial (`sale_fee.rebate`) só existe no endpoint por pedido
-- (`/billing/integration/group/ML/order/details`) — não aparece na varredura
-- de período que `sync-ml-billing` já faz. Este cron mantém o regime
-- CORRENTE alimentado depois que o backfill (D-223-02: só 2026) tiver
-- terminado.
--
-- CUSTO MEDIDO DO REGIME CORRENTE: ~30 pedidos por dia na Pé Vermeio
-- (223-CONTRATO-SALE-FEE.md) — cabe folgadamente em UMA chamada por dia
-- (teto de 60 order_ids por chamada, D-223-05). A janela do modo `daily` na
-- edge function é "últimos 3 dias até amanhã" — não "só hoje" — porque um
-- pedido pago ontem pode não ter fechado a linha de faturamento ainda; três
-- dias de sobreposição custam zero chamada extra: o pedido já capturado
-- (status "ok" em `ml_order_sale_fee_captura`) nunca reentra num lote
-- (D-223-05, `classificarCaptura`).
--
-- POR QUE DIÁRIO, E NÃO HORÁRIO: a própria documentação do ML
-- (ML-BILLING-API-DOC.txt, "Resumo das Boas Práticas") diz para usar estes
-- recursos "apenas para conciliação fiscal, não como fonte de dados
-- operacionais" — quem quer o pedido em tempo real usa `GET /orders`, não
-- este endpoint. Rebate por campanha comercial não muda de hora em hora
-- depois que a venda fechou; uma vez ao dia é a cadência que a doc recomenda
-- ("Uma chamada por seller, uma vez ao dia").
--
-- POR QUE 07:40 UTC — DESLOCADO do agendamento de `sync-ml-billing`
-- (`sync-ml-billing-prev-month`, dias 6-12 às 08:00 UTC,
-- 20260684000000_sync_ml_billing_cron.sql): duas ingestões contra o mesmo IP
-- no mesmo minuto é exatamente o padrão que a doc chama de "uso inadequado"
-- (batch/paralelismo). 07:40 fica antes do billing e fora da janela em que
-- `sync-ml-orders`/ads costumam rodar — sem coordenação fina, só sem colidir
-- no mesmo minuto.
--
-- Corpo `{"mode":"daily"}` SEM `ml_user_id` — o leque sobre as contas
-- habilitadas acontece DENTRO da edge function, lendo
-- `ml_sale_fee_sync_config` (D-223-02/D-223-03: quais contas entram e desde
-- quando é DADO, não constante em código nem neste cron).
--
-- Pré-requisito Pattern B (vault.secrets name='service_role_key' com
-- sb_secret_*) já satisfeito pelas migrations 20260618110000 e 20260618115000
-- — mesmo segredo que `sync-ml-billing-prev-month` já usa.
--
-- NUNCA via SQL Editor — somente esta migration versionada
-- (regra feedback_no_drift_via_sql_editor).
--
-- Idempotente: unschedule (tolera inexistência) e depois schedule.
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
--
-- APLICAÇÃO É PORTÃO DO ORQUESTRADOR: este plano só escreve o arquivo.
-- Aplicar via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` é
-- passo do 223-08 — nem esta migration nem a edge function foram publicadas
-- por este plano.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  PERFORM cron.unschedule('sync-ml-order-sale-fee-diario');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-ml-order-sale-fee-diario',
  '40 7 * * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-order-sale-fee',
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
