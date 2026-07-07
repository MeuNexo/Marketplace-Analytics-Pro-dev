-- Phase 90-02: backfill retroativo de orders.custo_unit_cheio.
--
-- Popula custo_unit_cheio a partir de ml_product_costs.cost_full para orders
-- já existentes (recalc-order-costs com only_missing=true não recalcula
-- orders antigos que já têm custo_unit — este backfill cobre a lacuna).
--
-- Casamento por SKU (mesma chave usada em recalc-order-costs/index.ts,
-- costBySku/costFullBySku): orders.sku = ml_product_costs.seller_sku.
--
-- Idempotente: só toca linhas com custo_unit_cheio IS NULL. Respeita
-- organization_id (ou custo global sem org, se existir). Não filtra por
-- período — cobre todos os meses fechados, incluindo abril (mês de
-- reconciliação do Plan 90-04).
--
-- ⚠️ IMPORTANTE: aplicar SOMENTE APÓS o re-sync de sync-tiny-costs (Task 4,
-- passo 3) ter populado cost_full — antes disso, cost_full é NULL para todas
-- as linhas e esta migration vira no-op (sem erro, mas sem efeito).

UPDATE public.orders o
SET custo_unit_cheio = pc.cost_full
FROM public.ml_product_costs pc
WHERE o.sku = pc.seller_sku
  AND pc.cost_full IS NOT NULL
  AND o.custo_unit_cheio IS NULL
  AND (pc.organization_id IS NULL OR pc.organization_id = o.organization_id);
