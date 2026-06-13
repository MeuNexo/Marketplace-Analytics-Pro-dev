---
phase: 42-zero-mock
plan: "02"
subsystem: api
tags: [supabase-edge-functions, mercadolibre, pg-cron, questions, claims, reputation, vault, security]

# Dependency graph
requires:
  - phase: 42-zero-mock/01
    provides: ml_questions + ml_claims tables, vault service_role_key, pg_cron + pg_net extensions enabled

provides:
  - sync-ml-questions EF: paginates ML /questions/search for every ml_tokens row → upserts into ml_questions (*/15 cron)
  - sync-ml-claims EF: dual-URL fallback (/v1 + /post-purchase) → upserts into ml_claims with tipo discriminator (*/30 cron)
  - reply-ml-question EF: user-JWT + org-membership gated irreversible POST to ML /answers, updates ml_questions row
  - ml-reputation EF expansion: returns feedbacks[] array (3-URL fallback, empty-on-failure) for daily chart
  - pg_cron Pattern B schedules: vault-authenticated Bearer service_role_key cron jobs active in production
  - Domain learning: SUPABASE_SERVICE_ROLE_KEY env on Supabase is the sb_secret_... key (not the legacy JWT), vault must store sb_secret_ value

affects: [42-03, 42-04, perguntas-page, devolucoes-page, reputacao-page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern B cron auth: Bearer service_role_key from vault.decrypted_secrets (NOT X-Cron-Secret)"
    - "requireServiceRole fail-closed: returns 500 if SERVICE_KEY env missing (not null/pass)"
    - "Dual-URL claims fallback: /v1/claims/search → /post-purchase/v1/claims/search on non-200"
    - "MAX_PAGES_PER_STATUS guard: prevents unbounded ML pagination from hitting 150s EF wall-clock"
    - "Batch dedupe by claim_id before upsert: ML search returns same claim under opened+closed"
    - "is_org_member gate before irreversible ML write (anti-IDOR for reply EF)"

key-files:
  created:
    - supabase/functions/sync-ml-questions/index.ts
    - supabase/functions/sync-ml-claims/index.ts
    - supabase/functions/reply-ml-question/index.ts
    - supabase/migrations/20260614110000_pg_cron_questions_claims.sql
  modified:
    - supabase/functions/ml-reputation/index.ts

key-decisions:
  - "sb_secret_... is the SUPABASE_SERVICE_ROLE_KEY for modern Supabase projects (not the legacy JWT); vault must store the sb_secret_ value for Pattern B cron auth to match the EF check"
  - "Cron Pattern B (Bearer vault) chosen over Pattern A (X-Cron-Secret header) per research — EF enforces requireServiceRole against SUPABASE_SERVICE_ROLE_KEY env"
  - "sync-ml-claims bounded to MAX_PAGES_PER_STATUS=6 per status (not unbounded 90-day history) to fit within 150s EF wall-clock limit"
  - "Claims batch deduped by claim_id before upsert — ML /claims/search returns same claim under opened+closed statuses, causing ON CONFLICT double-touch errors"
  - "reply-ml-question denies when organization_id is null (no null bypass IDOR) — security tightened during code review"
  - "requireServiceRole in sync EFs fails closed (500) when SERVICE_KEY env missing, not null/pass — prevents fail-open in misconfigured deploys"

patterns-established:
  - "Pattern B cron auth: cron.schedule → net.http_post → Authorization: Bearer || vault.decrypted_secrets WHERE name='service_role_key'"
  - "Fail-closed requireServiceRole: explicitly check env not null before comparison, return 500 if missing"
  - "Dual-URL fallback for ML Claims: try /v1/claims/search first, on non-200 retry /post-purchase/v1/claims/search"
  - "Pagination guard: MAX_PAGES_PER_STATUS constant caps pages to prevent EF timeout on large accounts"
  - "Pre-upsert dedupe: collect all claim IDs per seller, filter duplicates keeping latest, then batch upsert"

requirements-completed: [MOCK-01, MOCK-02, MOCK-03, MOCK-04]

# Metrics
duration: 90min
completed: 2026-06-14
---

# Phase 42 Plan 02: Zero Mock — ML Questions/Claims Sync + Reply + Reputation EFs with pg_cron

**4 Edge Functions deployed to ckcdevcxgvueywivefgx + Pattern B pg_cron schedules active; smoke confirmed 108 questions + 279 claims synced for Pé Vermeio, with 3 post-deploy security/correctness fixes committed.**

## Performance

- **Duration:** ~90 min (including orchestrator deploy + smoke)
- **Started:** 2026-06-14T00:00:00Z
- **Completed:** 2026-06-14T02:00:00Z
- **Tasks:** 4 (3 auto + 1 checkpoint:human-verify resolved by orchestrator)
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- Built `sync-ml-questions` and `sync-ml-claims` EFs following the `sync-ads` structural analog: requireServiceRole guard, getAccessToken refresh, mlGet retry with 429/5xx back-off, multi-seller loop, paginated ML API calls with 200ms sleep between pages
- Expanded `ml-reputation` with `feedbacks[]` return (3-URL fallback, empty array on all failures — never throws) enabling the daily chart in plan 42-03
- Created `reply-ml-question` EF with full validation chain: user-JWT, zod body validation (question_id/text ≤2000/ml_user_id), ml_tokens lookup, `is_org_member` gate before irreversible POST to ML /answers, then updates `ml_questions` row to ANSWERED
- Applied Pattern B pg_cron migration: both jobs (*/15 questions, */30 claims) authenticated via `vault.decrypted_secrets WHERE name='service_role_key'` — smoke confirmed anon→401, cron.job active=true, no Unauthorized run failures
- **Domain finding (critical):** `SUPABASE_SERVICE_ROLE_KEY` env on modern Supabase projects is the `sb_secret_...` key (41 chars), NOT the legacy service_role JWT. Vault must store the `sb_secret_` value; Pattern B Bearer matches the EF check. Same class of pitfall as the Nexo MCP `sb_secret_` issue documented in memory.
- Real sync smoke: 108 rows in ml_questions (50 seller 1639558873 + 58 seller 427063369), 279 rows in ml_claims (24 + 255) — confirms live ML data flowing into plan-01 tables

## Task Commits

Each task was committed atomically:

1. **Task 1: sync-ml-questions + sync-ml-claims EFs** — `cf040547` (feat)
2. **Task 2: reply-ml-question + ml-reputation feedbacks[]** — `51268f59` (feat)
3. **Task 3: pg_cron migration (Pattern B)** — `2aa470bc` (feat)
4. **Task 4: deploy + cron + smoke [checkpoint — resolved by orchestrator]**
   - Fix 1 (auth gaps): `d038f581` (fix)
   - Fix 2 (claims pagination bound): `acfaebe4` (fix)
   - Fix 3 (claims dedupe): `1169dee2` (fix)

**Plan metadata:** (this commit)

## Files Created/Modified

- `supabase/functions/sync-ml-questions/index.ts` — Cron-invoked EF: requireServiceRole, paginated /questions/search per seller, UPPERCASE status normalization, upsert onConflict (organization_id, ml_user_id, question_id)
- `supabase/functions/sync-ml-claims/index.ts` — Cron-invoked EF: dual-URL fallback, tipo discriminator (mediations/returns), MAX_PAGES_PER_STATUS=6 bound, pre-upsert dedupe by claim_id, upsert onConflict (organization_id, ml_user_id, claim_id)
- `supabase/functions/reply-ml-question/index.ts` — User-JWT EF: zod validation, is_org_member gate (denies on null org), POST /answers, updates ml_questions row to ANSWERED
- `supabase/functions/ml-reputation/index.ts` — Expanded: 3-URL feedbacks fallback (received / ?as=seller / feedback?as=seller), empty array on all failures, added to response JSON
- `supabase/migrations/20260614110000_pg_cron_questions_claims.sql` — Pattern B pg_cron: idempotent unschedule + schedule for both jobs, Bearer from vault.decrypted_secrets

## Decisions Made

- **Pattern B over Pattern A:** Cron jobs authenticate via Bearer service_role_key from vault (not X-Cron-Secret header). The EFs' requireServiceRole compares against SUPABASE_SERVICE_ROLE_KEY env — Pattern A would use a different header that the EFs don't check.
- **sb_secret_ in vault:** The `SUPABASE_SERVICE_ROLE_KEY` on this project is the modern `sb_secret_...` key (not the legacy service_role JWT). Vault inserted the `sb_secret_` value so cron Bearer matches EF check. This is the same class of pitfall as the Nexo MCP `sb_secret_` issue — documented as domain learning.
- **Bounded claims pagination:** MAX_PAGES_PER_STATUS=6 (300 claims per status per seller per run) + early-break on empty page. ML accounts with large claim history (90-day unbounded) would exceed the 150s EF wall-clock limit. The cron fires every 30 min so recent claims are always caught.
- **Pre-upsert dedupe by claim_id:** ML /claims/search returns the same claim_id under both opened and closed statuses. Without deduplication, the batch upsert hits "ON CONFLICT DO UPDATE cannot affect row a second time" and silently drops the entire seller's batch (296 fetched → 0 persisted). Fix collects all claim_ids per seller, dedupes keeping the latest occurrence, then upserts.

## Deviations from Plan

### Auto-fixed Issues (post-deploy security review by orchestrator)

**1. [Rule 2 - Missing Critical] Close fail-open auth gaps in reply + sync EFs**
- **Found during:** Task 4 (security review during deploy)
- **Issue 1 (HIGH IDOR):** `reply-ml-question` skipped `is_org_member` check when `organization_id` was null on the token row — allowed any user to post answers on behalf of any seller with a null org (IDOR).
- **Issue 2 (fail-open):** `sync-ml-questions` and `sync-ml-claims` `requireServiceRole` returned `null` (pass) when the `SUPABASE_SERVICE_ROLE_KEY` env was missing, instead of failing closed.
- **Fix:** reply EF now denies (403) when organization_id is null; sync EFs now return 500 when SERVICE_KEY env is absent.
- **Files modified:** `supabase/functions/reply-ml-question/index.ts`, `supabase/functions/sync-ml-questions/index.ts`, `supabase/functions/sync-ml-claims/index.ts`
- **Committed in:** `d038f581`

**2. [Rule 1 - Bug] Bound sync-ml-claims pagination (MAX_PAGES_PER_STATUS=6 + early-break)**
- **Found during:** Task 4 (smoke revealed timing issue on larger accounts)
- **Issue:** Unbounded 90-day client-side filter paginated the full claims history across all pages. On accounts with many claims, this hit the 150s EF wall-clock timeout (504).
- **Fix:** Added `MAX_PAGES_PER_STATUS=6` constant and early-break when page returns 0 items, limiting to ~300 claims per status per seller per run. The 30-min cron cadence ensures recent claims are always caught.
- **Files modified:** `supabase/functions/sync-ml-claims/index.ts`
- **Committed in:** `acfaebe4`

**3. [Rule 1 - Bug] Dedupe claims batch by claim_id + report persisted count**
- **Found during:** Task 4 (smoke data validation — 296 fetched, 0 persisted for one seller)
- **Issue:** ML /claims/search returns the same claim under both `opened` and `closed` status queries. The batch upsert hit "ON CONFLICT DO UPDATE cannot affect row a second time" and Postgres silently dropped the entire seller's upsert.
- **Fix:** After collecting all claims for a seller across statuses, dedupe by claim_id (keep last occurrence), then upsert. Also added reporting of actual persisted count vs. fetched count in the result JSON.
- **Files modified:** `supabase/functions/sync-ml-claims/index.ts`
- **Committed in:** `1169dee2`

---

**Total deviations:** 3 auto-fixed (1 missing critical security, 2 bugs)
**Impact on plan:** All three fixes were blocking production correctness (IDOR, EF timeout, silent data loss). No scope creep. Auth gaps aligned with threat register T-42-05 and T-42-06.

## Issues Encountered

- **sb_secret_ vs legacy JWT (critical domain finding):** Modern Supabase projects use `sb_secret_...` as `SUPABASE_SERVICE_ROLE_KEY`, not the legacy service_role JWT. The vault must store the `sb_secret_` value so pg_cron Pattern B Bearer matches what the EF's requireServiceRole checks against. Identical to the Nexo MCP pitfall (2026-04-27 session). Always verify which key format the EF env uses before applying Pattern B migrations.
- **Supabase CLI linked to wrong project:** Local CLI is linked to `gionpsuunfkkzzjdubfy` (not `ckcdevcxgvueywivefgx`). All EF deployments and migrations went through Supabase MCP with explicit `--project-ref ckcdevcxgvueywivefgx`. Do NOT use `supabase db push` or `supabase functions deploy` without re-linking.

## User Setup Required

None — no external service configuration required for this plan. The vault `service_role_key` was inserted by the orchestrator as part of Task 4 deployment.

## Next Phase Readiness

- **ml_questions:** 108 rows live (50 + 58 across both seller accounts). Ready for `/perguntas` page (plan 42-03).
- **ml_claims:** 279 rows live (24 + 255 across both seller accounts), tipo column populated. Ready for `/devolucoes` page (plan 42-03).
- **ml-reputation:** feedbacks[] available in response. Ready for reputation chart expansion (plan 42-03/04).
- **reply-ml-question:** Deployed ACTIVE with full auth chain. Ready to wire into `/perguntas` UI (plan 42-03).
- **pg_cron:** Both jobs active (*/15 questions, */30 claims). Tables will stay fresh without manual triggers.
- **Plan 42-03 dependency satisfied:** All 4 data-producing EFs are live and producing real data. Pages in 42-03 have data to display.

## Known Stubs

None — all EFs return real ML API data. No hardcoded values or placeholder responses.

## Threat Flags

No new security surface beyond the plan's threat model. Fixes for T-42-05 (IDOR) and T-42-06 (fail-open auth) were applied and committed.

---

## Self-Check: PASSED

- `supabase/functions/sync-ml-questions/index.ts` — exists (commit cf040547)
- `supabase/functions/sync-ml-claims/index.ts` — exists (commit cf040547)
- `supabase/functions/reply-ml-question/index.ts` — exists (commit 51268f59)
- `supabase/functions/ml-reputation/index.ts` — modified (commit 51268f59)
- `supabase/migrations/20260614110000_pg_cron_questions_claims.sql` — exists (commit 2aa470bc)
- Commits verified: cf040547, 51268f59, 2aa470bc, d038f581, acfaebe4, 1169dee2 — all present in git log

---
*Phase: 42-zero-mock*
*Completed: 2026-06-14*
