---
phase: 101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis
plan: 01
subsystem: database
tags: [postgres, rls, supabase, mco, anti-idor]

# Dependency graph
requires:
  - phase: 43-multi-tenant-hardening
    provides: org-first RLS pattern (is_org_member/get_org_role) proven anti-IDOR on ml_product_costs
provides:
  - "ml_mco_targets table live in prod (ckcdevcxgvueywivefgx) with org-first RLS"
  - "Per-item_id (with sku sentinel) custom MCO% target persistence, ready for a read/write hook"
affects: [101-02, 101-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config table with org-first RLS cloned 1:1 from ml_product_costs (mmt_select/insert/update/delete)"
    - "sku sentinel (text NOT NULL DEFAULT '') instead of nullable column to keep UNIQUE constraint meaningful"

key-files:
  created: [supabase/migrations/20260719000000_ml_mco_targets.sql]
  modified: []

key-decisions:
  - "No RPC for ml_mco_targets writes — direct supabase.from().upsert() per repo convention for simple config tables (ml_product_costs, replenishment_params)"
  - "sku column is NOT NULL DEFAULT '' (sentinel), never nullable, to keep UNIQUE(organization_id, item_id, sku) enforce dedup correctly"
  - "RLS applied directly against prod via MCP apply_migration (never CLI db push, never SQL Editor) — same protocol as all prior phases"

patterns-established:
  - "Anti-IDOR smoke test protocol: single transaction, SET LOCAL ROLE authenticated + impersonated JWT claims, cross-org SELECT must return 0, always ROLLBACK, org UUIDs always looked up fresh via SELECT id, name FROM organizations (never completed from a prefix)"

requirements-completed: [D-06, D-09]

# Metrics
duration: ~15min
completed: 2026-07-19
status: complete
---

# Phase 101 Plan 01: ml_mco_targets table Summary

**`ml_mco_targets` config table (per-item_id, org-scoped, sku sentinel) live in prod with org-first RLS, proven anti-IDOR and CHECK-constrained via a role-authenticated smoke test run in a rolled-back transaction.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-19T19:40:47Z (approx, per STATE.md)
- **Completed:** 2026-07-19
- **Tasks:** 2 (1 auto + 1 checkpoint:human-verify)
- **Files modified:** 1

## Accomplishments
- Migration `20260719000000_ml_mco_targets.sql` written: table with 7 columns, UNIQUE(organization_id, item_id, sku), CHECK(target_mco_pct > 0 AND <= 100), 4 RLS policies cloned 1:1 from `ml_product_costs` org-first pattern.
- Migration applied to prod project `ckcdevcxgvueywivefgx` via MCP `apply_migration` (orchestrator, since the executor has no Supabase MCP/CLI token).
- Anti-IDOR + CHECK smoke test executed as role `authenticated` inside a single `BEGIN ... ROLLBACK` transaction: same-org SELECT = 1 row, cross-org SELECT = 0 rows (Pé Vermeio target invisible to Thales), `target_mco_pct=0` and `=101` both rejected with 23514, and 0 residual `TEST-MMT%` rows confirmed after rollback.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write ml_mco_targets migration (table + org-first RLS + sentinel sku)** - `df3ee781` (feat)
2. **Task 2: [BLOCKING] Apply migration via MCP + anti-IDOR smoke test as role authenticated** - no code commit (verification-only checkpoint; migration file was already committed in Task 1). Applied to prod by the orchestrator via Supabase MCP.

**Plan metadata:** (this commit, docs)

## Files Created/Modified
- `supabase/migrations/20260719000000_ml_mco_targets.sql` - `ml_mco_targets` table, unique constraint, index, 4 org-first RLS policies

## Decisions Made
- Confirmed prod's max applied migration version (`20260717035908`) was below `20260719000000` — no filename bump needed.
- No RPC layer for this table; reads/writes go through direct `supabase.from('ml_mco_targets')` calls in Plan 03, matching the `ml_product_costs`/`replenishment_params` convention for simple per-org config.

## Deviations from Plan

None - plan executed exactly as written. Task 2 was a verification-only checkpoint; all steps in `<how-to-verify>` were completed by the orchestrator (with Supabase MCP access) exactly as specified, including the anti-IDOR org-lookup safeguard (fresh `SELECT id, name FROM organizations`, never a UUID completed from a prefix).

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `ml_mco_targets` is live in prod with org-first RLS proven anti-IDOR and CHECK enforced. Plan 03 can now build the read/write hook against this table.
- No blockers for Plan 02/03.

---
*Phase: 101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis*
*Completed: 2026-07-19*

## Self-Check: PASSED

- FOUND: supabase/migrations/20260719000000_ml_mco_targets.sql
- FOUND: commit df3ee781
- FOUND: 101-01-SUMMARY.md (this file)
