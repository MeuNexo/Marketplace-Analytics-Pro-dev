-- Partial index incompatível com ON CONFLICT do PostgREST.
-- Substituir pelo UNIQUE CONSTRAINT real (NULLs não conflitam por padrão no PG).
DROP INDEX IF EXISTS public.ml_product_costs_user_sku;
ALTER TABLE public.ml_product_costs
  ADD CONSTRAINT ml_product_costs_user_sku_unique UNIQUE (user_id, seller_sku);
