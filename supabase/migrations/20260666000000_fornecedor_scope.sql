-- ============================================================
-- Phase 66 — Compras v2: Override por Fornecedor (fundação de dados)
-- ============================================================
-- 1) purchase_orders ganha `fornecedor` (nome do contato da OC no Tiny).
--    A EF sync-tiny-purchase-orders passa a gravar contato.nome.
-- 2) replenishment_params aceita scope 'fornecedor' (além de global/marca/sku).
--    Precedência na RPC: sku > fornecedor > marca > global.
-- ============================================================

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS fornecedor TEXT;

ALTER TABLE public.replenishment_params DROP CONSTRAINT IF EXISTS replenishment_params_scope_check;
ALTER TABLE public.replenishment_params
  ADD CONSTRAINT replenishment_params_scope_check
  CHECK (scope = ANY (ARRAY['global'::text, 'marca'::text, 'sku'::text, 'fornecedor'::text]));
