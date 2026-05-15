# Phase 3 Research — Catálogo + Qualidade (Tax Integration & Tests)

**Date:** 2026-05-15
**Goal:** Integrate tax data into MLProdutos.tsx (CATALOG-01/02/03) and add unit tests for tax logic (QA-01).

---

## 1. MLProdutos.tsx — Current State

**File:** `src/pages/mercadolivre/MLProdutos.tsx`
**Size:** 1875 lines

### Overall Structure

- Lines 1–42: Imports
- Lines 53–100: Financial helper functions (`getCommissionRate`, `getListingLabel`, `currencyFmt` local)
- Lines 158–226: `InlineEditCell` component (inline-editable table cell)
- Lines 544–983: Main component body (state, hooks, callbacks, data derivation)
- Lines 984–end: JSX render, two tabs: "Catálogo" and "Relatórios"

### Local Currency Formatter (NOT the canonical one)

MLProdutos.tsx defines its own formatter at line 69 — **does not import from `src/lib/formatters.ts`**:

```ts
const currencyFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
```

The canonical formatter is `formatCurrency` from `@/lib/formatters`. Phase 3 should use `currencyFmt` to stay consistent with the rest of the file (or import `formatCurrency` — see ambiguity note below).

### Impostos Column Header (line 1141–1148)

```tsx
<TableHead className="text-xs text-right w-24">
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="cursor-help border-b border-dashed border-muted-foreground/40">Impostos</span>
    </TooltipTrigger>
    <TooltipContent className="text-xs max-w-[200px]">Alíquota de imposto sobre a receita (ex: 15%). Clique para editar.</TooltipContent>
  </Tooltip>
</TableHead>
```

**CATALOG-03 change:** Replace the TooltipContent text with the required disclaimer:
> "Estimativa baseada no regime tributário configurado em Fiscal. Não considere créditos de entrada. Consulte seu contador."

### Impostos Cell — Current Implementation (lines 1255–1261)

The Impostos cell currently renders an `InlineEditCell` (user-editable tax_rate field):

```tsx
<TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
  <InlineEditCell
    value={taxRate}
    format="percent"
    onSave={async (v) => { const prev = costs.get(item.id); await upsertCost(item.id, prev?.cost ?? null, v); }}
  />
</TableCell>
```

Where `taxRate = productCost?.tax_rate ?? null` from `useMLProductCosts()`.

**CATALOG-01 change:** Replace this cell. The new display logic:
1. Prefer `effective_rate` from `useMLTaxConfig` (keyed by `item._ml_user_id`)
2. Fallback to `productCost?.tax_rate` (manual rate from `ml_product_costs`)
3. Display `—` if neither is configured
4. Format: `R$ X,XX (Y,Y%)`

The same Impostos column also appears in the **variations sub-table** (line 1352–1396). Currently it shows `↑ item` placeholders for variation rows:
```tsx
<TableCell className="py-2 text-right text-xs text-muted-foreground italic">↑ item</TableCell>
<TableCell className="py-2 text-right text-xs text-muted-foreground italic">↑ item</TableCell>
```
Phase 3 should update this too (it applies the parent item's tax data for the variation's price).

### Tax Calculation (current pattern, lines 1232–1243)

```ts
const productCost = costs.get(item.id);
const cost = productCost?.cost ?? null;
const taxRate = productCost?.tax_rate ?? null;
const commCached = commCache.get(item.id);
const commRate = commCached ? commCached.pct / 100 : getCommissionRate(item.listing_type_id);
const commission = commCached?.amount ?? (item.price * commRate);
const taxAmount = taxRate != null ? item.price * (taxRate / 100) : null;
const marginLiq = cost != null && item.price > 0
  ? ((item.price - cost - commission - (taxAmount ?? 0)) / item.price) * 100 : null;
```

**CATALOG-01 change:** The `taxRate` variable needs to be resolved from `taxMap` (from `useMLTaxConfig`) first, then fallback to `productCost?.tax_rate`. The `taxAmount` calculation stays the same once `taxRate` is resolved.

### useMLProductCosts Return Shape

From `src/hooks/useMLProductCosts.ts`:
```ts
interface ProductCost {
  item_id: string;
  cost: number | null;
  tax_rate: number | null;   // manual per-item rate, percent (e.g. 15 = 15%)
}
// returns { costs: Map<string, ProductCost>, loading: boolean, upsert }
```

### Product Row — ml_user_id Availability

Each inventory item has `_ml_user_id?: string` (populated during fetch, line 111 in `MLInventoryContext.tsx`). In the table body:

```ts
// item._ml_user_id is available on each product row
// Confirmed usage at line 847 and 1672:
_ml_user_id: i._ml_user_id,
// and:
{selectedStore === "all" && r._ml_user_id && (() => {
  const storeIdx = stores.findIndex((s) => s.ml_user_id === r._ml_user_id);
```

So `item._ml_user_id` is the key to look up the tax config in the `taxMap`.

---

## 2. useMLTaxConfig Integration

**File:** `src/hooks/useMLTaxConfig.ts`

```ts
export interface MLTaxConfigEntry {
  regime: string;
  effective_rate: number;  // percent, e.g. 15.5 = 15.5%
}

export function useMLTaxConfig(mlUserIds: string[], orgId: string):
  UseQueryResult<Map<string, MLTaxConfigEntry>>
```

- Returns a `Map<ml_user_id, MLTaxConfigEntry>` via react-query
- `effective_rate` is already computed by DB trigger (sum of components by regime)
- For `lucro_real`: effective_rate may be negative when credits > debits — **clamp to 0 at display layer**
- `enabled` only when `mlUserIds.length > 0 && !!orgId`

### Where to Get mlUserIds and orgId in MLProdutos

From `useMLStore()` (already called at line 546):
```ts
const { selectedStore, stores, sellerId, resolvedMLUserIds, scopeKey } = useMLStore();
```

- `resolvedMLUserIds` — array of active `ml_user_id` strings (all stores in scope)
- Use this as `mlUserIds` for `useMLTaxConfig`

For `orgId`, MLProdutos does **not** currently import `useOrganization`. Pattern from `MLFiscal.tsx`:
```ts
import { useOrganization } from "@/contexts/OrganizationContext";
// in component:
const { currentOrg } = useOrganization();
const orgId = currentOrg?.id ?? null;
```

Then call:
```ts
const { data: taxMap } = useMLTaxConfig(resolvedMLUserIds, orgId ?? "");
```

---

## 3. Tax Formulas (for QA-01 unit tests)

From `supabase/migrations/20260515120000_ml_tax_config.sql`:

### Simples Nacional
```
effective_rate = COALESCE(sn_aliquota_efetiva, 0)
```
i.e., the user-entered effective rate directly.

### Lucro Presumido
```
effective_rate = lp_pis + lp_cofins + lp_irpj + lp_csll   (all COALESCEd to 0)
```
Sum of PIS + COFINS + IRPJ + CSLL.

### Lucro Real
```
effective_rate = (lr_pis_debito + lr_cofins_debito + lr_icms_debito)
              - (lr_pis_credito + lr_cofins_credito + lr_icms_credito)
```
Debits minus credits. **Result may be negative** (credits > debits).

---

## 4. Test Framework

**Runner:** Vitest 3.2.4 (script: `vitest run` / `vitest`)
**Config:** `vitest.config.ts`

```ts
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,                                   // describe/it/expect available without import
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

**Key points:**
- `globals: true` — no need to import `describe`, `it`, `expect` from vitest explicitly
- Path alias `@` resolves to `src/`
- Test setup: `src/test/setup.ts` (imports `@testing-library/jest-dom`, mocks `matchMedia`)
- Test output target: `src/lib/tax/index.test.ts`

**Existing test example** (`src/test/example.test.ts`):
```ts
import { describe, it, expect } from "vitest";

describe("example", () => {
  it("should pass", () => {
    expect(true).toBe(true);
  });
});
```

Note: Although `globals: true`, the example file imports from vitest explicitly. Either style works.

**No `src/lib/tax/` directory exists yet** — must be created. The test file goes at:
`src/lib/tax/index.test.ts`

The implementation module to be tested goes at:
`src/lib/tax/index.ts`

---

## 5. Currency Formatting

### Canonical Utility (`src/lib/formatters.ts`)

```ts
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "R$ 0,00";
  return BRL.format(value);  // e.g. "R$ 1.234,56"
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value == null || !Number.isFinite(value)) return "0%";
  return `${value.toFixed(fractionDigits)}%`;  // e.g. "15,5%"
}
```

### Local formatter in MLProdutos.tsx (line 69)
```ts
const currencyFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
```
Used throughout MLProdutos for all currency display.

### Required format for CATALOG-01
`R$ X,XX (Y,Y%)` — e.g. `R$ 15,00 (15,0%)`

Suggested implementation using the local formatter:
```ts
const taxAmount = item.price * (effectiveTaxRate / 100);
const display = `${currencyFmt(taxAmount)} (${effectiveTaxRate.toFixed(1).replace(".", ",")}%)`;
```

Note: Brazilian locale uses comma as decimal separator. `toFixed(1)` gives `"15.0"` — needs `.replace(".", ",")` OR use `toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })`.

---

## 6. Tooltip Pattern in Table Columns

### Current tooltip on column header (line 1133–1148)
```tsx
<TableHead className="text-xs text-right w-28">
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="cursor-help border-b border-dashed border-muted-foreground/40">Custo</span>
    </TooltipTrigger>
    <TooltipContent className="text-xs max-w-[200px]">Custo do produto (CMV). Clique na célula para editar.</TooltipContent>
  </Tooltip>
</TableHead>
```

The `Tooltip`, `TooltipContent`, `TooltipTrigger` are already imported at line 36:
```ts
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```

**CATALOG-03:** Replace existing `Impostos` tooltip content (line 1146) with:
```tsx
<TooltipContent className="text-xs max-w-[220px]">
  Estimativa baseada no regime tributário configurado em Fiscal. Não considere créditos de entrada. Consulte seu contador.
</TooltipContent>
```

---

## 7. Navigation / Links

### Link already imported (line 33)
```ts
import { Link } from "react-router-dom";
```

### Existing usage pattern in MLProdutos (line 977)
```tsx
<Button asChild><Link to="/integracoes">Ir para Integrações</Link></Button>
```

**CATALOG-02 banner link:** `<Link to="/fiscal">` will work with the same pattern.

---

## 8. Banner/Alert Pattern

### MLProdutos.tsx — existing inline banner (lines 323–334)
Uses a custom div, NOT `<Alert>` component:
```tsx
<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
  <div>
    <p className="text-sm font-medium text-amber-800">Sem referência disponível</p>
    <p className="text-xs text-amber-700 mt-1">...</p>
  </div>
</div>
```

`AlertCircle` is already imported from `lucide-react` (line 29).

### MLFiscal.tsx — uses `<Alert>` component (line 481)
```tsx
<Alert className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
  <Info className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
  <AlertDescription className="text-xs leading-relaxed">
    Os valores de impostos exibidos são estimativas...
  </AlertDescription>
</Alert>
```

**CATALOG-02 recommendation:** Use the custom div pattern (consistent with MLProdutos), OR import and use `<Alert>` (consistent with MLFiscal). Either works. The banner should:
- Appear in the "catalogo" tab, above or inside the Card that wraps the table
- Include a `<Link to="/fiscal">` to configure
- Only render when at least one active store has no `ml_tax_config`

**Banner placement:** The best location is inside the `<TabsContent value="catalogo">` block, between the KPI cards and the Filters+Table Card (after line 1026, before line 1029).

**Logic to detect unconfigured stores:**
```ts
const unconfiguredStores = stores.filter(
  (s) => !taxMap?.has(s.ml_user_id)
);
const showTaxBanner = !!taxMap && unconfiguredStores.length > 0;
```

---

## 9. Summary of Changes Required

### CATALOG-01: Tax column display
- Location: Lines 1255–1261 (main item row) and 1395–1396 (variation row)
- Add `useOrganization` import and call
- Add `useMLTaxConfig(resolvedMLUserIds, orgId ?? "")` call
- In the render IIFE at line 1232, resolve `effectiveTaxRate`:
  ```ts
  const taxEntry = item._ml_user_id ? taxMap?.get(item._ml_user_id) : undefined;
  const effectiveTaxRate = taxEntry != null
    ? Math.max(0, taxEntry.effective_rate)  // clamp negative lucro_real
    : (productCost?.tax_rate ?? null);
  ```
- Replace `<InlineEditCell value={taxRate} format="percent" .../>` with a read-only display cell:
  ```tsx
  <TableCell className="text-right">
    {effectiveTaxRate != null ? (
      <span className="text-xs font-mono tabular-nums">
        {currencyFmt(item.price * (effectiveTaxRate / 100))} ({effectiveTaxRate.toFixed(1).replace(".", ",")}%)
      </span>
    ) : (
      <span className="text-xs text-muted-foreground/40">—</span>
    )}
  </TableCell>
  ```
- For variations: same logic using `v.price` instead of `item.price`

### CATALOG-02: Banner
- Insert after KPI grid, before filters Card
- Condition: `taxMap && stores.some(s => !taxMap.has(s.ml_user_id))`
- Include link to `/fiscal`

### CATALOG-03: Tooltip text
- Line 1146: replace existing tooltip text

### QA-01: Tests at `src/lib/tax/index.ts` + `src/lib/tax/index.test.ts`

**Functions to implement in `src/lib/tax/index.ts`:**
```ts
type Regime = "simples_nacional" | "lucro_presumido" | "lucro_real";

interface TaxInput {
  regime: Regime;
  sn_aliquota_efetiva?: number | null;
  lp_pis?: number | null;
  lp_cofins?: number | null;
  lp_irpj?: number | null;
  lp_csll?: number | null;
  lr_pis_debito?: number | null;
  lr_pis_credito?: number | null;
  lr_cofins_debito?: number | null;
  lr_cofins_credito?: number | null;
  lr_icms_debito?: number | null;
  lr_icms_credito?: number | null;
}

export function calculateEffectiveRate(input: TaxInput): number
// mirrors the DB trigger logic

export function clampEffectiveRate(rate: number): number
// Math.max(0, rate) — clamp for lucro_real negative case

export function computeTaxAmount(price: number, effectiveRatePct: number): number
// price * (effectiveRatePct / 100)
```

---

## 10. Ambiguities / Decisions for Planner

### A. Keep InlineEditCell for Impostos or make read-only?
CATALOG-01 spec says "exibe R$ X,XX (Y,Y%)" — implies read-only display driven by tax config. The current cell is `InlineEditCell` (user can manually enter a rate). Decision: **Replace with read-only cell**. The manual `tax_rate` on `ml_product_costs` becomes a fallback only when no `ml_tax_config` exists. This removes the ability to manually edit the tax rate from the catalog view. If manual editing should be preserved alongside the fiscal config, the UX needs to be re-thought (e.g., show InlineEditCell only when no fiscal config is set).

### B. `currencyFmt` vs `formatCurrency` import
MLProdutos.tsx uses its own `currencyFmt` locally and does NOT import from `src/lib/formatters`. Recommendation: continue using `currencyFmt` for consistency. If the team wants to migrate to canonical formatter, that should be a separate PR.

### C. Percent formatting: comma vs dot
`toFixed(1)` produces `"15.0"` (dot). Brazilian convention is comma: `"15,0"`. Need `.replace(".", ",")` OR use `toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })`. The existing codebase uses both approaches. Recommend `toLocaleString` for robustness.

### D. Banner placement: exact pixel position
The banner could go: (a) between KPIs and the Card (most visible), or (b) inside the Card header. Option (a) is recommended for visibility.

### E. Test file uses explicit imports or relies on globals?
`globals: true` in vitest.config.ts means globals are available. The existing example.test.ts imports explicitly (`import { describe, it, expect } from "vitest"`). Either is fine — recommendation: use explicit imports for IDE type inference.

### F. Should `calculateEffectiveRate` live in `src/lib/tax/index.ts` or be inlined?
The spec requires `src/lib/tax/index.test.ts` — so an implementation module is needed. The test file tests the formulas as pure functions. The MLProdutos component uses `effective_rate` from the DB (already computed), so it doesn't call `calculateEffectiveRate` directly. The lib function exists purely for testability documentation.

### G. Variation row tax display
Variation rows currently show `↑ item` for Custo and Impostos (inheriting from parent item). The new Impostos cell for variations should compute `v.price * (effectiveTaxRate / 100)` where `effectiveTaxRate` is resolved from the parent item's `_ml_user_id`. The `taxEntry` lookup uses `item._ml_user_id` (same as parent), not the variation.
