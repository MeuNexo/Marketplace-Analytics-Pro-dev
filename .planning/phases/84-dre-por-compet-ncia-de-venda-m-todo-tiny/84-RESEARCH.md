# Phase 84: DRE por Competência de Venda (método Tiny) - Research

**Researched:** 2026-07-03
**Domain:** Supabase Postgres migration (column add + backfill) + Deno Edge Function billing aggregation + React/TanStack Query hook + shadcn UI select — all internal, no new dependencies.
**Confidence:** HIGH (all core claims verified against in-repo code with file:line evidence; ML API shape claim is HIGH via already-working production code + MEDIUM via official ML docs search, WebFetch to the doc page itself was blocked by 403)

## Summary

This phase is a **regime change on an existing, working pipeline**, not new infrastructure. The single new fact the whole design pivots on is already flowing through the code today: `sync-ml-billing/index.ts:136` reads `m.sales_info?.[0]?.sale_date_time` per movement and currently uses it ONLY for the `within()` inclusion test, then discards it once movements are aggregated by `(charge_date, charge_type)`. The fix is to also propagate that value as a first-class `competence_date` column, change the aggregation grain to include it, and stop discarding out-of-window bonus movements on that track.

Critically, the code review surfaced two things not obvious from the design doc: (1) `ml_billing_monthly` (the "fatura" track) and `ml_billing_daily` (the "DRE"/competência track) are **already populated by two completely disjoint code paths** — `fetchBillingPeriod()` (calls ML's own `/summary/details` endpoint) vs. `runDailySync()` → `aggregateInvoice()` (calls `/details` with cursor pagination). The change to `aggregateInvoice()` therefore cannot regress `ml_billing_monthly` by construction — no extra guard needed there. (2) `ml_billing_daily` is completely **absent from `src/integrations/supabase/types.ts`** (verified: `grep -n "billing_daily" types.ts` → zero hits, `tsc --noEmit` → 0 errors anyway, because supabase-js types fall through loosely for unregistered table names). The planner must treat "add `ml_billing_daily` + `competence_date` to types.ts" as a real, currently-missing task, not an incidental follow-up — Phase 52 set the precedent of manually updating `types.ts` after migrations (52-02-PLAN.md).

The riskiest technical decision is NOT called out explicitly in the design doc: the existing `UNIQUE (organization_id, ml_user_id, charge_date, charge_type, source_invoice_key)` constraint on `ml_billing_daily` does not include the new `competence_date` column. Once the aggregation grain becomes `(competence_date, charge_date, charge_type)`, two rows can legitimately share the same `(charge_date, charge_type)` while differing only in `competence_date` (e.g., two sales in different months both charged a commission that posted on the same invoice day) — the current UNIQUE constraint would silently make the second insert of such a pair a constraint violation. This constraint MUST be widened as part of the same migration.

**Primary recommendation:** (1) Migration: `ALTER TABLE ml_billing_daily ADD COLUMN competence_date DATE`, backfill `competence_date := charge_date` in the same migration (never leave it NULL, or the DRE goes blank the instant the frontend filter switches), widen the UNIQUE constraint to include `competence_date`, add a supporting index. (2) EF: extend `aggregateInvoice()`'s per-movement key and output row to carry `competence_date = saleDate ?? m.date`, remove the `else signed = null` branch for bonus movements (no more window exclusion on this track), keep the "fatura" path (`fetchBillingPeriod`) completely untouched. (3) Hook: `useMLBillingDaily` selects and filters on `competence_date` instead of `charge_date`, and the internal `coverageTo` tracking (used by `useMLBillingDailyWithSync`'s staleness guard) must also switch to tracking `competence_date`, not `charge_date`. (4) UI: add a `<Select>` month dropdown next to the existing arrows in `MLCostCard`, wired to a new `onSelectMonth` prop, mirroring the existing `MLStoreSelector.tsx` Select pattern. (5) Backfill: loop `mode:"daily"` invocations (no `ml_user_id` → fans out to all accounts already) for every `period_month` from `2026-01` through the current month, sequentially — reuse the exact `net.http_post` + `vault.decrypted_secrets` Pattern B recipe already live in `20260684000000_sync_ml_billing_cron.sql`, run one month at a time (each invocation is itself a background job hitting the real ML API with its own backoff/retry — firing all 6-7 months in parallel risks re-triggering the exact rate-limit bug just fixed today).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Competence-date resolution (saleDate ?? charge_date) | API / Backend (Edge Function) | — | Must happen once, at ingestion, from the ML API's own per-movement `sales_info` — never recomputed client-side or re-derived from `orders` |
| Aggregation grain change `(competence_date, charge_date, charge_type)` | API / Backend (EF) | Database (schema) | EF decides how rows are grouped before writing; DB just stores/constrains the result |
| Column + constraint migration | Database / Storage | — | Schema-only change, applied via Supabase MCP `apply_migration`, no RPC involved (table is queried directly by the client, not through an RPC) |
| DRE month filter (`charge_date`→`competence_date`) | Frontend Server... N/A (this is a pure SPA) → **Browser / Client** (React Query hook) | — | `useMLBillingDaily` runs entirely client-side against Supabase via RLS; no server-rendering tier exists in this stack |
| Month dropdown UI | Browser / Client | — | Pure presentational state, delegates to existing `onPrevMonth`/`onNextMonth`-style handler in the parent page |
| Backfill invocation (2026 invoices) | Database (pg_net trigger) → API / Backend (EF) | — | Fired via `net.http_post` from SQL (Pattern B), executed by the EF against the live ML API; not a frontend concern |

## Package Legitimacy Audit

**Not applicable.** This phase introduces zero new npm/PyPI/crates packages. The UI dropdown uses the already-installed shadcn `Select` primitive (`src/components/ui/select.tsx`, confirmed present on disk); all other work is a migration + edits to an existing Edge Function and hook. No `Package Legitimacy Gate` run required.

## Architecture Patterns

### System Architecture Diagram

```
ML Billing API (/billing/integration/.../details, group=ML|MP)
   │  each movement: { charge_info: {detail_id, creation_date_time, detail_sub_type,
   │                    detail_amount, detail_type}, sales_info: [{sale_date_time}] }
   ▼
sync-ml-billing EF — fetchGroupMoves()  (cursor from_id pagination, dedup by detail_id)
   │  RawMove { detailId, date=charge_date, type, label, amount, isBonus, saleDate }
   ▼
sync-ml-billing EF — aggregateInvoice()  ◄── CHANGES HERE (Phase 84)
   │  competence_date = saleDate ?? date (charge_date fallback)
   │  key = `${competence_date}|${date}|${type}`   (was: `${date}|${type}`)
   │  sign: non-bonus = +amount (unchanged)
   │        bonus     = -amount ALWAYS (was: -amount only if saleDate within invoice window,
   │                                          else DROPPED — this exclusion is REMOVED)
   ▼
runDailySync()  — delete-by-source_invoice_key, insert rows incl. competence_date
   ▼
ml_billing_daily table (Postgres)
   │  UNIQUE (organization_id, ml_user_id, competence_date, charge_date,
   │          charge_type, source_invoice_key)   ◄── WIDENED constraint (Phase 84)
   ▼
useMLBillingDaily(periodMonth) — React Query hook
   │  .gte("competence_date", from).lte("competence_date", to)   ◄── CHANGED filter
   │  coverageTo tracked from competence_date, not charge_date   ◄── CHANGED
   ▼
useMLBillingDailyWithSync — staleness guard, triggers re-sync when incomplete
   ▼
MercadoLivre.tsx (page) — computes lucro/margem from receita − tarifas − CMV − impostos
   ▼
MLCostCard — renders DRE card; NEW: month <Select> dropdown alongside ◄ ► arrows
```

Separately, and UNCHANGED by this phase:
```
ML Billing API (/billing/integration/.../summary/details, ML's own aggregation)
   ▼
fetchBillingPeriod()  →  ml_billing_monthly table  →  useMLBilling() hook  → "fonte=billing" fallback in MLCostCard
```

### Recommended Project Structure
No new files/directories. Touches:
```
supabase/migrations/
└── 202606850000XX_ml_billing_daily_competence_date.sql   # NEW — column+backfill+constraint+index
supabase/functions/sync-ml-billing/
└── index.ts                                              # EDIT — aggregateInvoice() + runDailySync() payload
src/hooks/
└── useMLBilling.ts                                        # EDIT — useMLBillingDaily filter + coverageTo tracking
src/components/mercadolivre/
└── MLCostCard.tsx                                         # EDIT — add month <Select>, new onSelectMonth prop
src/pages/
└── MercadoLivre.tsx                                       # EDIT — wire onSelectMonth to existing dreMonthOverride state
src/integrations/supabase/
└── types.ts                                                # EDIT — add ml_billing_daily table entirely (currently missing) incl. competence_date
```

### Pattern 1: Idempotent ALTER TABLE ADD COLUMN + backfill in one migration
**What:** Add the column nullable-first, immediately backfill it in the SAME migration file so no query against the table ever sees a NULL, then (optionally) tighten to NOT NULL.
**When to use:** Any additive schema change on a table already read by production code — the gap between "column exists" and "column populated" must be zero-width.
**Example (established repo pattern — file:line evidence: `supabase/migrations/20260666000000_fornecedor_scope.sql:10`, `20260663000000_replenishment_params_add_sku_scope.sql`):**
```sql
-- ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS fornecedor TEXT;
-- (Phase 84 analog, adapted:)
ALTER TABLE public.ml_billing_daily ADD COLUMN IF NOT EXISTS competence_date DATE;

UPDATE public.ml_billing_daily
SET competence_date = charge_date
WHERE competence_date IS NULL;

ALTER TABLE public.ml_billing_daily ALTER COLUMN competence_date SET NOT NULL;
```

### Pattern 2: Widening a UNIQUE constraint without knowing its auto-generated name
**What:** The original `ml_billing_daily` table (`20260613020000_ml_billing_daily.sql:16`) declares `UNIQUE (organization_id, ml_user_id, charge_date, charge_type, source_invoice_key)` inline in `CREATE TABLE`, so Postgres auto-generated (and likely truncated, since the column list exceeds 63 chars) the constraint name. Do not hardcode a guessed name — look it up.
**When to use:** Any migration that needs to DROP a constraint whose name was never explicitly assigned.
**Example:**
```sql
DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'public.ml_billing_daily'::regclass AND contype = 'u';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ml_billing_daily DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE public.ml_billing_daily
  ADD CONSTRAINT ml_billing_daily_uniq
  UNIQUE (organization_id, ml_user_id, competence_date, charge_date, charge_type, source_invoice_key);

-- Supporting index for the new query filter shape (mirrors idx_ml_billing_daily_lookup)
CREATE INDEX IF NOT EXISTS idx_ml_billing_daily_competence
  ON public.ml_billing_daily (organization_id, ml_user_id, competence_date);
```
This must be confirmed against the live schema before finalizing (see Open Questions) — verify via MCP `list_tables`/`execute_sql` that exactly one UNIQUE constraint exists on this table before relying on the `LIMIT`-less `SELECT INTO`.

### Pattern 3: shadcn month `<Select>` mirroring existing store selector
**What:** A simple, ungrouped `<Select>` populated with a fixed list of options, not a full calendar/range popover (that pattern — `MLPeriodPicker.tsx` — is for date RANGES with quick presets, overkill for "pick one calendar month from a known small list").
**When to use:** Discrete, bounded, month-granularity selection.
**Example (source: `src/components/mercadolivre/MLStoreSelector.tsx:1-34`, adapted):**
```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// months = ["2026-01", "2026-02", ..., currentPeriodMonth()], newest first or oldest first per UX call
<Select value={billingMonth} onValueChange={onSelectMonth} disabled={syncing}>
  <SelectTrigger className="h-6 text-[10px] w-[92px] px-1.5">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {months.map((m) => (
      <SelectItem key={m} value={m}>{formatMesLabel(m)}</SelectItem>
    ))}
  </SelectContent>
</Select>
```
Wire `onSelectMonth={(m) => setDreMonthOverride(m)}` in `MercadoLivre.tsx` — reuses the EXISTING `dreMonthOverride` state (`MercadoLivre.tsx:184-188`) that the arrows already write to via `shiftDreMonth`. No new state needed, just a second writer to the same state.

### Anti-Patterns to Avoid
- **Deploying the frontend filter change before the migration backfill lands:** If `useMLBillingDaily` switches to `.gte("competence_date", ...)` before every existing row has a non-null `competence_date`, the DRE goes blank for any period not yet re-synced. Sequence strictly: migration (with same-transaction backfill) → EF deploy → frontend deploy → then trigger the 2026 re-sync backfill to get the REAL (not charge_date-fallback) competence values.
- **Cross-referencing `orders` to compute competence_date:** The design explicitly rejects this (and it would be strictly worse) — the ML API already gives `sale_date_time` per movement; joining `orders` would reintroduce exactly the kind of heuristic/cross-table risk the design's "Descoberta habilitadora" section calls out as unnecessary.
- **Firing all ~7 months of backfill (`2026-01`..current) as parallel/rapid-fire `net.http_post` calls:** Each invocation triggers a background `EdgeRuntime.waitUntil` job per ML account that itself makes multiple sequential ML API calls with retry/backoff. The rate-limit bug just fixed today (`.planning/debug/resolved/sync-ml-billing-rate-limit.md`) was caused by too many API calls in too short a window — firing many months' worth of syncs at once for the same accounts risks the same failure mode. Backfill sequentially, verifying `ml_billing_daily` row counts/`synced_at` before moving to the next month.
- **Assuming `ml_billing_monthly` needs a code change too:** It doesn't — it's populated by a structurally separate function (`fetchBillingPeriod`) hitting a different ML endpoint. Do not touch it; do not add guards "just in case."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cursor pagination through ML billing details | A new pagination scheme | The already-fixed `from_id`/`last_id` cursor logic in `fetchGroupMoves` (`sync-ml-billing/index.ts:94-156`, deployed today as EF v10) | Already correct, already handles 429/5xx backoff and the guard-against-infinite-loop case; Phase 84 only touches `aggregateInvoice`, not fetching |
| Async trigger-and-forget invocation from Postgres | A custom polling/webhook mechanism | `net.http_post` + `vault.decrypted_secrets` (Pattern B), exact recipe in `20260684000000_sync_ml_billing_cron.sql` | This is the established, audited pattern across the whole codebase (memory: "Pattern B") for cron→EF invocation with a service-role token that never touches client code |
| Multi-account fan-out for backfill | A shell script iterating `ml_tokens` | `mode:"daily"` body WITHOUT `ml_user_id` — already implemented as `runAllAccountsDailySync` (`sync-ml-billing/index.ts:274-308`), service-role only | Already exists, already deduplicates by `ml_user_id` (keeps most-recent token), already logs per-account success/failure |

**Key insight:** This phase's entire "new capability" surface is a data-shape change (one new column, one changed aggregation key, one removed exclusion rule) layered on top of infrastructure that was fully built and fixed earlier today. Resist the urge to add new abstractions (a new RPC, a new sync mode, a new table) — every piece needed already exists in a form that only needs editing, not building.

## Common Pitfalls

### Pitfall 1: UNIQUE constraint not widened → silent insert failures during backfill
**What goes wrong:** Two movements in the SAME invoice, SAME `charge_date`, SAME `charge_type`, but DIFFERENT `competence_date` (e.g., a commission for a June sale and a commission for a May sale both posted on the same invoice day) collide against the old 5-column UNIQUE constraint the moment the aggregation key gains a 6th dimension.
**Why it happens:** The constraint was defined before `competence_date` existed and nobody expects a schema constraint to silently reject valid new data — it will surface as a Postgres insert error inside `runDailySync`'s `.insert(payload.slice(...))` call, which DOES check `if (error) throw`, so this will fail loudly (good) but only during the actual backfill run (late), not during migration review.
**How to avoid:** Widen the constraint in the SAME migration that adds the column (Pattern 2 above), before any EF code deploys that would write the new grain.
**Warning signs:** `insert ml_billing_daily: duplicate key value violates unique constraint` errors during the 2026 backfill.

### Pitfall 2: `coverageTo` staleness guard silently breaks if left on `charge_date`
**What goes wrong:** `useMLBillingDailyWithSync` (`useMLBilling.ts:358-426`) uses `coverageTo` (today: `MAX(charge_date)` among rows already filtered by charge_date) to decide "is this closed month's data complete." If the query filter switches to `competence_date` but `coverageTo` keeps reading `r.charge_date`, the returned rows are now selected by one date dimension while completeness is judged by a DIFFERENT, unfiltered date dimension — a competence-June row could have a charge_date in July (later invoice) or May (earlier invoice absorbed via the removed `within` exclusion), so `MAX(charge_date)` of the filtered set no longer reliably approximates "did June's competence data finish loading."
**Why it happens:** The two fields (`charge_date`, `competence_date`) diverge exactly BECAUSE of this phase's regime change — before Phase 84 they were closely correlated (competence wasn't tracked at all), so this bug wouldn't have existed in the old code.
**How to avoid:** Change `coverageTo` computation to `MAX(r.competence_date)` and add `competence_date` to the `.select(...)` column list at `useMLBilling.ts:311`.
**Warning signs:** Auto re-sync loop for closed months never terminates (polls all 8 tries) or terminates too early (reports "complete" when it isn't) after this phase ships.

### Pitfall 3: Backfill order/gaps — a delayed estorno can land in ANY future invoice
**What goes wrong:** `runDailySync` only ever syncs the 2-invoice pair covering ONE calendar month at a time (`targets = [period_month, nextMonth]`, `index.ts:236-237`). A cancellation of a March sale could be charged in, say, October's invoice. October's own sync is what captures that row (with `competence_date = March`), NOT March's sync. If the 2026 backfill skips any single month in the Jan→current chain, an estorno charged in that skipped invoice never gets ingested, and March's DRE stays permanently short by that amount even though March itself was "backfilled."
**Why it happens:** Direct consequence of removing the `within` exclusion — previously this class of movement was intentionally dropped, so it never mattered which invoice's sync ran; now it matters that EVERY invoice from Jan 2026 onward gets synced at least once, not just the months a user happens to view.
**How to avoid:** Backfill script MUST loop every `period_month` from `2026-01` through the current month with no gaps (see Code Examples), not just "the months Wesley checks."
**Warning signs:** A closed month's DRE total changes again on a LATER, unrelated backfill run (should stabilize once its own invoice + all invoices touching its sales have synced).

### Pitfall 4: `sales_info[0]` — only the first entry is read
**What goes wrong:** `index.ts:136` — `m.sales_info?.[0]?.sale_date_time` — only ever reads the first array entry. If a single billing movement (e.g., a combined shipping charge) references multiple sales with different `sale_date_time` values spanning a month boundary, the ENTIRE movement amount is now assigned wholesale to the first sale's month.
**Why it happens:** Pre-existing simplification (unchanged by this phase) that only mattered for a boolean in/out-of-window test before; now it directly determines which month absorbs the full charge amount, so its blast radius increases.
**How to avoid:** Not a blocker for this phase (matches existing behavior, not a regression), but the plan should include a one-off SQL check during validation: query a reference month's raw `ml_billing_daily` (or, if feasible, log `sales_info.length` in a debug run) to confirm how often `sales_info.length > 1` occurs in production data. If frequent, flag as a follow-up phase; if rare/never, document and move on.
**Warning signs:** A specific movement's competence_date looks implausible relative to its `charge_label`/type when spot-checked.

### Pitfall 5: `types.ts` never had `ml_billing_daily` in the first place
**What goes wrong:** Any code newly written against `ml_billing_daily` gets NO compile-time column checking (typos in column names fail silently at runtime, not at build time) — this is a pre-existing gap (table added 2026-06-13, never typed), not introduced by Phase 84, but Phase 84 is the first time the table's SHAPE changes (new column), which is the natural moment to fix it.
**How to avoid:** Add the full `ml_billing_daily` table definition (all existing columns + `competence_date`) to `types.ts`'s `Database.public.Tables`, following the same manual-update precedent as Phase 52 (`52-02-PLAN.md`: "types.ts atualizado manualmente").
**Warning signs:** None currently (silent gap) — this is a proactive fix, not a bug report.

## Code Examples

### Backfill loop for 2026 invoices (adapt the existing cron SQL, run manually via MCP, sequential)
```sql
-- Source: adapted from supabase/migrations/20260684000000_sync_ml_billing_cron.sql
-- (existing, deployed, live pattern) — run ONE month at a time, verify before next.
SELECT net.http_post(
  url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-billing',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || (
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'service_role_key' LIMIT 1
    )
  ),
  body    := jsonb_build_object('mode', 'daily', 'period_month', '2026-01')  -- then '2026-02', ... through current
) AS request_id;
```

### Reconciliation smoke query (adapt the existing verified pattern from the rate-limit fix, June 2026 reference month)
```sql
-- Source: .planning/debug/resolved/sync-ml-billing-rate-limit.md (already-verified June numbers:
-- 30 dias / R$79.723,87 tarifas totais / PADS R$8.054,90, by charge_date).
-- Phase 84 analog — same shape, grouped by competence_date, PLUS a cross-check that the
-- grand total across ALL competence months for a given source_invoice_key equals the
-- charge_date-grouped total for that same invoice PLUS the previously-dropped estornos.
SELECT count(DISTINCT competence_date) AS meses_competencia,
       sum(amount)                     AS total_tarifas,
       sum(amount) FILTER (WHERE charge_type = 'PADS') AS pads
FROM ml_billing_daily
WHERE organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'   -- Pé Vermeio
  AND ml_user_id = '1639558873'
  AND competence_date >= '2026-06-01' AND competence_date <= '2026-06-30';
```

### Anti-IDOR / RLS — unchanged, already correct
```sql
-- Source: supabase/migrations/20260613020000_ml_billing_daily.sql:30-33 (existing, unmodified)
CREATE POLICY "org_member_billing_daily_select"
  ON public.ml_billing_daily
  FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id));
-- Write path is service-role only (EF), bypasses RLS by design — no policy needed for
-- INSERT/UPDATE/DELETE. Adding competence_date does not change this surface at all.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Billing detail pagination by `offset` (PAGE=200) + double-fetch reconciliation pass | Cursor pagination by `from_id`/`last_id`, `limit=1000` | 2026-07-03, EF v10 (deployed today, same day as this research) | Directly relevant: Phase 84's backfill will hit this same code path; already fixed, no action needed, but the "fire sequentially, not in parallel" caution above is a direct consequence of how recently and how narrowly this was fixed |
| `charge_date`-only DRE (lançamento) | `competence_date`-based DRE (venda) — THIS PHASE | 2026-07-03 (design), not yet built | The subject of this research |

**Deprecated/outdated:** None — this phase does not deprecate `ml_billing_monthly` or the "fatura" fonte in `MLCostCard`; both remain as the intentional "matches the ML invoice line-by-line" reference view.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The auto-generated UNIQUE constraint name on `ml_billing_daily` can be reliably discovered via a single `pg_constraint` lookup filtered by `contype = 'u'` (i.e., there is exactly one UNIQUE constraint on this table today) | Architecture Patterns > Pattern 2 | If a second unique/PK constraint exists that wasn't visible in the migration file review, the `SELECT INTO` could grab the wrong constraint or the `DO` block could no-op silently. Mitigate: verify via MCP `execute_sql` (`SELECT conname, contype FROM pg_constraint WHERE conrelid = 'public.ml_billing_daily'::regclass`) before finalizing the migration, not just via the migration file's history |
| A2 | `sales_info[0].sale_date_time` is present and reliable for ALL sale-linked fee types (CVVML, CFFE, CFONPN, CVVPRC, CVVFNU, etc.) and absent for non-sale fees (PADS, monthly/account fees) — asserted by the design doc and consistent with the code's existing `within()` usage, but not independently re-confirmed against a fresh raw API payload in this research session (WebFetch to the official ML doc page returned 403) | Research questions #1 | If some sale-linked fee type sometimes lacks `sales_info`, those movements silently fall back to `charge_date` — acceptable per spec's own fallback rule, but worth a one-off spot-check per charge_type during Wave 0/validation (e.g., `SELECT charge_type, count(*) FILTER (WHERE competence_date = charge_date) AS fallback_used, count(*) FROM ml_billing_daily GROUP BY charge_type` after backfill) |
| A3 | `sales_info` arrays never contain more than one entry in practice for this account's billing data (Pitfall 4) | Common Pitfalls > Pitfall 4 | If multi-entry movements are common, some charges get misattributed by month; low blast radius (existing simplification, not a regression) but worth the spot-check described |

## Open Questions

1. **Exact current UNIQUE constraint name/shape on `ml_billing_daily` in the LIVE `ckcdevcxgvueywivefgx` project**
   - What we know: The `CREATE TABLE` migration (`20260613020000_ml_billing_daily.sql:16`) declares it inline with 5 columns — the actual deployed name is Postgres-generated and likely truncated.
   - What's unclear: Whether any later migration (not found in this research pass) renamed or altered it.
   - Recommendation: Before writing the final ALTER migration, the executor/orchestrator should run `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.ml_billing_daily'::regclass;` via MCP against the live project to confirm, then use the DO-block lookup pattern (Pattern 2) rather than a hardcoded name regardless.

2. **How many 2026 invoices actually need backfilling, and does any predate 2026-01 with cross-year estorno risk (a December 2025 sale cancelled in a 2026 invoice)?**
   - What we know: Decision is "re-sync das faturas de 2026" (Wesley, locked).
   - What's unclear: Whether a sale from late 2025 could be charged/cancelled in an early-2026 invoice, meaning the "2026 competence months" could need contributions from a 2025-dated invoice sync.
   - Recommendation: Scope the backfill to `period_month` values 2026-01 through current per the locked decision; if the smoke reconciliation (Pitfall 3's check) shows a persistent, unexplained gap in Jan/Feb 2026 after backfill, treat late-2025 invoice sync as a fast-follow, not a Phase 84 blocker (out of the locked scope).

3. **Frequency of `sales_info.length > 1` in production billing data (Pitfall 4 / Assumption A3)**
   - What we know: Code only reads index 0; this is pre-existing, unchanged by this phase.
   - What's unclear: Actual frequency — no raw payload was inspected in this research session (would require a live ML API call with a real token, not available to this research agent).
   - Recommendation: One-off diagnostic during Wave 0 (a temporary console.log of `sales_info.length` in the debug-mode EF run against a real invoice) rather than blocking the phase on it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP tools (`apply_migration`, `deploy_edge_function`, `execute_sql`) | Applying the migration, deploying the EF, running backfill/reconciliation queries | Not available to this research agent (confirmed by the resolved debug log: "este agente ... não tem acesso às tools MCP Supabase") | — | The orchestrator/executor session (not this research agent) has MCP access per established project workflow — matches precedent of every prior phase in this milestone |
| ML API live access (real seller token) to inspect raw `sales_info` payload shape firsthand | Assumption A2/A3 verification | Not available to this research agent (no token, no MCP) | — | Rely on in-repo working code (already reads this field in production) + official ML docs (search-verified, direct WebFetch blocked by 403) as the two independent confirmations available this session |
| shadcn `Select` component | Month dropdown UI | Yes | Present at `src/components/ui/select.tsx` | — |

**Missing dependencies with no fallback:** None — all missing items above have viable fallbacks (defer live-payload verification to the orchestrator session, which has MCP access, same as every prior phase in this project).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth surface changes in this phase |
| V3 Session Management | No | Not touched |
| V4 Access Control | Yes | Existing RLS policy `org_member_billing_daily_select` (SELECT-only, `is_org_member`) already covers the new column — no policy change needed since RLS is row-level, not column-level, and `competence_date` carries no new tenant-scoping requirement |
| V5 Input Validation | Yes | EF already validates `period_month` via zod regex (`BodySchema`, `index.ts:317-321`); no new user-supplied input introduced by this phase (competence_date is derived server-side from ML API data, never client-supplied) |
| V6 Cryptography | No | Not touched |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR via `organization_id`/`ml_user_id` on the widened table | Tampering / Information Disclosure | Unchanged — RLS SELECT policy already scopes by `is_org_member(auth.uid(), organization_id)`; write path is service-role only (bypasses RLS by design, no client ever writes this table directly). Verify via the same anti-IDOR smoke pattern used in Phases 79-83: query as an unrelated org's session and confirm 0 rows. |
| Constraint-widening regression (a looser UNIQUE inadvertently allowing true duplicates across orgs) | Tampering | The widened constraint keeps `organization_id` and `ml_user_id` as the first two columns — cross-org duplication remains structurally impossible; only intra-org, intra-invoice granularity increases (expected/intended) |

## Sources

### Primary (HIGH confidence)
- In-repo code, read directly this session: `supabase/functions/sync-ml-billing/index.ts` (full file), `src/hooks/useMLBilling.ts` (full file), `src/components/mercadolivre/MLCostCard.tsx` (full file), `src/pages/MercadoLivre.tsx` (grep of billing-month state), `supabase/migrations/20260613020000_ml_billing_daily.sql`, `20260655000000_phase58_cron_billing_daily_resync.sql`, `20260684000000_sync_ml_billing_cron.sql`, `20260663000000_replenishment_params_add_sku_scope.sql`, `20260666000000_fornecedor_scope.sql`, `20260683000000_margin_with_ads_marca.sql`, `src/components/mercadolivre/MLStoreSelector.tsx`, `src/integrations/supabase/types.ts` (grep, confirmed absent), `.planning/debug/resolved/sync-ml-billing-rate-limit.md` (full file), `.planning/ROADMAP.md` Phase 84 section, `docs/superpowers/specs/2026-07-03-dre-competencia-venda-design.md` (full file)
- `npx tsc --noEmit` run against the live repo — confirmed 0 errors despite `ml_billing_daily` being absent from `types.ts` (verifies the "silent gap" claim empirically, not just by inspection)

### Secondary (MEDIUM confidence)
- WebSearch: "Best Practices for Consuming Billing Reports APIs" (developers.mercadolibre.com.ar) — confirms `from_id`/`limit=1000`/`last_id` cursor pagination is ML's own documented recommendation (already implemented in the repo, cross-checked, matches code exactly)
- WebSearch: ML billing `/details` endpoint response shape — confirms `charge_info.{detail_id, creation_date_time, detail_sub_type, detail_amount, detail_type}` field names match the code exactly; did not independently re-confirm `sales_info[].sale_date_time` field name via the official doc page directly (WebFetch to the page was blocked, HTTP 403) — this specific field name's provenance rests on the in-repo working code (Primary tier) rather than a freshly-fetched doc excerpt

### Tertiary (LOW confidence)
- None used as load-bearing claims in this document.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new stack/libraries introduced; all patterns confirmed against existing, working, in-repo code
- Architecture: HIGH - both code paths (`ml_billing_monthly` vs `ml_billing_daily`) read in full, confirmed structurally disjoint by direct code inspection, not inference
- Pitfalls: HIGH for constraint-widening and coverage-guard pitfalls (both derived from direct line-by-line reading of the affected functions); MEDIUM for the `sales_info[0]` multi-entry pitfall (plausible risk, not empirically measured against live data this session)

**Research date:** 2026-07-03
**Valid until:** 2026-08-03 (30 days — stable internal codebase; the external dependency, ML's billing API shape, has been stable enough that the codebase already relies on `sales_info[].sale_date_time` in production)

## RESEARCH COMPLETE
