---
phase: 41-veracidade-total
reviewed: 2026-06-13T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - supabase/migrations/20260612140000_ml_billing_monthly.sql
  - supabase/functions/sync-ml-billing/index.ts
  - src/hooks/useMLBilling.ts
  - src/hooks/useMLSync.ts
  - src/components/mercadolivre/MLCostCard.tsx
  - src/pages/MercadoLivre.tsx
  - src/integrations/supabase/types.ts
  - src/pages/mercadolivre/MLAnuncios.tsx
findings:
  critical: 1
  high: 3
  medium: 6
  low: 8
  total: 18
status: issues_found
---

# Phase 41 (veracidade-total): Code Review Report

**Reviewed:** 2026-06-13
**Depth:** standard (with cross-file tracing of the billing pipeline)
**Files Reviewed:** 8
**Status:** resolved (2026-06-13) — CR-01, HI-01, HI-02, HI-03, ME-01, ME-02, ME-03 e LO-07 corrigidos no commit de fixes da fase (EF v6 redeployada, smoke OK). ME-04/ME-05/ME-06 (segurança multi-tenant: ml_tokens lookup, enumeração ml_user_id, RLS viewer) deferidos para a Phase 43 — Multi-Tenant Hardening. LO-01..LO-06 e LO-08 registrados como backlog de baixa prioridade.

## Summary

Reviewed the full DATA-04/05/06 + DRE pipeline: migration → EF `sync-ml-billing` → `useMLBilling`/`useMLBillingWithSync` → `useMLSync` billing trigger → `MLCostCard`/`MercadoLivre.tsx` wiring → `MLAnuncios.tsx` commCache change. Domain rules (invoice = closing month N+1; bonuses B* merged as "Cancelamentos de tarifas"; DRE always full calendar month) were respected and are NOT flagged. The dominant problems are: (1) the billing read query breaks for multi-store organizations, (2) the EF masks auth/transport failures as "no billing data" with no token refresh, (3) closed months are never re-synced once a row exists, and (4) the DATA-05 change unleashes an unthrottled request burst on `/anuncios`.

## Narrative Findings (AI reviewer)

## Critical

### CR-01: `useMLBilling` uses `.maybeSingle()` with `.in(ml_user_id, resolvedMLUserIds)` — breaks for multi-store organizations

**File:** `src/hooks/useMLBilling.ts:156-162`
**Issue:** The query filters by `.in("ml_user_id", resolvedMLUserIds)` and then calls `.maybeSingle()`. `MLStoreContext` supports `selectedStore === "all"` with multiple ML accounts (`resolvedMLUserIds.length > 1`), and `useMLSync.ts:181-189` invokes `sync-ml-billing` for **each** `mlUserId`, so the table is guaranteed to hold one row per store per month. With 2+ rows, `.maybeSingle()` returns a PGRST116 error, `queryFn` throws, `data` is `undefined`, and the DRE permanently falls back to `fonte: "estimado"` — while `useMLBillingWithSync` keeps re-invoking the EF (because `data` is falsy and the query error never resolves), wasting EF/ML calls every time a new month is viewed. Even if it didn't error, showing a single store's invoice for an "all stores" scope would be wrong: charges must be merged across accounts.
**Fix:**
```ts
const { data, error } = await supabase
  .from("ml_billing_monthly")
  .select("*")
  .eq("organization_id", orgId)
  .in("ml_user_id", resolvedMLUserIds)
  .eq("period_month", periodMonth); // no maybeSingle

if (error) throw error;
if (!data || data.length === 0) return null;

// merge rows: concat charges, sum resumo.cffe/cfonpn, max(synced_at)
const charges = data.flatMap((r) => (r.charges as Charge[]) ?? []);
const cffe = data.reduce((s, r) => s + Number((r.resumo as any)?.cffe ?? 0), 0);
// ...
```

## High

### HI-01: EF treats ML 401/429/5xx the same as 404 and returns `success:true, billing:null` — expired tokens silently produce "no billing data" forever

**File:** `supabase/functions/sync-ml-billing/index.ts:45-48, 80-83, 208-213`
**Issue:** `fetchBillingPeriod` returns `null` for **any** non-ok response on the periods/details calls (the comment claims "404 = seller without Full", but 401 expired token, 403, 429 rate limit and 5xx all take the same path). The handler then returns HTTP 200 `{ success: true, billing: null }`. There is no token-expiry check and no call to the existing `ml-token-refresh` EF (other sync EFs in this codebase retry on 401). On the client, `useMLBillingWithSync` marks the month in `attemptedMonths` and never retries — so a transient 401/429 converts into a permanent "estimado" DRE for that month within the session, indistinguishable from a genuine account-without-Full. This directly undermines the "veracidade total" goal of the phase.
**Fix:** In `fetchBillingPeriod`, branch on status: on 401 attempt token refresh (or return a distinct error so the handler responds 401), on 404 return `null`, on 429/5xx throw so the handler returns 5xx and the client can retry. Example:
```ts
if (!periodsResp.ok) {
  if (periodsResp.status === 404) return null;        // genuinely no billing
  throw new Error(`billing/periods ${periodsResp.status}`); // surface real failures
}
```

### HI-02: Closed months are never re-synced once a row exists — partial mid-month data becomes permanently stale

**Files:** `src/hooks/useMLSync.ts:179-189`, `src/hooks/useMLBilling.ts:201-204`
**Issue:** `useMLSync` only syncs billing for `currentPeriodMonth` (today's month). `useMLBillingWithSync` only invokes the EF when the month has **no** row (`if (... data ...) return`). Consequence: if a row for consumption month N is upserted during month N (the EF will find the N+1 invoice key as soon as ML opens that period, with partial accrual), that row is frozen at whatever was synced last — after the invoice closes in N+1, nothing ever refreshes it. The DRE for the previous month will silently diverge from the official closed invoice (missing end-of-month charges, final adjustments, cancellations). The on-demand path can't fix it because it skips months that already have data.
**Fix:** In `useMLSync`, also invoke `sync-ml-billing` for the previous month (`format(subMonths(new Date(), 1), "yyyy-MM")`); and/or in `useMLBillingWithSync`, re-sync when `data.synced_at` is older than the invoice close date (first days of month N+1).

### HI-03: DATA-05 commCache effect fires an unthrottled parallel request burst for every filtered item, in every view, on every filter change

**File:** `src/pages/mercadolivre/MLAnuncios.tsx:820-844` (changed in commit 6287a003)
**Issue:** Removing the `columnView !== "financeiro"` guard means that on initial page load (and on every search keystroke / filter toggle that changes `filteredItemKey`), `toFetch.forEach(async ...)` fires `fetchCosts()` for **all** filtered items simultaneously — one edge-function invocation + ML `listing_prices` call per item, with no concurrency limit, no batching, and no debounce. A catalog of several hundred listings produces hundreds of concurrent requests at once, which will trip ML rate limits (429s degrade other features sharing the token) and burn EF invocations. Additionally, `callEdgeFn` only soft-fails on `!res.ok`; a network-level `fetch` rejection propagates out of the un-awaited `async` callback as an unhandled promise rejection.
**Fix:** Keep the cache population eager if needed, but process `toFetch` through a small concurrency pool (e.g., 4–6 at a time) with `try/catch` per item, and debounce on `filteredItemKey`. Example: chunk `toFetch` and `await Promise.allSettled(chunk.map(...))` sequentially per chunk.

## Medium

### ME-01: `MLCostCard` `loading` is wired to the wrong waterfall — month navigation shows stale/zero figures with no loading state

**File:** `src/pages/MercadoLivre.tsx:678` (with 208-214, 231-233)
**Issue:** The card receives `loading={costWaterfallLoading}`, which is the loading state of the **filter-period** waterfall (`currentFrom/currentTo`), not of `dreWaterfall` (the `monthlyCostWaterfall` / `filterMonthWaterfall` actually feeding `receitaMes`, `cmvMes`, `impostosMes`). When the user navigates months via ‹ ›, `filterMonthWaterfall` is `undefined` while loading, so `receitaMes` renders R$ 0 alongside the previous (or freshly synced) month's tariffs — producing a flash of a large bogus negative "Lucro do mês" with no skeleton.
**Fix:** Expose `isLoading` from the `useMLCostWaterfall` call used for the DRE month and pass `loading={dreWaterfallLoading || billingQuery.isLoading}`.

### ME-02: `attemptedMonths` is not keyed by store scope — switching stores suppresses on-demand sync

**File:** `src/hooks/useMLBilling.ts:197-204`
**Issue:** `attemptedMonths` is a `useRef<Set<string>>` keyed only by `periodMonth`. If the user views month X with store A selected (sync attempted), then switches to store B (different `resolvedMLUserIds`) without unmounting the page, the effect skips the sync for store B (`attemptedMonths.current.has(periodMonth)` is true) — store B's billing for that month is never fetched and the DRE stays "estimado".
**Fix:** Key the set by `${resolvedMLUserIds.join(",")}:${periodMonth}`, or clear the set in an effect when `resolvedMLUserIds` changes.

### ME-03: Client swallows all EF invocation results — failures are indistinguishable from "no invoice" and never retried

**File:** `src/hooks/useMLBilling.ts:208-220`
**Issue:** `Promise.allSettled(...)` results are discarded; `supabase.functions.invoke` errors (401/403/500, network) are never inspected. Combined with the eager `attemptedMonths.current.add(periodMonth)` **before** the invocation, any transient failure permanently disables sync for that month in the session. The docstring claims only "Períodos sem fatura no ML não são re-tentados", but in reality failed attempts are also never retried.
**Fix:** Inspect settled results; only add the month to `attemptedMonths` when at least one invocation returned 2xx (and remove it on total failure so a later render can retry).

### ME-04: `ml_tokens` lookup is non-deterministic — `.limit(1).maybeSingle()` without `ORDER BY` or org scoping

**File:** `supabase/functions/sync-ml-billing/index.ts:160-166`
**Issue:** If `ml_tokens` ever holds more than one row for the same `ml_user_id` (store reconnection, historical rows), `.limit(1)` picks an arbitrary row: possibly a stale `access_token` (guaranteeing the HI-01 silent-401 path) or a row with a different/old `organization_id`, in which case the upsert writes the billing data under the **wrong organization**. Other EFs in this repo order by recency for the same lookup.
**Fix:** Add `.order("updated_at", { ascending: false })` (or filter `expires_at > now()`), and prefer also scoping by organization when the caller is a user JWT.

### ME-05: ml_user_id enumeration — 404 "No ML token found" is returned before the org-membership check

**File:** `supabase/functions/sync-ml-billing/index.ts:168-173` vs `180-197`
**Issue:** Any authenticated user of **any** organization can POST arbitrary `ml_user_id` values and distinguish "store connected on this platform" (403 Forbidden) from "not connected" (404), because the token-existence check runs before the membership check. This is an information-disclosure oracle across tenants on a multi-tenant SaaS (v7.0 direction).
**Fix:** Perform the membership check against the row's `organization_id` first and return a uniform 404 (or 403) for both "no token" and "not a member".

### ME-06: RLS policy grants INSERT/UPDATE/DELETE on billing data to every org member, including `viewer`

**File:** `supabase/migrations/20260612140000_ml_billing_monthly.sql:16-19`
**Issue:** `FOR ALL USING (is_org_member(...))` lets any org member — the role model includes default-deny `viewer` — write or delete `ml_billing_monthly` rows directly via PostgREST, tampering with the financial DRE shown to the owner. All legitimate writes go through the service-role EF, so client write access is unnecessary.
**Fix:** Replace with `FOR SELECT USING (is_org_member(...))`; writes stay service-role only (bypasses RLS).

## Low

### LO-01: `mlFetch` parses JSON before checking `res.ok`; handler returns 500 for malformed request bodies

**File:** `supabase/functions/sync-ml-billing/index.ts:20-24, 149`
**Issue:** A non-JSON error body from ML (HTML 502 page) makes `res.json()` throw a SyntaxError that masks the real status. Likewise `await req.json()` on an empty/malformed request body throws and is answered 500 instead of 400.
**Fix:** `const text = await res.text(); const data = text ? JSON.parse-safe : null;` check `res.ok` first; wrap `req.json()` in try/catch → 400.

### LO-02: Service-role key compared with `===` (non-constant-time)

**File:** `supabase/functions/sync-ml-billing/index.ts:134`
**Issue:** Secret comparison via `token === serviceKey` is not timing-safe. Practical exploitability is low, but `crypto.timingSafeEqual` (or comparing SHA-256 digests) is the defensive norm for secret checks.
**Fix:** Compare fixed-length hashes of both values.

### LO-03: Sync cooldown is consumed by validation failures

**File:** `src/hooks/useMLSync.ts:84-101`
**Issue:** `_lastSyncStart = now` is set before the `orgId` check; if the user has no org selected, the call aborts with a toast but the next (valid) attempt within 30 s is rejected with the misleading "Sincronização em andamento" message.
**Fix:** Set `_lastSyncStart` only after all preconditions pass (just before `_activePromise = run()`).

### LO-04: `ml_sync_log` upsert failure produces a destructive "Erro" toast after a fully successful sync

**File:** `src/hooks/useMLSync.ts:201-217`
**Issue:** The log upsert runs inside the main `try` after the success path; a logging failure (constraint, RLS) surfaces as a sync error to the user even though all data synced.
**Fix:** Wrap the `ml_sync_log` upsert in its own `try/catch` like the other non-fatal steps.

### LO-05: Loose substring matching for CFFE/CFONPN extraction

**File:** `supabase/functions/sync-ml-billing/index.ts:98-99`
**Issue:** `String(c.type).includes("CFFE")` will also match any future type that merely contains the substring (and a hypothetical bonus typed `BCFFE` would be summed into `cffe` while `BFFE` would not — inconsistent net/gross semantics for `resumo.cffe`). `resumo.cffe/cfonpn` are currently unconsumed by the UI, but they are the documented fallback replacement for orders frete.
**Fix:** Use exact-type sets (e.g., `["CFFE"]` / `["CFONPN"]`) and decide explicitly whether freight cancellations (BFFE) net against `cffe`.

### LO-06: Dead condition in invoice-period matching

**File:** `supabase/functions/sync-ml-billing/index.ts:63`
**Issue:** `k.substring(0, 7) === month` is exactly equivalent to `k.startsWith(month)` (month is always 7 chars) — redundant branch that obscures the matching rule.
**Fix:** Drop the duplicate condition.

### LO-07: `adsSpendMes` prop is declared, documented and passed but never used by `MLCostCard`

**Files:** `src/components/mercadolivre/MLCostCard.tsx:30-31, 44-57`; `src/pages/MercadoLivre.tsx:677`
**Issue:** The prop is in `MLCostCardProps` with a docstring ("usado no fallback estimado") but is omitted from the component's destructuring — the fallback ads line is actually built in the parent via `gruposTarifasEfetivos`. Dead API surface that misleads future maintainers.
**Fix:** Remove the prop from the interface and the call site.

### LO-08: `period_month` has no format constraint; `fonte: "billing"` shown even for empty charge arrays

**Files:** `supabase/migrations/20260612140000_ml_billing_monthly.sql:7`; `src/pages/MercadoLivre.tsx:242-246`
**Issue:** (a) `period_month TEXT` accepts any string on direct writes (only the EF validates `YYYY-MM`), risking unmatchable rows. (b) If a row exists with `charges: []` (invoice opened but empty), the DRE shows all-zero tariffs labeled "billing ML" instead of the orders-based estimate, understating costs. Also note `fmt` uses `maximumFractionDigits: 0`, so DRE lines are rounded to whole reais and won't visually reconcile with the lucro line to the centavo.
**Fix:** Add `CHECK (period_month ~ '^\d{4}-\d{2}$')`; treat `charges.length === 0` as no-billing for the `fonte` decision; consider 2-decimal formatting in a DRE context.

---

_Reviewed: 2026-06-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
