---
phase: 58-veracidade-completude-dados
plan: "01"
subsystem: nexo-chat
tags: [estoque, veracidade, anti-idor, testes, full-fulfillment]
dependencies:
  requires: []
  provides: [get_inventory-full-rotulado, summarizeVariations, get_coverage-rotulado]
  affects: [supabase/functions/nexo-chat/tools.ts, supabase/functions/nexo-chat/tools.test.ts]
tech_stack:
  added: []
  patterns: [summarizeVariations-helper-puro, paginação-range-aggregado, enum-allow-list-status]
key_files:
  created: []
  modified:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
decisions:
  - "summarizeVariations exportada como função pura (não inline) para testabilidade e legibilidade"
  - "Agregado calculado em query separada com paginação .range() para não truncar em >1000 linhas"
  - "allow-list de status (active/paused/all): valor fora do enum cai no default 'active' (T-58-01-STATUS)"
  - "freshness = max(synced_at) da amostra (não do aggregado) para simplicidade e adequação ao uso"
  - "get_coverage adiciona {window:'30d-fixed', label:'ruptura no Full', data:[...]} no dispatcher"
metrics:
  duration: ~8min
  completed: 2026-06-24
status: complete
---

# Phase 58 Plan 01: get_inventory Estoque Full Rotulado + Variações + Frescura — Summary

**One-liner:** Reescrita de `get_inventory` com default status=active, resumo agregado, variações esgotadas por tamanho/cor, rótulo "Full (fulfillment)" e synced_at; `get_coverage` rotulado; 27 testes verdes.

## What Was Built

### Task 1: get_inventory reescrita (EST-1..6 / VERAC-01/02/04)

**Achados corrigidos:**
- **EST-1** (crítico): sem filtro de status, `order ASC available_quantity + cap 50` devolvia só anúncios PAUSADOS. Agora default `status='active'`.
- **EST-2** (alto): `available_quantity` item-level mascarava ruptura por tamanho. Agora `variations_out_of_stock` no sample quando `has_variations=true`.
- **EST-3** (alto): nenhum rótulo de fonte. Agora `label: "estoque Full (fulfillment) — não inclui CD/Tiny; não é estoque total"`.
- **EST-4/5** (médio): `get_coverage` sem rótulo de janela fixa/ruptura Full. Agora description atualizada + `window:"30d-fixed"` no retorno.
- **EST-6** (médio): sem agregado de total. Agora `summary: {totalItems, totalUnits, active, paused, outOfStock, itemsWithSizeOutOfStock}`.
- **VERAC-04**: sem exposição de frescura. Agora `freshness: max(synced_at)` da amostra.

**Estrutura de retorno de `get_inventory`:**
```json
{
  "label": "estoque Full (fulfillment) — não inclui CD/Tiny; não é estoque total",
  "freshness": "2026-06-24T10:00:00Z",
  "summary": {
    "totalItems": 120,
    "totalUnits": 1585,
    "active": 95,
    "paused": 25,
    "outOfStock": 12,
    "itemsWithSizeOutOfStock": 26
  },
  "sample": [...]
}
```

**Helper `summarizeVariations(variations)`:** função pura exportada. Input: jsonb variations do cache (array de `{variation_id, attribute_combinations, available_quantity, ...}`). Output: `{total, out_of_stock, names}`. Defensiva a null/array vazio/itens não-objeto.

**Parâmetro `status`:** enum allow-list `active|paused|all`; valor fora do enum (inject malicioso) cai em `active` por segurança (T-58-01-STATUS).

**Paginação do aggregado:** loop `.range()` em páginas de 1000 para não truncar em PostgREST sem LIMIT.

**Anti-IDOR:** `.eq('organization_id', orgId)` + `.in('ml_user_id', mlUserIds)` mantidos em ambas as queries (aggregado + amostra). `args.org_id/seller_id/ml_user_id` continuam ignorados.

### Task 2: get_coverage rótulos + testes (27 verdes)

**get_coverage:** description atualizada com "30 dias (janela fixa)", "ruptura no FULL", "sold_quantity = total histórico". Dispatcher adiciona `{window:"30d-fixed", label:"ruptura no Full (fulfillment)", data:[...]}`.

**tools.test.ts:** 14 novos testes adicionados (total: 13→27):
- `get_inventory` anti-IDOR com novo shape `{label,freshness,summary,sample}`
- `get_inventory` default status=active (prova EST-1 corrigido)
- `get_inventory` status=paused/all/inválido
- `summarizeVariations`: null/empty, N variações K zeradas, todas com estoque, qty=0 string, itens não-objeto
- `get_coverage` description cita "30 dias" e "Full"
- `get_inventory` description cita "Full (fulfillment)" e nega "total"
- `get_inventory` parâmetro status com enum active|paused|all
- `get_inventory` não expõe org_id/seller_id/ml_user_id

## Verification

- `deno check supabase/functions/nexo-chat/tools.ts` — PASS (verde)
- `npx vitest run supabase/functions/nexo-chat/tools.test.ts` — PASS: 27 testes, 1 arquivo, 0 falhas

## Deviations from Plan

None — plano executado exatamente como escrito.

## Known Stubs

None. Toda a lógica de `get_inventory` é real (queries reais ao Supabase via `sb`, sem dados mock ou hardcoded).

## Threat Flags

None. Nenhuma nova superfície de rede ou mutação introduzida. Plano é read-only por construção (T-58-01-RO).

## Self-Check: PASSED

- FOUND: supabase/functions/nexo-chat/tools.ts
- FOUND: supabase/functions/nexo-chat/tools.test.ts
- FOUND commit 7b8b3207 (Task 1)
- FOUND commit d2114e67 (Task 2)
