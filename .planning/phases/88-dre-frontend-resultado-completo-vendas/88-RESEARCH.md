# Phase 88: DRE — Frontend Resultado Completo (/vendas) - Research

**Researched:** 2026-07-08
**Domain:** React/TanStack Query frontend extension consuming an existing Postgres RPC (Supabase). No new libraries, no backend changes.
**Confidence:** HIGH — every claim below is grounded in direct code reads of this repo (file:line references throughout), not external docs.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Estender **"DRE do Mês"** (`src/components/mercadolivre/MLCostCard.tsx`) em `/vendas` para mostrar o **resultado completo**: hoje ela para em "Lucro do mês". Phase 88 continua a cascata para baixo com os **custos operacionais + financeiro** vindos da RPC da Phase 87, chegando a **Resultado operacional** e **Resultado líquido**.
- SÓ frontend + wiring de hook. NÃO mexer nas RPCs (86/87) nem na metodologia de receita/CMV/impostos (já correta, vinda de `orders`). NÃO tocar `get_cashflow`/DFC.
- Cascata completa (ordem LOCKED — ROADMAP SC-1): Receita − impostos s/ venda − comissão/tarifas ML − frete − CMV − ads = **Margem de contribuição** → − Pessoal/Estrutura/Serviços/Operacional/Não classificado = **Resultado operacional** → − Financeiro (Empréstimo) = **Resultado líquido**.
- Buscar `get_dre_operational_by_competence(org, mês)` para o mês selecionado (mesmo mês do card). Agrupar por `bloco`: **pessoal, estrutura, servicos, operacional, nao_classificado** somam para **Resultado operacional**; **financeiro** desce para o **Resultado líquido**.
- **NÃO exibir o bloco `excluido`** na cascata (pode ir num "ver detalhes" colapsado, opcional).
- **`operacional` com `double_count_risk=true` (cartão de crédito):** mostrar aviso/tooltip discreto — não esconder, não netar automático.
- **`nao_classificado`:** exibir visível como linha própria — princípio "não esconder" do Wesley.
- Anti-IDOR já garantido na RPC (INVOKER + RLS); o frontend só passa a org do contexto.
- Reconciliação de junho/2026 já provada no backend (Phase 87, delta R$0,00) — o frontend deve BATER com esses números para o mesmo mês.
- Mesmos tokens/estilo do `MLCostCard` atual (BRL via `toLocaleString`, tabular-nums, light/dark, mobile). Subtotais destacados com hierarquia visual. Sinal semântico verde/vermelho no líquido.

### Claude's Discretion
- Modo previsão × apuração (toggle CMV médio↔cheio, imposto estimado↔guia real): CONTEXT explicitly says "Surface como pergunta no plano, NÃO decidir sozinho" — this is an OPEN planning-time decision, not something research or planning should resolve unilaterally.
- Whether/how to render the `excluido` bloco in a collapsed "ver detalhes" (optional per CONTEXT).

### Deferred Ideas (OUT OF SCOPE)
- Mudar RPCs 86/87 ou a metodologia de receita/CMV/imposto (já decidida).
- IRPJ/CSLL/FGTS (empresa não recolhe).
- Alinhamento de régua venda×competência no backend (é ajuste de dado/EF, não frontend) — só sinalizar na UI se houver descasamento.
</user_constraints>

<phase_requirements>
## Phase Requirements

This phase has no formal `REQ-ID` list in CONTEXT.md; the ROADMAP Success Criteria referenced are SC-1/SC-2/SC-3 (frontend-facing), mapped below to research support.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Cascata completa renderizada em ordem: Margem de contribuição → Resultado operacional → Resultado líquido | Goal #1 (exact prop wiring) + Goal #4 (rendering plan) below |
| SC-2 | Consistência visual com o card atual (tokens, dark/light, mobile) | Goal #4 — reuses exact row/subtotal CSS classes already in `MLCostCard.tsx` |
| SC-3 | Não duplicar imposto sobre venda (hand-off flag from Phase 87) | Pitfall 1 below — critical, must be resolved by the plan before implementation |
</phase_requirements>

## Summary

`MLCostCard.tsx` is a pure presentational component; all its data comes from `src/pages/MercadoLivre.tsx` (the `/vendas` page, renders at route `/`). The page already computes a `billingMonth` string (`"YYYY-MM"`) and a `billingMonthFrom` date string (`"YYYY-MM-DD"`, first of month) that drive the card's month navigation — this is the exact `p_month` value the Phase 87 RPC needs, so **no new month-state plumbing is required**, only reusing what exists.

The extension is a pure additive frontend change: (1) a new hook `useDreOperational(orgId, month)` calling `supabase.rpc("get_dre_operational_by_competence", { p_org_id, p_month })`, following the exact pattern already used by `useCostByMonth.ts` and `useMLCostWaterfall.ts`; (2) new props on `MLCostCard` for the operational blocks + financeiro; (3) new JSX rows appended after the existing "Lucro do mês" block, renamed conceptually to "Margem de contribuição", reusing the same Tailwind classes already in the file. The RPC blocks `pessoal/estrutura/servicos/operacional/nao_classificado` sum to Resultado operacional; `financeiro` (Empréstimo) subtracts further to Resultado líquido; `excluido` is dropped from the cascade; `impostos_venda` must NOT be rendered in the new cascade (see Pitfall 1 — this is the single highest-risk decision in this phase).

**Primary recommendation:** Add `useDreOperational` as a sibling hook file to `useCostByMonth.ts` (identical `supabase.rpc` + `useOrganization` pattern), feed it `billingMonthFrom` (already computed in `MercadoLivre.tsx`), group the 5-row result client-side into the two subtotals, and extend `MLCostCardProps` with `blocosOperacionais` + `financeiro` (or similar) — filtering out `impostos_venda` and `excluido` before they ever reach the component.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DRE operational aggregation (bloco/category/total) | Database / Storage (RPC) | — | Already built in Phase 87 as `get_dre_operational_by_competence`; SECURITY INVOKER + RLS enforce org isolation server-side. Phase 88 must not duplicate this logic client-side. |
| Month-state / selected period | Frontend (API/Backend? No — pure client) | — | `MercadoLivre.tsx` page component owns `billingMonth`/`billingMonthFrom` React state; already exists, must be reused, not duplicated. |
| RPC fetch + caching | Frontend (React Query hook) | — | `useDreOperational` hook, same tier as `useCostByMonth`/`useMLCostWaterfall` — TanStack Query wraps `supabase.rpc(...)`. |
| Bloco→cascade grouping (sum pessoal+estrutura+servicos+operacional+nao_classificado; drop excluido/impostos_venda) | Frontend (hook or component) | — | Simple client-side reduce over 5-10 rows; RPC already pre-aggregates by category, so no re-aggregation of raw rows is needed — just a sum-by-bloco filter. Cheap enough to do in the hook or inline in the page; no backend round-trip needed. |
| Rendering (rows, subtotals, tooltips, light/dark, mobile) | Browser / Client | — | `MLCostCard.tsx`, pure presentational component — extend with new props, same Tailwind token classes. |
| Anti-IDOR / tenant isolation | Database / Storage (RLS) | — | Already proven in Phase 87 (SECURITY INVOKER, `is_org_member`); frontend only passes `currentOrg.id`, never constructs its own tenant boundary. |

## Standard Stack

No new packages. This phase reuses the existing stack exactly as documented in `CLAUDE.md`/`STACK.md`:

| Library | Version | Purpose | Why Standard (already in use here) |
|---------|---------|---------|-------------------------------------|
| `@tanstack/react-query` | 5.83.0 | RPC data fetching/caching | Every `use*` hook in `src/hooks/` uses this — `useCostByMonth`, `useMLCostWaterfall`, `useMLBilling*` all follow the identical `useQuery({ queryKey, queryFn, enabled, staleTime })` shape. |
| `@supabase/supabase-js` | 2.98.0 | `.rpc()` client call | `supabase.rpc("get_dre_operational_by_competence", { p_org_id, p_month })` — identical call shape to `useCostByMonth.ts:28` (`get_cost_by_month`) and `useMLCostWaterfall.ts:37` (`get_cost_waterfall`). |
| shadcn/ui `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider` | (Radix-based, already installed) | `double_count_risk` discreet warning on the Cartão de crédito operational line | Already imported and used identically in `src/components/mercadolivre/ReplenishmentSkuTable.tsx:6-10` for a `HelpCircle` icon + tooltip pattern — directly reusable verbatim. |
| `lucide-react` | 1.7.0 | Icons (`TrendingUp`/`TrendingDown`/`HelpCircle`/`ChevronDown` for optional collapse) | Already imported in `MLCostCard.tsx:3`. |
| `framer-motion` | 12.38.0 | Card entrance animation | Already wraps the whole card (`MLCostCard.tsx:77`) — no new animation needed for the new rows (they render inside the same `motion.div`). |

### Installation
No installation required — zero new dependencies.

## Package Legitimacy Audit

Not applicable — this phase installs zero external packages (pure frontend code reusing existing dependencies and one already-deployed RPC).

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  src/pages/MercadoLivre.tsx  (/vendas route "/")                    │
│                                                                       │
│  billingMonth ("YYYY-MM")  ──┬──> useMLBillingDailyWithSync(month)   │
│  billingMonthFrom (date)     │      (tarifas: gruposTarifas)         │
│  billingMonthTo   (date)     │                                        │
│                               ├──> useMLCostWaterfall(from,to)        │
│                               │      (receitaMes/cmvMes/impostosMes) │
│                               │                                        │
│                               └──> useDreOperational(orgId, month) ◄── NEW
│                                      (blocosOperacionais + financeiro)│
│                                             │                          │
│                                             ▼                          │
│                              supabase.rpc("get_dre_operational_       │
│                                    by_competence", {p_org_id, p_month})│
│                                             │                          │
│                                             ▼                          │
│                    Postgres RPC (SECURITY INVOKER + RLS is_org_member)│
│                    reads cash_outflows, groups by bloco/category      │
│                                             │                          │
│                                             ▼ rows: {bloco, category,  │
│                                                total, n, double_count_ │
│                                                risk}                   │
│                                             │                          │
│  All props merge here ──────────────────────┘                        │
│         │                                                              │
│         ▼                                                              │
│  <MLCostCard receitaMes cmvMes impostosMes gruposTarifas               │
│      blocosOperacionais={...} financeiro={...}   ◄── NEW props        │
│      double_count_risk flags, nao_classificado total />               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        src/components/mercadolivre/MLCostCard.tsx (presentational)
        Receita → tarifas → CMV → impostos → "Margem de contribuição"
        (renamed from "Lucro do mês")
        → Pessoal/Estrutura/Serviços/Operacional/Não classificado rows
        → "Resultado operacional" subtotal
        → Financeiro (Empréstimo) row
        → "Resultado líquido" subtotal (green/red signal)
```

### Recommended Project Structure
No new files/folders beyond one new hook — matches existing flat structure:
```
src/
├── hooks/
│   └── useDreOperational.ts       # NEW — mirrors useCostByMonth.ts pattern
├── components/mercadolivre/
│   └── MLCostCard.tsx             # EXTENDED — new props + JSX rows after "Lucro do mês"
└── pages/
    └── MercadoLivre.tsx           # EXTENDED — wire useDreOperational(orgId, billingMonthFrom), pass new props
```

### Pattern 1: RPC-backed hook (exact analog to copy)
**What:** A TanStack Query hook that calls a Postgres RPC scoped by `p_org_id`, following the codebase's established convention.
**When to use:** Any time a new server-aggregated dataset (already computed by an RPC) needs to reach a component.
**Example — direct analog, `src/hooks/useCostByMonth.ts` (verbatim, lines 1-41):**
```typescript
// Source: src/hooks/useCostByMonth.ts (this repo)
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface CostByMonthRaw {
  month:    string;   // "2026-04" (YYYY-MM)
  category: string;
  total:    number;
}

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

**Recommended new hook, following this pattern exactly** (illustrative — planner/executor writes the real file):
```typescript
// src/hooks/useDreOperational.ts — NEW, modeled on useCostByMonth.ts above
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export type DreBloco =
  | "impostos_venda" | "pessoal" | "estrutura" | "servicos"
  | "operacional" | "financeiro" | "excluido" | "nao_classificado";

export interface DreOperationalRow {
  bloco: DreBloco;
  category: string;
  total: number;
  n: number;
  double_count_risk: boolean;
}

/** p_month must be a first-of-month date string ("YYYY-MM-01") — same axis as
 *  billingMonthFrom already computed in MercadoLivre.tsx. */
export function useDreOperational(pMonth: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<DreOperationalRow[]>({
    queryKey: ["dre", "operational", orgId, pMonth] as const,
    enabled: !!orgId && !!pMonth,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DreOperationalRow[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase.rpc("get_dre_operational_by_competence", {
        p_org_id: orgId,
        p_month: pMonth,
      });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        bloco: r.bloco as DreBloco,
        category: String(r.category),
        total: Number(r.total ?? 0),
        n: Number(r.n ?? 0),
        double_count_risk: Boolean(r.double_count_risk),
      }));
    },
  });
}
```

### Pattern 2: Month-axis reuse (no new state)
**What:** `MercadoLivre.tsx` already computes `billingMonthFrom` (first-of-month `"YYYY-MM-DD"` string, `MercadoLivre.tsx:219`) to instantiate `useMLCostWaterfall` for the exact calendar month shown in the card. This is the SAME axis the RPC 87 needs (`p_month date`, competence month with `outflow_date` fallback — also a calendar month).
**When to use:** Call `useDreOperational(billingMonthFrom)` right next to the existing `useMLCostWaterfall(...)` call (`MercadoLivre.tsx:227`) — no new date derivation needed.
**Example:**
```typescript
// Source: src/pages/MercadoLivre.tsx (existing, line 219 + 227) — pattern to extend
const billingMonthFrom = useMemo(() => `${billingMonth}-01`, [billingMonth]);
// ... existing ...
const { data: filterMonthWaterfall } = useMLCostWaterfall(
  billingMonthIsCurrentMonth ? monthlyFrom : billingMonthFrom,
  billingMonthIsCurrentMonth ? monthlyTo   : billingMonthTo,
);
// NEW — same month axis, no new date math:
const { data: dreOperationalRows } = useDreOperational(billingMonthFrom);
```
Note one nuance: when `billingMonthIsCurrentMonth` is true, the waterfall switches to `monthlyFrom`/`monthlyTo` (always current calendar month, independent of filter) rather than `billingMonthFrom`. For full axis parity, pass `monthlyFrom` (not `billingMonthFrom`) to `useDreOperational` when `billingMonthIsCurrentMonth` — i.e. mirror the exact same ternary already used for the waterfall call, since `monthlyFrom` and `billingMonthFrom` are both first-of-month strings and interchangeable in format.

### Pattern 3: Client-side bloco grouping (no backend round-trip)
**What:** The RPC already returns pre-aggregated `(bloco, category, total, n, double_count_risk)` rows (5-10 rows per month, per the June/2026 reconciliation in `87-01-SUMMARY.md`: 7 blocos total that month). Group client-side with a simple reduce.
**Example:**
```typescript
const OPERACIONAL_BLOCOS = ["pessoal", "estrutura", "servicos", "operacional", "nao_classificado"] as const;

const resultadoOperacionalRows = (dreOperationalRows ?? []).filter(r => OPERACIONAL_BLOCOS.includes(r.bloco as any));
const resultadoOperacionalTotal = resultadoOperacionalRows.reduce((s, r) => s + r.total, 0);

const financeiroRows = (dreOperationalRows ?? []).filter(r => r.bloco === "financeiro");
const financeiroTotal = financeiroRows.reduce((s, r) => s + r.total, 0);

// impostos_venda and excluido are DELIBERATELY not consumed here — see Pitfall 1.
```

### Anti-Patterns to Avoid
- **Re-implementing the category→bloco map in the frontend:** The map is already correctly implemented server-side in the `20260692000000_dre_operational_reconcile_context_map.sql` migration (Phase 87). Duplicating it client-side risks drift if Wesley adds a new Tiny category later. Always consume `bloco` from the RPC row, never re-derive from `category` client-side.
- **Rendering `excluido` in the main cascade:** CONTEXT explicitly forbids this — it's CMV/capital/other-channel, already handled elsewhere. If shown at all, it belongs in a collapsed "ver detalhes" section, never summed into the visible totals.
- **Silently netting `double_count_risk=true` rows:** CONTEXT explicitly forbids auto-netting the Cartão de crédito ML-fatura double-count. Show the amount as-is with a visible caveat (tooltip), never subtract an estimated ML portion.
- **Rendering the RPC's `impostos_venda` bloco in the new cascade:** see Pitfall 1 — this would double-count against the card's existing `impostosMes` line, which is already subtracted before "Lucro do mês"/"Margem de contribuição".

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Category→bloco classification | A frontend switch/map duplicating the SQL CASE statement | Consume `bloco` column directly from `get_dre_operational_by_competence` | Already correctly implemented, tested, and reconciled to R$0,00 delta in Phase 87. Single source of truth. |
| Tenant isolation | Any frontend-side org filtering of RPC results | Pass `p_org_id: currentOrg.id`; trust RLS `is_org_member` | RPC is SECURITY INVOKER; anti-IDOR already proven (foreign-org member → 0 rows, Phase 87 Task 2). Frontend re-filtering would be redundant defense that could mask a real RLS regression. |
| Tooltip UI | Custom hover/popover component | shadcn `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider` | Already imported and used for an identical "discreet warning icon" pattern in `ReplenishmentSkuTable.tsx`. |
| BRL currency formatting | A new formatter | The existing `fmt()` helper in `MLCostCard.tsx:6-7` (`toLocaleString("pt-BR", {style:"currency", currency:"BRL", maximumFractionDigits:0})`) | Reuse verbatim — consistency with every other row in the card. |

**Key insight:** Every piece of this phase's data pipeline (aggregation, tenant isolation, currency formatting, row/subtotal styling) already exists elsewhere in the codebase. The entire task is wiring, not invention — any hand-rolled alternative is strictly worse and risks visual/numeric drift from the rest of `/vendas`.

## Common Pitfalls

### Pitfall 1: Double-counting "impostos sobre venda" (CRITICAL — must be resolved before coding)
**What goes wrong:** `MLCostCard` already renders and subtracts "Impostos próprios (regime fiscal)" (`impostosMes`, sourced from `useMLCostWaterfall`'s `total_tax`/`orders.tax_amount` — an ESTIMATE based on sale price, per `dre-competencia-venda-design.md` and the "previsão" DRE mode). The Phase 87 RPC ALSO returns an `impostos_venda` bloco (real ICMS/PIS/COFINS payments from `cash_outflows`, sourced from actual guias pagas — the "apuração"/real DRE mode). These are TWO DIFFERENT sources for conceptually the same line. If the new cascade includes RPC's `impostos_venda` bloco anywhere, the card double-subtracts taxes.
**Why it happens:** CONTEXT's "como renderizar" list only names `pessoal, estrutura, servicos, operacional, nao_classificado` (→ Resultado operacional) and `financeiro` (→ Resultado líquido) — it never mentions `impostos_venda`, but the RPC DOES return that bloco (it's in the migration's CASE map). The 87-01-SUMMARY.md hand-off note makes this explicit: *"Phase 88 must choose ONE source... impostos_venda (this RPC) OR get_imposto_guia_by_competence, NEVER both."* Note also that `get_imposto_guia_by_competence` is currently UNUSED anywhere in `src/` (confirmed via repo-wide grep) — it is not what feeds `impostosMes` today; `impostosMes` comes from `useMLCostWaterfall`'s `total_tax`, a THIRD, already-consumed source.
**How to avoid:** Filter out `impostos_venda` (and `excluido`) from the RPC result before rendering the new cascade rows — only consume `pessoal/estrutura/servicos/operacional/nao_classificado/financeiro`, exactly as CONTEXT's render list specifies. Do not surface `impostos_venda` at all in Phase 88 (it stays a backend-only bloco for now). Flag this decision explicitly to Wesley/the planner as a locked implementation detail, not a re-litigated design choice — CONTEXT already implicitly resolves it by omission, this research just makes the omission explicit and intentional.
**Warning signs:** If the new "Resultado operacional" total looks off by roughly the June/2026 `impostos_venda` bloco (R$4.793 per the June reconciliation in `87-01-SUMMARY.md`), that's the double-count.

### Pitfall 2: Month-axis mismatch when `fonte !== "competencia"`
**What goes wrong:** The RPC 87 aggregates by a strict calendar-month window (`COALESCE(competence_date, date_trunc('month', outflow_date))`). The card's own `receitaMes`/`cmvMes`/`impostosMes` come from `useMLCostWaterfall`, which is ALSO calendar-month-scoped via `billingMonthFrom`/`billingMonthTo` (or `monthlyFrom`/`monthlyTo`) — so these two ARE aligned. However, `gruposTarifas` (ML tarifas) can come from `billingData` (fatura ML cycle 06→05, badge shows "fatura ML") instead of `dailyBilling` (strict calendar month, badge "mês 01–31") when `dailyBilling` is unavailable for that month. In that fallback state, the tarifas shown are NOT the same window as the RPC 87 operational blocks, even though receita/CMV/impostos and the new operational rows all share the same calendar-month window.
**Why it happens:** Pre-existing design (documented in `dre-competencia-venda-design.md`) — the fatura-cycle fallback for tarifas predates this phase and is out of scope to fix (per CONTEXT's deferred section: "Alinhamento de régua venda×competência no backend... só sinalizar na UI se houver descasamento").
**How to avoid:** Do not attempt to fix this in Phase 88. Reuse `billingMonthFrom`/`monthlyFrom` (whichever the existing waterfall ternary picks) as `p_month` for `useDreOperational` — this guarantees the NEW rows (operational+financeiro) are on the exact same calendar-month axis as receita/CMV/impostos, which is the only axis-parity requirement CONTEXT actually asks for. The tarifas-vs-fatura-cycle caveat is pre-existing and orthogonal; no new UI signal is required unless the plan chooses to add one as a stretch goal.
**Warning signs:** none new — this is a pre-existing, already-badged (`fonte` pill) condition; Phase 88 only needs to avoid introducing a SECOND, unrelated axis mismatch by hardcoding a different date for the new hook.

### Pitfall 3: `p_month` type mismatch (string vs date)
**What goes wrong:** The RPC signature is `get_dre_operational_by_competence(p_org_id uuid, p_month date)`. Supabase-js accepts an ISO date string (`"YYYY-MM-DD"`) for a `date` param — but `billingMonth` itself is `"YYYY-MM"` (7 chars, no day), NOT a valid Postgres `date` literal. Passing `billingMonth` directly (instead of `billingMonthFrom`) will produce a Postgres cast error.
**Why it happens:** The page has two related-but-distinct variables: `billingMonth` (`"2026-06"`, used for `ml_billing_daily`/`ml_billing_monthly` queries which filter by a `period_month`/date-range) and `billingMonthFrom` (`"2026-06-01"`, already the correct shape for a `date` param — used today by `useMLCostWaterfall`'s `p_from`).
**How to avoid:** Always pass `billingMonthFrom` (or `monthlyFrom` in the current-month branch) — never `billingMonth` — as `p_month`. Add a lightweight runtime/type note in the new hook's JSDoc (see Pattern 1's example) to prevent future confusion.

### Pitfall 4: Tests need a mocked `supabase.rpc`, not `supabase.from`
**What goes wrong:** The only existing hook test files (`useMLClaims.test.ts`, `useMLQuestions.test.ts`, etc.) mock `supabase.from(...).select(...).eq(...)` chains (table queries), not `supabase.rpc(...)`. Copying that mock shape verbatim for an RPC-based hook test will silently not intercept the call (the mock lacks an `rpc` method), and the test will hit `undefined is not a function` or hang.
**Why it happens:** No existing test in the repo currently exercises an RPC-calling hook (`useCostByMonth`, `useMLCostWaterfall`, `useMLProductMargins`, etc. have zero test coverage today — confirmed via repo-wide search).
**How to avoid:** The mock for `useDreOperational`'s test must include `supabase.rpc: vi.fn()` returning `{ data: [...], error: null }` (or a rejected shape for the error-path test), following the same `vi.mock("@/integrations/supabase/client", ...)` + `vi.mock("@/contexts/OrganizationContext", ...)` shape as `useMLClaims.test.ts:29-54`, but with `rpc` instead of the `from/select/eq/in/order/limit/then` chain.
**Warning signs:** A new hook test that "passes" trivially with 0 assertions on the RPC arguments, or a test that never resolves (missing `await waitFor(...)`).

## Code Examples

### Existing row/subtotal markup to clone for new blocks
```tsx
// Source: src/components/mercadolivre/MLCostCard.tsx:220-242 (impostos row — clone shape for pessoal/estrutura/servicos/operacional/nao_classificado)
<div className="flex items-center justify-between text-xs py-1">
  <span className="text-muted-foreground flex items-center gap-1">
    <span className="text-muted-foreground/50">(−)</span>
    {/* row label, e.g. "Pessoal" */}
  </span>
  <div className="flex items-center gap-2">
    <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
      {pct(valor, receitaMes)}
    </span>
    <span className="font-semibold tabular-nums w-24 text-right text-foreground">
      {fmt(valor)}
    </span>
  </div>
</div>
```

### Existing subtotal (border-t-2) markup to clone for "Resultado operacional" / "Resultado líquido"
```tsx
// Source: src/components/mercadolivre/MLCostCard.tsx:244-264 ("Lucro do mês" — clone shape,
// rename this exact block's label to "Margem de contribuição", then add two more of these for
// "Resultado operacional" and "Resultado líquido")
<div className="flex items-center justify-between text-xs pt-2.5 mt-1.5 border-t-2 border-border">
  <span className="flex items-center gap-1.5 font-semibold text-foreground">
    {isPositive ? (
      <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
    ) : (
      <TrendingDown className="w-3.5 h-3.5 text-red-500" />
    )}
    {/* "Margem de contribuição" | "Resultado operacional" | "Resultado líquido" */}
    <span className="text-[10px] text-muted-foreground font-normal ml-0.5">
      ({pctLabel}%)
    </span>
  </span>
  <span className={`text-base font-bold tabular-nums w-24 text-right ${
    isPositive ? "text-kpi-positive" : "text-kpi-negative"
  }`}>
    {fmt(valor)}
  </span>
</div>
```

### Tooltip for `double_count_risk` (Cartão de crédito)
```tsx
// Source: src/components/mercadolivre/ReplenishmentSkuTable.tsx:4-10, 112-126 (pattern to reuse verbatim)
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// inline in the operational row when a row has double_count_risk === true:
<span className="inline-flex items-center gap-1">
  Cartão de crédito
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default">
          <HelpCircle className="w-3 h-3 text-muted-foreground/60" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[200px] text-xs text-center">
        Pode conter fatura ML já contabilizada na margem
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</span>
```

### RPC row shape (from the Phase 87 migration, for the new hook's TypeScript types)
```sql
-- Source: supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql (Phase 87, in prod)
-- RETURNS TABLE (bloco text, category text, total numeric, n integer, double_count_risk boolean)
-- Confirmed June/2026 reconciliation (87-01-SUMMARY.md): excluido R$139.968 · pessoal R$27.852 ·
-- financeiro R$20.027 · operacional R$15.715 (Cartão de crédito, double_count_risk=true) ·
-- nao_classificado R$7.360 (Outros) · impostos_venda R$4.793 · servicos R$2.103
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| DRE card stops at "Lucro do mês" (margem de contribuição only) | DRE card shows full cascade to Resultado líquido | Phase 88 (this phase) | Wesley gets pessoal/estrutura/serviços/operacional/financeiro visibility inline on `/vendas`, sourced from the reconciled Phase 87 RPC |
| No frontend consumer of `get_dre_operational_by_competence` | `useDreOperational` hook feeds `MLCostCard` | Phase 88 | First frontend usage of the Phase 87 RPC — closes the "Fase 2 of 3" hand-off noted in `87-01-PLAN.md` |

**Deprecated/outdated:** None — this is a pure additive extension, nothing is being replaced or removed from the existing card.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact prop names for the new `MLCostCard` extension (`blocosOperacionais`, `financeiro`, etc.) are illustrative, not locked — the planner may choose different names. | Architecture Patterns / Code Examples | Low — purely a naming choice, doesn't affect correctness. |
| A2 | The new subtotal rows should visually mirror the existing "Lucro do mês" block exactly (same classes, same `TrendingUp`/`TrendingDown` icon, same `text-kpi-positive`/`text-kpi-negative` tokens) rather than introducing new visual weight tiers. | Code Examples, CONTEXT's "Subtotais destacados... com hierarquia visual" | Low-medium — CONTEXT asks for "hierarquia visual" between the three subtotals (margem/operacional/líquido), which could mean slightly different font sizes/weights per tier rather than identical styling for all three; the planner should decide the exact hierarchy (e.g., líquido could be the largest/boldest). Flagged as a design nuance for the plan, not a blocking gap. |

**All other claims in this research are `[VERIFIED: codebase read]`** — every file, line number, and behavior described was directly read from this repository in this session (`MLCostCard.tsx`, `MercadoLivre.tsx`, `useMLBilling.ts`, `useCostByMonth.ts`, `useMLCostWaterfall.ts`, `87-CONTEXT.md`, `87-01-PLAN.md`, `87-01-SUMMARY.md`, `dre-competencia-venda-design.md`, `ReplenishmentSkuTable.tsx`, `useMLClaims.test.ts`, `vitest.config.ts`, `package.json`), not from training data or web search. No external package or API research was needed for this phase.

## Open Questions

1. **Previsão × apuração toggle — in scope for Phase 88 or deferred?**
   - What we know: CONTEXT explicitly flags this as undecided and instructs "Surface como pergunta no plano, NÃO decidir sozinho." The current card is implicitly always "previsão" (CMV médio via `custo_unit`, imposto estimado via `orders.tax_amount`).
   - What's unclear: Whether Wesley wants the toggle built now (which would require ALSO wiring `custo_unit_cheio` and a real-guia tax source — out of the RPC 87 scope entirely, since `impostos_venda`/CMV real aren't part of `get_dre_operational_by_competence`'s output) or whether Phase 88 should just extend the cascade using the card's EXISTING (previsão) receita/CMV/impostos and add the RPC 87 blocks below it as-is.
   - Recommendation: Default to NOT building the toggle in Phase 88 — extend the cascade using the existing previsão-mode inputs untouched, and surface the toggle as an explicit open question for Wesley in the plan's checkpoint, per CONTEXT's own instruction. This keeps Phase 88 strictly additive and avoids scope creep into a real/apuração CMV-cheio pipeline that touches `orders.custo_unit_cheio` (not researched here, out of CONTEXT's boundary).

2. **Should the `excluido` bloco be shown at all (optional collapsed "ver detalhes")?**
   - What we know: CONTEXT says "NÃO exibir... na cascata. Pode ir num 'ver detalhes' colapsado, opcional."
   - What's unclear: Whether Wesley actually wants this optional collapsible section in v1, or whether it's purely a stretch goal.
   - Recommendation: Treat as optional/discretionary for the plan — not required for SC-1/SC-2/SC-3. Ship without it first; add later if requested.

## Environment Availability

Skipped — this phase has no new external dependencies (uses only already-installed npm packages and an already-deployed-to-prod Supabase RPC). `npm`/`vitest`/`tsc` are already confirmed working in this repo (see Validation Architecture below — `npx vitest run` executed successfully in this research session: 526/526 passing, 37 files).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 + @testing-library/react 16.0.0 |
| Config file | `vitest.config.ts` (jsdom environment, `src/test/setup.ts` setup file) |
| Quick run command | `npx vitest run src/hooks/useDreOperational.test.ts` (once created) |
| Full suite command | `npx vitest run` (baseline confirmed in this research session: **526 tests passing, 37 files**, ~38s) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-1 | `useDreOperational` calls `supabase.rpc("get_dre_operational_by_competence", {p_org_id, p_month})` with correct args and maps the row shape | unit | `npx vitest run src/hooks/useDreOperational.test.ts` | ❌ Wave 0 — new file |
| SC-1 | Cascade math: `pessoal+estrutura+servicos+operacional+nao_classificado` sums to Resultado operacional; `+ financeiro` sums to Resultado líquido; `impostos_venda`/`excluido` excluded | unit | Could live in the hook test (grouping helper) or a small pure function extracted for testability, e.g. `src/lib/dreCascade.ts` + `dreCascade.test.ts` | ❌ Wave 0 — new file (recommend extracting the grouping logic as a pure, independently-testable function per the codebase's convention of pure `src/lib/*.ts` helpers, e.g. `precoFaixas.ts`) |
| SC-2 | `MLCostCard` renders the new rows/subtotals correctly, including the `double_count_risk` tooltip and `nao_classificado` visible line | component (RTL) | No existing `MLCostCard` test today — the codebase does not currently unit-test this component; adding one is optional/discretionary given zero precedent, but recommended given the increased complexity | ❌ Wave 0, optional |
| SC-3 (no double-count) | `impostos_venda` bloco is never rendered/summed in the new cascade | unit | Assertion inside the grouping-function test above (`OPERACIONAL_BLOCOS` excludes `impostos_venda`/`excluido`) | ❌ Wave 0 — covered by the same test file as the cascade math test |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit && npx vitest run src/hooks/useDreOperational.test.ts` (and/or `src/lib/dreCascade.test.ts` if extracted)
- **Per wave merge:** `npx vitest run` (full suite, currently 526 passing — must stay green)
- **Phase gate:** Full suite green (`npx tsc --noEmit` + `npx vitest run`) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/hooks/useDreOperational.test.ts` — new hook test, mock `supabase.rpc` (NOT `supabase.from` — see Pitfall 4), assert exact `{p_org_id, p_month}` call args and row mapping
- [ ] Optional: `src/lib/dreCascade.ts` + `src/lib/dreCascade.test.ts` — pure function extracting the bloco-grouping/summation logic out of the page component for isolated unit testing (recommended given the double-count risk in Pitfall 1 — a pure function with an explicit "which blocos are excluded" test is the cheapest guardrail against regression)
- [ ] Framework install: none — vitest/RTL already configured and passing

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | no | Unchanged — existing Supabase session auth, no new auth surface |
| V3 Session Management | no | Unchanged |
| V4 Access Control | yes | Frontend passes `currentOrg.id` as `p_org_id`; actual tenant isolation is enforced server-side by the already-deployed RPC's SECURITY INVOKER + RLS `is_org_member` policy (proven in Phase 87, foreign-org member → 0 rows). Frontend has zero access-control responsibility beyond passing the correct org id from `OrganizationContext` — same pattern as every other RPC hook in this codebase. |
| V5 Input Validation | yes | `p_month` must be a valid date string (`billingMonthFrom`/`monthlyFrom`, both already-validated first-of-month strings derived from existing date math) — no free-form user input flows into this RPC call. |
| V6 Cryptography | no | Not applicable — no crypto operations in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| IDOR via a frontend-supplied `p_org_id` | Information Disclosure / Elevation of Privilege | Already mitigated server-side (Phase 87: SECURITY INVOKER + RLS `is_org_member`, proven with a real foreign-org `authenticated` role). Phase 88 introduces NO new instance of this pattern — it reuses `currentOrg.id` from `OrganizationContext`, identical to every other RPC hook (`useCostByMonth`, `useMLCostWaterfall`, etc.). No new threat model entry needed; this phase adds a consumer, not a new trust boundary. |
| Double-counted financial figures presented as fact | Tampering (data integrity, not security in the STRIDE-authz sense, but relevant to a financial dashboard's trustworthiness) | Mitigation is Pitfall 1's filter (never render `impostos_venda`/`excluido` in the new cascade) — this is a correctness/trust concern, not an authz concern, but material enough to call out given this is a financial reporting feature Wesley relies on for real decisions. |

## Sources

### Primary (HIGH confidence — direct codebase reads, this session)
- `src/components/mercadolivre/MLCostCard.tsx` — current card implementation, full read
- `src/pages/MercadoLivre.tsx` (lines 1-260, 750-800) — month-state wiring, prop feed, hook chain
- `src/hooks/useMLBilling.ts` — full read, tarifas source + month selectors
- `src/hooks/useCostByMonth.ts` — full read, exact RPC-hook pattern to clone
- `src/hooks/useMLCostWaterfall.ts` — full read, RPC-hook pattern with date-range params
- `src/hooks/useMLClaims.test.ts` — existing hook test mock pattern (from/select chain, to contrast with needed rpc mock)
- `src/components/mercadolivre/ReplenishmentSkuTable.tsx` — Tooltip usage pattern
- `.planning/phases/88-dre-frontend-resultado-completo-vendas/88-CONTEXT.md` — locked scope/decisions
- `.planning/phases/87-dre-agrega-o-de-resultado-por-compet-ncia/87-CONTEXT.md`, `87-01-PLAN.md`, `87-01-SUMMARY.md` — RPC contract, category→bloco map, prod reconciliation numbers, Phase 88 hand-off note
- `docs/superpowers/specs/2026-07-03-dre-competencia-venda-design.md` — competência de venda method (locked)
- `vitest.config.ts`, `package.json` — test/build tooling confirmation
- `npx vitest run` executed live in this session — 526/526 tests passing, 37 files (baseline before Phase 88 changes)
- `CLAUDE.md` (STACK.md/CONVENTIONS.md/ARCHITECTURE.md sections) — confirmed stack versions and conventions

No web search or Context7 lookups were needed — this is a pure internal codebase-extension phase with zero new external dependencies.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, all reused from confirmed-installed packages
- Architecture: HIGH — every wiring point (props, hooks, month state) directly read from source in this session
- Pitfalls: HIGH for Pitfall 1 (documented explicitly in the Phase 87 hand-off note) and Pitfall 3/4 (directly observed in code); MEDIUM for Pitfall 2 (correctly describes a pre-existing, out-of-scope condition, but its exact user-visible impact wasn't tested live)

**Research date:** 2026-07-08
**Valid until:** Stable — this research is tied to a specific already-deployed RPC contract (Phase 87, in prod) and a specific already-committed component (`MLCostCard.tsx`). Re-verify only if either changes before Phase 88 executes (unlikely within days; treat as valid for at least 30 days).
