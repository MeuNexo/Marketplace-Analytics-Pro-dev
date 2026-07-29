-- Phase 106 (MEM-CONV-01 / MEM-RLS-01): conversas persistidas do Consultor Nexo.
--
-- Revê a decisão NEXO-04 da Phase 57 (histórico efêmero, client-held): a conversa passa
-- a viver no banco, o servidor vira a autoridade do histórico e o cliente deixa de
-- reenviar a conversa inteira a cada turno (crescimento sem limite + superfície de
-- injeção).
--
-- RLS clonada do padrão org-first auditado em ml_mco_targets
-- (20260719000000_ml_mco_targets.sql), com UM aperto adicional:
--   a conversa é PESSOAL — além de ser membro da org, o usuário só enxerga as
--   próprias conversas (user_id = auth.uid()). Um membro não lê o chat do outro.
--
-- organization_id nunca vem do cliente: is_org_member/get_org_role sempre resolvem
-- por auth.uid() (anti-IDOR).

CREATE TABLE public.nexo_conversations (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL,
  title           text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz NULL
);

CREATE TABLE public.nexo_messages (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid        NOT NULL REFERENCES public.nexo_conversations(id) ON DELETE CASCADE,
  -- desnormalizado de propósito: deixa a policy de RLS direta, sem join na leitura
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('user', 'model')),
  content         text        NOT NULL,
  used_tools      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nexo_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexo_messages      ENABLE ROW LEVEL SECURITY;

-- ── nexo_conversations ──────────────────────────────────────────────────────
-- SELECT: membro da org E dono da conversa.
CREATE POLICY "nc_select"
  ON public.nexo_conversations
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND user_id = auth.uid()
    AND public.is_org_member(auth.uid(), organization_id)
  );

-- INSERT: owner/admin/member da org, sempre como dono da própria conversa.
-- viewer é default-deny (sem policy = sem acesso).
CREATE POLICY "nc_insert"
  ON public.nexo_conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND user_id = auth.uid()
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

-- UPDATE (renomear/arquivar): USING e WITH CHECK idênticos p/ evitar escalada via USING.
CREATE POLICY "nc_update"
  ON public.nexo_conversations
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND user_id = auth.uid()
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND user_id = auth.uid()
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

CREATE POLICY "nc_delete"
  ON public.nexo_conversations
  FOR DELETE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND user_id = auth.uid()
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

-- ── nexo_messages ───────────────────────────────────────────────────────────
-- Herdam o gate da conversa: o EXISTS já aplica dono + membership.
CREATE POLICY "nm_select"
  ON public.nexo_messages
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.nexo_conversations c
      WHERE c.id = nexo_messages.conversation_id
        AND c.user_id = auth.uid()
        AND public.is_org_member(auth.uid(), c.organization_id)
    )
  );

CREATE POLICY "nm_insert"
  ON public.nexo_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.nexo_conversations c
      WHERE c.id = nexo_messages.conversation_id
        AND c.user_id = auth.uid()
        AND public.get_org_role(auth.uid(), c.organization_id)
            = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
    )
  );

CREATE POLICY "nm_delete"
  ON public.nexo_messages
  FOR DELETE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.nexo_conversations c
      WHERE c.id = nexo_messages.conversation_id
        AND c.user_id = auth.uid()
        AND public.get_org_role(auth.uid(), c.organization_id)
            = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
    )
  );

-- Mensagem é registro de conversa: não se edita depois de gravada (sem policy de UPDATE).

CREATE INDEX IF NOT EXISTS idx_nexo_conversations_org_user_updated
  ON public.nexo_conversations (organization_id, user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_nexo_messages_conversation_created
  ON public.nexo_messages (conversation_id, created_at);
