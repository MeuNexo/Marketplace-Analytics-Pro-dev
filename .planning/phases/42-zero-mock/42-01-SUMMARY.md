---
phase: 42-zero-mock
plan: 01
subsystem: database
tags: [supabase, rls, migrations, vitest, edge-functions, pg-cron]

# Dependency graph
requires:
  - phase: 41-veracidade-total
    provides: "org-scoped RLS pattern (is_org_member), ml_billing_monthly analog, CR-01 multi-store merge pattern"
provides:
  - "public.ml_questions table with RLS + 3 indexes + UNIQUE(org, ml_user_id, question_id)"
  - "public.ml_claims table with RLS + 3 indexes + UNIQUE(org, ml_user_id, claim_id)"
  - "supabase/config.toml verify_jwt entries for sync-ml-questions, sync-ml-claims, reply-ml-question"
  - "RED test scaffolds useMLQuestions.test.ts + useMLClaims.test.ts (failing — plan 03 closes GREEN)"
  - "Wave-2 prerequisite documented: vault.secrets service_role_key required before 42-02 cron migration"
affects: [42-02, 42-03, 43-multi-tenant-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "org-scoped table: ENABLE RLS + single FOR ALL policy using public.is_org_member(auth.uid(), organization_id)"
    - "unique constraint includes (organization_id, ml_user_id, <ml_id>) to prevent cross-org row collision on reconnect (Pitfall 6)"
    - "EF auth split: cron-invoked EFs use verify_jwt=false (service_role_key auth); user-invoked EFs use verify_jwt=true"
    - "RED scaffold: test files import not-yet-existing hooks; expected to fail with module-not-found"

key-files:
  created:
    - supabase/migrations/20260614100000_ml_questions_claims.sql
    - src/hooks/useMLQuestions.test.ts
    - src/hooks/useMLClaims.test.ts
  modified:
    - supabase/config.toml

key-decisions:
  - "vault.secrets service_role_key insertion DEFERRED to Wave 2 (plan 42-02): value must be supplied by Wesley before applying the pg_cron migration — inserting a placeholder now would silently 401 every cron invocation"
  - "verify_jwt=false for sync EFs (cron-invoked with service_role_key), verify_jwt=true for reply-ml-question (user-invoked)"
  - "UNIQUE constraints include organization_id + ml_user_id to scope uniqueness per loja, not globally"

patterns-established:
  - "New ML data tables follow ml_billing_monthly analog: ENABLE RLS + org_member_<table> FOR ALL + (organization_id, ml_user_id, <ml_pk>) unique constraint"
  - "Wave 0 gap closure: test scaffolds committed in RED state before hooks exist"

requirements-completed: []  # MOCK-01 and MOCK-03 are PROGRESSED (foundation only) — pages still mock until plan 42-03 closes GREEN

# Metrics
duration: 30min (Tasks 1+2) + orchestrator-applied migration (Task 3)
completed: 2026-06-14
---

# Phase 42 Plan 01: Zero Mock — Data Foundation Summary

**ml_questions + ml_claims tables live in ckcdevcxgvueywivefgx with RLS + org_member policies + 6 indexes; config.toml registers 3 EFs with correct verify_jwt; RED test scaffolds close Wave 0 Nyquist gap**

## Performance

- **Duration:** ~30 min (agent) + orchestrator checkpoint for Task 3
- **Started:** 2026-06-14T00:00:00Z
- **Completed:** 2026-06-14
- **Tasks:** 3/3
- **Files modified:** 4

## Accomplishments

- Migration `20260614100000_ml_questions_claims.sql` created and applied to live project ckcdevcxgvueywivefgx via Supabase MCP `apply_migration`; both tables confirmed with `rls_enabled=true`, 1 org_member policy each, 5 indexes each
- `supabase/config.toml` updated with three `[functions.*]` entries: `sync-ml-questions` (verify_jwt=false), `sync-ml-claims` (verify_jwt=false), `reply-ml-question` (verify_jwt=true)
- `useMLQuestions.test.ts` and `useMLClaims.test.ts` scaffolded as failing RED tests asserting org_id + resolvedMLUserIds scoping, date ordering, and status filter — Wave 0 gap closed
- Security advisor scan (`get_advisors` security) confirmed NO new critical/ERROR findings on the new tables

## Task Commits

1. **Task 1: Write ml_questions + ml_claims migration** — `a62656e7` (feat)
2. **Task 2: Register verify_jwt for 3 EFs + RED test scaffolds** — `29672a34` (feat)
3. **Task 3: Apply migration to live DB** — Executed by orchestrator via Supabase MCP (no code commit; platform mutation only)

**STATE.md pause commit:** `19bee402` (chore — paused at checkpoint)

## Files Created/Modified

- `supabase/migrations/20260614100000_ml_questions_claims.sql` — DDL for ml_questions and ml_claims with RLS, org_member policies, UNIQUE constraints, 6 indexes
- `supabase/config.toml` — three new `[functions.*]` entries for the EFs in plan 42-02
- `src/hooks/useMLQuestions.test.ts` — RED scaffold asserting MOCK-01/MOCK-02 hook contract (will fail until plan 42-03)
- `src/hooks/useMLClaims.test.ts` — RED scaffold asserting MOCK-03 hook contract (will fail until plan 42-03)

## Decisions Made

- **verify_jwt split:** Cron-invoked EFs (`sync-ml-questions`, `sync-ml-claims`) use `verify_jwt=false` because they are called by pg_cron with the service_role_key directly. The user-facing EF `reply-ml-question` uses `verify_jwt=true` because the browser sends a user JWT. This mirrors the `sync-ml-billing` pattern from Phase 41.
- **vault.secrets DEFERRED:** The service_role_key vault entry was NOT inserted in this plan (0 rows confirmed). Inserting without the real value would silently break every future cron invocation. Wesley must supply the SERVICE_ROLE_KEY value before plan 42-02 applies the pg_cron migration. See Wave-2 Prerequisite section below.

## Deviations from Plan

None — plan executed exactly as written. Task 3 resolution (migration applied by orchestrator, vault insertion deferred per Wesley's decision) is an accepted outcome, not a deviation.

## Issues Encountered

- **vault.secrets service_role_key: 0 rows found** (confirmed via `SELECT name FROM vault.secrets WHERE name = 'service_role_key'`). Per Wesley's decision, the value insertion is deferred to Wave 2 (plan 42-02). This is a known, accepted prerequisite documented as a hard blocker for plan 42-02.

## Security Advisor Result (Task 3 Gate)

`get_advisors security` after migration: NO new critical or ERROR-level findings on `ml_questions` or `ml_claims`. Only pre-existing project-wide WARN-level lints (`function_search_path_mutable`, `SECURITY DEFINER` helpers like `is_org_member`) — not introduced by this migration and not blocking (gate is high-severity only). STRIDE threats T-42-01 (PII disclosure), T-42-02 (cross-org collision), T-42-03 (RLS disabled by oversight) are all MITIGATED.

## Wave-2 Prerequisite (CRITICAL — Plan 42-02 MUST NOT proceed without this)

**vault.secrets service_role_key is ABSENT (0 rows in ckcdevcxgvueywivefgx).**

Plan 42-02 applies migration `20260614110000_pg_cron_questions_claims.sql`, which schedules EF invocations using the service_role_key from `vault.secrets`. If that entry does not exist at deploy time, every cron run will 401 silently — exactly the Nexo MCP pitfall documented in STATE.md (D-02 in 42-CONTEXT.md).

Before starting plan 42-02:
1. Wesley supplies the SERVICE_ROLE_KEY value (Supabase dashboard → Project Settings → API).
2. Insert via Supabase SQL Editor or MCP `execute_sql`:
   ```sql
   SELECT vault.create_secret('<actual_service_role_key>', 'service_role_key', 'Service role key para pg_cron');
   ```
3. Verify: `SELECT name FROM vault.secrets WHERE name = 'service_role_key';` must return 1 row.
4. Only then run `gsd-execute-phase 42 42-02`.

## Requirements Status

- **MOCK-01** (/perguntas real data): PROGRESSED — table + test scaffold exist; hooks and page rewrite pending until plan 42-03.
- **MOCK-03** (/devolucoes real data): PROGRESSED — table + test scaffold exist; hooks and page rewrite pending until plan 42-03.

Requirements are NOT marked complete — they close in plan 42-03 when GREEN phase passes and pages show real data.

## Next Phase Readiness

- **Plan 42-02 (EFs + pg_cron):** BLOCKED until vault service_role_key entry is inserted. Once unblocked: EFs `sync-ml-questions`, `sync-ml-claims`, `reply-ml-question` and pg_cron schedules can be implemented and deployed.
- **Plan 42-03 (hooks + page rewrites):** Can begin conceptually but depends on 42-02 EFs being deployed (tables are ready; hooks need data to test against).
- **Plan 42-04 (TV sellers dynamic):** Independent of 42-01/02/03 — can be parallelized.

---
*Phase: 42-zero-mock*
*Completed: 2026-06-14*
