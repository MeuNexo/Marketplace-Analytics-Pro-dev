-- Adiciona seller_sku em ml_product_daily_cache para join com ml_product_costs (formato Tiny)
ALTER TABLE public.ml_product_daily_cache
  ADD COLUMN IF NOT EXISTS seller_sku text;
