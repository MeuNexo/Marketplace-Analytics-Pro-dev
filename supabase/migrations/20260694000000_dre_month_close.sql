-- Phase 94: dre_month_close — single source of truth for the DRE regime
-- switch (PREVISAO vs APURACAO) per organization + sale-month.
--
-- Design (94-CONTEXT.md, LOCKED with Wesley 2026-07-11):
--   - Presence-of-row semantics: a row for (organization_id, competence_month)
--     means that sale-month is CLOSED (APURACAO: CMV cheio + guias reais of
--     imposto). Absence means OPEN (PREVISAO: CMV medio + imposto estimado).
--   - Reopen = DELETE the row (no UPDATE policy, no soft-toggle column) —
--     matches the literal "mes SEM registro -> previsao" phrasing.
--   - Trigger is a manual owner click, NEVER automatic — the "3 guias
--     lancadas" signal is display-only (empurraozinho), not a gate on this
--     table. No trigger/function/automatic-close logic lives here.
--   - competence_month stores the SALE month S ("YYYY-MM-01"), the SAME value
--     already used elsewhere as p_month/billingMonth — NEVER the guia's M+1.
--     The M+1 shift (sale-month M's imposto = guia with competence_date=M+1)
--     lives in the frontend/hook layer that reads get_imposto_guia_by_competence,
--     not in this table.
--
-- RLS is cloned VERBATIM from supabase/migrations/20260515120000_ml_tax_config.sql
-- (same CLAUDE.md fiscal-module domain, not a cross-domain borrow):
--   - SELECT: any org member (is_org_member)
--   - INSERT/DELETE: owner only (get_org_role = 'owner')
--   - NO UPDATE policy — reopen is a DELETE, not an update.
--
-- This migration modifies NO existing RPC. get_dre_operational_by_competence,
-- get_cost_waterfall, and get_cashflow are left byte-identical — zero
-- regression on Phase 88 previsao math and the DFC (SC6).
--
-- Apply ONLY via Supabase MCP `apply_migration` on project ckcdevcxgvueywivefgx
-- (NOT the CLAUDE.md project id gionpsuunfkkzzjdubfy, NOT `supabase db push` —
-- no CLI token in this environment). This file is written into the repo as
-- source of truth and applied to prod by the orchestrator at the plan's
-- blocking checkpoint (same repo-history reconciliation pattern already used
-- in 20260692000000).

-- ─── Table ────────────────────────────────────────────────────────────────────
create table public.dre_month_close (
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  competence_month date        NOT NULL,          -- "YYYY-MM-01", SALE month (S), never the guia's M+1
  closed_at        timestamptz NOT NULL DEFAULT now(),
  closed_by        uuid        NULL,              -- auth.uid() of the owner who clicked; no FK (ml_claim_templates convention)

  PRIMARY KEY (organization_id, competence_month)
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.dre_month_close ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the organisation can read close state
CREATE POLICY "dre_month_close select"
  ON public.dre_month_close FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT: owner only (close the month)
CREATE POLICY "dre_month_close insert"
  ON public.dre_month_close FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner');

-- DELETE: owner only (reopen the month)
CREATE POLICY "dre_month_close delete"
  ON public.dre_month_close FOR DELETE TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner');

-- No UPDATE policy: reopening a month is a DELETE, not an UPDATE, per the
-- locked "mes SEM registro -> previsao" presence semantics (94-CONTEXT.md).
