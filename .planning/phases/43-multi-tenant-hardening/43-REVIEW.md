---
phase: 43-multi-tenant-hardening
reviewed: 2026-06-14T12:24:42Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - src/components/onboarding/OnboardingBanner.tsx
  - src/components/onboarding/OnboardingWizard.tsx
  - src/hooks/useMLProductCosts.ts
  - src/hooks/useOnboardingProgress.ts
  - src/integrations/supabase/types.ts
  - src/pages/AcceptInvite.tsx
  - src/pages/MercadoLivre.tsx
  - supabase/functions/ml-inventory/index.ts
  - supabase/functions/ml-reputation/index.ts
  - supabase/functions/process-sync-job/index.ts
  - supabase/functions/sync-ml-billing/index.ts
  - supabase/functions/sync-ml-orders/index.ts
  - supabase/migrations/20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql
  - supabase/migrations/20260614120500_tenant02_backfill_orphans_and_notnull.sql
  - supabase/migrations/20260614121000_me06_billing_for_select.sql
  - supabase/migrations/20260614122000_tenant03_check_quota_rpc.sql
  - supabase/migrations/20260614122500_tenant03_fix_sync_cron_pattern_b.sql
  - supabase/migrations/20260614123000_tenant04_onboarding_progress.sql
findings:
  critical: 3
  warning: 7
  info: 5
  total: 15
status: criticals_resolved
resolved:
  - CR-01 (2026-06-14): process-sync-job auth agora exige igualdade com SERVICE_KEY; re-deploy + smoke (bearer inválido→401, vault key→200, sem auth→401)
  - CR-02 (2026-06-14): useMLProductCosts upsert/upsertBatch exigem currentOrg.id (sem ?? null); tsc+build limpos
  - CR-03 (2026-06-14): quota gate fail-closed — em erro de RPC re-enfileira o job (pending) em vez de fail-open
pending:
  - 7 warnings + 5 info (não-bloqueantes) — backlog para Phase 44 / verify-phase
---

# Phase 43: Code Review Report

## Resolução dos críticos (2026-06-14)

- **CR-01 RESOLVIDO** — `process-sync-job/index.ts`: guard `requireServiceRole` compara o Bearer com `SUPABASE_SERVICE_ROLE_KEY` por igualdade (antes aceitava qualquer Bearer >10 chars). Re-deploy v16 + smoke: sem auth→401, bearer inválido→401, vault service_role_key→200 (cron preservado, env==vault confirmado).
- **CR-02 RESOLVIDO** — `useMLProductCosts.ts`: `upsert` e `upsertBatch` agora abortam quando `currentOrg?.id` é nulo e gravam `organization_id: currentOrg.id` (sem `?? null`), evitando violação de NOT NULL e linhas invisíveis à org. tsc/build limpos.
- **CR-03 RESOLVIDO** — `process-sync-job/index.ts`: em erro do `check_quota` o gate passou a ser fail-closed — devolve o job à fila (`status=pending`, `started_at=null`) para retry no próximo tick, em vez de despachar (fail-open).

Os 7 warnings e 5 info permanecem como backlog não-bloqueante (ver abaixo).

**Reviewed:** 2026-06-14T12:24:42Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Phase 43 hardens multi-tenant isolation across RLS policies, edge-function guards,
and quota enforcement. The RLS migrations are well-structured: `is_org_member` /
`get_org_role` parameter ordering matches the canonical definitions
(`_user_id, _org_id`), USING/WITH CHECK pairs are symmetric on UPDATE, policies are
idempotent, and the org-membership guards in `ml-inventory` / `ml-reputation` /
`sync-ml-billing` are correctly gated only behind `tokenRow.organization_id`.
ME-04 (deterministic token lookup via `ORDER BY updated_at DESC`) is applied
consistently in all three token-reading EFs. Onboarding is correctly non-blocking
(D-07) and degrades gracefully on empty tables.

However, three real authorization/correctness defects warrant blocking: the
`process-sync-job` auth guard accepts **any** non-empty Bearer token while
`verify_jwt=false`, exposing the queue-drain endpoint to unauthenticated abuse;
the `ml_product_costs` write path still upserts on `(user_id, item_id)` and writes
`organization_id` only as a best-effort `?? null`, which can desync the org-first
SELECT policy from the actual rows; and the `check_quota` gate is fail-open on RPC
error for *all* tiers, silently bypassing quota enforcement on transient failures.

## Critical Issues

### CR-01: process-sync-job accepts any Bearer token — queue-drain endpoint is effectively unauthenticated

**File:** `supabase/functions/process-sync-job/index.ts:31-39` (config: `supabase/config.toml:65-66`, `verify_jwt = false`)
**Issue:** The function runs with `verify_jwt = false`, and the in-function guard
`requireCronOrServiceRole` only checks that the header starts with `"Bearer "` and
is longer than 10 characters:

```ts
function requireCronOrServiceRole(req: Request): Response | null {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ") && auth.length > 10) return null;
  ...
}
```

No token value is validated. Any external caller sending
`Authorization: Bearer aaaaaaaaaaa` passes the guard. The handler then claims and
dispatches sync jobs using the internal **service-role** key. An attacker can
repeatedly hit the endpoint to: drain/advance the job queue out of band, force
ML API syncs (burning ML rate limits and the org's `check_quota` budget), and
mark jobs `failed`/`completed`. The function-level comment ("We only block
completely unauthenticated calls") confirms this is intentional but it is not
sufficient for an endpoint that performs privileged work. The
`X-Cron-Secret`/Bearer service-role contract described in the file header
docstring is not actually enforced.
**Fix:** Validate the bearer value against a real secret. Either compare to the
service-role key, or require a dedicated cron secret header:

```ts
const CRON_SECRET = (Deno.env.get("CRON_SECRET") ?? "").trim();
function requireCronOrServiceRole(req: Request): Response | null {
  const auth = (req.headers.get("authorization") ?? "").replace("Bearer ", "").trim();
  const cron = req.headers.get("x-cron-secret") ?? "";
  if ((SERVICE_KEY && auth === SERVICE_KEY) || (CRON_SECRET && cron === CRON_SECRET)) {
    return null;
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
```

Note the migration `20260614122500` already wires the cron call with a real
`service_role_key` Bearer, so comparing against `SERVICE_KEY` would keep cron
working while closing the hole.

### CR-02: ml_product_costs write path can produce rows invisible to its own org (org-first SELECT desync)

**File:** `src/hooks/useMLProductCosts.ts:83-93` and `:118-120`; constraint `supabase/migrations/20260514120000_ml_product_costs.sql:10` (`UNIQUE (user_id, item_id)`); policy `supabase/migrations/20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql:46-65`
**Issue:** TENANT-01 makes SELECT/INSERT/UPDATE org-first and requires
`organization_id IS NOT NULL`. But the client upsert writes
`organization_id: currentOrg?.id ?? null` and conflicts on `user_id,item_id`:

```ts
.upsert({ user_id: user.id, organization_id: currentOrg?.id ?? null, item_id, cost, tax_rate, ... },
        { onConflict: "user_id,item_id" });
```

Two failure modes result:
1. If `currentOrg` is momentarily null (org context still loading, race on mount),
   the row is written with `organization_id = NULL`. After TENANT-02 sets the
   column `NOT NULL`, this **insert fails** outright (constraint violation) — the
   cost silently does not save (the error is only `console.warn`-ed at line 94 for
   `upsert`, or thrown at 124 for batch). Before NOT NULL is applied, the row is
   written but is then **invisible** to the new `mpc_select` policy
   (`organization_id IS NOT NULL` guard), so the user cannot see the cost they
   just entered.
2. The unique key is still `(user_id, item_id)`, not org-scoped. The SELECT policy
   reads "any member of the org sees costs of any member" (D-11), but a cost edited
   by member B for the same item creates a **second row** under B's `user_id`
   rather than updating A's row. The org then sees duplicate cost rows for one
   item, and which one wins downstream (`Map.set(row.item_id, ...)` at
   `useMLProductCosts.ts:54`) is non-deterministic / load-order dependent.
**Fix:** (a) Guard the writes so they never persist a NULL org — bail if
`!currentOrg` instead of coercing to null:

```ts
if (!user || !currentOrg) return;        // upsert
if (!user || !currentOrg || rows.length === 0) return 0;  // upsertBatch
// ...payload: organization_id: currentOrg.id  (never ?? null)
```

(b) Align the conflict target with the org-first model: introduce a
`UNIQUE (organization_id, item_id)` constraint and upsert
`onConflict: "organization_id,item_id"` so one item has exactly one cost per org
regardless of which member edits it. Otherwise the D-11 "shared cost across the
org" goal is not actually achieved by the write path.

### CR-03: check_quota gate is fail-open for all tiers on RPC error — quota enforcement bypassable

**File:** `supabase/functions/process-sync-job/index.ts:69-89`
**Issue:** The quota gate treats any error from `check_quota` as "allow":

```ts
if (quotaErr) {
  console.error(...);
  // Erro no RPC não bloqueia o job — log e continua (fail-open para não travar orgs enterprise)
} else if (withinQuota === false) {
  // ...mark failed, skip
}
```

The justification ("não travar orgs enterprise") is wrong: enterprise is already
handled *inside* `check_quota` (returns `true` for `sync_interval_minutes` NULL or
`-1`, migration `20260614122000:39-41`). So the fail-open path is never needed for
enterprise — it instead means that for paid/limited tiers, any transient RPC error
(timeout, deploy window, missing `organization_plans` row error, etc.) **silently
disables the quota gate** for that invocation. Since `process-sync-job` runs every
5 minutes (migration `20260614122500`), an attacker (see CR-01) or a flaky DB can
drive unlimited syncs against a limited plan. This defeats TENANT-03's purpose.
Additionally, `check_quota` *increments* `sync_quota_daily` as a side effect even
when the job ultimately fails dispatch or when the RPC partially errors, so the
counter and the actual sync count can drift.
**Fix:** Fail **closed** for limited tiers — if the gate cannot be evaluated, do
not dispatch:

```ts
if (quotaErr) {
  console.error(`quota check error org=${job.organization_id}:`, quotaErr.message);
  await sb.from("sync_jobs").update({
    status: "failed",
    error_msg: `quota check failed (fail-closed): ${quotaErr.message}`,
    finished_at: new Date().toISOString(),
  }).eq("id", job.id);
  return json({ ok: false, job_id: job.id, error: "quota_check_failed" }, 200);
}
```

Enterprise is unaffected because it returns `true` before any error path is
reached.

## Warnings

### WR-01: AcceptInvite effect omits `user` from a dependency it reads — stale closure risk

**File:** `src/pages/AcceptInvite.tsx:28-53`
**Issue:** The effect reads `user` (lines 45-49) but the dependency array is
`[token, authLoading, user]` — `user` *is* present, good. However the inner async
IIFE captures `user` at first run; when `handleSwitchAccount` signs out, the effect
re-runs (user → null) but the preview `invoke` is fired again unconditionally on
every `user` change, including after a successful accept where `setSession` updates
`user`. This re-triggers `org-invite-accept` `mode:"preview"` against a token that
may now be consumed, briefly flipping the UI to `"error"` before the
`setTimeout(navigate)` fires. Functionally the redirect still happens, but the
flash of "Convite inválido" is a real UX defect.
**Fix:** Short-circuit the effect once `step === "done"`:
`if (authLoading || step === "done") return;` before the IIFE.

### WR-02: ml-reputation logs raw ML access usage and returns ML API errors as 502 without org guard ordering note — feedback endpoints fire even when membership fails silently

**File:** `supabase/functions/ml-reputation/index.ts:58-64`
**Issue:** The membership guard at 58-64 only runs `if (tokenRow.organization_id)`.
The `is_org_member` RPC result is destructured as `{ data: isMember }` with **no
error check** — if the RPC itself errors (returns `{ data: null, error }`),
`isMember` is `null` (falsy) and the request is correctly 403'd, which is safe.
But the same pattern in `ml-inventory:104-114` and `sync-ml-orders:460-471` also
discards the RPC error. While the fail-direction is safe (null → forbidden), a
DB hiccup turns into an opaque 403 with no server log, making multi-tenant access
incidents undebuggable. Consistency aside, the silent-null behavior is acceptable
security-wise but poor for operability.
**Fix:** Log the RPC error before denying: `if (memberErr) console.error(...)`.

### WR-03: process-sync-job marks a claimed job `failed` on quota-exceeded, losing the job permanently

**File:** `supabase/functions/process-sync-job/index.ts:77-88`
**Issue:** When quota is exceeded, the already-claimed (status=`running`) job is set
to `failed` with a quota message. A legitimately-queued sync is therefore
**discarded**, not deferred — the org simply loses that sync cycle instead of
having it retried after the daily window resets. Combined with the retry-watchdog
(noted in migration `20260614122500`), a `failed` job may also be retried and
re-increment the quota counter, compounding the drift from CR-03.
**Fix:** Re-queue rather than fail: set status back to `pending` (or a
`deferred` state) without incrementing again, or have `check_quota` not increment
when it returns false. Distinguish "quota exceeded" (transient/expected) from
"dispatch error" (real failure).

### WR-04: sync-ml-billing daily mode silently swallows missing-org with success:true

**File:** `supabase/functions/sync-ml-billing/index.ts:257-260`
**Issue:** In `daily` mode, when `organizationId` is null the function returns
`{ success: true, daily: null, warning: "organization_id missing" }` (HTTP 200).
A caller (cron or client) sees success and assumes billing is synced, but nothing
was written. Given Phase 43 makes `organization_id` mandatory elsewhere, a null
here indicates a real data gap that is being masked. Same masking exists in the
monthly path at lines 292-294.
**Fix:** Return a non-success signal (e.g. `{ success: false, error:
"organization_id missing for store" }`, status 422) so the gap surfaces in logs
and dashboards instead of being recorded as a successful no-op.

### WR-05: ml_product_costs upsert error is only console.warn'ed — silent data loss for single upsert

**File:** `src/hooks/useMLProductCosts.ts:94`
**Issue:** `upsert` performs an optimistic local `setCosts` (line 73) and then, on
persistence failure, only `console.warn`s (line 94) without reverting the optimistic
state or surfacing a toast. The user sees the cost "saved" in the UI while the DB
write failed (very likely after TENANT-02's NOT NULL constraint when `currentOrg`
is null — see CR-02). `upsertBatch` correctly throws (line 124); the single
`upsert` does not — inconsistent and data-losing.
**Fix:** Revert the optimistic map entry and surface the error (throw or toast)
on failure, mirroring `upsertBatch`.

### WR-06: useOnboardingProgress write mutation no-ops silently when orgId is null

**File:** `src/hooks/useOnboardingProgress.ts:161-162`
**Issue:** `completeMutation.mutationFn` returns early `if (!orgId) return;` with no
error. `completeStep` (called from the wizard's `handleSkip`,
`OnboardingWizard.tsx:116`) then resolves successfully and the wizard advances the
focused step, but nothing was persisted. On reload the skipped optional step
reappears. Low impact (auto-detection covers required steps) but the skip is lost.
**Fix:** Either guard the wizard from calling `completeStep` without an org, or
reject the mutation so the caller can react.

### WR-07: ml_targets remains org-unscoped — outside multi-tenant isolation (coverage gap)

**File:** `supabase/migrations/20260614120500_tenant02_backfill_orphans_and_notnull.sql:71-73,135-136` (referenced, not modified)
**Issue:** Confirmed via the migration's own notes: `ml_targets` has neither
`organization_id` nor `ml_user_id` and is explicitly excluded from the org-scoped
model and from the per-org isolation test. None of the reviewed Phase-43 files add
RLS or org scoping to `ml_targets`. If `ml_targets` (sales goals) is readable by
the `authenticated` role with only a `user_id`/`seller_id` scope, goals could be
cross-visible in a future multi-org scenario where a user belongs to multiple orgs
sharing a seller. This matches the known observation flagged in the task.
**Fix:** Track as an explicit Phase-44 item: add `organization_id` to `ml_targets`
with org-first RLS, and add it to the isolation test matrix. For Phase 43, record
as an accepted coverage gap (no per-org isolation for goals).

## Info

### IN-01: ml-inventory pagination ceiling silently truncates large sellers

**File:** `supabase/functions/ml-inventory/index.ts:29-41`
**Issue:** `fetchItemIdsByStatus` breaks at `offset >= 10000`. Sellers with >10k
active+paused listings are silently truncated — inventory summary undercounts. No
warning is logged for the truncation case.
**Fix:** Log a warning when `offset >= 10000` is the break reason.

### IN-02: `as any` body cast in AcceptInvite drops type safety on invoke payload

**File:** `src/pages/AcceptInvite.tsx:62`
**Issue:** `const body: any = { token, mode: "accept" };` — consistent with the
project's documented allowance for `any` on third-party shapes, but here the shape
is internal and typeable.
**Fix:** Type the body explicitly: `{ token: string; mode: "accept"; password?: string }`.

### IN-03: Duplicate listing_type fallback chains across EFs (DRY)

**File:** `supabase/functions/sync-ml-orders/index.ts:70-80` and `:320-321`
**Issue:** `LISTING_TYPE_MAP` and the UF→region table duplicate logic that the file
comments say mirrors `src/lib/tax/regions.ts`. Drift risk between the two copies.
**Fix:** Acceptable for Deno isolation; note for future shared-module extraction.

### IN-04: OnboardingBanner dismissal is per-render-session only (useState)

**File:** `src/components/onboarding/OnboardingBanner.tsx:21,56`
**Issue:** `dismissed` is component-local `useState`; navigating away and back
re-shows the banner. The doc comment claims "por sessão" but it is actually
per-mount. Minor UX mismatch with the stated intent; not a bug.
**Fix:** Persist dismissal to `sessionStorage` if "per session" is the real intent.

### IN-05: progressPct divides by ONBOARDING_STEPS.length (4) but isComplete uses REQUIRED_STEPS (3)

**File:** `src/components/onboarding/OnboardingBanner.tsx:24-26`, `src/hooks/useOnboardingProgress.ts:16,141-144`
**Issue:** The banner computes `progressPct = completedCount / totalSteps` over all
4 steps (including optional `tiny`), while `isComplete` only requires 3. A user who
finishes the 3 required steps but skips Tiny sees `isComplete = true` yet the bar
shows 75%, or 100% only if Tiny was also completed. Cosmetic inconsistency between
"complete" and the progress bar.
**Fix:** Base `progressPct` on `REQUIRED_STEPS` (or cap at 100% when `isComplete`).

---

_Reviewed: 2026-06-14T12:24:42Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
