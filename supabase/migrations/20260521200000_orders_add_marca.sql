-- Phase 16: KPIs de Marca — adiciona coluna marca em public.orders
-- Nullable: não quebra orders existentes nem o upsert atual.
-- Populada pelo sync-ml-orders v6 via ML API /items?ids=...

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS marca TEXT;

COMMENT ON COLUMN public.orders.marca IS
  'Marca do produto extraída de ML API /items?ids=... (atributo BRAND). Populada a partir de sync-ml-orders v6.';
