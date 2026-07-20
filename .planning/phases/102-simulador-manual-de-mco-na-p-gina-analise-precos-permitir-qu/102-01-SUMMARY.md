---
phase: 102-simulador-manual-de-mco-na-p-gina-analise-precos-permitir-qu
plan: 01
subsystem: pricing
tags: [typescript, vitest, pure-function, mco, waterfall]

# Dependency graph
requires:
  - phase: 101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis
    provides: "WaterfallCard shape (mcUnit/mcoUnit/mcoPct) that computeSimulatedWaterfall mirrors for UI reuse"
provides:
  - "computeSimulatedWaterfall pure function — recomputes MC/MCO waterfall from per-unit simulated inputs"
  - "SimulatedInputs/SimulatedWaterfall interfaces mirroring WaterfallCard's derived fields"
  - "vitest suite covering normal case, precoUnit=0 guard, %-boundaries, negative passthrough"
affects: [102-02, 102-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New pure calc sibling in src/lib/pricing/ (mirrors mcoRecommendation.ts) — zero I/O, reuses computeMco as single formula source"
    - "Percent-of-price derivation with zero-price guard: precoUnit > 0 ? (precoUnit * pct) / 100 : 0"

key-files:
  created:
    - src/lib/pricing/mcoSimulation.ts
    - src/lib/pricing/mcoSimulation.test.ts
  modified: []

key-decisions:
  - "computeSimulatedWaterfall calls computeMco directly (never reimplements the mco = revenue - cmv - platformCost - ads - tax formula) — verified by grep in acceptance criteria"
  - "comissaoPct/impostoPct accepted as %, converted to R$ internally with a precoUnit > 0 guard, matching the existing derivation pattern in mcoRecommendation.ts lines 43-44"

patterns-established:
  - "Simulation-lever pure functions live in src/lib/pricing/ alongside mcoRecommendation.ts and calculator.ts"

requirements-completed: [D-04]

# Metrics
duration: 5min
completed: 2026-07-20
status: complete
---

# Phase 102 Plan 01: Simulador Manual de MCO — Motor de Cálculo Summary

**Pure function `computeSimulatedWaterfall` that recomputes the MC/MCO waterfall from user-edited per-unit values (R$ price/cost/freight/ads, % commission/tax), reusing `computeMco` as the single formula source.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-20T00:20:00Z
- **Completed:** 2026-07-20T00:21:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- New pure, zero-I/O function `computeSimulatedWaterfall` in `src/lib/pricing/mcoSimulation.ts`, sibling to `mcoRecommendation.ts`
- `SimulatedInputs`/`SimulatedWaterfall` interfaces mirror `WaterfallCard`'s derived field names, so the Wave 2 UI can reuse the same Row-rendering code for real vs. simulated cards
- Guard against division by zero: `comissaoUnit`/`impostoUnit` degrade to 0 when `precoUnit <= 0`, and `mcoPct` degrades to `null` (never `NaN`) via `computeMco`'s existing `grossRevenue > 0` guard
- Full RED→GREEN TDD cycle in two atomic commits

## Task Commits

Each task was committed atomically:

1. **Task 1: Escrever a suíte RED de mcoSimulation.test.ts** - `b4c7b1c8` (test)
2. **Task 2: Implementar computeSimulatedWaterfall (GREEN)** - `7751e127` (feat)

_TDD plan: RED commit (failing import) → GREEN commit (implementation, all 6 tests passing)._

## Files Created/Modified
- `src/lib/pricing/mcoSimulation.ts` - `computeSimulatedWaterfall` pure function + `SimulatedInputs`/`SimulatedWaterfall` interfaces; imports and calls `computeMco` from `@/lib/mco`
- `src/lib/pricing/mcoSimulation.test.ts` - vitest suite: normal case (toBeCloseTo), precoUnit=0 → mcoPct null + comissaoUnit/impostoUnit=0, %-boundaries (0 and 100), negative cmvUnit passthrough (no throw), mcUnit−adsUnit===mcoUnit relation

## Decisions Made
- Followed the plan's referenced implementation body verbatim (102-RESEARCH.md Pattern 1) — no deviation from the documented per-unit derivation approach.
- Docblock comment initially quoted the literal formula string `grossRevenue - cmv - platformCost - ads - tax`, which collided with the plan's own anti-reimplementation grep check (`acceptance_criteria` for Task 2 requires that exact string to be absent from the file, since only `computeMco` should contain it). Reworded the comment to describe the same guarantee without duplicating the literal formula text, so the grep check passes cleanly while the docblock still explains why no local reimplementation exists.

## Deviations from Plan

None — plan executed exactly as written (task order, file paths, function/interface shapes, and derivation logic all match the plan's `<action>` blocks and the RESEARCH.md Pattern 1 reference body). The docblock wording adjustment above is not a functional deviation — it was made to keep the file compliant with the plan's own verification grep, not a change in behavior.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `computeSimulatedWaterfall` is ready for Wave 2 (102-02/102-03) to wire into `PrecoPraticadoReport.tsx` as local `useState` + `useMemo`-derived simulated card.
- No blockers. Function is pure, fully tested (6/6 green), `tsc --noEmit` clean, and verified to import (never reimplement) `computeMco`.

---
*Phase: 102-simulador-manual-de-mco-na-p-gina-analise-precos-permitir-qu*
*Completed: 2026-07-20*

## Self-Check: PASSED

- FOUND: src/lib/pricing/mcoSimulation.ts
- FOUND: src/lib/pricing/mcoSimulation.test.ts
- FOUND commit: b4c7b1c8 (test)
- FOUND commit: 7751e127 (feat)
