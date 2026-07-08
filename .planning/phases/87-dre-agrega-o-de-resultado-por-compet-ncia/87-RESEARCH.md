# Phase 87: DRE — Agregação de Resultado por Competência - Research

**Researched:** 2026-07-08
**Domain:** Supabase Postgres RPC (SECURITY INVOKER aggregation) reading `cash_outflows` + reuse of existing ML margin sources
**Confidence:** HIGH (all core findings verified directly against this repo's migrations, source, and a second live worktree with a validated prior implementation)

## Summary

Phase 87 needs one SQL RPC that aggregates `cash_outflows` (which already carries `competence_date` from Phase 86, 91.3% backfilled in prod) by month and by category→DRE-block, applying the exact map locked in `87-CONTEXT.md`. This is a pure-SQL, `SECURITY INVOKER`, no-new-package phase — the pattern to copy is the project's own `get_margin_*` RPC family (`LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public`), not anything external.

**The single most important finding is not a library choice — it is that this exact RPC has already been built, deployed to prod, and reconciled once before, on a branch that was never merged into `main`.** Branch `gsd/phase-86-dre-competencia` (worktree `/root/garment-glow-dre`, pushed to `origin`) contains `supabase/migrations/20260687000000_get_dre_operational_by_competence.sql` and a same-day refinement `20260687000100_dre_exclude_credit_card.sql`, both applied to the **same production project** (`ckcdevcxgvueywivefgx`) via MCP `apply_migration` on 2026-07-06, and reconciled to a **R$0,00 delta** against June/2026 `cash_outflows`. `main` has no record of these two migrations. Phase 86 in `main` (executed 2026-07-08) already hit this exact collision once — its migration found the schema "already in prod via drift" from this same unmerged branch. **The orchestrator must check prod for `get_dre_operational_by_competence` via MCP before treating Phase 87 as greenfield** — see Pitfall 1 and the Assumptions Log.

The category→block map in the current `87-CONTEXT.md` (2026-07-08, the one that governs this research) is **not identical** to the map already validated in the other branch: `Cartão de crédito` moved from *excluded* (prior decision, to avoid double-counting the ML invoice embedded in the card statement) to *included* as an operational expense with a mandatory visible "may double-count" annotation (new decision, made explicitly because Wesley will start splitting the ML portion at the source going forward). The plan must use the **current** CONTEXT.md map, not the old branch's map, but should structurally reuse the old branch's proven RPC shape (SQL body, INVOKER, revoke pattern, `p_org_id + p_month` signature).

For the ML side of the margin (revenue/CMV/tarifas/ads), **do not build anything new**: `orders` (via `get_cost_waterfall`, the same source `/vendas` `MLCostCard` already uses) already carries competence naturally (`data_pedido` = sale date), and `get_margin_with_ads_by_product` / `ml_ads_products_cache` already carry the MCO-with-ads figures reused by `/produtos-vendidos` and `/analise-precos`. Phase 87's Success Criteria (ROADMAP) only require the RPC to classify `cash_outflows` into blocks — the Receita→Margem side is explicitly out of scope for this RPC and stays a client-side composition, exactly like the already-built precedent did.

**Primary recommendation:** Before writing any new migration, verify prod state via MCP for `get_dre_operational_by_competence`/`get_imposto_guia_by_competence`/`cash_outflows.competence_date`-dependent objects; then author a **new-numbered** migration (`>= 20260691000000`, never reusing `20260687*`/`20260690*`) that `CREATE OR REPLACE`s a `get_dre_operational_by_competence(p_org_id uuid, p_month date)`-shaped RPC using the CURRENT category map, scoped to cash_outflows classification only.

## User Constraints

<user_constraints>
### Locked Decisions (from 87-CONTEXT.md, 2026-07-08 — this is the authoritative map for this phase)

**Fonte de competência (fallback):** `COALESCE(competence_date, date_trunc('month', outflow_date)::date)` — ~8.7% of 2026 rows (55/630) have no `competence_date`; fall back to `outflow_date`'s month so no value is lost.

**Empréstimo (override do ROADMAP):** include the FULL parcela value (juro + principal) in **Financeiro**. Do NOT do the SAC split (ROADMAP's SC-1 suggestion of R$300.000/45=R$6.666,67/parcela is explicitly rejected by Wesley). 2026 total: R$160.961,77 (19 rows).

**Cartão de crédito:** INCLUDE as operational expense. 2026: R$268.292,37 (12 rows), single supplier "Bradesco" (credit card invoice payment). Known double-count: the ML invoice is embedded in the card statement (already counted in MCO/margin) but rows are lump-sum so it cannot be netted by supplier. Wesley will separate at the source (contas a pagar) going forward; past months will double-count. **The DRE must make this visible** (a line/note "Cartão de crédito — pode conter fatura ML já contabilizada"), not hide it.

**Category → DRE block map (exact `cash_outflows.category` strings, Pé Vermeio):**

| Block | Categories |
|---|---|
| Impostos sobre venda (deduct revenue) | `Imposto Venda - ICMS`, `Imposto Venda - PIS`, `Imposto Venda - COFINS` |
| CMV — EXCLUDE (already costed via `orders`) | `Fornecedores`, `Previsões de compra` |
| Pessoal | `Salários`, `Pró-labore` (not seen in 2026 data but map it), `Pessoal - INSS` |
| Estrutura | `Aluguéis e condomínio`, `Água, luz`, `Telecomunicação, internet` |
| Serviços | `Contabilidade`, `Serviços gerais` (small, ~R$2.3k/2026) |
| Operacional (other operating costs) | `Insumos`, `Itens do CD`, `Impostos, taxas` (NOT a sales tax — R$829/2026), `Veículos, transportes`, `Cartão de crédito` |
| Financeiro | `Empréstimo` (full parcela) |
| EXCLUDE (capital / other channels / already in ML) | `Aporte`, `ADS Shopee`, `Vendas Magalu`, `ADS Mercado Livre`, `Prestação de serviço do Mercado Envios Full`, `Reembolso cliente` (0 in 2026; if it appears, deduct from revenue, not an expense block), `Outros` (catch-all, 0 in 2026; plan decides: fold into Operacional OR a visible "not classified" bucket) |

**Fiscal rules (ROADMAP, LOCKED):** NO IRPJ/CSLL (company doesn't collect it). NO FGTS (only INSS). DRE closes at net result, no further deductions.

**Security:** RPC **SECURITY INVOKER**, anti-IDOR by `organization_id = caller's org` (never DEFINER + org param). Watch the RLS timeout pitfall: preload lookups in `CTE MATERIALIZED`, avoid correlated subqueries in an INVOKER RPC (`authenticated` role has an 8s `statement_timeout`).

**Output structure (frontend-ready for Phase 88):** Receita → (−) impostos sobre venda → (−) comissão/tarifas ML → (−) frete → (−) CMV → (−) ads = **Margem de contribuição** → (−) Pessoal/Estrutura/Serviços/Operacional = **Resultado operacional** → (−) Financeiro (Empréstimo) = **Resultado líquido**. Aggregated by competence month.

### Claude's Discretion
- Whether `Outros` (catch-all category, 0 rows in 2026) folds into `Operacional` or gets a separate "não classificado" bucket — CONTEXT explicitly defers this to "decidir no plano."
- Exact migration filename/timestamp (must avoid collision — see Pitfall 1).
- Whether to expose a `financeiro_is_approximate`-style flag or just document the double-count in the Serviços/Operacional line for `Cartão de crédito` — CONTEXT requires visibility but doesn't dictate the exact RPC column shape.

### Deferred Ideas (OUT OF SCOPE)
- Frontend DRE display at `/vendas` → Phase 88.
- SAC split of the loan (juro vs. principal) → discarded by Wesley's decision (use full value).
- Netting the ML invoice out of the credit-card lump sum → Wesley fixes at the source going forward; do not implement automatic netting now.
- IRPJ/CSLL/FGTS → out of scope (company doesn't collect them).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (ROADMAP Success Criteria) | Research Support |
|----|-------------|------------------|
| SC-1 | RPC aggregates by `competence_date`, classifies into blocks: Impostos sobre venda / Pessoal / Estrutura / Serviços+Operacional (per CONTEXT map, superseding ROADMAP's stale SAC-split wording — see Assumptions Log A1) | Category→block CASE expression below; existing validated RPC shape in `20260687000000_get_dre_operational_by_competence.sql` |
| SC-2 | EXCLUI `Fornecedores`/`Previsões de compra` (CMV), `Aporte` (capital), other-channel categories | Same CASE expression, `excluido` branch |
| SC-3 | No IRPJ/CSLL/FGTS — DRE closes at net result | Structural — RPC never touches income-tax categories (none exist in cash_outflows: company doesn't collect them) |
| SC-4 | Anti-IDOR (`organization_id` = caller's org, RPC SECURITY INVOKER); reconciliation with a real closed month (June/2026) | `get_margin_with_ads_by_product`/`get_cashflow` INVOKER pattern; RLS policy `cash_outflows_select` via `is_org_member`; reconciliation SQL in Research Goal 5 |
| SC-5 | Output structure ready for frontend: Receita → deductions → Margem de contribuição → operacional → Resultado operacional → Financeiro → Resultado líquido | RPC itself only needs to emit the opex/financeiro blocks (matches validated precedent scope); Receita/Margem side is sourced client-side from existing `get_cost_waterfall` (or `get_margin_with_ads_by_product`, see Research Goal 1 open question) in Phase 88 |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Competence-month aggregation of `cash_outflows` by category→block | Database (Postgres RPC) | — | Aggregation over a single table with RLS; belongs server-side to avoid pulling all rows to the client and to enforce anti-IDOR once, not per-caller |
| Category→block classification map | Database (Postgres RPC, CASE expression) | — | Same RPC — small, stable map; no need for a lookup table (see Research Goal 4) |
| ML revenue/CMV/tarifas/ads (margin side) | Database (existing RPCs: `get_cost_waterfall`, `get_margin_with_ads_by_product`) + Frontend composition | Frontend (`/vendas` `MLCostCard`, `dreOperational.ts`-style lib) | Already built, already validated, already reconciled — Phase 87 must NOT recompute this; only combine downstream |
| Anti-IDOR / tenant isolation | Database (RLS policy `is_org_member` + RPC `SECURITY INVOKER`) | — | Project-wide standard (`feedback_supabase_security_invoker`); DEFINER+org-param is an IDOR footgun already flagged by this project's own security review history |
| Frontend DRE display | Frontend (React/TS) | — | Explicitly Phase 88, out of scope here |

## Standard Stack

No new libraries. This phase is a single Postgres migration (`LANGUAGE sql`, `plpgsql` not required) plus, optionally, a thin `useDreOperational`-style TanStack Query hook if the plan chooses to wire a first consumer — but per CONTEXT, frontend wiring is Phase 88, not 87.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| PostgreSQL (Supabase-managed) | project default (Supabase Postgres 15/17-class, RLS-capable) | RPC + RLS enforcement | Already the project's only backend datastore; no ORM in front of RPCs — client calls `.rpc()` directly [VERIFIED: codebase, `src/hooks/*.ts` universally use `supabase.rpc(...)` for margin/cost RPCs] |
| `@supabase/supabase-js` | 2.98.0 | Client SDK to call the new RPC from a future hook (Phase 88) | Already the project's only Supabase client [VERIFIED: codebase, `package.json`/CLAUDE.md tech stack] |

### Supporting
None. No new npm/pip/cargo packages required — this is a schema+RPC-only phase.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single `CASE`-expression RPC (chosen) | A `category_dre_map` lookup table | Table is more "data-driven" for Wesley adding new Tiny categories over time, but adds a migration+RLS+maintenance surface for ~25 static categories that change rarely; project precedent (the already-validated `20260687000000` migration) uses a plain `CASE`, and CONTEXT's map is explicitly hand-curated with inline commentary per category — a `CASE` keeps that reasoning visible in the migration file. See Research Goal 4 for the tradeoff detail. |
| `LANGUAGE sql` RPC (chosen) | `LANGUAGE plpgsql` | Not needed — this is a single `SELECT ... GROUP BY`, no control flow, no loops. `sql`-language functions are also inlined more aggressively by the planner, and match the whole `get_margin_*` family in this codebase. |

**Installation:** none — this is a pure SQL migration, no `npm install` step.

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages** (Node/npm, Python/pip, or Rust/cargo). No `package-legitimacy check` is required. If the plan later adds a Phase-88-style frontend hook, that phase's own research must run the audit for any new dependency (none are anticipated — `@tanstack/react-query` and `@supabase/supabase-js` are already installed).

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  cash_outflows (Postgres)   │        │  orders (Postgres)            │
│  competence_date (Phase 86, │        │  data_pedido = sale date       │
│  91.3% backfilled)          │        │  comissao/frete/tax_amount/    │
│  category, amount (>0)      │        │  custo_unit per order          │
└──────────────┬───────────────┘        └──────────────┬────────────────┘
               │                                         │
               │ RPC (NEW, this phase)                   │ RPC (EXISTING — reuse,
               │ get_dre_operational_by_competence        │ do not touch)
               │ (p_org_id, p_month)                      │ get_cost_waterfall /
               │ GROUP BY category → CASE block           │ get_margin_with_ads_by_product
               ▼                                         ▼
     ┌───────────────────────┐             ┌───────────────────────────┐
     │ bloco, category,       │             │ receita, cmv, comissao,   │
     │ total, n               │             │ frete, impostos, ads_spend│
     │ (Pessoal/Estrutura/    │             │ (Margem de contribuição)  │
     │  Serviços/Operacional/ │             └─────────────┬─────────────┘
     │  Financeiro/Excluído/  │                           │
     │  Impostos sobre venda) │                           │
     └───────────┬───────────┘                           │
                 │                                         │
                 └───────────────┬─────────────────────────┘
                                 ▼
                 ┌───────────────────────────────────┐
                 │ Client-side composition (Phase 88) │
                 │ Receita − impostos − tarifas −      │
                 │ frete − CMV − ads = Margem          │
                 │ − (Pessoal+Estrutura+Serviços+       │
                 │    Operacional) = Resultado oper.    │
                 │ − Financeiro = Resultado líquido     │
                 └───────────────────────────────────┘
```

Both RPCs are `SECURITY INVOKER`; RLS (`is_org_member`) on `cash_outflows` and `orders` is what actually enforces tenant isolation — the RPC's `p_org_id` parameter is convenience, not the security boundary.

### Recommended Project Structure
```
supabase/migrations/
└── 202606NN000000_get_dre_operational_by_competence.sql   # NEW — this phase (pick NN so timestamp > 690100, see Pitfall 1)
```
No new frontend files in this phase (Phase 88's territory).

### Pattern 1: `SECURITY INVOKER` monthly aggregation RPC (copy this shape)
**What:** A `LANGUAGE sql STABLE SECURITY INVOKER` function that filters by `organization_id` + a month range, classifies rows via `CASE`, and `GROUP BY`s the classification + raw category (so the frontend can both show blocks and drill into which categories fed them).
**When to use:** Any small, RLS-protected, single-table aggregation exposed to `authenticated` via `supabase.rpc()`.
**Example (the already-validated prior implementation — reuse this shape, swap in the CURRENT category map from `87-CONTEXT.md`):**
```sql
-- Source: supabase/migrations/20260687000000_get_dre_operational_by_competence.sql
-- (worktree /root/garment-glow-dre, branch gsd/phase-86-dre-competencia, applied to prod
--  ckcdevcxgvueywivefgx via MCP apply_migration 2026-07-06, reconciled delta R$0,00 for June/2026)
CREATE OR REPLACE FUNCTION public.get_dre_operational_by_competence(
  p_org_id uuid,
  p_month  date
)
RETURNS TABLE (
  bloco                     text,
  category                  text,
  total                     numeric,
  n                         integer,
  financeiro_is_approximate boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN co.category IN ('Imposto Venda - ICMS','Imposto Venda - PIS','Imposto Venda - COFINS')
        THEN 'impostos_venda'
      WHEN co.category IN ('Salários','Pessoal - INSS')
        THEN 'pessoal'
      WHEN co.category IN ('Aluguéis e condomínio','Água, luz','Telecomunicação, internet')
        THEN 'estrutura'
      WHEN co.category IN ('Contabilidade','Insumos','Itens do CD')
        THEN 'servicos'
      WHEN co.category = 'Empréstimo'
        THEN 'financeiro'
      WHEN co.category IN (
        'Fornecedores','Previsões de compra','Aporte',
        'ADS Mercado Livre','Prestação de serviço do Mercado Envios Full',
        'ADS Shopee','Ads Magazine Luiza','Vendas Mercado Livre','Vendas Magalu'
      ) THEN 'excluido'
      ELSE 'outros_operacionais'
    END                                        AS bloco,
    co.category                                AS category,
    sum(co.amount)                             AS total,
    count(*)::integer                          AS n,
    (co.category = 'Empréstimo')               AS financeiro_is_approximate
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
          >= date_trunc('month', p_month)::date
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
          <  (date_trunc('month', p_month) + interval '1 month')::date
  GROUP BY 1, co.category
  ORDER BY 1, sum(co.amount) DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_operational_by_competence(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_operational_by_competence(uuid, date) TO authenticated;
```
[VERIFIED: codebase — read directly from `/root/garment-glow-dre/supabase/migrations/20260687000000_get_dre_operational_by_competence.sql`, an unmerged sibling worktree of this exact repo]

**What must change for the CURRENT (2026-07-08) CONTEXT.md map** (do not ship the block above verbatim):
1. `COALESCE(competence_date, date_trunc('month', outflow_date)::date)` fallback — the prior version used bare `co.competence_date` with no fallback (Phase 86 was not yet fully reconciled when it shipped); the current CONTEXT explicitly locks the `COALESCE` fallback so the ~8.7% of rows with NULL competence are not silently dropped.
2. `Cartão de crédito` moves from the `excluido` branch to the `outros_operacionais`/`operacional` branch (current decision: include, with a visible note — see below), reversing the prior branch's `20260687000100_dre_exclude_credit_card.sql` refinement.
3. Split `servicos` into two blocks per current CONTEXT: `servicos` (`Contabilidade`, `Serviços gerais`) and a new `operacional` block (`Insumos`, `Itens do CD`, `Impostos, taxas`, `Veículos, transportes`, `Cartão de crédito`) — the prior RPC only had one merged `servicos` bucket.
4. Add `Pró-labore` to the `pessoal` branch (present in the current map even though it hasn't appeared in 2026 data yet).
5. Add `Reembolso cliente` explicitly to `excluido` (or a dedicated `deducao_receita` bloco if it ever appears with a non-zero value — CONTEXT says it should deduct from revenue, not appear as an operational expense; since it's 0 in 2026 either choice is currently a no-op, but the CASE should have an explicit branch so a future non-zero value doesn't fall into the catch-all).
6. Decide (plan's discretion) whether `Outros` (catch-all, 0 rows in 2026) gets folded into `operacional` or kept as a distinct visible bucket — CONTEXT defers this explicitly.
7. Visibility for the double-count: since the RPC returns `category` alongside `bloco`, the frontend (Phase 88) can already render a per-category breakdown and attach the "pode conter fatura ML já contabilizada" note to the `Cartão de crédito` row specifically — no new RPC column is strictly required, but the plan may choose to add a `notes`/`is_flagged` boolean column analogous to `financeiro_is_approximate` for symmetry. This is a Claude's-Discretion call, not a locked requirement.

### Pattern 2: `CTE MATERIALIZED` to avoid the RLS-under-INVOKER timeout
**What:** Pre-load any lookup table used more than once (or joined per-row) into a `MATERIALIZED` CTE so its RLS policy is evaluated once per query, not once per row.
**When to use:** This specific RPC does NOT need this pattern — it's a single-table `GROUP BY` with no correlated subquery or per-row lookup. Document it anyway because CONTEXT explicitly calls out the timeout risk, and the plan/verifier should confirm the shipped RPC has zero correlated subqueries before sign-off.
**Example (from this same codebase, a case that DID need the pattern):**
```sql
-- Source: supabase/migrations/20260668000300_get_replenishment_by_sku_alvo_order_up_to.sql
WITH
params_lookup AS MATERIALIZED (
  SELECT rp.scope, rp.scope_value, rp.lead_time_dias, ...
  FROM replenishment_params rp WHERE rp.organization_id = p_org_id
),
costs_by_sku AS MATERIALIZED (
  SELECT DISTINCT ON (c.seller_sku) c.seller_sku, c.cost FROM ml_product_costs c
  WHERE c.organization_id = p_org_id ... ORDER BY c.seller_sku, c.updated_at DESC NULLS LAST
)
-- ... joined, not correlated-subqueried, against these preloaded sets
```
[VERIFIED: codebase] — this is the exact fix documented in `feedback_rpc_rls_correlated_subquery_timeout` after `get_replenishment_by_sku` blew the `authenticated` role's 8s `statement_timeout` (worked fine as `postgres`, which bypasses RLS).

### Anti-Patterns to Avoid
- **`SECURITY DEFINER` + `p_org_id` parameter:** bypasses RLS entirely; any authenticated user can pass an arbitrary `org_id` and read another tenant's `cash_outflows` (IDOR). This project's own security review already caught this once on `get_margin_with_ads_by_product` (`feedback_supabase_security_invoker`) — do not repeat it.
- **Testing the RPC only as `postgres` (e.g. via the Supabase MCP `execute_sql`, which runs as a superuser/bypasses RLS):** this hides both RLS-timeout costs and IDOR bugs. Always additionally test as the `authenticated` role with a real member's `auth.uid()` (see Research Goal 3 for the exact `SET LOCAL ROLE` snippet).
- **Casting a `"YYYY-MM"`-shaped string straight to `::date`:** raises an error; Phase 86's own migration had to guard this with `to_date(... || '-01', 'YYYY-MM-DD')`. Not directly relevant to this RPC (it consumes an already-`date`-typed `competence_date`), but relevant if the plan ever needs to parse `p_month` from a text input at the edge (frontend should pass a real `date`, e.g. `'2026-06-01'`).
- **A `LIMIT`-truncated result set:** PostgREST truncates at 1000 rows by default. Not a risk here (this RPC returns at most ~10 blocks × ~25 categories per month, far under 1000), but keep it in mind if the plan later widens scope to a date range spanning many months.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ML revenue/CMV/comissão/frete/impostos totals for a month | A new query against `orders` inside the Phase 87 RPC | Existing `get_cost_waterfall(p_org_id, p_user_ids, p_from, p_to)` (used today by `useMLCostWaterfall` → `MLCostCard` at `/vendas`) or `get_margin_with_ads_by_product`/`get_margin_summary` (used by `/produtos-vendidos`, `/analise-precos`) | Both already exist, are `SECURITY INVOKER`, already handle the `status IN ('paid','shipped','delivered')` filter and the has_cmv/has_tax_data null-handling; duplicating this logic inside the new RPC risks drifting from the numbers shown elsewhere in the app and double-counting CMV/tarifas that `cash_outflows`'s `Fornecedores`/`Previsões de compra` exclusion already accounts for |
| ML tarifas (comissão real da fatura ML) for a month | Re-deriving tarifas from `orders.comissao` inside this RPC | `ml_billing_daily` (already used by `useMLBillingDaily` for the `/vendas` DRE card) — NOTE this table's `charge_date` is currently the ML invoice lançamento date, not true sale-competence (Phase 84's true-competence version is unmerged/paused — see Research Goal 1) | Building a third parallel tarifas computation would create a THIRD number for "ML fees this month" alongside the two that already exist (`orders.comissao` estimate vs. `ml_billing_daily` real invoice) |
| Category→DRE-block classification storage | A new `dre_category_map` table + admin CRUD UI | A `CASE` expression inside the RPC (Standard Stack → Alternatives Considered) | ~25 static categories, changes rarely (Wesley adds a Tiny category a few times a year), and CONTEXT's map already reads like curated code comments — a table adds RLS/migration/UI surface for no real maintainability win at this category count |
| Anti-IDOR checks | A manual `IF p_org_id NOT IN (SELECT org FROM organization_members WHERE user_id = auth.uid())` guard inside the function body | `SECURITY INVOKER` + the table's own RLS policy (`cash_outflows_select` → `is_org_member(auth.uid(), organization_id)`) | The project's existing RLS policy already does this correctly for every other margin RPC; a hand-rolled guard duplicates logic and is one more place to get subtly wrong (e.g., forgetting the `member`/`viewer` role nuance) |

**Key insight:** every piece this phase might be tempted to "just also compute for completeness" (revenue, CMV, ML fees) already has a validated, reconciled, production RPC. The only genuinely new logic in Phase 87 is the category→block `CASE` and the `competence_date` fallback — keep the RPC's blast radius to exactly that.

## Common Pitfalls

### Pitfall 1: An unmerged branch already deployed this exact feature to the same production database
**What goes wrong:** The plan treats Phase 87 as greenfield, authors a migration that either (a) collides in intent with an already-existing `get_dre_operational_by_competence` function in prod (harmless if `CREATE OR REPLACE` and the body ends up equivalent, but easy to get subtly wrong if the plan doesn't know the old body exists), or (b) picks a migration filename/timestamp that happens to match one already recorded against this same Supabase project from the other branch, causing an `apply_migration` conflict or silent no-op.
**Why it happens:** Branch `gsd/phase-86-dre-competencia` (worktree `/root/garment-glow-dre`) was used for a full, independent 07-06/07-07 execution of Phases 86, 87, 88, and 90 (per project memory `project_garment_dre_resultado_completa.md`), all deployed straight to prod via MCP `apply_migration`, but **never merged into `main`**. `main`'s own Phase 86 (executed 2026-07-08) already collided with this once: its migration `20260686000000_cash_outflows_competence_date.sql` found the column and all 3 enrichment functions "already in prod via drift" (86-02-SUMMARY.md, "Achado-chave") — that drift is this exact unmerged branch's earlier work, not manual admin action. Verified: `git branch -a` shows `gsd/phase-86-dre-competencia` both as a local worktree (`/root/garment-glow-dre`, HEAD `b6248dfe`) and pushed to `origin/gsd/phase-86-dre-competencia`; that worktree's `supabase/migrations/` contains `20260687000000_get_dre_operational_by_competence.sql`, `20260687000100_dre_exclude_credit_card.sql`, `20260690000000_get_imposto_guia_by_competence.sql`, `20260690000100_cmv_cheio_schema.sql`, `20260690000200_backfill_custo_unit_cheio.sql` — none of which exist anywhere in `main`'s migration history. **`main`'s own Phase 90 (a completely different feature, "Atendimento reclamações") independently used the exact same timestamp prefixes `20260690000000`/`20260690000100`** for unrelated files (`ml_claims_seller_action.sql`, `ml_claim_templates.sql`) — proof that both lines of work advanced the timestamp-based numbering scheme independently and will collide if ever diffed/merged.
**How to avoid:** Before authoring the migration, the orchestrator should run (via Supabase MCP, not available to this research agent):
```sql
SELECT proname, pg_get_functiondef(oid) FROM pg_proc WHERE proname IN
  ('get_dre_operational_by_competence','get_imposto_guia_by_competence');
SELECT column_name FROM information_schema.columns
  WHERE table_name IN ('ml_product_costs','orders') AND column_name IN ('cost_full','custo_unit_cheio');
```
If `get_dre_operational_by_competence` already exists, treat this phase as "reconcile the category map to the CURRENT CONTEXT.md and re-`CREATE OR REPLACE`", not "build from zero" — and pick a migration filename with a timestamp safely above the highest one seen in either branch (`main`'s highest today is `20260690000100`; the other branch's highest is `20260690000200`) — e.g. `20260692000000` or later, never re-using `20260687*`.
**Warning signs:** `apply_migration` returns success but a follow-up `SELECT` shows the function/column already had the exact expected shape before the migration ran (the same "surprise" Phase 86 hit).

### Pitfall 2: RLS-under-INVOKER cost is invisible when tested as `postgres`
**What goes wrong:** The RPC looks instant when checked via the Supabase MCP `execute_sql` tool (which runs as `postgres`/superuser and bypasses RLS entirely), but times out or is slow for real `authenticated` users because the RLS policy (`is_org_member(auth.uid(), organization_id)`) gets re-evaluated per row (only a risk with correlated subqueries/LATERAL, not with this RPC's plain `WHERE organization_id = p_org_id GROUP BY` shape, but must still be PROVEN, not assumed).
**Why it happens:** `authenticated` has an 8s `statement_timeout`, `anon` has 3s; `postgres` has none in practice for interactive queries. This project already hit this exact failure mode on `get_replenishment_by_sku` (Phase 68).
**How to avoid:** Test as the real role before sign-off:
```sql
BEGIN;
SET LOCAL statement_timeout = '8s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<real-member-uuid>","role":"authenticated"}', true);
EXPLAIN (ANALYZE, TIMING) SELECT * FROM get_dre_operational_by_competence('<org-uuid>'::uuid, '2026-06-01'::date);
ROLLBACK;
```
**Warning signs:** Query plan shows a `SubPlan`/`InitPlan` re-executed per row, or `EXPLAIN ANALYZE` under `authenticated` takes noticeably longer than under `postgres` for the same inputs.

### Pitfall 3: Tiny groups by nota date, `orders` groups by pedido date — do not expect the ML-side margin to reconcile to Tiny's own "Custos e-commerce" screen
**What goes wrong:** Reconciling June/2026 against "a known-closed month" can silently mean two different things: reconciling `cash_outflows`'s June total (competence-based, this phase's actual job) vs. accidentally trying to also reconcile the ML revenue side against Tiny's own revenue report, which uses a different date rule entirely.
**Why it happens:** Documented project finding (`project_garment_tiny_vs_dash_reconciliation.md`): the dashboard's `orders`-based revenue uses **data do pedido** (sale date); Tiny's "Custos para e-commerce" screen uses **data da nota fiscal / inclusão**. For June/2026, Pé Vermeio: dash = 961 orders / R$261.987,61; Tiny screen = 886 orders / R$239.585,35 — a R$22.402 gap that is fully explained by the two different date rules (proven pedido-by-pedido), not a bug.
**How to avoid:** Phase 87's reconciliation target is `cash_outflows` totals by `competence_date` (a Tiny **contas a pagar** field, already the right thing per Phase 86's own backfill), which is a *different* Tiny concept from the "Custos e-commerce" revenue screen. Reconcile `Σ RPC blocks == Σ cash_outflows WHERE competence_date (with fallback) falls in June` — a same-source, same-rule check (this is exactly what the prior unmerged implementation did, achieving R$0,00 delta). Do NOT try to additionally reconcile the ML revenue side against Tiny's "Custos e-commerce" screen inside this phase — that's a documented, already-resolved-elsewhere source-of-truth question (dash and Tiny "answer different questions," per the memory), not something Phase 87 needs to fix.
**Warning signs:** A reconciliation task that pulls numbers from Tiny's UI "Custos para e-commerce" screen instead of directly querying `cash_outflows`.

### Pitfall 4: `execute_sql` via Supabase MCP only returns the LAST result set
**What goes wrong:** A verification script that runs multiple `SELECT`s in one `execute_sql` call (e.g., baseline count, then post-apply count, then function signature check) only surfaces the final statement's output — earlier `SELECT`s appear to silently vanish.
**Why it happens:** Documented project-wide MCP behavior (referenced across multiple prior phase RESEARCH docs in this repo, e.g. Phase 79/81).
**How to avoid:** Either issue one `execute_sql` call per `SELECT` you need to see, or wrap multi-step checks in a single query using `UNION ALL`/CTEs that funnel into one final result set, or use `jsonb_build_object` to bundle multiple checks into one row.
**Warning signs:** A verification task "looks complete" but only the last of several expected numbers was ever actually observed.

### Pitfall 5: `cash_outflows.amount` is always positive — do not subtract it twice
**What goes wrong:** Treating `amount` as already-signed (negative for some categories) and subtracting it again in a later formula, understating the expense.
**Why it happens:** Some other tables in this codebase (`ml_billing_daily`) use signed amounts for bonus/cancellation rows (`B*` types are negative). `cash_outflows.amount` is NOT like that — it's documented and enforced as "valor positivo da saída" (`20260618100000_cash_flow_tables.sql:147`).
**How to avoid:** `SUM(co.amount)` in the RPC already gives a positive total per category/block; the frontend (Phase 88) should treat every RPC-returned `total` as something to SUBTRACT from the margin, never something with its own embedded sign.
**Warning signs:** A negative `total` coming back from the RPC (would indicate a data problem, not a sign-convention bug, since `amount` has no CHECK constraint against negatives — but the existing sync/enrichment pipeline never writes negative values).

## Code Examples

### Anti-IDOR proof pattern (used by this exact RPC family already)
```sql
-- Source: supabase/migrations/20260615120000_margin_with_ads_rpc.sql (header comment)
-- SECURITY INVOKER (igual às RPCs base get_margin_by_product etc.): a RLS org-first de
-- orders e ml_ads_products_cache (is_org_member, Phase 43) enforça o isolamento de tenant.
-- Evita IDOR: caller só vê dados das orgs de que é membro, mesmo passando p_org_id arbitrário.
```
Empirical proof style used in the already-validated Phase 87 implementation (87-02-SUMMARY.md, other branch): impersonate a member of a DIFFERENT org (e.g. the "Thales" org `e4150d57`) and confirm the RPC returns 0 rows for Pé Vermeio's `p_org_id`.

### `cash_outflows` schema (for reference — no changes needed in this phase beyond reading `competence_date`)
```sql
-- Source: supabase/migrations/20260618100000_cash_flow_tables.sql (as of Phase 86's competence_date ADD)
CREATE TABLE public.cash_outflows (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  outflow_date     date        NOT NULL,        -- vencimento/caixa (Phase 60 DFC — do not touch)
  amount           numeric     NOT NULL,        -- ALWAYS positive
  description      text        NOT NULL,
  supplier         text,
  category         text,                        -- Tiny categoria.descricao — the classification key
  status           text        NOT NULL DEFAULT 'pending',
  document_number  text,
  source           text        NOT NULL DEFAULT 'manual',
  tiny_payable_id  text,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  competence_date  date                          -- Phase 86: nullable, first-of-month, 91.3% backfilled 2026
);
-- RLS: cash_outflows_select FOR SELECT TO authenticated USING (is_org_member(auth.uid(), organization_id));
-- Index available for this RPC's WHERE/GROUP BY: cash_outflows_org_competence_category_idx (organization_id, competence_date, category)
```
[VERIFIED: codebase — `supabase/migrations/20260618100000_cash_flow_tables.sql` + `20260686000000_cash_outflows_competence_date.sql`, both in `main`]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `cash_outflows` readable only by `outflow_date` (vencimento/caixa) | `competence_date` (Tiny `dataCompetencia`, fallback to `outflow_date`'s month) also available | Phase 86, 2026-07-08 | Phase 87 is the first consumer of this new column for a resultado (not caixa) view |
| DRE at `/vendas` stops at "Margem de contribuição" (ML-only) | DRE extends to a full Resultado (Pessoal/Estrutura/Serviços/Operacional/Financeiro) | Phase 87 (this phase) + Phase 88 (frontend) | First time the dashboard shows whether the OPERATION (not just the marketplace channel) is profitable — validated once already on the unmerged branch: June/2026 flips from "+R$20.888 lucro" (ML-only) to "−R$29.094 prejuízo" (all-in), which is the whole point of this milestone |

**Deprecated/outdated:**
- ROADMAP.md's Phase 87 Success Criterion 1 text (SAC split of the loan, R$300.000/45) is superseded by the 2026-07-08 CONTEXT.md decision to use the full parcela — treat CONTEXT.md as authoritative per this project's own upstream-input rules, not the ROADMAP wording (see Assumptions Log A1).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ROADMAP.md's Phase 87 SC-1 wording (SAC split of the loan) is stale and CONTEXT.md's "full parcela" decision supersedes it | User Constraints, State of the Art | Low — CONTEXT.md is explicitly dated 2026-07-08 and says "OVERRIDE do ROADMAP" in its own heading; this is not really an assumption but is logged because a planner skimming only the ROADMAP could miss the override |
| A2 | The `Outros` catch-all category folding choice (into `operacional` vs. a separate visible bucket) has no behavioral impact today because it has 0 rows in 2026 | Standard Stack / Pattern 1 | Low today, but if a new Tiny category appears uncategorized mid-2026 it will silently land wherever the plan chooses — must be a deliberate, documented choice, not an accident |
| A3 | The unmerged branch `gsd/phase-86-dre-competencia`'s deployed RPC (`20260687000000`/`20260687000100`) is still live in prod today (2026-07-08) and was not since reverted | Summary, Pitfall 1 | High if wrong in the other direction (i.e., if someone already reverted it) — but higher risk if this assumption is ignored and the plan proceeds as pure-greenfield without checking prod first, which is why this is called out as a blocking pre-check rather than asserted as fact |
| A4 | `Reembolso cliente` should get its own explicit `CASE` branch (rather than falling into the catch-all) even though it's currently 0 in 2026 | Pattern 1, item 5 | Low — if wrong, a future non-zero `Reembolso cliente` row would land in "outros_operacionais" as an expense instead of being flagged for revenue-deduction handling in Phase 88; easy to fix later since it's additive |

**If this table is empty:** N/A — see rows above. All four are LOW-to-MEDIUM risk and independently correctable; none block starting Phase 87, but A3 should be resolved (via MCP, by the orchestrator) before the plan finalizes its migration numbering strategy.

## Open Questions

1. **Which RPC is "the" ML-side source Phase 87/88 should combine with — `get_cost_waterfall` (used today by `/vendas`'s `MLCostCard`) or `get_margin_with_ads_by_product` (used by `/produtos-vendidos`/`/analise-precos`, and the one `87-CONTEXT.md`'s canonical_refs explicitly names)?**
   - What we know: These two RPCs give DIFFERENT numbers for the same month. `get_cost_waterfall` combines `orders`' CMV/impostos with `ml_billing_daily`'s REAL ML invoice tarifas (via the `useMLBillingDaily`/`groupBillingCharges` client-side pipeline) — this is what `/vendas` shows today. `get_margin_with_ads_by_product` uses `orders.comissao`/`orders.frete` (a per-order ESTIMATE, not the real invoice) plus `ml_ads_products_cache` for ads — this is what `/produtos-vendidos` and `/analise-precos` show today. The two have differed historically (that's the whole reason Phase 84 exists). `87-CONTEXT.md`'s `<specifics>` section explicitly says "Fonte de receita/CMV/tarifas ML: NÃO reinventar — plugar na fonte já usada por /produtos-vendidos / /analise-precos (MCO com ads)" — naming the SECOND family — while the earlier (2026-07-06, other branch) version of this same phase's context said the opposite ("já vem da fonte existente do /vendas: orders + ml_billing_daily").
   - What's unclear: Whether this is a deliberate decision to align the new full-DRE with the MCO-with-ads numbers app-wide (a bigger, cross-cutting change to how `/vendas` DRE is composed) or an imprecise citation in CONTEXT.md that really just means "reuse SOME existing validated margin source, don't build a new one" generically.
   - Recommendation: Since ROADMAP's Success Criteria for Phase 87 (the authoritative "must be true" list) say NOTHING about which margin RPC to combine with — they only describe classifying `cash_outflows` — treat this as a Phase 88 (frontend combination) decision, not a Phase 87 (RPC) decision. Phase 87's RPC should be scoped to `cash_outflows` only (matching the already-validated precedent's scope exactly). Flag this open question to the orchestrator/Wesley before Phase 88 is planned, since it determines whether `/vendas`'s existing DRE card composition is reused as-is or re-pointed at the MCO-with-ads numbers.

2. **Does the current `authenticated`-role prod already have Phase 90-worktree's `custo_unit_cheio`/`cost_full` columns and `get_imposto_guia_by_competence` RPC, and if so, does that change how "closed month" reconciliation should treat CMV/impostos for Phase 87's own reconciliation step?**
   - What we know: Per project memory, the other branch's Phase 90 (unmerged) changed how CMV and impostos are computed for CLOSED months specifically (real guia + `cmv_cheio` instead of estimate + custo médio) — but Phase 87's own scope is `cash_outflows` only, so this shouldn't matter for the RPC itself.
   - What's unclear: Whether the June/2026 reconciliation task (Research Goal 5) should reconcile PURELY `cash_outflows` (this phase's actual deliverable, unaffected by Phase 90) or accidentally get pulled into reconciling the full all-in DRE number against Wesley's spreadsheet (which requires Phase 90's not-yet-merged imposto/CMV fixes to match).
   - Recommendation: Scope the Phase 87 reconciliation task to `Σ RPC blocks == Σ cash_outflows (competence, fallback-adjusted)` only — a same-source check, exactly like the prior validated implementation did (R$0,00 delta). Do not attempt to reconcile against Wesley's full P&L spreadsheet inside Phase 87; that full reconciliation is contingent on Phase 88 (margin combination) and Phase 90 (imposto/CMV correction) decisions that are explicitly out of scope here.

## Environment Availability

Not applicable — no external CLI/service dependency. This phase's only "environment" dependency is Supabase MCP access for `apply_migration`/`execute_sql` on project `ckcdevcxgvueywivefgx`, which every prior phase in this repo (86, 84, etc.) has used successfully; no new tool is introduced.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | `SECURITY INVOKER` + RLS policy `is_org_member(auth.uid(), organization_id)` on `cash_outflows` — the project's standing anti-IDOR pattern for every tenant-scoped RPC |
| V5 Input Validation | yes | `p_org_id uuid`, `p_month date` are strongly typed by Postgres's function signature; no dynamic SQL, no string concatenation of user input (the `CASE` branches match against a fixed, hardcoded category list, not user-supplied strings) |
| V6 Cryptography | no | Not applicable — no secrets/crypto in this RPC |
| V2 Authentication | no | Delegated entirely to Supabase Auth + existing `authenticated` role grant; this RPC does not touch auth |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR via `p_org_id` parameter tampering | Elevation of Privilege / Information Disclosure | `SECURITY INVOKER` (never DEFINER) + RLS `is_org_member` check on the underlying table — this project's own security review has already caught and fixed exactly this class of bug once (`feedback_supabase_security_invoker`) |
| RLS-under-INVOKER statement-timeout DoS (self-inflicted, not attacker-driven, but a real prod incident risk) | Denial of Service | No correlated subqueries/LATERAL against RLS-protected tables; if ever needed, preload into `CTE MATERIALIZED` (this RPC's shape does not need this, but must be verified under the `authenticated` role, not just `postgres`) |
| `EXECUTE` grant left open to `anon`/`PUBLIC` after a `CREATE OR REPLACE` | Elevation of Privilege | Explicit `REVOKE EXECUTE ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated` re-issued in the SAME migration every time the function is replaced (Postgres does not reliably preserve prior REVOKEs across `CREATE OR REPLACE` — this exact threat, T-86-02, was already identified and mitigated in Phase 86's migration) |

## Sources

### Primary (HIGH confidence — verified directly against this repo and its unmerged sibling worktree)
- `/root/garment-glow-test/.planning/phases/87-.../87-CONTEXT.md` (2026-07-08) — the authoritative category map and decisions for this phase
- `/root/garment-glow-test/.planning/ROADMAP.md` (Phase 84/86/87/88 sections) — Success Criteria and milestone sequencing
- `/root/garment-glow-test/.planning/phases/86-.../86-01-PLAN.md`, `86-02-SUMMARY.md` — competence_date foundation, backfill %, cron mapping
- `/root/garment-glow-test/supabase/migrations/20260618100000_cash_flow_tables.sql` — `cash_outflows` schema, RLS policy
- `/root/garment-glow-test/supabase/migrations/20260686000000_cash_outflows_competence_date.sql`, `20260661000000_enrich_supplier_category.sql` — enrichment pipeline, competence parsing pattern
- `/root/garment-glow-test/supabase/migrations/20260527110000_margin_aggregate_rpcs.sql`, `20260615120000_margin_with_ads_rpc.sql` — `get_margin_*`/`get_cost_waterfall` RPC family, INVOKER pattern
- `/root/garment-glow-test/src/hooks/useMLBilling.ts`, `/root/garment-glow-test/src/pages/MercadoLivre.tsx` — how `/vendas`'s existing DRE card sources revenue/CMV/tarifas/ads today
- `/root/garment-glow-dre/supabase/migrations/20260687000000_get_dre_operational_by_competence.sql`, `20260687000100_dre_exclude_credit_card.sql` — the already-built-and-prod-validated prior implementation of this exact phase, on unmerged branch `gsd/phase-86-dre-competencia`
- `/root/garment-glow-dre/.planning/phases/87-.../87-02-SUMMARY.md` — the prior reconciliation proof (R$0,00 delta, June/2026)
- `/root/.claude/projects/-root/memory/project_garment_dre_resultado_completa.md`, `feedback_rpc_rls_correlated_subquery_timeout.md`, `feedback_supabase_security_invoker.md`, `project_garment_tiny_vs_dash_reconciliation.md` — cross-session project memory corroborating all of the above

### Secondary (MEDIUM confidence)
- [PostgreSQL: Documentation: CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html) — `SECURITY INVOKER` default semantics
- [PostgreSQL: Documentation: 21.6. Function Security](https://www.postgresql.org/docs/current/perm-functions.html) — `search_path` hardening guidance

### Tertiary (LOW confidence)
- None used — this phase had no need for unverified web claims; every technical decision traces to this codebase or its unmerged sibling.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, pure reuse of an already-established project pattern (`get_margin_*` RPC family)
- Architecture: HIGH — the exact target RPC already exists, was built, deployed, and reconciled once; verified by direct file read, not inference
- Pitfalls: HIGH — every pitfall listed is either a documented project incident (RLS timeout, IDOR, PostgREST truncation, MCP multi-result-set) or a directly-observed git/branch state (the unmerged-branch collision)

**Research date:** 2026-07-08
**Valid until:** Short — 7 days. This research's central finding (Pitfall 1) is a live, unresolved git/prod-state fact that could change the moment anyone applies a migration on either branch or merges `gsd/phase-86-dre-competencia`. Re-verify prod state via MCP immediately before planning, not just before this research was written.
