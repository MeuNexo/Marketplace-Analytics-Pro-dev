---
phase: 63-compras-reposi-o-por-sku-p-gina-pr-pria
plan: "02"
subsystem: replenishment-by-sku
tags: [supabase-rpc, security-invoker, jsonb-unnest, react-query, tdd, phase-63]
dependency_graph:
  requires:
    - 63-01 (replenishment_params_add_sku_scope migration — CHECK 'sku' required by this RPC)
  provides:
    - RPC get_replenishment_by_sku (SECURITY INVOKER, Supabase project ckcdevcxgvueywivefgx — pendente apply)
    - resolveParamsBySku function (replenishmentUtils.ts)
    - ReplenishmentSkuInput type
    - useReplenishmentBySku hook (rows + grouped)
    - Types for get_replenishment_by_sku in types.ts
  affects:
    - 63-03 (UI page — consumes useReplenishmentBySku and GroupedReplenishmentRow)
    - 63-04 (validation — proves SKU rows, anti-IDOR, custo join after 63-01 sync)
tech_stack:
  added: []
  patterns:
    - jsonb_to_recordset LATERAL (UNION ALL: variations ramo A + sem-variation ramo B)
    - SECURITY INVOKER + SET search_path (anti-IDOR Phase 43/48/62 pattern)
    - TDD RED/GREEN (vitest) for resolveParamsBySku
    - React Query with rows+grouped dual-output hook
key_files:
  created:
    - supabase/migrations/20260663000100_get_replenishment_by_sku_rpc.sql
    - src/hooks/useReplenishmentBySku.ts
  modified:
    - src/lib/analysis/replenishmentUtils.ts
    - src/lib/analysis/replenishmentUtils.test.ts
    - src/integrations/supabase/types.ts
decisions:
  - "Velocity via ml_orders direct (variation_id col) — no schema change to ml_product_daily_cache (D-04, CMP-02)"
  - "IS NOT DISTINCT FROM for NULL-safe join between inventory_by_sku, sales_by_sku, params CTEs"
  - "grouped output aggregates total_compra_sugerida, total_valor_estimado (null if any sku missing cost), any_gatilho_ativo"
  - "attribute_combinations_label derived client-side in hook (joins values with ' / ')"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-26"
  tasks_completed: 2
  tasks_total: 3
  files_created: 2
  files_modified: 3
status: complete
---

# Phase 63 Plan 02: RPC get_replenishment_by_sku + Motor de Reposição por SKU

RPC SECURITY INVOKER com jsonb_to_recordset UNION ALL para reposição por variação (Cor/Tamanho) + fórmula Phase 62 portada para granularidade de SKU + resolveParamsBySku testada (TDD) + hook React Query com drill grouping.

## Tasks

| Task | Type | Name | Status | Commit |
|------|------|------|--------|--------|
| 1 | auto | Migration RPC get_replenishment_by_sku | done | 28eace23 |
| 2 | auto/tdd | resolveParamsBySku + types + hook | done | 93207062 (GREEN), 8a01ac03 (RED) |
| 3 | checkpoint:human-verify | Apply RPC via MCP + validar | PENDING (orquestrador) | — |

## What Was Built

### Task 1 — Migration `20260663000100_get_replenishment_by_sku_rpc.sql`

Nova RPC `public.get_replenishment_by_sku(p_org_id, p_sales_window_days, p_demand_multiplier)`:

**CTEs:**
1. `inventory_by_sku` — UNION ALL:
   - Ramo A: `CROSS JOIN LATERAL jsonb_to_recordset(i.variations)` para itens com `has_variations=TRUE AND jsonb_array_length > 0` — uma linha por variação
   - Ramo B: item-level para itens sem variação (SKU único)
2. `sales_by_sku` — LEFT JOIN em `ml_orders` por `(item_id, variation_id)` com tratamento de `variation_id=''` (Pitfall 2); `COALESCE(SUM(o.quantidade),0)/NULLIF(p_sales_window_days,0)` por SKU
3. `params` — COALESCE sku>marca>global>30/60/7/1/1 por campo; `param_origem` via CASE EXISTS
4. `base` — fórmula Phase 62 exata (ponto/alvo/gatilho/MOQ/pack/sem-giro); joins via `IS NOT DISTINCT FROM` (NULL-safe); custo via LATERAL `ml_product_costs` por `seller_sku=sku_code` com fallback `item_id`

**Segurança:** SECURITY INVOKER + SET search_path = 'public'; REVOKE FROM PUBLIC/anon; GRANT TO authenticated.

**Status:** arquivo SQL escrito e commitado. **Apply via MCP pendente (checkpoint Task 3).**

### Task 2 — replenishmentUtils + types + hook (TDD)

**RED** (commit 8a01ac03): 5 novos testes para `resolveParamsBySku` — todos falhavam (função não existia); 10 existentes passavam.

**GREEN** (commit 93207062):
- `resolveParamsBySku(skuRow, marcaRow, globalRow, defaults)` — precedência SKU>marca>global, espelha CTE params da RPC
- `ReplenishmentSkuInput` interface — campos de variação (variationId, skuCode, attributeCombinations, estoque, vendaDia, cost)
- `paramOrigem` em `ReplenishmentResult` estendido para incluir `'sku'`
- `types.ts` — `get_replenishment_by_sku` adicionado na seção Functions com todos os 24 campos
- `useReplenishmentBySku.ts` — hook React Query escopado por `currentOrg.id`; mapRow defensivo; `groupByItem` agrega por `item_id`; expõe `{ rows, grouped }`
- `GroupedReplenishmentRow` — `total_compra_sugerida`, `total_valor_estimado` (null se qualquer SKU sem custo), `any_gatilho_ativo`, `any_custo_ausente`

**Resultado vitest:** 15/15 green (10 existentes + 5 novos).

## Deviations from Plan

### None — plan executed exactly as written.

Notes:
- Joins entre CTEs usam `IS NOT DISTINCT FROM` em vez de `=` para tratar variation_id NULL corretamente nos CTEs `sales_by_sku` e `params` referenciando `inventory_by_sku`. Isso é idiomático em PostgreSQL para join NULL-safe e está em conformidade com o comportamento esperado pela RPC.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test fails) | 8a01ac03 | PASS — 5 tests failing, 10 passing |
| GREEN (all pass) | 93207062 | PASS — 15/15 green |
| REFACTOR | — | not needed |

## Must-Haves Status

### Truths

| Truth | Status |
|-------|--------|
| RPC get_replenishment_by_sku (SECURITY INVOKER) retorna UMA linha por variação e UMA por anúncio sem variação | SQL WRITTEN, APPLY PENDING |
| Velocidade por SKU de ml_orders por (item_id, variation_id); variation_id='' para sem-variação | IMPLEMENTED in CTE sales_by_sku |
| Custo via seller_sku=sku_code; fallback item_id; custo nulo → custo_ausente=true, valor_estimado=NULL | IMPLEMENTED in LATERAL join |
| Precedência params sku>marca>global>30/60/7/1/1; param_origem reflete origem | IMPLEMENTED |
| p_org_id de outra org retorna 0 linhas (SECURITY INVOKER + RLS) | BY CONSTRUCTION; PROOF PENDING (checkpoint) |
| resolveParamsBySku com precedência SKU>marca>global; testes vitest verdes | DONE — 15/15 |

### Artifacts

| Artifact | Status |
|----------|--------|
| supabase/migrations/20260663000100_get_replenishment_by_sku_rpc.sql | CREATED |
| src/lib/analysis/replenishmentUtils.ts (resolveParamsBySku) | CREATED |
| src/hooks/useReplenishmentBySku.ts (get_replenishment_by_sku) | CREATED |
| src/integrations/supabase/types.ts (get_replenishment_by_sku) | UPDATED |

### Prohibitions Compliance

| Prohibition | Status |
|-------------|--------|
| get_replenishment_by_sku NUNCA SECURITY DEFINER | PASS — SECURITY INVOKER |
| Nenhum GRANT EXECUTE a PUBLIC/anon | PASS — REVOKE FROM PUBLIC/anon explícito |
| NÃO alterar get_replenishment (Phase 62) | PASS — arquivo intocado |
| NÃO alterar schema ml_product_daily_cache | PASS — velocidade via ml_orders |
| NÃO mexer em compraUtils.ts | PASS — arquivo intocado |

## Pending Checkpoints (Orquestrador)

### Task 3: Apply RPC + Validação Live

O orquestrador deve executar via MCP Supabase no projeto `ckcdevcxgvueywivefgx`:

1. **apply_migration** com o conteúdo de `supabase/migrations/20260663000100_get_replenishment_by_sku_rpc.sql`

2. **Linhas por SKU** — execute_sql:
   ```sql
   SELECT count(*)                                        AS linhas,
          count(*) FILTER (WHERE variation_id IS NOT NULL) AS por_variacao,
          count(*) FILTER (WHERE variation_id IS NULL)     AS sem_variacao_sku_unico,
          count(*) FILTER (WHERE compra_sugerida > 0)      AS sugeridos,
          count(*) FILTER (WHERE custo_ausente)            AS sem_custo,
          count(*) FILTER (WHERE param_origem = 'sku')     AS params_por_sku
   FROM get_replenishment_by_sku('7f615df7-7bac-45e5-8a93-827fb9ddeec7', 30, 1.0);
   ```
   Esperado: `linhas > 0`, `por_variacao > 0`, `sem_variacao_sku_unico >= 0`, sem erro.

3. **Anti-IDOR** (CMP-09) — execute_sql com `p_org_id = 'e4150d57-1349-48c9-9a89-82b1774857b0'` (Thales) sob JWT Pe Vermeio — deve retornar 0 linhas.

4. **get_advisors** após apply — sem ERROR de security para `get_replenishment_by_sku`.

## Threat Flags

Nenhum novo surface introduzido além do planejado. A RPC adiciona um endpoint de leitura escopado por org (padrão existente). REVOKE/GRANT correto para T-63-05.

## Self-Check

Arquivos criados/modificados:
- `supabase/migrations/20260663000100_get_replenishment_by_sku_rpc.sql` — FOUND
- `src/lib/analysis/replenishmentUtils.ts` — FOUND (resolveParamsBySku)
- `src/lib/analysis/replenishmentUtils.test.ts` — FOUND (15 tests)
- `src/integrations/supabase/types.ts` — FOUND (get_replenishment_by_sku)
- `src/hooks/useReplenishmentBySku.ts` — FOUND

Commits:
- 28eace23 — feat(63-02): migration RPC
- 8a01ac03 — test(63-02): TDD RED
- 93207062 — feat(63-02): TDD GREEN

## Self-Check: PASSED
