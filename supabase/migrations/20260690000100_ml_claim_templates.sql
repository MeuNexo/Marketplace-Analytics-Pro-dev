-- Phase 90 Plan 02: ml_claim_templates — "Mensagens rápidas" shared library
-- Analog: supabase/migrations/20260515120000_ml_tax_config.sql
--   (per-verb RLS policies with explicit WITH CHECK on writes)
-- CRUD happens directly through the authenticated Supabase client — no EF,
-- so RLS is the ONLY guard against cross-org access (anti-IDOR).

CREATE TABLE public.ml_claim_templates (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title            text        NOT NULL,
  body             text        NOT NULL,
  created_by       uuid        NULL,          -- auth.uid() of the creator; no FK, informational only
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_claim_templates_org
  ON public.ml_claim_templates (organization_id);

ALTER TABLE public.ml_claim_templates ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the organisation
CREATE POLICY "ml_claim_templates select"
  ON public.ml_claim_templates FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT: any member of the organisation; WITH CHECK stops a forged organization_id
CREATE POLICY "ml_claim_templates insert"
  ON public.ml_claim_templates FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- UPDATE: any member of the organisation; USING guards the target row,
-- WITH CHECK stops re-parenting the row to another org
CREATE POLICY "ml_claim_templates update"
  ON public.ml_claim_templates FOR UPDATE TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- DELETE: any member of the organisation
CREATE POLICY "ml_claim_templates delete"
  ON public.ml_claim_templates FOR DELETE TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
