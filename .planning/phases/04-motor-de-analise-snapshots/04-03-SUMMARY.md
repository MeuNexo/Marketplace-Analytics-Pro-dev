---
phase: 04-motor-de-analise-snapshots
plan: "03"
subsystem: hooks
tags: [react-hook, supabase, analysis, snapshots]
dependency_graph:
  requires: [04-01, 04-02]
  provides: [useAnalysisSnapshots]
  affects: [phase-05-dashboard, phase-07-historico-comparativo]
tech_stack:
  added: []
  patterns: [useState, useCallback, supabase-direct-client]
key_files:
  created:
    - src/hooks/useAnalysisSnapshots.ts
  modified: []
decisions:
  - "price_curve stored as JSONB array — passed directly to Supabase (no JSON.stringify needed; client handles serialization)"
  - "strategy defaults to null on insert; consumers call updateStrategy to set it after review"
  - "No TanStack Query — imperative pattern matches useMLPrecosCustos for consistency"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-15"
  tasks_completed: 1
  tasks_total: 1
---

# Phase 4 Plan 03: useAnalysisSnapshots Hook Summary

React hook orchestrating analysis engine invocation and Supabase snapshot persistence with saveSnapshot, fetchSnapshots and updateStrategy.

## What Was Built

`src/hooks/useAnalysisSnapshots.ts` — a React hook that:

1. Calls `computeAnalysis(orders, periodDays)` from the pure analysis engine
2. Inserts the full AnalysisResult into `commercial_analysis_snapshots` (Supabase)
3. Fetches snapshots by item + organization, ordered by recency
4. Allows updating the `strategy` column independently after user review

Follows the exact pattern of `useMLPrecosCustos`: `useState` + `useCallback`, direct Supabase client, no TanStack Query, no auto-fetch `useEffect`.

## Exports

| Export | Kind | Description |
|--------|------|-------------|
| `SnapshotInput` | interface | Input to saveSnapshot (orders, period, identifiers) |
| `AnalysisSnapshot` | interface | camelCase mapping of DB row |
| `UseAnalysisSnapshotsResult` | type | Return type of the hook |
| `useAnalysisSnapshots` | function | The hook itself |

## Verification Results

- `npx tsc --noEmit` — 0 lines output (no errors in useAnalysisSnapshots.ts)
- `npm test` — 46/46 tests pass, 0 regressions

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/hooks/useAnalysisSnapshots.ts` exists: FOUND
- Commit `0938596` exists: FOUND
- All 46 engine + tax tests pass: CONFIRMED
