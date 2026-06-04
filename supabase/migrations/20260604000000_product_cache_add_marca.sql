-- Adiciona coluna marca em ml_product_daily_cache para suportar
-- brand charts sem depender de sync-ml-orders/orders table.
ALTER TABLE public.ml_product_daily_cache
  ADD COLUMN IF NOT EXISTS marca text;
