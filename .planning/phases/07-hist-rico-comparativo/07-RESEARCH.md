# Phase 7: Histórico Comparativo - Research

**Researched:** 2026-05-18
**Domain:** React UI — snapshot history list + two-snapshot side-by-side comparison
**Confidence:** HIGH (all findings from direct codebase inspection)

---

## Summary

Phase 7 adds a "Histórico" tab to the existing `MLPrecificacao` page so users can browse all
saved analysis snapshots for a product and compare any two of them side by side. The backend
data layer is complete: `useAnalysisSnapshots.fetchSnapshots(itemId, orgId)` already returns the
full snapshot array ordered by `created_at DESC`.

The main design work is UI-only:
1. A third tab entry in `MLPrecificacao.tsx` rendered alongside "Simulador" and "Análise".
2. A new page component (`HistoricoComparativo`) that owns a product-selector, a snapshot list
   with checkbox-based dual selection, and a conditional comparison panel.
3. No new hooks, no Supabase changes, no new library installs are needed.

**Primary recommendation:** Add a "Histórico" tab in `MLPrecificacao.tsx`. Render the new
`HistoricoComparativo` component there. Reuse the same Popover/Command product-selector pattern
from `AnaliseDashboard`. Show snapshots in a Table with one checkbox column; enforce exactly-2
selection in component state. Render the comparison below the table only when exactly 2 are
selected.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tab navigation | Frontend (MLPrecificacao page) | — | Tab state already lives in the page component |
| Product selection | Frontend (HistoricoComparativo) | — | Reads `useMLPrecosCustos` items; no server query needed |
| Snapshot list fetch | Frontend hook (useAnalysisSnapshots) | Supabase | `fetchSnapshots` already exists and is correct |
| Snapshot list display | Frontend (HistoricoSnapshotTable) | — | Pure render, no server state |
| Two-snapshot selection | Frontend component state | — | Local `Set<string>` of selected IDs |
| Side-by-side diff | Frontend (HistoricoComparacaoPanel) | — | Pure computation from two AnalysisSnapshot objects |

---

## Answers to Research Questions

### 1. Where does the History UI live?

**Decision: New "Histórico" tab in `MLPrecificacao.tsx`.**

Rationale from code inspection:

- `MLPrecificacao.tsx` is 51 lines. Adding a third entry to `TABS` and a third `{tab === "historico" && ...}` branch is a minimal, non-breaking change. [VERIFIED: codebase read]
- `AnaliseDashboard` is already large (315 lines with its own product selector, date inputs, fetch logic, and three sub-panels). Embedding snapshot history as an expandable section inside it would make the component unwieldy and conflate two different user intents (running a new analysis vs. browsing history).
- The new tab keeps the concerns fully separated: "Simulador" = pricing calculator, "Análise" = run new analysis, "Histórico" = browse/compare past runs.

**Change required in `MLPrecificacao.tsx`:**

```tsx
// Before
const TABS = [
  { id: "simulador", label: "Simulador" },
  { id: "analise",   label: "Análise" },
] as const;

// After
const TABS = [
  { id: "simulador",  label: "Simulador" },
  { id: "analise",    label: "Análise" },
  { id: "historico",  label: "Histórico" },
] as const;
```

Add one import and one render branch:

```tsx
import { HistoricoComparativo } from "@/components/mercadolivre/analise/HistoricoComparativo";
// ...
{tab === "historico" && <HistoricoComparativo />}
```

[VERIFIED: MLPrecificacao.tsx read directly]

---

### 2. Product Selection Pattern

**Reuse the Popover/Command pattern from `AnaliseDashboard`.**

`AnaliseDashboard` and `SimuladorPrecificacao` both use identical product-selector blocks:
- `useMLPrecosCustos()` for the item list
- `Popover` + `PopoverTrigger` + `Command` + `CommandInput` + `CommandList`
- A "selected" state that shows title + item_id with a clear button
- `filteredItems` memo sliced to 50

[VERIFIED: AnaliseDashboard.tsx lines 69-240, SimuladorPrecificacao.tsx lines 254-382]

`HistoricoComparativo` should duplicate this exact pattern (no abstraction needed yet; both
existing usages are already duplicated without a shared component). When `itemId` is set, the
component immediately calls `fetchSnapshots(itemId, orgId)`.

---

### 3. Snapshot List UX — Table with what columns

**Use `Table` (existing `src/components/ui/table.tsx`), not cards.**

Cards work for 1-3 items (see `AnalysisProductCard`). For a history list that could have 10-30
entries, a table with a fixed header is scannable and allows compact rows.

[VERIFIED: table.tsx exports Table, TableHeader, TableBody, TableRow, TableHead, TableCell]

**Recommended columns:**

| Column | Source field | Notes |
|--------|-------------|-------|
| (checkbox) | local state | Covered in Q4 |
| Data | `snapshot.createdAt` | Format: `dd/MM/yyyy HH:mm` using `date-fns/format` |
| Período | `snapshot.periodStart` → `snapshot.periodEnd` | `"01/01 – 31/01/2025"` |
| Preço GMV | `snapshot.priceGmv` | `formatBRL()` from `@/lib/pricing/calculator` |
| Preço Neutro | `snapshot.priceNeutral` | `formatBRL()` |
| Preço Margem | `snapshot.priceMargin` | `formatBRL()` |
| Elasticidade | `snapshot.elasticityClass` | Reuse `ELASTICITY_BADGE` pattern from `AnalisePrecosTable` |

This mirrors the columns already in `AnalisePrecosTable` minus the "Estratégia" select (irrelevant
for historical browse) and adds the date/period columns needed by HIST-02 requirement 1.

[VERIFIED: AnalysisSnapshot interface in useAnalysisSnapshots.ts lines 21-37; AnalisePrecosTable.tsx column headers]

---

### 4. Two-Snapshot Selection Mechanism

**Checkbox per row with enforced max-2 selection via local state.**

Pattern:

```tsx
const [selected, setSelected] = useState<[string, string] | [string] | []>([]);

function toggleSelect(id: string) {
  setSelected((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id) as typeof prev;
    if (prev.length >= 2) return prev; // silently ignore 3rd selection
    return [...prev, id] as typeof prev;
  });
}
```

UX details:
- Checkbox in first column of each row (`<input type="checkbox" />` styled with `accent-primary`
  — same pattern used by the promo price toggle in `SimuladorPrecificacao.tsx` line 650).
- When 2 are already selected and user hovers a third row, that row's checkbox shows as disabled
  (`disabled` attribute). This communicates "you already have 2" without a toast.
- A small helper text below the table: `"Selecione 2 análises para comparar"` changes to
  `"2 análises selecionadas"` once both are chosen.
- The comparison panel renders below the table when `selected.length === 2`.

[VERIFIED: SimuladorPrecificacao.tsx line 650 for checkbox pattern; AnalysisSnapshot type for id field]

---

### 5. Side-by-Side Comparison Layout

**Two-column CSS grid (`grid grid-cols-2 gap-4`) inside a Card.**

Each column is a mini snapshot summary. A center column or row-based diff section shows the delta.

**Recommended structure:**

```
┌──────────────────────────────────────────────────────────────────┐
│ Comparação                                           [✕ Limpar]  │
├────────────────────────────┬─────────────────────────────────────┤
│  Snapshot A                │  Snapshot B                         │
│  dd/MM/yyyy                │  dd/MM/yyyy                         │
│  Período: 01/01 – 31/01    │  Período: 01/02 – 28/02            │
├────────────────────────────┼─────────────────────────────────────┤
│  Preço GMV    R$ 89,90     │  Preço GMV    R$ 94,90  ▲ R$ 5,00  │
│  Preço Neutro R$ 94,90     │  Preço Neutro R$ 99,90  ▲ R$ 5,00  │
│  Preço Margem R$ 99,90     │  Preço Margem R$104,90  ▲ R$ 5,00  │
├────────────────────────────┼─────────────────────────────────────┤
│  Elasticidade: Baixa       │  Elasticidade: Média    (mudou)     │
│  elasticityPct: 3,2%       │  elasticityPct: 8,7%    ▲ 5,5 p.p. │
└────────────────────────────┴─────────────────────────────────────┘
```

**Delta display rules:**

| Field | Delta type | Format |
|-------|-----------|--------|
| priceGmv / priceNeutral / priceMargin | absolute R$ diff | `▲ R$ 5,00` / `▼ R$ 5,00` in `text-emerald-600` / `text-destructive` |
| elasticityPct | percentage-point diff | `▲ 5,5 p.p.` |
| elasticityClass | class change | Show old badge + new badge side by side; if changed, small `(mudou)` label |

Delta is always B − A (B = the more recent snapshot by `createdAt`). Sort the two selected
snapshots by `createdAt` ascending so A is always older.

**Reuse existing primitives:**
- `Badge` with `ELASTICITY_BADGE` classes — already defined in `AnalisePrecosTable.tsx` and
  `AnalysisProductCard.tsx`. Extract to `src/lib/analysis/elasticityConfig.ts` so both the
  table and the comparison panel can import it without duplication. [ASSUMED — extraction is
  a local refactor decision, not blocked by any external constraint]
- `formatBRL` from `@/lib/pricing/calculator`
- `format` from `date-fns` (already imported via `differenceInCalendarDays` in `AnaliseDashboard`)

[VERIFIED: AnalysisProductCard.tsx and AnalisePrecosTable.tsx both define identical ELASTICITY_BADGE constant]

---

### 6. Recommended Component Breakdown

All new files live inside `src/components/mercadolivre/analise/`.

```
src/
├── pages/mercadolivre/
│   └── MLPrecificacao.tsx               ← EDIT: add "Histórico" tab + import
│
├── components/mercadolivre/analise/
│   ├── HistoricoComparativo.tsx          ← NEW: page-level container (product selector + orchestration)
│   ├── HistoricoSnapshotTable.tsx        ← NEW: Table with checkbox column; receives snapshots + selection state
│   └── HistoricoComparacaoPanel.tsx      ← NEW: two-column diff panel; receives exactly 2 snapshots
│
└── lib/analysis/
    └── elasticityConfig.ts              ← NEW (optional refactor): shared ELASTICITY_BADGE constant
                                            (avoids duplication across AnalisePrecosTable,
                                             AnalysisProductCard, and the new comparison panel)
```

**Component responsibilities:**

`HistoricoComparativo` (container):
- Owns `itemId`, `productTitle`, `searchOpen`, `searchQuery` state (product selector)
- Owns `snapshots: AnalysisSnapshot[]` state, calls `fetchSnapshots` on itemId change
- Owns `selected: string[]` state (max 2 IDs)
- Renders: product selector card → `HistoricoSnapshotTable` → `HistoricoComparacaoPanel`

`HistoricoSnapshotTable` (presentational):
- Props: `snapshots`, `selected: string[]`, `onToggle: (id: string) => void`, `loading: boolean`
- Renders the Table with columns described in Q3
- Handles the "3rd selection disabled" logic via props

`HistoricoComparacaoPanel` (presentational):
- Props: `snapshotA: AnalysisSnapshot`, `snapshotB: AnalysisSnapshot`, `onClear: () => void`
- Renders the two-column grid with deltas
- No state of its own

[VERIFIED: component split based on reading all four existing analise/ components]

---

### 7. Hook Changes Needed

**None.**

`fetchSnapshots(itemId: string, orgId: string): Promise<AnalysisSnapshot[]>` already:
- Filters by `item_id` and `organization_id` [VERIFIED: useAnalysisSnapshots.ts lines 117-131]
- Orders by `created_at DESC` [VERIFIED: useAnalysisSnapshots.ts line 124]
- Returns fully typed `AnalysisSnapshot[]` with all fields needed for the list and comparison

`HistoricoComparativo` can call `fetchSnapshots` directly from `useAnalysisSnapshots()`, the same
way `AnaliseDashboard` does. No new parameters, no new Supabase queries.

---

## Standard Stack

### Core (all already in project)
| Library | Purpose | Status |
|---------|---------|--------|
| `react` + `typescript` | Component authoring | Already installed |
| `@/components/ui/table` | Snapshot list table | Already exists [VERIFIED: table.tsx] |
| `@/components/ui/card` | Container cards | Already exists [VERIFIED: card.tsx] |
| `@/components/ui/badge` | Elasticity class badges | Already exists [VERIFIED: badge.tsx] |
| `date-fns` | Date formatting (`format`) | Already imported in AnaliseDashboard [VERIFIED] |
| `formatBRL` from `@/lib/pricing/calculator` | Currency display | Already used in all analise components |
| `useAnalysisSnapshots` | Data fetch | Already exists, no changes needed |
| `useMLPrecosCustos` | Product list for selector | Already used in AnaliseDashboard |
| `Popover/Command` from `@/components/ui/` | Product search | Already used twice in the codebase |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── components/mercadolivre/analise/
│   ├── AnaliseDashboard.tsx         (existing)
│   ├── AnalisePrecosTable.tsx       (existing)
│   ├── AnalysisProductCard.tsx      (existing)
│   ├── CompraRecomendadaPanel.tsx   (existing)
│   ├── HistoricoComparativo.tsx     (NEW — container)
│   ├── HistoricoSnapshotTable.tsx   (NEW — list)
│   └── HistoricoComparacaoPanel.tsx (NEW — diff panel)
├── lib/analysis/
│   ├── types.ts                     (existing)
│   ├── engine.ts                    (existing)
│   └── elasticityConfig.ts          (NEW — optional shared constants)
└── pages/mercadolivre/
    └── MLPrecificacao.tsx           (EDIT — add tab)
```

### Pattern: Tab Registration (MLPrecificacao)
```tsx
// [VERIFIED: MLPrecificacao.tsx lines 7-12]
const TABS = [
  { id: "simulador",  label: "Simulador"  },
  { id: "analise",    label: "Análise"    },
  { id: "historico",  label: "Histórico"  }, // ADD THIS
] as const;

type TabId = typeof TABS[number]["id"];
```

### Pattern: Fetch-on-product-select (from AnaliseDashboard)
```tsx
// [VERIFIED: AnaliseDashboard.tsx lines 93-101]
useEffect(() => {
  if (!itemId || !orgId) return;
  fetchSnapshots(itemId, orgId).then(setSnapshots).catch((err) => {
    toast({ variant: "destructive", title: "Erro ao carregar análises", description: err.message });
  });
}, [itemId, orgId]); // eslint-disable-line react-hooks/exhaustive-deps
```

### Pattern: Two-Selection State
```tsx
const [selected, setSelected] = useState<string[]>([]);

function toggleSelect(id: string) {
  setSelected((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id);
    if (prev.length >= 2) return prev; // reject 3rd
    return [...prev, id];
  });
}

// Derive sorted pair for comparison
const comparisonPair = useMemo((): [AnalysisSnapshot, AnalysisSnapshot] | null => {
  if (selected.length !== 2) return null;
  const [a, b] = selected
    .map((id) => snapshots.find((s) => s.id === id)!)
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt)); // oldest first
  return [a, b];
}, [selected, snapshots]);
```

### Pattern: Price Delta Display
```tsx
// Source: derived from AnalisePrecosTable.tsx STRATEGY_CELL_CLASSES pattern [VERIFIED]
function PriceDelta({ a, b }: { a: number; b: number }) {
  const delta = b - a;
  if (delta === 0) return <span className="text-muted-foreground">—</span>;
  const color = delta > 0 ? "text-emerald-600" : "text-destructive";
  const arrow = delta > 0 ? "▲" : "▼";
  return (
    <span className={`text-xs tabular-nums ${color}`}>
      {arrow} {formatBRL(Math.abs(delta))}
    </span>
  );
}
```

### Anti-Patterns to Avoid
- **Fetching snapshots per-render:** The fetch must be in `useEffect` gated on `[itemId, orgId]`,
  not triggered by selection changes or re-renders.
- **Allowing >2 selections silently:** The third checkbox must appear `disabled` (not just ignored
  on click) to give clear visual feedback.
- **Duplicating ELASTICITY_BADGE constant a third time:** Extract to `elasticityConfig.ts` rather
  than copying the object into yet another component.
- **Sorting by `createdAt` string lexicographically when dates are ISO strings:** ISO 8601 strings
  sort correctly with `.localeCompare()`, but verify the `createdAt` field format is always ISO
  (confirmed: `row.created_at` from Supabase is ISO 8601). [VERIFIED: useAnalysisSnapshots.ts line 55]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Product search dropdown | Custom input+filter | Existing Popover/Command pattern | Already battle-tested in 2 components; consistent UX |
| Currency formatting | Manual `toFixed(2)` + "R$" | `formatBRL` from `@/lib/pricing/calculator` | Handles edge cases, already imported everywhere |
| Date formatting | Manual string slicing | `format` from `date-fns` | Locale-aware, already a project dependency |
| Elasticity badge styling | New CSS classes | Existing `ELASTICITY_BADGE` config | Consistent visual language across all analysis views |

---

## Common Pitfalls

### Pitfall 1: Stale Snapshot List After New Analysis in "Análise" Tab
**What goes wrong:** User runs a new analysis in the "Análise" tab, switches to "Histórico",
but the history list does not include the new snapshot.
**Why it happens:** `HistoricoComparativo` fetches on mount / `itemId` change, not on tab focus.
If the user switches tabs and the same `itemId` is still selected, no re-fetch triggers.
**How to avoid:** Add `tab` to `HistoricoComparativo`'s fetch effect or reset the snapshots list
when the component mounts (use a `key` prop tied to the tab). Alternatively, re-fetch on tab
activation by passing a `refreshKey` prop incremented in `MLPrecificacao` when the `analise` tab
is used. The simplest approach: give `HistoricoComparativo` a `key={refreshKey}` from the parent.
**Warning signs:** Snapshot count in Histórico tab does not match count visible in Análise tab.

### Pitfall 2: `selected` IDs Become Stale After Product Change
**What goes wrong:** User selects 2 snapshots, then changes the product. `selected` still holds
IDs from the previous product's snapshots.
**Why it happens:** `setSnapshots([])` on product clear resets the list but not `selected`.
**How to avoid:** Call `setSelected([])` alongside `setSnapshots([])` in the `clearProduct`
function.

### Pitfall 3: `date-fns/format` Not Imported with the Right Token
**What goes wrong:** `format(new Date(snapshot.createdAt), "dd/MM/yyyy HH:mm")` throws if
`createdAt` is a Postgres timestamp string with timezone (`2025-01-15T14:32:00+00:00`).
**How to avoid:** Pass through `new Date()` constructor which handles ISO 8601 with timezone.
Already demonstrated in `AnaliseDashboard.tsx` line 108 with `new Date(dateTo)`. [VERIFIED]

### Pitfall 4: Table Overflow on Narrow Screens
**What goes wrong:** The Table component wraps in `overflow-auto`, but the two-column comparison
panel uses `grid grid-cols-2` which does not collapse on mobile.
**How to avoid:** Use `grid grid-cols-1 md:grid-cols-2` for the comparison panel so it stacks
vertically on mobile.

---

## Runtime State Inventory

Not applicable — this is a greenfield UI phase with no renames, no data migrations, and no
changes to stored data shape.

---

## Environment Availability

No new external dependencies. All tools are already in the project.

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| `date-fns` | Date formatting | Already installed | `differenceInCalendarDays` used in AnaliseDashboard |
| `@/components/ui/*` | UI primitives | Already exists | table, card, badge all verified |
| Supabase client | `useAnalysisSnapshots` | Already configured | No new queries |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Not detected — no test config files found in project scan |
| Config file | None found |
| Quick run | N/A |
| Full suite | N/A |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Notes |
|--------|----------|-----------|-------|
| HIST-02 (1) | Snapshot list shows date, period, strategic prices | Manual smoke test | Render HistoricoSnapshotTable with mock snapshots |
| HIST-02 (2) | Two-snapshot comparison shows price deltas and elasticity class diff | Manual smoke test | Render HistoricoComparacaoPanel with two mock AnalysisSnapshot objects |

No automated test infrastructure detected. Manual verification is the current project standard.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Extracting `ELASTICITY_BADGE` to `elasticityConfig.ts` is a safe refactor | Component Breakdown | Low risk — if skipped, duplicate the constant in the new component instead |
| A2 | No automated test framework is present in the project | Validation Architecture | Low risk — if tests exist, add unit tests for `toggleSelect` logic and delta computation |

---

## Open Questions

1. **Should "Histórico" tab re-fetch when switching back from "Análise"?**
   - What we know: `HistoricoComparativo` will fetch on `itemId` change but not on tab focus.
   - What's unclear: Whether the UX requirement implies always-fresh data on tab switch.
   - Recommendation: Pass `refreshKey` prop (incremented on each `saveSnapshot` in `AnaliseDashboard`)
     from `MLPrecificacao` to `HistoricoComparativo` as a `key` prop. This triggers a remount and
     fresh fetch whenever a new snapshot is saved.

2. **Should the product selector in "Histórico" default to the same product selected in "Análise"?**
   - What we know: Both tabs currently manage their own independent `itemId` state.
   - What's unclear: Whether the product selection should be shared at the page level.
   - Recommendation: For Phase 7 keep them independent (simpler). Shared state can be lifted in a
     future phase if users report friction.

---

## Sources

### Primary (HIGH confidence — verified from codebase)
- `src/pages/mercadolivre/MLPrecificacao.tsx` — tab structure, TABS constant, AnimatePresence pattern
- `src/components/mercadolivre/analise/AnaliseDashboard.tsx` — product selector, fetchSnapshots usage, snapshots state
- `src/hooks/useAnalysisSnapshots.ts` — AnalysisSnapshot interface, fetchSnapshots signature and Supabase query
- `src/lib/analysis/types.ts` — ElasticityClass, PriceBucket, AnalysisResult types
- `src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx` — product selector pattern, checkbox pattern
- `src/components/mercadolivre/analise/AnalisePrecosTable.tsx` — ELASTICITY_BADGE config, STRATEGY_CELL_CLASSES, Table usage
- `src/components/mercadolivre/analise/AnalysisProductCard.tsx` — ELASTICITY_BADGE config, price display pattern
- `src/components/ui/table.tsx` — Table, TableHeader, TableBody, TableRow, TableHead, TableCell exports
- `src/components/ui/card.tsx` — Card, CardContent, CardHeader, CardTitle, CardDescription exports
- `src/components/ui/badge.tsx` — Badge, badgeVariants exports

### Tertiary (LOW confidence — assumptions)
- A1: `elasticityConfig.ts` extraction is a clean refactor (not verified against a project style guide)
- A2: No automated tests present (inferred from absence of test config files)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified from imports in existing source files
- Architecture: HIGH — component structure derived from reading all existing analise/ components
- Hook changes: HIGH — fetchSnapshots signature verified line-by-line
- Pitfalls: MEDIUM — derived from code reasoning, not from observed production failures

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (stable codebase, no external dependencies changing)
