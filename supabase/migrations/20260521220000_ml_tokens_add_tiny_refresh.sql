-- Phase 18: add tiny_refresh_token to ml_tokens
ALTER TABLE public.ml_tokens
  ADD COLUMN IF NOT EXISTS tiny_refresh_token TEXT;
