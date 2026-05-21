---
phase: 18-tiny-oauth
plan: "03"
subsystem: frontend/analytics
tags: [filter, analytics, period, MLSalesAnalytics]
dependency_graph:
  requires: []
  provides: [ANALYTICS-SYNC-01]
  affects: [src/components/mercadolivre/MLSalesAnalytics.tsx, src/pages/MercadoLivre.tsx]
tech_stack:
  added: []
  patterns: [props-drilling, useMemo-filter]
key_files:
  modified:
    - src/components/mercadolivre/MLSalesAnalytics.tsx
    - src/pages/MercadoLivre.tsx
decisions:
  - "Use currentFrom/currentTo from useMLFilters (already used by all other hooks) — no new filter derivation needed"
  - "MLSalesHourly has a date field, so hourly filtering by date range is safe"
  - "TabEstado: removed useMemo that derived rangeFrom/rangeTo from salesCache — replaced with direct from/to props"
metrics:
  duration: 8m
  completed: 2026-05-21
  tasks_completed: 2
  files_modified: 2
---

# Phase 18 Plan 03: MLSalesAnalytics Period Filter Summary

**One-liner:** Added `from`/`to` props to MLSalesAnalytics so all 4 sub-tabs filter salesCache data to the active period filter instead of showing the full cache.

## Tasks

### Task 1: Add from/to props to MLSalesAnalytics (DONE)
- Commit: `595b4e1d`
- Added `MLSalesAnalyticsProps { from: string; to: string }` interface
- All 4 internal tab functions now accept and use `{ from, to }` props:
  - **TabHorario**: filters `salesCache.hourly` by `h.date >= from && h.date <= to` (confirmed `MLSalesHourly` has `date` field in MLStoreContext.tsx)
  - **TabTicket**: filters `salesCache.daily` by date range
  - **TabEstado**: removed the `useMemo` that derived `rangeFrom`/`rangeTo` from salesCache; calls `useMLStateQuery(from, to)` directly
  - **TabFunil**: filters `salesCache.daily` by date range
- `MLSalesAnalytics` passes `from`/`to` down to all 4 tabs

### Task 2: Pass filterDates to MLSalesAnalytics in MercadoLivre.tsx (DONE)
- Commit: `38d7ecc3`
- `currentFrom`/`currentTo` are already computed by `useMLFilters()` and used by all hooks (`useMLOrders`, `useMLKPISummary`, `useMLCostWaterfall`, `useMLOrdersByBrand`)
- Changed `<MLSalesAnalytics />` to `<MLSalesAnalytics from={currentFrom} to={currentTo} />`

## TypeScript

```
npx tsc --noEmit --project tsconfig.app.json
# (no output = zero errors)
```

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/components/mercadolivre/MLSalesAnalytics.tsx` exists and has `MLSalesAnalyticsProps`
- `src/pages/MercadoLivre.tsx` passes `from={currentFrom} to={currentTo}`
- Commits `595b4e1d` and `38d7ecc3` present in git log
- TypeScript: zero errors
