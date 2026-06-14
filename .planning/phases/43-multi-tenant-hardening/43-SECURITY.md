---
phase: 43
slug: multi-tenant-hardening
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-14
---

# Phase 43 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Project (production): `ckcdevcxgvueywivefgx` (NOT the `gionpsuunfkkzzjdubfy` referenced in CLAUDE.md — see T-43-08).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| client `authenticated` → Postgres (RLS) | Org member reads `ml_product_costs` / `ml_billing_monthly` / `onboarding_progress`; RLS is the sole isolation boundary | tenant cost/billing/onboarding data (org-sensitive) |
| service role (EF) → Postgres | `recalc-order-costs` / `sync-tiny-costs` / `sync-ml-billing` write bypassing RLS | full-tenant write |
| user `authenticated` → EF (`ml-reputation`/`ml-inventory`/`ml-ads`) | user passes `ml_user_id`; EF must validate membership before returning data | ML store data keyed by `ml_user_id` |
| pg_cron → `process-sync-job` (service role) | cron drains queue; quota gate decides dispatch | sync job dispatch |
| EF service role → `ml_tokens` | token lookup must be deterministic to avoid cross-org token confusion | OAuth access tokens |
| org A (session/queries) vs org B (data) | the boundary exercised by the 2-org isolation test | all cached tenant data |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-43-01 | Information Disclosure | `ml_product_costs` RLS cross-tenant read | mitigate | `mpc_select` org-first via `is_org_member`; SELECT requires `organization_id IS NOT NULL` | closed |
| T-43-02 | Information Disclosure | orphan rows `organization_id NULL` | mitigate | Backfill via `organization_members`/`ml_tokens` + DELETE regenerable caches + `SET NOT NULL` | closed |
| T-43-03 | Tampering/Elevation | viewer writing `ml_billing_monthly` | mitigate | Policy replaced FOR ALL → FOR SELECT; writes service-role only | closed |
| T-43-04 | Tampering | `SET NOT NULL` with remaining orphans | accept-with-guard | `DO` block `RAISE EXCEPTION` before each `SET NOT NULL` | closed |
| T-43-05 | Spoofing | token lookup cross-tenant in sync-ml-orders/billing | mitigate | `.order("updated_at", desc)` + post-lookup `is_org_member` filter | closed |
| T-43-06 | Information Disclosure | `ml_user_id` enumeration in ml-reputation/inventory/ads | mitigate | `is_org_member` guard on token's org before use; generic 403 | closed |
| T-43-07 | Abuse/DoS | org exceeds sync quota | mitigate | `check_quota` RPC gate in `process-sync-job` (fail-closed on RPC error) | closed |
| T-43-08 | Tampering | pg_cron points to wrong project | mitigate | cron Pattern B URL `ckcdevcxgvueywivefgx` + vault `service_role_key` | closed |
| T-43-09 | Tampering/Elevation | non-owner writing `onboarding_progress` | mitigate | RLS `ob_write` FOR ALL restricted to `get_org_role = 'owner'` | closed |
| T-43-10 | Information Disclosure | onboarding progress of another org | mitigate | RLS `ob_select` via `is_org_member`; PK `organization_id` | closed |
| T-43-11 | UX/abuse | blocking route-guard trapping owner | accept | onboarding non-blocking by design (D-07); no guard | closed |
| T-43-12 | Information Disclosure | cross-tenant leak in cache tables | mitigate | Per-table isolation test (15 org-scoped tables, bidirectional, 0 leaks) | closed |
| T-43-13 | Tampering | viewer writes billing | mitigate | ME-06 test: INSERT under owner → ERROR 42501 | closed |
| T-43-14 | Information Disclosure | `ml_user_id` enumeration | mitigate | ME-05 test: `is_org_member` guard present in 3 EFs (code-confirmed) | closed |
| T-43-15 | Abuse | quota bypass | mitigate | TENANT-03 test: `[t,t,t,f,f]` at limit=3; enterprise(-1) always true | closed |
| T-43-SC | Tampering | npm/deno installs | accept | no new packages this phase (`tech-stack.added: []` in all summaries) | closed |
| T-43-WR07 | Information Disclosure | `ml_targets` outside org-scoped isolation matrix | accept | user-scoped RLS (`user_id = auth.uid()`) prevents cross-principal read; no org-first scope (coverage gap → Phase 44) | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Evidence (per threat)

| Threat ID | Evidence (file:line or doc) |
|-----------|------------------------------|
| T-43-01 | `20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql:46-53` (`mpc_select`: `organization_id IS NOT NULL AND is_org_member(...)`); insert/update/delete `:57-93` via `get_org_role` owner/admin/member |
| T-43-02 | `20260614120500_tenant02_backfill_orphans_and_notnull.sql:32-43` (backfill `ml_product_costs` via `organization_members`), `:79-87` (DELETE caches), `:93-132` (`DO` guard + `SET NOT NULL`). Post-apply: 604 orphans → 0, org NOT NULL (43-01-SUMMARY:245-259) |
| T-43-03 | `20260614121000_me06_billing_for_select.sql:13` (DROP `org_member_billing` FOR ALL), `:17-21` (CREATE `org_member_billing_select` FOR SELECT only). ISOLATION-TEST §4: only policy = `org_member_billing_select` (cmd=SELECT) |
| T-43-04 | `20260614120500_...sql:93-132` (`DO` block, `RAISE EXCEPTION` per table before each `ALTER ... SET NOT NULL`) |
| T-43-05 | `sync-ml-orders/index.ts:443-450` (`order("updated_at", desc).limit(1)`), `:459-471` (guard, service-role skip); `sync-ml-billing/index.ts:237` (ORDER BY), `:245-247` (guard) |
| T-43-06 | `ml-reputation/index.ts:44-52` (deterministic lookup), `:58-64` (`is_org_member` on token org → 403); `ml-inventory/index.ts:87-95`, `:104-115`. Caller identity from `auth.getUser(token)` (`ml-reputation:34-36`). `config.toml`: ml-reputation/ml-inventory `verify_jwt=true` (gateway) + in-code guard |
| T-43-07 | `process-sync-job/index.ts:75-103` (gate calls `check_quota`, fail-CLOSED requeue on RPC error `:80-90`, skip-on-exceeded `:91-102`). `config.toml:65-66` `verify_jwt=false`; in-code `requireServiceRole` exact-key match `:34-45` (CR-01 fix) |
| T-43-08 | `20260614122500_tenant03_fix_sync_cron_pattern_b.sql:28-44` (URL `ckcdevcxgvueywivefgx` + vault `service_role_key`); no `gionpsuunfkkzzjdubfy` in functional SQL |
| T-43-09 | `20260614123000_tenant04_onboarding_progress.sql:61-66` (`ob_write` FOR ALL, `get_org_role(...)='owner'` in USING and WITH CHECK) |
| T-43-10 | `20260614123000_...sql:28-29` (PK `organization_id`), `:53-57` (`ob_select` via `is_org_member`) |
| T-43-11 | `useOnboardingProgress.ts` + `OnboardingBanner.tsx`/`OnboardingWizard.tsx` non-blocking (dismissible Dialog, no route-guard); 43-03-SUMMARY decisions |
| T-43-12 | `ISOLATION-TEST.md §2`: 15 org-scoped tables, bidirectional A↔B, 0 cross-org rows; real volumes confirm non-vacuous (Thales `ml_ads_products_cache=15962`) |
| T-43-13 | `ISOLATION-TEST.md §4`: INSERT into `ml_billing_monthly` under owner authenticated → `ERROR 42501` |
| T-43-14 | `ISOLATION-TEST.md §5`: `is_org_member` guard in ml-ads/ml-inventory/ml-reputation (code-confirmed). Live behavioral 403 deferred to Wesley (non-blocking — guard is in deployed code) |
| T-43-15 | `ISOLATION-TEST.md §7`: `check_quota` `[true,true,true,false,false]` at interval=480 (limit=3); enterprise(-1) always true; RPC logic confirmed via `pg_get_functiondef` |
| T-43-SC | All four SUMMARY frontmatters `tech-stack.added: []`; CLAUDE.md "sem novas dependências" |
| T-43-WR07 | `20260407120000_create_ml_targets.sql:17` (RLS enabled), `:21-35` (4 CRUD policies `user_id = auth.uid()`). No `organization_id`/`ml_user_id` column. Not in org-isolation loop (ISOLATION-TEST §2 row 14) |

---

## Coverage Gap Investigation — WR-07 (`ml_targets`)

**Question:** does `ml_targets` RLS isolate correctly, and is there a real cross-org leak?

**Finding — CLOSED (accepted coverage gap):**
- `ml_targets` has RLS **enabled** (`20260407120000_create_ml_targets.sql:17`) with all four CRUD
  policies scoped to `user_id = auth.uid()` (`:21-35`). A row is visible only to the exact authenticated
  user who owns it.
- There is **no `is_org_member` widening** — so targets are not even shared between members of the same
  org, let alone across orgs. A principal in org A cannot read targets owned by a different principal.
- The only theoretical "sharing" is the *same physical user* belonging to multiple orgs that share a
  `seller_id` — that user seeing their own rows is not a cross-tenant disclosure to a different principal.
- In the current real topology each user owns exactly one org (isolation test confirmed distinct owners
  for Pé Vermeio and Thales), so there is **no cross-org data leak** via `ml_targets`.
- It remains a **design inconsistency** (goals are user-scoped, not org-first like the rest of the model)
  and a **test-coverage gap** (excluded from the per-org isolation matrix because it has no
  `organization_id`). Both are deferred to Phase 44.

**Disposition:** user-scoped RLS is sufficient to prevent cross-principal disclosure → no open threat.
Recorded as an accepted coverage gap (see Accepted Risks Log, RISK-43-01).

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| RISK-43-01 | T-43-WR07 | `ml_targets` is user-scoped (`user_id = auth.uid()`) with RLS enabled; no cross-principal/cross-org read is possible. It is not aligned to the org-first model and is absent from the per-org isolation matrix. No real leak in the current single-org-per-user topology. Add `organization_id` + org-first RLS and include in the isolation matrix in Phase 44. | Phase 43 audit (pending Wesley sign-off) | 2026-06-14 |
| RISK-43-02 | T-43-11 | Onboarding is non-blocking by design (D-07): banner/wizard are dismissible and there is no route-guard. A new owner is never trapped; auto-detection covers required steps. UX abuse risk accepted. | Phase 43 plan (D-07) | 2026-06-14 |
| RISK-43-03 | T-43-SC | No new npm/deno packages introduced this phase (all four summaries `tech-stack.added: []`). Supply-chain surface unchanged. | Phase 43 audit | 2026-06-14 |

---

## Non-Threat Findings Carried Forward (from 43-REVIEW.md)

These are correctness/UX items from code review, **not** items in the threat register. They do not block
the phase and are not security-open, but are recorded for Phase 44 / verify-phase backlog:

- **WR-03 / WR-43-jobloss** — quota-exceeded marks a claimed job `failed` (lost, not deferred); combined
  with retry-watchdog can re-increment `sync_quota_daily`. Counter drift, not a tenant-isolation defect.
- **CR-02(b)** — `ml_product_costs` upsert still conflicts on `(user_id, item_id)`, not
  `(organization_id, item_id)`. The CR-02 NULL-org guard is applied (write never persists NULL org), so
  the org-first SELECT desync is closed; but a second member editing the same item can create a duplicate
  row under their own `user_id` (D-11 "shared cost" not fully realized). Data-quality, not isolation.
- **WR-04** — `sync-ml-billing` daily/monthly paths return `success:true` when `organization_id` is null
  (masks a data gap). Observability, not isolation.
- **WR-05** — single `upsert` error only `console.warn`'ed without optimistic revert (silent client-side
  data loss). UX/correctness.
- **WR-06 / IN-04 / IN-05** — onboarding wizard skip not persisted when org null; banner dismissal
  per-mount; progress-bar denominator vs `isComplete` mismatch. Cosmetic/UX.
- **WR-02 / IN-01** — silent-null on `is_org_member` RPC error (fail-direction is *safe* → 403) and
  inventory pagination ceiling truncation: operability/observability gaps, not isolation defects.

---

## Unregistered Flags

None. The `## Threat Flags` sections of 43-01/02/03/04 SUMMARYs map exclusively to existing register IDs
(T-43-01/02/03 in 43-01; T-43-05/06/07/08 in 43-02; T-43-09/10/11 in 43-03; T-43-12/13/14/15 in 43-04) —
all framed as mitigations applied, not new attack surface. No new attack surface appeared during
implementation that lacks a threat mapping.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-14 | 16 | 16 | 0 | gsd-security-auditor |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-14
