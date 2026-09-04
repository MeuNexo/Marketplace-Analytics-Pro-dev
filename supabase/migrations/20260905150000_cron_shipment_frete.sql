-- 239-05 — a captura de frete ganha relógio
--
-- 🔴 A EF `sync-ml-shipment-frete` NAO TINHA CRON. Ela nasceu no 239-02 e desde
-- entao so rodava quando alguem a chamava a mao — o backfill do plano. Pedido
-- novo entrava na tela sem `list_cost` e sem `custo_comprador`, e a regua da
-- 239-05 devolvia `base_sem_ponta_do_comprador` para venda recente, todo dia,
-- para sempre. Uma regua que depende de alguem lembrar de rodar nao e regua.
--
-- Orcamento: 150 pedidos por invocacao (ORCAMENTO_PADRAO). Tres passagens =
-- 450/dia, contra ~40-50 pedidos novos/dia — folga para absorver dia perdido
-- sem virar backfill eterno. A EF ja tem trava diaria por pedido, entao
-- invocacao extra nao repisa quem ja foi tentado hoje.
--
-- 07:50 fica DEPOIS de `sync-ml-order-sale-fee-diario` (07:40) de proposito: a
-- cobranca declarada e o envio sao as duas metades da mesma prova, e capturar
-- o envio antes da cobranca so adiantaria metade.

select cron.schedule(
  'sync-ml-shipment-frete-3x',
  '50 7,13,19 * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-shipment-frete',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $cron$
);
