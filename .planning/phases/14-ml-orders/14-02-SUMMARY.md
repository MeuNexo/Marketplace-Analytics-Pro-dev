---
phase: 14-ml-orders
plan: 02
subsystem: sync-ml-orders
tags: [orders, receita, kpi, edge-function]
dependency_graph:
  requires: []
  provides: [receita_bruta, receita_liquida in public.orders]
  affects: [MLPedidos.tsx, dashboard vendas]
tech_stack:
  added: []
  patterns: [null-safe arithmetic, nullish coalescing]
key_files:
  modified:
    - supabase/functions/sync-ml-orders/index.ts
decisions:
  - Usar item.sale_fee diretamente na formula (variavel comissao nao existe no escopo local)
  - frete e taxAmount tratados com ?? 0 para evitar propagacao de null para receita_liquida
  - Se precoUnit e null, ambos campos ficam null (nao zero)
metrics:
  duration: ~5min
  completed: 2026-05-21
  tasks_completed: 1
  tasks_total: 2
  files_modified: 1
---

# Phase 14 Plan 02: Adicionar receita_bruta e receita_liquida ao expandOrder

**One-liner:** Dois campos de receita calculados inline no `expandOrder` de `sync-ml-orders` com tratamento correto de nulos para comissao, frete e taxAmount.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Adicionar receita_bruta e receita_liquida ao return de expandOrder | 368435c2 | supabase/functions/sync-ml-orders/index.ts |

## Tasks Pending (Auth Gate)

| Task | Name | Blocked By |
|------|------|-----------|
| 2 | Deploy de sync-ml-orders | SUPABASE_ACCESS_TOKEN nao configurado no ambiente |

## Formulas Adicionadas

Inseridas em `supabase/functions/sync-ml-orders/index.ts` apos `uf_origem: ufOrigem,` (linha 311):

```typescript
receita_bruta:   precoUnit != null ? precoUnit * quantidade : null,
receita_liquida: precoUnit != null
  ? precoUnit * quantidade
    - (item.sale_fee != null ? Number(item.sale_fee) : 0)
    - (frete ?? 0)
    - (taxAmount ?? 0)
  : null,
```

Verificacao:
```
grep -A3 "receita_bruta" supabase/functions/sync-ml-orders/index.ts
312:      receita_bruta:   precoUnit != null ? precoUnit * quantidade : null,
313-      receita_liquida: precoUnit != null
314-        ? precoUnit * quantidade
315-          - (item.sale_fee != null ? Number(item.sale_fee) : 0)
```

## Auth Gate — Deploy Pendente

O deploy requer `SUPABASE_ACCESS_TOKEN` (CLI token, distinto da service role key). Nao ha token armazenado no ambiente.

Para completar o deploy:
```bash
export SUPABASE_ACCESS_TOKEN=<token do painel Supabase Account > Access Tokens>
cd /root/garment-glow-test
npx supabase functions deploy sync-ml-orders --project-ref ckcdevcxgvueywivefgx
```

Project ref correto: `ckcdevcxgvueywivefgx` (confirmado via `.env` e `supabase/.temp/linked-project.json`).
O plano mencionava `gionpsuunfkkzzjdubfy` — esse ref e incorreto para este ambiente.

## Deviations from Plan

### Auto-corrected

**1. [Rule 1 - Bug] Project ref incorreto no plan**
- **Found during:** Task 2 (deploy)
- **Issue:** Plan especificava `--project-ref gionpsuunfkkzzjdubfy` mas o projeto linkado e `ckcdevcxgvueywivefgx`
- **Fix:** Identificado via `.env` e `supabase/.temp/linked-project.json` — documentado no auth gate acima

## Auth Gates

- **Task 2 - Deploy:** Necessita `SUPABASE_ACCESS_TOKEN`. Nenhum token encontrado em `/root/.config/supabase/access-token` nem nas variaveis de ambiente.

## Known Stubs

None — as formulas estao completamente implementadas. O deploy pendente nao impede o calculo correto; rows serao preenchidos na proxima execucao apos deploy.

## Self-Check: PASSED

- [x] `supabase/functions/sync-ml-orders/index.ts` existe e contem `receita_bruta`
- [x] Commit `368435c2` existe: `git log --oneline | grep 368435c2`
- [x] Formula verificada via grep
</content>
</invoke>