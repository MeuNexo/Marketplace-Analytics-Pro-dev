-- Phase 14: indexes for useMLOrders hook queries
-- orders table already exists (drift from before migration tracking)
-- these indexes make period+org+ml_user_id queries efficient

CREATE INDEX IF NOT EXISTS idx_orders_org_mluser_date
  ON public.orders (organization_id, ml_user_id, data_pedido);

CREATE INDEX IF NOT EXISTS idx_orders_org_status_date
  ON public.orders (organization_id, status, data_pedido);
