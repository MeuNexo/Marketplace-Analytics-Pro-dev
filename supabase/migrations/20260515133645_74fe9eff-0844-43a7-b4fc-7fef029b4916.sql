-- Add UF origem and ICMS interestadual fields to ml_tax_config
ALTER TABLE public.ml_tax_config
  ADD COLUMN IF NOT EXISTS uf_origem text,
  ADD COLUMN IF NOT EXISTS lr_icms_aliquota_intra numeric,
  ADD COLUMN IF NOT EXISTS lr_icms_aliquota_inter_sul_sudeste numeric DEFAULT 12,
  ADD COLUMN IF NOT EXISTS lr_icms_aliquota_inter_norte_nordeste numeric DEFAULT 7;

-- Add per-order snapshot columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS custo_unit numeric,
  ADD COLUMN IF NOT EXISTS tax_rate  numeric,
  ADD COLUMN IF NOT EXISTS tax_amount numeric,
  ADD COLUMN IF NOT EXISTS uf_origem text;