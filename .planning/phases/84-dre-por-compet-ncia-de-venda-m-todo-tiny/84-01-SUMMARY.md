---
phase: 84-dre-por-compet-ncia-de-venda-m-todo-tiny
plan: 01
subsystem: database
tags: [supabase, postgres, migration, types, ml_billing_daily]

# Dependency graph
requires:
  - phase: 84-RESEARCH
    provides: "Pattern 1 (same-migration backfill), Pattern 2 (widen UNIQUE via dynamic DO-block), confirmation ml_billing_daily absent from types.ts"
provides:
  - "supabase/migrations/20260685000000_ml_billing_daily_competence_date.sql (authored, not applied) — competence_date column + backfill + widened UNIQUE + supporting index"
  - "ml_billing_daily fully registered in src/integrations/supabase/types.ts (Row/Insert/Update/Relationships), previously completely absent"
affects: ["84-02 (EF aggregateInvoice change)", "84-03 (hook/UI competence_date filter)", "84-04 (MCP apply_migration gate)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent ALTER TABLE ADD COLUMN + same-migration backfill (zero-width NULL gap) before SET NOT NULL"
    - "Widening a UNIQUE constraint via dynamic pg_constraint lookup in a DO-block instead of hardcoding an auto-generated/truncated constraint name"

key-files:
  created:
    - supabase/migrations/20260685000000_ml_billing_daily_competence_date.sql
  modified:
    - src/integrations/supabase/types.ts

key-decisions:
  - "competence_date typed as required (non-optional) in Row per plan spec, since the migration SETs it NOT NULL; kept optional in Insert/Update mirroring other date columns in this table's shape"
  - "New constraint explicitly named ml_billing_daily_uniq (replaces the auto-generated/truncated original) so future migrations can reference it safely"
  - "Reworded the migration's explanatory comment to avoid the literal string ml_billing_monthly, satisfying the plan's exact acceptance-criteria grep (== 0 occurrences) while still documenting that the monthly/fatura track is untouched"

patterns-established:
  - "Migration authored but not applied — actual apply_migration execution deferred to a separate MCP-driven plan (84-04) per this project's established deploy-gate convention"

requirements-completed: []

# Metrics
duration: 12min
completed: 2026-07-03
status: complete
---

# Phase 84 Plan 01: Schema foundation for DRE por Competência de Venda Summary

**Authored (not applied) migration adding `competence_date` to `ml_billing_daily` with same-transaction backfill and a dynamically-widened UNIQUE constraint, plus the table's first-ever entry in `types.ts`.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-03T17:24:00Z
- **Completed:** 2026-07-03T17:36:29Z
- **Tasks:** 2/2 completed
- **Files modified:** 2

## Accomplishments
- New migration `supabase/migrations/20260685000000_ml_billing_daily_competence_date.sql` — adds `competence_date DATE`, backfills every existing row to `charge_date` in the same migration (no NULL window), sets `NOT NULL`, drops the old 5-column auto-generated UNIQUE constraint (found dynamically via `pg_constraint`, never hardcoded) and replaces it with a 6-column `ml_billing_daily_uniq` that keeps `organization_id`/`ml_user_id` as the leading columns (anti-IDOR intact), and adds `idx_ml_billing_daily_competence` to support the new mês-calendário range filter.
- `ml_billing_daily` — previously completely absent from `src/integrations/supabase/types.ts` (table existed in Postgres since 2026-06-13 but had zero compile-time typing) — is now fully registered with Row/Insert/Update/Relationships mirroring the `ml_billing_monthly` shape, including the new `competence_date` column.
- This is authoring-only: nothing was applied to the live Supabase project (`ckcdevcxgvueywivefgx`). Actual `apply_migration` execution is deferred to plan 84-04, which runs via MCP with a service-role token this executor does not have.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration — ADD COLUMN competence_date + backfill + widen UNIQUE + index** - `4e96765b` (feat)
2. **Task 2: types.ts — registrar ml_billing_daily (hoje ausente) com competence_date** - `0738c280` (feat)

_No TDD tasks in this plan (schema/type authoring only, no runtime behavior to test)._

## Files Created/Modified
- `supabase/migrations/20260685000000_ml_billing_daily_competence_date.sql` - New migration: ADD COLUMN + backfill + SET NOT NULL + dynamic UNIQUE widen + supporting index
- `src/integrations/supabase/types.ts` - Added the full `ml_billing_daily` table definition (previously missing), including `competence_date`

## Decisions Made
- Followed the plan's exact column order for the widened UNIQUE constraint: `(organization_id, ml_user_id, competence_date, charge_date, charge_type, source_invoice_key)` — keeps the anti-IDOR property (org/store always the two leading columns) while adding competence granularity.
- Named the new constraint explicitly (`ml_billing_daily_uniq`) rather than leaving it auto-generated again, so a future migration touching this constraint won't need the same dynamic-lookup dance.
- In `types.ts`, inserted `ml_billing_daily` immediately before `ml_billing_monthly` to preserve the file's existing alphabetical ordering convention.

## Deviations from Plan

**1. [Rule 1 - Bug] Migration comment initially referenced the literal string `ml_billing_monthly`, failing the plan's own acceptance criterion**
- **Found during:** Task 1 self-verification (`grep -c "ml_billing_monthly" <file>` must equal `0`)
- **Issue:** My first draft of the migration's header comment explained that the "fatura" track (`ml_billing_monthly`) is untouched, using that exact table name — which the plan's acceptance criteria explicitly forbids (to guarantee no accidental cross-wiring between the two disjoint billing tracks).
- **Fix:** Reworded the comment to describe the untouched track generically ("trilha de fatura mensal separada") without naming the table literally.
- **Files modified:** `supabase/migrations/20260685000000_ml_billing_daily_competence_date.sql`
- **Verification:** `grep -c "ml_billing_monthly" <file>` → `0`; all other acceptance-criteria greps re-run and passed.
- **Committed in:** `4e96765b` (part of Task 1 commit; fixed before committing)

---

**Total deviations:** 1 auto-fixed (1 bug, self-correction before commit — did not require a separate commit)
**Impact on plan:** Cosmetic wording fix only, no functional change. No scope creep.

## Issues Encountered
None.

## Known Stubs
None — this plan is pure schema/type authoring with no UI or data-flow surface.

## Threat Flags
None — this plan matches the plan's own `<threat_model>` exactly. The widened UNIQUE constraint keeps `organization_id`/`ml_user_id` as leading columns (T-84-01, mitigated as designed) and `competence_date` introduces no new tenant-scoping surface since RLS is row-level (T-84-02, accepted as designed). No new endpoints, auth paths, or trust-boundary-crossing schema changes were introduced beyond what the plan's threat model already covers.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The migration file is ready for the MCP-driven apply gate (plan 84-04): `apply_migration` should be run against project `ckcdevcxgvueywivefgx`, and per the plan's own note, 84-04 should re-verify via `SELECT conname, contype FROM pg_constraint WHERE conrelid = 'public.ml_billing_daily'::regclass` that exactly one UNIQUE constraint exists before applying, since the DO-block's dynamic lookup assumes that invariant.
- `types.ts` now has compile-time column checking for any code written against `ml_billing_daily` (e.g., the upcoming EF aggregation change in 84-02 and the hook/UI changes in 84-03), closing the "silent gap" identified in the research (Pitfall 5).
- No blockers. This plan does not touch the Edge Function (`sync-ml-billing/index.ts`) or the frontend hook (`useMLBilling.ts`) — those are 84-02/84-03's scope per the strict deploy order (migration → EF → frontend → backfill) called out in the research.

---
*Phase: 84-dre-por-compet-ncia-de-venda-m-todo-tiny*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: supabase/migrations/20260685000000_ml_billing_daily_competence_date.sql
- FOUND: src/integrations/supabase/types.ts
- FOUND: .planning/phases/84-dre-por-compet-ncia-de-venda-m-todo-tiny/84-01-SUMMARY.md
- FOUND commit: 4e96765b
- FOUND commit: 0738c280
