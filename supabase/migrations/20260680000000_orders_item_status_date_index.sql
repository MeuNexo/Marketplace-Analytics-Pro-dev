-- Phase 80 — performance: índice por item_id para a RPC orders_price_timeseries.
--
-- A RPC filtra `WHERE item_id = _item_id AND status IN ('paid','shipped','delivered')
-- AND data_pedido BETWEEN _from AND _to`. Não havia índice com item_id como coluna
-- líder (os existentes começam por organization_id / ml_user_id / status / data_pedido),
-- então cada chamada fazia sequential scan das ~346k linhas de `orders` (~9s para 1 ano).
-- Este índice casa o filtro exato e derruba para ~200ms.
--
-- NOTA: em produção (ckcdevcxgvueywivefgx) foi aplicado com CREATE INDEX CONCURRENTLY
-- para não travar a tabela durante os syncs de pedidos. CONCURRENTLY não roda dentro de
-- transação (migrations rodam em transação), por isso o arquivo usa a forma padrão —
-- idempotente via IF NOT EXISTS (o índice concorrente já existe em prod, então é no-op lá).

CREATE INDEX IF NOT EXISTS idx_orders_item_status_date
  ON public.orders (item_id, status, data_pedido);
