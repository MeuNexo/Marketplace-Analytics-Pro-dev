---
phase: 77-pagina-analise-de-anuncios-produtos-vendidos-e-analise-de-pr
plan: "01"
subsystem: data-layer
tags:
  - orders
  - aggregation
  - pagination
  - rpc
  - migration
dependency_graph:
  requires: []
  provides:
    - soldProductsAgg (aggregatePvGroups + aggregatePvItems)
    - useMLSoldProducts (paged orders query hook)
    - orders_price_timeseries (RPC migration — pending orchestrator deploy)
  affects:
    - plans/77-02 (MLProdutosVendidos page — consumes soldProductsAgg + useMLSoldProducts)
    - plans/77-03 (MLAnalisePrecos page — consumes orders_price_timeseries RPC via PrecoPraticadoReport)
tech_stack:
  added: []
  patterns:
    - "TDD RED/GREEN (test commit before implementation)"
    - "Paginação .range() loop com MAX_ROWS teto (padrão Phase 73)"
    - "SECURITY INVOKER sem org param (anti-IDOR Phases 63/69)"
    - "data_pedido TEXT → cast ::date na RPC, string 'YYYY-MM-DD' no client"
key_files:
  created:
    - src/components/mercadolivre/anuncios/soldProductsAgg.ts
    - src/components/mercadolivre/anuncios/soldProductsAgg.test.ts
    - src/hooks/useMLSoldProducts.ts
    - supabase/migrations/20260677000000_orders_price_timeseries.sql
  modified: []
decisions:
  - "soldProductsAgg é util 100% pura — zero imports de React/Supabase/rede; testável isoladamente"
  - "useMLSoldProducts reutiliza SoldProductRow de soldProductsAgg para manter tipos coesos"
  - "Migration SECURITY INVOKER sem parâmetro org (RLS de orders isola por organização do caller)"
  - "Migration pendente de aplicação pelo orquestrador via MCP apply_migration (executor não tem token Supabase)"
  - "data_pedido::date cast obrigatório — nosso schema usa TEXT, diferente do oficial"
metrics:
  duration: "~3 min"
  completed_date: "2026-07-01"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 0
  tests_added: 9
  tests_passing: 9
status: complete
---

# Phase 77 Plan 01: Camada de Dados Compartilhada — soldProductsAgg + useMLSoldProducts + Migration orders_price_timeseries Summary

Camada de dados foundation para as páginas Produtos Vendidos e Análise de Preços: util pura de agregação client-side (com 9 testes vitest verdes), hook paginado de orders e migration da RPC `orders_price_timeseries` portada do app oficial com adaptação TEXT→date.

## One-liner

Util pura `soldProductsAgg` com TDD (9 testes) + hook paginado `useMLSoldProducts` + migration `orders_price_timeseries` SECURITY INVOKER com cast `data_pedido::date` — base reutilizável para Planos 02 e 03.

## What Was Built

### Task 1: Util pura soldProductsAgg + testes (TDD)

**RED:** `soldProductsAgg.test.ts` commitado com 9 testes falhando (módulo inexistente).
**GREEN:** `soldProductsAgg.ts` implementado; todos os 9 testes passam.

Tipos exportados:
- `SoldProductRow` — shape da linha de `orders` (item_id, titulo, marca, quantidade, receita_bruta, data_pedido, ml_user_id)
- `PvGroup` — grupo (key, name, qty, revenue)
- `PvItem` — anúncio dentro do grupo (item_id, title, qty, revenue, shareOfGroup)

Funções exportadas:
- `aggregatePvGroups(rows, pvView, itemsMap)` — agrupa por `row.marca` ou `itemsMap.get(item_id).category_id`; fallback "Sem marca"/"Sem categoria" quando chave ausente; ordena por revenue desc
- `aggregatePvItems(rows, pvSelected, pvView, itemsMap)` — filtra o grupo, agrega por item_id, calcula `shareOfGroup = revenue / totalRev` (0 quando totalRev=0); título preferindo `itemsMap.title > row.titulo > item_id`

Zero imports de React, Supabase ou rede.

### Task 2: Hook useMLSoldProducts

- `useMLSoldProducts({ fromDate, toDate, resolvedMLUserIds })` → `{ allRows, isLoading, error }`
- Guard: se `!fromDate || !toDate || !resolvedMLUserIds.length` → zera `allRows`, não busca (evita `.in("ml_user_id", [])`)
- Query: `orders` com `status='paid'`, `.gte("data_pedido", fromDate)`, `.lte("data_pedido", toDate)`, `.in("ml_user_id", resolvedMLUserIds)`, `.range(offset, offset + PAGE - 1)`
- `PAGE = 1000`, `MAX_ROWS = 50000` (T-77-02: PostgREST trunca em 1000)
- Cleanup anti-stale com flag `cancelled`

### Task 3: Migration orders_price_timeseries

Arquivo `supabase/migrations/20260677000000_orders_price_timeseries.sql` criado e commitado.

**Adaptação crítica vs. oficial:**
- Oficial: `o.data_pedido` é tipo `date` (usado direto)
- Nosso: `o.data_pedido` é `TEXT` → cast `o.data_pedido::date` em todos os usos (date_trunc e filtros)

**Assinatura:**
```sql
CREATE OR REPLACE FUNCTION public.orders_price_timeseries(
  _item_id text, _ml_user_ids text[] DEFAULT NULL,
  _from date DEFAULT NULL, _to date DEFAULT NULL, _granularity text DEFAULT 'day'
)
RETURNS TABLE(bucket date, preco_medio numeric, preco_min numeric, preco_max numeric, qtd bigint, total numeric, orders bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
```

**SECURITY INVOKER** (padrão anti-IDOR Phase 63/69): RLS de `orders` filtra pela organização do chamador autenticado. Sem parâmetro org.

**Status da migration:** Arquivo COMMITADO no repo. Aplicação no banco `ckcdevcxgvueywivefgx` PENDENTE — deve ser feita pelo orquestrador via MCP `apply_migration` (executor não tem SUPABASE_ACCESS_TOKEN).

## Commits

| Hash | Mensagem | Tarefa |
|------|----------|--------|
| `78ac352f` | test(77-01): add failing tests for soldProductsAgg util | Task 1 — TDD RED |
| `dcf1118b` | feat(77-01): implement soldProductsAgg pure util | Task 1 — TDD GREEN |
| `c2a26089` | feat(77-01): implement useMLSoldProducts hook | Task 2 |
| `fc990ebf` | feat(77-01): add migration orders_price_timeseries | Task 3 |

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run soldProductsAgg.test.ts` | PASS (9/9 tests) |
| `npx tsc --noEmit` | PASS (clean) |
| Migration file exists | PASS |
| Migration contains `CREATE OR REPLACE FUNCTION public.orders_price_timeseries` | PASS |
| Migration contains `o.data_pedido::date` | PASS |
| Migration does NOT contain `SECURITY DEFINER` | PASS |
| Smoke MCP da RPC no banco real | PENDENTE (orquestrador) |

## Deviations from Plan

None — plan executed exactly as written. A task 3 sempre foi designada como [BLOCKING] para o orquestrador; o executor escreveu o arquivo de migration conforme instrução.

## Known Stubs

None — este plano é puramente data layer (util pura + hook + migration SQL). Sem UI, sem dados mockados.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: IDOR-RPC | `supabase/migrations/20260677000000_orders_price_timeseries.sql` | Nova RPC de série temporal — mitigada por SECURITY INVOKER (RLS de orders isola org); sem parâmetro org; documentada no threat model T-77-01 |

## Pending (Orchestrator Actions)

1. **Apply migration:** Executar via MCP `mcp__claude_ai_Supabase__apply_migration` no projeto `ckcdevcxgvueywivefgx`:
   - Arquivo: `supabase/migrations/20260677000000_orders_price_timeseries.sql`
   - Conteúdo: `CREATE OR REPLACE FUNCTION public.orders_price_timeseries(...)` completo no arquivo

2. **Smoke pós-deploy:** Executar via MCP `execute_sql` no projeto `ckcdevcxgvueywivefgx`:
   ```sql
   SELECT * FROM orders_price_timeseries('MLB0000000000', NULL, NULL, NULL, 'day') LIMIT 1;
   ```
   Esperado: retorna sem erro "function does not exist" (pode retornar 0 linhas se não houver orders para o item — isso é OK).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `src/components/mercadolivre/anuncios/soldProductsAgg.ts` exists | FOUND |
| `src/components/mercadolivre/anuncios/soldProductsAgg.test.ts` exists | FOUND |
| `src/hooks/useMLSoldProducts.ts` exists | FOUND |
| `supabase/migrations/20260677000000_orders_price_timeseries.sql` exists | FOUND |
| Commit `78ac352f` (TDD RED) | FOUND |
| Commit `dcf1118b` (GREEN util) | FOUND |
| Commit `c2a26089` (hook) | FOUND |
| Commit `fc990ebf` (migration) | FOUND |
