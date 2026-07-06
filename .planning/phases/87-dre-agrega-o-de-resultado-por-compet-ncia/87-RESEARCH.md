# Phase 87: DRE — Agregação de Resultado por Competência - Research

**Researched:** 2026-07-06
**Domain:** PostgreSQL RPC (SECURITY INVOKER, org-scoped aggregation) over `cash_outflows` (Phase 86: now has `competence_date`), no frontend, no new libraries
**Confidence:** HIGH — every claim about existing code (RPCs, hooks, components, schema, RLS) was verified by reading the actual source in this repo (`/root/garment-glow-dre`). No Supabase MCP tools were available to this research session (no `mcp__supabase__*` tool was exposed), so live-DB category strings and current row counts were **not** queried directly — this is flagged explicitly below as an executor pre-flight step, exactly as Phase 86's research did under the same constraint.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Mapa categoria (Tiny `category`) → bloco da DRE**
- **Impostos sobre venda (deduzem receita):** `Imposto Venda - ICMS`, `Imposto Venda - PIS`, `Imposto Venda - COFINS`.
- **Pessoal (operacional):** `Salários`, `Pró-labore` (hoje lançado como `Salários`), `Pessoal - INSS`.
- **Estrutura (operacional):** `Aluguéis e condomínio`, `Água, luz`, `Telecomunicação, internet`.
- **Serviços/Admin (operacional):** `Contabilidade`, `Insumos`, `Itens do CD` (Wesley confirmou: Insumos e Itens do CD = operacional).
- **Financeiro:** `Empréstimo` → **somente o JURO** (ver questão aberta).
- **EXCLUIR (não entram na DRE):** `Fornecedores` e `Previsões de compra` (viram CMV), `Aporte` (capital), `Vendas Mercado Livre`/`Vendas Magalu` (receita, não despesa), `ADS Mercado Livre`/`ADS Shopee`/`Ads Magazine Luiza`/`Prestação de serviço do Mercado Envios Full` (já vêm do ML e/ou outros canais — escopo é SÓ Mercado Livre).
- **Sem IRPJ/CSLL** (empresa não recolhe) e **sem FGTS** (só INSS). DRE fecha no resultado líquido.

**Régua e escopo**
- Agrega por `competence_date` (mês de competência), casando com a receita por competência de venda.
- Escopo = **só Mercado Livre / Pé Vermeio** (org `7f615df7`, seller 1639558873).
- Anti-IDOR: RPC **SECURITY INVOKER**, filtra por `organization_id` do chamador.

**Estrutura de saída**
Receita − impostos venda − comissão/tarifas ML − frete − CMV − ads = **Margem de contribuição** → − Pessoal − Estrutura − Serviços = **Resultado operacional** → − Financeiro (juro) = **Resultado líquido**.

**Categorias não-mapeadas**
NÃO descartar silenciosamente. Categorias fora do mapa → bucket **"Outros operacionais"** visível, para revisão.

### Claude's Discretion
Not explicitly separated as a distinct section in 87-CONTEXT.md — everything material was locked. Implementation-level choices left open (and resolved by this research): SQL shape of the RPC, exact bucket/JSON encoding, how to isolate the Financeiro block pending the amortization table, and the reconciliation SQL.

### Deferred Ideas (OUT OF SCOPE)
- Frontend da DRE completa → **Phase 88**.
- Tabela exata de amortização do empréstimo (se Wesley enviar) → refina o bloco Financeiro, fora desta fase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROADMAP Phase 87, criterion 1 | RPC agrega por `competence_date` e classifica categorias em blocos (Impostos sobre venda / Pessoal / Estrutura / Serviços / Financeiro) | See "Category → Block Mapping" and "Aggregation SQL Sketch" below |
| ROADMAP Phase 87, criterion 2 | Exclui `Fornecedores`, `Previsões de compra`, `Aporte`, categorias de outros canais | See "Exclusion List" — note: `cash_outflows` has **no channel/`ml_user_id` column**, so "escopo só ML" is enforced entirely by category exclusion, not a store filter |
| ROADMAP Phase 87, criterion 3 | Sem IRPJ/CSLL, sem FGTS — fecha no resultado líquido | Confirmed: these simply never appear as categories to map; no special-casing needed |
| ROADMAP Phase 87, criterion 4 | Anti-IDOR (organization_id do chamador, SECURITY INVOKER); reconciliação com mês real fechado | See "RPC Pattern to Copy" and "Reconciliation Plan" |
| ROADMAP Phase 87, criterion 5 | Estrutura de saída pronta pro frontend (Margem de contribuição → Resultado operacional → Financeiro → Resultado líquido) | See "RPC Boundary Decision" and "Output Shape" |
| **⚠️ ROADMAP text is stale** | ROADMAP's own criterion 1 text still says "separar principal via aproximação SAC R$300.000/45 = R$6.666,67/parcela" | **This contradicts the newer, locked 87-CONTEXT.md open question**, which explicitly says the SAC approximation is **wrong** (errs the carência parcela) and must NOT be baked in as final. CONTEXT.md postdates and supersedes this ROADMAP line. The planner MUST follow CONTEXT.md's instruction (isolate Financeiro as approximate/pending, do not hardcode SAC) — flagging this discrepancy explicitly so it isn't silently "resolved" by copying the stale ROADMAP text into a plan. |
</phase_requirements>

## Summary

This phase is a pure Postgres RPC addition, no new libraries, entirely additive to an already-shipped, already-reconciled DFC/margin stack. The codebase already proves the correct architectural boundary by example: the existing "DRE do Mês" card (`MLCostCard.tsx`, rendered from `src/pages/MercadoLivre.tsx`) computes the **margin** (Receita − tarifas ML − CMV − impostos) entirely client-side, by combining one RPC (`get_cost_waterfall`, orders-based: paid_revenue/cmv/comissao/frete/tax) with two direct table reads (`ml_billing_daily`, `ml_billing_monthly`) across a 3-tier fallback (`competencia` → `billing` → `estimado`). There is **no single "margin RPC"** to wrap — the margin side is already a composed, stateful client computation. The new Phase 87 RPC must **not** try to re-derive or re-wrap that composition. It should be a narrow, single-purpose RPC that reads only `cash_outflows` (now with `competence_date` since Phase 86), groups `SUM(amount)` by month + DRE-block for a given org, and returns the operational-cost blocks (Pessoal/Estrutura/Serviços) plus a clearly-isolated, clearly-flagged Financeiro/juro block. Phase 88's frontend will compose this new RPC's output with the existing margin computation client-side — the same pattern `MercadoLivre.tsx` already uses to stitch multiple data sources into one card.

The codebase already contains a near-identical precedent to copy nearly verbatim: `get_cost_by_month(p_org_id, p_months)` (`supabase/migrations/20260650000100_treasury_category_backfill.sql`) already does `SUM(co.amount) GROUP BY TO_CHAR(co.outflow_date,'YYYY-MM'), category` for the existing cost-composition chart. The new RPC is structurally the same query, swapping `outflow_date` for `competence_date`, adding the DRE-block CASE mapping, and returning per-block subtotals instead of raw per-category rows (or both, so the "Outros operacionais" bucket stays inspectable).

**Primary recommendation:** Write a single new `SECURITY INVOKER`, `LANGUAGE sql`, `STABLE` function `get_dre_operational_blocks(p_org_id UUID, p_month DATE)` that (1) applies a `CASE` mapping from `category` to one of `{impostos_venda, pessoal, estrutura, servicos, financeiro, outros_operacionais, excluded}`, (2) filters out `excluded` rows entirely, (3) `GROUP BY` DRE-block + `competence_date` month, (4) returns rows plus a `raw_categories` breakdown so unmapped ("Outros operacionais") categories are visible for review, and (5) treats the Financeiro/juro amount as a **separate, explicitly-flagged, approximate value** (never silently netted into "Resultado operacional") until Wesley supplies the bank's amortization table.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Receita, impostos de venda, comissão/tarifas ML, frete, CMV, ads (Margem de contribuição) | Database (existing `get_cost_waterfall` RPC + direct reads of `ml_billing_daily`/`ml_billing_monthly`) | Frontend (client-side composition in `MercadoLivre.tsx`) | Already fully implemented; Phase 87 must not duplicate this — it is explicitly out of scope per CONTEXT.md |
| Custos operacionais fora do ML (Pessoal/Estrutura/Serviços) by competência | Database (new RPC over `cash_outflows`) | — | `cash_outflows` (Tiny contas a pagar) is the only source of these costs; no orders/billing table has this data |
| Categoria → bloco DRE mapping | Database (CASE expression inside the new RPC, single source of truth) | — | Keeping the map in SQL (not duplicated in TypeScript) avoids drift between the RPC's grouping and any frontend re-grouping in Phase 88, mirroring how `get_cost_by_month`'s `COALESCE(...,'Outros')` pattern already centralizes categorization server-side |
| Financeiro (juro do empréstimo) | Database (new RPC, isolated column/flag) — **pending exact source, currently approximate/config-driven** | — | No column captures `juros` separately anywhere in this repo today (confirmed: `juros` from Tiny's detail response is not written to any column); this block cannot be derived purely from data until Wesley provides the amortization schedule |
| Anti-IDOR / org isolation | Database (RLS `cash_outflows_select` policy + `SECURITY INVOKER`) | — | Same enforcement mechanism as every existing DRE-adjacent RPC in this repo (`get_cost_waterfall`, `get_margin_with_ads_by_product`, `get_cashflow`, `get_cost_by_month`) |
| Frontend composition (margin + operational blocks → full DRE) | Frontend Server/Client (`MercadoLivre.tsx` or a new `/vendas` DRE section) | — | Explicitly **Phase 88**, not this phase |

## Standard Stack

No new libraries. This phase touches only:
- PostgreSQL SQL/plpgsql function (`LANGUAGE sql` is sufficient — no branching/looping needed, unlike the enrichment pipeline's plpgsql)
- Existing RLS (`is_org_member`) and `SECURITY INVOKER` pattern already used by every sibling RPC
- Supabase MCP `apply_migration` for deployment (per project convention — never `supabase db push`, no CLI token for `ckcdevcxgvueywivefgx`)

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| One RPC returning operational blocks only (this recommendation) | One RPC that also re-derives/wraps the whole margin (Receita→Resultado líquido in one call) | Would duplicate the already-composed, fallback-branching margin logic that currently lives partly in `get_cost_waterfall` (SQL) and partly in `MercadoLivre.tsx` (competencia/billing/estimado fallback, ads merge) — a second, parallel implementation of that logic in SQL would drift from the client's fallback behavior and is explicitly what CONTEXT.md says NOT to do ("a margem já vem da fonte existente... esta fase adiciona os custos fora do ML") |
| `CASE` expression inline in the RPC for category→block mapping | A small mapping table (`dre_category_map(category TEXT, block TEXT)`) | A mapping table is more "data-driven" and editable without a migration, but this project's own precedent (`get_cost_by_month`'s inline `COALESCE(...,'Outros')`) and the fact that the map is short (26 known categories, LOCKED by Wesley) favor an inline `CASE` — simpler to audit in one file, no extra table/RLS/migration surface for a list that changes rarely. If Wesley starts renaming/adding Tiny categories frequently, revisit as a table later (not now) |
| Isolating Financeiro/juro as approximate now, refining later | Hardcode the SAC approximation (R$300.000/45 = R$6.666,67/parcela) as the ROADMAP's stale text literally says | **Explicitly rejected by 87-CONTEXT.md's locked open question** — SAC misclassifies the carência parcela and doesn't match the real payment schedule; baking it in would silently corrupt "Resultado líquido" with numbers Wesley has already said are wrong |

**Installation:** none — no new dependencies.

## Package Legitimacy Audit

Not applicable — this phase installs no new packages (npm, PyPI, or otherwise); no `package.json` changes; pure SQL migration.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────────────────────────────────────┐
                         │   /vendas  "DRE do Mês" (Phase 88, NOT   │
                         │   built in this phase — shown for        │
                         │   boundary clarity only)                 │
                         └──────────────────────────────────────────┘
                                    ▲                        ▲
                                    │ (existing, unchanged)   │ (NEW — Phase 87)
        ┌───────────────────────────┘                        └───────────────────────────┐
        │                                                                                  │
┌───────────────────┐   ┌──────────────────────────┐                          ┌────────────────────────────┐
│ get_cost_waterfall │   │ ml_billing_daily /        │                          │ get_dre_operational_blocks  │
│ (RPC, orders-based)│   │ ml_billing_monthly        │                          │ (NEW RPC — this phase)      │
│ paid_revenue, cmv, │   │ (direct table reads,      │                          │ SECURITY INVOKER             │
│ comissao, frete,   │   │ RLS-scoped)               │                          │ reads cash_outflows          │
│ tax_amount         │   │ ML fee breakdown groups   │                          │ GROUP BY competence_date     │
└─────────┬──────────┘   └───────────┬───────────────┘                          │  + category→bloco CASE       │
          │                          │                                          └──────────────┬──────────────┘
          └──────────────┬───────────┘                                                         │
                          ▼                                                                     ▼
        client-side composition in MercadoLivre.tsx                          returns: {bloco, competence_month,
        (3-tier fallback: competencia > billing > estimado)                   total, financeiro_is_approximate}
        = Margem de contribuição (Receita − impostos venda                              │
          − comissão/tarifas ML − frete − CMV − ads)                                    │
                          │                                                             │
                          └──────────────────────┬──────────────────────────────────────┘
                                                  ▼
                                Phase 88 composes BOTH client-side:
                    Margem de contribuição − Pessoal − Estrutura − Serviços = Resultado operacional
                                − Financeiro (juro, flagged approximate) = Resultado líquido
```

A reader can trace: the margin path (left) is 100% pre-existing and untouched; the new RPC (right) is the only thing this phase builds; both feed into a client-side sum that Phase 88 will implement. This phase stops at "return the operational blocks correctly, scoped and reconciled" — it does not touch `MercadoLivre.tsx` or any component.

### Recommended Project Structure

No new files/directories beyond one migration:
```
supabase/migrations/
└── 202606XXNNNNNN_get_dre_operational_blocks.sql   # new RPC only — no table changes needed (cash_outflows already has competence_date from Phase 86)
```
Follow the numbering convention already in use (`2026` + `MM` + phase-derived sequence; sibling: `20260686000000_cash_outflows_competence_date.sql` for Phase 86, `20260683000000_margin_with_ads_marca.sql` for a same-month RPC change).

### Pattern 1: Copy `get_cost_by_month`'s shape, swap the date column, add the block CASE

**What:** The existing `get_cost_by_month` RPC is the closest in-repo precedent — same table, same `SUM(amount) GROUP BY month, category` shape, same `SECURITY INVOKER`/`LANGUAGE sql` style. Reuse its structure, but group by `competence_date` (not `outflow_date`) and add a `bloco` column derived via `CASE`.

**Example (existing, exact source — the template):**
```sql
-- Source: supabase/migrations/20260650000100_treasury_category_backfill.sql (get_cost_by_month)
CREATE OR REPLACE FUNCTION public.get_cost_by_month(
  p_org_id UUID,
  p_months  INT DEFAULT 9
)
RETURNS TABLE (month TEXT, category TEXT, total NUMERIC)
LANGUAGE sql
SECURITY INVOKER
SET search_path = 'public'
AS $$
  WITH base AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje)
  SELECT
    TO_CHAR(co.outflow_date, 'YYYY-MM')                        AS month,
    COALESCE(NULLIF(TRIM(co.category), ''), 'Outros')          AS category,
    SUM(co.amount)                                             AS total
  FROM cash_outflows co, base
  WHERE co.organization_id = p_org_id
    AND co.outflow_date >= (DATE_TRUNC('month', base.hoje) - ((p_months - 1) || ' months')::INTERVAL)::date
    AND co.outflow_date <  (DATE_TRUNC('month', base.hoje) + INTERVAL '4 months')::date
  GROUP BY 1, 2
  ORDER BY 1, 3 DESC;
$$;
```

**When to use:** As the direct structural template for the new RPC — same `LANGUAGE sql`/`SECURITY INVOKER`/`SET search_path` header, same `SUM(amount) FROM cash_outflows WHERE organization_id = p_org_id GROUP BY ...` core. No `MATERIALIZED` CTE / correlated-subquery concerns apply here (see Pitfall 1 below on when that pattern is actually needed vs. not).

### Pattern 2: Category → Block mapping as an inline `CASE` (single source of truth)

**What:** Map each `category` string to a DRE block using a `CASE` expression at the top of the query (as a computed column in a CTE), so both the per-category breakdown ("Outros operacionais" audit list) and the per-block subtotal can be derived from the same classification in one place.

```sql
-- Sketch — category → bloco DRE (Phase 87, locked map from 87-CONTEXT.md)
WITH classified AS (
  SELECT
    co.competence_date,
    co.category,
    co.amount,
    CASE
      WHEN co.category IN ('Imposto Venda - ICMS', 'Imposto Venda - PIS', 'Imposto Venda - COFINS')
        THEN 'impostos_venda'
      WHEN co.category IN ('Salários', 'Pró-labore', 'Pessoal - INSS')
        THEN 'pessoal'
      WHEN co.category IN ('Aluguéis e condomínio', 'Água, luz', 'Telecomunicação, internet')
        THEN 'estrutura'
      WHEN co.category IN ('Contabilidade', 'Insumos', 'Itens do CD')
        THEN 'servicos'
      WHEN co.category = 'Empréstimo'
        THEN 'financeiro_bruto'   -- ver Pattern 3: isolado, NÃO é só o juro ainda
      WHEN co.category IN (
        'Fornecedores', 'Previsões de compra', 'Aporte',
        'Vendas Mercado Livre', 'Vendas Magalu',
        'ADS Mercado Livre', 'ADS Shopee', 'Ads Magazine Luiza',
        'Prestação de serviço do Mercado Envios Full'
      )
        THEN 'excluded'
      WHEN co.category IS NULL OR TRIM(co.category) = ''
        THEN 'outros_operacionais'   -- nunca descartar silenciosamente
      ELSE 'outros_operacionais'     -- qualquer categoria fora do mapa (ex.: 'Cartão de crédito',
                                      -- 'Veículos, transportes', 'Serviços gerais', 'Reembolso cliente',
                                      -- 'Impostos, taxas' genérico) cai aqui, NUNCA em NULL/drop
    END AS bloco
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.competence_date = date_trunc('month', p_month)::date
)
SELECT bloco, category, SUM(amount) AS total
FROM classified
WHERE bloco <> 'excluded'
GROUP BY bloco, category
ORDER BY bloco, total DESC;
```

**⚠️ String-match risk (verify before locking the migration):** `87-CONTEXT.md`'s category strings do not perfectly match strings already seen elsewhere in this codebase. The frontend's `CostCompositionChart.tsx` (`src/components/financial/CostCompositionChart.tsx`) hardcodes a **different** spelling for some of the same real-world categories:
| CONTEXT.md spelling | `CostCompositionChart.tsx` spelling | Risk |
|---|---|---|
| `Aluguéis e condomínio` | `Aluguéis/condomínio` | If the DB's actual `category` string uses one of these two exact forms and the RPC's `CASE` uses the other, that category silently falls into `outros_operacionais` instead of `estrutura` |
| `Água, luz` | `Água/luz` | Same risk |
| (not present) | `Impostos/taxas` | Suggests the live category taxonomy may use `/` where CONTEXT.md's transcription uses other punctuation |

This mismatch is a known, previously-hit class of bug in this exact codebase — memory records a **Phase 85** fix for "cores gráfico Composição de Custos — fix mismatch rótulo Tiny→CATEGORY_COLORS" (a color-map lookup silently failed for exactly this reason: transcribed category labels didn't match the DB's actual strings byte-for-byte). **Before finalizing the `CASE` expression, the executor MUST run** `SELECT DISTINCT category FROM cash_outflows WHERE organization_id = '<Pé Vermeio org id>' ORDER BY 1;` via Supabase MCP (`ckcdevcxgvueywivefgx`) and use the exact strings returned, not the possibly-transcribed strings in this document or in CONTEXT.md. Treat CONTEXT.md's category names as **[ASSUMED]** spelling pending this live check (see Assumptions Log A1).

### Pattern 3: Isolate Financeiro/juro as approximate, never bake in SAC

**What:** CONTEXT.md's open question says the SAC approximation (`R$300.000/45 = R$6.666,67/parcela`) is **known wrong** (misclassifies the carência parcela as partly-principal when it's 100% juro) and explicitly forbids "resolving it autonomously with a fragile approximation." The RPC must structurally prevent this number from silently contaminating "Resultado líquido."

**Recommended approach:**
1. The `classified` CTE (Pattern 2) buckets the full `Empréstimo` category amount into `financeiro_bruto` (the whole payment, principal+interest, exactly as lançado — this part is NOT approximate, it's the real cash amount).
2. A **separate, optional** lookup — a small config table `loan_interest_schedule(organization_id, competence_month DATE, interest_amount NUMERIC, source TEXT)` — holds the *known-good* juro amount per month **once Wesley provides the bank's amortization table**. This table does not need to exist yet for this phase to ship; if it's empty/absent, the RPC returns:
   - `financeiro_bruto` (the real total `Empréstimo` cash-out for the month — always available, always correct as a total)
   - `financeiro_juro_estimado: NULL` (or `0`, clearly documented) with a boolean flag `financeiro_is_approximate: true`
3. Phase 88's frontend renders the Financeiro block with a visible "pendente / aproximado" badge (exact copy is a Phase 88 concern) whenever `financeiro_is_approximate = true`, and computes "Resultado líquido" using `financeiro_juro_estimado` (defaulting to `0` display-side, never silently substituting the SAC number).
4. When Wesley supplies the real schedule, populating `loan_interest_schedule` (or, more simply, adding a `juros_config` JSON in `financial_settings` keyed by month) flips `financeiro_is_approximate` to `false` and the exact juro flows through — **no RPC signature or shape change needed**, only new rows in the lookup.

**This is deliberately NOT included in this phase's shipped migration as a populated table** — the phase's job is to make the RPC *structurally ready* to receive the real number later without contaminating the interim output. If the planner wants the absolute minimum for this phase, it is also acceptable to return `financeiro_bruto` alone with `financeiro_is_approximate: true` and no lookup table at all yet (defer the table creation to whenever Wesley sends the amortization data) — the important constraint is: **never emit a computed juro number derived from SAC or any other guess as if it were final.**

### Anti-Patterns to Avoid
- **Re-deriving the margin (Receita−CMV−impostos−tarifas−ads) inside this RPC.** That logic already exists, is already reconciled, and has 3-tier fallback behavior that only the frontend currently implements — duplicating it in SQL creates two sources of truth that will drift.
- **Hardcoding the SAC loan approximation as the Financeiro number.** Explicitly forbidden by the locked CONTEXT.md decision — see Pattern 3.
- **Silently dropping unmapped categories.** Every row must land in a bucket, including `outros_operacionales` for anything not in the 26-category map — CONTEXT.md is explicit about this.
- **Filtering "só Mercado Livre" via a `ml_user_id`/channel column on `cash_outflows`.** That column does not exist on this table — the correct (and only) mechanism is the category exclusion list (Ads Shopee, Vendas Magalu, etc. are excluded by category, not by store).
- **Assuming `CostCompositionChart.tsx`'s category label spellings are authoritative.** They are a display-layer artifact with at least one previously-shipped mismatch bug (Phase 85) — always verify against the live `category` column, not against other frontend components' hardcoded strings.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Org isolation / anti-IDOR | Custom auth check inside the RPC body | `SECURITY INVOKER` + existing RLS policy `cash_outflows_select` (`is_org_member(auth.uid(), organization_id)`) | Every sibling RPC in this codebase (`get_cost_waterfall`, `get_margin_with_ads_by_product`, `get_cashflow`, `get_cost_by_month`) relies on this exact mechanism; reinventing an explicit permission check inside the function body would be redundant and could diverge from the RLS policy if either is updated independently |
| Category taxonomy | A new categories/lookup table synced from Tiny | Inline `CASE` expression (Pattern 2), matching `get_cost_by_month`'s existing `COALESCE(...,'Outros')` precedent | The map is short (26 known values), LOCKED by Wesley, and changes rarely; a table adds migration/RLS/sync surface for no real benefit at this size |
| Month-bucketing | App-side date math in the hook | `date_trunc('month', p_month)` / direct `competence_date` equality server-side (already 1st-of-month per Phase 86) | `competence_date` is already stored as the first day of the month (Phase 86 decision) — no additional parsing needed, just compare/GROUP BY directly |

**Key insight:** everything this phase needs is a straightforward `GROUP BY` aggregation with a `CASE`-based classifier — no correlated per-row subqueries, no cross-service round-trips, and no new infrastructure. The main risk in this phase isn't architecture, it's **string-matching accuracy** between the locked category names in CONTEXT.md and the literal bytes stored in `cash_outflows.category` (see Pattern 2's warning and Assumptions Log).

## Common Pitfalls

### Pitfall 1: Reaching for `CTE ... MATERIALIZED` when it isn't needed here (and skipping it when it might be)
**What goes wrong:** This repo has a documented, real incident (Phase 68, `get_replenishment_by_sku_*`) where a RPC ran fine as `postgres` (RLS off, ~0.9s) but blew past the 8s `statement_timeout` under the `authenticated` role because it had ~7.4k correlated subqueries/LATERAL joins re-evaluating the RLS policy per row. The fix was `CTE ... MATERIALIZED` to pre-load lookups once.
**Why it happens / why it likely does NOT apply here:** This new RPC is a single flat `GROUP BY` over one table (`cash_outflows`) with no per-row correlated subquery and no LATERAL join — structurally identical to `get_cost_by_month`, which has shipped and run in prod without a timeout issue. The risk pattern (N subqueries × RLS re-evaluation) doesn't exist in a single aggregate query.
**How to avoid:** Do NOT reflexively add `MATERIALIZED` CTEs to this RPC — it adds needless complexity for a query shape that doesn't need it. **However**, if the planner later decides the RPC should also read `orders` in the same call (to avoid a second client-side round trip for the margin — NOT recommended per this research, see boundary decision), *that* would reintroduce the correlated-subquery risk pattern and MATERIALIZED CTEs would become necessary. Verify with `EXPLAIN ANALYZE` under `SET ROLE authenticated;` (or via the app itself) before shipping, per this repo's own established practice ("testar SEMPRE como role real, não só postgres" — memory: `feedback_rpc_rls_correlated_subquery_timeout`).
**Warning signs:** RPC call from the frontend hangs or returns a Postgres `57014 statement timeout` error under real user sessions even though it's fast via `service_role`/`postgres`.

### Pitfall 2: Category string mismatch silently produces wrong "Outros operacionais" bucketing
**What goes wrong:** As detailed in Pattern 2, at least 2 of the 9 mapped category groups have a spelling discrepancy between CONTEXT.md's transcription and another component's hardcoded strings (`Aluguéis e condomínio` vs `Aluguéis/condomínio`; `Água, luz` vs `Água/luz`). If the RPC's `CASE` uses the wrong exact string, real Estrutura costs silently land in "Outros operacionais" instead — the DRE total is still correct (nothing is dropped, per the "never silently discard" rule), but the **block breakdown** is wrong, and nobody would notice unless they specifically inspect the Outros bucket.
**Why it happens:** Category strings are free text from Tiny's ERP UI, transcribed by hand into two different documents/components at two different times.
**How to avoid:** Run `SELECT DISTINCT category, count(*) FROM cash_outflows WHERE organization_id = '<Pé Vermeio>' GROUP BY 1 ORDER BY 2 DESC;` via Supabase MCP **before** writing the final `CASE` expression, and use those exact byte-for-byte strings.
**Warning signs:** Reconciliation total is right but "Outros operacionais" has a suspiciously large amount that visibly looks like it should be Estrutura or Pessoal.

### Pitfall 3: Financeiro block treated as "done" when it's structurally a placeholder
**What goes wrong:** A planner/executor under time pressure could interpret "Financeiro = juro do Empréstimo" from ROADMAP's stale text and just ship the SAC-approximation math, closing the phase with numbers CONTEXT.md already says are wrong.
**Why it happens:** ROADMAP.md (an older document) still contains the SAC formula in its Phase 87 success criteria text, while the newer CONTEXT.md (which supersedes it per this repo's own convention — CONTEXT.md reflects the LATEST locked discussion) explicitly forbids it.
**How to avoid:** Follow Pattern 3 — return `financeiro_bruto` (the real total payment) and a boolean `financeiro_is_approximate` flag; do not compute or persist a SAC-derived juro number anywhere, including in a "just for now" comment that could get copy-pasted into Phase 88.
**Warning signs:** A migration file containing the literal number `6666.67` or the string `SAC` as a formula rather than as an explanatory comment about why it was rejected.

## Aggregation SQL Sketch

```sql
-- Phase 87 — get_dre_operational_blocks: sketch for the planner (not final; verify
-- exact category strings live before finalizing — see Pitfall 2 / Pattern 2).

CREATE OR REPLACE FUNCTION public.get_dre_operational_blocks(
  p_org_id UUID,
  p_month  DATE   -- qualquer dia do mês desejado; a função trunca para o 1º dia
)
RETURNS TABLE (
  bloco                    TEXT,     -- 'impostos_venda' | 'pessoal' | 'estrutura' | 'servicos'
                                      -- | 'financeiro_bruto' | 'outros_operacionais'
  category                 TEXT,     -- categoria original do Tiny (auditável)
  total                    NUMERIC,
  financeiro_is_approximate BOOLEAN  -- true quando bloco = 'financeiro_bruto' e não há
                                      -- schedule de amortização carregado ainda
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH classified AS (
    SELECT
      co.category,
      co.amount,
      CASE
        WHEN co.category IN ('Imposto Venda - ICMS', 'Imposto Venda - PIS', 'Imposto Venda - COFINS')
          THEN 'impostos_venda'
        WHEN co.category IN ('Salários', 'Pró-labore', 'Pessoal - INSS')
          THEN 'pessoal'
        WHEN co.category IN ('Aluguéis e condomínio', 'Água, luz', 'Telecomunicação, internet')
          THEN 'estrutura'
        WHEN co.category IN ('Contabilidade', 'Insumos', 'Itens do CD')
          THEN 'servicos'
        WHEN co.category = 'Empréstimo'
          THEN 'financeiro_bruto'
        WHEN co.category IN (
          'Fornecedores', 'Previsões de compra', 'Aporte',
          'Vendas Mercado Livre', 'Vendas Magalu',
          'ADS Mercado Livre', 'ADS Shopee', 'Ads Magazine Luiza',
          'Prestação de serviço do Mercado Envios Full'
        )
          THEN 'excluded'
        ELSE 'outros_operacionais'
      END AS bloco
    FROM public.cash_outflows co
    WHERE co.organization_id = p_org_id
      AND co.competence_date = date_trunc('month', p_month)::date
  )
  SELECT
    c.bloco,
    c.category,
    SUM(c.amount)                                        AS total,
    (c.bloco = 'financeiro_bruto')                        AS financeiro_is_approximate
  FROM classified c
  WHERE c.bloco <> 'excluded'
  GROUP BY c.bloco, c.category
  ORDER BY c.bloco, total DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_dre_operational_blocks(UUID, DATE) TO authenticated;
```

**Notes for the planner:**
- Returning per-`category` rows (not just per-`bloco` totals) is deliberate: it lets the frontend (Phase 88) both show block subtotals (`SUM(total) GROUP BY bloco` client-side, or add a second RPC/parameter for pre-aggregated blocks if preferred) *and* inspect exactly which categories landed in `outros_operacionais` for review — satisfying "não descartar silenciosamente."
- If Phase 88 prefers pre-aggregated block-only totals, add a thin second query or a `p_detail BOOLEAN DEFAULT false` parameter — but recommend keeping category-level detail as the default return shape since it's strictly more information and trivial to re-aggregate client-side.
- `p_month DATE` accepts any day in the target month; using `date_trunc` inside the function means the caller doesn't need to know `competence_date` is always the 1st — pass e.g. `'2026-06-15'` and it still matches `2026-06-01`.

## Runtime State Inventory

> Not a rename/refactor/migration phase (no renaming, no runtime state to migrate) — this section is not required per the trigger condition, but included briefly for completeness since the phase touches production financial data indirectly (read-only).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `cash_outflows` in prod (`ckcdevcxgvueywivefgx`) already has `competence_date` (Phase 86, migration `20260686000000` present in this repo) — coverage was still draining at Phase 86 research time (~5% and climbing per project memory) | None for this phase (read-only RPC); reconciliation (see below) should note current coverage % when run, not assume 90%+ is already reached |
| Live service config | None — no external service config involved | — |
| OS-registered state | None — no cron/scheduling changes in this phase | — |
| Secrets/env vars | None | — |
| Build artifacts | `src/integrations/supabase/types.ts` has no entry for `cash_outflows` today (confirmed same gap noted in Phase 86's research) — the new RPC will also have no generated TS type; consumers must type the `.rpc()` call return manually (same pattern already used by every RPC hook in this repo, e.g. `useMLCostWaterfall.ts`) | No action required this phase (no frontend); Phase 88 will hand-type the response like its sibling hooks already do |

**Nothing found in category:** Live service config, OS-registered state, Secrets/env vars — none apply; this is a pure read-only aggregation RPC.

## RPC Pattern to Copy (org-scoped SECURITY INVOKER + anti-timeout)

Three concrete in-repo examples, with signature/auth pattern:

**1. `get_cost_waterfall(p_org_id UUID, p_user_ids TEXT[], p_from DATE, p_to DATE)`** — `supabase/migrations/20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql`
```sql
LANGUAGE sql STABLE SET search_path = public
-- (SECURITY not specified → defaults to INVOKER)
-- org isolation: WHERE o.organization_id = p_org_id, enforced additionally by RLS on `orders`
GRANT EXECUTE ON FUNCTION ... TO authenticated;
```

**2. `get_margin_with_ads_by_product(p_org_id UUID, p_user_ids TEXT[], p_from DATE, p_to DATE)`** — `supabase/migrations/20260683000000_margin_with_ads_marca.sql`
```sql
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
-- explicit SECURITY INVOKER; comment states the exact anti-IDOR reasoning:
-- "SECURITY INVOKER (igual à RPC base): a RLS org-first de orders e
--  ml_ads_products_cache (is_org_member, Phase 43) enforça o isolamento de tenant."
GRANT EXECUTE ON FUNCTION ... TO authenticated;
```

**3. `get_cashflow(p_org_id UUID, p_start_date DATE, p_end_date DATE, p_include_purchase_forecasts BOOLEAN DEFAULT false)`** — `supabase/migrations/20260660000000_cashflow_dfc_alignment.sql`
```sql
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ... TO authenticated;
```

**The new RPC must follow the same pattern:** `LANGUAGE sql` (no branching logic needed → simpler than `plpgsql`), `STABLE`, `SECURITY INVOKER` (explicit, not relying on the default), `SET search_path = public`, `GRANT EXECUTE ... TO authenticated` (no need for a broader `REVOKE ... FROM PUBLIC, anon` since this isn't `SECURITY DEFINER` — but doing so anyway as defense-in-depth costs nothing and matches `get_cashflow`'s stricter posture).

**Anti-timeout note:** none of the 4 RPCs above (`get_cost_waterfall`, `get_margin_with_ads_by_product`, `get_cashflow`, `get_cost_by_month`) use `MATERIALIZED` CTEs — they're all single-table or simple-JOIN aggregations, same shape as this phase's RPC. `MATERIALIZED` is only needed for the correlated-subquery-per-row pattern seen in `get_replenishment_by_sku_*` (Pitfall 1). This RPC does not need it, but should still be smoke-tested under `authenticated` role before considering the phase done.

## RPC Boundary Decision (complement, not whole-DRE)

**Decision: the new RPC returns ONLY the operational-cost blocks (Pessoal / Estrutura / Serviços / Financeiro), scoped by competência, plus the "Outros operacionais" catch-all. It does NOT read `orders`, `ml_billing_daily`, or `ml_billing_monthly`, and does NOT compute Receita/CMV/impostos/tarifas/ads/Margem de contribuição.**

Rationale, backed by exact code inspection:
- The margin computation in `MercadoLivre.tsx` (lines ~156-290) is not a single query — it's a **stateful client composition** of `useMLCostWaterfall` (RPC `get_cost_waterfall`) + `useMLBillingDailyWithSync`/`useMLBillingWithSync` (direct reads of `ml_billing_daily`/`ml_billing_monthly`), merged through a 3-tier fallback (`dreFonte: "competencia" | "billing" | "estimado"`) with month-navigation state (`dreMonthOverride`) and an ads-fallback branch (`gruposTarifasEfetivos`).
- Re-implementing that fallback logic in SQL inside a new RPC would be a second, parallel implementation that could silently diverge from the frontend's actual behavior (e.g., if the frontend's fallback rule changes in a future phase, a duplicated SQL copy would go stale).
- CONTEXT.md is explicit: *"A margem já vem da fonte existente do `/vendas`... esta fase adiciona os custos fora do ML e o resultado líquido."* — read literally, this RPC's job is the "custos fora do ML" (operational blocks) part; the final "resultado líquido" arithmetic (margin − blocks) is a simple subtraction that Phase 88's frontend performs, exactly like it already sums `receitaMes − totalTarifasEfetivo − cmvMes − impostosMes` today.

**What Phase 88 will do (for context, not built here):** call `get_dre_operational_blocks(orgId, month)` alongside the existing margin hooks, sum blocks client-side into "Resultado operacional," subtract Financeiro (flagged) for "Resultado líquido" — the same client-composition pattern already proven in `MercadoLivre.tsx`.

## Output Shape

For the planner writing PLAN.md, the RPC's `RETURNS TABLE` should expose enough for a client-side rollup like:

```
Margem de contribuição (existing, unchanged)
  − SUM(total) WHERE bloco = 'pessoal'
  − SUM(total) WHERE bloco = 'estrutura'
  − SUM(total) WHERE bloco = 'servicos'
  − SUM(total) WHERE bloco = 'outros_operacionais'   -- visible bucket, included in the subtraction
                                                       -- (excluded from the sum would silently drop it —
                                                       -- CONTEXT.md requires it stay in the DRE, just labeled)
= Resultado operacional
  − SUM(total) WHERE bloco = 'financeiro_bruto'  (flagged financeiro_is_approximate = true)
= Resultado líquido (approximate until real juro schedule lands)
```

## Reconciliation Plan

**Target:** junho/2026, org `7f615df7` ("Pé Vermeio"), where receita (R$261.987) and other DRE inputs are already reconciled per project memory.

**Pre-condition — coverage check (must run before trusting reconciliation numbers):**
```sql
-- Coverage: how much of June 2026's cash_outflows has competence_date populated
SELECT
  count(*) FILTER (WHERE competence_date IS NOT NULL) AS with_competence,
  count(*)                                              AS total_tiny_rows,
  round(100.0 * count(*) FILTER (WHERE competence_date IS NOT NULL) / NULLIF(count(*), 0), 1) AS pct
FROM cash_outflows
WHERE organization_id = '<org 7f615df7 uuid>'
  AND tiny_payable_id IS NOT NULL
  AND outflow_date >= '2026-01-01';
```
Per 87-CONTEXT.md and project memory, the Phase 86 backfill was still draining at research time (2026 competence coverage was low and climbing). **Do not treat a Phase 87 reconciliation mismatch as an RPC bug without first checking this coverage number** — an incomplete backfill will under-report every operational block, not just Financeiro.

**Reconciliation steps (once coverage is high enough, target ≥90% per Phase 86's own criterion):**
1. Run the new RPC for `p_month = '2026-06-01'`.
2. Independently run `SELECT category, SUM(amount) FROM cash_outflows WHERE organization_id = '<org>' AND competence_date = '2026-06-01' GROUP BY category ORDER BY 2 DESC;` and manually cross-check that every category from the manual query appears in exactly one `bloco` in the RPC's output (either a named block or `outros_operacionais`), with matching `SUM`.
3. Cross-check the manually-known June numbers (receita R$261.987, etc., from project memory) only for the **margin side** (unaffected by this RPC) — this phase's own reconciliation target is that **operational blocks sum to the same total as the exclusion-filtered `SUM(amount)` for June**, i.e. `Σ(all blocks incl. outros_operacionais) + Σ(excluded categories) = Σ(all cash_outflows for June, competence-scoped)`. This is a closed-total check, independent of whether Wesley's June "resultado líquido" figure is separately known yet.
4. Explicitly log the **coverage %** alongside the reconciliation result — a low coverage month should not be presented to Wesley as a final "Resultado líquido," only as a directional check of the RPC's mechanics.

## Common Pitfalls
(See full list above under "Common Pitfalls" — Pitfalls 1–3.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `cash_outflows` grouped only by `outflow_date` (vencimento/caixa) via `get_cost_by_month`, feeding the existing Composição de Custos chart | `cash_outflows` now also carries `competence_date` (Phase 86), enabling a competência-based aggregation that the DRE needs (vs. the DFC's vencimento-based one) | Phase 86 (2026-07-06, same day) | This phase's RPC is the first consumer of `competence_date` for aggregation; `get_cost_by_month`/`get_cashflow` remain untouched and continue using `outflow_date` — the two date dimensions now coexist for two different reporting purposes (DFC=caixa, DRE=competência) |
| ROADMAP's Phase 87 criterion assumed SAC-approximated loan interest as final | CONTEXT.md (locked, newer) requires the Financeiro block be isolated as approximate/pending, not SAC-derived | 2026-07-06 (CONTEXT.md discussion, postdates ROADMAP's Phase 87 text) | Planner must follow CONTEXT.md, not ROADMAP's stale success-criteria wording, for the Financeiro block — flagged explicitly in Phase Requirements above |

**Deprecated/outdated:**
- The literal SAC formula (`300.000/45 = R$6.666,67/parcela`) as a source of truth for the Financeiro block — explicitly superseded by CONTEXT.md's open question; do not resurrect it even though it still appears in ROADMAP.md's text.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact `category` string spellings in CONTEXT.md (`Aluguéis e condomínio`, `Água, luz`, `Imposto Venda - ICMS`, etc.) match byte-for-byte what's stored in the live `cash_outflows.category` column | Pattern 2, Pitfall 2, Aggregation SQL Sketch | If wrong, one or more `WHEN co.category IN (...)` branches silently never matches, and real Estrutura/Pessoal/Serviços/Impostos amounts fall into `outros_operacionais` instead — the DRE total stays correct but the block breakdown is wrong. This is a previously-hit bug class in this exact codebase (memory: Phase 85 CATEGORY_COLORS mismatch). **Mitigation is mandatory, not optional:** run `SELECT DISTINCT category FROM cash_outflows WHERE organization_id = '<Pé Vermeio>'` via Supabase MCP before finalizing the migration |
| A2 | No Supabase MCP tool was available in this research session to directly query live category strings, current `competence_date` backfill coverage %, or confirm the exact live definitions of `get_cost_waterfall`/`get_cashflow`/`get_margin_with_ads_by_product` via `pg_get_functiondef` | Whole document | Same bounded risk as Phase 86's research under the identical constraint — this repo's migrations are the documented source of truth and the planner/executor session (which does have MCP access per every prior phase's pattern) should run a schema/data sanity pass as its first task, per this repo's established convention |
| A3 | `Pró-labore` is "hoje lançado como `Salários`" (per CONTEXT.md) — i.e., there is currently no distinct `Pró-labore` category value in the live data, only `Salários` | Category → Block Mapping | Low risk even if wrong: both map to the same `pessoal` block, so the `CASE` handles either spelling identically; only matters if a third, unexpected spelling variant exists |
| A4 | The Financeiro/juro isolation design (Pattern 3 — `financeiro_bruto` + `financeiro_is_approximate` flag, optional future `loan_interest_schedule` lookup table) is an appropriate structural placeholder that will not need to change shape once Wesley supplies the real amortization data | Pattern 3 | Medium risk: the actual shape of Wesley's bank amortization table (per-parcela date/amount granularity) is unknown; if it doesn't align to calendar months 1:1, the lookup join might need a date-range match rather than exact-month match. This is explicitly a "refine later" item per CONTEXT.md's own Deferred section, so some rework here is expected and acceptable |

**If this table is empty:** N/A — see above; several claims require live-DB confirmation before the migration is finalized.

## Open Questions

1. **Exact live spelling of all category strings mapped in CONTEXT.md's locked decisions.**
   - What we know: CONTEXT.md provides a specific list of ~14 category names across 4 operational blocks + exclusions; this codebase has at least one documented precedent (Phase 85) of a transcription mismatch between a document/component and the DB's real strings.
   - What's unclear: whether any of CONTEXT.md's transcriptions have the same drift.
   - Recommendation: executor's first task should be `SELECT DISTINCT category, count(*) FROM cash_outflows WHERE organization_id = '<Pé Vermeio org id>' GROUP BY 1 ORDER BY 2 DESC;` via Supabase MCP, diff against CONTEXT.md's list, and use the live strings verbatim in the `CASE` expression.

2. **How the Financeiro/juro isolation should be exposed once Wesley's amortization table arrives — same RPC output shape, or a follow-up migration?**
   - What we know: CONTEXT.md defers the exact solution; this research proposes a `financeiro_is_approximate` boolean + a placeholder `financeiro_bruto` total that can later be joined against a real per-month juro lookup without changing the RPC's `RETURNS TABLE` shape.
   - What's unclear: exact granularity of Wesley's forthcoming amortization table (per-parcela vs. per-month) and whether it will map 1:1 to `competence_date` months.
   - Recommendation: ship this phase with the placeholder/flag design; treat the lookup table itself as a small, easy follow-up migration once the real data exists — do not block this phase on it.

3. **Should the RPC pre-aggregate to `bloco`-only totals, or always return `category`-level detail (as sketched)?**
   - What we know: CONTEXT.md requires unmapped categories to be visible for review ("Outros operacionais" must not silently hide what fell into it).
   - What's unclear: whether Phase 88's frontend wants category-level drill-down or just block totals.
   - Recommendation: return category-level detail by default (as in the Aggregation SQL Sketch) — it's a strict superset of information, trivially re-aggregated to block-only totals client-side with a single `reduce`, and avoids a second RPC/round-trip if Phase 88 later wants the detail.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP (`apply_migration`, `execute_sql`) | Deploying the new RPC to `ckcdevcxgvueywivefgx`; verifying live category strings and backfill coverage before finalizing the `CASE` expression | Not available to this research agent's toolset (no `mcp__supabase__*` tool was exposed this session) | — | The executor/orchestrator session (per every prior phase's established pattern — 58, 59, 61, 84, 86) always has MCP access and must run the verification queries in Assumptions Log A1/A2 as a first task before writing the final migration |
| PostgreSQL / RLS (`is_org_member`) | Anti-IDOR enforcement | Already active in prod (used by every sibling RPC) | — | — |

**Missing dependencies with no fallback:** none — the only gap (Supabase MCP access) is handled by the existing executor/checkpoint pattern used throughout this project's history.

**Missing dependencies with fallback:** none applicable.

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json` (absent → enabled). Included, scoped to what's relevant for a read-only, org-scoped aggregation RPC.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No new auth surface; RPC callable only by already-authenticated `authenticated` role, same as every sibling RPC |
| V3 Session Management | No | N/A |
| V4 Access Control | Yes | `SECURITY INVOKER` + existing RLS policy `cash_outflows_select` (`is_org_member(auth.uid(), organization_id)`) is the sole isolation mechanism — the RPC must NOT be `SECURITY DEFINER` (that would bypass RLS and require a manual `p_org_id = caller's org` check, which this codebase deliberately avoids in favor of RLS-enforced isolation) |
| V5 Input Validation | Yes | `p_month DATE` is a typed parameter (Postgres validates format at the call boundary, no string concatenation); the category `CASE` expression uses static literals, not dynamic SQL — no injection surface |
| V6 Cryptography | No | No secrets/tokens touched |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR via `p_org_id` parameter (caller passes another org's UUID) | Elevation of Privilege / Information Disclosure | Mitigated identically to every sibling RPC: `SECURITY INVOKER` means the query executes as the calling `authenticated` user, and RLS on `cash_outflows` (`is_org_member`) silently returns zero rows for any org the caller doesn't belong to, regardless of what `p_org_id` value is passed — verify this explicitly as part of the smoke test (call with a foreign `p_org_id` as a non-member user, expect empty result, not an error and not other org's data) |
| Silent misclassification masking as "correct total" | Tampering (data integrity, not security in the classic sense, but relevant to a financial reporting RPC) | Never `DROP`/discard unmapped categories (CONTEXT.md's explicit rule) — always bucket into `outros_operacionais` so totals stay reconcilable even if the block breakdown has gaps |

## Sources

### Primary (HIGH confidence — read directly this session)
- `/root/garment-glow-dre/.planning/phases/87-dre-agrega-o-de-resultado-por-compet-ncia/87-CONTEXT.md` — locked decisions (category map, exclusions, open question on loan interest)
- `/root/garment-glow-dre/.planning/phases/86-dre-compet-ncia-no-contas-a-pagar/86-CONTEXT.md` + `86-RESEARCH.md` — competence_date provenance, prior research constraints (no MCP access), backfill mechanics
- `/root/garment-glow-dre/.planning/ROADMAP.md` (Phase 86, 87, 88 sections) — success criteria, dependency chain, and the stale SAC-approximation text flagged as superseded
- `/root/garment-glow-dre/supabase/migrations/20260686000000_cash_outflows_competence_date.sql` — confirms Phase 86's migration already exists in this repo (competence_date column + index + enrichment functions)
- `/root/garment-glow-dre/supabase/migrations/20260618100000_cash_flow_tables.sql` — `cash_outflows` full schema + RLS policy (`cash_outflows_select`, `is_org_member`)
- `/root/garment-glow-dre/supabase/migrations/20260650000100_treasury_category_backfill.sql` — `get_cost_by_month` (direct structural template for the new RPC)
- `/root/garment-glow-dre/supabase/migrations/20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql` — `get_cost_waterfall` full definition
- `/root/garment-glow-dre/supabase/migrations/20260683000000_margin_with_ads_marca.sql` — `get_margin_with_ads_by_product`, explicit SECURITY INVOKER + anti-IDOR reasoning in comments
- `/root/garment-glow-dre/supabase/migrations/20260660000000_cashflow_dfc_alignment.sql` — `get_cashflow`, SECURITY INVOKER + REVOKE/GRANT pattern
- `/root/garment-glow-dre/supabase/migrations/20260668000100_get_replenishment_by_sku_fix_double_count.sql` — `MATERIALIZED` CTE anti-timeout pattern (for contrast — not needed by this phase's RPC, but documented as the pattern that WOULD apply if scope grew)
- `/root/garment-glow-dre/src/components/mercadolivre/MLCostCard.tsx` — the existing "DRE do Mês" card component (props/shape)
- `/root/garment-glow-dre/src/pages/MercadoLivre.tsx` (lines ~150-350, ~775-790) — full client-side composition of the margin (`dreWaterfall`, `dreFonte` fallback tiers, `gruposTarifasEfetivos`)
- `/root/garment-glow-dre/src/hooks/useMLCostWaterfall.ts` — `get_cost_waterfall` RPC consumer, confirms fields (paid_revenue, cmv, total_comissao, total_frete, total_tax, has_cmv, has_tax_data)
- `/root/garment-glow-dre/src/hooks/useMLBilling.ts` — confirms `ml_billing_daily`/`ml_billing_monthly` are read via direct `.from()` table queries, not an RPC
- `/root/garment-glow-dre/src/hooks/useCostByMonth.ts` + `/root/garment-glow-dre/src/components/financial/CostCompositionChart.tsx` — `get_cost_by_month` consumer, and the source of the category-spelling mismatch flagged in Pitfall 2
- `/root/garment-glow-dre/CLAUDE.md` — project stack/conventions (note: this file's `## Project` section describes an unrelated "Módulo Fiscal" feature — stale/generic boilerplate for this repo, not applicable to the DRE milestone; the Stack/Conventions/Architecture sections below it are accurate and were used)
- `/root/garment-glow-dre/.planning/config.json` — `nyquist_validation: false` (Validation Architecture section correctly omitted), no `security_enforcement: false` override (Security Domain section included)

### Secondary / Tertiary
None used — no web research was necessary; the entire domain (Postgres RPC aggregation over an in-repo, already-documented table) is fully covered by direct source inspection. General DRE/SAC accounting concepts referenced in the CONTEXT.md discussion are treated as `[ASSUMED]`/already-locked user domain knowledge, not re-derived from external sources in this research.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing RPC/RLS stack only, 4 concrete sibling RPCs inspected
- Architecture / boundary decision: HIGH — read the actual client-side margin composition end-to-end (`MercadoLivre.tsx`, `useMLCostWaterfall.ts`, `useMLBilling.ts`) to confirm there is no single "margin RPC" to wrap
- Category mapping: MEDIUM — the block assignments themselves are LOCKED (CONTEXT.md), but the exact string spellings are flagged `[ASSUMED]` pending a live `SELECT DISTINCT category` check (Assumption A1) — this is the single biggest risk in the phase
- Financeiro/juro isolation: MEDIUM — the structural approach (flag + placeholder) is a reasonable, low-risk design, but the exact future shape depends on data not yet available (Wesley's amortization table)
- Pitfalls: HIGH — Pitfall 1 (anti-timeout) and Pitfall 2 (category mismatch) are both derived from documented, previously-shipped incidents in this exact codebase (Phase 68 and Phase 85 respectively)

**Research date:** 2026-07-06
**Valid until:** 30 days (stable in-repo domain); re-verify sooner if the Phase 86 backfill's category-string audit (Assumption A1) surfaces further Tiny taxonomy drift, or if Wesley's amortization table arrives (would immediately obsolete the Financeiro placeholder design in Pattern 3)

## RESEARCH COMPLETE
