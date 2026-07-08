---
phase: 86-dre-compet-ncia-no-contas-a-pagar
plan: 01
subsystem: database
tags: [postgres, plpgsql, supabase, cash-outflows, enrichment-pipeline, dre]

# Dependency graph
requires:
  - phase: 61-treasury-category-supplier-enrichment
    provides: enrich_enqueue_new / enrich_payable_step / enrich_harvest single-writer pipeline for category+supplier on cash_outflows
  - phase: 60-fluxo-caixa-correcoes-dfc-alignment
    provides: outflow_date-based DFC reconciled to the centavo (must remain untouched)
provides:
  - "supabase/migrations/20260686000000_cash_outflows_competence_date.sql — authored, self-consistent, gate-passed migration (NOT YET APPLIED TO PROD)"
  - "competence_date column definition (nullable date) for cash_outflows"
  - "widened enrich_enqueue_new WHERE predicate (OR co.competence_date IS NULL) so already-enriched rows re-enter the backfill queue"
  - "enrich_payable_step / enrich_harvest updated identically to parse Tiny dataCompetencia (YYYY-MM) into competence_date in the same UPDATE as category/supplier"
affects: [87-dre-rpc-aggregation, 88-dre-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-writer enrichment pattern (Phase 61) extended to a third column (competence_date) without a new pipeline"
    - "YYYY-MM to date(first-of-month) parsing via NULLIF(TRIM(...),'') guard + to_date(text || '-01','YYYY-MM-DD') — never a raw ::date cast"

key-files:
  created:
    - supabase/migrations/20260686000000_cash_outflows_competence_date.sql
  modified: []

key-decisions:
  - "Migration transcribes 86-RESEARCH.md's Migration skeleton verbatim, using the DEPLOYED Phase 61 function bodies (20260661000000) as the base for every CREATE OR REPLACE — confirmed identical before editing, so no existing behavior was dropped"
  - "competence_date is purely additive: new nullable column + new composite index (organization_id, competence_date, category); existing outflow_date index and get_cashflow untouched"
  - "Both enrich_payable_step AND enrich_harvest updated identically (Pitfall 3 from research — uncertain which one prod's treasury_cat_tick cron actually calls)"
  - "REVOKE EXECUTE FROM PUBLIC, anon, authenticated re-issued for all 3 SECURITY DEFINER functions in this migration (T-86-02) since CREATE OR REPLACE does not reliably preserve prior REVOKEs"

requirements-completed: [SC-1, SC-2, SC-5]

# Metrics
duration: ~15min
completed: 2026-07-08
status: blocked-checkpoint
---

# Phase 86 Plan 01: Competence-date migration (authored, pending prod apply) Summary

**Authored the `competence_date` migration for `cash_outflows` (nullable column + additive composite index + 3 single-writer enrichment functions updated to parse Tiny `dataCompetencia`) — file is committed but NOT yet applied to prod; Task 2 (MCP `apply_migration` + schema confirmation) is a blocking checkpoint reserved for the orchestrator.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-08T (see commit timestamp)
- **Tasks:** 1 of 2 completed by this executor (Task 1: auto). Task 2 is `type="checkpoint:human-verify" gate="blocking"` and requires Supabase MCP tools this executor does not have access to.
- **Files modified:** 1 (new migration file)

## Accomplishments

- Read the current deployed Phase 61 migration (`supabase/migrations/20260661000000_enrich_supplier_category.sql`) and confirmed its three function bodies (`enrich_enqueue_new`, `enrich_payable_step`, `enrich_harvest`) match the 86-RESEARCH.md skeleton exactly — used as the verified base, no invented signatures.
- Authored `supabase/migrations/20260686000000_cash_outflows_competence_date.sql`:
  1. `ALTER TABLE public.cash_outflows ADD COLUMN IF NOT EXISTS competence_date date;` (nullable, additive).
  2. `CREATE INDEX IF NOT EXISTS cash_outflows_org_competence_category_idx ON public.cash_outflows (organization_id, competence_date, category);` — additive; the existing `outflow_date`-based index is untouched.
  3. `CREATE OR REPLACE FUNCTION public.enrich_enqueue_new()` — WHERE widened with `OR co.competence_date IS NULL` so rows already enriched with category/supplier (from Phase 61) re-enter `cat_backfill_queue` and get their competence backfilled.
  4. `CREATE OR REPLACE FUNCTION public.enrich_payable_step(integer)` and `CREATE OR REPLACE FUNCTION public.enrich_harvest()` — both add a `v_competence date` local, parsed null-safe (`NULLIF(TRIM(COALESCE(v_content->>'dataCompetencia','')),'')` guard, then `to_date(... || '-01','YYYY-MM-DD')` — never a raw `::date` cast), and write `competence_date = v_competence` in the SAME `UPDATE public.cash_outflows` statement that already sets `category`/`supplier`.
  5. Re-issued `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated` for all three functions.
- Ran the plan's automated verification gate — passed (`MIGRATION_OK`).
- Committed the migration file atomically.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the competence_date migration file** - `5b2393b5` (feat)

Task 2 (`checkpoint:human-verify`, `gate="blocking"`) was NOT executed by this agent — see "CHECKPOINT PENDING" below.

## Files Created/Modified
- `supabase/migrations/20260686000000_cash_outflows_competence_date.sql` - New migration: `competence_date` column, additive index, 3 `CREATE OR REPLACE` enrichment functions, 3 `REVOKE EXECUTE` statements. Header comment states explicitly: apply via MCP `apply_migration` on `ckcdevcxgvueywivefgx`, never `supabase db push`.

## Decisions Made
- Transcribed the migration skeleton from 86-RESEARCH.md verbatim rather than re-deriving it, since the research already verified it against the live deployed source (confirmed again in this session by reading `20260661000000_enrich_supplier_category.sql` directly — bodies matched exactly).
- Did not modify `sync-tiny-payables/index.ts` — per plan/research, this Deno EF needs zero code changes; `competence_date` is simply never present in its upsert payload, which is exactly how `category`/`supplier` preservation already works on `ON CONFLICT`.

## Deviations from Plan

None — plan executed exactly as written for Task 1. No Rule 1/2/3 auto-fixes were needed; the migration skeleton in 86-RESEARCH.md required no correction against the deployed source.

## Issues Encountered

None for Task 1. Task 2 could not be executed because this executor has no Supabase MCP tools available (`apply_migration`, `execute_sql`, `get_advisors`) — this matches the plan's explicit design (`<critical_deploy_boundary>` in this executor's instructions: "the executor has no Supabase MCP"; the plan itself frames Task 2 as `Orchestrator-only`).

## CHECKPOINT PENDING (Orchestrator Action Required)

**Type:** human-verify (gate="blocking")
**Status:** Migration file authored, gate-passed, and committed (`5b2393b5`) — **NOT applied to prod.**

The orchestrator (with Supabase MCP access) must perform Task 2 exactly as specified in `86-01-PLAN.md`:

1. **Baseline snapshot** (before apply), via MCP `execute_sql` on `ckcdevcxgvueywivefgx`:
   - `SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'treasury_cat%'` — confirm no drift, note which enrich function each command calls.
   - `SELECT count(*) AS n2026_tiny FROM public.cash_outflows WHERE tiny_payable_id IS NOT NULL AND outflow_date >= '2026-01-01' AND outflow_date < '2027-01-01'` — record this baseline denominator (needed by Plan 02).
   - `SELECT column_name FROM information_schema.columns WHERE table_name='cash_outflows' AND column_name='competence_date'` — expect 0 rows (confirms column absent today).
2. **Apply** the migration via MCP `apply_migration` (name: `cash_outflows_competence_date`, body = `supabase/migrations/20260686000000_cash_outflows_competence_date.sql`). Do NOT use `supabase db push`.
3. **Confirm** post-apply via `execute_sql`:
   - Column `competence_date` exists with type `date`.
   - Index `cash_outflows_org_competence_category_idx` exists on `cash_outflows`.
   - `pg_get_functiondef` for all 3 `enrich_*` functions contains `competence_date`.
   - `has_function_privilege('anon','public.enrich_payable_step(integer)','EXECUTE')` returns `false`.
4. **Check advisors** via MCP `get_advisors` (security + performance) — no NEW issue attributable to this migration.
5. Record the baseline `n2026_tiny` count and the cron→function mapping for Plan 02's hand-off.

**This plan (86-01) is not fully complete until Task 2 above is performed and confirmed by the orchestrator.**

## User Setup Required

None - no external service configuration required by this executor's portion. Task 2 requires Supabase MCP access held by the orchestrator, not a manual user action.

## Next Phase Readiness

- The migration file is ready to apply as-is; no further authoring work needed.
- Plan 02 (behavioral proof: single-writer non-overwrite, DFC non-regression, backfill coverage) depends on Task 2 being applied first — do not start Plan 02 until the orchestrator confirms the checkpoint above.
- Blocker: prod schema does not yet have `competence_date`; Phase 87 (DRE RPC aggregation) cannot read this column until Task 2 lands.

---
*Phase: 86-dre-compet-ncia-no-contas-a-pagar*
*Completed (Task 1 only): 2026-07-08*

## Self-Check: PASSED
