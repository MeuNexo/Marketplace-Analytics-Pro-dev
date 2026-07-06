-- RPC que lê o secret do webhook do vault (vault não é exposto via PostgREST).
-- SECURITY DEFINER (roda como postgres p/ acessar vault); executável só por service_role.
-- Pré-requisito (aplicado fora de migration, via vault): secret 'ml_webhook_secret' existe.
CREATE OR REPLACE FUNCTION public.get_ml_webhook_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ml_webhook_secret' LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_ml_webhook_secret() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ml_webhook_secret() TO service_role;
