-- CONF-03 (milestone Consolidação) — religar o enriquecimento de contas a pagar.
--
-- CONTEXTO
-- Em 2026-07-20, durante um incidente de CPU/IO no Supabase, dois crons foram
-- pausados a pedido do Wesley. A causa raiz do incidente era uma query sem
-- índice em `ml_webhook_events`, do `ml-webhook`.
--
-- Essa causa NÃO EXISTE MAIS: em 2026-07-31 a infraestrutura de webhook foi
-- removida por completo — Edge Function e tabela (486 MB) dropadas. O motivo
-- da pausa caducou.
--
-- O QUE QUEBROU EM SILÊNCIO
-- O pipeline é: enrich_enqueue_new (enfileira) → enrich_payable_step (processa).
-- O enqueue continuou rodando a cada 30 min; o processador saiu do ar. Em
-- 31/07 a fila tinha 168 lançamentos parados — o mais antigo de 20/07,
-- exatamente o dia da pausa, e o último processado foi 17/07.
--
-- IMPACTO MEDIDO
-- Os 168 travados não têm competence_date, então ficam FORA da DRE por
-- competência. Julho/2026 sozinho tem 7 lançamentos, R$ 47.510,60. Maio e
-- junho não são afetados (verificado — a DRE validada em 31/07 continua boa).
--
-- CADÊNCIA
-- O par original (`treasury_cat_drain`, `treasury_cat_harvest`) rodava a cada
-- MINUTO. Aqui vai deliberadamente mais devagar: a cada 5 minutos, lote de 10.
-- Razão: um teste manual com lote 5 já tomou um 429 do Tiny. Este banco teve
-- dois incidentes de produção em três semanas (disco em 10/07, CPU em 20/07);
-- religar mais lento e observar é mais barato que religar rápido e derrubar.
--
-- Com 168 na fila e 10 por rodada a cada 5 min, a fila drena em ~1h30.
-- Quando vazia, a função sai com fired=0 — custo desprezível.
--
-- REVERSÃO
--   SELECT cron.unschedule('treasury_cat_step');

SELECT cron.unschedule('treasury_cat_step')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'treasury_cat_step');

SELECT cron.schedule(
  'treasury_cat_step',
  '*/5 * * * *',
  $$SELECT public.enrich_payable_step(10);$$
);
