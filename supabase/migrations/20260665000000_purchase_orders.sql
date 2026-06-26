-- ============================================================
-- Phase 65 — Estoque a Chegar: tabela purchase_orders
-- ============================================================
-- Snapshot das ordens de compra (OC) EM ABERTO do Tiny ERP, explodidas
-- por SKU (1 linha por SKU por OC). Alimenta o "a caminho" da RPC
-- get_replenishment_by_sku (Phase 65) e a coluna "A caminho" em /compras.
--
-- Origem: EF sync-tiny-purchase-orders (service role) — usuários só leem.
-- Snapshot semantics: a EF faz delete-org + insert a cada sync, então a
-- tabela reflete só as OCs atualmente em aberto (OC recebida some no próximo sync).
--
-- "A caminho" v1 = situacao '3' (aguardando recebimento). A coluna `situacao`
-- fica disponível para ampliar o critério depois (ex: incluir '2' aprovada).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL,
  ml_user_id       TEXT NOT NULL,
  id_ordem_compra  TEXT NOT NULL,
  numero_pedido    TEXT,
  sku              TEXT NOT NULL,
  descricao        TEXT,
  quantidade       NUMERIC NOT NULL DEFAULT 0,
  data_entrega     DATE,          -- previsão de entrega/faturamento (campo `data` do Tiny)
  data_pedido      DATE,          -- quando foi colocado em produção (campo `dataPrevista` do Tiny)
  situacao         TEXT,
  preco_unitario   NUMERIC,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_org_oc_sku_key UNIQUE (organization_id, id_ordem_compra, sku)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_org_sku
  ON public.purchase_orders (organization_id, sku);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

-- Leitura: membros da org (mesmo padrão de ml_inventory_cache / replenishment_params).
-- Escrita: somente service role (bypassa RLS) via a EF de sync — sem policy de write.
DROP POLICY IF EXISTS purchase_orders_select ON public.purchase_orders;
CREATE POLICY purchase_orders_select ON public.purchase_orders
  FOR SELECT USING (is_org_member(auth.uid(), organization_id));
