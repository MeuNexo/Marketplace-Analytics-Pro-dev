---
phase: 17-waterfall-custos
plan: "01"
subsystem: mercadolivre-financeiro
tags: [waterfall, custos, cmv, impostos, lucro-bruto]
dependency_graph:
  requires: [src/hooks/useMLOrders.ts, src/hooks/useMLTaxConfig.ts, src/contexts/MLStoreContext.tsx, src/contexts/OrganizationContext.tsx]
  provides: [useMLCostWaterfall, CostWaterfallData, MLCostCard waterfall redesign]
  affects: [src/pages/MercadoLivre.tsx]
tech_stack:
  added: []
  patterns: [TanStack React Query v5 useQuery, useMemo for derived state, Map<string, number> for revenue_per_store]
key_files:
  created:
    - src/hooks/useMLCostWaterfall.ts
  modified:
    - src/components/mercadolivre/MLCostCard.tsx
    - src/pages/MercadoLivre.tsx
decisions:
  - "CMV returns has_cmv=false when all custo_unit are null — caller passes null to card"
  - "impostosTotal computed in MercadoLivre.tsx (not hook) to co-locate with taxMap access"
  - "Removed unused costSummary useMemo — replaced entirely by costWaterfall props"
  - "Cancelamentos line is conditional — only rendered when cancelled_revenue > 0"
metrics:
  duration: ~15min
  completed: 2026-05-21
  tasks: 3
  files_created: 1
  files_modified: 2
---

# Phase 17 Plan 01: Waterfall de Custos Summary

Financial waterfall card implemented with real CMV from orders table and tax calculation from ml_tax_config.

## What Was Built

### Waterfall Formula

```
Receita Bruta            (from ml_daily_cache via effectiveMetrics.total_revenue)
(-) Cancelamentos        (orders.status IN ('cancelled','returned') — hidden if 0)
(-) Comissão ML          (SUM orders.comissao WHERE status paid/shipped/delivered)
(-) Frete                (SUM orders.frete WHERE status paid/shipped/delivered)
(-) Publicidade          (ml_ads_daily_cache via adsSummary.total_spend)
(-) CMV                  (SUM custo_unit * quantidade WHERE paid + custo_unit NOT NULL)
(-) Impostos             (SUM receita_por_loja × effective_rate/100 FROM ml_tax_config)
═══════════════════════════════════════════════════════════
= Lucro Bruto            (receita_bruta - all deductions)
```

### How CMV Handles Null

- `useMLCostWaterfall` iterates all paid orders; only accumulates `cmv` when `custo_unit != null`
- Sets `has_cmv = true` as soon as any paid order has a non-null `custo_unit`
- Caller: `cmv={costWaterfall?.has_cmv ? costWaterfall.cmv : null}`
- `MLCostCard` renders `"s/ custo"` (italic, muted) when `cmv === null`

### How Impostos Handles Null

- `impostosTotal` useMemo iterates `revenue_per_store` Map (from costWaterfall)
- For each `ml_user_id`, looks up `taxMap.get(mlUserId)?.effective_rate`
- Only counts stores with `effective_rate > 0` — sets `hasConfig = true`
- Returns `null` if no store has a tax config; caller passes `null` to `MLCostCard`
- `MLCostCard` renders `"s/ config"` (italic, muted) when `impostos === null`

### Fallbacks When costWaterfall Not Available

- `comissao`: `costWaterfall?.total_comissao ?? ordersSummary?.total_comissao ?? grossRevenue * 0.11`
- `frete`: `costWaterfall?.total_frete ?? ordersSummary?.total_frete ?? grossRevenue * 0.05`
- `cancelled_revenue`: `costWaterfall?.cancelled_revenue ?? 0`
- `cmv`: `null` when costWaterfall is null/loading
- `impostos`: `null` when taxMap not available

### Badge Removed

The "Em desenvolvimento" badge and dashed border styling were removed from `MLCostCard`. The component now has a clean Card appearance identical to other dashboard cards.

### Lucro Bruto Color

- `lucroPositivo = lucro >= 0`
- `text-emerald-500` when positive, `text-red-500` when negative
- TrendingUp icon (emerald) when positive, TrendingDown icon (red) when negative

## TypeScript Status

Zero errors: `npx tsc --noEmit --project tsconfig.app.json` returned no output.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | e5165319 | feat(17-01): add useMLCostWaterfall hook |
| 2 | 9524fe96 | feat(17-01): redesign MLCostCard with full financial waterfall |
| 3 | 0f226df3 | feat(17-01): wire useMLCostWaterfall + useMLTaxConfig into MercadoLivre.tsx |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused costSummary useMemo**
- **Found during:** Task 3
- **Issue:** After replacing `<MLCostCard costSummary={costSummary} />` with individual props, the `costSummary` useMemo had no callers — would generate lint warnings
- **Fix:** Removed the entire costSummary useMemo block (17 lines)
- **Files modified:** src/pages/MercadoLivre.tsx

## Known Stubs

None — all fields are either computed from real data or explicitly display "s/ custo" / "s/ config" when data is absent.

## Self-Check: PASSED

- src/hooks/useMLCostWaterfall.ts: FOUND
- src/components/mercadolivre/MLCostCard.tsx: FOUND (CostWaterfallCardProps interface present)
- src/pages/MercadoLivre.tsx: FOUND (useMLCostWaterfall imported and wired)
- Commits e5165319, 9524fe96, 0f226df3: FOUND
- TypeScript errors: 0
