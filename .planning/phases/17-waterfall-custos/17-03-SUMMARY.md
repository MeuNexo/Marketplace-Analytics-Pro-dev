---
phase: 17-waterfall-custos
plan: "03"
subsystem: mercadolivre-ui
tags: [consolidation, accordion, analytics, tab-cleanup]
dependency_graph:
  requires: [17-01]
  provides: [MLSalesAnalytics]
  affects: [src/pages/MercadoLivre.tsx]
tech_stack:
  added: []
  patterns: [shadcn-accordion, named-export-component]
key_files:
  created:
    - src/components/mercadolivre/MLSalesAnalytics.tsx
  modified:
    - src/pages/MercadoLivre.tsx
decisions:
  - "Copied 4 sub-components directly into MLSalesAnalytics.tsx (no re-export from MLRelatorios) to avoid circular dependency and keep the new component self-contained"
  - "Used Accordion type=multiple so user can expand multiple sections simultaneously"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-21"
  tasks: 2
  files: 2
---

# Phase 17 Plan 03: Consolidação da Aba Relatórios — Summary

**One-liner:** Removed "Relatórios" tab entirely; moved 4 analytic sections (Horário, Ticket, Estado, Funil) into Vendas tab as collapsible Accordion items via new `MLSalesAnalytics` component.

## What Was Done

### Removed
- **Import** `MLRelatorios` from `src/pages/MercadoLivre.tsx`
- **TabsTrigger** `value="relatorios"` — the tab button no longer exists
- **TabsContent** `value="relatorios"` — the tab panel with `<MLRelatorios />` inside

### Created
- **`src/components/mercadolivre/MLSalesAnalytics.tsx`** — new component containing:
  - All 4 internal sub-components copied directly: `TabHorario`, `TabTicket`, `TabEstado`, `TabFunil`
  - All helpers: `currencyFmt`, `pctFmt`, `tooltipStyle`, `BRAND_COLORS`, `UF_NAME_FALLBACK`, `EmptyState`
  - All required imports: recharts, shadcn/ui Card/Badge/Accordion, lucide icons, useMLStore, useMLStateQuery, KPICard, BrazilHeatMap
  - Exported named function `MLSalesAnalytics()` wrapping the 4 sections in `<Accordion type="multiple">`

### Updated
- **`src/pages/MercadoLivre.tsx`** — added `<MLSalesAnalytics />` at the end of `TabsContent value="vendas"`, after the Phase 16 brand charts block

## Final Page Structure (Vendas tab)

```
Tab: Vendas
  ├── KPI cards (MLKPIGrid)
  ├── Revenue chart + Goals card
  ├── Cost card + Top products
  ├── [Phase 16] Brand charts
  │   ├── BrandRevenueChart
  │   ├── BrandMarkupChart
  │   ├── CustoOperacionalChart
  │   └── BrandSharePieChart
  └── [Phase 17] MLSalesAnalytics (Accordion, type=multiple)
      ├── [+] Venda por Hora     → TabHorario (bar charts, top hours)
      ├── [+] Ticket Médio       → TabTicket (area chart, daily bar)
      ├── [+] Vendas por Estado  → TabEstado (heatmap + bar)
      └── [+] Funil de Conversão → TabFunil (funnel + area chart)
```

## TypeScript Status

Zero errors — `npx tsc --noEmit --project tsconfig.app.json` returns clean.

## Deviations from Plan

None - plan executed exactly as written.

## Commits

- `efde46e7` feat(17-03): create MLSalesAnalytics with 4 accordion sections
- `b8c4c9b0` feat(17-03): consolidate Relatorios tab into Vendas tab

## Self-Check: PASSED

- [x] `src/components/mercadolivre/MLSalesAnalytics.tsx` exists
- [x] `src/pages/MercadoLivre.tsx` no longer imports MLRelatorios
- [x] No `relatorios` string in MercadoLivre.tsx
- [x] Both commits exist in git log
- [x] TypeScript: 0 errors
