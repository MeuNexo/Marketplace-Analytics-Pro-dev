---
phase: 63-compras-reposi-o-por-sku-p-gina-pr-pria
plan: "03"
status: complete
subsystem: frontend
tags: [compras, replenishment, sku, navigation, shadcn, xlsx]
dependency_graph:
  requires: ["63-01", "63-02"]
  provides: ["MLCompras /compras page", "ReplenishmentSkuTable drill", "ReplenishmentSkuFilters", "ReplenishmentParamsDialog"]
  affects: ["MLEstoque (aba removed)", "App.tsx routes", "ApiSidebar nav", "MenuVisibilityContext", "roleAccess"]
tech_stack:
  added: []
  patterns: ["Radix Collapsible drill", "react-hook-form+zod CRUD Dialog", "xlsx export via XLSX.writeFile", "useMemo client-side filtering + regrouping"]
key_files:
  created:
    - src/pages/mercadolivre/MLCompras.tsx
    - src/components/mercadolivre/ReplenishmentSkuTable.tsx
    - src/components/mercadolivre/ReplenishmentSkuFilters.tsx
    - src/components/mercadolivre/ReplenishmentParamsDialog.tsx
  modified:
    - src/App.tsx
    - src/config/roleAccess.ts
    - src/components/layout/ApiSidebar.tsx
    - src/contexts/MenuVisibilityContext.tsx
    - src/pages/mercadolivre/MLEstoque.tsx
decisions:
  - "RegroupRows derived in MLCompras (not hook): keeps hook single-responsibility; MLCompras derives filtered grouped from flat rows via useMemo"
  - "ReplenishmentSkuTable uses Collapsible asChild pattern wrapping TableRow; single-SKU announcements skip expand entirely"
  - "ReplenishmentParamsDialog: separate Dialog component with local state; invalidates react-query cache on save"
  - "ShoppingCart icon also removed from MLEstoque lucide import since it was only used by the removed tab"
  - "filterSemGiro state described in RESEARCH was merged into filterStatus enum (all|gatilho|sem_giro) to keep filter bar compact — equivalent coverage"
metrics:
  duration: "6m27s"
  completed: "2026-06-26"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 5
---

# Phase 63 Plan 03: Frontend /compras Page Summary

**One-liner:** Página /compras com Compra Recomendada por SKU — filtros+drill+xlsx+CRUD params, aba removida de /estoque.

## What Was Built

Delivered the full frontend for the `/compras` route (Phase 63, CMP-05/CMP-06/CMP-07/CMP-08):

### Files Created

**`src/components/mercadolivre/ReplenishmentSkuFilters.tsx`**
- Controlled filter bar: brand (Select from distinct brands), status (all/gatilho/sem_giro), custo (all/com/sem), search (title/SKU/Cor+Tamanho)
- Shows filtered/total count
- Props-driven, no internal state

**`src/components/mercadolivre/ReplenishmentSkuTable.tsx`**
- Table grouped by anuncio; Radix Collapsible drill with ChevronRight rotation
- Master row (anuncio): aggregates total_compra_sugerida, any_gatilho_ativo, any_custo_ausente
- Single-SKU announcements: flat row, no expand needed
- Variation rows: indent, attribute_combinations_label, sku_code mono, per-SKU cells
- Reuses formatters/badges from ReplenishmentPanel (CoberturaCell, ValorEstimadoCell, FlagsCell, ParamsCell pattern) — no calculation logic
- Loading skeleton, error state, empty state

**`src/components/mercadolivre/ReplenishmentParamsDialog.tsx`**
- shadcn Dialog triggered by "Parâmetros" button
- Lists existing replenishment_params scoped by org (RLS enforces org isolation)
- CRUD form: react-hook-form + zod (scope global/marca/sku, scope_value, lead_time_dias 1-365, meta_cobertura_dias 1-730, safety_days 0-60, moq >=1, pack_multiple >=1)
- Submit disabled when orgRole is not owner/admin; toast.error on RLS permission error (defense-in-depth, RLS is the real gate)
- Invalidates ["get_replenishment_by_sku"] query on save/delete

**`src/pages/mercadolivre/MLCompras.tsx`**
- Page (default export for React.lazy) composing filters + table + export + dialog
- Calls useReplenishmentBySku; derives distinct brands via useMemo
- applyFilters + regroupRows via useMemo (client-side, no backend filtering needed at ~500 SKUs)
- xlsx export: XLSX.utils.json_to_sheet + XLSX.writeFile, flat per-SKU rows
- REPL-09 alert (compras a chegar nao descontadas) — copied from ReplenishmentPanel
- MLPageHeader + sticky header pattern consistent with other ML pages

### Files Modified

- **App.tsx**: added `MLCompras` lazy import + Route `/compras` with RoleRoute + ErrorBoundary
- **roleAccess.ts**: added `"/compras": OPERATIONAL` (owner/admin/member); NOT added to VIEWER_ELIGIBLE_ROUTES (D-10: viewer default-deny)
- **ApiSidebar.tsx**: added `ShoppingCart` to lucide imports + `{ icon: ShoppingCart, label: "Compras", path: "/compras" }` after Estoque in Operacoes section
- **MenuVisibilityContext.tsx**: added `{ label: "Compras", path: "/compras" }` after Estoque in Operacoes section
- **MLEstoque.tsx**: removed import ReplenishmentPanel + TabsTrigger value="compra" + TabsContent value="compra" + ShoppingCart icon (was only used by removed tab)

## Verification Results

- `npx tsc --noEmit`: 0 errors
- `npx vitest run`: 208/208 tests pass (17 test files)
- `npm run build`: success in 18.50s; MLCompras-*.js = 82.20 kB / 20.68 kB gzip

## Acceptance Criteria Status

| Criteria | Status |
|----------|--------|
| Rota /compras no menu (Operacoes, owner/admin/member) | PASS |
| Aba "Compra Recomendada" removida de MLEstoque | PASS |
| compraUtils.ts intocado | PASS |
| CompraRecomendadaPanel.tsx intocado | PASS |
| ReplenishmentPanel.tsx preserved (not deleted) | PASS |
| Filtros: marca/status/custo/busca | PASS |
| Drill anuncio->variacoes (Collapsible) + export xlsx | PASS |
| CRUD params com precedencia global<marca<sku | PASS |
| Write desabilitado para nao-owner/admin + toast RLS | PASS |
| REPL-09 alert presente | PASS |
| Nenhum import de compraUtils/CompraRecomendadaPanel | PASS |

## Deviations from Plan

### Design Decisions (Claude's Discretion)

**1. FilterSemGiro merged into filterStatus enum**
- Plan mentioned both `filterSemGiro: boolean` and `filterStatus: "all"|"gatilho"|"sem_giro"` as separate controls
- Decision: unified into filterStatus enum (gatilho | sem_giro | all) — avoids redundancy since sem_giro exclusive with gatilho; keeps filter bar compact
- Equivalent coverage of CMP-06 requirements

**2. RegroupRows function in MLCompras (not re-exported from hook)**
- Plan suggested hook exposes `grouped`; the hook does expose `grouped` for unfiltered data
- When filters are applied, a local `regroupRows` function re-groups filtered flat rows
- Keeps hook single-responsibility; the hook's `grouped` is used as base reference

**3. Master row aggregation: cobertura/ponto columns blank for grouped rows**
- Those fields only make sense per-SKU; showing a blank in master row avoids misleading averages
- Users expand to see per-variation values

## Known Stubs

None. All data flows from the real RPC `get_replenishment_by_sku` via `useReplenishmentBySku`. No hardcoded values, no mock data.

## Threat Flags

No new threat surface beyond what is in the plan's threat model. The /compras route is gated by roleAccess["/compras"]=OPERATIONAL and viewer is default-deny (T-63-09 mitigated). ReplenishmentParamsDialog write path enforces owner/admin at RLS level with UI defense-in-depth (T-63-08 mitigated).

## Self-Check

### Created files exist:
- `/root/garment-glow-test/src/pages/mercadolivre/MLCompras.tsx` — FOUND
- `/root/garment-glow-test/src/components/mercadolivre/ReplenishmentSkuTable.tsx` — FOUND
- `/root/garment-glow-test/src/components/mercadolivre/ReplenishmentSkuFilters.tsx` — FOUND
- `/root/garment-glow-test/src/components/mercadolivre/ReplenishmentParamsDialog.tsx` — FOUND

### Commits exist:
- 63e76542: feat(63-03): add ReplenishmentSkuFilters and ReplenishmentSkuTable components
- 022842a5: feat(63-03): add MLCompras page + ReplenishmentParamsDialog (CMP-05/CMP-08)
- 5aacecaa: feat(63-03): add /compras route/nav and remove aba from MLEstoque (CMP-07)

## Self-Check: PASSED
