---
phase: 46-ux-para-leigos
plan: "02"
subsystem: frontend-ui
tags: [glossary, kpi, empty-state, ux, wiring]
dependency_graph:
  requires:
    - 46-01 (KPI_GLOSSARY, EmptyState, KPICard Popover)
  provides:
    - MLKPIGrid → KPI_GLOSSARY wired (10 KPICards with tooltip)
    - MLSalesAnalytics → EmptyState (4 sites: Horário/Ticket/Estado/Funil)
    - TopSellingProducts → EmptyState (1 site: ranking vazio)
    - PublicidadeRelatorios → EmptyState with CTA /publicidade
    - MLEstoque → EmptyState with CTA /integracoes
  affects:
    - Plan 46-04 checkpoint visual (Wesley reviews glossary wording)
tech_stack:
  added: []
  patterns:
    - tip(key) helper typed by keyof typeof KPI_GLOSSARY — consumer-side lookup
    - EmptyState with action-specific description (D-05 pattern)
key_files:
  created: []
  modified:
    - src/components/mercadolivre/MLKPIGrid.tsx
    - src/components/mercadolivre/MLSalesAnalytics.tsx
    - src/components/mercadolivre/TopSellingProducts.tsx
    - src/components/mercadolivre/PublicidadeRelatorios.tsx
    - src/pages/mercadolivre/MLEstoque.tsx
decisions:
  - "tip(key) helper defined in MLKPIGrid (not imported) — colocation pattern; typed by keyof typeof KPI_GLOSSARY so tsc catches invalid keys"
  - "MLSalesAnalytics TabEstado loading state also migrated to EmptyState (not in original plan table but uses old local EmptyState)"
  - "MLEstoque link kept as /integracoes (matching existing app routing) — old inline block used /integrations (typo in original code)"
metrics:
  duration: "~3.5 minutes"
  completed: "2026-06-18"
  tasks_completed: 3
  files_changed: 5
---

# Phase 46 Plan 02: Glossário e Empty States — Componentes Summary

**One-liner:** Wired KPI_GLOSSARY to all 10 MLKPIGrid KPICards via typed tip() helper, and migrated 6 ad-hoc empty states across 4 components to the shared EmptyState with action-specific descriptions.

## What Was Built

### Task 1 — src/components/mercadolivre/MLKPIGrid.tsx

Imported `KPI_GLOSSARY` from `@/lib/kpi-glossary` and defined a local `tip(key: keyof typeof KPI_GLOSSARY)` helper that concatenates `definition + example` (when present). Added `tooltip={tip("...")}` to all 10 KPICards:

- receita_total, pedidos, ticket_medio, visitas, conversao, compradores (replaced hardcoded string), unidades_vendidas, markup, custo_operacional, impostos

TypeScript enforces key validity via `keyof typeof KPI_GLOSSARY` — any typo is caught at compile time.

**Commit:** 785d8307

### Task 2 — MLSalesAnalytics.tsx, TopSellingProducts.tsx, PublicidadeRelatorios.tsx

**MLSalesAnalytics:**
- Removed the local `function EmptyState({ message })` (different API from the new shared component)
- Added import of `{ EmptyState }` from `@/components/ui/empty-state` + `Clock` from lucide-react
- Replaced 4 usages:
  - TabHorario: `icon=Clock`, title="Nenhuma venda por hora", description contextual
  - TabTicket: `icon=TrendingUp`, title="Sem dados de vendas"
  - TabEstado loading: `icon=MapPin`, title="Carregando dados..."
  - TabFunil: `icon=Percent`, title="Sem dados de conversão"

**TopSellingProducts:**
- Added `EmptyState` import
- Replaced the ad-hoc `<div>Package+text</div>` with `<EmptyState icon={Package} ... size="compact">`
- Description: "Sincronize suas vendas para ver os produtos mais vendidos." (no CTA — data comes from auto sync)

**PublicidadeRelatorios:**
- Added `EmptyState` import + `Megaphone` from lucide-react
- Replaced ad-hoc `<div>Target+p</div>` with `<EmptyState icon={Megaphone} ... actionLabel="Ir para Publicidade" actionHref="/publicidade">`

**Commit:** 982cccea

### Task 3 — src/pages/mercadolivre/MLEstoque.tsx

- Added `EmptyState` import from `@/components/ui/empty-state`
- Replaced the inline NotConnected `<div>Plug+p+Button</div>` block with:
  ```tsx
  <EmptyState
    icon={Plug}
    title="Mercado Livre não conectado"
    description="Conecte sua conta para visualizar o estoque em tempo real."
    actionLabel="Ir para Integrações"
    actionHref="/integracoes"
  />
  ```
- Logistic badges `dark:text-blue-400`, `dark:text-violet-400`, `dark:text-amber-400` at lines 43-48 verified untouched — these are categorical colors (D-08), not kpi semantic tokens
- No table converted to cards — /estoque is out of scope for UX-03

**Deviation note:** The original inline code used `href="/integrations"` (English, likely a typo). The plan specifies `/integracoes` (correct Portuguese route). Fixed to `/integracoes`.

**Commit:** 257621d8

## Verification Results

- `npx tsc --noEmit` — PASS (exit 0, no errors)
- `npm run build` — PASS (clean build, pre-existing chunk size warning unrelated)
- KPI_GLOSSARY in MLKPIGrid: OK (10 tooltip={tip()} calls)
- EmptyState in all 4 consumer files: OK
- actionHref="/integracoes" in MLEstoque: OK
- actionHref="/publicidade" in PublicidadeRelatorios: OK
- dark:text-blue-400/violet-400 badges in MLEstoque preserved: OK

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed /integrations → /integracoes in MLEstoque NotConnected**
- **Found during:** Task 3
- **Issue:** Original inline code had `<Link to="/integrations">` (English, incorrect route)
- **Fix:** Plan correctly specifies `/integracoes`; used the correct route
- **Files modified:** src/pages/mercadolivre/MLEstoque.tsx
- **Commit:** 257621d8

**2. [Rule 2 - Missing coverage] Migrated TabEstado loading EmptyState**
- **Found during:** Task 2
- **Issue:** TabEstado in MLSalesAnalytics also used the local `EmptyState({message})` for its loading state (not in RESEARCH Pattern 3 table but part of same file)
- **Fix:** Replaced with shared EmptyState (icon=MapPin, compact)
- **Files modified:** src/components/mercadolivre/MLSalesAnalytics.tsx
- **Commit:** 982cccea

## Known Stubs

None. All changes are wiring of static strings (glossary) and presentational (empty states). No deferred data sources.

## Threat Flags

None. No new network endpoints, auth paths, file access, or schema changes. All content is static/presentational. T-46-03 (XSS via tooltip/description) mitigated by design — strings come from static glossary and string literals rendered as plain JSX text.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/components/mercadolivre/MLKPIGrid.tsx | FOUND |
| src/components/mercadolivre/MLSalesAnalytics.tsx | FOUND |
| src/components/mercadolivre/TopSellingProducts.tsx | FOUND |
| src/components/mercadolivre/PublicidadeRelatorios.tsx | FOUND |
| src/pages/mercadolivre/MLEstoque.tsx | FOUND |
| commit 785d8307 (MLKPIGrid glossary) | FOUND |
| commit 982cccea (empty states migration) | FOUND |
| commit 257621d8 (MLEstoque NotConnected) | FOUND |
