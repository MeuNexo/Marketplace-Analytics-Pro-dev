# Phase 88: DRE — Frontend Resultado Completo (/vendas) - Research

**Researched:** 2026-07-06
**Domain:** React/TypeScript frontend integration — new read-only RPC consumption + UI section appended to an existing DRE card
**Confidence:** HIGH (all integration points read directly from source; no external libraries needed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Estrutura visual da DRE:** Receita → (−) impostos venda, comissão/tarifas ML, frete, CMV, ads = **Margem de contribuição / "lucro de marketplace"** (já existe no /vendas) → (−) **Pessoal, Estrutura, Serviços, Outros** = **Resultado operacional** → (−) **Financeiro** = **Resultado líquido**.
- **Fonte dos custos operacionais:** RPC `get_dre_operational_by_competence(p_org_id, p_month)` retorna blocos {impostos_venda, pessoal, estrutura, servicos, financeiro, outros_operacionais, excluido}. O frontend usa pessoal/estrutura/servicos/outros_operacionais/financeiro; IGNORA `excluido` e `impostos_venda` (esse já está na margem existente — não re-subtrair).
- **Financeiro:** mostrar com selo/badge **"aproximado"** quando `financeiro_is_approximate=true` (juro não separado do principal; pendente tabela do banco). Tooltip explicando.
- **Régua:** competência (o `p_month` = 1º dia do mês). Casar com o seletor de mês que a DRE atual já usa no /vendas.
- **Não re-derivar a margem** — ela já é composta client-side no `/vendas` (get_cost_waterfall + ml_billing). Phase 88 só ANEXA os blocos operacionais + calcula o resultado líquido (margem − custos operacionais).
- **Caso de validação:** junho/2026 deve mostrar resultado ≈ **−R$29k** (validado: margem +20.888 − pessoal 27.852 − financeiro 20.027 − serviços 1.953 − outros 150).
- **Visual:** consistente com o dashboard (tokens, BRL, semáforo de sinal +/−), **light+dark**, **mobile** (padrão Phase 78). Recharts se fizer gráfico; mas o núcleo é uma DRE em formato de tabela/waterfall.

### Claude's Discretion
(Not explicitly separated in CONTEXT.md — treat all non-decision implementation details, e.g. exact component boundaries, hook naming, tooltip mechanics, as discretionary as long as they match locked decisions and existing conventions below.)

### Deferred Ideas (OUT OF SCOPE)
- Reconciliação de impostos (DRE estima R$53k vs guias R$4,8k competência — timing/créditos Lucro Real) — fora desta fase.
- Classificação fina de `outros_operacionais` (Serviços gerais, Impostos-taxas) — quando Wesley definir.
- Separar juro/principal do financeiro (pendente tabela do banco).
</user_constraints>

<phase_requirements>
## Phase Requirements

No explicit REQ-IDs were provided in the phase dispatch (no REQUIREMENTS.md reference in scope). The single functional requirement, restated from CONTEXT.md, is:

| ID | Description | Research Support |
|----|-------------|------------------|
| DRE-88-01 | `/vendas` "DRE do Mês" card must append operational-cost blocks (Pessoal, Estrutura, Serviços, Outros) and Financeiro, then show Resultado líquido = margem − esses blocos | Section 1 (integration point), Section 6 (margin variable), Section 4 (RPC hook pattern) |
| DRE-88-02 | Month/org sent to RPC must match the DRE's own month navigator (not the page's date-range filter) | Section 2 |
| DRE-88-03 | Financeiro line must show an "aproximado" badge/tooltip when `financeiro_is_approximate=true` | Section 7 |
| DRE-88-04 | June/2026 must reconcile to ≈ −R$29k | Section 8 (validation data) |
</phase_requirements>

## Summary

This is a pure frontend integration phase: the backend RPC (`get_dre_operational_by_competence`) is already in production (Phases 86/87, migrations `20260687000000` + `20260687000100`), returns `SECURITY INVOKER`-protected rows scoped by RLS on `cash_outflows`, and needs zero backend work. The only work is (1) a new `useDreOperational(orgId, month)` react-query hook that copies the exact pattern of `src/hooks/useCostByMonth.ts`, and (2) a new UI block appended directly below the existing "Lucro do mês" row inside `src/components/mercadolivre/MLCostCard.tsx`, driven by data assembled in `src/pages/MercadoLivre.tsx`.

The trickiest fact for the planner: `MLCostCard.tsx` currently **computes "lucro" (the margin) internally** (line 68-72: `receitaMes - totalTarifas - (cmvMes ?? 0) - (impostosMes ?? 0)`) from props it receives — it is not exposed as a variable in `MercadoLivre.tsx`'s own scope. However, every input to that formula (`receitaMes`, `totalTarifasEfetivo`, `cmvMes`, `impostosMes`) already exists as a local variable in `MercadoLivre.tsx` (lines 253-289). The plan must NOT invent a new margin source — it should either (a) lift the `lucro` computation to `MercadoLivre.tsx` and pass it down as a new prop consumed by both the existing "Lucro do mês" row and the new operational section, or (b) recompute the identical formula inside the new operational sub-block using the same props already threaded through `MLCostCardProps`. Both are non-re-derivation (same source values), and (a) is cleaner (single source of truth, no duplicated formula).

The month to send as `p_month` is already computed in `MercadoLivre.tsx` as `billingMonthFrom` (line 219: `` `${billingMonth}-01` ``) — this is the exact "1st of month" date the RPC expects, and it already tracks the same ‹ › navigator (`handleDrePrevMonth` / `handleDreNextMonth`) that drives the rest of the DRE card. No new date logic is needed.

**Primary recommendation:** Add a new `useDreOperational(orgId, billingMonthFrom)` hook (copy of `useCostByMonth.ts`'s RPC pattern), lift `lucro` to a `MercadoLivre.tsx`-level `useMemo`, and render a new sub-section inside `MLCostCard.tsx` (or a new small child component `MLDreResultadoLiquido` rendered right after the "Lucro do mês" block) that maps blocos → labeled rows using the same `fmt`/token conventions already in the file, ending in a "Resultado líquido" row with the same `kpi-positive`/`kpi-negative` color logic as "Lucro do mês".

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Operational cost aggregation by competence month | Database (RPC `get_dre_operational_by_competence`) | — | Already built (Phase 87); pure SQL aggregation over `cash_outflows`, RLS-scoped |
| Fetching + caching operational blocks for the selected org/month | API/Backend boundary via Supabase client (react-query hook) | — | Standard `supabase.rpc()` + react-query pattern already used for `get_cost_waterfall`/`get_cost_by_month` |
| Combining margin (already client-side) + operational blocks into Resultado líquido | Frontend (React component state/derivation) | — | Margin is already computed client-side in `MercadoLivre.tsx`/`MLCostCard.tsx`; no backend combination needed, per locked decision "não re-derivar a margem" |
| Rendering DRE waterfall rows + "aproximado" badge | Browser/Client (React component, Tailwind tokens) | — | Pure presentational; reuses existing card/row/token patterns |
| Month/org selection state | Browser/Client (`MercadoLivre.tsx` local state: `dreMonthOverride`, `billingMonth`) | — | Already exists; Phase 88 only consumes it, does not add new state |

## Standard Stack

### Core
No new libraries are introduced. All required capabilities are already installed and in use in this codebase:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | 2.98.0 (installed, per STACK.md) | `.rpc()` call to `get_dre_operational_by_competence` | Same client used by every other RPC hook in `src/hooks/` |
| `@tanstack/react-query` | 5.83.0 | Cache/fetch the new hook's data | Matches `useCostByMonth`/`useMLCostWaterfall` pattern exactly |
| `framer-motion` | 12.38.0 | Optional entrance animation for the new section, consistent with `MLCostCard`'s `motion.div` wrapper | Already used by the parent card |
| `lucide-react` | 1.7.0 | Icons (`TrendingUp`/`TrendingDown` for Resultado líquido sign, `HelpCircle` for the "aproximado" tooltip trigger) | Already used in `MLCostCard.tsx` and `KPICard.tsx` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@radix-ui/react-popover` (via `src/components/ui/popover.tsx`) | shadcn wrapper, already installed | "aproximado" tooltip on hover/click | Copy the exact pattern from `KPICard.tsx` lines 96-119 (hover-triggered `Popover`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Popover-based tooltip (existing pattern) | shadcn `Tooltip` primitive (`src/components/ui/tooltip.tsx`, also installed) | `Tooltip` is simpler for a single static string but the codebase's own convention for this exact "small info icon next to a label" case (`KPICard`) uses `Popover`, not `Tooltip` — follow the existing convention for consistency |

**Installation:** None required — no new npm packages.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero external packages; every dependency used is already present in `package.json` and already imported elsewhere in the codebase (verified by grep, see Sources). No `npm install` step belongs in the plan.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────┐
│ Supabase (ckcdevcxgvueywivefgx) │
│                              │
│  cash_outflows (RLS: org)    │
│        │                     │
│        ▼                     │
│  get_dre_operational_by_     │
│  competence(p_org_id,        │◄──── SECURITY INVOKER, GRANT to authenticated
│  p_month) → rows             │       (already deployed, Phase 87)
│  {bloco, category, total,    │
│   n, financeiro_is_approx}   │
└───────────────┬──────────────┘
                │ supabase.rpc(...)
                ▼
┌─────────────────────────────────────────┐
│ src/hooks/useDreOperational.ts (NEW)     │
│  - orgId from useOrganization()          │
│  - p_month from billingMonthFrom (page)  │
│  - react-query: cache, map rows→typed obj│
│  - aggregate rows per bloco (sum totals) │
└───────────────┬───────────────────────────┘
                │ { data: DreOperationalBlocks }
                ▼
┌─────────────────────────────────────────┐
│ src/pages/MercadoLivre.tsx               │
│  - billingMonth / billingMonthFrom       │◄── existing month navigator state
│  - currentOrg.id (useOrganization)       │◄── existing org context
│  - receitaMes, totalTarifasEfetivo,      │
│    cmvMes, impostosMes (existing vars)   │
│  - NEW: lucroDoMes = margin formula      │◄── lift from MLCostCard, single
│         (lifted, single source of truth) │    source of truth
│  - calls useDreOperational(orgId,        │
│         billingMonthFrom)                │
└───────────────┬───────────────────────────┘
                │ props: lucroDoMes + dreOperational blocks
                ▼
┌─────────────────────────────────────────┐
│ MLCostCard.tsx (existing "DRE do Mês")   │
│   ... existing rows (Receita, Tarifas,   │
│       CMV, Impostos, Lucro do mês) ...   │
│   ▼ NEW SECTION appended after the       │
│     "Lucro do mês" block (line ~264):    │
│     (−) Pessoal                          │
│     (−) Estrutura                        │
│     (−) Serviços                         │
│     (−) Outros                           │
│     = Resultado operacional              │
│     (−) Financeiro [aproximado ⓘ]        │
│     = Resultado líquido  (kpi-pos/neg)   │
└─────────────────────────────────────────┘
```

### Recommended Project Structure
No new folders needed — additions land in existing locations:
```
src/
├── hooks/
│   └── useDreOperational.ts     # NEW — RPC hook, copy of useCostByMonth.ts pattern
├── components/mercadolivre/
│   └── MLCostCard.tsx           # MODIFIED — append operational section + lift lucro
└── pages/
    └── MercadoLivre.tsx         # MODIFIED — lift lucro calc, call new hook, pass new props
```

### Pattern 1: RPC hook returning grouped rows, mapped client-side
**What:** A react-query hook that calls a Postgres RPC returning long-format rows `{bloco/category, total}` and reduces them into a typed object on the client.
**When to use:** Whenever a new aggregate RPC is added and the frontend needs a stable shape regardless of which categories exist in a given month (some blocks may have zero rows, e.g. no "Estrutura" spend in a month with no rent line yet).
**Example:**
```typescript
// Source: src/hooks/useCostByMonth.ts (existing pattern to copy exactly)
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
        month: String(r.month),
        category: String(r.category),
        total: Number(r.total ?? 0),
      }));
    },
  });
}
```
For `useDreOperational`, the queryKey should be `["dre", "operational", orgId, month]`, `p_month` passed as the `billingMonthFrom` (YYYY-MM-DD, first of month) string, and the mapping should reduce rows into `{ pessoal, estrutura, servicos, financeiro, outros_operacionais, financeiro_is_approximate }` (summing `total` per `bloco`, ignoring rows where `bloco === 'excluido'` or `bloco === 'impostos_venda'` per the locked decision — though the RPC's own `WHERE`-free `GROUP BY` already returns all blocos, so the frontend must filter these two out explicitly, not the SQL).

### Pattern 2: Month navigation already wired — reuse, don't re-derive
**What:** `MercadoLivre.tsx` already has a self-contained "DRE month navigator" independent of the page's date-range filter (`dreMonthOverride` state + `billingMonth` derived value + `shiftDreMonth` callback + `handleDrePrevMonth`/`handleDreNextMonth`).
**When to use:** Any RPC that needs "the month currently shown in the DRE card" — always source it from `billingMonth`/`billingMonthFrom`, never from `currentFrom`/`currentTo` (those are the page-level date-range filter, a different concept).
**Example:**
```typescript
// Source: src/pages/MercadoLivre.tsx lines 182-224 (existing, read-only reference)
const filterMonth = useMemo(() => currentFrom.substring(0, 7), [currentFrom]);
const [dreMonthOverride, setDreMonthOverride] = useState<string | null>(null);
useEffect(() => { setDreMonthOverride(null); }, [filterMonth]);
const billingMonth = dreMonthOverride ?? filterMonth;              // "YYYY-MM"
const billingMonthFrom = useMemo(() => `${billingMonth}-01`, [billingMonth]); // → p_month
```
Pass `billingMonthFrom` directly as `p_month` to the new RPC — no reformatting needed (`get_dre_operational_by_competence` does `date_trunc('month', p_month)` server-side anyway, so exact day-of-month doesn't matter, but `-01` matches existing convention).

### Pattern 3: Row rendering — label + value with (−)/(=) prefix glyphs, `pct()` helper
**What:** Every cost line in `MLCostCard.tsx` follows the same JSX shape: a muted label with a `(−)` or `(=)` glyph, a right-aligned percentage-of-revenue chip, and a right-aligned bold currency value.
**When to use:** For every new operational-block row (Pessoal, Estrutura, Serviços, Outros, Financeiro) to keep visual consistency.
**Example:**
```tsx
// Source: src/components/mercadolivre/MLCostCard.tsx lines 220-242 (existing "Impostos próprios" row — closest template: value can be null/absent)
<div className="flex items-center justify-between text-xs py-1">
  <span className="text-muted-foreground flex items-center gap-1">
    <span className="text-muted-foreground/50">(−)</span>
    Pessoal
  </span>
  <div className="flex items-center gap-2">
    <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
      {pct(pessoal, receitaMes)}
    </span>
    <span className="font-semibold tabular-nums w-24 text-right text-foreground">
      {fmt(pessoal)}
    </span>
  </div>
</div>
```
The final "Resultado líquido" row should copy the "Lucro do mês" row's exact structure (lines 245-264), including the `TrendingUp`/`TrendingDown` icon swap and `text-kpi-positive`/`text-kpi-negative` classes, so the two totals (lucro do mês → resultado líquido) read as visually parallel "before/after" figures.

### Anti-Patterns to Avoid
- **Re-deriving the margin from `get_cost_waterfall` a second time inside the new section:** the margin is already fully computed by `MercadoLivre.tsx`/`MLCostCard.tsx`. Do not call `useMLCostWaterfall` again or recompute `receitaMes - totalTarifas - cmv - impostos` with different variable names — reuse the exact existing values (lift, don't duplicate).
- **Subtracting `impostos_venda` from the RPC:** it is already inside the existing margin (via `impostosMes`/`dreWaterfall.total_tax`). Subtracting it again would double-count and break the −R$29k reconciliation.
- **Including the `excluido` bloco:** contains `Fornecedores`, `ADS Mercado Livre`, `Cartão de crédito`, etc. — items already counted elsewhere (CMV, ads spend, ML billing). Must be filtered out client-side (the RPC returns it; nothing in SQL removes it from the result set).
- **Sourcing the month from `currentFrom`/`currentTo` (page filter) instead of `billingMonth`/`billingMonthFrom` (DRE card's own navigator):** these are two independent pieces of state; using the wrong one breaks the ‹ › navigation UX inside the DRE card (Phase 41/84 precedent).
- **New dual mobile/desktop JSX branches:** unlike `MLAnuncios` (which has a documented dual-layout footgun per project memory), `MLCostCard` uses a single responsive JSX tree with Tailwind breakpoint classes (`grid grid-cols-1 lg:grid-cols-6`). Do not introduce a second mobile-only render branch — extend the single tree so both breakpoints stay in sync automatically.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| BRL currency formatting | New inline `toLocaleString` calls | `formatCurrency`/`formatCurrencyCompact` from `src/lib/formatters.ts` — **however note**: `MLCostCard.tsx` itself uses a local `fmt()` (line 6-7, `maximumFractionDigits: 0`) rather than the centralized formatter. For visual consistency with the rest of the same card, reuse the file-local `fmt()`/`pct()` helpers already defined at the top of `MLCostCard.tsx`, not `src/lib/formatters.ts`, so all rows in the same card render with identical decimal precision. |
| Positive/negative sign coloring | Hardcoded green/red hex | Tailwind's `text-kpi-positive` / `text-kpi-negative` (backed by `--kpi-positive`/`--kpi-negative` CSS vars, defined for both `:root` and `.dark` in `src/index.css` lines 85-87 and 162-164) | Automatic light/dark support, matches every other KPI in the app |
| Info tooltip icon | Custom hover div | Copy `KPICard.tsx`'s `Popover`+`HelpCircle` pattern (lines 96-119) | Already accessible (`aria-label`), already handles hover+click, already themed |
| RPC data fetching/caching | `useEffect` + `useState` fetch | `@tanstack/react-query` `useQuery`, following `useCostByMonth.ts`/`useMLCostWaterfall.ts` | Matches every other data hook in the codebase; gets caching, retries, loading state for free |

**Key insight:** Nothing in this phase requires a new abstraction — it is entirely a "copy an existing pattern one more time" phase. The risk is not in inventing new code, it's in accidentally re-deriving or double-counting values that already exist upstream.

## Runtime State Inventory

Not applicable — this phase is a pure additive frontend feature, not a rename/refactor/migration. No runtime state category is affected: no renamed keys, no re-registered OS/service state, no data migration. (Confirmed: phase only reads an existing RPC and existing frontend state; it makes no schema or naming changes.)

## Common Pitfalls

### Pitfall 1: Double-counting `impostos_venda` or the `excluido` bloco
**What goes wrong:** Resultado líquido comes out lower than −R$29k (e.g. subtracting ICMS/PIS/COFINS twice, or subtracting `Fornecedores`/`ADS Mercado Livre` a second time on top of CMV/ads already in the margin).
**Why it happens:** The RPC returns ALL blocos including `impostos_venda` and `excluido` — the frontend, not the SQL, is responsible for filtering to only `pessoal | estrutura | servicos | outros_operacionais | financeiro`.
**How to avoid:** In the hook or in the consuming component, explicitly `.filter(r => !['impostos_venda', 'excluido'].includes(r.bloco))` (or use an allow-list of the 5 wanted blocos) before summing.
**Warning signs:** Resultado líquido for June/2026 deviates materially from −R$29k.

### Pitfall 2: Using the wrong month source
**What goes wrong:** The new operational section shows data for a different month than what the "Receita do mês"/"Lucro do mês" rows above it show, because it was wired to `currentFrom`/`currentTo` (page date-range filter) instead of `billingMonth`/`billingMonthFrom` (DRE's own navigator).
**Why it happens:** `MercadoLivre.tsx` has two independent month/date concepts in the same file; it's easy to grab the wrong one when skimming.
**How to avoid:** Always source `p_month` from `billingMonthFrom` (line 219 in current file), the same value that already drives `dailyBilling`/`billingData`/`filterMonthWaterfall` for this card.
**Warning signs:** Navigating with ‹ › changes the margin rows but not the new operational rows (or vice versa).

### Pitfall 3: Missing zero-row blocos rendering as "R$0" instead of an honest empty state
**What goes wrong:** A month with no "Estrutura" spend (no rows with that bloco) silently renders `R$ 0,00` for Estrutura, which is factually correct but visually indistinguishable from "we have no data for this line" — less of a bug, more a UX ambiguity worth flagging to the planner.
**Why it happens:** The RPC only returns rows that exist in `cash_outflows` for that org/month; blocos with zero spend simply don't appear in the result set (not returned as 0).
**How to avoid:** In the hook's reduce step, default every bloco key to `0` explicitly (do not rely on `undefined` coalescing silently) so the UI can always render a row; this is true "no cost that month" and rendering `R$ 0,00` is correct — no special empty-state UI is needed per CONTEXT.md scope, but the planner should decide explicitly rather than let it happen by accident.
**Warning signs:** None — this is a design-decision reminder, not a defect to catch.

### Pitfall 4: `financeiro_is_approximate` computed per-row, not per-bloco
**What goes wrong:** The RPC returns `financeiro_is_approximate` as a column on every row (`(co.category = 'Empréstimo')`), not as a single flag for the whole `financeiro` bloco. If the frontend takes the flag from an arbitrary row instead of specifically checking "does the financeiro bloco contain any row where this is true", it could pick the wrong row if `financeiro` ever has other categories added later.
**Why it happens:** SQL returns this per-category-row for simplicity (there is currently only one category, `Empréstimo`, mapped to `financeiro`), so today `.some(r => r.bloco === 'financeiro' && r.financeiro_is_approximate)` and `.find(...)` behave identically — but the safer client-side logic is `.some(...)`, matching intent, not incidental row order.
**How to avoid:** In the hook, derive `financeiro_is_approximate = rows.filter(r => r.bloco === 'financeiro').some(r => r.financeiro_is_approximate)`.
**Warning signs:** None currently reproducible with today's single-category `financeiro` bloco, but this is the more correct implementation for future-proofing.

## Code Examples

### The margin formula to lift (currently trapped inside MLCostCard, must become shared)
```typescript
// Source: src/components/mercadolivre/MLCostCard.tsx lines 67-74 (current, component-local)
const lucro =
  receitaMes
  - totalTarifas
  - (cmvMes ?? 0)
  - (impostosMes ?? 0);
const lucroPositivo = lucro >= 0;
const margemPct = receitaMes > 0 ? ((lucro / receitaMes) * 100).toFixed(1) : "—";
```
All four inputs (`receitaMes`, `totalTarifas` i.e. `totalTarifasEfetivo`, `cmvMes`, `impostosMes`) are already local variables in `src/pages/MercadoLivre.tsx` (lines 253-255 and 286-289). The plan should either lift this exact block into a `useMemo` in `MercadoLivre.tsx` and pass `lucro` down as a new `MLCostCardProps` field (e.g. `lucroDoMes: number`), or accept the small duplication of recomputing it once more inside the new sub-section using props already passed to `MLCostCard`. Lifting is preferred (DRY, single source of truth) but either satisfies "não re-derivar a margem" since no new inputs are invented.

### RPC row shape (from the deployed migration, for the hook's TypeScript interface)
```sql
-- Source: supabase/migrations/20260687000100_dre_exclude_credit_card.sql (current live function)
RETURNS TABLE (
  bloco                     text,   -- 'impostos_venda' | 'pessoal' | 'estrutura' | 'servicos' | 'financeiro' | 'excluido' | 'outros_operacionais'
  category                  text,   -- e.g. 'Salários', 'Empréstimo', 'Contabilidade'
  total                     numeric,
  n                         integer,
  financeiro_is_approximate boolean
)
```

### Org id + Organization type (for the new hook's signature)
```typescript
// Source: src/contexts/OrganizationContext.tsx lines 7-13
export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  role: OrgRole;
}
// consumed as: const { currentOrg } = useOrganization(); const orgId = currentOrg?.id ?? null;
```

## State of the Art

Not applicable in the "old vs new library approach" sense — this is a same-codebase pattern replication, not a technology upgrade. No deprecated APIs are involved.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Lifting the `lucro` calculation to `MercadoLivre.tsx` (rather than recomputing it a second time inside a new sub-component) is the preferred approach for the planner to choose | Summary / Code Examples | Low — both approaches are functionally identical (same inputs, same formula); this is a code-organization preference, not a correctness question. If the planner picks the alternative (recompute in place), no behavior changes. |
| A2 | The "aproximado" badge should use the existing `Popover`+`HelpCircle` pattern from `KPICard.tsx` rather than the shadcn `Tooltip` primitive | Standard Stack / Don't Hand-Roll | Low — both primitives are already installed; using `Tooltip` instead would still satisfy the requirement, just diverge slightly from the one existing precedent (`KPICard`) in this codebase for "small info icon next to a label." |

**If this table is empty:** N/A — see above; both entries are LOW-risk implementation-detail assumptions, not unverified facts about data, compliance, or external services. All data-shape and integration-point claims in this document were verified directly against source files in this repo (migrations, hooks, components) during this research session.

## Open Questions

1. **Component boundary: extend `MLCostCard.tsx` in place, or extract a new child component?**
   - What we know: `MLCostCard.tsx` is already 271 lines; adding ~5 more rows + a "Resultado líquido" total row + an "aproximado" badge will push it past 320-350 lines. The existing file has no sub-component extraction precedent for its own rows (all inline JSX).
   - What's unclear: Whether the planner should keep everything inline in `MLCostCard.tsx` (simplest diff, matches current file's own style) or extract a small `MLDreOperationalSection` component that `MLCostCard.tsx` renders inside its `CardContent`.
   - Recommendation: Given the file's current single-block style and that the new section is tightly coupled to `MLCostCard`'s existing `fmt`/`pct` helpers and props, keep it inline in `MLCostCard.tsx` unless the plan's line-count/readability standard forces extraction. Either choice satisfies all locked decisions.

2. **Loading/error state for the new RPC while the rest of the card has already loaded**
   - What we know: `MLCostCard.tsx` currently has a single `loading` prop that skeleton-loads the *entire* card (lines 137-142). The new operational data comes from a separate hook (`useDreOperational`) with its own `isLoading`.
   - What's unclear: Whether the plan should (a) gate the whole card's loading state on both hooks (`dreWaterfallLoading || dreOperationalLoading`), showing one unified skeleton, or (b) let the margin rows render as soon as they're ready and skeleton-load only the new operational rows independently.
   - Recommendation: Option (b) is better UX (progressive reveal, matches the fact that these are two independently-fetched data sources) but requires a second internal loading branch inside `CardContent`. Option (a) is a one-line change (`||` the two loading flags) and simpler to implement/verify. Given CONTEXT.md doesn't specify, either is acceptable; (a) is lower-risk for a single-plan phase.

## Environment Availability

Skipped — no external tool/service/runtime dependency is introduced by this phase beyond the Supabase project already configured and reachable (`ckcdevcxgvueywivefgx`, confirmed live via the already-deployed RPC in migrations 20260687000000/100). No CLI, database engine, or new SDK needs to be probed.

## Validation Architecture

Skipped — `.planning/config.json` has `"nyquist_validation": false`.

For the planner's own reference (informal, not a formal validation-architecture section): this repo uses `vitest` (`npm test` → `vitest run`), with hook tests following the pattern in `src/hooks/useMLClaims.test.ts` (mock `@/integrations/supabase/client`'s `.rpc`/`.from`, mock `@/contexts/OrganizationContext`'s `useOrganization`, wrap `renderHook` in a `QueryClientProvider`). A `useDreOperational.test.ts` should follow this exact scaffold, asserting: (a) the five wanted blocos are summed correctly, (b) `impostos_venda` and `excluido` rows are excluded from the sum, (c) `financeiro_is_approximate` is derived via `.some()` over rows with `bloco === 'financeiro'`, and (d) the hook is `enabled: false` when `orgId` is null.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | No new auth surface; existing Supabase session reused |
| V3 Session Management | No | No change |
| V4 Access Control | Yes | RPC is `SECURITY INVOKER` + RLS on `cash_outflows` scoped by `organization_id` (already verified anti-IDOR in Phase 87, per project memory: "0 rows for foreign org_id"). Frontend must still always source `p_org_id` from `currentOrg.id` (never accept an org id from user input/URL) — matches existing convention in every hook in `src/hooks/`. |
| V5 Input Validation | Yes | `p_month` is a client-derived date string (`billingMonthFrom`), not raw user text; no new validation needed beyond existing month-string derivation already used for `p_month`-shaped calls elsewhere in the file. |
| V6 Cryptography | No | No new cryptographic operation |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| IDOR via org_id passed from client state instead of session-derived context | Elevation of Privilege | Already mitigated at the RPC layer (`SECURITY INVOKER` + RLS); frontend must not introduce a second org id source (e.g. from a URL param) — always `currentOrg.id` from `useOrganization()`, exactly as every existing hook does. |

## Sources

### Primary (HIGH confidence — read directly from this repo's source during this session)
- `/root/garment-glow-dre/src/pages/MercadoLivre.tsx` (lines 96-403, 745-813) — month navigator, org id, margin inputs, MLCostCard usage
- `/root/garment-glow-dre/src/components/mercadolivre/MLCostCard.tsx` (full file) — existing DRE card JSX, margin formula, row patterns, fmt/pct helpers
- `/root/garment-glow-dre/src/hooks/useCostByMonth.ts` — RPC-hook pattern to copy for `useDreOperational`
- `/root/garment-glow-dre/src/hooks/useMLCostWaterfall.ts` — second reference RPC-hook pattern
- `/root/garment-glow-dre/src/contexts/OrganizationContext.tsx` — `useOrganization()`/`Organization` type
- `/root/garment-glow-dre/src/lib/formatters.ts` — centralized formatters (not used by MLCostCard itself, noted as a divergence)
- `/root/garment-glow-dre/src/index.css` (lines 85-87, 162-164) + `/root/garment-glow-dre/tailwind.config.ts` (lines 71-75) — `kpi-positive`/`kpi-negative`/`kpi-neutral` tokens, light+dark
- `/root/garment-glow-dre/src/components/dashboard/KPICard.tsx` (lines 69, 96-119) — Popover-based info-tooltip pattern to reuse for "aproximado"
- `/root/garment-glow-dre/src/components/financial/CostCompositionChart.tsx` — category-color/formatting conventions (secondary reference, chart not required per CONTEXT.md's "núcleo é uma DRE em tabela/waterfall")
- `/root/garment-glow-dre/supabase/migrations/20260687000000_get_dre_operational_by_competence.sql` and `20260687000100_dre_exclude_credit_card.sql` — live RPC definition, bloco mapping, anti-IDOR/SECURITY INVOKER, `financeiro_is_approximate` semantics
- `/root/garment-glow-dre/src/hooks/useMLClaims.test.ts` — test scaffold pattern (mocking `supabase`, `useOrganization`, react-query wrapper)
- `/root/garment-glow-dre/.planning/phases/88-dre-frontend-resultado-completo-vendas/88-CONTEXT.md` — locked decisions
- `/root/garment-glow-dre/CLAUDE.md` — project stack/conventions/architecture

### Secondary (MEDIUM confidence)
- None used beyond primary sources — this phase required no web research; all facts are verifiable directly in the repository.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; every pattern verified by reading existing, already-shipped code in this exact repo
- Architecture: HIGH — integration point, month source, and org source all located and read directly (file+line references above)
- Pitfalls: HIGH for the double-counting/month-source pitfalls (directly derived from the RPC SQL and CONTEXT.md's own math); MEDIUM for the "financeiro_is_approximate per-row vs per-bloco" pitfall (currently un-reproducible with only one category in that bloco today, but correct as a forward-looking implementation detail)

**Research date:** 2026-07-06
**Valid until:** 30 days (stable internal codebase, RPC already frozen in production; re-verify if the `get_dre_operational_by_competence` bloco mapping changes, e.g. new `cash_outflows` categories added)

## Project Constraints (from CLAUDE.md)

- **Named exports** for components/hooks (no default exports) — `useDreOperational` and any extracted component must use `export function ...`.
- **Props interfaces defined inline, above the component**, in the same file (e.g. `interface DreOperationalBlocks { ... }` at the top of the new hook file).
- **Hooks named `use<PascalCase>`** in `use<Name>.ts` files — `src/hooks/useDreOperational.ts`.
- **TanStack React Query is the primary data-fetching pattern** — do not use `useEffect`+`useState` fetch for the new hook.
- **Design tokens via CSS custom properties** (`--kpi-positive`/`--kpi-negative`) — do not hardcode colors for the Resultado líquido sign.
- **Pages lazy-loaded, wrapped in `ErrorBoundary`** in `App.tsx` — no change needed since `/vendas` (`MercadoLivre.tsx`) already has this; the new section is additive within the same page.
- **`RoleRoute`/`ProtectedRoute`** already gate `/` (Vendas, `ALL` roles) — no new route-level auth changes needed.

## RESEARCH COMPLETE
