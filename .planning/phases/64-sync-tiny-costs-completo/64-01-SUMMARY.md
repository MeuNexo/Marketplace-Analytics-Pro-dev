---
phase: 64-sync-tiny-costs-completo
plan: "01"
subsystem: edge-functions
tags: [sync, tiny-erp, edge-function, background-job, costs]
dependency_graph:
  requires: []
  provides: [sync-tiny-costs-waituntil]
  affects: [ml_product_costs, cron-sync-tiny-costs-daily]
tech_stack:
  added: []
  patterns: [EdgeRuntime.waitUntil, time-guard, missing-first-sort]
key_files:
  created: []
  modified:
    - supabase/functions/sync-tiny-costs/index.ts
decisions:
  - "runSync() extracts all sync logic; serve() is auth-only + 202 return"
  - "priorização faltantes via Set de ml_product_costs — graceful fallback se query falhar"
  - "CAP_DETAIL=250 + time guard 120s ao invés de remover cap sem teto temporal"
metrics:
  duration: "~4 minutes"
  completed: "2026-06-26"
  tasks_completed: 1
  tasks_total: 1
status: complete
---

# Phase 64 Plan 01: sync-tiny-costs EdgeRuntime.waitUntil + faltantes-first + cap 250/120s Summary

**One-liner:** EF `sync-tiny-costs` reescrita com `EdgeRuntime.waitUntil` (202 imediato), priorização de SKUs faltantes via `ml_product_costs` Set, e cap elevado de 80→250 com guarda de tempo de 120s.

## What Was Built

Reescrita do arquivo `supabase/functions/sync-tiny-costs/index.ts` com três mudanças cirúrgicas:

### 1. EdgeRuntime.waitUntil (COSTS-01 compliance)

- Declaração de tipo `declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void }` adicionada após os imports.
- Toda a lógica de sync extraída para `async function runSync(mlUserId: string, userId: string | null): Promise<void>` com try/catch externo obrigatório (Pitfall 4 — sem ele exceções do background morrem silenciosamente).
- `serve()` mantém autenticação inline (service-role key OU user JWT), valida `ml_user_id`, e então: `EdgeRuntime.waitUntil(runSync(mlUserId, userId)); return json({ ok: true, msg: "sync enqueued" }, 202);`
- O cron `sync-tiny-costs-daily` (pg_net) recebe o 202 em <200ms — nunca mais "Timeout of 5000ms reached".

### 2. Priorização de faltantes (COSTS-02)

Antes do loop de Fase 2, `runSync()` consulta `ml_product_costs` para o `scopeUserId`:
```ts
const { data: existingRows } = await sb.from("ml_product_costs").select("seller_sku").eq("user_id", scopeUserId);
existingSkus = new Set<string>(...);
withoutPrice.sort((a, b) => (existingSkus.has(a.sku) ? 1 : 0) - (existingSkus.has(b.sku) ? 1 : 0));
```
Se a query falhar, é capturada com `console.warn` e a ordem original é mantida (não aborta o sync). Os ~29 SKUs faltantes (Pralana/TXC/Sandrini) ficam nas primeiras posições da fila.

### 3. Cap 250 + guarda de tempo (COSTS-03)

- `CAP_DETAIL = 250` substitui o `slice(0, 80)` hardcoded.
- `PHASE2_TIMEOUT_MS = 120_000` (2min).
- Ao início de cada iteração do loop de batches: `if (Date.now() - t0 > PHASE2_TIMEOUT_MS) { console.log('[sync-tiny-costs] Phase 2 time guard triggered'); break; }`.
- Com RATE_MS=1100ms e ~29 faltantes: estimativa ~32s (bem dentro dos 120s). Time guard é proteção para execuções futuras com volume maior.

### Invariantes preservados

- Fase 1 (loop `withPrice` + upsert) estruturalmente idêntica ao original.
- Todos os helpers (`sleep`, `json`, `corsHeaders`, `sb`, `getTinyToken`, `tinyGet`, `fetchAllProducts`, `ProductEntry`) sem alteração.
- `RATE_MS=1100`, sleeps entre chamadas, tratamento de 429 (lança erro capturado no loop interno).
- Auth: service-role key OU user JWT — ambos aceitos, guard antes do waitUntil.

## Verification

```
deno check supabase/functions/sync-tiny-costs/index.ts
→ Check supabase/functions/sync-tiny-costs/index.ts  (sem erros)
```

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `a1a8ad5e` | fix(64-01): sync-tiny-costs — EdgeRuntime.waitUntil + faltantes first + cap 250/120s |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — nenhum dado hardcoded ou placeholder introduzido.

## Threat Flags

None — nenhuma nova superfície de rede, auth path ou acesso a arquivo introduzida. Mitigações T-64-01 a T-64-05 todas presentes:
- T-64-01: auth permanece antes do waitUntil em serve()
- T-64-02: scopeUserId derivado dentro de runSync via ml_tokens lookup
- T-64-03: RATE_MS=1100 preservado, 429 capturado no loop interno
- T-64-05: onConflict por (user_id, seller_sku) mantido

## Pending (checkpoint Task 2 — orquestrador)

1. Deploy: `deploy_edge_function(name="sync-tiny-costs", project_id="ckcdevcxgvueywivefgx")`
2. POST com `ml_user_id=1639558873` → esperar HTTP 202 em <1s
3. Aguardar ~3min → COUNT(ml_product_costs) deve crescer ≥+29
4. Verificar custo_ausente em get_replenishment_by_sku: de 37 → ~4

## Self-Check: PASSED

- [x] `supabase/functions/sync-tiny-costs/index.ts` existe e foi modificado
- [x] Commit `a1a8ad5e` existe em git log
- [x] `deno check` passou sem erros
- [x] Arquivo contém `EdgeRuntime.waitUntil(runSync(` exatamente uma vez
- [x] Arquivo contém `CAP_DETAIL` e `PHASE2_TIMEOUT_MS` como constantes
- [x] Arquivo contém query a `ml_product_costs` para montar `existingSkus`
- [x] `serve()` retorna 202 com `msg: "sync enqueued"` após validar mlUserId
- [x] Fase 1 (loop withPrice + upsert) estruturalmente idêntica ao original
