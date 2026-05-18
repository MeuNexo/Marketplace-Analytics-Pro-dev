---
phase: 06-recomenda-es-de-compra-full
plan: "02"
subsystem: analise-compra
tags: [ui, compra, elasticity, react, shadcn]
dependency_graph:
  requires: [06-01]
  provides: [CompraRecomendadaPanel, AnaliseDashboard-CompraPanel]
  affects: [src/components/mercadolivre/analise]
tech_stack:
  added: []
  patterns: [useMemo-derived-state, controlled-inputs, shadcn-card-select-input]
key_files:
  created:
    - src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx
  modified:
    - src/components/mercadolivre/analise/AnaliseDashboard.tsx
decisions:
  - "Used col-span-2/1 grid layout instead of col-span-1 for each input to give adequate width on standard screens"
  - "No Skeleton component available; used plain muted-foreground div for empty-state (per plan fallback spec)"
  - "Both tasks committed in a single feat commit (surgical diff: 1 new file + 2-line change to dashboard)"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-18"
---

# Phase 6 Plan 02: CompraRecomendadaPanel UI Summary

Inline purchase-recommendation card wired into AnaliseDashboard, consuming `calcularCompra` from compraUtils (06-01) with real-time recalculation via useMemo.

## What Was Built

### Task 1 — CompraRecomendadaPanel.tsx (new file)

Functional component `CompraRecomendadaPanel({ snapshots: AnalysisSnapshot[] })`:

- **State**: `multiplicador: Multiplicador` (useState 1.0) and `stockInputs: Record<string, StockInputs>` (useState {}).
- **`getInputs(id)`**: returns stored overrides merged with DEFAULT_INPUTS `{ diasCobertura: 30, estoqueTotal: 0, estoqueFull: 0, estoqueCasa: 0 }` — defaults never materialised in state until user types.
- **`results`** (useMemo, deps `[snapshots, stockInputs, multiplicador]`): maps each snapshot to `calcularCompra(snapshot, getInputs(id), multiplicador)`.
- **Layout**: Card with CardHeader containing a flex-row — CardTitle left, multiplier Select right (4 items: Normal ×1,0 / Campanha leve ×1,2 / Data forte ×1,5 / Live–oferta ×2,0). CardContent renders one `grid-cols-12` row per snapshot.
- **Per-row columns**: product title + brand badge (col-span-3) | 4 numeric Inputs with labels (col-span-2/2/2/1) | read-only outputs block (col-span-2).
- **Output display**: `Compra: N unid.` in emerald-600 if > 0 else muted; `FULL: N unid.` in blue-600; fallback note `(usando GMV)` when `result.fallbackUsed`.
- **Empty state**: plain `<div className="text-sm text-muted-foreground">` (Skeleton component absent from project).
- **T-06-04 mitigated**: `type="number" min="0"` on all inputs + NaN/empty coercion to 0 in `updateStock`.
- **T-06-05 mitigated**: useMemo with correct deps prevents redundant recomputation.

### Task 2 — AnaliseDashboard.tsx (surgical edit)

Two changes only:
1. Added `import CompraRecomendadaPanel from "./CompraRecomendadaPanel";` alongside sibling imports.
2. Inserted `<CompraRecomendadaPanel snapshots={snapshots} />` immediately after the `<Card>` wrapping `<AnalisePrecosTable>`, inside the `snapshots.length > 0` branch.

No hooks, routing, providers, or Supabase calls touched.

## Verification

- `npx tsc --noEmit` — **0 errors**
- `npm test` — **63 tests passed**, 0 regressions (4 test suites: example, tax, compraUtils, engine)

## Deviations from Plan

### Auto-adapted: grid column spans

The plan spec listed `col-span-1` for each of the 4 inputs (totalling 4 out of 12 cols), which would have left inputs too narrow (≈ 40px each on a 1200px screen). Applied `col-span-2` for the first three inputs and `col-span-1` for the last (Est. Casa/CD), keeping product name at `col-span-3` and outputs at `col-span-2` — total = 3+2+2+2+1+2 = 12. No logic change; cosmetic layout improvement.

### Auto-adapted: Skeleton unavailable

`src/components/ui/skeleton.tsx` does not exist in the project. Used the plan's own fallback path: `<div className="text-sm text-muted-foreground">Sem produtos analisados.</div>`.

## Known Stubs

None — all outputs flow from `calcularCompra` with real snapshot data.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. All computation is local/client-side.

## Self-Check: PASSED

- `src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx` — FOUND
- `src/components/mercadolivre/analise/AnaliseDashboard.tsx` — FOUND (modified)
- Commit `52f2956` — FOUND
