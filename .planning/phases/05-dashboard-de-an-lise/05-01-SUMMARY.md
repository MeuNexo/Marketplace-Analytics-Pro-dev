---
phase: 05-dashboard-de-an-lise
plan: "01"
subsystem: ml-analysis
tags: [hook, supabase, orders, tabs, precificacao]
dependency_graph:
  requires: []
  provides: [useMLOrdersByItem, analise-tab-stub]
  affects: [src/pages/mercadolivre/MLPrecificacao.tsx]
tech_stack:
  added: []
  patterns: [direct-supabase-query, useState-useCallback, paginated-fetch]
key_files:
  created:
    - src/hooks/useMLOrdersByItem.ts
  modified:
    - src/pages/mercadolivre/MLPrecificacao.tsx
decisions:
  - "Used direct Supabase client (Pattern 5) — no TanStack Query per plan spec"
  - "Pagination at 1000 rows per page, matching MLPedidos.tsx pattern"
  - "brand always null since orders table has no brand column"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-18"
  tasks_completed: 2
  files_changed: 2
---

# Phase 5 Plan 01: useMLOrdersByItem Hook and Análise Tab Stub Summary

Hook and tab stub delivering data-fetch infrastructure and UI mount-point required by Plan 05-02.

## What Was Built

### Task 1: useMLOrdersByItem hook (src/hooks/useMLOrdersByItem.ts)

New hook implementing Pattern 5 (direct Supabase client, no TanStack Query) to fetch confirmed
orders for a specific item_id within a date range.

**Supabase table discovered:** `orders`

**Column mapping (DB → OrderRecord):**
| DB column      | OrderRecord field | Notes                     |
|----------------|-------------------|---------------------------|
| id             | id                |                           |
| preco_unit     | price             | nullable, defaults to 0   |
| quantidade     | quantity          | defaults to 1             |
| data_pedido    | order_date        | YYYY-MM-DD, defaults to ""|
| ml_user_id     | ml_user_id        |                           |
| item_id        | item_id           |                           |
| titulo         | title             | nullable, defaults to ""  |
| (none)         | brand             | always null — no column   |

**Filters applied:**
- `.eq("organization_id", orgId)` — cross-org isolation (T-05-01 mitigation)
- `.eq("ml_user_id", mlUserId)` — seller scope
- `.eq("item_id", itemId)` — item scope
- `.gte("data_pedido", dateFrom)` — date range start
- `.lte("data_pedido", dateTo)` — date range end
- `.in("status", ["paid", "shipped", "delivered"])` — confirmed orders only

**Pagination:** while-loop with `.range(from, from + 999)`, breaks when page < 1000 rows.

### Task 2: Análise tab stub (src/pages/mercadolivre/MLPrecificacao.tsx)

Extended TABS array from 1 to 2 entries:
```typescript
const TABS = [
  { id: "simulador", label: "Simulador" },
  { id: "analise",   label: "Análise" },
] as const;
```

Added conditional render branch inside AnimatePresence:
```tsx
{tab === "analise" && (
  <div className="py-8 text-center text-muted-foreground">
    Carregando módulo de análise…
  </div>
)}
```

The `TabId` type is derived from `typeof TABS[number]["id"]`, so it automatically accepts `"analise"` — no manual union update needed.

## Verification Results

- `npx tsc --noEmit` — zero errors related to useMLOrdersByItem or MLPrecificacao (zero output lines)
- `npm test` — 46/46 tests pass (3 test files: example, tax, engine)

## Deviations from Plan

None — plan executed exactly as written. The plan's interface spec (column names, filter list, pagination pattern) was confirmed accurate against `src/integrations/supabase/types.ts`.

## Threat Coverage

T-05-01 (Information Disclosure): Mitigated — both `organization_id` and `ml_user_id` filters always applied in `fetchOrders`, matching the threat register disposition.

T-05-02 (Tampering via date inputs): Accepted — date strings passed as-is; invalid dates yield zero rows, no SQL injection risk (Supabase JS uses prepared queries).

## Known Stubs

- `MLPrecificacao.tsx` tab "analise" renders a static placeholder text. Intentional — will be replaced by `<AnaliseDashboard />` in plan 05-02. The stub does not prevent plan 05-01's goal (tab exists and is clickable).

## Self-Check: PASSED

- src/hooks/useMLOrdersByItem.ts: FOUND
- src/pages/mercadolivre/MLPrecificacao.tsx: FOUND (modified)
- Commit fc0ba56: FOUND
