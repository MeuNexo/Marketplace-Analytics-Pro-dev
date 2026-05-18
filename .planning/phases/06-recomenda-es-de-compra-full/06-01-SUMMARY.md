---
phase: 06-recomenda-es-de-compra-full
plan: 01
subsystem: analysis
tags: [typescript, vitest, pure-functions, tdd, compra, full, estoque]

# Dependency graph
requires:
  - phase: 04-motor-de-analise-snapshots
    provides: AnalysisSnapshot, PriceBucket types from useAnalysisSnapshots and types.ts
  - phase: 05-dashboard-de-analise
    provides: Dashboard stub and Análise tab
provides:
  - Pure calcularCompra function implementing COMP-03 and COMP-04 formulas
  - getVendaDiaria with integer-cent float-safe price lookup
  - getPctFull returning strategy-based FULL percentage
  - 17 unit tests covering all business rules and edge cases
affects:
  - 06-02 (UI layer will consume calcularCompra directly)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Integer-cent price comparison (Math.round(price * 100)) for float equality safety
    - Math.max(0, ...) guard for non-negative purchase quantities
    - Math.min(..., estoqueTotal) cap for FULL suggestion

key-files:
  created:
    - src/lib/analysis/compraUtils.ts
    - src/lib/analysis/compraUtils.test.ts
  modified: []

key-decisions:
  - "Integer-cent comparison for PriceBucket lookup — avoids IEEE 754 float equality pitfall with .99 prices"
  - "Fallback to dailyAvg=0 when no bucket matched — safe default prevents NaN propagation in calcularCompra"
  - "Math.ceil applied only at final steps (compraRecomendada, sugestaoFull) — coberturaAlvo stays as float"

patterns-established:
  - "Integer-cent price comparison: Math.round(a * 100) === Math.round(b * 100) for all price equality checks"
  - "T-06-01 defensiveness: Math.max(0, ...) and Math.min(..., cap) in all purchase quantity outputs"

requirements-completed: [COMP-01, COMP-02, COMP-03, COMP-04]

# Metrics
duration: 8min
completed: 2026-05-18
---

# Phase 6 Plan 01: compraUtils Pure Calculation Module Summary

**Pure TypeScript `compraUtils.ts` with `calcularCompra` (COMP-03) and `sugestaoFull` (COMP-04) formulas, integer-cent float-safe price lookup, and 17 unit tests — all 63 project tests GREEN**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-18T13:55:00Z
- **Completed:** 2026-05-18T14:03:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Implemented `getVendaDiaria` resolving strategy price (gmv/neutral/margin/null) to bucket dailyAvg with integer-cent equality
- Implemented `getPctFull` mapping strategy to FULL percentage targets (0.80 / 0.60 / 0.50)
- Implemented `calcularCompra` combining all formulas with T-06-01 defensive clamping
- 17 new tests covering COMP-03/04 normal cases, clamp, all strategy percentages, cap at estoqueTotal, null fallback, and float equality edge case
- Zero TypeScript errors for compraUtils files

## Task Commits

1. **Task 1: Implement compraUtils.ts with getVendaDiaria, getPctFull and calcularCompra** - `36e3cd9` (feat)

**Plan metadata:** *(to be added in final commit)*

## Files Created/Modified
- `src/lib/analysis/compraUtils.ts` — Pure calculation module: StockInputs, Multiplicador, CompraResult types + getVendaDiaria, getPctFull, calcularCompra functions
- `src/lib/analysis/compraUtils.test.ts` — 17 tests covering all COMP-03, COMP-04, fallback, float equality cases

## Decisions Made
- Integer-cent comparison (`Math.round(price * 100)`) chosen for price lookup to avoid IEEE 754 pitfalls with `.99` prices — documented in plan RESEARCH.md
- `dailyAvg: 0` as defensive fallback when no bucket matches — ensures calcularCompra never emits NaN
- `Math.ceil` applied only at the final compraRecomendada and sugestaoFull steps, not to intermediate coberturaAlvo

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `calcularCompra` is ready for direct consumption by Phase 06-02 (UI layer)
- All exported types (StockInputs, Multiplicador, CompraResult) are stable contracts for the form UI
- No blockers

---
*Phase: 06-recomenda-es-de-compra-full*
*Completed: 2026-05-18*
