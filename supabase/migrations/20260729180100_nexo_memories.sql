-- Phase 106 (MEM-FACT-01 / MEM-RLS-01): memória de fatos curados do Consultor Nexo.
--
-- É o análogo do MEMORY.md do Claude Code: fatos CURTOS e CURADOS, carregados no
-- system prompt a cada turno. NÃO é RAG (Fase 2 da spec Consultor CCO, adiada).
--
-- Decisões travadas por Wesley (2026-07-29) que este schema materializa:
--   1. Curadoria = o Consultor PROPÕE, o humano APROVA. Por isso o default de status é
--      'pending': a tool propose_memory nunca cria 'active'. Só a UI promove.
--   2. Fato numérico ENVELHECE. has_numbers=true marca o fato perecível — o Nexo usa
--      como pista e confirma na tool antes de afirmar qualquer número.
--   3. Escopo 'org' (fato da operação) vs 'user' (preferência pessoal).
--
-- RLS org-first clonada de ml_mco_targets. Fato de escopo 'user' só é visível ao dono.

CREATE TABLE public.nexo_memories (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope                  text        NOT NULL CHECK (scope IN ('org', 'user')),
  user_id                uuid        NULL,
  type                   text        NOT NULL CHECK (type IN ('decision', 'preference', 'context', 'reference')),
  title                  text        NOT NULL CHECK (length(btrim(title)) > 0),
  body                   text        NOT NULL CHECK (length(btrim(body)) > 0),
  -- fato perecível: contém número que envelhece (lead time, meta, patamar de venda)
  has_numbers            boolean     NOT NULL DEFAULT false,
  status                 text        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'active', 'archived')),
  source_conversation_id uuid        NULL REFERENCES public.nexo_conversations(id) ON DELETE SET NULL,
  created_by             uuid        NULL,
  approved_by            uuid        NULL,
  approved_at            timestamptz NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- scope='user' exige dono; scope='org' não tem dono individual
  CONSTRAINT nexo_memories_user_scope_requires_user
    CHECK ((scope = 'user' AND user_id IS NOT NULL) OR (scope = 'org' AND user_id IS NULL))
);

ALTER TABLE public.nexo_memories ENABLE ROW LEVEL SECURITY;

-- SELECT: membro da org vê os fatos da org; os de escopo pessoal, só o dono.
CREATE POLICY "nmem_select"
  ON public.nexo_memories
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
    AND (scope = 'org' OR user_id = auth.uid())
  );

CREATE POLICY "nmem_insert"
  ON public.nexo_memories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND (scope = 'org' OR user_id = auth.uid())
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

-- UPDATE = aprovar / editar / arquivar. USING e WITH CHECK idênticos.
CREATE POLICY "nmem_update"
  ON public.nexo_memories
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND (scope = 'org' OR user_id = auth.uid())
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND (scope = 'org' OR user_id = auth.uid())
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

CREATE POLICY "nmem_delete"
  ON public.nexo_memories
  FOR DELETE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND (scope = 'org' OR user_id = auth.uid())
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

-- Leitura do turno: só os fatos ativos da org. Índice parcial mantém barato.
CREATE INDEX IF NOT EXISTS idx_nexo_memories_org_active
  ON public.nexo_memories (organization_id, updated_at DESC)
  WHERE status = 'active';

-- Fila de aprovação da UI.
CREATE INDEX IF NOT EXISTS idx_nexo_memories_org_status
  ON public.nexo_memories (organization_id, status);
