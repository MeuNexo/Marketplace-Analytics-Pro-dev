---
phase: 14-ml-orders
plan: 01
subsystem: edge-functions
tags: [cleanup, orders, fire-and-forget, mercado-libre-integration]
dependency_graph:
  requires: []
  provides: [mercado-libre-integration sem escrita em public.orders]
  affects: [public.orders, sync-ml-orders]
tech_stack:
  added: []
  patterns: []
key_files:
  modified:
    - supabase/functions/mercado-libre-integration/index.ts
decisions:
  - Escrita em public.orders é responsabilidade exclusiva de sync-ml-orders
metrics:
  duration: ~10min
  completed: 2026-05-21
  tasks_completed: 2/3
  tasks_blocked: 1 (deploy — auth gate)
---

# Phase 14 Plan 01: Remove Fire-and-Forget Orders Upsert — Summary

**One-liner:** Removido bloco fire-and-forget de 81 linhas que escrevia `public.orders` com campos incompletos (sem custo_unit, tax_rate, receita_bruta, receita_liquida); fetchShipmentStates revertida ao tipo original `{ uf, state_name }`.

## O que foi removido

### Bloco fire-and-forget (linhas 786-866 originais)

- **Comentário de abertura:** `// Orders upsert — fire-and-forget, não bloqueia o response`
- **Linhas removidas:** 786-866 (81 linhas no total)
- **Por que:** O bloco escrevia em `public.orders` sem calcular `custo_unit`, `tax_rate`, `tax_amount`, `receita_bruta` ou `receita_liquida`. Quando executava antes de `sync-ml-orders`, deixava campos nulos; quando executava depois, sobrescrevia dados completos com dados incompletos.
- **Escrita autorizada:** exclusiva via `sync-ml-orders`

### fetchShipmentStates (tipo revertido)

- **Tipo antes:** `Promise<Map<string, { uf: string; state_name: string; base_cost: number | null; cidade: string | null }>>`
- **Tipo depois:** `Promise<Map<string, { uf: string; state_name: string }>>`
- **Linhas removidas dentro do worker:** extração de `baseCostRaw`, `base_cost`, `addrCity`, `cidade` (5 linhas)
- **map.set atualizado:** `map.set(sid, { uf, state_name: stateName })` — sem campos extras

## Verificações

```bash
# Task 1 — orderRows: 0 referências
grep -c "orderRows" supabase/functions/mercado-libre-integration/index.ts
# → 0 ✓

# Task 2 — base_cost/cidade: 0 referências
grep -c "base_cost\|shipInfo?.cidade" supabase/functions/mercado-libre-integration/index.ts
# → 0 ✓

# await Promise.all(upsertPromises) permanece intacto na linha 779
grep -n "await Promise.all(upsertPromises)" supabase/functions/mercado-libre-integration/index.ts
# → 779: await Promise.all(upsertPromises); ✓
```

## await Promise.all(upsertPromises) — intacto

A linha `await Promise.all(upsertPromises)` na linha 779 **permanece intacta**. Ela finaliza os upserts de `ml_daily_cache`, `ml_hourly_cache`, `ml_product_daily_cache` e `ml_user_cache` — o trabalho principal da função não foi afetado.

## Resultado do Deploy

**Status: BLOQUEADO — authentication gate**

O `SUPABASE_ACCESS_TOKEN` não está disponível no ambiente de execução. O código está correto e commitado; o deploy requer o token de acesso:

```bash
export SUPABASE_ACCESS_TOKEN=<token>
npx supabase functions deploy mercado-libre-integration --project-ref ckcdevcxgvueywivefgx
```

## Commit

- **Hash:** `277e9c28`
- **Mensagem:** `fix(14-01): remove fire-and-forget orders upsert from mercado-libre-integration`
- **Arquivo:** `supabase/functions/mercado-libre-integration/index.ts` (92 deleções, 3 inserções)

## Deviations from Plan

**1. [Auth Gate] Deploy bloqueado — SUPABASE_ACCESS_TOKEN ausente**
- **Found during:** Task 3
- **Issue:** `npx supabase functions deploy` exige `SUPABASE_ACCESS_TOKEN` ou login interativo. Token não disponível no ambiente.
- **Fix:** Deploy deve ser executado manualmente com o token, ou via CI com secret configurado.
- **Impact:** Código correto e commitado; apenas deploy pendente.

## Known Stubs

Nenhum stub introduzido neste plano.

## Self-Check: PASSED

- [x] `supabase/functions/mercado-libre-integration/index.ts` existe e modificado
- [x] Commit `277e9c28` existe: `git log --oneline | grep 277e9c28`
- [x] `grep -c "orderRows"` → 0
- [x] `grep -c "base_cost"` → 0
- [x] `await Promise.all(upsertPromises)` na linha 779
