---
phase: 101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis
plan: 02
subsystem: pricing-calculations
tags: [mco, waterfall, pricing, tdd, pure-functions]
status: complete
dependency-graph:
  requires:
    - src/lib/mco.ts (computeMco)
    - src/lib/precoMcoSeries.ts (computePrecoMcoSeries, PrecoSeriesRow, ComputePrecoMcoSeriesOpts)
    - src/lib/pricing/calculator.ts (reversePrice)
  provides:
    - src/lib/precoMcoSeries.ts (computeWaterfallCard, WaterfallCard)
    - src/lib/pricing/mcoRecommendation.ts (computeMcoRecommendation, McoRecommendation)
  affects:
    - Plan 03 (PrecoPraticadoReport.tsx card — pure presentation over these two utils)
tech-stack:
  added: []
  patterns:
    - "Single-sourced MCO formula: computeWaterfallCard reuses computeMco, never re-derives it"
    - "Single-sourced price algebra: computeMcoRecommendation reuses reversePrice (mode margin), never reimplements break-even"
    - "qtd>0 / precoUnit>0 guards on every division — no NaN/Infinity ever surfaced"
key-files:
  created:
    - src/lib/pricing/mcoRecommendation.ts
    - src/lib/pricing/mcoRecommendation.test.ts
  modified:
    - src/lib/precoMcoSeries.ts
    - src/lib/precoMcoSeries.test.ts
decisions:
  - "precoUnit<=0 in computeMcoRecommendation returns both levers null (short-circuit before calling reversePrice) instead of feeding zeroed cost/commission/tax into reversePrice, which would otherwise return a misleading R$0 minimum price"
  - "acosInatingivel = acosMeta <= 0 (not < 0) per plan spec — a target exactly equal to mcBeforeAdsPct leaves zero ACOS headroom, treated as unreachable"
metrics:
  duration: ~10min
  completed: 2026-07-19
---

# Phase 101 Plan 02: MCO Waterfall + Recommendation Levers Summary

Two pure, fully-tested calculation utilities added — `computeWaterfallCard()` (per-unit, period-average MCO waterfall) and `computeMcoRecommendation()` (minimum-price and target-ACOS levers) — both single-sourcing the existing `computeMco` formula and `reversePrice` algebra so Plan 03's component stays pure presentation.

## What Was Built

### Task 1 — `computeWaterfallCard()` in `src/lib/precoMcoSeries.ts`

- New `WaterfallCard` interface: 12 fields — `precoUnit`, `cmvUnit`, `comissaoUnit`, `freteUnit`, `adsUnit`, `impostoUnit`, `mcUnit` (margin before ads), `mcoUnit`, `mcoPct`, `mcBeforeAdsPct`, `custoAusente`, `impostoAusente`.
- `computeWaterfallCard(rows, opts)` sums `PrecoSeriesRow` totals (Σreceita, Σcmv, Σcomissao, Σfrete, Σimpostos) plus the ads-aware serie total (via `computePrecoMcoSeries`, respecting `incluirAds`), divides each by Σqtd, and calls `computeMco` once over the period totals for `mcoUnit`/`mcoPct` — the period MCO%, not an average of bucket percentages.
- `custoAusente`/`impostoAusente` derived from `qtd_sem_custo`/`qtd_sem_imposto` (confirmed exact field names by reading `PrecoSeriesRow`).
- Every division guarded by `qtd > 0` / `precoUnit > 0` — qtd=0 period returns all-zero fields and null percentages, never NaN/Infinity.

### Task 2 — `computeMcoRecommendation()` in `src/lib/pricing/mcoRecommendation.ts` (new file)

- New `McoRecommendation` interface: `precoMinimo: number | null`, `acosMeta: number | null`, `metaImpraticavel: boolean`, `acosInatingivel: boolean`.
- `computeMcoRecommendation(card, targetMcoPct)`:
  - Derives `commissionPct`/`taxPct` from the card's per-unit values as % of `precoUnit`.
  - Calls `reversePrice({ cost: cmvUnit, commissionPct, fixedFee: 0, shippingCost: freteUnit+adsUnit, taxPct, difalEnabled: false, ...NO_EXTRA }, targetMcoPct, "margin")` for the minimum-price lever — `reversePrice` itself already returns `null` when the target is unreachable (`denom <= 0`), which sets `metaImpraticavel = true`.
  - `acosMeta = mcBeforeAdsPct - targetMcoPct` (one-line algebra); `acosInatingivel = acosMeta <= 0`.
  - Guard: `card.precoUnit <= 0` short-circuits to both levers `null` before calling `reversePrice` (see Decisions).

## Deviations from Plan

None — plan executed exactly as written. Followed 101-PATTERNS.md's reference implementations for both functions (Pattern 2 for the waterfall, "Recommendation levers" block for the recommendation), with one addition beyond the literal snippet: the `precoUnit <= 0` early-return guard in `computeMcoRecommendation`, added because feeding a zeroed `cost`/`commissionPct`/`taxPct` into `reversePrice` would return `0` (a valid, non-null price) rather than `null` — silently presenting a misleading "R$0,00 preço mínimo" instead of the "no data" state the plan's behavior spec calls for ("precoUnit=0 → both levers null, no throw"). Classified as Rule 1 (bug fix, matching the plan's own explicit acceptance criterion) rather than a deviation from intent.

## Verification

```
npx vitest run src/lib/precoMcoSeries.test.ts src/lib/pricing/mcoRecommendation.test.ts
✓ src/lib/pricing/mcoRecommendation.test.ts (5 tests)
✓ src/lib/precoMcoSeries.test.ts (21 tests)
Test Files  2 passed (2)
Tests  26 passed (26)

npx tsc --noEmit
(no output — clean)
```

`grep computeMco` inside `computeWaterfallCard`'s body: 1 match (the single `computeMco` call — no re-derived formula).
`grep reversePrice` inside `mcoRecommendation.ts`: present, imported and called (no re-derived price algebra).

## TDD Gate Compliance

Both tasks followed RED → GREEN as separate commits:

| Task | RED (test) | GREEN (impl) |
|------|------------|---------------|
| 1 — computeWaterfallCard | `057c648f` test(101-02): add failing test for computeWaterfallCard | `0f14d827` feat(101-02): implement computeWaterfallCard per-unit MCO waterfall |
| 2 — computeMcoRecommendation | `e2d96fcb` test(101-02): add failing test for computeMcoRecommendation | `11958ea6` feat(101-02): implement computeMcoRecommendation pricing levers |

RED confirmed for both (ran `npx vitest run` before implementing — 5 failures for Task 1's new `computeWaterfallCard` tests, module-resolution failure for Task 2's `./mcoRecommendation` import). No REFACTOR commits needed (implementations matched the RESEARCH/PATTERNS reference closely; no cleanup pass required).

## Known Stubs

None. Both functions are complete, pure, fully wired to their single-sourced dependencies (`computeMco`, `reversePrice`) — no placeholder values, no TODO/FIXME, no empty-data defaults that would flow to UI rendering (Plan 03 has not yet been executed, so no component currently calls these utils).

## Threat Flags

None. Both files are pure client-side calculation functions with zero I/O, matching the plan's threat model (`T-101-04` mitigation — `custoAusente`/`impostoAusente` flags and `null` returns instead of invented numbers — implemented as specified; `T-101-SC` — zero new dependencies, confirmed).

## Self-Check: PASSED

- FOUND: src/lib/precoMcoSeries.ts (computeWaterfallCard exported)
- FOUND: src/lib/precoMcoSeries.test.ts (computeWaterfallCard test suite)
- FOUND: src/lib/pricing/mcoRecommendation.ts (computeMcoRecommendation exported)
- FOUND: src/lib/pricing/mcoRecommendation.test.ts (computeMcoRecommendation test suite)
- FOUND commit 057c648f
- FOUND commit 0f14d827
- FOUND commit e2d96fcb
- FOUND commit 11958ea6
