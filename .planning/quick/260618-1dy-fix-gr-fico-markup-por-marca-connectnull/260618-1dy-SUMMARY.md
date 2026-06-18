---
quick_id: 260618-1dy
phase: quick
plan: 260618-1dy
subsystem: frontend/charts
tags: [recharts, brandmarkup, connectnulls, dot, viz-fix]
dependency_graph:
  requires: []
  provides: [brand-markup-chart-continuous-lines]
  affects: [src/components/mercadolivre/BrandMarkupChart.tsx]
tech_stack:
  added: []
  patterns: [recharts Line connectNulls, recharts Line dot props]
key_files:
  modified:
    - src/components/mercadolivre/BrandMarkupChart.tsx
decisions:
  - "dot={{ r: 2 }} chosen (plan default): small enough not to clutter dense series, large enough to mark isolated data points"
metrics:
  duration: "<2 min"
  completed: 2026-06-18
---

# Quick 260618-1dy: Fix gráfico "Markup por Marca" (connectNulls + dot)

## One-liner

Fixed BrandMarkupChart so sparse brand lines render continuously with r=2 visible dots instead of broken disconnected segments.

## What Was Done

Applied two prop changes to the `<Line>` elements inside the `topBrands.map` in `BrandMarkupChart.tsx`:

| Prop | Before | After |
|------|--------|-------|
| `connectNulls` | `{false}` | `{true}` |
| `dot` | `{false}` | `{{ r: 2 }}` |

`connectNulls={true}` makes each brand's line continuous, bridging over days with no sale/cost data (null values). `dot={{ r: 2 }}` marks each day with a real data point as a small visible circle, which also ensures that brands with only 1 or 2 data points in the period appear as visible dots rather than disappearing entirely.

No changes were made to `useMLOrdersByBrand.ts`, the markup calculation, outlier clipping (>10x), colors, tooltip, axes, or empty-state handling.

## Verification

- `npx tsc --noEmit` — no errors
- `npm run build` — built in 18.73s, chunk size warnings are pre-existing and unrelated

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| c206f236 | fix(260618-1dy): connectNulls+dot visible in BrandMarkupChart |

## Self-Check: PASSED

- [x] `src/components/mercadolivre/BrandMarkupChart.tsx` modified
- [x] Commit c206f236 exists
- [x] `npx tsc --noEmit` clean
- [x] `npm run build` successful
- [x] `useMLOrdersByBrand.ts` untouched
