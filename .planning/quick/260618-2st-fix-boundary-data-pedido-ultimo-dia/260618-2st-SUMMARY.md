---
quick_id: 260618-2st
slug: fix-boundary-data-pedido-ultimo-dia
status: complete
completed_at: "2026-06-18"
duration_minutes: 5
tasks_completed: 2
tasks_total: 2
files_created:
  - src/lib/dateRange.ts
  - src/lib/dateRange.test.ts
files_modified:
  - src/hooks/useMLOrdersByBrand.ts
  - src/hooks/useMLOrders.ts
  - src/hooks/useMLOrdersByItem.ts
commits:
  - hash: 8c750807
    message: "feat(260618-2st): add nextDayUTC helper for timestamptz upper-bound fix"
  - hash: 8029a4ef
    message: "fix(260618-2st): fix timestamptz upper-bound in 3 order hooks (last day missing)"
---

# Quick 260618-2st: Fix boundary de data_pedido (timestamptz) que derruba o último dia do range

## One-liner

Pure `nextDayUTC` UTC helper + `.lt(nextDayUTC(to))` replacing `.lte(to)` in 3 hooks so `data_pedido::date <= to` semantics are correctly implemented for timestamptz.

## What was done

### Task 1 — Helper nextDayUTC + vitest (commit 8c750807)

Created `src/lib/dateRange.ts` with a pure named export `nextDayUTC(dateStr: string): string` that advances a `yyyy-MM-dd` date by one day in UTC — mirroring the identical pattern already used in `MLPedidos.tsx` lines 716-720.

Created `src/lib/dateRange.test.ts` (vitest) with 5 tests:
- Normal day: `2026-06-17` → `2026-06-18`
- Month rollover: `2026-06-30` → `2026-07-01`
- Year rollover: `2026-12-31` → `2027-01-01`
- Leap-year day: `2024-02-28` → `2024-02-29`
- Leap-year end: `2024-02-29` → `2024-03-01`

All 5 tests pass.

### Task 2 — Apply nextDayUTC to 3 hooks (commit 8029a4ef)

In each of the 3 hooks:
- Added `import { nextDayUTC } from "@/lib/dateRange"`.
- Changed `.lte("data_pedido", to/dateTo)` to `.lt("data_pedido", nextDayUTC(to/dateTo))`.
- Added 1-line comment explaining the timestamptz upper-bound rationale.
- Lower bound `.gte(...)` left unchanged (already correct).
- `MLPedidos.tsx` and `ml_product_daily_cache` fallback untouched.

`npx tsc --noEmit` and `npm run build` clean.

## Root cause (confirmed in production)

`public.orders.data_pedido` is `timestamptz`, stored at the actual transaction time (e.g. `2026-06-17T14:32:10Z`). PostgREST interprets `.lte("data_pedido", "2026-06-17")` as `data_pedido <= '2026-06-17 00:00:00+00'` — so any order placed after midnight is excluded. For a 1-day range (e.g. "today"), this returns 0 rows. Production test: `.lte('2026-06-17')` → 0 pedidos; `< '2026-06-18'` → 870 pedidos.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

- src/lib/dateRange.ts: FOUND
- src/lib/dateRange.test.ts: FOUND
- commit 8c750807: FOUND
- commit 8029a4ef: FOUND
