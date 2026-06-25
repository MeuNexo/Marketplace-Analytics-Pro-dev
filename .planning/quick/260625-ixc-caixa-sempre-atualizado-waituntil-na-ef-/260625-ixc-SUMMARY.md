---
quick_id: 260625-ixc
status: complete
date: 2026-06-25
---

# Quick Task 260625-ixc — Caixa sempre atualizado (waitUntil sync-mp-releases + cron 3h)

Continuação do Phase 59: deixar **entradas (MP)** e **saídas (Tiny)** sempre atualizadas. As saídas já tinham sido resolvidas na Phase 59; faltava o recebimento (cron 1x/dia + EF sem waitUntil).

## O que foi feito (4 tasks)

1. **EF `sync-mp-releases` reescrita com `EdgeRuntime.waitUntil`** (commit `529d55eb`) — handler responde **202 imediato**, `requireServiceRole` antes do waitUntil, toda a lógica movida para `runSync()` com try/catch + `console.error` (Pitfall 4), `declare const EdgeRuntime`, modo `?debug=1` síncrono. Lógica de negócio intacta (janelas histórica/futura, `processWindow`/`syncOrg`, upsert incremental por página em `cash_inflows` onConflict `organization_id,payment_id`). Motivo: a EF leva ~118s e o pg_net do cron abandonava aos ~5s.
2. **Migration de cron `20260659000200_cashflow_crons_3h.sql`** (commit `a5d97cda`) — `unschedule`+`schedule` dos DOIS jobs (`sync-mp-releases-daily`, `sync-tiny-payables-6h`) para `0 */3 * * *`, reusando o corpo `net.http_post` Pattern B (Bearer service_role_key do vault). Mesmos nomes de job. Via migration versionada, nunca SQL Editor.
3. **Checkpoint orquestrador — deploy + apply (via MCP):** EF `sync-mp-releases` deployada (v5, verify_jwt=false, via `deploy_edge_function`); migration aplicada via `apply_migration` em `ckcdevcxgvueywivefgx`.
4. **Checkpoint orquestrador — prova em prod:**
   - 202 com auth: `{"ok":true,"msg":"sync enqueued"}` (rápido) ✓
   - 401 sem auth: `{"error":"Unauthorized"}` ✓
   - **Persistência async (waitUntil):** `cash_inflows.synced_at` avançou de 13:03:30 → **13:48:57** (o background do job de ~118s completa em ~3min — mais lento que o payables de ~15s, mas persiste) ✓
   - Crons confirmados: ambos `0 */3 * * *`, active ✓
   - Estado final: entradas 1766 contas sync 13:48:57; saídas sync 13:28:35

## Resultado
Entradas e saídas agora atualizam **a cada 3h** automaticamente, ambas com `EdgeRuntime.waitUntil` (sem timeout do pg_net). Caixa "sempre atualizado" conforme pedido pelo Wesley.

## Notas
- O `waitUntil` num job longo (~118s) leva ~3min pra completar em background — dentro do limite (~150s de execução + flush). Confirmado que persiste.
- Drift cosmético: a versão deployada da EF usa `sb: any` na assinatura (transcrição condensada do orquestrador) vs `ReturnType<typeof createClient>` no arquivo commitado — comportamento idêntico (tipos são apagados no runtime Deno). O arquivo commitado é o canônico.
- Branch: `gsd/phase-59-fluxo-caixa-correcoes` (mesmo da Phase 59, não mergeado).
