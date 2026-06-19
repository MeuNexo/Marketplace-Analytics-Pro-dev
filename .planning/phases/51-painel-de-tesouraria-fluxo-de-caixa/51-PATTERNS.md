# Phase 51: Painel de Tesouraria (Fluxo de Caixa) — Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 9 (3 new hooks, 3 new components, 1 new migration, 1 modified hook, 1 modified page)
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/20260650000000_treasury_panel.sql` | migration | DDL (ALTER + 3 RPCs) | `supabase/migrations/20260619020000_cashflow_brt_timezone.sql` | exact |
| `src/hooks/useTreasuryPanel.ts` | hook | CRUD (RPC, 1-row result) | `src/hooks/useProjectedBalance.ts` | exact |
| `src/hooks/useCostByMonth.ts` | hook | CRUD (RPC, multi-row) | `src/hooks/useProjectedBalance.ts` | role-match |
| `src/hooks/useSupplierExposure.ts` | hook | CRUD (RPC, multi-row) | `src/hooks/useProjectedBalance.ts` | role-match |
| `src/hooks/useFinancialSettings.ts` *(modify)* | hook | CRUD (select direto) | itself | exact |
| `src/components/financial/TreasuryPanel.tsx` | component | request-response | `src/components/financial/TodayBalanceCard.tsx` | role-match |
| `src/components/financial/CostCompositionChart.tsx` | component | transform (recharts stacked) | `src/pages/mercadolivre/MLFinanceiro.tsx` lines 486–578 | role-match |
| `src/components/financial/SupplierExposureChart.tsx` | component | transform (recharts grouped) | `src/pages/mercadolivre/MLFinanceiro.tsx` lines 486–578 | role-match |
| `src/pages/mercadolivre/MLFluxoCaixa.tsx` *(modify)* | page | request-response | itself | exact |

---

## Pattern Assignments

---

### `supabase/migrations/20260650000000_treasury_panel.sql` (migration, DDL)

**Analog:** `supabase/migrations/20260619020000_cashflow_brt_timezone.sql`

**Migration filename convention:**
The last cash-flow migration is `20260619020000_cashflow_brt_timezone.sql`. The consultor migrations use synthetic future timestamps (`20260645*`). For Phase 51 use `20260650000000_treasury_panel.sql` (synthetic timestamp beyond existing highest).

**Idempotent ADD COLUMN pattern** (from RESEARCH.md §7, confirmed by project convention):
```sql
-- ============================================================
-- Phase 51: Painel de Tesouraria — alert_threshold + 3 RPCs
-- ============================================================
-- Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
-- Aplicar via MCP apply_migration em ckcdevcxgvueywivefgx.
-- NUNCA usar `supabase db push` (linkado ao projeto ERRADO).

DO $$ BEGIN
  ALTER TABLE public.financial_settings
    ADD COLUMN alert_threshold numeric NOT NULL DEFAULT 30000;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
```

**SECURITY INVOKER + BRT timezone pattern** (from `20260619020000_cashflow_brt_timezone.sql`, validated in RESEARCH.md §3):
```sql
CREATE OR REPLACE FUNCTION public.get_treasury_panel(p_org_id UUID)
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY INVOKER          -- NUNCA DEFINER (DEFINER + p_org_id = IDOR via RLS bypass)
SET search_path = 'public'
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;  -- BRT obrigatório
  ...
BEGIN
  ...
END;
$$;
```

**REVOKE/GRANT pattern** (from `20260645011000_consultor_rpcs_revoke_public_execute.sql`):
```sql
REVOKE EXECUTE ON FUNCTION public.get_treasury_panel(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_treasury_panel(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_cost_by_month(UUID, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cost_by_month(UUID, INT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_supplier_exposure(UUID, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_supplier_exposure(UUID, INT) TO authenticated;
```

**Full RPC SQL:** Use verbatim from RESEARCH.md §5 — all 3 RPCs are fully documented there with correct BRT pattern, SECURITY INVOKER, cumulative vs incremental logic for Fornec 30/60/90d, and COALESCE for NULL category.

---

### `src/hooks/useTreasuryPanel.ts` (hook, CRUD RPC 1-row)

**Analog:** `src/hooks/useProjectedBalance.ts` (lines 1–59 — read in full above)

**Imports pattern** (copy from useProjectedBalance.ts lines 8–10):
```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
```

**Interface pattern** (mirror ProjectedBalanceData shape):
```typescript
export interface TreasuryPanelData {
  burn_rate:        number;
  alert_threshold:  number;
  alert_date:       string | null;   // ISO date or null
  min_balance_date: string | null;   // date of minimum balance in 90d horizon
  entrada_real_30d: number;
  saida_real_30d:   number;
  fornec_30d:       number;
  fornec_60d:       number;
  fornec_90d:       number;
  total_exposicao:  number;
}
```

**Core hook pattern** (exact mirror of useProjectedBalance.ts lines 27–58):
```typescript
export function useTreasuryPanel() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<TreasuryPanelData | null>({
    queryKey: ["cashflow", "treasury_panel", orgId] as const,
    enabled: !!orgId,
    staleTime: 3 * 60 * 1000,
    queryFn: async (): Promise<TreasuryPanelData | null> => {
      if (!orgId) return null;

      const { data, error } = await supabase.rpc("get_treasury_panel", {
        p_org_id: orgId,
      });

      if (error) throw error;

      const r = data?.[0];
      if (!r) return null;

      return {
        burn_rate:        Number(r.burn_rate        ?? 0),
        alert_threshold:  Number(r.alert_threshold  ?? 30000),
        alert_date:       r.alert_date  ? String(r.alert_date)  : null,
        min_balance_date: r.min_balance_date ? String(r.min_balance_date) : null,
        entrada_real_30d: Number(r.entrada_real_30d ?? 0),
        saida_real_30d:   Number(r.saida_real_30d   ?? 0),
        fornec_30d:       Number(r.fornec_30d        ?? 0),
        fornec_60d:       Number(r.fornec_60d        ?? 0),
        fornec_90d:       Number(r.fornec_90d        ?? 0),
        total_exposicao:  Number(r.total_exposicao   ?? 0),
      };
    },
  });
}
```

**queryKey namespace:** `["cashflow", "treasury_panel", orgId]` — follows the `["cashflow", ...]` convention established in useProjectedBalance.ts line 32.

---

### `src/hooks/useCostByMonth.ts` (hook, CRUD RPC multi-row)

**Analog:** `src/hooks/useProjectedBalance.ts` — same structure; multi-row result instead of single row.

**Interface (raw RPC row):**
```typescript
export interface CostByMonthRaw {
  month:    string;   // "2026-04" (YYYY-MM)
  category: string;   // "Fornecedores" | "Salários" | ... | "Outros"
  total:    number;
}
```

**Core hook pattern** (same imports + useOrganization as useProjectedBalance):
```typescript
export function useCostByMonth(months: number = 9) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<CostByMonthRaw[]>({
    queryKey: ["cashflow", "cost_by_month", orgId, months] as const,
    enabled: !!orgId,
    staleTime: 3 * 60 * 1000,
    queryFn: async (): Promise<CostByMonthRaw[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase.rpc("get_cost_by_month", {
        p_org_id: orgId,
        p_months: months,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        month:    String(r.month),
        category: String(r.category),
        total:    Number(r.total ?? 0),
      }));
    },
  });
}
```

---

### `src/hooks/useSupplierExposure.ts` (hook, CRUD RPC multi-row)

**Analog:** `src/hooks/useProjectedBalance.ts` — same pattern as useCostByMonth but different shape.

**Interface:**
```typescript
export interface SupplierExposureRow {
  supplier:   string;
  amount_30d: number;
  amount_60d: number;
  amount_90d: number;
}
```

**Core hook pattern:**
```typescript
export function useSupplierExposure(topN: number = 10) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<SupplierExposureRow[]>({
    queryKey: ["cashflow", "supplier_exposure", orgId, topN] as const,
    enabled: !!orgId,
    staleTime: 3 * 60 * 1000,
    queryFn: async (): Promise<SupplierExposureRow[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase.rpc("get_supplier_exposure", {
        p_org_id: orgId,
        p_top_n:  topN,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        supplier:   String(r.supplier ?? ""),
        amount_30d: Number(r.amount_30d ?? 0),
        amount_60d: Number(r.amount_60d ?? 0),
        amount_90d: Number(r.amount_90d ?? 0),
      }));
    },
  });
}
```

---

### `src/hooks/useFinancialSettings.ts` *(modify)* (hook, select direto)

**Analog:** itself — surgical extension only.

**Current file:** `src/hooks/useFinancialSettings.ts` (lines 1–53, read in full above).

**Changes required — 3 surgical edits:**

1. **Interface** (lines 11–15): add `alert_threshold`:
```typescript
export interface FinancialSettings {
  initial_balance: number;
  operational_cost_rate: number;
  safety_margin: number;
  alert_threshold: number;  // NEW — D-10
}
```

2. **DEFAULTS constant** (lines 17–21): add field:
```typescript
const DEFAULTS: FinancialSettings = {
  initial_balance: 0,
  operational_cost_rate: 0.22,
  safety_margin: 10000,
  alert_threshold: 30000,  // NEW
};
```

3. **select string** (line 38): add column:
```typescript
.select("initial_balance, operational_cost_rate, safety_margin, alert_threshold")
```

4. **return mapping** (lines 46–50): add field:
```typescript
return {
  initial_balance:       Number(data.initial_balance       ?? 0),
  operational_cost_rate: Number(data.operational_cost_rate ?? 0.22),
  safety_margin:         Number(data.safety_margin         ?? 10000),
  alert_threshold:       Number(data.alert_threshold       ?? 30000),  // NEW
};
```

No other changes — staleTime, queryKey, enabled pattern all stay identical.

---

### `src/components/financial/TreasuryPanel.tsx` (component, request-response)

**Analog:** `src/components/financial/TodayBalanceCard.tsx` (lines 1–120, read in full above)

**Imports pattern** (extend TodayBalanceCard.tsx imports):
```typescript
import { AlertTriangle, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTreasuryPanel } from "@/hooks/useTreasuryPanel";
import { useProjectedBalance } from "@/hooks/useProjectedBalance";
import { useFinancialSettings } from "@/hooks/useFinancialSettings";
```

**Currency helper** (same as TodayBalanceCard.tsx line 14):
```typescript
const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
```

**Date formatter for BRT dates** (ISO date string → DD/MM/AAAA):
```typescript
const dateFmt = (iso: string | null): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
```

**KPI coloring pattern** (from TodayBalanceCard.tsx lines 70–71):
```typescript
// Positive value → green; negative → red
className={`text-2xl font-bold tabular-nums ${v >= 0 ? "text-kpi-positive" : "text-kpi-negative"}`}

// Always negative (expenses, obligations)
className="text-2xl font-bold tabular-nums text-kpi-negative"

// Informational (burn rate, runway)
className="text-2xl font-bold tabular-nums text-kpi-neutral"
```

**Loading skeleton pattern** (mirror TodayBalanceCard.tsx lines 22–35):
```typescript
if (isLoading) {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((j) => (
            <Skeleton key={j} className="h-24 rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}
```

**Band structure pattern** (3 labeled bands, 4 KPIs each):
```typescript
// Band header: colored label bar (yellow = Saúde, blue = Realizado, orange = Exposição)
<div className="space-y-1">
  <div className="flex items-center gap-2 px-1">
    <span className="text-xs font-semibold uppercase tracking-wider text-amber-600">
      Saúde de Caixa
    </span>
    <div className="flex-1 h-px bg-amber-200/60" />
  </div>
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    {/* 4 KPI mini-cards */}
  </div>
</div>
```

**KPI mini-card pattern** (each cell — mirror Card + CardContent from TodayBalanceCard):
```typescript
<Card>
  <CardContent className="p-3 space-y-1">
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
      {label}
    </p>
    <p className={`text-lg font-bold tabular-nums leading-none ${colorClass}`}>
      {formattedValue}
    </p>
    {subtitle && (
      <p className="text-[10px] text-muted-foreground">{subtitle}</p>
    )}
  </CardContent>
</Card>
```

**Alerta KPI special case** (AlertTriangle icon + message string):
```typescript
<Card className={alertDate ? "border-destructive/40" : ""}>
  <CardContent className="p-3 space-y-1">
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
      Alerta
    </p>
    {alertDate ? (
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="w-4 h-4 text-kpi-negative shrink-0 mt-0.5" />
        <p className="text-xs font-medium text-kpi-negative leading-tight">
          Saldo abaixo de {currFmt(alertThreshold)} em {dateFmt(alertDate)}
        </p>
      </div>
    ) : (
      <p className="text-sm font-semibold text-kpi-positive">Sem alerta</p>
    )}
  </CardContent>
</Card>
```

**Runway guard** (from RESEARCH.md §4 — divide by zero):
```typescript
const runway = burnRate > 0 ? currentBalance / burnRate : null;
```

---

### `src/components/financial/CostCompositionChart.tsx` (component, recharts stacked BarChart)

**Analog:** `src/pages/mercadolivre/MLFinanceiro.tsx` lines 486–578 (stacked ComposedChart)

**Imports pattern** (from MLFinanceiro.tsx lines 2–11, adapted to BarChart-only):
```typescript
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCostByMonth } from "@/hooks/useCostByMonth";
import type { CostByMonthRaw } from "@/hooks/useCostByMonth";
```

**Category color map** (from RESEARCH.md §6 — use exact colors):
```typescript
const CATEGORY_COLORS: Record<string, string> = {
  "Fornecedores":         "#64748b",
  "Salários":             "#10b981",
  "Impostos/taxas":       "#8b5cf6",
  "Aluguéis/condomínio":  "#f59e0b",
  "Contabilidade":        "#3b82f6",
  "Cartão de crédito":    "#f43f5e",
  "Água/luz":             "#06b6d4",
  "Serviços gerais":      "#f97316",
  "Empréstimo":           "#a855f7",
  "Outros":               "hsl(220, 10%, 60%)",
};
```

**Pivot transform** (long → wide for recharts):
```typescript
// Inside component, before render:
const { wideData, allCategories } = useMemo(() => {
  const monthMap = new Map<string, Record<string, number | string>>();
  for (const row of rawData) {
    if (!monthMap.has(row.month)) {
      // Display label: "2026-04" → "Abr/26"
      const [y, m] = row.month.split("-");
      const label = new Date(Number(y), Number(m) - 1).toLocaleString("pt-BR", {
        month: "short", year: "2-digit",
      }).replace(". de ", "/").replace(".", "");
      monthMap.set(row.month, { month: label, _sort: row.month });
    }
    (monthMap.get(row.month) as any)[row.category] = row.total;
  }
  const wideData = [...monthMap.values()].sort((a, b) =>
    String(a._sort).localeCompare(String(b._sort))
  );
  const allCategories = [...new Set(rawData.map((r) => r.category))];
  return { wideData, allCategories };
}, [rawData]);
```

**Stacked BarChart JSX** (from MLFinanceiro.tsx lines 486–578, adapted):
```typescript
<ResponsiveContainer width="100%" height={280}>
  <BarChart data={wideData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
    <XAxis
      dataKey="month"
      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
      tickLine={false}
      axisLine={false}
    />
    <YAxis
      tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
      tickLine={false}
      axisLine={false}
      width={54}
    />
    <RechartsTooltip
      contentStyle={{ fontSize: 12, borderRadius: 8 }}
      formatter={(v: any) => currFmt(Number(v))}
    />
    <Legend wrapperStyle={{ fontSize: 11 }} />
    {allCategories.map((cat, i) => (
      <Bar
        key={cat}
        dataKey={cat}
        stackId="stack"
        fill={CATEGORY_COLORS[cat] ?? "#94a3b8"}
        maxBarSize={40}
        radius={i === allCategories.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
      />
    ))}
  </BarChart>
</ResponsiveContainer>
```

Note: `radius` applied only to the last (top) bar in the stack — same convention as MLFinanceiro.tsx line 563 (`radius={[3, 3, 0, 0]}` on last Bar).

---

### `src/components/financial/SupplierExposureChart.tsx` (component, recharts grouped BarChart)

**Analog:** `src/pages/mercadolivre/MLFinanceiro.tsx` lines 486–578 (recharts BarChart structure — no stackId = grouped)

**Imports pattern** (same as CostCompositionChart but no pivot needed):
```typescript
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupplierExposure } from "@/hooks/useSupplierExposure";
```

**Supplier name truncation helper:**
```typescript
const truncate = (s: string, n = 12) => s.length > n ? s.slice(0, n - 1) + "…" : s;
```

**Grouped BarChart JSX** (3 `<Bar>` without stackId = side-by-side groups):
```typescript
<ResponsiveContainer width="100%" height={280}>
  <BarChart
    data={exposureData}
    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
    barGap={2}
    barCategoryGap="20%"
  >
    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
    <XAxis
      dataKey="supplier"
      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
      tickLine={false}
      axisLine={false}
      tickFormatter={(s) => truncate(s)}
    />
    <YAxis
      tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
      tickLine={false}
      axisLine={false}
      width={56}
    />
    <RechartsTooltip
      contentStyle={{ fontSize: 12, borderRadius: 8 }}
      formatter={(v: any, name: string) => [currFmt(Number(v)), name]}
    />
    <Legend wrapperStyle={{ fontSize: 11 }} />
    <Bar dataKey="amount_30d" name="≤ 30d" fill="#3b82f6" maxBarSize={20} radius={[3, 3, 0, 0]} />
    <Bar dataKey="amount_60d" name="≤ 60d" fill="#f59e0b" maxBarSize={20} radius={[3, 3, 0, 0]} />
    <Bar dataKey="amount_90d" name="≤ 90d" fill="#ef4444" maxBarSize={20} radius={[3, 3, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
```

---

### `src/pages/mercadolivre/MLFluxoCaixa.tsx` *(modify)* (page, request-response)

**Analog:** itself — surgical edits only. Full file read above (lines 1–279).

**Removals (3 import lines + JSX block):**

Lines to DELETE from imports (lines 28–30):
```typescript
// DELETE these 3 lines:
import { TodayBalanceCard } from "@/components/financial/TodayBalanceCard";
import { ProjectedBalanceCard } from "@/components/financial/ProjectedBalanceCard";
import { CapacityCard } from "@/components/financial/CapacityCard";
```

**New imports to ADD** (after existing imports):
```typescript
import { TreasuryPanel } from "@/components/financial/TreasuryPanel";
import { CostCompositionChart } from "@/components/financial/CostCompositionChart";
import { SupplierExposureChart } from "@/components/financial/SupplierExposureChart";
```

**JSX replacement** — the grid block (lines 229–233):
```typescript
// REMOVE:
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  <TodayBalanceCard />
  <ProjectedBalanceCard />
  <CapacityCard />
</div>

// REPLACE WITH:
<TreasuryPanel />
```

**New chart grid to ADD** — below the existing CashFlowChart block (after line 258), within TabsContent value="real":
```typescript
{/* ── Composição de Custos e Exposição por Fornecedor ── */}
<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
  <CostCompositionChart />
  <SupplierExposureChart />
</div>
```

**Keep unchanged:** `AdjustBalanceDialog` component (lines 60–163), the Simulador TabsContent (lines 262–265), the sticky header (lines 214–216), `CashFlowChart` usage (lines 252–258), all imports not listed above.

---

## Shared Patterns

### SECURITY INVOKER + BRT timezone
**Source:** `supabase/migrations/20260619020000_cashflow_brt_timezone.sql` + RESEARCH.md §3
**Apply to:** all 3 new RPCs (`get_treasury_panel`, `get_cost_by_month`, `get_supplier_exposure`)
```sql
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
-- Inside function body:
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
```

### Hook boilerplate (TanStack Query v5)
**Source:** `src/hooks/useProjectedBalance.ts` lines 8–10, 27–44
**Apply to:** `useTreasuryPanel`, `useCostByMonth`, `useSupplierExposure`
```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

const { currentOrg } = useOrganization();
const orgId = currentOrg?.id ?? null;

return useQuery({
  queryKey: ["cashflow", "<key>", orgId] as const,
  enabled: !!orgId,
  staleTime: 3 * 60 * 1000,
  queryFn: async () => { if (!orgId) return null; ... }
});
```

### KPI coloring tokens
**Source:** `src/components/financial/TodayBalanceCard.tsx` lines 70–71, 93–104
**Apply to:** `TreasuryPanel.tsx` — all KPI values
```typescript
// Positive: income, positive balances
"text-kpi-positive"
// Negative: expenses, obligations, alerts
"text-kpi-negative"
// Neutral/informational: burn rate, runway
"text-kpi-neutral"
// Conditional:
v >= 0 ? "text-kpi-positive" : "text-kpi-negative"
```

### Currency formatter
**Source:** `src/components/financial/TodayBalanceCard.tsx` line 14 + `src/pages/mercadolivre/MLFinanceiro.tsx` line 49
**Apply to:** `TreasuryPanel.tsx`, `CostCompositionChart.tsx`, `SupplierExposureChart.tsx`
```typescript
const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
```

### Chart container + CartesianGrid style
**Source:** `src/pages/mercadolivre/MLFinanceiro.tsx` lines 486–522
**Apply to:** `CostCompositionChart.tsx`, `SupplierExposureChart.tsx`
```typescript
<ResponsiveContainer width="100%" height={280}>
  <BarChart ...>
    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
    <XAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
    <YAxis tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={54} />
```

### Supabase project ID rule
**Source:** `supabase/config.toml` line 1 + `.planning/STATE.md`
**Apply to:** migration file header comment + any MCP tool call
```
// Always: ckcdevcxgvueywivefgx
// Never: gionpsuunfkkzzjdubfy (old Lovable default — wrong project)
// Apply migrations via MCP apply_migration, NOT supabase db push
```

---

## No Analog Found

All files have analogs. No entries.

---

## Metadata

**Analog search scope:** `src/hooks/`, `src/components/financial/`, `src/pages/mercadolivre/`, `supabase/migrations/`
**Files scanned:** 12
**Pattern extraction date:** 2026-06-19
