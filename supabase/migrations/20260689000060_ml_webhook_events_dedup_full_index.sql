-- ON CONFLICT não infere índice PARCIAL sem repetir o predicado (PostgREST não repete),
-- então o upsert do webhook falhava silenciosamente. Troca por índice único completo:
-- NULLs em sent_at são distintos por padrão; não-nulos deduplicam. ML sempre envia `sent`.
DROP INDEX IF EXISTS public.ml_webhook_events_dedup;
CREATE UNIQUE INDEX ml_webhook_events_dedup
  ON public.ml_webhook_events (topic, resource, sent_at);
