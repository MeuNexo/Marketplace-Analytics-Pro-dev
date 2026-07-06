-- ml_webhook_events: auditoria + fila de retry das notificações do ML.
-- Grão de dedup: (topic, resource, sent_at). Service role escreve (ignora RLS);
-- membros da org leem via is_org_member.

CREATE TABLE IF NOT EXISTS public.ml_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic           text NOT NULL,
  resource        text NOT NULL,
  ml_user_id      text,
  organization_id uuid,
  status          text NOT NULL DEFAULT 'received',  -- received | processed | error | rejected
  attempts        int  NOT NULL DEFAULT 0,
  error_msg       text,
  raw             jsonb NOT NULL,
  sent_at         timestamptz,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

-- Idempotência: reenvio do ML com mesmo `sent` não cria linha nova.
CREATE UNIQUE INDEX IF NOT EXISTS ml_webhook_events_dedup
  ON public.ml_webhook_events (topic, resource, sent_at)
  WHERE sent_at IS NOT NULL;

-- Retry-cron varre presos.
CREATE INDEX IF NOT EXISTS ml_webhook_events_status_idx
  ON public.ml_webhook_events (status)
  WHERE status IN ('received', 'error');

-- Painel admin / badge de saúde.
CREATE INDEX IF NOT EXISTS ml_webhook_events_org_recv_idx
  ON public.ml_webhook_events (organization_id, received_at DESC);

ALTER TABLE public.ml_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ml_webhook_events_select_member ON public.ml_webhook_events;
CREATE POLICY ml_webhook_events_select_member
  ON public.ml_webhook_events
  FOR SELECT
  USING (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id));
