-- Permite que o frontend leia tiny_expires_at para detectar se Tiny está conectado.
-- O token em si (tiny_access_token, tiny_refresh_token) permanece inacessível ao frontend.
GRANT SELECT (tiny_expires_at) ON public.ml_tokens TO authenticated;
