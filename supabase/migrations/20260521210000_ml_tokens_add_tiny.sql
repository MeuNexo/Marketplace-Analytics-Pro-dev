-- Phase 17: Tiny ERP integration — adiciona tokens e índice de SKU em ml_product_costs

-- Tokens Tiny em ml_tokens (por ml_user_id)
ALTER TABLE public.ml_tokens
  ADD COLUMN IF NOT EXISTS tiny_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS tiny_expires_at    BIGINT;

COMMENT ON COLUMN public.ml_tokens.tiny_access_token IS
  'Access token Tiny ERP (client_credentials). Regenerado quando expirado.';
COMMENT ON COLUMN public.ml_tokens.tiny_expires_at IS
  'Unix timestamp (segundos) de expiração do tiny_access_token.';

-- Índice único em ml_product_costs por (user_id, seller_sku) para upsert do sync-tiny-costs
-- Necessário para ON CONFLICT (user_id, seller_sku) funcionar
CREATE UNIQUE INDEX IF NOT EXISTS ml_product_costs_user_sku
  ON public.ml_product_costs (user_id, seller_sku)
  WHERE seller_sku IS NOT NULL;
