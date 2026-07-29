# Phase 101: Detalhamento de MCO e recomendação de margem - Pattern Map

**Mapped:** 2026-07-19
**Files analyzed:** 6 (2 new, 4 modified) + 1 test file expected
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `supabase/migrations/202607XXXXXXXX_ml_mco_targets.sql` | migration | CRUD (config table + RLS) | `supabase/migrations/20260514120000_ml_product_costs.sql` + `20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql` | exact |
| `src/hooks/useMcoTargets.ts` | hook | CRUD (fetch-by-org + optimistic upsert) | `src/hooks/useMLProductCosts.ts` | exact |
| `src/lib/precoMcoSeries.ts` (extend: `computeWaterfallCard`) | utility (pure calc) | transform | same file, `computePriceKpis` (lines 201-228) | exact — same file, same style |
| `src/lib/pricing/mcoRecommendation.ts` (new, optional split) or inline in component | utility (pure calc) | transform | `src/lib/pricing/calculator.ts` (`reversePrice`, lines 155-190) | exact |
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` (extend: new card) | component | request-response (renders from already-fetched state) | same file, `ChartTooltip`/`Row` (lines 113-162) + warning footer (lines 822-838) | exact — same file, same component |
| `src/pages/mercadolivre/MLAnuncios.tsx` — `InlineEditCell` (reused, not modified) | component (reused) | event-driven (onBlur/Enter save) | itself | exact (reference only, no changes needed — copy pattern into new file or import if exported) |
| `src/lib/precoMcoSeries.test.ts` (extend) | test | transform | existing test file for `computePrecoMcoSeries`/`computePriceKpis` (TDD pattern per RESEARCH) | exact |

## Pattern Assignments

### `supabase/migrations/202607XXXXXXXX_ml_mco_targets.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20260514120000_ml_product_costs.sql` (base table) + `supabase/migrations/20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql` (RLS org-first) + `supabase/migrations/20260662000000_replenishment_params.sql` (sentinel pattern for optional scope column)

**Table pattern** (already fully specified in RESEARCH.md Pattern 1 — copy verbatim):
```sql
CREATE TABLE public.ml_mco_targets (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id         text        NOT NULL,
  sku             text        NOT NULL DEFAULT '',  -- sentinel '' = anúncio inteiro; NEVER null (see Pitfall 4)
  target_mco_pct  numeric(5,2) NOT NULL CHECK (target_mco_pct > 0 AND target_mco_pct <= 100),
  updated_by      uuid        NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ml_mco_targets_org_item_sku_unique UNIQUE (organization_id, item_id, sku)
);
```

**RLS pattern** (copy 1:1 from `mpc_select`/`mpc_insert`/`mpc_update`/`mpc_delete`, lines 46-93 of `20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql`, renaming table/policy names):
```sql
ALTER TABLE public.ml_mco_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mmt_select"
  ON public.ml_mco_targets
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
  );

CREATE POLICY "mmt_insert"
  ON public.ml_mco_targets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[])
  );

CREATE POLICY "mmt_update"
  ON public.ml_mco_targets
  FOR UPDATE
  TO authenticated
  USING ( organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[]) )
  WITH CHECK ( organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[]) );

CREATE POLICY "mmt_delete"
  ON public.ml_mco_targets
  FOR DELETE
  TO authenticated
  USING ( organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner', 'admin', 'member']::public.org_role[]) );

CREATE INDEX IF NOT EXISTS idx_ml_mco_targets_org_item
  ON public.ml_mco_targets (organization_id, item_id, sku);
```

**No RPC needed** — `Anti-Pattern` per RESEARCH: neither `ml_product_costs` nor `replenishment_params` uses an RPC for simple config writes. Deploy only via MCP (`apply_migration`), project `ckcdevcxgvueywivefgx`.

---

### `src/hooks/useMcoTargets.ts` (hook, CRUD)

**Analog:** `src/hooks/useMLProductCosts.ts` (full file read — 159 lines)

**Imports pattern** (lines 1-4):
```typescript
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
```

**Fetch-by-org pattern** (lines 32-64, `fetchAll`):
```typescript
const fetchAll = useCallback(async () => {
  if (!currentOrg) return;
  setLoading(true);
  try {
    const { data, error } = await supabase
      .from("ml_product_costs")
      .select("item_id, cost, tax_rate, seller_sku")
      .eq("organization_id", currentOrg.id)
      .limit(10000);
    if (error) { console.warn("useMLProductCosts fetch error", error); return; }
    // ... build Map keyed by item_id (or item_id::sku for this phase)
  } finally { setLoading(false); }
}, [currentOrg]);

useEffect(() => { fetchAll(); }, [fetchAll]);
```

**Optimistic upsert pattern** (lines 70-103):
```typescript
const upsert = useCallback(
  async (item_id: string, cost: number | null, tax_rate: number | null) => {
    if (!user) return;
    if (!currentOrg?.id) {
      console.warn("useMLProductCosts upsert ignorado — sem organização ativa");
      return;
    }
    setCosts((prev) => { /* optimistic Map update */ });
    const { error } = await supabase.from("ml_product_costs").upsert(
      { user_id: user.id, organization_id: currentOrg.id, item_id, cost, tax_rate, updated_at: new Date().toISOString() },
      { onConflict: "user_id,item_id" },
    );
    if (error) console.warn("useMLProductCosts upsert error", error);
  },
  [user, currentOrg],
);
```

**Full target implementation** (from RESEARCH.md Code Examples, ready to copy — keys by `item_id::sku`, `onConflict: "organization_id,item_id,sku"` instead of `user_id,item_id`):
```typescript
export function useMcoTargets() {
  const { currentOrg } = useOrganization();
  const { user } = useAuth();
  const [targets, setTargets] = useState<Map<string, number>>(new Map());
  const keyOf = (itemId: string, sku: string | null) => `${itemId}::${sku ?? ""}`;

  const fetchAll = useCallback(async () => {
    if (!currentOrg) return;
    const { data, error } = await supabase
      .from("ml_mco_targets")
      .select("item_id, sku, target_mco_pct")
      .eq("organization_id", currentOrg.id)
      .limit(10000);
    if (error) { console.warn("useMcoTargets fetch error", error); return; }
    const map = new Map<string, number>();
    for (const row of data ?? []) map.set(keyOf(row.item_id, row.sku || null), Number(row.target_mco_pct));
    setTargets(map);
  }, [currentOrg]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const upsert = useCallback(async (itemId: string, sku: string | null, pct: number) => {
    if (!currentOrg?.id) return;
    setTargets((prev) => new Map(prev).set(keyOf(itemId, sku), pct));
    const { error } = await supabase.from("ml_mco_targets").upsert(
      { organization_id: currentOrg.id, item_id: itemId, sku: sku ?? "", target_mco_pct: pct, updated_by: user?.id ?? null },
      { onConflict: "organization_id,item_id,sku" },
    );
    if (error) console.warn("useMcoTargets upsert error", error);
  }, [currentOrg, user]);

  return { targets, keyOf, upsert, refetch: fetchAll };
}
```
**Important:** always normalize `sku ?? ""` before read/write (Pitfall 4 — never pass `null`/`undefined` as the sentinel).

---

### `src/lib/precoMcoSeries.ts` — extend with `computeWaterfallCard()` (utility, transform)

**Analog:** same file, `computePriceKpis` (lines 201-228) — closest sibling function, same aggregation style.

**Imports** — none new; reuse `computeMco` already imported (line 33). No I/O, no new dependency.

**Core pattern to follow** (existing `computePriceKpis`, lines 201-228 — copy this aggregation style, extend with per-component unit breakdown):
```typescript
export function computePriceKpis(
  rows: PrecoSeriesRow[],
  opts: ComputePrecoMcoSeriesOpts,
): PriceKpis {
  const serie = computePrecoMcoSeries(rows, opts);
  const adsBucket = serie.reduce((s, p) => s + p.ads, 0);
  const qtd = rows.reduce((s, r) => s + r.qtd, 0);
  const receita = rows.reduce((s, r) => s + r.total, 0);
  const cmv = rows.reduce((s, r) => s + r.cmv, 0);
  const comissao = rows.reduce((s, r) => s + r.comissao, 0);
  const frete = rows.reduce((s, r) => s + r.frete, 0);
  const impostos = rows.reduce((s, r) => s + r.impostos, 0);
  const precoMedio = qtd > 0 ? receita / qtd : 0;
  const breakevenMedio = qtd > 0 ? (cmv + comissao + frete + adsBucket + impostos) / qtd : 0;
  const { mco, pct } = computeMco({
    grossRevenue: receita, cmv, platformCost: comissao + frete, ads: adsBucket, tax: impostos,
  });
  return { qtd, receita, precoMedio, breakevenMedio, mco, mcoPct: pct };
}
```

**New function to add** (RESEARCH.md Pattern 2, exact signature/style — field names illustrative, planner may rename):
```typescript
export interface WaterfallCard {
  precoUnit: number; cmvUnit: number; comissaoUnit: number; freteUnit: number;
  adsUnit: number; impostoUnit: number; mcUnit: number; /* antes de ads */
  mcoUnit: number; mcoPct: number | null; mcBeforeAdsPct: number | null;
  custoAusente: boolean; impostoAusente: boolean;
}

export function computeWaterfallCard(
  rows: PrecoSeriesRow[],
  opts: ComputePrecoMcoSeriesOpts,
): WaterfallCard {
  const serie = computePrecoMcoSeries(rows, opts);
  const adsTotal = serie.reduce((s, p) => s + p.ads, 0);
  const qtd = rows.reduce((s, r) => s + r.qtd, 0);
  const receita = rows.reduce((s, r) => s + r.total, 0);
  const cmv = rows.reduce((s, r) => s + r.cmv, 0);
  const comissao = rows.reduce((s, r) => s + r.comissao, 0);
  const frete = rows.reduce((s, r) => s + r.frete, 0);
  const impostos = rows.reduce((s, r) => s + r.impostos, 0);

  const { mco, pct } = computeMco({
    grossRevenue: receita, cmv, platformCost: comissao + frete, ads: adsTotal, tax: impostos,
  });

  const precoUnit = qtd > 0 ? receita / qtd : 0;
  const mcBeforeAdsUnit = qtd > 0 ? (receita - cmv - comissao - frete - impostos) / qtd : 0;

  return {
    precoUnit,
    cmvUnit: qtd > 0 ? cmv / qtd : 0,
    comissaoUnit: qtd > 0 ? comissao / qtd : 0,
    freteUnit: qtd > 0 ? frete / qtd : 0,
    adsUnit: qtd > 0 ? adsTotal / qtd : 0,
    impostoUnit: qtd > 0 ? impostos / qtd : 0,
    mcUnit: mcBeforeAdsUnit,
    mcoUnit: qtd > 0 ? mco / qtd : 0,
    mcoPct: pct,
    mcBeforeAdsPct: precoUnit > 0 ? (mcBeforeAdsUnit / precoUnit) * 100 : null,
    custoAusente: rows.some((r) => r.qtd_sem_custo > 0),
    impostoAusente: rows.some((r) => r.qtd_sem_imposto > 0),
  };
}
```
**Error handling:** function is pure/defensive — never NaN/Infinity, `qtd > 0` guards everywhere (same style as `computePrecoMcoSeries`, lines 134/146-151). No try/catch needed (no I/O).

---

### Recommendation levers (preço mínimo + ACOS-alvo) — no new file needed, or `src/lib/pricing/mcoRecommendation.ts`

**Analog:** `src/lib/pricing/calculator.ts` — `reversePrice` (lines 155-190), already in production since Phase 50.

**Core pattern — reuse `reversePrice`, do not reimplement:**
```typescript
// Source: src/lib/pricing/calculator.ts (reversePrice) + WaterfallCard (above)
import { reversePrice } from "@/lib/pricing/calculator";

const NO_EXTRA = { enabled: false, mode: "percent" as const, value: 0 };

const commissionPct = card.precoUnit > 0 ? (card.comissaoUnit / card.precoUnit) * 100 : 0;
const taxPct        = card.precoUnit > 0 ? (card.impostoUnit  / card.precoUnit) * 100 : 0;

const precoMinimo = reversePrice(
  {
    cost: card.cmvUnit,
    commissionPct,
    fixedFee: 0,
    shippingCost: card.freteUnit + card.adsUnit,
    taxPct,
    difalEnabled: false, difalPct: 0,
    rebate: NO_EXTRA, cupom: NO_EXTRA, afiliado: NO_EXTRA, promo: NO_EXTRA,
  },
  targetMcoPct,
  "margin",
);
// null → "meta impraticável com os custos atuais deste item"

// ACOS-alvo — 1-line algebra, no new function needed:
const acosMeta = card.mcBeforeAdsPct != null ? card.mcBeforeAdsPct - targetMcoPct : null;
// acosMeta <= 0 → "meta inatingível mesmo sem ads"
```

**Guard to respect (Pitfall 2):** `reversePrice` has `if (target <= 0) return null;` — the `CHECK (target_mco_pct > 0)` on the table plus client-side input validation (reject 0/negative/>100) prevents ever hitting this edge case unintentionally.

---

### `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — new card (component, request-response)

**Analog:** same file — `ChartTooltip`/`Row` (lines 113-162) for the row-formatting pattern, and the warning footer block (lines 822-838) for the "dado ausente" pattern.

**Imports already present in file, reuse (lines 1-52):**
```typescript
import { AlertTriangle, Target, Percent, DollarSign } from "lucide-react"; // already imported
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  computePrecoMcoSeries, computePriceKpis, /* + new computeWaterfallCard */
  type McoSeriesPoint, type PrecoSeriesRow,
} from "@/lib/precoMcoSeries";
```
New imports to add:
```typescript
import { classifyMcoHealth, mcoHealthRole, MCO_SAUDAVEL_PCT } from "@/lib/mcoHealth";
import { reversePrice } from "@/lib/pricing/calculator";
import { useMcoTargets } from "@/hooks/useMcoTargets";
```

**Row component pattern to move to module scope and reuse** (lines 117-136, currently nested inside `ChartTooltip` — UI-SPEC mandates reuse, not duplication):
```typescript
const Row = ({ k, v, accent, danger, muted, dotColor }: {
  k: string; v: string; accent?: boolean; danger?: boolean; muted?: boolean; dotColor?: string;
}) => (
  <p className={cn("flex justify-between gap-6", muted && "text-[10px]")}>
    <span className="text-muted-foreground flex items-center gap-1.5">
      {dotColor && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />}
      {k}
    </span>
    <span className={cn("font-semibold tabular-nums", accent && "text-success", danger && "text-destructive", muted && "font-normal text-muted-foreground")}>
      {v}
    </span>
  </p>
);
```

**Warning footer pattern to replicate verbatim (copy) for `custoAusente`/`impostoAusente`** (lines 822-838):
```typescript
{(kpis.qtdSemCusto > 0 || kpis.temImpostoAusente) && (
  <div className="mt-2 space-y-0.5">
    {kpis.qtdSemCusto > 0 && (
      <p className="flex items-center justify-center gap-1 text-[10px] text-warning">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        custo ausente em {intFmt(kpis.qtdSemCusto)} un — break-even subestimado
      </p>
    )}
    {kpis.temImpostoAusente && (
      <p className="flex items-center justify-center gap-1 text-[10px] text-warning">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        regime fiscal não configurado em parte das vendas — imposto pode estar subestimado
      </p>
    )}
  </div>
)}
```

**Card wrapper pattern** (mirrors existing `Card`/`CardContent` blocks in the same file, e.g. lines 713-714 and 860-865):
```typescript
<Card className="mt-6">
  <CardContent className="pt-4 pb-4">
    {/* Header row: Target icon + title + semáforo Badge + period label */}
    {/* Waterfall block: Row components in fixed order */}
    {/* Meta MCO% inline-edit row */}
    {/* Recommendation block: 2 always-visible lines */}
    {/* Warning footer (conditional) */}
  </CardContent>
</Card>
```

**State the new card must react to (already managed in component):** `selectedId`, `selectedSku`, `currentFrom`/`currentTo` (period), `incluirAds` toggle (line ~652-661) — no new state needed except the `useMcoTargets()` hook and local `editing` state for the input (mirrors `InlineEditCell`).

---

### Editable "Meta MCO%" input — reuse `InlineEditCell` pattern

**Analog:** `src/pages/mercadolivre/MLAnuncios.tsx` (lines 156-196, `InlineEditCell`) — NOT exported today; either export it from `MLAnuncios.tsx` or copy the same onBlur/Enter pattern into the new card (small enough — ~40 lines — that a local copy avoids cross-file coupling; planner decides).

**Full pattern to copy/adapt** (lines 156-196):
```typescript
function InlineEditCell({
  value, onSave, format = "currency",
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<void>;
  format?: "currency" | "percent";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = async () => {
    const raw = draft.trim().replace(",", ".");
    const parsed = raw === "" ? null : Number(raw);
    const v = parsed === null || isNaN(parsed) || parsed < 0 ? null : parsed;
    setSaving(true);
    await onSave(v);
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        {format === "currency" && <span className="text-[10px] text-muted-foreground">R$</span>}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-20 text-xs text-right border border-primary/40 rounded px-1.5 py-0.5 bg-background outline-none ring-1 ring-primary/30"
          type="number"
        />
      </div>
    );
  }
  // ... non-editing display state (click to enter edit mode)
}
```
**For this phase:** validation must reject 0/negative/>100 (mirrors DB `CHECK`) and show a `sonner` toast on rejection (per UI-SPEC copywriting contract: "Meta precisa ser maior que 0% e até 100%") — `InlineEditCell`'s current `parsed < 0 ? null` guard is not sufficient alone; add the upper bound + toast in the adapted copy.

---

## Shared Patterns

### MCO formula and health classification (do not recreate)
**Source:** `src/lib/mco.ts` (`computeMco`) + `src/lib/mcoHealth.ts` (`MCO_SAUDAVEL_PCT`, `classifyMcoHealth`, `mcoHealthRole`)
**Apply to:** `computeWaterfallCard`, semáforo `Badge` in the new card.
```typescript
export const MCO_SAUDAVEL_PCT = { red: 5, green: 9 } as const;
export function classifyMcoHealth(pct: number | null | undefined): McoHealth { /* ... */ }
export function mcoHealthRole(health: McoHealth): McoColorRole { /* critical|warning|good|neutral */ }
```

### Org-first RLS for per-item config tables
**Source:** `supabase/migrations/20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql`
**Apply to:** `ml_mco_targets` migration — SELECT for any org member, INSERT/UPDATE/DELETE for owner/admin/member only (never viewer), default-deny (no policy = no access).

### "Never invent a number" — missing cost/tax warning
**Source:** `PrecoPraticadoReport.tsx` lines 822-838 (and `ChartTooltip`, lines 153-159)
**Apply to:** new card's warning footer — reuse exact copy and `text-warning`/`AlertTriangle` styling, gated on `custoAusente`/`impostoAusente` from `computeWaterfallCard`.

### Sentinel `''` instead of `NULL` for optional scope columns
**Source:** `supabase/migrations/20260662000000_replenishment_params.sql` (`scope_value` pattern, referenced in RESEARCH.md)
**Apply to:** `ml_mco_targets.sku` column — `NOT NULL DEFAULT ''`, always normalize `sku ?? ""` in the hook before read/write.

## No Analog Found

None — every file in scope has a strong, recently-modified analog in the same codebase (RESEARCH.md confirms zero new tech stack, zero new external dependency).

## Metadata

**Analog search scope:** `src/lib/`, `src/lib/pricing/`, `src/hooks/`, `src/components/mercadolivre/anuncios/`, `src/pages/mercadolivre/`, `supabase/migrations/`
**Files scanned:** `precoMcoSeries.ts`, `mcoHealth.ts`, `mco.ts`, `pricing/calculator.ts`, `PrecoPraticadoReport.tsx`, `useMLProductCosts.ts`, `MLAnuncios.tsx`, `20260514120000_ml_product_costs.sql`, `20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql`, `20260662000000_replenishment_params.sql`
**Pattern extraction date:** 2026-07-19
