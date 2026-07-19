# Phase 94: DRE Regime Previsão↔Apuração - Research

**Researched:** 2026-07-11
**Domain:** Postgres/Supabase RPC + RLS (SECURITY INVOKER, org-scoped) + React/TanStack Query frontend composition. Zero new npm/pip/cargo packages.
**Confidence:** HIGH for all code-path claims (direct file reads, this repo, `git log`-verified). MEDIUM/LOW flagged explicitly where the live DB state cannot be confirmed from this session (no Supabase MCP tool access in the research agent — the orchestrator/planner has it and MUST run the verification query in "⚠️ Assumptions vs Reality" §1 before planning proceeds).

## RESEARCH COMPLETE (read "⚠️ Assumptions vs Reality" first — it changes the shape of Wave 0)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Regime é único, não são toggles soltos**
- Só existem DOIS mundos coerentes; **nunca misturar as bases** (senão o crédito de ICMS/PIS/COFINS conta 2×):
  - PREVISÃO = CMV médio (`orders.custo_unit` → `get_cost_waterfall.cmv`) + imposto estimado (`orders.tax_amount`).
  - APURAÇÃO = CMV cheio (`orders.custo_unit_cheio` → `get_cost_waterfall.cmv_cheio`) + guias reais (bloco `impostos_venda`).
- **CMV cheio×médio é CONSEQUÊNCIA do regime**, jamais uma escolha separada exposta ao usuário.

**Mês inteiro ou nada (Opção A)**
- Um mês só pode virar APURAÇÃO quando ICMS+PIS+COFINS daquele mês estiverem reais.
- Motivo técnico: o imposto estimado (`tax_amount`) é um número BORRADO (~20% por produto, alíquotas 7/12/18% combinadas), NÃO quebrado por tipo de imposto → não dá pra substituir só o ICMS mantendo PIS/COFINS estimado.

**Casamento M+1 (a régua que reconcilia)**
- A DRE é por **mês da VENDA** (`orders.data_pedido`).
- O `competence_date` da guia no `cash_outflows` = **mês do PAGAMENTO** (sempre 1º dia do mês do vencimento), NÃO o mês da venda. ICMS de venda é pago ~dia 21 do mês seguinte.
- **Regra: imposto da DRE do mês de venda M = guia com `competence_date = M+1`.** A apuração paga este mês é sobre as vendas do mês passado.
- Hoje a RPC `get_dre_operational_by_competence` casa pela competência crua → **precisa aplicar o shift M+1** no bloco de impostos.
- Reconciliação-alvo: junho/2026 usa a guia ICMS de julho (5.151,56), NÃO a de junho (4.793,21, que é de maio).

**Gatilho = clique manual do owner (nunca automático)**
- Persistir em nova tabela `dre_month_close` (PK org-first `organization_id` + `competence_month`), RLS org-first, escrita só owner, **reversível** (reabrir mês).
- Mês SEM registro → previsão. Mês COM registro → apuração.
- Sinal de "parece pronto pra fechar" (vencimento≠21 / `status='paid'` / valor≠recorrente) é só **empurrãozinho visual** 🟢, NUNCA gatilho. Comprovado no banco que vários apurados reais ficam no dia 21 → sinal ambíguo.

**Enquanto o mês está aberto**
- Ignora a linha recorrente de imposto do Tiny (é placeholder) e usa a estimativa própria (`tax_amount`). A guia real só "vale" depois do fechamento.

### Claude's Discretion
None explicitly delegated in CONTEXT.md — all major decisions above are LOCKED. Implementation-level choices (exact SQL shape of the M+1 shift, exact column names for the empurrãozinho signal, whether reopen = DELETE row vs. soft-toggle) are NOT locked and are this research's job to propose (see "Recommendation" callouts below and Open Questions).

### Deferred Ideas (OUT OF SCOPE)
- Toggle explícito previsão×apuração que o usuário liga/desliga à vontade — regime é derivado do fechamento, não um toggle livre.
- Decompor o imposto estimado por tipo (ICMS/PIS/COFINS separados) para apuração parcial por imposto.
- Detecção 100% automática do fechamento (sem clique).
- Categorização na fonte (Tiny) e limpeza de `nao_classificado`/cartão — fase separada.
- Toggle previsão×apuração como escolha livre por eixo — CMV e imposto são consequência do regime.
- Apurar/lançar PIS/COFINS faltantes — ação do Wesley no Tiny, não código.
- Precificação/MCO/break-even — continuam usando `total_tax`; esta fase não toca neles.
</user_constraints>

---

## ⚠️ Assumptions vs Reality

This is the single most important section in this document. Read before planning Wave 0.

### 1. CMV cheio infrastructure MAY ALREADY BE LIVE in prod (unconfirmed from this session — verify first)

CONTEXT.md's `<canonical_refs>` states as fact: *"RPC `get_cost_waterfall` — expõe `cmv` (médio) e `cmv_cheio`."* **This is FALSE in the `garment-glow-test` git repo as checked out.** Verified by direct grep across `src/` and `supabase/migrations/`:

```
grep -rln "cmv_cheio\|custo_unit_cheio" src/ supabase/   → zero hits
```

The current (latest, `20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql`) `get_cost_waterfall` `RETURNS TABLE` has exactly: `paid_revenue, cmv, total_comissao, total_frete, total_tax, orders_count`. No `cmv_cheio`. `orders` has `custo_unit` (single column); no `custo_unit_cheio` column exists anywhere in this repo's migrations. `ml_product_costs` has exactly one `cost numeric(12,2)` column; no `cost_full`.

**However — there is strong circumstantial evidence this infrastructure already exists in the LIVE `ckcdevcxgvueywivefgx` database, just not reflected in this repo's git history:**

- A **separate, unmerged worktree** at `/root/garment-glow-dre` (branch `gsd/phase-86-dre-competencia`, same underlying feature set — Phases 86/87/88/90 there ≈ Phases 86/87/88/94 here, built earlier and independently) contains a **completed and prod-deployed** "Phase 90" (`90-dre-imposto-real-cmv-fechamento`) that added exactly this: migration `20260690000100_cmv_cheio_schema.sql` adds `ml_product_costs.cost_full`, `orders.custo_unit_cheio`, and rebuilds `get_cost_waterfall` to return `cmv_cheio` (with a per-row fallback to `custo_unit` when `custo_unit_cheio` is NULL). Its `90-02-SUMMARY.md` documents an actual deploy: *"Deploy (orquestrador, MCP, projeto **ckcdevcxgvueywivefgx**) ... `apply_migration` schema ✅ ... Prova cmv_cheio abril: cmv_cheio 168.486,68 ... Anti-IDOR ✅ ... `get_advisors` sem issue novo ✅."* This is the **same production Supabase project** this Phase 94 targets.
- `project_garment_dre_ponto_verdade.md` (memory, session 2026-07-10 — a day *before* Phase 94 was opened) cites **live** numbers *"CMV médio 110.613,42 / CMV cheio 133.264,87"* for junho/2026 — a `cmv_cheio` figure that could only have come from a live query against a `get_cost_waterfall` that already returns it (or an equivalent live RPC).
- A second, independent RPC `get_imposto_guia_by_competence(p_org_id uuid, p_competence date) → TABLE(category text, total numeric, status text, n integer)` was also built and deployed by that same abandoned worktree (`90-01`, commit `72589b2a`, migration `20260690000000_get_imposto_guia_by_competence.sql`) — status-aware, per-competence, isolated from `get_dre_operational_by_competence`. It may also already exist live.

**Verified NOT present in `garment-glow-test`'s own git history:** `git log --all --oneline | grep -iE "cmv_cheio|imposto_guia|aac25a32|72589b2a|..."` → zero matches. These commits exist only in the local `garment-glow-dre` worktree and were never pushed/merged into this repo. This is a **known drift pattern** already documented once in this exact repo — see `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql`'s own header comment: *"this exact RPC was already built and applied to THIS SAME production project ... on an unmerged branch ... This migration reconciles that drifted body."* The same situation is very likely true here for `cmv_cheio`.

**MANDATORY first step for the planner/orchestrator (has Supabase MCP, this research agent does not):** before writing Wave 0 tasks, run against `ckcdevcxgvueywivefgx`:
```sql
-- does get_cost_waterfall already return cmv_cheio?
select prosrc from pg_proc where proname = 'get_cost_waterfall';
-- do the columns already exist?
select column_name from information_schema.columns where table_name = 'orders' and column_name = 'custo_unit_cheio';
select column_name from information_schema.columns where table_name = 'ml_product_costs' and column_name = 'cost_full';
-- does the sibling RPC already exist?
select proname from pg_proc where proname = 'get_imposto_guia_by_competence';
```
- **If YES (columns/RPC already live):** Phase 94's Wave 0 collapses to a **git-only reconciliation task** — write a migration file into `garment-glow-test/supabase/migrations/` that documents the already-applied `cmv_cheio` schema (same pattern as `20260692000000`, i.e. `CREATE OR REPLACE`/`DROP+CREATE` reasserting the exact live body so the repo's migration history matches reality), then thread `cmv_cheio`/`has_cmv_cheio` through `useMLCostWaterfall.ts` (currently missing them — confirmed above) and wire the frontend. No new backend schema design needed for CMV.
- **If NO (not live — the abandoned branch's DB changes never actually landed, or were rolled back):** Phase 94 needs the full Track B build (schema + EF writes + backfill) as a Wave 0 dependency, using `/root/garment-glow-dre`'s `20260690000100_cmv_cheio_schema.sql` / `20260690000200_backfill_custo_unit_cheio.sql` / EF diffs (`sync-tiny-costs` v15, `recalc-order-costs` v14) as a **proven, already-reconciled reference implementation** — not a fresh design, a known-good port.

Either way, **do not re-derive the CMV-cheio contract from scratch** — a working, prod-proven version exists at `/root/garment-glow-dre`. Point the planner there.

### 2. The abandoned Phase 90's *trigger design* was AUTOMATIC — Phase 94's is MANUAL. Do not port the trigger logic, only the data-layer pieces.

`/root/garment-glow-dre`'s Phase 90 (dated 2026-07-06/07, i.e. *before* the 2026-07-10/11 "Ponto de Verdade" session that produced this Phase 94's locked design) built `evaluateGuiaReal()` — a **pure automatic function** that flips provisão→real based on `status='paid'` + a R$1 placeholder-value threshold, with zero manual step. Wesley's decisions evolved between that session and this one: CONTEXT.md for Phase 94 explicitly **revokes** the automatic-trigger idea ("Gatilho = clique manual do owner (nunca automático)... NUNCA gatilho automático — o dado real é ambíguo demais (vários apurados reais ficam no dia 21)"). Do NOT plan a task that reuses `evaluateGuiaReal`/`resolveTaxAndCmv` as-is from that worktree — their *automatic-decision* role is superseded. Their *raw-data-fetching* role (which RPC to call, what `cash_outflows` columns are available, the S+1 date-math idiom) is still valid prior art and should be cited as reference, with the decision logic swapped for "does `dre_month_close` have a row for this org+month."

### 3. `get_dre_operational_by_competence` bounds ALL blocos (including `impostos_venda`) by ONE shared date window — the M+1 shift cannot be a parameter, it needs a structural query change

Read directly from `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql` (the current, live version — see Research Target 1 below for the full function body): the `WHERE` clause applies **the exact same `[p_month, p_month+1mo)` window to every bloco**, including `impostos_venda`. There is no per-bloco window today. Implementing the M+1 shift by simply passing a different `p_month` to the whole RPC would shift the OTHER 7 blocos too (pessoal/estrutura/servicos/operacional/financeiro/excluido/nao_classificado), which is wrong — only `impostos_venda` needs to look at `M+1`. This confirms CONTEXT.md's own framing ("precisa aplicar o shift M+1 **no bloco de impostos**" — singular, scoped) is correct, but the RPC needs restructuring (two windows, not a shifted parameter) — see Code Examples for a concrete sketch.

---

## Summary

The "DRE do Mês" card lives entirely in `src/pages/MercadoLivre.tsx` (composition) + `src/components/mercadolivre/MLCostCard.tsx` (presentation) + `src/lib/dreCascade.ts` (pure cascade math) + two hooks (`useMLCostWaterfall.ts` → RPC `get_cost_waterfall`, `useDreOperational.ts` → RPC `get_dre_operational_by_competence`). This is a Phase 88-era architecture already in prod and already validated by Wesley (2026-07-10) — every seam this phase needs to touch is small, named, and load-bearing:

- `cmvMes`/`impostosMes` are assigned at `MercadoLivre.tsx` lines 262-264, from `dreWaterfall` (= `useMLCostWaterfall` result). This is **the** injection point for regime-aware CMV/imposto — a new composition step must sit between the RPC responses and these two variable assignments, and must be provably a no-op (byte-identical) when the month is open, exactly like the Phase 90 prior-art's "zero-regressão" test pattern.
- The RPC that carries the real-tax data (`impostos_venda` bloco) is `get_dre_operational_by_competence` — already fetched by the page via `useDreOperational`, but its `impostos_venda` rows are **deliberately discarded** today by `buildDreCascade()`'s guardrail filter (`src/lib/dreCascade.ts` line 110-112: `.filter(r => r.bloco !== "impostos_venda" && r.bloco !== "excluido")`) specifically to avoid double-counting against the ESTIMATED tax already netted into `impostosMes`/`margemContribuicao`. This guardrail must NOT be removed — it is exactly correct for the operational-blocks cascade math. The new "real tax" extraction is a *sibling* pure function, not a change to this filter.
- CMV cheio is either already live (see "⚠️ Assumptions vs Reality" §1) or needs the exact Track-B contract already proven once in the sibling worktree.
- The new `dre_month_close` table has a direct, exact template already in this repo: `supabase/migrations/20260515120000_ml_tax_config.sql` (owner-only INSERT/UPDATE/DELETE, `is_org_member` for SELECT) — this is literally this same CLAUDE.md-domain "Módulo Fiscal" project's own established pattern, not a borrowed one.
- The empurrãozinho heuristic needs `status` + day-of-month of `outflow_date` (or the value itself) per `impostos_venda` category — `cash_outflows` already has all these columns (`competence_date`, `outflow_date`, `status`, `amount`, `category`), confirmed in `supabase/migrations/20260618100000_cash_flow_tables.sql` + `20260686000000_cash_outflows_competence_date.sql`.

**Primary recommendation:** Modify `get_dre_operational_by_competence` (not create a parallel RPC — matches CONTEXT.md's explicit target) to compute `impostos_venda` rows against a `[p_month+1mo, p_month+2mo)` window while every other bloco keeps `[p_month, p_month+1mo)`, and add nullable `status`/`outflow_date` columns to the `RETURNS TABLE` (populated only for `impostos_venda` rows) so the frontend can derive the empurrãozinho hint from the SAME fetch already in flight — no second RPC call needed. Create `dre_month_close` cloning `ml_tax_config`'s exact RLS shape verbatim (owner-only writes). Wire the regime switch at `MercadoLivre.tsx` lines 262-264 with a new pure function in `dreCascade.ts` (sibling to `buildDreCascade`, not a modification of it), following the same "reconstructs legacy expression, asserts byte-identical when open" test pattern already proven once in the sibling worktree's `90-03`/`90-04` plans.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Regime derivation (open vs. closed month) | Frontend (`dreCascade.ts` pure fn, reads `dre_month_close` presence) | Database (RLS-guarded table is the source of truth for closed/open state) | Presence-of-row semantics are cheap to read via a small TanStack Query hook; the actual authority is the DB row + RLS, frontend just derives a boolean |
| M+1 imposto real by competência | Database / API (RPC `get_dre_operational_by_competence`, extended) | Frontend (selects `impostos_venda` rows, sums) | Date-window logic belongs server-side (already the pattern for the other 7 blocos); frontend should not reimplement month arithmetic on raw `cash_outflows` rows |
| CMV cheio | Database / Storage (`ml_product_costs.cost_full`, `orders.custo_unit_cheio`, `get_cost_waterfall.cmv_cheio`) | API (RPC exposes it) → Frontend (composes) | Same root-cause structure as the sibling worktree's Track B: the value is captured (or not) at Tiny-sync ingestion time, not computable from anything already in `orders` |
| Mês fechado — owner click / reversão | Frontend (button, owner-only gated by `orgRole`) | Database (RLS is the actual enforcement, not the frontend gate) | Established pattern in this repo (`ReplenishmentParamsDialog.tsx`, `ml_tax_config`) — frontend gate is UX-only, RLS is authoritative |
| Empurrãozinho visual hint | Frontend (`MLCostCard.tsx`, reuses existing Tooltip/badge patterns) | API (RPC supplies `status`/`outflow_date` raw signal) | Presentation-only; the RPC just needs to expose the raw ingredients, decision stays a pure frontend function so it's unit-testable without a DB round-trip |
| Anti-IDOR / RLS | Database (`is_org_member`, `get_org_role`, `SECURITY INVOKER`) | — | No tier above the DB should be trusted for this; this project's entire fiscal-module CLAUDE.md domain explicitly requires DB-level enforcement |

## Standard Stack

No new libraries. This phase is 100% internal composition + one migration, reusing the exact existing stack: React 18.3.1, TypeScript 5.8.3, `@tanstack/react-query` 5.83.0, `@supabase/supabase-js` 2.98.0, `vitest` 3.2.4, Tailwind/shadcn (Tooltip component already used for the existing `doubleCountRisk` hint pattern).

**Package Legitimacy Audit: N/A.** No new npm/pip/cargo packages introduced by this phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting "is the guia real yet" | A new automatic heuristic that GATES the switch | The existing `dre_month_close` presence check (locked design) — heuristic is display-only | CONTEXT.md explicitly rejects an automatic gate; a sibling worktree already tried the automatic approach and Wesley overrode it after seeing the day-21 ambiguity in real data |
| Owner-only RLS write policy | A bespoke role-check expression | `public.get_org_role(auth.uid(), organization_id) = 'owner'` — copy `ml_tax_config`'s three (INSERT/UPDATE/DELETE) policies verbatim | This exact pattern is already proven, tested, and lives in the SAME CLAUDE.md-domain fiscal module (`ml_tax_config`) — not even a cross-domain borrow |
| M+1 month arithmetic in SQL | Ad-hoc `interval` string concatenation per call site | `date_trunc('month', p_month) + interval '1 month'` (already the exact idiom `get_dre_operational_by_competence` itself uses for its own window's upper bound) | Consistency with the function's own existing style; avoids off-by-one from manual date string building |
| CMV cheio schema design | Re-deriving column names/shapes from scratch | Port `/root/garment-glow-dre`'s `20260690000100_cmv_cheio_schema.sql` (already prod-proven with a documented fallback bug found and fixed) | Avoids repeating a bug already found and fixed once (the `COALESCE(custo_unit_cheio, custo_unit)` per-row fallback — without it, SKUs missing `cost_full` silently zero out and *overstate* profit) |

**Key insight:** Almost everything this phase needs has already been built once, in a sibling worktree, against the SAME production database, by an earlier (later-superseded) iteration of this exact idea. The risk in this phase is not "design something new" — it's "don't rebuild what's already live, and don't accidentally re-adopt the rejected automatic-trigger design that the manual-click decision explicitly supersedes."

## Runtime State Inventory

> This phase is not a rename/refactor/migration — it's additive (new table, extended RPC, new frontend composition). Section included per protocol trigger check: **not required**, but the schema-drift risk in "⚠️ Assumptions vs Reality" §1 is functionally similar to a migration-state problem, so documenting it there instead of duplicating a full inventory table.

## Common Pitfalls

### Pitfall 1: Shifting the RPC's `p_month` parameter instead of adding a second date window
**What goes wrong:** A naive "just call the RPC with month+1" approach shifts ALL 8 blocos (pessoal, estrutura, etc.), not just `impostos_venda` — corrupting every other line of the DRE cascade the moment a month closes.
**Why it happens:** The existing `get_dre_operational_by_competence` has one shared `WHERE` window for every bloco; there's no visible seam suggesting per-bloco windows are needed until you read the SQL closely.
**How to avoid:** Structure the query as two unioned branches with independent windows (see Code Examples), or two separate scalar subqueries. Either way, add a test that proves `pessoal`/`estrutura`/etc. use `p_month`'s window and `impostos_venda` uses `p_month+1`'s window, using two different fixture months.
**Warning signs:** If `pessoal`/`financeiro` totals for a closed month suddenly differ from the same month's totals when it was open (before `dre_month_close` had a row), the window scoping is wrong.

### Pitfall 2: `RETURNS TABLE` shape changes require DROP+CREATE, not CREATE OR REPLACE
**What goes wrong:** Adding `status`/`outflow_date` columns (or any column) to `get_dre_operational_by_competence`'s `RETURNS TABLE` via a plain `CREATE OR REPLACE FUNCTION` fails with Postgres error `42P13 — cannot change return type of existing function`.
**Why it happens:** Postgres does not allow `CREATE OR REPLACE` to alter a function's return type/column set.
**How to avoid:** `DROP FUNCTION IF EXISTS public.get_dre_operational_by_competence(uuid, date);` then `CREATE FUNCTION ...` — this exact pattern is already used and explained in `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql` (comment lines 22-25) and again in the sibling worktree's `20260690000100_cmv_cheio_schema.sql` (comment lines 39-41, citing "lição da Phase 83"). Always `REVOKE ... FROM PUBLIC, anon; GRANT ... TO authenticated;` again after the DROP+CREATE (grants do not survive a DROP).
**Warning signs:** Migration apply fails with `42P13` in the MCP `apply_migration` response.

### Pitfall 3: `p_month` / `competence_month` must be `"YYYY-MM-01"`, never `"YYYY-MM"`
**What goes wrong:** Passing `"2026-06"` to a `date`-typed RPC parameter or to `dre_month_close.competence_month` throws a Postgres cast error, or (worse, client-side) silently produces a wrong date via JS `Date` parsing.
**Why it happens:** `useDreOperational.ts`'s own doc comment already flags this exact footgun ("Pitfall 3: o cast para `date` do Postgres falha") for the existing RPC call; the same constraint applies to any new table/RPC using month-as-`date`.
**How to avoid:** Reuse `billingMonthFrom`/`monthlyFrom` (already `"YYYY-MM-01"` strings, computed in `MercadoLivre.tsx`) as the source for both the M+1 shift input and the `dre_month_close` write — never hand-format a new date string.
**Warning signs:** 400-level Postgres errors mentioning `invalid input syntax for type date`, or (if not caught) a table with rows silently pinned to a wrong day.

### Pitfall 4: Removing/altering `dreCascade.ts`'s existing `impostos_venda`/`excluido` guardrail filter
**What goes wrong:** The Phase 88 guardrail exists specifically to prevent double-counting the estimated tax (already netted into `margemContribuicao` via `impostosMes`) against the real tax bloco. If a new "extract real tax" function is added by modifying this filter instead of adding a sibling function, the existing (Wesley-validated, prod) previsão math breaks.
**Why it happens:** The two use cases (exclude for cascade math vs. include for real-tax replacement) look superficially similar — both read the same `impostos_venda` rows from the same RPC response.
**How to avoid:** Add a **new, separate** pure function (e.g. `extractImpostoReal(rows)`) in `dreCascade.ts` that filters FOR `bloco === "impostos_venda"`, leaving `buildDreCascade`'s existing filter untouched. This is exactly the pattern the sibling worktree's research already flagged as the safe path (its own Landmines section, verbatim: *"the safe path is a parallel extraction function, not touching the existing allow-list"*).
**Warning signs:** `dreCascade.test.ts`'s existing "fixture reconciliação junho/2026 (Phase 87)" test (asserting `totalOperacionalDeducoes === 53030`, `resultadoLiquido === 126943`) starts failing.

### Pitfall 5: Floating-point precision in reconciliation test fixtures
**What goes wrong:** `12000 + 716.19 + 3298.87` in JS sums to `16015.060000000001`, not `16015.06` — `toBe`/`toEqual` assertions on summed real-tax fixtures fail spuriously.
**Why it happens:** Standard IEEE 754 floating point; already hit once in the sibling worktree's `90-04` (documented as a Rule-1 auto-fix: switched to `toBeCloseTo(..., 2)`).
**How to avoid:** Use `toBeCloseTo(value, 2)` for any test asserting a summed BRL total derived from multiple `cash_outflows` rows.
**Warning signs:** A test with correct-looking expected/actual values in the failure diff, differing only in the 10th+ decimal digit.

## Code Examples

### Sketch: M+1-aware `get_dre_operational_by_competence` (illustrative — planner/executor should verify exact live function body first per "⚠️ Assumptions vs Reality")

```sql
-- Illustrative only — confirm the CURRENT live body via list_tables/execute_sql
-- before writing the real migration; this repo's migration file
-- (20260692000000) may itself be drifted from the live function by now.
DROP FUNCTION IF EXISTS public.get_dre_operational_by_competence(uuid, date);

CREATE FUNCTION public.get_dre_operational_by_competence(
  p_org_id uuid,
  p_month  date
)
RETURNS TABLE (
  bloco             text,
  category          text,
  total             numeric,
  n                 integer,
  double_count_risk boolean,
  status            text,   -- NEW: NULL for non-impostos_venda blocos
  outflow_date      date    -- NEW: NULL for non-impostos_venda blocos (latest row's date per category, for the empurrãozinho day-21 check)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH bounds AS (
    SELECT
      date_trunc('month', p_month)::date                              AS m_start,
      (date_trunc('month', p_month) + interval '1 month')::date        AS m_end,
      (date_trunc('month', p_month) + interval '1 month')::date        AS m1_start,  -- impostos_venda window = M+1
      (date_trunc('month', p_month) + interval '2 month')::date        AS m1_end
  )
  -- Branch A: every bloco EXCEPT impostos_venda, windowed on M (unchanged behavior)
  SELECT
    CASE ... END AS bloco,   -- same CASE mapping as today, minus the impostos_venda branch
    co.category, sum(co.amount), count(*)::integer,
    (co.category = 'Cartão de crédito'), NULL::text, NULL::date
  FROM public.cash_outflows co, bounds b
  WHERE co.organization_id = p_org_id
    AND co.category NOT IN ('Imposto Venda - ICMS','Imposto Venda - PIS','Imposto Venda - COFINS')
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date) >= b.m_start
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date) <  b.m_end
  GROUP BY 1, co.category

  UNION ALL

  -- Branch B: impostos_venda ONLY, windowed on M+1 (the locked shift)
  SELECT
    'impostos_venda', co.category, sum(co.amount), count(*)::integer,
    false, co.status, max(co.outflow_date)
  FROM public.cash_outflows co, bounds b
  WHERE co.organization_id = p_org_id
    AND co.category IN ('Imposto Venda - ICMS','Imposto Venda - PIS','Imposto Venda - COFINS')
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date) >= b.m1_start
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date) <  b.m1_end
  GROUP BY 1, co.category, co.status
  ORDER BY 1, 3 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_operational_by_competence(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_operational_by_competence(uuid, date) TO authenticated;
```

### `dre_month_close` — clone `ml_tax_config`'s exact RLS shape (source: `supabase/migrations/20260515120000_ml_tax_config.sql`)

```sql
CREATE TABLE public.dre_month_close (
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  competence_month date NOT NULL,          -- "YYYY-MM-01", sale month (S), never the guia's S+1
  closed_at        timestamptz NOT NULL DEFAULT now(),
  closed_by        uuid NULL,              -- auth.uid() of the owner who clicked; no FK (see ml_claim_templates convention)
  PRIMARY KEY (organization_id, competence_month)
);

ALTER TABLE public.dre_month_close ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dre_month_close select"
  ON public.dre_month_close FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "dre_month_close insert"
  ON public.dre_month_close FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner');

CREATE POLICY "dre_month_close delete"
  ON public.dre_month_close FOR DELETE TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner');

-- No UPDATE policy needed if "reabrir mês" = DELETE the row (recommended — matches
-- CONTEXT.md's literal "Mês SEM registro → previsão" presence semantics). If the
-- planner instead wants an audit trail of reopens, add an UPDATE policy + a
-- nullable `reopened_at`/`reopened_by` pair instead of deleting — NOT locked by
-- CONTEXT.md, flagged as Open Question 1 below.
```

### Existing injection point in `MercadoLivre.tsx` (lines 261-264, current state — this is what regime-awareness must wrap)

```typescript
// Receita, CMV e impostos do mês do filtro
const receitaMes = dreWaterfall?.paid_revenue ?? 0;
const cmvMes = (dreWaterfall?.has_cmv ? dreWaterfall.cmv : null) ?? null;
const impostosMes = (dreWaterfall?.has_tax_data ? dreWaterfall.total_tax : null) ?? null;
```
`dreWaterfall` = `useMLCostWaterfall(...)` result; `dreOperationalRows` = `useDreOperational(...)` result (both already fetched a few lines above, at lines 229-238). Both are already parameterized by `billingMonth`/`billingMonthFrom` (the exact competence being displayed, including back-navigation via the `‹ ›` buttons) — no new data-fetch plumbing needed to know "which month," only a new hook reading `dre_month_close` for that same `billingMonth`.

### Existing owner-only gate pattern (frontend), `src/components/mercadolivre/ReplenishmentParamsDialog.tsx`

```typescript
const { currentOrg, orgRole } = useOrganization();
const canEdit = orgRole === "owner" || orgRole === "admin";  // Phase 94 needs owner-ONLY: orgRole === "owner"
// ...
const { error } = await supabase.from("replenishment_params").update(payload)...
```
Direct `supabase.from(...)` calls (no Edge Function) — RLS is the sole enforcement boundary, matching `ml_claim_templates`'s own documented convention ("CRUD happens directly through the authenticated Supabase client — no EF, so RLS is the ONLY guard").

### Existing badge/Tooltip pattern to reuse for "Previsão"/"Apurado" pill (`MLCostCard.tsx` lines 143-153, 309-322)

```tsx
<span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
  fonte === "competencia" ? "bg-emerald-500/15 text-emerald-400"
  : fonte === "billing" ? "bg-blue-500/15 text-blue-400"
  : "bg-amber-500/15 text-amber-400"
}`}>
  {fonte === "competencia" ? "mês 01–31" : fonte === "billing" ? "fatura ML" : "estimado"}
</span>
```
and, for the explainer icon:
```tsx
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="cursor-default inline-flex"><HelpCircle className="w-3 h-3 text-muted-foreground/60" /></span>
    </TooltipTrigger>
    <TooltipContent className="max-w-[200px] text-xs text-center">
      Pode conter fatura ML já contabilizada na margem
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```
A near-identical two-state pill ("Previsão" amber / "Apurado — baseado nas guias de DD/MM" emerald) + a Tooltip explainer are direct clones of this exact pattern — zero new colors/components needed. **Note:** this repo uses `Tooltip` (not `Popover`, unlike the sibling worktree's `MLCostCard.tsx`) — use `Tooltip`/`TooltipTrigger`/`TooltipContent` for consistency with THIS repo's established idiom, not the Popover pattern documented in the sibling worktree's research.

## Runtime State Inventory
(Not applicable — see note above under that heading.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `get_cost_waterfall`/`orders`/`ml_product_costs` in the LIVE `ckcdevcxgvueywivefgx` database already have `cmv_cheio`/`custo_unit_cheio`/`cost_full` deployed from the abandoned sibling worktree's Phase 90 | ⚠️ Assumptions vs Reality §1 | If wrong (never actually landed, or was rolled back), Wave 0 needs the FULL Track-B schema build (not just a reconciliation migration) — could roughly double the phase's estimated effort. **This is the single highest-leverage fact to confirm before planning.** |
| A2 | `get_imposto_guia_by_competence(uuid, date)` RPC is also already live in prod | ⚠️ Assumptions vs Reality §1 | If wrong, this sibling RPC is not usable as a shortcut/reference and the M+1 shift must be built entirely inside `get_dre_operational_by_competence` from scratch (still the CONTEXT.md-locked approach either way, so lower risk than A1) |
| A3 | "Reabrir mês" (reversibility) is best implemented as a DELETE of the `dre_month_close` row, matching the literal "mês SEM registro → previsão" phrasing in CONTEXT.md, rather than a soft-toggle/audit-trail column | Code Examples (`dre_month_close` DDL) | If Wesley actually wants a history of close/reopen events (e.g. for later analysis of "how often did we misjudge and reopen"), a DELETE-based design loses that history — cheap to fix later (add columns) but changes the RLS policy set (needs an UPDATE policy too) |
| A4 | The "mês inteiro ou nada" rule (ICMS+PIS+COFINS all real) is NOT a hard gate on the owner's click — the click is authoritative regardless, and the 3-guias check is purely the empurrãozinho's *display* condition, not a validation blocking the mutation | Open Questions #1 | If Wesley actually wants the click blocked/refused when the 3 guias aren't all real yet, the mutation needs a pre-check (client and/or DB constraint via a trigger reading `cash_outflows`) — currently not designed for; if built as pure "trust the click," an owner could accidentally close a month with an incomplete guia set and see a materially wrong "real" number with no warning beyond the (dismissable) hint |
| A5 | `dre_month_close.competence_month` stores the **sale month S** (not the guia's S+1) — i.e. the same value already used for `billingMonth`/`p_month` elsewhere in this codebase | Code Examples | If a future maintainer stores S+1 instead (confusing "the guia I'm using" with "the month I'm closing"), the presence-check join breaks silently and every month reads as open forever, or the wrong month closes |

## Open Questions

1. **Is "mês inteiro ou nada" (ICMS+PIS+COFINS all real) a hard gate on the close action, or purely informational (empurrãozinho)?**
   - What we know: CONTEXT.md states the rule as a fact about *when a month is considered coherent* ("Um mês só pode virar APURAÇÃO quando ICMS+PIS+COFINS daquele mês estiverem reais"), but separately states the automatic 3-guias signal is "só empurrãozinho visual... NUNCA gatilho."
   - What's unclear: whether "gatilho" in that second sentence refers only to *auto-triggering the close* (which is clearly forbidden) or *also* to *blocking a manual close attempt* when the guias aren't all real (which is a different, unaddressed question).
   - Recommendation: default to NOT blocking (owner's click is always authoritative, consistent with why manual-click was chosen over automatic in the first place — the underlying signal is acknowledged as ambiguous); planner should confirm with Wesley via a `checkpoint:human-verify` before/during the phase rather than assume.

2. **Live DB state of `cmv_cheio`/`custo_unit_cheio`/`cost_full`/`get_imposto_guia_by_competence` in `ckcdevcxgvueywivefgx`.**
   - What we know: strong circumstantial evidence (sibling worktree's documented, "proven" prod deploy; CONTEXT.md's own live-looking cmv_cheio numbers) that it's live.
   - What's unclear: whether it's still live and unmodified today, 4-5 days later, given the intervening "Ponto de Verdade" session (2026-07-10) that paused/reopened DRE design questions.
   - Recommendation: MANDATORY first Wave 0 task — `list_tables`/`execute_sql` against `ckcdevcxgvueywivefgx` (see exact queries in "⚠️ Assumptions vs Reality" §1) before any other Phase 94 task is planned in detail.

3. **Should `dre_month_close` writes go through an Edge Function or direct `supabase.from(...)` calls?**
   - What we know: every comparable org-scoped config table in this repo (`ml_tax_config`, `replenishment_params`, `ml_claim_templates`) uses direct client calls with RLS as the sole guard — no EF.
   - What's unclear: nothing, really — this is a strong, consistent, repo-wide convention.
   - Recommendation: follow the convention (direct `supabase.from("dre_month_close")`), no new EF. Flagged as an "open question" only for completeness, not because the evidence is ambiguous.

## Environment Availability

No new external dependencies — the phase is Supabase Postgres (already connected, already used throughout the codebase) + React/TS (already the entire frontend stack). Skipping the full table; nothing to audit.

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json` → section included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Unchanged — Supabase Auth session already governs all RPC/table access |
| V3 Session Management | No | Unchanged |
| V4 Access Control | **Yes** | `SECURITY INVOKER` on the RPC (never `SECURITY DEFINER` for org-scoped reads/writes — matches every RPC in this domain) + RLS policies on `dre_month_close` using `is_org_member`/`get_org_role`, cloned verbatim from `ml_tax_config` |
| V5 Input Validation | Yes (light) | `competence_month` must be a first-of-month `date` — enforce via consistent frontend construction (`billingMonthFrom`-style strings), not free-text input; no user-supplied SQL/RPC params beyond org id (from session) and a date |
| V6 Cryptography | No | Not applicable |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-org read of another org's closed-month status or real-tax figures | Information Disclosure | `SELECT` RLS via `is_org_member`; RPC stays `SECURITY INVOKER` so `cash_outflows`'s own RLS (already anti-IDOR-proven per `get_dre_operational_by_competence`/`get_imposto_guia_by_competence`'s prior audits) applies transitively |
| Non-owner (member/viewer) closing or reopening a month | Elevation of Privilege | `WITH CHECK`/`USING (get_org_role(...) = 'owner')` on INSERT/DELETE — DB-enforced, not just a disabled frontend button (frontend gate is UX-only, per this repo's established convention) |
| Forged `organization_id` on insert (closing a DIFFERENT org's month while acting as an owner of one's own org) | Tampering | `WITH CHECK` re-validates `organization_id` against the CALLER's own membership/role for that specific org id — this is exactly what the `ml_tax_config`/`ml_claim_templates` `WITH CHECK` clauses already guard against; clone verbatim |

**Required proof before considering the phase done (mirrors this repo's own established anti-IDOR test convention, e.g. `90-01-SUMMARY.md`'s "membro da org Thales impersonado ... chamando com org_id da Pé Vermeio → 0 linhas"):** impersonate a member of one org, attempt to read/write `dre_month_close` rows for a different org's `organization_id` — expect 0 rows / permission denied.

## Sources

### Primary (HIGH confidence — direct file reads, this repo)
- `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql` — current live `get_dre_operational_by_competence` body, DROP+CREATE pitfall documentation
- `supabase/migrations/20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql` — current live `get_cost_waterfall` body (no `cmv_cheio`)
- `supabase/migrations/20260514120000_ml_product_costs.sql` — `ml_product_costs` schema (single `cost` column, no `cost_full`)
- `supabase/migrations/20260515120000_ml_tax_config.sql` — exact owner-only RLS template for `dre_month_close`
- `supabase/migrations/20260618100000_cash_flow_tables.sql` + `20260686000000_cash_outflows_competence_date.sql` — `cash_outflows` schema (`outflow_date`, `amount`, `category`, `status`, `competence_date`)
- `supabase/migrations/20260414200325_...sql` — `is_org_member`/`get_org_role` helper functions
- `supabase/migrations/20260662000000_replenishment_params.sql`, `20260690000100_ml_claim_templates.sql` — additional org-first RLS table examples
- `src/pages/MercadoLivre.tsx` — DRE composition, `billingMonth`/`dreMonthOverride` modeling, `cmvMes`/`impostosMes` injection point
- `src/components/mercadolivre/MLCostCard.tsx` — `lucro` formula, badge/Tooltip patterns
- `src/lib/dreCascade.ts` + `src/lib/dreCascade.test.ts` — guardrail filter, June/2026 fixture (`totalOperacionalDeducoes=53030`, `resultadoLiquido=126943`)
- `src/hooks/useDreOperational.ts`, `src/hooks/useMLCostWaterfall.ts` — RPC call shapes, Pitfall 3 (`"YYYY-MM-01"` requirement) documentation
- `src/components/mercadolivre/ReplenishmentParamsDialog.tsx` — owner-only frontend gate pattern (`orgRole === "owner"`)
- `src/integrations/supabase/types.ts` — confirms RPCs are called by name (not present in generated types) while tables ARE manually added (see `replenishment_params` block, lines 1733-1782)
- `git log --oneline` (this repo) — confirms Phase 88 merged to `main`, confirms zero overlap with sibling worktree's Phase 90 commits

### Primary (HIGH confidence — direct file reads, sibling worktree `/root/garment-glow-dre`, cross-referenced against this repo's git history to confirm non-overlap)
- `.planning/phases/90-dre-imposto-real-cmv-fechamento/90-{RESEARCH,CONTEXT,01..04-SUMMARY,VERIFICATION}.md` — full prior-art trail for an earlier, automatic-trigger version of this same feature, including a documented prod deploy of the `cmv_cheio` schema against `ckcdevcxgvueywivefgx`
- `supabase/migrations/20260690000000_get_imposto_guia_by_competence.sql`, `20260690000100_cmv_cheio_schema.sql`, `20260690000200_backfill_custo_unit_cheio.sql` — reference implementations for RPC/schema this phase may be able to reuse or must re-verify

### Secondary (MEDIUM confidence)
- `/root/.claude/projects/-root/memory/project_garment_dre_ponto_verdade.md`, `feedback_garment_dre_imposto_apuracao.md` — the canonical design decisions (per CONTEXT.md's own instruction to treat as source of truth), used here only to corroborate the live-cmv_cheio circumstantial evidence, not as a primary code source

### Tertiary (LOW confidence)
- None — no WebSearch/Context7/external documentation used. This phase is 100% internal business-logic archaeology on proprietary code (`brave_search`/`exa_search`/`firecrawl` all disabled per `.planning/config.json`, `nyquist_validation: false`).

## Metadata

**Confidence breakdown:**
- Frontend composition seam (`MercadoLivre.tsx`/`MLCostCard.tsx`/`dreCascade.ts`): HIGH — traced end-to-end via direct file reads in the actual target repo
- RLS/RPC template for `dre_month_close`: HIGH — exact same-domain precedent (`ml_tax_config`) exists in this repo
- M+1 shift SQL structure: MEDIUM — the *need* for a structural (not parametric) change is HIGH confidence (read directly from the live function body), but the exact UNION/CTE shape in Code Examples is illustrative, not verified against a live `EXPLAIN`
- Live DB state of `cmv_cheio`/`get_imposto_guia_by_competence`: LOW/unconfirmed this session — flagged as the mandatory first verification step

**Research date:** 2026-07-11
**Valid until:** Re-verify "⚠️ Assumptions vs Reality" §1/§2 immediately before planning — schema drift risk is active and time-sensitive (the sibling worktree could be merged, rolled back, or further diverged at any time outside this repo's visibility).

## RESEARCH COMPLETE
