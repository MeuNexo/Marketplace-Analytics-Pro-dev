# Phase 90: DRE — Imposto real e CMV cheio no fechamento do mês - Research

**Researched:** 2026-07-06
**Domain:** Frontend composition (React/TS + TanStack Query) of a client-side DRE, backed by Supabase Postgres RPCs. Pure code-archaeology task — no DB access used (separate track owns DB facts).
**Confidence:** HIGH (all claims below are direct file reads from this repo/worktree — `garment-glow-dre` @ branch `gsd/phase-86-dre-competencia` — not training-data guesses)

## Summary

The `/vendas` "DRE do Mês" card (`MLCostCard.tsx`) is composed entirely client-side in `MercadoLivre.tsx` from two independent data sources that are **never cross-checked today**: (1) `useMLCostWaterfall` → RPC `get_cost_waterfall`, which returns a single `cmv` field (`SUM(orders.custo_unit * quantidade)`) and a single `total_tax` field (`SUM(orders.tax_amount)`), both always "estimated/provisão" in nature; and (2) `useDreOperational` → RPC `get_dre_operational_by_competence`, which **already returns** an `impostos_venda` bloco (real ICMS/PIS/COFINS from `cash_outflows`, tagged by competência) but the frontend reducer `aggregateOperationalBlocks()` **deliberately discards** every `impostos_venda` row today (allow-list excludes it, by design, to avoid double-counting in Phase 88's math).

**The two halves of this phase are asymmetric in effort:**
- **Imposto real:** the data already exists in the RPC response the frontend already fetches. Wiring it in is a **pure frontend change** — extend the reducer to also surface `impostos_venda` (sum + presence flag), and use presence as the open/closed trigger. Zero backend/migration work needed for this half.
- **CMV cheio (preço de custo):** the underlying value is **not stored anywhere** in the current schema. `sync-tiny-costs/index.ts` pulls `precos.precoCustoMedio` (custo médio) from Tiny's API and only falls back to `precos.precoCusto` (preço de custo) when `precoCustoMedio` is absent/zero — the two are collapsed into **one single `cost` column** in `ml_product_costs`. The "preço de custo cheio" value is being **discarded at ingestion time** whenever custo médio is present (which is the common case). This half genuinely requires a schema/RPC change (new column(s), new sync write, new aggregate) — it cannot be done as a pure frontend task.

**⚠️ Correction after cross-checking `90-DATA-FINDINGS.md` (the parallel DB track's output, already in this phase's directory):** Track A is **NOT purely frontend-only** as first analyzed. The DB track found that `cash_outflows` has a `status` column (`paid` | `pending`) that the RPC `get_dre_operational_by_competence` **does not expose or filter on** — it sums ALL rows for a competência regardless of status. Since Jul–Dez/2026 already contain **forecast/recurrence rows copied from Maio** (`pending`, R$16.015,06 identical for 5 months), a naive "row exists" trigger would treat every future month as CLOSED with a fabricated "real" tax. **The RPC itself needs a change** (filter `WHERE status = 'paid'` for the `impostos_venda` bloco, or expose `status` in the output for the frontend to filter) before the open/closed trigger can be wired correctly. See Q4 and Landmines below for the corrected trigger design.

**Primary recommendation:** Split Phase 90 into two coordinated tracks: (A) real-tax wiring — now requires a **small RPC change** (status-aware `impostos_venda`) plus the frontend reducer/composition change, and (B) CMV-cheio backend contract (new column on `ml_product_costs`/`orders` + `sync-tiny-costs` write-both + `get_cost_waterfall` return-both) that the frontend then consumes. Both must land together per CONTEXT.md ("bloqueia o merge da Phase 88"), and both now have a real backend dependency — sequence the RPC/schema work as Wave 0 for both tracks.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Open/closed month trigger (guia exists?) | API / Backend (RPC `get_dre_operational_by_competence`, already returns the signal) | Frontend (derives boolean from existing response) | Data already server-aggregated by competência from `cash_outflows`; frontend just needs to stop discarding it |
| Real tax value (imposto real) | API / Backend (RPC, `cash_outflows` rows tagged `Imposto Venda - *`) | Frontend (sum + compose into DRE line) | Same RPC as above — zero new backend surface needed |
| CMV cheio (preço de custo) | Database / Storage (new column needed — value never captured today) | API / Backend (RPC must expose it) → Frontend (compose) | Root cause is at ingestion (`sync-tiny-costs`) discarding the field; must be fixed at the source, not patched in the frontend |
| DRE composition (open vs. closed swap) | Frontend (`MercadoLivre.tsx` / `dreOperational.ts`) | — | This project has no SSR/backend business layer — all cross-metric composition for `/vendas` happens client-side by design (see `dreWaterfall`/`dreOperational` composition already in `MercadoLivre.tsx`) |
| UI badge (provisão vs. real) | Frontend (`MLCostCard.tsx`) | — | Presentation-only; reuses existing Popover pattern |

## Standard Stack

No new libraries needed. Phase reuses the existing stack (React 18.3, TanStack Query 5.83, Supabase JS 2.98, Vitest 3.2.4) exclusively — this is an internal composition/RPC change, not a new integration. **Package Legitimacy Audit is not applicable** — no new npm packages are introduced by this phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting whether a "guia" competência has landed | A new heuristic based on today's date / calendar cutoff | The existing `impostos_venda` bloco's presence (rows exist for that `competence_date` month) from `get_dre_operational_by_competence` | CONTEXT.md is explicit: calendar cutoff is wrong (June is calendar-closed but guia-open until ~20-25 Jul). The RPC already encodes the real signal — reuse it, don't reinvent |
| Real-tax aggregation math | A new client-side SQL-like reducer | Extend the existing `aggregateOperationalBlocks()` pattern in `dreOperational.ts` (same file, same pure-function style, same test file) | Phase 88 already established this exact pattern (allow-list reducer + pure `computeResultadoLiquido`); a parallel/sibling function keeps the module internally consistent and trivially testable |

## Answers to the Research Questions (with exact locations)

### Q1 — Onde a "DRE do mês" é composta, e onde entram imposto estimado e CMV

**`src/pages/MercadoLivre.tsx` lines 257-260:**
```typescript
// Receita, CMV e impostos do mês do filtro
const receitaMes = dreWaterfall?.paid_revenue ?? 0;
const cmvMes = (dreWaterfall?.has_cmv ? dreWaterfall.cmv : null) ?? null;
const impostosMes = (dreWaterfall?.has_tax_data ? dreWaterfall.total_tax : null) ?? null;
```
`dreWaterfall` (line 238) is `billingMonthIsCurrentMonth ? monthlyCostWaterfall : filterMonthWaterfall` — both instances of `useMLCostWaterfall(from, to)` (lines 180, 228-231). **These are THE two variables** the planner needs to touch: `cmvMes` and `impostosMes`.

These are passed straight into `<MLCostCard cmvMes={cmvMes} impostosMes={impostosMes} ... />` at line 785-786.

**`src/components/mercadolivre/MLCostCard.tsx` lines 76-89 — confirmed, `lucro` reused by Phase 88 exactly as CONTEXT.md described:**
```typescript
// Lucro do mês = receita − total tarifas − CMV − impostos
const lucro =
  receitaMes
  - totalTarifas
  - (cmvMes ?? 0)
  - (impostosMes ?? 0);
const lucroPositivo = lucro >= 0;
const margemPct = receitaMes > 0 ? ((lucro / receitaMes) * 100).toFixed(1) : "—";

// Resultado operacional / Resultado líquido — reusa `lucro` já calculado acima
// (não re-deriva a margem); só ANEXA os blocos operacionais (Phase 88).
const { resultadoOperacional, resultadoLiquido } = dreOperational
  ? computeResultadoLiquido(lucro, dreOperational)
  : { resultadoOperacional: 0, resultadoLiquido: 0 };
```
This is the exact seam Phase 90 must intercept: **whatever new "real vs. provisão" composition happens, it must resolve to `cmvMes` and `impostosMes` BEFORE they reach this `lucro` formula** — `MLCostCard` itself should stay dumb (it already is), receiving pre-composed numbers plus a new "which basis was used" flag for the badge.

### Q2 — Fonte do imposto estimado (`impostosMes` hoje)

`impostosMes` ← `dreWaterfall.total_tax` ← RPC `get_cost_waterfall` (`supabase/migrations/20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql` line 46): `COALESCE(SUM(o.tax_amount), 0) AS total_tax`. `has_tax_data` in `useMLCostWaterfall.ts` line 67 = `total_tax > 0`.

`orders.tax_amount` is computed in `supabase/functions/recalc-order-costs/index.ts` lines 134-137:
```typescript
const taxRate = cfg ? computeOrderTaxRate(cfg, o.estado) : null;
const preco = Number(o.preco_unit ?? 0);
const qty = Number(o.quantidade ?? 0);
const taxAmount = (taxRate != null && preco) ? (preco * qty * taxRate) / 100 : null;
```
`computeOrderTaxRate()` (lines 26-50 of the same file) derives a **per-order estimated rate** from `ml_tax_config` (regime: Simples/Presumido/Real) — for Lucro Real it's `ICMS + (1 − ICMS%) × (PIS 1.65% + COFINS 7.60%)`, i.e. the "~20% por dentro" the CONTEXT.md references is this formula's typical output, NOT a hardcoded 20% constant. **This is the automatic estimate/provisão — CONTEXT.md's deferred section explicitly says do NOT touch this calculation in this phase.**

### Q3 — Fonte do CMV hoje: custo médio ou preço de custo? (critical)

`cmvMes` ← `dreWaterfall.cmv` ← RPC `get_cost_waterfall`: `COALESCE(SUM(o.custo_unit * o.quantidade), 0) AS cmv` (same migration, line 43). `has_cmv` = `cmv > 0` (hook line 65).

`orders.custo_unit` is written by `recalc-order-costs/index.ts` line 133 from a single lookup: `const cost = (o.sku ? costBySku.get(o.sku) : undefined) ?? costByItem.get(o.item_id) ?? null;` — sourced from **`ml_product_costs.cost`** (a single numeric column, see `supabase/migrations/20260514120000_ml_product_costs.sql` line 6: `cost numeric(12,2) -- custo do produto (R$)`).

**Smoking gun — `supabase/functions/sync-tiny-costs/index.ts` lines 161 and 198 (identical logic, listing + detail fetch):**
```typescript
const cost = Number(precos.precoCustoMedio ?? 0) || Number(precos.precoCusto ?? 0);
```
This is where the two Tiny fields collapse into one. **`precoCustoMedio` (custo médio) is tried FIRST; `precoCusto` (preço de custo cadastrado manual) is only used as a fallback when `precoCustoMedio` is `0`/absent.** Since most active SKUs at Pé Vermeio have a non-zero `precoCustoMedio` (per project memory: "custo de marcas revenda ausente no Tiny" is the exception, not the rule, for the org that has costs), **today's CMV is predominantly "custo médio", and `precoCusto` is discarded whenever custo médio is available.**

**Confirmed: no code path, table column, or RPC anywhere in this repo stores "preço de custo" as a separate value from "custo médio".** `ml_product_costs` has exactly one `cost` column (verified via `grep` across `src/` and `supabase/` — no `precoCusto`, `custo_medio`, or `cost_full`-style second field exists). **This means the phase's "CMV cheio" requirement cannot be satisfied by any existing frontend/RPC combination — it requires a new column + a sync-write change + an RPC change (Landmines section below).**

### Q4 — Como o `impostos_venda` real por competência já é consumido

`src/hooks/useDreOperational.ts` calls `supabase.rpc("get_dre_operational_by_competence", { p_org_id, p_month })` (lines 29-32) and maps every row (including `impostos_venda` ones) into `DreOperationalRow[]`, then reduces via `aggregateOperationalBlocks(rows)` (line 43).

`src/lib/dreOperational.ts` — **the reducer explicitly and intentionally drops `impostos_venda` rows** (lines 32-39, 57-58):
```typescript
export const OPERATIONAL_BLOCOS = [
  "pessoal", "estrutura", "servicos", "outros_operacionais", "financeiro",
] as const;
// ...
for (const row of rows) {
  if (!(OPERATIONAL_BLOCOS as readonly string[]).includes(row.bloco)) continue;  // impostos_venda silently skipped here
  ...
}
```
The comment at the top of the file (lines 6-10) is explicit about why: *"impostos_venda (already inside the existing margin) ... must NEVER be summed here, or the −R$29k June/2026 reconciliation breaks."* — that reasoning was correct for Phase 88 (avoiding double count against the *estimated* tax already baked into `lucro`), but Phase 90 needs the exact opposite: **surface `impostos_venda` as a value to REPLACE the estimate with, not to add on top of it.**

The RPC itself (`supabase/migrations/20260687000000_get_dre_operational_by_competence.sql` lines 36-38) derives `impostos_venda` from `cash_outflows.category IN ('Imposto Venda - ICMS','Imposto Venda - PIS','Imposto Venda - COFINS')`, filtered by `co.competence_date` within the target month, `GROUP BY bloco, category`. So a query for month M can return 0-3 rows with `bloco='impostos_venda'` (one per tax category present).

**"Guia exists" boolean derivation — CORRECTED per `90-DATA-FINDINGS.md`:** a naive `rows.some(r => r.bloco === "impostos_venda")` is **wrong** — the RPC's `cash_outflows` source already contains `pending` (forecast/recurrence) rows for Jul–Dez/2026 that are byte-identical copies of Maio's real guia, which would falsely flip every future month to "closed real tax." The DB track's finding: `cash_outflows` has a `status` column (`paid`/`pending`) that this RPC **does not currently return or filter on**. The correct trigger candidate is `status = 'paid'` for the `impostos_venda` rows of that competência — but since the RPC doesn't expose `status` today, **this requires an RPC change** (either filter `impostos_venda` rows to `WHERE co.status = 'paid'` server-side, or add a `status` column to the `RETURNS TABLE` so the frontend can filter). This is no longer a pure frontend change — see corrected Recommended Approach below.

### Q5 — Como o mês selecionado é modelado; abertura/fechamento

`billingMonth` (line 189, `MercadoLivre.tsx`) = `dreMonthOverride ?? filterMonth`, where `filterMonth = currentFrom.substring(0, 7)` (line 183) and `dreMonthOverride` is set via the `‹ ›` navigation buttons in `MLCostCard` (`onPrevMonth`/`onNextMonth`, `shiftDreMonth` lines 205-213). `billingMonthFrom`/`billingMonthTo` (lines 220-226) derive the first/last day of that month string. `useDreOperational(billingMonthFrom)` is called with this value (line 235) — so the hook that will carry the real-tax signal is **already parameterized correctly by the exact month being displayed**, including when the user navigates to a past month via `‹`.

`currentCalendarMonth` (lines 198-201) is today's `YYYY-MM` — used only to disable "next month" navigation (`dreCanGoNext`, line 214), **not** used anywhere as an open/closed signal. This matches CONTEXT.md's warning: the code has no calendar-based "is this month closed" logic today, so there's nothing to remove/conflict with — the new `hasGuiaReal` check is purely additive and month-based (not date-based).

### Q6 — Padrão de UI para selo provisão/real

Two directly reusable patterns already exist in `MLCostCard.tsx`:

**(a) Colored pill badge (lines 131-141)** — used for the `fonte` prop ("mês 01–31" / "fatura ML" / "estimado"):
```typescript
<span
  className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
    fonte === "competencia"
      ? "bg-emerald-500/15 text-emerald-400"
      : fonte === "billing"
      ? "bg-blue-500/15 text-blue-400"
      : "bg-amber-500/15 text-amber-400"
  }`}
>
  {fonte === "competencia" ? "mês 01–31" : fonte === "billing" ? "fatura ML" : "estimado"}
</span>
```
A near-identical 2-state pill ("imposto real (guia)" vs. "imposto estimado (provisão)") can sit next to the "Impostos próprios" line, or as a second pill next to this `fonte` badge in the header.

**(b) Popover + HelpCircle explainer (lines 381-411)** — used today for "Financeiro (aproximado)":
```tsx
{dreOperational.financeiro_is_approximate && (
  <>
    <span className="text-[9px] italic text-muted-foreground/80">(aproximado)</span>
    <Popover open={financeiroTooltipOpen} onOpenChange={setFinanceiroTooltipOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Ver definição de aproximado" ... >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} className="w-auto max-w-[240px] px-3 py-2 text-xs" onOpenAutoFocus={(e) => e.preventDefault()}>
        Valor aproximado — juros ainda não estão separados do principal ...
      </PopoverContent>
    </Popover>
  </>
)}
```
This is the exact pattern to reuse for a "por que este mês usa imposto real / CMV cheio?" explainer next to the CMV and Impostos lines — same `useState` local-open + `onMouseEnter`/`onMouseLeave` + `onClick` toggle idiom. Applying this pattern keeps the new UI visually and behaviorally consistent (light/dark tokens, mobile — the component uses only Tailwind semantic tokens already, no new colors needed).

### Q7 — Testes existentes e padrão de fixture

- `src/lib/dreOperational.test.ts` — pure-function tests, no mocks, no RPC. Uses a `row(partial)` factory helper and the validated **June/2026 fixture**: `JUNE_ROWS` (pessoal 27852, financeiro 20027 approx, servicos 1953, outros 150) + `JUNE_MARGEM = 20888` → asserts `resultadoLiquido === -29094` (±1). There's also an explicit "exclusion proof" test that adding `impostos_venda`/`excluido` noise rows does NOT change the result — **this test will need to be either kept (for the operational-blocks-only reducer) or paired with a NEW test proving `impostos_venda` rows ARE captured by the new extraction function**, to avoid the two behaviors being conflated.
- `src/hooks/useDreOperational.test.ts` — hook-level tests, mocks `@/integrations/supabase/client` (`supabase.rpc`) and `@/contexts/OrganizationContext`, wraps in `QueryClientProvider`, uses `renderHook`/`waitFor`. Same mixed-rows fixture pattern (pessoal + financeiro + impostos_venda + excluido rows in one `data` array) is already present at lines 84-112 of that file and already proves `impostos_venda` rows are excluded from the current `DreOperationalBlocks` shape — this exact fixture is the natural base for a new test proving the NEW extraction path captures them.
- **Gap:** no `MLCostCard.test.tsx` exists today (confirmed via `find`). The badge/composition logic UI-level has zero test coverage currently — Phase 90 should decide whether to add one (component test) or keep coverage at the pure-function level (`dreOperational.test.ts`) only, per project convention (this codebase leans toward pure-function + hook tests over component snapshot tests for this file family).
- **No fixture exists yet for CMV (custo médio vs. cheio) composition** — this will be entirely new test surface once the backend contract lands.

## Recommended Approach

**Split into Track A (real tax — small RPC change + frontend composition) and Track B (backend contract + frontend consumption, CMV cheio). Both now require backend work; neither is purely frontend-only.**

### Track A — Imposto real (requires a small RPC change + frontend composition)
0. **(RPC, DB track)** Extend `get_dre_operational_by_competence` to be status-aware for the `impostos_venda` bloco: either (a) filter those rows to `WHERE co.status = 'paid'` inside the RPC (simplest, keeps the return shape unchanged — `pending`/forecast rows simply never appear as `impostos_venda`), or (b) add a `status` column to `RETURNS TABLE` so the frontend can filter client-side. **Recommend (a)** — filtering server-side means the existing `DreOperationalRow` TypeScript interface doesn't need a new field, and the frontend reducer logic stays as simple as originally planned. Confirm with the DB track/Wesley on the June placeholder question (Open Questions #1) before locking this filter, since `status='paid'` alone would treat June's R$4.793 placeholder (PIS/COFINS = R$0,01 each) as a real closed-month guia.
1. Extend `src/lib/dreOperational.ts` with a new pure function, e.g. `extractImpostoReal(rows: DreOperationalRow[]): { total: number; hasGuia: boolean }`, filtering `bloco === "impostos_venda"` (now pre-filtered to `paid` by the RPC change above) and summing `total` (mirrors the existing allow-list style, doesn't touch `aggregateOperationalBlocks`/`OPERATIONAL_BLOCOS` at all — keeps the Phase 88 exclusion intact for the operational-blocks math, adds a sibling extraction for the new use case).
2. `useDreOperational.ts` needs no NEW RPC call — it already fetches from the same RPC (now returning pre-filtered `paid`-only `impostos_venda` rows). Either (a) call `extractImpostoReal` inside the same `queryFn` and return an enriched object (`{ blocks, impostoReal }`), or (b) export a second selector hook. Recommend (a) — single source of truth per month fetch, avoids a duplicate `supabase.rpc` call.
3. In `MercadoLivre.tsx`, replace the plain assignment at lines 259-260 with a composition step: if `dreOperational.impostoReal.hasGuia` → `impostosMes = dreOperational.impostoReal.total`; else → keep today's `dreWaterfall?.has_tax_data ? dreWaterfall.total_tax : null` exactly as-is (zero regression path, CONTEXT.md's "mês aberto = zero regressão" requirement). Recommend extracting this as a pure function (e.g. `resolveTax({ estimated, real, hasGuia })`) in `dreOperational.ts` so it's unit-testable without React.
4. `MLCostCard.tsx`: add a `impostoFonte: "real" | "provisao"` prop (or reuse existing `fonte` semantics with a second badge) + Popover explainer next to "Impostos próprios" line, reusing the exact pattern from Q6(b).
5. **Reconciliation test case:** use **Maio/2026** (per `90-DATA-FINDINGS.md`: `paid`, R$16.015,06 across all 3 categories — ICMS 12.000 / PIS 716,19 / COFINS 3.298,87 — the only unambiguously "real, complete" closed guia in the data). Do NOT use Junho (placeholder) or Jul–Dez (forecast) as the phase's proof case.

### Track B — CMV cheio (requires backend contract)
This cannot be a frontend-only task — the value is discarded at ingestion. Concrete backend changes needed (coordinate with the DB track referenced in CONTEXT.md; this research documents the *contract* the frontend needs, not the migration SQL itself, per this agent's DB-access boundary):
1. `ml_product_costs` needs a second cost column (e.g. `cost_full numeric(12,2)` storing `precos.precoCusto` verbatim) alongside the existing `cost` (custo médio-preferred) column.
2. `supabase/functions/sync-tiny-costs/index.ts` lines 161/198 must write **both** fields instead of collapsing them: `const costMedio = Number(precos.precoCustoMedio ?? 0); const costCheio = Number(precos.precoCusto ?? 0);` and upsert both.
3. `orders` table needs a parallel column (e.g. `custo_unit_cheio`) written by `recalc-order-costs/index.ts` alongside the existing `custo_unit` write (same lookup-by-SKU logic, just also reading the new `cost_full` column).
4. `get_cost_waterfall` RPC needs a new return field (e.g. `cmv_cheio numeric, has_cmv_cheio boolean`) — `COALESCE(SUM(o.custo_unit_cheio * o.quantidade), 0)`.
5. `useMLCostWaterfall.ts` (`CostWaterfallData` interface) needs the new fields threaded through, same shape as the existing `cmv`/`has_cmv` pair.
6. Only then can `MercadoLivre.tsx` compose: if `hasGuiaReal` → `cmvMes = dreWaterfall.has_cmv_cheio ? dreWaterfall.cmv_cheio : null` (fall back to custo médio with an explicit UI note if `cost_full` is missing for some SKUs — a real, expected gap per project memory: "top sellers de revenda... têm has_cmv=false").

**Sequencing recommendation:** Track B is the actual bottleneck (schema + sync + RPC + backfill of `cost_full` for existing `ml_product_costs` rows). Track A can be planned/executed in parallel or even shipped slightly ahead since it has zero backend dependency, but per CONTEXT.md both must land in the same PR/merge as Phase 88. Plan the phase with Track B's backend work as the critical-path Wave 0, Track A as an independent parallel wave, and the `MercadoLivre.tsx`/`MLCostCard.tsx` composition/UI wave depending on both.

## Landmines / Gotchas

- **A naive "row exists" trigger is provably wrong — confirmed by `90-DATA-FINDINGS.md`.** `cash_outflows` already contains `pending` (forecast/recurrence) `impostos_venda` rows for Jul–Dez/2026 that are byte-identical copies of Maio's real guia (R$16.015,06 repeated 5 times). Any trigger design that doesn't filter on `status = 'paid'` will treat every future month as "closed" with fabricated real-tax numbers the moment this phase ships — this is not a hypothetical edge case, it's already sitting in production data today. **This must be fixed at the RPC layer** (see Track A step 0), not patched around in the frontend.
- **Régua ambiguity — competência may be payment month, not sale month (conflicts with a "locked" CONTEXT.md decision).** `90-DATA-FINDINGS.md` observed that guia due-dates fall ~day 20-25 of the SAME month as the guia's `competence_date` (e.g., Maio's guia is due 21-25/Mai), which is inconsistent with the standard ICMS/PIS/COFINS apuração cycle (apurado e pago no mês SEGUINTE à venda). If Tiny's `dataCompetencia` actually encodes the **payment/apuração month** rather than the **sale month**, then CONTEXT.md's locked decision ("usa a guia direto, SEM deslocar −1 mês") would misalign the real tax by one month, and the Maio reconciliation test could fail even though the code is correct. **This is flagged as a hard open question (see Open Questions #2) that the planner should resolve with Wesley BEFORE relying on the "no offset" rule as ground truth** — it may look like a code bug when it's actually a wrong locked assumption.
- **"Preço de custo cheio" is not stored anywhere today.** Verified by direct grep across `src/` and `supabase/` for `precoCusto`, `custo_medio`, `cost_full` — no second cost field exists. `sync-tiny-costs/index.ts` collapses Tiny's two fields into Tiny's `precoCustoMedio ?? precoCusto` fallback chain at write time (lines 161, 198), discarding `precoCusto` whenever `precoCustoMedio` is non-zero. **A migration is mandatory for this half of the phase** — it cannot be satisfied by reshaping existing frontend code alone.
- **`impostos_venda` rows are discarded by a `continue` in a loop that also silently discards `excluido` rows** (`dreOperational.ts` line 58) — any new extraction logic must be added as a *new*, separate reducer/selector, NOT by removing `impostos_venda` from the exclusion list of `OPERATIONAL_BLOCOS` (doing so would break the Phase 88 −R$29.094 June reconciliation test, since `impostos_venda` would then also get summed into `pessoal`/`estrutura`/etc. via the `ELSE` branch mis-mapping — actually it wouldn't map into those categories since the RPC already tags it as its own `bloco`, but it WOULD start being silently ignored differently; the safe path is a parallel extraction function, not touching the existing allow-list).
- **June limbo, quantified by the DB track:** `cash_outflows` for Junho/2026 already has `status='paid'` `impostos_venda` rows, but ICMS=R$4.793,21 while PIS=COFINS=R$0,01 — a placeholder pattern, not a genuine 3-category apuração (contrast with Maio's real R$16.015,06 split ICMS 12.000/PIS 716/COFINS 3.299). A naive `status='paid'` filter alone would treat June as CLOSED with a misleading R$4.793 real-tax figure. **Do not rely on `status='paid'` alone** — the planner should add an explicit verification/checkpoint task (with Wesley or the DB track) to decide whether June needs an additional plausibility guard (e.g., require all 3 categories > some minimum) or should stay in provisão until the real guia lands ~20-25/Jul, per Open Questions #1.
- **Historical cost is a snapshot, not point-in-time.** `ml_product_costs` (and by extension `orders.custo_unit`/the future `custo_unit_cheio`) reflects whatever Tiny returned at the last sync, written via `recalc-order-costs` with `only_missing=true` by default — i.e., once an order's `custo_unit` is set, it is not recalculated even if the registered cost changes later. This is an existing limitation (not introduced by this phase) that will apply identically to the new `custo_unit_cheio` column — flag but do not attempt to fix in this phase (out of CONTEXT.md's boundary).
- **Zero-regression requirement for the open month is a real risk area**, not just a nice-to-have: `cmvMes`/`impostosMes` currently flow straight from `dreWaterfall` with no intermediate composition step. Any refactor that introduces a new composition function must be exercised by a test asserting **byte-identical output** to today's behavior when `hasGuiaReal === false` (i.e., the new code path is provably a no-op for the current/open month), given how visible this card is on the primary `/vendas` dashboard.
- **`dreWaterfall` variable is one of two underlying `useMLCostWaterfall` query results** (`monthlyCostWaterfall` vs. `filterMonthWaterfall`, chosen via `billingMonthIsCurrentMonth` ternary at line 238) — both would need the new `cmv_cheio`/`has_cmv_cheio` fields from the RPC once Track B lands; there is no single "the" waterfall query to patch.
- **No `MLCostCard.test.tsx` exists** — UI-level regression coverage for the new badge is currently zero; decide test strategy explicitly (pure-function tests in `dreOperational.ts` are the stronger, lower-cost lever given the project's existing test-writing convention for this file family).
- **Package Legitimacy Audit: N/A.** No new npm/pip/cargo packages are introduced by this phase — purely internal composition + (for Track B) a schema/RPC change.

## File-by-File Change Map

| File | Change | Track |
|------|--------|-------|
| `get_dre_operational_by_competence` RPC (migration, DB track) | Filter `impostos_venda` rows to `WHERE co.status = 'paid'` (or expose `status` in `RETURNS TABLE` for client-side filtering) — required so Jul–Dez/2026 `pending`-forecast rows never masquerade as real tax | A |
| `src/lib/dreOperational.ts` | Add `extractImpostoReal(rows)` (new pure fn, sibling to `aggregateOperationalBlocks`); add composition helper e.g. `resolveTaxAndCmv(...)` to decide provisão vs. real per month | A |
| `src/lib/dreOperational.test.ts` | New test cases: `extractImpostoReal` sums `impostos_venda` rows correctly + `hasGuia` boolean derivation; `resolveTaxAndCmv` zero-regression proof for open month; closed-month fixture using the **Maio/2026** (paid, complete) competência | A |
| `src/hooks/useDreOperational.ts` | Enrich `queryFn` return shape to also surface the extracted `impostoReal` alongside existing `DreOperationalBlocks` (same RPC call, now returning status-filtered `impostos_venda` rows) | A |
| `src/hooks/useDreOperational.test.ts` | New assertions on enriched return shape using the existing mixed-rows fixture (already has `impostos_venda` row at line 92) | A |
| `src/pages/MercadoLivre.tsx` | Lines 257-260 (`cmvMes`, `impostosMes`) — replace direct assignment with composition call using `dreOperational`'s new `impostoReal` + (Track B) new `cmvCheio` fields | A + B |
| `src/components/mercadolivre/MLCostCard.tsx` | Add "imposto real (guia)" vs. "estimado (provisão)" badge/popover near the Impostos line, reusing the `fonte` pill pattern (lines 131-141) and the Popover/HelpCircle pattern (lines 381-411) | A |
| `ml_product_costs` table (migration, DB track) | Add `cost_full numeric(12,2)` column | B |
| `supabase/functions/sync-tiny-costs/index.ts` | Lines 161, 198 — write both `precoCustoMedio` and `precoCusto` to their respective columns instead of collapsing via `||` | B |
| `orders` table (migration, DB track) | Add `custo_unit_cheio numeric` column | B |
| `supabase/functions/recalc-order-costs/index.ts` | Extend cost lookup/patch to also write `custo_unit_cheio` from `ml_product_costs.cost_full` | B |
| `get_cost_waterfall` RPC (migration, DB track) | Add `cmv_cheio`, `has_cmv_cheio` to `RETURNS TABLE` | B |
| `src/hooks/useMLCostWaterfall.ts` | Extend `CostWaterfallData` interface + mapping with `cmv_cheio`/`has_cmv_cheio` | B |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `status = 'paid'` (on `cash_outflows`, exposed via a new RPC filter/column) is a necessary but possibly not sufficient condition for "guia exists" — June's placeholder (paid but PIS/COFINS=R$0,01) suggests an additional plausibility guard may be needed | Landmines, Q4, Recommended Approach | If the planner wires `status='paid'` alone without addressing the June placeholder pattern, June could surface a misleading R$4.793 "real tax" the moment this ships — needs explicit Wesley/DB-track confirmation (Open Questions #1) |
| A2 | New columns named `cost_full` (`ml_product_costs`) and `custo_unit_cheio` (`orders`) are illustrative naming suggestions, not confirmed decisions | Recommended Approach, File Map | Actual migration (owned by DB track, out of this agent's access) may choose different names/shapes — planner should treat these as a proposed contract to confirm with the DB track, not literal final names |
| A3 | Historical `custo_unit`/`custo_unit_cheio` values are snapshots-at-recalc-time, not point-in-time-at-sale — inferred from `recalc-order-costs` `only_missing=true` default and no versioned-cost-history table found in this codebase | Landmines | If a cost-history mechanism exists elsewhere (not found in this repo scan), the "cheio" values used for closed months could be more accurate than assumed here; low risk since behavior would only be more correct, not less |
| A4 | Tiny's `dataCompetencia` on the guia is assumed by CONTEXT.md's locked decision to encode the sale month directly (no −1 offset) — but `90-DATA-FINDINGS.md`'s due-date analysis (guia due ~day 20-25 of the SAME competência month) is more consistent with `dataCompetencia` encoding the payment/apuração month instead | Landmines, Q2 (cross-track), Open Questions #2 | If the locked "no offset" decision is actually wrong, the real tax would be attributed to the wrong sale month, and the Maio reconciliation test in this phase could fail for a régua reason unrelated to the code being planned |

## Open Questions

1. **What exactly counts as "guia lançada" for the trigger — is `status='paid'` sufficient, or does June need an extra guard?**
   - What we know (per `90-DATA-FINDINGS.md`): `cash_outflows.status` distinguishes `paid` (Jan–Jun/2026) from `pending` (Jul–Dez/2026, forecast copies of Maio). `status='paid'` correctly separates real months from forecast months for Jan–Mai. June IS `paid` but its PIS/COFINS values (R$0,01 each) look like placeholders rather than a genuine apuração — only ICMS (R$4.793,21) looks real.
   - What's unclear: whether Wesley intends June to count as CLOSED (using this partial/placeholder R$4.793 as "real" tax) or to stay in provisão until the actual guia lands ~20-25/Jul.
   - Recommendation: planner should insert a `checkpoint:human-verify` (or direct Wesley question) task before wiring the trigger to production data, specifically resolving June's treatment as part of the phase's acceptance criteria — this is a business decision, not a code question.

2. **Régua: does the guia's competência represent the sale month or the payment month? (cross-track conflict)**
   - What we know: CONTEXT.md's locked decision says use the guia's competência directly, no −1 month offset, because "Wesley confirmou que a competência da guia no Tiny JÁ é o mês da venda." However `90-DATA-FINDINGS.md` observed guia due-dates fall ~day 20-25 of the SAME competência month (e.g., Maio's guia due 21-25/Mai) — which is inconsistent with the standard ICMS/PIS/COFINS apuração cycle (apurado e pago no mês seguinte à venda), suggesting `dataCompetencia` might actually encode the payment/apuração month.
   - What's unclear: which interpretation is correct — this directly determines whether the phase should apply real tax to competência N or N+1/N−1 relative to the sale month, and could make or break the Maio reconciliation test even with otherwise-correct code.
   - Recommendation: this conflicts with a decision CONTEXT.md marked as LOCKED — the planner should not silently re-open it, but should flag it explicitly to Wesley (citing the due-date evidence from `90-DATA-FINDINGS.md`) as a confirm-or-override checkpoint before implementation, since proceeding on a wrong locked assumption would silently break the reconciliation this phase exists to fix.

3. **Exact shape/naming of the CMV-cheio backend contract.**
   - What we know: today's schema has zero storage for "preço de custo" separate from "custo médio"; the fix requires new column(s) + sync write + RPC field.
   - What's unclear: whether the DB track (separate from this research) has already decided column names, migration timing, or a different data-flow (e.g., storing preço de custo cheio at the `ml_product_costs` level only, without touching `orders`, and joining at RPC time instead of denormalizing into `orders.custo_unit_cheio`).
   - Recommendation: planner should coordinate directly with the DB track's output before finalizing Track B tasks; this research's "File-by-File Change Map" for Track B is a proposed contract, not a confirmed migration.

## Sources

### Primary (HIGH confidence — direct file reads, this repo/worktree)
- `src/pages/MercadoLivre.tsx` — DRE composition, `billingMonth` modeling, `dreWaterfall`/`dreOperational` wiring
- `src/components/mercadolivre/MLCostCard.tsx` — `lucro` formula, badge/popover UI patterns
- `src/hooks/useMLCostWaterfall.ts` — `CostWaterfallData` shape, RPC call
- `src/hooks/useDreOperational.ts` + `src/lib/dreOperational.ts` (+ both `.test.ts` files) — real-tax data already fetched but discarded, test fixture conventions
- `supabase/functions/recalc-order-costs/index.ts` — `custo_unit`/`tax_amount` derivation
- `supabase/functions/sync-tiny-costs/index.ts` — the `precoCustoMedio ?? precoCusto` collapse (root cause of missing CMV-cheio data)
- `supabase/migrations/20260514120000_ml_product_costs.sql`, `20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql`, `20260687000000_get_dre_operational_by_competence.sql`, `20260687000100_dre_exclude_credit_card.sql` — schema and RPC definitions
- `.planning/phases/90-dre-imposto-real-cmv-fechamento/90-CONTEXT.md` — locked decisions and phase boundary
- `.planning/phases/90-dre-imposto-real-cmv-fechamento/90-DATA-FINDINGS.md` — **[CITED — parallel DB track's direct Supabase MCP queries]**: `cash_outflows` `status` column (paid/pending) and its absence from the current RPC output, the Jul–Dez/2026 forecast-row pattern, June's placeholder PIS/COFINS values, and the guia due-date vs. competência régua ambiguity. This is the single most consequential source in this document — it corrected this agent's initial (code-only) conclusion that the real-tax trigger was already fully derivable and safe to wire as "row exists."

### Secondary / Tertiary
- None used — no WebSearch/Context7/external documentation lookups were performed. This phase is 100% internal business-logic archaeology on proprietary code; there is no external framework/library question to research (config confirms `brave_search`/`exa_search`/`firecrawl` all disabled and `nyquist_validation: false` for this project).

## Metadata

**Confidence breakdown:**
- Frontend composition (Track A feasibility): HIGH — traced end-to-end from RPC response to rendered pixel, including the exact discarding line
- CMV-cheio absence (Track B necessity): HIGH — verified by exhaustive grep across `src/` and `supabase/` for any second cost field; none found
- "Guia exists" semantics: MEDIUM — corrected mid-research after cross-checking `90-DATA-FINDINGS.md`; the mechanical signal (`status='paid'`) is well-evidenced by direct DB query, but two business questions remain genuinely open (June placeholder treatment; sale-month vs. payment-month régua) and must be resolved with Wesley, not assumed by the planner

**Research date:** 2026-07-06
**Valid until:** Tied to this branch's schema state — invalidate if any migration touching `ml_product_costs`, `orders`, `get_cost_waterfall`, or `get_dre_operational_by_competence` lands before this phase is planned/executed (check via `git log --oneline supabase/migrations/` for changes after 2026-07-06).

## RESEARCH COMPLETE
