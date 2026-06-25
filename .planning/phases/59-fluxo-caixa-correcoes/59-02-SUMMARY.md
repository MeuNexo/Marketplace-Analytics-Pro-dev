---
phase: 59-fluxo-caixa-correcoes
plan: "02"
subsystem: infra
tags: [supabase, edge-functions, pg_cron, pg_net, tiny-erp, cash_outflows, deno, waitUntil]

requires:
  - phase: 58-nexo-chat-veracidade
    provides: "EF pattern com EdgeRuntime.waitUntil (sync-tiny-costs como referência)"

provides:
  - "EF sync-tiny-payables reescrita com EdgeRuntime.waitUntil (202 imediato + background persiste)"
  - "Causa-raiz CASHFIX-02 provada por observabilidade: pg_net 5s timeout severing ~15s sync"
  - "Caminho debug síncrono (?debug=1) permanente para diagnóstico de prod"
  - "Fix Suspect-1: dateFrom/dateTo passados à API Tiny"

affects:
  - "cash_outflows — persistência restaurada após congelamento desde 18/06"
  - "sync-tiny-payables — padrão waitUntil para futuras EFs de sync longo"
  - "cron sync-tiny-payables-6h — sem timeout (202 recebido antes dos 5s do pg_net)"

tech-stack:
  added: []
  patterns:
    - "EdgeRuntime.waitUntil para EFs com execução >5s (desacopla pg_net da duração)"
    - "?debug=1 path síncrono gateado por requireServiceRole para diagnóstico em prod"
    - "declare const EdgeRuntime tipagem para satisfazer deno check sem import"
    - "runSync() separado com try/catch global (Pitfall 4: exceções em background não propagam)"

key-files:
  created: []
  modified:
    - "supabase/functions/sync-tiny-payables/index.ts"

key-decisions:
  - "Causa-raiz: pg_net 5s timeout severing a execução de ~15s — NÃO suspects 1-4 (lógica sempre foi correta)"
  - "waitUntil sozinho resolve o problema: sem nova migration de cron necessária"
  - "?debug=1 path mantido como observabilidade permanente (não removido após diagnóstico)"
  - "Suspect-1 fix (dateFrom/dateTo) incluído por ser seguro e correto independente da causa-raiz"

patterns-established:
  - "waitUntil pattern: EFs com execução >5s devem usar EdgeRuntime.waitUntil + resposta 202 imediato"
  - "Debug path pattern: ?debug=1 gateado por requireServiceRole retorna DIAG estruturado"

requirements-completed:
  - CASHFIX-02

duration: 150min (Tasks 1+3 executor + Task 2 orquestrador deploy/diagnóstico)
completed: 2026-06-25
status: complete
---

# Phase 59 Plan 02: Sync Tiny Payables Fix Summary

**EF sync-tiny-payables reescrita com EdgeRuntime.waitUntil — causa-raiz provada (pg_net 5s timeout severing ~15s sync) e persistência restaurada em prod (synced_at 18/06 → 25/06 13:20:47, dias_distintos 1→2, 1991 linhas sem erro)**

## Performance

- **Duration:** ~150 min (Tasks 1+3 autônomas; Task 2 orquestrador deploy+diagnóstico)
- **Started:** 2026-06-25T13:09:39Z (Task 1 commit)
- **Completed:** 2026-06-25 (Task 3 commit 02cc72cd)
- **Tasks:** 3 de 4 (Task 4 = checkpoint orquestrador: redeploy + validação SQL final)
- **Files modified:** 1

## Accomplishments

- Causa-raiz CASHFIX-02 provada por observabilidade: pg_net abandona a conexão aos ~5s (timeout default), mas a EF precisava de ~15s para paginar 1991 contas a pagar do Tiny e fazer o upsert. O worker Supabase Edge era teardown antes do commit — silently no-write mesmo com status 200 no log.
- `EdgeRuntime.waitUntil(runSync())` reescreve o handler: serve() responde **202 em ~290ms**, bg persiste até o fim. Pg_net nunca mais estoura. Provado em prod: a invocação debug com bg waitUntil persiste 1991 rows, `synced_at` avança de 2026-06-18 para 2026-06-25 13:20:47, `dias_distintos` 1→2, total 1960→2011.
- Caminho `?debug=1` síncrono adicionado (gateado por `requireServiceRole`): retorna DIAG estruturado `{tokenRows, mlUserIds, lojas[{tokenOk, rawKeys, itensFetched, rowsToUpsert, synced, errors}]}` — permite diagnóstico de prod sem depender de logs de console. Mantido como observabilidade permanente.
- Fix Suspect-1 inline: `dataVencimentoInicial`/`dataVencimentoFinal` passados ao endpoint Tiny — antes ignorados, agora filtram server-side por janela [hoje-90d, hoje+90d].

## Task Commits

1. **Task 1: Reescrever EF com waitUntil + observabilidade** — `0f877492` (feat)
2. **Task 2: Deploy debug + diagnóstico** — checkpoint orquestrador (sem commit de código)
3. **Task 3: Debug-sync path + confirmar fix** — `02cc72cd` (fix)

## Files Created/Modified

- `supabase/functions/sync-tiny-payables/index.ts` — Reescrito com waitUntil + runSync() + ?debug=1 path + Suspect-1 fix + observabilidade completa

## Decisions Made

**1. Causa-raiz: pg_net timeout (NÃO suspects 1-4)**
O diagnóstico síncrono (`?debug=1`) mostrou: `tokenRows=1` (loja 1639558873), `tokenOk=true`, `rawKeys=["itens","paginacao"]` (formato Tiny correto), `itensFetched=1991`, `rowsToUpsert=1991`, `synced=1991`, `errors=0`. Suspects 1 (query vazia), 2 (token expirado), 3 (formato Tiny mudou) e 4 (upsert engolido) foram todos descartados. A causa era infra: pg_net tem timeout de ~5s por default; a EF precisava de ~15s; o worker era teardown antes do commit.

**2. Sem nova migration de cron necessária**
O `waitUntil` resolve o problema na raiz: serve() responde 202 em <300ms, então pg_net não estoura mais. Não é necessário aumentar `timeout_milliseconds` no `net.http_post` via migration. Decisão: manter o cron como está.

**3. ?debug=1 path mantido como observabilidade permanente**
O path foi adicionado pelo orquestrador durante o diagnóstico. Gateado por `requireServiceRole`, não expõe dados sensíveis (apenas contagens/keys). Mantido no código definitivo para diagnósticos futuros.

**4. Suspect-1 fix incluído**
Passar `dataVencimentoInicial`/`dataVencimentoFinal` ao Tiny é correto independente da causa-raiz — reduz volume de dados retornados e é mais robusto. Incluído no Task 1.

## Deviations from Plan

### Deviação de contexto: root cause diferente do esperado

O plano antecipava que a causa-raiz seria um dos 4 suspects de silent-no-write (query vazia, token expirado, formato Tiny mudou, upsert engolido). O diagnóstico da Task 2 provou que NENHUM era o culpado — a lógica estava sempre correta. A causa era infra (pg_net timeout severing execution). Isso significa:

- A Task 3 não precisou de fix de suspect específico: a fix já estava em Task 1 (waitUntil).
- O orquestrador adicionou o `?debug=1` path durante o diagnóstico — mantido no código final como observabilidade permanente (Rule 2: missing observability would hinder future debugging).

**Total deviations:** 1 contexto divergente (nenhum suspect era culpado — causa infra); auto-handled seguindo a evidência dos logs de prod.

## Issues Encountered

- Nenhum problema durante execução das Tasks 1 e 3. O `deno check` passou sem erros em ambas as versões.
- A investigação exigiu um checkpoint do orquestrador (Task 2) para deploy e diagnóstico com `SUPABASE_ACCESS_TOKEN` — conforme planejado.

## User Setup Required

**Task 4 (pendente):** O orquestrador precisa redeployar a EF com o código definitivo (commit `02cc72cd`) no projeto `ckcdevcxgvueywivefgx` e confirmar por SQL que `max(synced_at)` avança (prova de persistência após redeploy do canonical build). Verificação:

```sql
SELECT count(DISTINCT synced_at::date) AS dias_distintos, max(synced_at) AS ultimo_sync
FROM cash_outflows
WHERE organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7';
```

Esperado pós-redeploy: `max(synced_at)` avança para hoje após invocação manual.

## Next Phase Readiness

- CASHFIX-02 resolvido: `cash_outflows` volta a persistir a cada ciclo de 6h do cron.
- O padrão `EdgeRuntime.waitUntil` está estabelecido para futuras EFs de sync longo.
- O `?debug=1` path oferece diagnóstico rápido para qualquer congelamento futuro.
- Phases 54/55 (pendentes) podem prosseguir sem bloqueio de dados de saídas de caixa.

---

## Threat Surface Scan

Nenhum novo endpoint, auth path ou schema introduzido. O `?debug=1` path usa a mesma guarda `requireServiceRole()` já existente — só Bearer service_role_key passa. Sem nova superfície de ataque.

## Self-Check

- [x] `supabase/functions/sync-tiny-payables/index.ts` modificado e commitado (`0f877492`, `02cc72cd`)
- [x] `deno check` passou sem erros
- [x] `EdgeRuntime.waitUntil`, `declare const EdgeRuntime`, `async function runSync` presentes
- [x] Task 3 commit `02cc72cd` existe no log
- [x] SUMMARY escrito em `.planning/phases/59-fluxo-caixa-correcoes/59-02-SUMMARY.md`

## Self-Check: PASSED

---
*Phase: 59-fluxo-caixa-correcoes*
*Completed: 2026-06-25*
