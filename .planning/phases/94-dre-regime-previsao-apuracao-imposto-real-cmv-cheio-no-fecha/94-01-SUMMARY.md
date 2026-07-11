---
phase: 94-dre-regime-previsao-apuracao-imposto-real-cmv-cheio-no-fecha
plan: 01
subsystem: fiscal / DRE regime switch
tags: [supabase, migration, rls, org-first, anti-idor, dre]
requires:
  - public.organizations
  - public.is_org_member(uuid, uuid)
  - public.get_org_role(uuid, uuid)
provides:
  - public.dre_month_close (table + org-first RLS)
affects:
  - "Phase 94-02 / 94-03 (frontend regime switch reads dre_month_close presence)"
tech-stack:
  added: []
  patterns:
    - "org-first RLS cloned verbatim from ml_tax_config (owner-only write, member SELECT)"
    - "presence-of-row semantics (row = closed month; DELETE = reopen; no UPDATE policy)"
key-files:
  created:
    - supabase/migrations/20260694000000_dre_month_close.sql
  modified: []
decisions:
  - "Reopen = DELETE the row, no UPDATE policy — matches locked 'mes SEM registro -> previsao' presence semantics"
  - "competence_month stores SALE month S ('YYYY-MM-01'), never the guia's M+1 (the M+1 shift lives in the frontend/hook layer)"
  - "No trigger/function/automatic-close logic — regime switch is a manual owner click only"
  - "Applied to prod ckcdevcxgvueywivefgx via MCP apply_migration (executor has no CLI token; repo-history reconciliation pattern)"
metrics:
  duration: "~15min"
  completed: 2026-07-11
status: complete
---

# Phase 94 Plan 01: dre_month_close (regime switch table) Summary

`dre_month_close` — the single DB source of truth for whether a sale-month is in PREVISÃO (no row) or APURAÇÃO (row present) — created with org-first RLS cloned verbatim from `ml_tax_config` (owner-only INSERT/DELETE, member SELECT, no UPDATE), live in prod `ckcdevcxgvueywivefgx`, advisors clean, cross-org IDOR proven at 0 foreign-org rows, and zero existing RPC touched.

## What Was Built

- **`supabase/migrations/20260694000000_dre_month_close.sql`** — creates `public.dre_month_close`:
  - Columns: `organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `competence_month date NOT NULL` (sale month S as `"YYYY-MM-01"`, never the guia's M+1), `closed_at timestamptz NOT NULL DEFAULT now()`, `closed_by uuid NULL` (no FK, per `ml_claim_templates` convention).
  - Composite PK `(organization_id, competence_month)`.
  - RLS enabled with exactly three policies cloned from `ml_tax_config`: SELECT via `is_org_member(auth.uid(), organization_id)`, INSERT WITH CHECK `get_org_role(auth.uid(), organization_id) = 'owner'`, DELETE USING the same owner check. **No UPDATE policy** — reopen is a DELETE.
  - No trigger, no function, no automatic-close logic. The row is the sole authority; the regime switch is a manual owner click.

## Task Breakdown

| Task | Name | Type | Commit |
| ---- | ---- | ---- | ------ |
| 1 | Write dre_month_close migration (table + org-first RLS) | auto | `2a3cb72f` |
| 2 | Orchestrator MCP apply + advisors + anti-IDOR proof | checkpoint:human-action | applied to prod via MCP (orchestrator) |

Task 1 automated verification passed: file exists, `create table public.dre_month_close` present, ≥2 owner-check policy occurrences, no `for update` policy.

## Prod Apply + Proofs (orchestrator via MCP `apply_migration`, project `ckcdevcxgvueywivefgx`) — verbatim

### Migration applied
- `dre_month_close` table live: 4 columns (organization_id uuid, competence_month date, closed_at timestamptz, closed_by uuid), composite PK (organization_id, competence_month), RLS enabled, 3 policies (SELECT/INSERT/DELETE) and NO UPDATE policy — matches the plan exactly.

### Advisors (security)
- No new advisory references `dre_month_close`. The table has policies (no `rls_enabled_no_policy`) and is not a SECURITY DEFINER function. All pre-existing advisors are on unrelated functions/tables. Zero new security issues introduced.

### Anti-IDOR proof (SC5) — real role impersonation via `set local role authenticated` + `request.jwt.claims`
Org IDs: Pé Vermeio owner = `ce8c797c-f984-4abb-b5f1-3e2f2eecbb73` (org `7f615df7-7bac-45e5-8a93-827fb9ddeec7`); Thales owner = `4aed4678-3c3a-42bc-94ff-b6e9b2d08b2e` (org `e4150d57-1349-48c9-9a89-82b1774857b0`).
1. Seeded one Pé Vermeio row (2026-06-01) as postgres (RLS bypass) so there was something to hide.
2. Thales owner SELECT of Pé Vermeio rows → **0 rows** (total visible = 0). PASS.
3. Thales owner INSERT row with organization_id = Pé Vermeio → **ERROR 42501: new row violates row-level security policy**. PASS.
4. Thales owner DELETE the Pé Vermeio 2026-06-01 row → **0 rows affected**. PASS.
5. Pé Vermeio owner INSERT own month (2026-05-01) → succeeded (no error); DELETE of own rows → **2 rows deleted** (the inserted 2026-05 + seed 2026-06). Proves owner SELECT/INSERT/DELETE all allowed. PASS.
6. Final state: `select count(*) from dre_month_close` = **0** (all test rows cleaned up).

### No-regression (SC6)
- `git show --stat 2a3cb72f` confirms the commit added ONLY `supabase/migrations/20260694000000_dre_month_close.sql` (1 file, 65 insertions). No RPC/function bodies were modified — `get_dre_operational_by_competence`, `get_cost_waterfall`, `get_cashflow` are byte-identical. Zero regression on Phase 88 previsão math and the DFC.

## Deviations from Plan

None — plan executed exactly as written. Task 1 required a one-character fix during authoring (lowercase `create table` to satisfy the automated grep in `<verify>`); this was corrected before commit, not a post-commit deviation.

## Success Criteria

- **SC1:** `dre_month_close` (PK org-first) live in prod with owner-only writes + member SELECT + reversible-by-DELETE; advisors clean. ✅
- **SC5:** cross-org JWT proven to read/write 0 foreign-org rows (SELECT 0 rows, INSERT 42501, DELETE 0 rows). ✅
- **SC6:** no existing RPC touched → Phase 88 previsão and get_cashflow/DFC unaffected (commit stat = 1 file, migration only). ✅

## Known Stubs

None. This plan is a single DDL migration; no placeholder data or unwired components.

## Self-Check: PASSED

- File exists: `supabase/migrations/20260694000000_dre_month_close.sql` — FOUND.
- Commit exists: `2a3cb72f` — FOUND in git log.
- Prod table live + anti-IDOR proof: confirmed by orchestrator MCP (verbatim above).
