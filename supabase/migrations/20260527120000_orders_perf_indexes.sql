-- Index combinado status + data_pedido.
-- Todos os filtros principais incluem status IN ('paid','shipped','delivered')
-- e um range de data_pedido — esse index cobre os dois juntos.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_data_pedido
  ON public.orders (status, data_pedido DESC)
  WHERE status IN ('paid', 'shipped', 'delivered');

-- Index parcial para ml_user_id + data_pedido (filtros multi-account)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_data_pedido
  ON public.orders (ml_user_id, data_pedido DESC);
