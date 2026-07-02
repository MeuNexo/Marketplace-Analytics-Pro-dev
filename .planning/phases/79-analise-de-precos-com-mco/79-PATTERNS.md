# Phase 79: Análise de Preços com MCO - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 4 (1 migration, 2 new lib files, 1 modified component)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|---------------|
| `supabase/migrations/202606790000NN_orders_price_timeseries_mco.sql` | migration | CRUD (RPC aggregate) | `supabase/migrations/20260677000000_orders_price_timeseries.sql` (function being extended — self) + `supabase/migrations/20260615120000_margin_with_ads_rpc.sql` (template for cmv/comissao/frete/tax_amount columns) | exact (self) / role-match (template) |
| `src/lib/precoMcoSeries.ts` | utility | transform | `src/lib/mco.ts` | exact |
| `src/lib/precoMcoSeries.test.ts` | test | transform | `src/lib/mco.test.ts` | exact |
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` | component | request-response (RPC fetch + chart render) | itself (existing file, being edited in place) | exact |

Ads spend query (inline in `PrecoPraticadoReport.tsx` or a small hook) has no dedicated new file per CONTEXT.md — it's a direct Supabase query added inside the existing component's data-fetch `useEffect`, following the same shape as the existing RPC call in that file.

## Pattern Assignments

### `supabase/migrations/202606790000NN_orders_price_timeseries_mco.sql` (migration, CRUD/aggregate)

**Analog A (the function itself, being extended):** `supabase/migrations/20260677000000_orders_price_timeseries.sql` (60 lines, read in full)

Current full definition to extend (lines 13-55):
```sql
CREATE OR REPLACE FUNCTION public.orders_price_timeseries(
  _item_id      text,
  _ml_user_ids  text[] DEFAULT NULL,
  _from         date   DEFAULT NULL,
  _to           date   DEFAULT NULL,
  _granularity  text   DEFAULT 'day'
)
RETURNS TABLE(
  bucket       date,
  preco_medio  numeric,
  preco_min    numeric,
  preco_max    numeric,
  qtd          bigint,
  total        numeric,
  orders       bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    date_trunc(
      CASE
        WHEN lower(_granularity) IN ('week', 'month') THEN lower(_granularity)
        ELSE 'day'
      END,
      o.data_pedido::date   -- ADAPTAÇÃO: cast TEXT→date (nosso schema usa TEXT)
    )::date AS bucket,
    (SUM(o.receita_bruta) / NULLIF(SUM(o.quantidade), 0))::numeric AS preco_medio,
    MIN(o.preco_unit)::numeric  AS preco_min,
    MAX(o.preco_unit)::numeric  AS preco_max,
    SUM(o.quantidade)::bigint   AS qtd,
    SUM(o.receita_bruta)::numeric AS total,
    COUNT(*)::bigint             AS orders
  FROM orders o
  WHERE o.item_id = _item_id
    AND o.status IN ('paid', 'shipped', 'delivered')
    AND (_ml_user_ids IS NULL OR array_length(_ml_user_ids, 1) IS NULL OR o.ml_user_id = ANY(_ml_user_ids))
    AND (_from IS NULL OR o.data_pedido::date >= _from)
    AND (_to   IS NULL OR o.data_pedido::date <= _to)
  GROUP BY 1
  ORDER BY 1;
$function$;
```

**CRITICAL — cannot use `CREATE OR REPLACE` this time.** RESEARCH.md confirms Postgres
rejects `CREATE OR REPLACE` when `RETURNS TABLE` gains columns ("cannot change return
type of existing function"). Prepend:
```sql
DROP FUNCTION IF EXISTS public.orders_price_timeseries(text, text[], date, date, text);
CREATE FUNCTION public.orders_price_timeseries(...) RETURNS TABLE(..., cmv numeric, comissao numeric, frete numeric, qtd_sem_custo bigint, impostos numeric, qtd_sem_imposto bigint) ...
```
Note the current file uses `SET search_path TO 'public'` **without** an explicit
`SECURITY INVOKER` clause — INVOKER is Postgres's default when unspecified, so this is
already compliant with the anti-IDOR pattern; new migration should keep the same style
(no `SECURITY DEFINER`, no org param) — optionally make `SECURITY INVOKER` explicit for
clarity, matching CONTEXT.md's instruction to "MANTER SECURITY INVOKER".

**Analog B (template for new cmv/comissao/frete/tax_amount columns):** `supabase/migrations/20260615120000_margin_with_ads_rpc.sql` lines 44-71 (as quoted verbatim in RESEARCH.md):
```sql
SELECT
  o.item_id,
  COALESCE(SUM(o.receita_bruta), 0)                     AS receita,
  COALESCE(SUM(o.custo_unit * o.quantidade), 0)         AS cmv,
  COALESCE(SUM(o.comissao), 0)                          AS comissao,
  COALESCE(SUM(o.frete), 0)                             AS frete,
  COALESCE(SUM(o.tax_amount), 0)                        AS impostos,
  BOOL_OR(o.custo_unit IS NOT NULL)                     AS has_cmv
FROM public.orders o
WHERE o.organization_id = p_org_id
  AND o.ml_user_id = ANY(p_user_ids)
  AND o.status IN ('paid', 'shipped', 'delivered')
  AND o.data_pedido::date BETWEEN p_from AND p_to
GROUP BY o.item_id
```
Adapt: drop `organization_id`/`p_org_id` filter (this RPC has no org param — RLS does
the isolation), keep `GROUP BY 1` (the `date_trunc(...)::date` bucket expression, not
`item_id`), add `FILTER (WHERE o.custo_unit IS NULL)` / `FILTER (WHERE o.tax_amount IS
NULL)` for `qtd_sem_custo`/`qtd_sem_imposto` (`SUM(o.quantidade) FILTER (WHERE ...)`
pattern, no direct precedent needed — standard Postgres `FILTER` clause).

**Smoke checkpoint (from CONTEXT.md/RESEARCH.md):** run as `role authenticated` via MCP
`execute_sql`, compare 2-3 buckets against manual `SUM()` in SQL — do not trust `role
postgres` results (RLS is bypassed for postgres).

---

### `src/lib/precoMcoSeries.ts` (utility, transform)

**Analog:** `src/lib/mco.ts` (41 lines, read in full)

**Whole-file pattern to copy** (pure function, no I/O, JSDoc header explaining the
formula, named interfaces above the function):
```typescript
export interface McoInput {
  grossRevenue: number;
  cmv: number;
  platformCost: number;   // frete + comissão — exclui ads
  ads: number;
  tax: number;
}

export interface McoResult {
  mco: number;
  pct: number | null;     // null quando grossRevenue = 0
}

export function computeMco(input: McoInput): McoResult {
  const { grossRevenue, cmv, platformCost, ads, tax } = input;
  const mco = grossRevenue - cmv - platformCost - ads - tax;
  const pct = grossRevenue > 0 ? (mco / grossRevenue) * 100 : null;
  return { mco, pct };
}
```

**Import + reuse pattern** — `precoMcoSeries.ts` imports and calls `computeMco` per
bucket rather than reimplementing the formula (RESEARCH.md's exact recommended
signature, already reconciled with `computeMco`'s `platformCost = comissao + frete`
convention):
```typescript
import { computeMco } from "./mco";

export function computePrecoMcoSeries(
  rows: PrecoSeriesRow[],
  opts: { spendItem: number; incluirAds: boolean },
): McoSeriesPoint[] {
  const receitaTotalPeriodo = rows.reduce((s, r) => s + r.total, 0);
  return rows.map((r) => {
    const qtd = r.qtd;
    const ads = opts.incluirAds && receitaTotalPeriodo > 0
      ? opts.spendItem * (r.total / receitaTotalPeriodo)
      : 0;
    const { mco, pct } = computeMco({
      grossRevenue: r.total,
      cmv: r.cmv,
      platformCost: r.comissao + r.frete,
      ads,
      tax: r.impostos,
    });
    const precoUnit = qtd > 0 ? r.total / qtd : 0;
    const breakevenUnit = qtd > 0
      ? (r.cmv + r.comissao + r.frete + ads + r.impostos) / qtd
      : 0;
    const base = Math.min(precoUnit, breakevenUnit);
    const gainBand = precoUnit >= breakevenUnit ? precoUnit - breakevenUnit : 0;
    const lossBand = precoUnit < breakevenUnit ? breakevenUnit - precoUnit : 0;
    return {
      bucket: r.bucket, precoUnit, breakevenUnit,
      cmvUnit: qtd > 0 ? r.cmv / qtd : 0,
      comissaoUnit: qtd > 0 ? r.comissao / qtd : 0,
      freteUnit: qtd > 0 ? r.frete / qtd : 0,
      adsUnit: qtd > 0 ? ads / qtd : 0,
      impostoUnit: qtd > 0 ? r.impostos / qtd : 0,
      mco, mcoPct: pct, base, gainBand, lossBand,
      custoAusente: r.qtd_sem_custo > 0,
      impostoAusente: r.qtd_sem_imposto > 0,
    };
  });
}
```
(Full type definitions `PrecoSeriesRow`/`McoSeriesPoint` in RESEARCH.md "Code Examples"
section — copy those verbatim, they already match the RPC's recommended output columns.)

**Recommended decision (research):** feed `impostos`/`qtd_sem_imposto` straight from the
RPC's `SUM(tax_amount)` — do **not** import `src/lib/tax/*` or `useMLTaxConfig` into this
util. Mirrors how `MLCostCard` only *displays* `impostosMes`, never resolves a rate
client-side (`src/components/mercadolivre/MLCostCard.tsx:32,57,67-72` — `impostosMes:
number | null` passed as a prop, used directly in `Lucro do mês = receita − tarifas −
CMV − impostos`, never recomputed).

---

### `src/lib/precoMcoSeries.test.ts` (test, transform)

**Analog:** `src/lib/mco.test.ts` (61 lines, read in full)

**Structure to copy** — `describe` block per function, comment above each `it()` showing
the manual arithmetic, one test per edge case (typical, negative, div-by-zero/null,
"applied exactly once" sanity check):
```typescript
import { computeMco } from "./mco";

describe("computeMco", () => {
  it("calcula MCO em R$ e % corretamente com componentes típicos", () => {
    // grossRevenue 10000, cmv 3000, platformCost 2000, ads 1000, tax 500
    // mco = 10000 - 3000 - 2000 - 1000 - 500 = 3500
    const result = computeMco({ grossRevenue: 10000, cmv: 3000, platformCost: 2000, ads: 1000, tax: 500 });
    expect(result.mco).toBe(3500);
    expect(result.pct).toBeCloseTo(35, 5);
  });
  // ... "negativo quando custos superam receita", "pct = null sem NaN quando grossRevenue = 0" ...
});
```
For `precoMcoSeries.test.ts`, RESEARCH.md's Phase Requirements → Test Map lists the
required cases: composição MCO reusa `computeMco`, bandas gain/loss mutuamente
exclusivas, `custoAusente`/`impostoAusente` refletem `qtd_sem_custo`/`qtd_sem_imposto`,
toggle `incluirAds=false` zera `adsUnit`, `qtd=0` não produz NaN/Infinity. Run command:
`npx vitest run src/lib/precoMcoSeries.test.ts`.

---

### `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` (component, request-response — modified in place)

**Analog:** itself, current version (327 lines, read in full) — this is a structural
edit, not a from-scratch build; the existing shape (fetch → local `SeriesRow[]` state →
`useMemo` chartData/kpis → ComposedChart) is the pattern to preserve while swapping
internals.

**Imports (lines 1-18) — keep the existing import block, add:**
```typescript
import { Area } from "recharts";           // extend the existing recharts import (line 5-8)
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { computePrecoMcoSeries, type PrecoSeriesRow } from "@/lib/precoMcoSeries";
```

**RPC fetch pattern to preserve (lines 123-156)** — same `useEffect`, same
`cancelled`-guard, same `console.warn` + empty-array on error (per CONTEXT.md "Erro RPC
→ comportamento atual"); only the row-mapping object literal grows with the new columns
(`cmv`, `comissao`, `frete`, `qtd_sem_custo`, `impostos`, `qtd_sem_imposto`):
```typescript
const { data, error } = await (supabase.rpc as any)("orders_price_timeseries", {
  _item_id: selectedId,
  _ml_user_ids: mlUserIds && mlUserIds.length > 0 ? mlUserIds : null,
  _from: fromDate,
  _to: toDate,
  _granularity: granularity,
});
if (cancelled) return;
if (error) {
  console.warn("orders_price_timeseries:", error.message);
  setRows([]);
} else {
  setRows((data ?? []).map((r: any) => ({ /* existing fields + new fields */ })));
}
```

**New: ads spend query** (no dedicated file — add as a second parallel fetch inside the
same `useEffect`, or a sibling `useEffect` keyed on `selectedId`/`fromDate`/`toDate`).
Exact query from RESEARCH.md "Code Examples":
```typescript
const { data } = await supabase
  .from("ml_ads_products_cache")
  .select("spend")
  .eq("item_id", selectedId)
  .in("ml_user_id", mlUserIds)
  .gte("date", fromDate)
  .lte("date", toDate);
const spendItem = (data ?? []).reduce((s, r) => s + Number(r.spend ?? 0), 0);
```
RLS already scopes by org (`is_org_member`) — no explicit `organization_id` filter
needed, matching every other `ml_*_cache` direct-query hook in the project.

**Toggle "incluir ads" (Switch) — copy pattern from `ReplenishmentPanel.tsx` lines
135-144** (the only existing `Switch` usage in `src/components/mercadolivre/`):
```tsx
<Switch
  id="incluir-ads"
  checked={incluirAds}
  onCheckedChange={setIncluirAds}
/>
<Label htmlFor="incluir-ads" className="text-xs text-muted-foreground cursor-pointer">
  Incluir publicidade
</Label>
```

**KPI variant-by-sign pattern (already used across the dashboard)** —
`src/components/dashboard/KPICard.tsx` line 7 defines `CardVariant` including
`"success" | "danger"`; line 34/36 map them to `bg-success/10 text-success` /
`bg-destructive/10 text-destructive`. Apply to the MCO% KPI:
```tsx
<KPICard
  title="MCO %"
  value={`${kpis.mcoPct?.toFixed(1) ?? "—"}%`}
  variant={kpis.mcoPct != null && kpis.mcoPct >= 0 ? "success" : "danger"}
  size="compact"
/>
```
(Existing KPI grid at lines 260-267 — keep the same `grid grid-cols-2 md:grid-cols-3
lg:grid-cols-6 gap-3` wrapper, swap the 6 `KPICard` children per CONTEXT.md's new list:
Preço médio, Break-even médio, MCO R$, MCO%, Qtd vendida, Receita.)

**Chart replacement — bands + dual-axis lines.** Current chart (lines 287-315) is a
`ComposedChart` with one `Bar` + one `Line` on two axes (`vol`/`preco`). Replace with
the technique in RESEARCH.md Pattern 2 (no existing precedent in repo for banded areas —
`src/components/financial/CashFlowChart.tsx` confirmed as NOT a template, general style
only). Keep the same `ResponsiveContainer`/`CartesianGrid`/`XAxis`/`RechartsTooltip`
wrapper shape, replace axes/series:
```tsx
<YAxis yAxisId="preco" ... />
<YAxis yAxisId="mco" orientation="right" ... />
<Area yAxisId="preco" type="linear" dataKey="base" stackId="mco" stroke="none" fill="transparent" isAnimationActive={false} />
<Area yAxisId="preco" type="linear" dataKey="gainBand" stackId="mco" stroke="none" fill="hsl(var(--success))" fillOpacity={0.25} isAnimationActive={false} />
<Area yAxisId="preco" type="linear" dataKey="lossBand" stackId="mco" stroke="none" fill="hsl(var(--destructive))" fillOpacity={0.25} isAnimationActive={false} />
<Line yAxisId="preco" type="linear" dataKey="precoUnit" stroke="hsl(var(--accent))" strokeWidth={2.2} dot={{ r: 2.5 }} />
<Line yAxisId="preco" type="linear" dataKey="breakevenUnit" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
<Line yAxisId="mco" type="monotone" dataKey="mcoPct" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
```
**Pitfall:** use `type="linear"` (not `"monotone"`, unlike the existing `preco_medio`
Line at line 310) on the bands and the preço/breakeven lines to avoid cubic-overshoot
at crossing points — RESEARCH.md Pattern 2 pitfall section.

**Tooltip** — replace `ChartTooltip` (lines 70-92) `Row` list with the new decomposition
fields (preço, break-even, MCO R$/un, MCO%, custo/comissão/frete/ads/imposto por
unidade) using the same `Row` sub-component shape already in the file.

**Footer caption** (lines 317-322 pattern) — replace text with CONTEXT.md's locked
copy: "Ads rateado pela participação de receita · imposto pelo regime configurado ·
linha tracejada = break-even".

**Empty/error states (lines 272-286)** — keep unchanged (loading spinner, no-selection,
no-data) per CONTEXT.md "Sem vendas → estados vazios atuais inalterados".

---

## Shared Patterns

### Pure calculation module + colocated Vitest test
**Source:** `src/lib/mco.ts` + `src/lib/mco.test.ts`
**Apply to:** `src/lib/precoMcoSeries.ts` + `src/lib/precoMcoSeries.test.ts`
Pattern: no React/Supabase/network imports in the `.ts` file; JSDoc header explaining
the formula and reconciliation with other dashboard numbers; every branch (typical,
negative, zero/null-guard) gets its own `it()` with a comment showing the manual math.

### RPC error handling (console.warn + empty state, no throw)
**Source:** `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` lines 137-140
**Apply to:** the extended RPC call in the same file (unchanged behavior, per CONTEXT.md)
```typescript
if (error) {
  console.warn("orders_price_timeseries:", error.message);
  setRows([]);
}
```

### KPI colored by sign
**Source:** `src/components/dashboard/KPICard.tsx` lines 7, 32-36
**Apply to:** MCO % KPI in `PrecoPraticadoReport.tsx`
`variant={value >= 0 ? "success" : "danger"}` — `CardVariant` already supports both,
no new styling needed.

### Switch + Label toggle (shadcn/ui)
**Source:** `src/components/mercadolivre/ReplenishmentPanel.tsx` lines 135-144
**Apply to:** "incluir ads" toggle in `PrecoPraticadoReport.tsx`

### RPC migration safety: DROP before CREATE when RETURNS TABLE changes
**Source:** RESEARCH.md Pitfall 1 (Postgres behavior, cited from docs, no repo precedent needed)
**Apply to:** `202606790000NN_orders_price_timeseries_mco.sql`
```sql
DROP FUNCTION IF EXISTS public.orders_price_timeseries(text, text[], date, date, text);
CREATE FUNCTION public.orders_price_timeseries(...) RETURNS TABLE(...) ...
```

### Server-side aggregation of firm per-order fields (cmv/comissao/frete/tax_amount)
**Source:** `supabase/migrations/20260615120000_margin_with_ads_rpc.sql` lines 44-71 (`get_margin_with_ads_by_product`)
**Apply to:** new columns in `orders_price_timeseries`
`COALESCE(SUM(...), 0)` per component, `FILTER (WHERE ... IS NULL)` for the "ausente"
counters — no client-side recomputation of tax rate or cost.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Banded/stacked-area colchão technique in `PrecoPraticadoReport.tsx` | component (chart) | transform/render | No precedent for a colored area-between-two-lines in this repo (`CashFlowChart.tsx` checked, confirmed not applicable); RESEARCH.md documents the community-standard Recharts technique in full (Pattern 2) — use that as the source of truth instead of a repo analog |

## Metadata

**Analog search scope:** `src/lib/`, `src/components/mercadolivre/`, `src/components/dashboard/`, `supabase/migrations/`
**Files scanned:** `src/lib/mco.ts`, `src/lib/mco.test.ts`, `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx`, `src/pages/mercadolivre/MLAnalisePrecos.tsx`, `src/components/mercadolivre/MLCostCard.tsx`, `src/components/dashboard/KPICard.tsx`, `src/components/mercadolivre/ReplenishmentPanel.tsx`, `supabase/migrations/20260677000000_orders_price_timeseries.sql`, `supabase/migrations/20260615120000_margin_with_ads_rpc.sql`
**Pattern extraction date:** 2026-07-02
