---
phase: 46
plan: "03"
subsystem: frontend-ux
tags: [responsive, mobile, kpi-tooltips, empty-state, design-tokens, anuncios, pedidos, financeiro]
dependency_graph:
  requires: [46-01, 46-02]
  provides: [responsive-tables-mobile, kpi-glossary-wired, empty-state-migrated, semantic-color-tokens]
  affects: [MLAnuncios, MLPedidos, MLFinanceiro]
tech_stack:
  added: []
  patterns: [useIsMobile-ternary, tip()-helper, KPI_GLOSSARY, EmptyState-reusable, kpi-positive/negative-tokens]
key_files:
  created: []
  modified:
    - src/pages/mercadolivre/MLPedidos.tsx
    - src/pages/mercadolivre/MLFinanceiro.tsx
    - src/pages/mercadolivre/MLAnuncios.tsx
decisions:
  - "Sub-tables (SubTabTopProdutos, SubTabUF, por-marca, por-SKU) kept as overflow-x-auto — secondary/report views with low mobile usage frequency; main tables prioritized for responsive upgrade"
  - "Recharts SVG fill= and stroke= hex values left untouched per D-08 rule — SVG attributes are not Tailwind class tokens"
  - "STATUS_CONFIG.cancelled color text-red-600 preserved — category/status color, not a semantic financial signal"
  - "Custom string tooltips used for KPICards where no matching GlossaryKey exists (Total de Anúncios, Mais Anúncios, Curva A/B/C)"
metrics:
  duration: "~90 minutes (multi-session)"
  completed: "2026-06-18T00:26:43Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 46 Plan 03: Tabelas Mobile e Tokens Summary

Responsive table→stacked-cards for the 3 main ML dashboard pages (MLAnuncios, MLPedidos, MLFinanceiro) using the existing `useIsMobile()` hook. All KPICards wired to KPI_GLOSSARY tooltips via `tip()` helper. Inline empty states migrated to reusable `<EmptyState>`. Hardcoded `text-emerald-600`/`text-red-600` replaced with `text-kpi-positive`/`text-kpi-negative` design tokens.

## Tasks

| # | Name | Status | Commit | Files |
|---|------|--------|--------|-------|
| 1 | MLPedidos + MLFinanceiro | Complete | 490124e8, 0141f98e | MLPedidos.tsx, MLFinanceiro.tsx |
| 2 | MLAnuncios | Complete | dd143450 | MLAnuncios.tsx |

## What Was Built

### UX-03: Responsive Table → Stacked Cards (D-06/D-07)

Applied `isMobile ? <cards> : <Table>` ternary pattern to the primary data tables in all 3 pages:

- **MLPedidos.tsx**: Main orders table becomes stacked cards on mobile. Each card shows: produto, valor, status badge, data, tipo de entrega, and expandable details (NF, rastreio).
- **MLFinanceiro.tsx**: Tabela por produto (DRE breakdown per item) becomes stacked cards. Each card shows: SKU/produto, receita, margem, status com badge.
- **MLAnuncios.tsx**: Catálogo product table becomes stacked cards with Preço + Estoque always shown; financial columns (Mg. Bruta, Mg. Líq., Mg. Op.) shown only when `columnView === "financeiro"`.

Secondary/report tables kept as `overflow-x-auto` scroll:
- SubTabTopProdutos, SubTabUF (MLPedidos)
- Tabela por marca, tabela por SKU (MLFinanceiro)

### UX-01: KPI Glossary Tooltips (D-01)

`tip(key)` helper reads `KPI_GLOSSARY[key]?.description` and returns `undefined` if key absent (safe). Total KPICards wired across 3 pages:

- **MLPedidos**: 4 cards (pedidos, receita_bruta, receita_liquida, ticket_medio)
- **MLFinanceiro**: 8 cards (receita_bruta, cmv, comissao_ml, cffe, impostos, publicidade, lucro_bruto, margem_bruta)
- **MLAnuncios**: 15 cards across Catálogo, Ranking, Marca, and Curva ABC sections. Custom string tooltips used for keys without a GlossaryKey match.

### UX-02: EmptyState Migration (D-04/D-05)

Replaced ad-hoc inline empty state components with reusable `<EmptyState>`:

- **MLPedidos**: `NotConnected()` → `<EmptyState icon={Plug} … actionLabel="Ir para Integrações" actionHref="/integracoes" />`; `EmptyReport()` → `<EmptyState icon={ClipboardList} … size="compact" />`
- **MLFinanceiro**: `NotConnected()` → `<EmptyState icon={Plug} … actionLabel="Ir para Integrações" actionHref="/integracoes" />`
- **MLAnuncios**: inline no-data div → `<EmptyState icon={ShoppingBag} … size="compact" />`

### UX-04: Semantic Color Tokens (D-08)

Replaced `text-emerald-600` → `text-kpi-positive` and `text-red-600` → `text-kpi-negative` in all semantic financial contexts (positive margin, positive difference, negative cost). All occurrences verified per file.

Intentionally preserved:
- Recharts SVG `fill=` and `stroke=` hex values (#10b981, #ef4444, etc.) — SVG attributes, not Tailwind classes
- `STATUS_CONFIG.cancelled.color: "text-red-600"` (MLPedidos) — status category color
- Amber/orange warning tones for cost warnings

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Documented Decisions

**1. Sub-table scroll-x preservation**
- **Found during:** Task 1 (MLPedidos)
- **Decision:** Secondary report tables (SubTabTopProdutos, SubTabUF, por-marca, por-SKU) kept as horizontal scroll, not converted to cards. These are analytical/report views with column-comparison needs that break in card layout. Mobile users access these rarely.
- **Impact:** Minor — primary CRUD tables are responsive; secondary analytics remain scroll-x with `overflow-x-auto` wrapper (already present).

**2. Custom tooltip strings for non-glossary KPICards**
- **Found during:** Task 2 (MLAnuncios)
- **Decision:** KPICards like "Total de Anúncios", "Mais Anúncios", "Curva A/B/C" have no matching `GlossaryKey`. Used inline string literals for these instead of omitting tooltips.
- **Impact:** Positive — all KPICards have tooltips, improving UX consistency.

## Known Stubs

None — all changes wire to real data. No placeholder or TODO values introduced.

## Threat Flags

None — changes are purely frontend rendering (no new network endpoints, auth paths, or schema changes).

## Self-Check: PASSED

Files exist and commits verified.
