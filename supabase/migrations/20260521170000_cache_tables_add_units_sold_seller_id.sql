-- Adiciona colunas faltantes nas tabelas de cache para compatibilidade
-- com a edge function mercado-libre-integration

ALTER TABLE public.ml_daily_cache
  ADD COLUMN IF NOT EXISTS units_sold integer,
  ADD COLUMN IF NOT EXISTS seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL;

ALTER TABLE public.ml_hourly_cache
  ADD COLUMN IF NOT EXISTS units_sold integer,
  ADD COLUMN IF NOT EXISTS seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL;

ALTER TABLE public.ml_product_daily_cache
  ADD COLUMN IF NOT EXISTS seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL;

ALTER TABLE public.ml_user_cache
  ADD COLUMN IF NOT EXISTS seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL;
