-- TENANT-04: Tabela onboarding_progress (org-scoped) + RLS.
--
-- Contexto (D-07/D-08/D-09):
--   - Owner novo, apos aceitar convite + criar org, cai direto em "/" sem orientacao.
--   - Esta tabela persiste o progresso do wizard de onboarding por organizacao,
--     permitindo retomar de onde parou entre sessoes (cross-session).
--   - O wizard tambem AUTO-DETECTA passos ja feitos a partir do estado real
--     (ml_tokens, ml_product_costs, ml_tax_config) — esta tabela guarda apenas
--     o current_step de retomada e os passos marcados manualmente como concluidos.
--
-- Modelo:
--   - organization_id  uuid PRIMARY KEY -> 1 linha por org.
--   - current_step     text NOT NULL DEFAULT 'connect_ml'
--                      valores: connect_ml | tiny | costs | fiscal | done
--   - completed_steps  text[] NOT NULL DEFAULT '{}'  (passos persistidos)
--   - completed_at     timestamptz  (preenchido quando o onboarding e concluido)
--   - updated_at       timestamptz NOT NULL DEFAULT now()
--
-- RLS (CLAUDE.md — config de onboarding restrita a owner):
--   - ob_select: qualquer membro da org pode LER o progresso (banner mostra progresso).
--   - ob_write : somente o OWNER da org pode escrever (FOR ALL) — onboarding e
--                config de organizacao, restrita a owner.
--   - Service role ignora RLS automaticamente — nenhuma policy necessaria para EFs.
--
-- Idempotencia: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS antes de recriar.
-- Seguro rodar multiplas vezes.

CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  current_step    text NOT NULL DEFAULT 'connect_ml',
  completed_steps text[] NOT NULL DEFAULT '{}',
  completed_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Garante valores validos para current_step (idempotente).
DO $$ BEGIN
  ALTER TABLE public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_current_step_check
    CHECK (current_step IN ('connect_ml', 'tiny', 'costs', 'fiscal', 'done'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "ob_select" ON public.onboarding_progress';
  EXECUTE 'DROP POLICY IF EXISTS "ob_write" ON public.onboarding_progress';
END $$;

-- SELECT: qualquer membro da org le o progresso (para exibir banner/wizard).
CREATE POLICY "ob_select"
  ON public.onboarding_progress
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- WRITE (ALL): somente owner pode inserir/atualizar/deletar o progresso.
-- onboarding e config de organizacao — restrita a owner (CLAUDE.md).
CREATE POLICY "ob_write"
  ON public.onboarding_progress
  FOR ALL
  TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role)
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role);
