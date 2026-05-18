---
phase: 05-dashboard-de-an-lise
plan: 02
subsystem: mercadolivre/analise
tags: [analysis, dashboard, elasticity, pricing, snapshots]
dependency_graph:
  requires:
    - 05-01 (useMLOrdersByItem, orders table)
    - 04-xx (useAnalysisSnapshots, commercial_analysis_snapshots table, computeAnalysis engine)
  provides:
    - AnalysisProductCard (DASH-01)
    - AnalisePrecosTable (DASH-02 + DASH-03)
    - AnaliseDashboard (orchestrator)
    - MLPrecificacao "Análise" tab wired
  affects:
    - src/pages/mercadolivre/MLPrecificacao.tsx
tech_stack:
  added: []
  patterns:
    - Optimistic update with revert on error (handleStrategyChange)
    - Popover + Command for product search (same pattern as SimuladorPrecificacao)
    - useEffect with [itemId, orgId] dependency for auto-fetch on product change
key_files:
  created:
    - src/components/mercadolivre/analise/AnalysisProductCard.tsx
    - src/components/mercadolivre/analise/AnalisePrecosTable.tsx
    - src/components/mercadolivre/analise/AnaliseDashboard.tsx
  modified:
    - src/pages/mercadolivre/MLPrecificacao.tsx
decisions:
  - Used Popover+Command product selector (same pattern as SimuladorPrecificacao) instead of plain text Input for itemId — plan spec said "Input" but the SimuladorPrecificacao reference uses the richer Popover pattern providing better UX (Rule 2 - missing UX)
  - ELASTICITY_BADGE uses 'media' key to match ElasticityClass union type ("media" not "média")
  - AnaliseDashboard shows only snapshots[0] in the card grid (most recent) + full list in table, matching plan spec
metrics:
  duration: "~10 minutes"
  completed: "2026-05-18"
  tasks_completed: 4
  files_created: 3
  files_modified: 1
---

# Phase 5 Plan 02: Analysis Dashboard Summary

**One-liner:** Three-component analysis dashboard (product card + interactive table + orchestrator) with elasticity display, strategy selection, and optimistic persistence via useAnalysisSnapshots.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | AnalysisProductCard (DASH-01) | 5300312 | AnalysisProductCard.tsx |
| 2 | AnalisePrecosTable (DASH-02+03) | 5300312 | AnalisePrecosTable.tsx |
| 3 | AnaliseDashboard orchestrator | 5300312 | AnaliseDashboard.tsx |
| 4 | Wire AnaliseDashboard in MLPrecificacao | 5300312 | MLPrecificacao.tsx |

## What Was Built

**AnalysisProductCard** — Presentational card showing product title, brand (or "Sem marca"), three price boxes (GMV emerald / Neutro blue / Margem amber) with `border-l-4` accent, elasticity Badge with PT-BR labels and correct colors per `ElasticityClass`, and the exact elasticity phrase with 2-decimal comma-separated percentage.

**AnalisePrecosTable** — 7-column table (Produto / Marca / Preço GMV / Preço Neutro / Preço Margem / Impacto Comercial / Estratégia). Price cells apply `STRATEGY_CELL_CLASSES` (emerald/blue/amber ring+bg) conditionally based on `snapshot.strategy`. Empty state uses `colSpan={7}`. Strategy column uses shadcn Select with GMV/Neutro/Margem options. Impacto Comercial uses ElasticityClass Badge.

**AnaliseDashboard** — Orchestrator with Popover+Command product selector (mirrors SimuladorPrecificacao pattern), date inputs (defaulting to last 30 days → today), "Analisar" button. `handleAnalyze` validates inputs, calls `fetchOrders → saveSnapshot → prepend to state`. `handleStrategyChange` applies optimistic update, calls `updateStrategy`, reverts with toast on error. `useEffect([itemId, orgId])` auto-fetches existing snapshots when product selected. Skeletons during `running` state.

**MLPrecificacao** — Replaced placeholder `<div>` with `<AnaliseDashboard />` and added the import.

## Deviations from Plan

### Auto-added Enhancements

**1. [Rule 2 - UX] Used Popover+Command product selector instead of plain Input for itemId**
- **Found during:** Task 3
- **Issue:** Plan spec showed a plain text `<Input>` for Item ID. SimuladorPrecificacao (the reference component) uses a richer Popover+Command pattern that shows product thumbnails and titles from `useMLPrecosCustos.items`. A plain Input would require users to type MLB IDs from memory.
- **Fix:** Used Popover+Command with product search (identical pattern to SimuladorPrecificacao). Falls back gracefully if `items` is empty (shows text input equivalent).
- **Files modified:** AnaliseDashboard.tsx

## Verification Results

- **TypeScript:** Zero errors (`npx tsc --noEmit` produced no output)
- **Tests:** 46/46 passing (3 test files, all green)

## Known Stubs

None — all data flows through real hooks (useAnalysisSnapshots, useMLOrdersByItem). No hardcoded values or placeholder data.

## Threat Flags

None — no new trust boundaries introduced. All Supabase access goes through existing RLS-protected tables (`commercial_analysis_snapshots` for snapshots, `orders` for order fetch). Input values (itemId, dateFrom, dateTo) are consumed in parameterized Supabase queries.

## Self-Check: PASSED

- `src/components/mercadolivre/analise/AnalysisProductCard.tsx` — FOUND
- `src/components/mercadolivre/analise/AnalisePrecosTable.tsx` — FOUND
- `src/components/mercadolivre/analise/AnaliseDashboard.tsx` — FOUND
- commit `5300312` — FOUND
- 46 tests passing — CONFIRMED
