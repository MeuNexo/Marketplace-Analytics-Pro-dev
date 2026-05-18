---
phase: 07-hist-rico-comparativo
plan: 01
subsystem: analysis-ui
tags: [refactor, elasticity, config, deduplication]
dependency_graph:
  requires: []
  provides: [elasticityConfig]
  affects:
    - src/components/mercadolivre/analise/AnalisePrecosTable.tsx
    - src/components/mercadolivre/analise/AnalysisProductCard.tsx
tech_stack:
  added: []
  patterns: [shared-config-module]
key_files:
  created:
    - src/lib/analysis/elasticityConfig.ts
  modified:
    - src/components/mercadolivre/analise/AnalisePrecosTable.tsx
    - src/components/mercadolivre/analise/AnalysisProductCard.tsx
decisions:
  - Removed unused `import type { ElasticityClass }` from both components after extracting the constant (no remaining local usage)
metrics:
  duration: "~5 minutes"
  completed: "2026-05-18"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 7 Plan 01: Extract ELASTICITY_BADGE to elasticityConfig.ts Summary

Extracted the duplicated `ELASTICITY_BADGE` constant from two analysis components into a single shared module `src/lib/analysis/elasticityConfig.ts`, eliminating duplication and preparing a reusable config for Plan 07-02's `HistoricoSnapshotTable` consumer.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create elasticityConfig.ts module | ed43e86 | src/lib/analysis/elasticityConfig.ts |
| 2 | Migrate AnalisePrecosTable and AnalysisProductCard | ed43e86 | AnalisePrecosTable.tsx, AnalysisProductCard.tsx |

## ELASTICITY_BADGE Values Extracted

The exact constant values found in both source files and preserved in `elasticityConfig.ts`:

```typescript
export const ELASTICITY_BADGE: Record<ElasticityClass, { label: string; className: string }> = {
  baixa:   { label: "Baixa",   className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  media:   { label: "Média",   className: "bg-blue-500/15    text-blue-700    border-blue-500/30"    },
  alta:    { label: "Alta",    className: "bg-amber-500/15   text-amber-700   border-amber-500/30"   },
  extrema: { label: "Extrema", className: "bg-red-500/15     text-red-700     border-red-500/30"     },
};
```

Values were identical in both `AnalisePrecosTable.tsx` (lines 32-37) and `AnalysisProductCard.tsx` (lines 10-15) before the refactor.

## Verification Results

- `npx tsc --noEmit`: **0 errors**
- `npm test`: **63/63 tests pass** (4 test files: example, tax, engine, compraUtils)
- `grep -rn "const ELASTICITY_BADGE" src/`: defined only in `src/lib/analysis/elasticityConfig.ts`
- Both components import via `from "@/lib/analysis/elasticityConfig"`

## Deviations from Plan

**1. [Rule 2 - Missing cleanup] Removed unused ElasticityClass imports**
- **Found during:** Task 2
- **Issue:** After removing the local `ELASTICITY_BADGE` constant (which was typed as `Record<ElasticityClass, ...>`), the `import type { ElasticityClass } from "@/lib/analysis/types"` became unused in both components.
- **Fix:** Removed the unused `ElasticityClass` import from both `AnalisePrecosTable.tsx` and `AnalysisProductCard.tsx`. The plan noted this was expected ("remover se ficar não-usado para evitar warning de lint").
- **Files modified:** AnalisePrecosTable.tsx, AnalysisProductCard.tsx
- **Commit:** ed43e86

## Downstream Consumers

Plan 07-02 (`HistoricoSnapshotTable`) can immediately import from `@/lib/analysis/elasticityConfig` without any additional work:

```typescript
import { ELASTICITY_BADGE } from "@/lib/analysis/elasticityConfig";
```

## Self-Check: PASSED

- `src/lib/analysis/elasticityConfig.ts`: FOUND
- `AnalisePrecosTable.tsx` no longer defines local `ELASTICITY_BADGE`: CONFIRMED
- `AnalysisProductCard.tsx` no longer defines local `ELASTICITY_BADGE`: CONFIRMED
- Commit `ed43e86`: FOUND
- 63 tests passing: CONFIRMED
- 0 TypeScript errors: CONFIRMED
