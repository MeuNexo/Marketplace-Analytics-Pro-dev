# Phase 5: Dashboard de Análise — Research

**Researched:** 2026-05-15
**Domain:** React dashboard UI — product cards, interactive table, per-row strategy selector
**Confidence:** HIGH (all findings derived from reading actual codebase files)

---

## Summary

Phase 4 delivered a complete analysis engine (`computeAnalysis`) and snapshot persistence hook (`useAnalysisSnapshots`). Phase 5 wires the user-facing UI: a new "Análise" tab inside `MLPrecificacao`, controls to pick a product + time window + ML store, a "Run Analysis" button, three price KPI cards per product, an elasticity phrase, and an interactive table with per-row strategy dropdowns with visual cell highlighting.

**The single biggest gap is data access:** there is no existing hook to fetch `orders` rows filtered by `item_id + date range`. `MLPedidos.tsx` does a direct Supabase query inside the page component itself. A new `useMLOrdersByItem` hook must be created before any dashboard component can function.

**Primary recommendation:** Build the dashboard as a single new file `DashboardAnalise.tsx` (tab content component), one new hook `useMLOrdersByItem`, and two sub-components — `ProductAnalysisCard` for the card view and `AnalysisTable` for the table view.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Run-analysis trigger (button + inputs) | Frontend (SPA) | — | Pure client-side orchestration of existing hook + engine |
| Fetch orders for item+period | Frontend (SPA) | Supabase DB | Direct Supabase client query, same pattern as MLPedidos |
| computeAnalysis + saveSnapshot | Frontend (SPA) | Supabase DB | Already in useAnalysisSnapshots; called on button click |
| Product cards display | Frontend (SPA) | — | Stateless render of AnalysisSnapshot data |
| Strategy table + per-row dropdown | Frontend (SPA) | Supabase DB | updateStrategy() writes to commercial_analysis_snapshots |
| Strategy visual highlight | Frontend (SPA) | — | CSS className swap based on local state |

---

## Standard Stack

All packages already installed — no new dependencies required.

### Core (already in project)
| Library | Version | Purpose |
|---------|---------|---------|
| shadcn/ui Table | — | `Table, TableHeader, TableBody, TableRow, TableHead, TableCell` — all confirmed in `src/components/ui/table.tsx` |
| shadcn/ui Select | — | Per-row strategy dropdown — confirmed present, used extensively in SimuladorPrecificacao |
| shadcn/ui Badge | — | ElasticityClass color badge — confirmed in `src/components/ui/badge.tsx` |
| shadcn/ui Card | — | Product analysis cards — same pattern as SimuladorPrecificacao |
| shadcn/ui Skeleton | — | Loading state for cards and table — confirmed present |
| KPICard | internal | Three price cards (GMV / Neutro / Margem) — `src/components/dashboard/KPICard.tsx` |
| framer-motion | 12.38.0 | Tab content fade-in — already used in MLPrecificacao AnimatePresence wrapper |
| useMLPrecosCustos | internal | Product search (Popover + Command) — reuse existing pattern verbatim |
| MLPeriodPicker | internal | Date range picker — `src/components/mercadolivre/MLPeriodPicker.tsx` already handles quick ranges + calendar |
| useMLStore | internal context | `selectedStore`, `resolvedMLUserIds`, `stores` — provides ml_user_id for query scoping |
| useOrganization | internal context | `currentOrg.id` — required for snapshot org-scoping |
| @supabase/supabase-js | 2.98.0 | Direct DB query for orders |

**Installation:** No new packages required.

---

## Data Flow Design

### How analysis is triggered

1. User opens "Análise" tab in MLPrecificacao.
2. Controls bar shows: product picker (reuses Popover+Command from SimuladorPrecificacao), period picker (reuses MLPeriodPicker), and a "Analisar" button.
3. On button click: call `useMLOrdersByItem(itemId, mlUserId, dateFrom, dateTo)` → maps rows to `OrderRecord[]` → call `saveSnapshot(input)` → snapshot returned → render cards + table row.
4. The component maintains a local `snapshots: AnalysisSnapshot[]` list; new snapshots are prepended. Optionally on mount, `fetchSnapshots(itemId, orgId)` reloads prior snapshots for the same item.

### Input controls placement

Inline controls at the top of the tab (not a separate form/page). Pattern follows `SimuladorPrecificacao`'s product-picker card: compact card with three inputs on one row.

### Fresh compute vs. existing snapshots

Always compute fresh on "Analisar" click, then persist via `saveSnapshot`. On product selection, optionally load existing snapshots with `fetchSnapshots` to populate the table with historical runs — but this is optional for MVP; the planner may defer it.

---

## Data Access Gap: New Hook Required

**`useMLOrdersByItem` does not exist.** It must be created.

### Orders table schema (from `src/integrations/supabase/types.ts`)

Relevant columns for `OrderRecord` mapping:

| DB column | OrderRecord field | Notes |
|-----------|------------------|-------|
| `id` | `id` | UUID |
| `preco_unit` | `price` | nullable — filter out nulls |
| `quantidade` | `quantity` | default 1 |
| `data_pedido` | `order_date` | YYYY-MM-DD string |
| `ml_user_id` | `ml_user_id` | for scope |
| `item_id` | `item_id` | filter key |
| `titulo` | `title` | nullable |
| `status` | — | filter: exclude `cancelled`, `returned` |

**File:** `src/hooks/useMLOrdersByItem.ts`

```typescript
// [VERIFIED: MLPedidos.tsx direct query pattern]
// Signature
export function useMLOrdersByItem(): {
  fetchOrders: (
    itemId: string,
    mlUserId: string,
    dateFrom: string,   // YYYY-MM-DD
    dateTo: string,     // YYYY-MM-DD
    orgId: string,
  ) => Promise<OrderRecord[]>;
  loading: boolean;
}
```

The hook uses direct Supabase client (Pattern 5 from ARCHITECTURE.md), same as MLPedidos. No edge function required.

**Column mapping:**
```typescript
// Map DB row → OrderRecord
{
  id: row.id,
  price: row.preco_unit ?? 0,
  quantity: row.quantidade ?? 1,
  order_date: row.data_pedido ?? "",
  ml_user_id: row.ml_user_id,
  item_id: row.item_id,
  title: row.titulo ?? "",
  brand: null,   // not in orders table — omit or fetch separately
}
```

**Filter:** `.in("status", ["paid", "shipped", "delivered"])` — exclude cancelled/returned, consistent with MLPedidos confirmed statuses (`CONFIRMED_STATUSES`).

**Pagination:** Use same 1000-row page loop pattern from MLPedidos (most products will be well under 1000, but be defensive).

---

## Component Breakdown

### New files to create

```
src/
├── hooks/
│   └── useMLOrdersByItem.ts           # NEW — fetch orders for item+period
└── components/mercadolivre/
    └── precificacao/
        ├── DashboardAnalise.tsx        # NEW — tab content, owns all state
        ├── ProductAnalysisCard.tsx     # NEW — 3-price KPI cards + elasticity phrase
        └── AnalysisTable.tsx           # NEW — interactive table with strategy dropdown
```

### DashboardAnalise.tsx

**Responsibility:** Owns the run-analysis state machine: inputs, loading, snapshot list, error state.

```typescript
// State shape
interface State {
  itemId: string | null;
  itemTitle: string;
  dateFrom: string;       // YYYY-MM-DD
  dateTo: string;         // YYYY-MM-DD
  periodDays: number;
  snapshots: AnalysisSnapshot[];
  running: boolean;
  error: string | null;
}
```

**Layout:**
- Top: controls bar (product picker + period picker + "Analisar" button)
- If `snapshots.length === 0` and not running: empty state prompt
- If `snapshots.length > 0`: `ProductAnalysisCard` for most recent snapshot + `AnalysisTable` showing all snapshots

### ProductAnalysisCard.tsx

**Responsibility:** Display the three recommended prices as KPI cards + elasticity phrase.

```typescript
interface Props {
  snapshot: AnalysisSnapshot;
}
```

**Layout:** Grid `grid-cols-3` with three `KPICard` components (variant `"minimal"`, size `"compact"`):
- Preço GMV → `priceGmv` formatted as BRL
- Preço Neutro → `priceNeutral` formatted as BRL
- Preço Margem → `priceMargin` formatted as BRL

Below the cards: elasticity phrase string (see elasticity phrase section).

### AnalysisTable.tsx

**Responsibility:** Table with columns Produto, Marca, Preço GMV, Preço Neutro, Preço Margem, Impacto Comercial, Estratégia.

```typescript
interface Props {
  snapshots: AnalysisSnapshot[];
  onStrategyChange: (snapshotId: string, strategy: 'gmv' | 'neutral' | 'margin') => void;
}
```

Uses `Table, TableHeader, TableBody, TableRow, TableHead, TableCell` from `@/components/ui/table`.

---

## Tab Integration in MLPrecificacao.tsx

Extend `TABS` constant and add tab content branch:

```typescript
// [VERIFIED: MLPrecificacao.tsx — current TABS constant]
const TABS = [
  { id: "simulador", label: "Simulador" },
  { id: "analise",   label: "Análise" },   // ADD
] as const;

// In AnimatePresence body:
{tab === "analise" && <DashboardAnalise />}
```

---

## Strategy Dropdown + Visual Highlight

### Per-row Select pattern

Each table row owns its own local strategy state initialized from `snapshot.strategy`. On change: call `updateStrategy(snapshotId, newStrategy)` from `useAnalysisSnapshots`, then update local state.

```typescript
// [VERIFIED: shadcn Select pattern from SimuladorPrecificacao.tsx]
<Select
  value={localStrategy ?? ""}
  onValueChange={(v) => handleStrategyChange(snapshot.id, v as Strategy)}
>
  <SelectTrigger className="h-7 w-[100px] text-xs">
    <SelectValue placeholder="Estratégia" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="gmv">GMV</SelectItem>
    <SelectItem value="neutral">Neutro</SelectItem>
    <SelectItem value="margin">Margem</SelectItem>
  </SelectContent>
</Select>
```

### Visual cell highlight

Use conditional `className` on `TableCell` — ring + background tint when a column matches the active strategy:

```typescript
// Strategy → column mapping
const STRATEGY_COL: Record<Strategy, 'priceGmv' | 'priceNeutral' | 'priceMargin'> = {
  gmv:     'priceGmv',
  neutral: 'priceNeutral',
  margin:  'priceMargin',
};

// On each price cell:
<TableCell
  className={cn(
    "tabular-nums text-right",
    snapshot.strategy === 'gmv' && col === 'priceGmv'
      && "bg-emerald-500/10 text-emerald-700 font-semibold ring-1 ring-inset ring-emerald-500/30 rounded",
    // etc.
  )}
>
```

Color coding:
- GMV → emerald (matches `tier === "good"` color from SimuladorPrecificacao)
- Neutro → blue (`bg-blue-500/10 text-blue-700`)
- Margem → amber (`bg-amber-500/10 text-amber-700`)

---

## Elasticity Phrase (DASH-01)

The phrase `"A cada R$1,00 de subida a partir de R$XX,XX, perde aproximadamente X,XX% em volume"` maps directly to `AnalysisSnapshot` fields:

```typescript
function elasticityPhrase(snapshot: AnalysisSnapshot): string {
  const base = formatBRL(snapshot.priceGmv);
  const pct = snapshot.elasticityPct.toFixed(2).replace(".", ",");
  return `A cada R$1,00 de subida a partir de ${base}, perde aproximadamente ${pct}% em volume`;
}
```

`formatBRL` is already exported from `@/lib/pricing/calculator` — reuse it.

---

## Impacto Comercial Badge (DASH-02)

Maps `ElasticityClass` to badge color. Use Badge component directly (no new CVA variant needed):

| ElasticityClass | Label | Badge className |
|-----------------|-------|----------------|
| `baixa` | Baixa | `bg-emerald-500/15 text-emerald-700 border-emerald-500/30` |
| `media` | Média | `bg-blue-500/15 text-blue-700 border-blue-500/30` |
| `alta` | Alta | `bg-amber-500/15 text-amber-700 border-amber-500/30` |
| `extrema` | Extrema | `bg-red-500/15 text-red-700 border-red-500/30` |

Use `Badge` with `variant="outline"` + custom className (same pattern as `StatusBadge` in MLPedidos).

---

## Common Pitfalls

### Pitfall 1: brand field missing from orders table
**What goes wrong:** `OrderRecord.brand` is required by the type but the `orders` table has no `brand` column.
**Why it happens:** `brand` was designed for product metadata, not order records.
**How to avoid:** Always pass `brand: null` when mapping DB rows to `OrderRecord`. The engine handles null brand correctly. For the table's Marca column, derive brand from `snapshot.brand` (already stored in the snapshot from the original `SnapshotInput`).

### Pitfall 2: Mismatched periodDays vs. date range
**What goes wrong:** `computeAnalysis(orders, periodDays)` requires `periodDays` to match the actual date span. If miscalculated, `dailyAvg` per bucket is wrong.
**How to avoid:** Compute `periodDays` as `differenceInCalendarDays(parsedTo, parsedFrom) + 1` before calling `saveSnapshot`. Use `date-fns` `differenceInCalendarDays` (already imported in `useMLFilters.ts`).

### Pitfall 3: Empty orders array with no user feedback
**What goes wrong:** If no confirmed orders exist for the item+period, `computeAnalysis` returns `ZERO_RESULT` silently.
**How to avoid:** Check `orders.length === 0` after fetch. Surface a toast or inline message: "Nenhum pedido confirmado encontrado para este produto no período."

### Pitfall 4: Strategy Select value binding on null
**What goes wrong:** `snapshot.strategy` is `null` initially. Passing `null` as `value` to shadcn Select renders the trigger in an inconsistent state.
**How to avoid:** Use `value={snapshot.strategy ?? ""}` and treat `""` as "not set". The placeholder text handles the null display.

### Pitfall 5: Table overflow on mobile
**What goes wrong:** 7-column table at full width breaks on small screens.
**How to avoid:** Wrap table in `<div className="overflow-x-auto">` (the shadcn Table component already does this via `overflow-auto` on its wrapper div — confirmed in `table.tsx`).

---

## Architecture Patterns

### Run-Analysis Flow

```
[DashboardAnalise] — user clicks "Analisar"
    │
    ├─ fetchOrders(itemId, mlUserId, dateFrom, dateTo, orgId)
    │    └─ Direct Supabase query to `orders` table
    │       filtered by item_id + ml_user_id + date range + confirmed statuses
    │
    ├─ saveSnapshot({ orders, periodDays, periodStart, periodEnd, mlUserId, orgId, itemId, productTitle })
    │    └─ internally calls computeAnalysis(orders, periodDays) → AnalysisResult
    │    └─ inserts into commercial_analysis_snapshots
    │    └─ returns AnalysisSnapshot
    │
    └─ prepend snapshot to local snapshots[] state → re-render cards + table
```

### Strategy Update Flow

```
[AnalysisTable row] — user changes dropdown
    │
    ├─ optimistic: setLocalStrategy(newStrategy) immediately
    │
    └─ updateStrategy(snapshotId, newStrategy) — Supabase UPDATE
         └─ on error: revert to previous strategy + toast
```

### Recommended Project Structure (new files only)

```
src/
├── hooks/
│   └── useMLOrdersByItem.ts
└── components/mercadolivre/precificacao/
    ├── DashboardAnalise.tsx
    ├── ProductAnalysisCard.tsx
    └── AnalysisTable.tsx
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Product search | Custom autocomplete | Reuse Popover+Command from SimuladorPrecificacao verbatim |
| Date range picker | Custom calendar | Reuse MLPeriodPicker + useMLFilters QUICK_RANGES |
| BRL currency format | Custom formatter | `formatBRL` from `@/lib/pricing/calculator` |
| Analysis computation | Inline price logic | `computeAnalysis` from `@/lib/analysis/engine` — already tested |
| Snapshot persistence | Custom DB write | `saveSnapshot` from `useAnalysisSnapshots` |
| Strategy persistence | Custom DB update | `updateStrategy` from `useAnalysisSnapshots` |
| Loading skeleton | Custom shimmer | shadcn `Skeleton` component |

---

## Data Access Gaps

| Gap | Impact | Resolution |
|-----|--------|-----------|
| No hook to fetch `orders` by `item_id + date range` | Blocks analysis from running | Create `src/hooks/useMLOrdersByItem.ts` (Wave 0 task) |
| `brand` not in orders table | Table "Marca" column will always be empty from order data | Use `snapshot.brand` stored at save time; populate via product title parse or leave null |
| `product_title` requires item metadata at save time | `saveSnapshot` needs `productTitle` from somewhere | Source from `useMLPrecosCustos` items list (already loaded in the tab — same store) |

---

## Environment Availability

Step 2.6: SKIPPED — phase is code-only, no external CLI tools or services beyond Supabase (already live).

---

## Validation Architecture

Validation skipped — `workflow.nyquist_validation: false` in `.planning/config.json`.

---

## Security Domain

No new auth surface introduced. Dashboard reads from `commercial_analysis_snapshots` and `orders` — both already RLS-protected at org level (same `organization_id` scoping pattern used throughout the app). `updateStrategy` writes to `commercial_analysis_snapshots` which is already scoped.

No ASVS categories newly applicable beyond what Phase 4 already addressed.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `formatBRL` is exported from `@/lib/pricing/calculator` | Code Examples / elasticity phrase | Minor — fallback: `toLocaleString("pt-BR", { style: "currency", currency: "BRL" })` |
| A2 | `brand` field can be null in AnalysisSnapshot for analysis-table Marca column | Data Access Gaps | Low — field already typed as `string \| null` in SnapshotInput |

All other claims verified by reading source files in this session.

---

## Open Questions

1. **Show single latest snapshot or all historical snapshots in the table?**
   - What we know: `fetchSnapshots(itemId, orgId)` returns all past snapshots for an item, ordered by `created_at DESC`.
   - What's unclear: Whether the UX should show one row per item (latest only) or all historical runs.
   - Recommendation: Start with latest-only per item in the table (one row). Historical view is a DASH-future enhancement. The planner may decide based on REQUIREMENTS.md scope.

2. **Which ML store does the user run the analysis for?**
   - What we know: `useMLStore` provides `selectedStore` and `resolvedMLUserIds`. A user may have multiple stores.
   - What's unclear: Should the controls bar include an explicit store selector, or inherit from the global MLStoreSelector?
   - Recommendation: Inherit from `useMLStore().selectedStore`. If `selectedStore === "all"`, default to `stores[0].ml_user_id` (same pattern as SimuladorPrecificacao line 128-131). The planner can add an explicit store override if the requirement needs it.

---

## Sources

### PRIMARY (HIGH confidence — read from codebase)
- `src/pages/mercadolivre/MLPrecificacao.tsx` — tab layout, AnimatePresence pattern
- `src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx` — product picker (Popover+Command), Select usage, Card layout, formatBRL import
- `src/components/mercadolivre/MLKPIGrid.tsx` — KPICard grid pattern
- `src/components/dashboard/KPICard.tsx` — KPICard props interface and variant system
- `src/components/ui/table.tsx` — Table component exports
- `src/components/ui/badge.tsx` — Badge variants
- `src/hooks/useAnalysisSnapshots.ts` — full hook API (saveSnapshot, fetchSnapshots, updateStrategy, AnalysisSnapshot type)
- `src/lib/analysis/types.ts` — OrderRecord, AnalysisResult, ElasticityClass
- `src/lib/analysis/engine.ts` — computeAnalysis signature and ZERO_RESULT behavior
- `src/hooks/useMLPrecosCustos.ts` — items list, connected state, store resolution pattern
- `src/hooks/useMLFilters.ts` — DateRange type, QUICK_RANGES, getFilterDates
- `src/components/mercadolivre/MLPeriodPicker.tsx` — period picker component props
- `src/pages/mercadolivre/MLPedidos.tsx` — direct Supabase orders query pattern (lines 685-726)
- `src/integrations/supabase/types.ts` — orders table schema (lines 841-948)
- `.planning/config.json` — nyquist_validation: false, mode: yolo

### SECONDARY (MEDIUM — CLAUDE.md project conventions)
- `CLAUDE.md` — stack, conventions, component file structure, import patterns

---

## Metadata

**Confidence breakdown:**
- Component structure: HIGH — read actual source files
- Data flow: HIGH — traced from engine.ts through useAnalysisSnapshots to Supabase
- Orders query pattern: HIGH — read MLPedidos direct query verbatim
- Strategy highlight UX: HIGH — Select pattern verified in SimuladorPrecificacao; className approach is standard Tailwind

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (stable React SPA codebase, no fast-moving external dependencies)
