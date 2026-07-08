---
phase: 87-dre-agrega-o-de-resultado-por-compet-ncia
plan: 01
subsystem: backend-rpc
tags: [postgres, rpc, dre, cash_outflows, security-invoker, anti-idor]
dependency-graph:
  requires:
    - "Phase 86: cash_outflows.competence_date (nullable, ~91.3% backfilled)"
    - "cash_outflows RLS policy cash_outflows_select (is_org_member)"
  provides:
    - "public.get_dre_operational_by_competence(p_org_id uuid, p_month date) — reconciled to 87-CONTEXT map (migration authored, NOT yet applied to prod)"
  affects:
    - "Phase 88 frontend (will consume this RPC's bloco/category/total/n/double_count_risk shape)"
tech-stack:
  added: []
  patterns:
    - "DROP FUNCTION IF EXISTS + CREATE (not CREATE OR REPLACE) when RETURNS TABLE column set changes — avoids 42P13"
    - "COALESCE(competence_date, date_trunc('month', outflow_date)::date) fallback on both window bounds"
    - "REVOKE EXECUTE FROM PUBLIC, anon + GRANT TO authenticated re-issued in the same migration after DROP/CREATE (grants are not preserved across DROP)"
key-files:
  created:
    - supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql
  modified: []
decisions:
  - "Migration timestamp 20260692000000 chosen above both main's highest (20260690000100) and the unmerged sibling branch's highest (20260690000200) per 87-RESEARCH.md Pitfall 1 — no filename collision"
  - "ELSE catch-all renamed to distinct visible 'nao_classificado' bloco (Claude's-discretion call per 87-CONTEXT, 'não esconder' principle) rather than folding into operacional"
  - "double_count_risk boolean replaces the old financeiro_is_approximate column entirely — Empréstimo carries no flag since its full-parcela total needs no caveat"
metrics:
  duration: "~15 min"
  completed: "2026-07-08"
status: complete
---

# Phase 87 Plan 01: Reconcile DRE Operational RPC to CONTEXT Category Map Summary

Authored the migration that reconciles the drift-deployed `get_dre_operational_by_competence(uuid, date)` RPC to Wesley's current (2026-07-08) locked category map — five deltas vs. the previously-deployed body (from an unmerged sibling branch that hit the same production project). **This plan is only Task 1 of 2**; Task 2 (apply to prod via Supabase MCP + reconcile June/2026 + prove anti-IDOR) is a `checkpoint:human-verify` gate that requires Supabase MCP access this executor does not have.

## What Was Done

**Task 1 — Author the migration (COMPLETE, committed `5d09150e`):**

Created `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql`:

1. `DROP FUNCTION IF EXISTS public.get_dre_operational_by_competence(uuid, date);` followed by `CREATE FUNCTION` (not `CREATE OR REPLACE` — the return-type change from `financeiro_is_approximate` to `double_count_risk` would raise `42P13`).
2. `RETURNS TABLE (bloco text, category text, total numeric, n integer, double_count_risk boolean)`, `LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'`.
3. CASE map reconciled to 87-CONTEXT exactly:
   - `impostos_venda`: ICMS/PIS/COFINS venda
   - `pessoal`: Salários, **Pró-labore** (new), Pessoal - INSS
   - `estrutura`: Aluguéis e condomínio, Água/luz, Telecom/internet
   - `servicos`: Contabilidade, **Serviços gerais** (moved in)
   - `operacional`: Insumos, Itens do CD (moved in from servicos), Impostos/taxas, Veículos/transportes, **Cartão de crédito** (moved in from excluido)
   - `financeiro`: Empréstimo (full parcela, unchanged)
   - `excluido`: Fornecedores, Previsões de compra, Aporte, ADS Mercado Livre, Mercado Envios Full, ADS Shopee, Ads Magazine Luiza, Vendas Mercado Livre, Vendas Magalu, **Reembolso cliente** (new explicit branch)
   - `ELSE 'nao_classificado'` (new distinct visible bucket, replaces the old `outros_operacionais` catch-all)
4. `double_count_risk = (co.category = 'Cartão de crédito')` — makes the known ML-fatura double-count inside the card statement visible instead of hiding it.
5. WHERE clause: `COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)` applied to BOTH window bounds — the ~8.7% of 2026 rows with NULL `competence_date` now fall into their `outflow_date`'s month instead of being silently dropped.
6. `REVOKE EXECUTE ... FROM PUBLIC, anon;` + `GRANT EXECUTE ... TO authenticated;` re-issued (grants are lost across DROP/CREATE).

No correlated subquery / LATERAL — single-table `GROUP BY`, matching the timeout-safe shape already proven in the prior (unmerged-branch) deployment.

Verification gate (from PLAN.md `<verify><automated>`) ran and printed `DRE_MIGRATION_OK`.

**Files NOT touched (per plan boundary):** `get_cashflow`, `get_imposto_guia_by_competence`, `cash_outflows` schema, any `cron.schedule`/`cron.unschedule`.

**Task 2 — NOT executed by this agent (checkpoint:human-verify, gate="blocking", orchestrator-only):**

Requires:
1. BASELINE snapshot of the currently-deployed (drifted) function body + `get_advisors` via Supabase MCP on `ckcdevcxgvueywivefgx`.
2. APPLY the migration via MCP `apply_migration` (NOT `supabase db push` — no CLI token for this repo).
3. CONFIRM new shape: `prosecdef=false` (INVOKER), body contains `double_count_risk`/COALESCE fallback/Cartão under operacional/`nao_classificado`; `anon` EXECUTE=false, `authenticated` EXECUTE=true.
4. RECONCILE June/2026: `Σ get_dre_operational_by_competence('7f615df7-...', '2026-06-01')` must equal `Σ cash_outflows` for Pé Vermeio with the same COALESCE fallback window — expect R$0,00 delta. Confirm whether June had a `Cartão de crédito` row (`double_count_risk=true` if present).
5. ANTI-IDOR proof as a real `authenticated` role impersonating a member of the foreign org (`e4150d57`, Thales) calling with Pé Vermeio's `p_org_id` — expect 0 rows; and a real Pé Vermeio member's query finishing well under the 8s `authenticated` `statement_timeout` with no per-row SubPlan.
6. NON-REGRESSION: no new `get_advisors` issue; `get_cashflow`/`get_imposto_guia_by_competence` definitions unchanged.
7. Record the Phase 88 hand-off question: which RPC (`get_cost_waterfall` vs `get_margin_with_ads_by_product`) supplies the impostos-sobre-venda deduction, so `impostos_venda` (this RPC) and that source are never both subtracted (double-count) — this is explicitly a Phase 88 decision, not resolved here.

None of steps 1–7 above were run — this executor has no Supabase MCP tool access, matching the plan's explicit `<critical_deploy_boundary>`.

## Deviations from Plan

None — plan executed exactly as written for Task 1. Task 2 was correctly NOT attempted (orchestrator-only per plan design and the executor's own instructions).

## Known Stubs

None — the migration file is complete and self-consistent; nothing hardcoded or placeholder.

## Threat Flags

None beyond what the plan's own `<threat_model>` already covers (T-87-01/02/03, all `mitigate`, addressed structurally in the migration: SECURITY INVOKER, REVOKE/GRANT re-issue, single-table GROUP BY with no correlated subquery). No new surface introduced beyond the plan's scope.

## Self-Check: PASSED

- `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql` — FOUND
- Commit `5d09150e` — FOUND in `git log --oneline`
- Grep verification gate — printed `DRE_MIGRATION_OK`

## PROVA EM PROD (Task 2 — orquestrador, 2026-07-08)

Migration `20260692000000` aplicada via MCP `apply_migration` em `ckcdevcxgvueywivefgx` (`{"success":true}`).

**Reconciliação junho/2026 (Pé Vermeio):** RPC Σ = R$217.820,60 == agregado direto (COALESCE-adjusted) R$217.820,60 → **delta R$0,00** ✅
**Breakdown junho por bloco:** excluido R$139.968 (Fornecedores→CMV) · pessoal R$27.852 · financeiro R$20.027 (Empréstimo cheio) · operacional R$15.715 (Cartão de crédito, `double_count_risk=true`) · nao_classificado R$7.360 (Outros, VISÍVEL) · impostos_venda R$4.793 (ICMS/COFINS/PIS deduz receita) · servicos R$2.103.

**Anti-IDOR (role authenticated real):** própria org → 11 linhas; Thales→Pé Vermeio → **0 linhas**; policy `is_org_member(auth.uid(), organization_id)`; RPC `prosecdef=false` (INVOKER). ✅
**Privilégios:** anon=0 EXECUTE, authenticated=1 ✅
**Zero regressão:** `get_cashflow` e `get_imposto_guia_by_competence` intactos ✅

**Hand-off Phase 88:** escolher UMA fonte de imposto sobre venda — o bloco `impostos_venda` desta RPC OU `get_imposto_guia_by_competence`, NUNCA as duas (senão dobra o imposto).
