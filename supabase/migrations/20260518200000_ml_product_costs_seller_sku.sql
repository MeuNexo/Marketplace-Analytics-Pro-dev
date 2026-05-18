-- Add seller_sku to ml_product_costs for CSV/XLSX bulk import by internal SKU
ALTER TABLE public.ml_product_costs
  ADD COLUMN IF NOT EXISTS seller_sku text DEFAULT NULL;
