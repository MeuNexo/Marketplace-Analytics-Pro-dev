---
phase: 84-dre-por-compet-ncia-de-venda-m-todo-tiny
plan: 02
subsystem: api
tags: [deno, edge-function, supabase, vitest, tdd, sync-ml-billing, dre]

requires:
  - phase: 84-dre-por-compet-ncia-de-venda-m-todo-tiny
    provides: "ml_billing_daily.competence_date column (migration, plan 84-01)"
provides:
  - "aggregateMoves() core puro de agregação por competência (competence_date = saleDate ?? charge_date)"
  - "aggregateInvoice() agrupa por (competence_date, charge_date, charge_type) sem exclusão within"
  - "runDailySync() grava competence_date no payload de ml_billing_daily"
  - "aggregate.test.ts — 7 testes unitários cobrindo o novo regime de competência"
affects: [84-05, 84-03, 84-04, 84-06]

tech-stack:
  added: []
  patterns:
    - "Core puro extraído para arquivo sibling sem imports Deno/URL (aggregate.ts), testável no vitest — mesmo padrão de nexo-chat/prompt.ts e nexo-chat/tools.ts"

key-files:
  created:
    - supabase/functions/sync-ml-billing/aggregate.ts
    - supabase/functions/sync-ml-billing/aggregate.test.ts
  modified:
    - supabase/functions/sync-ml-billing/index.ts

key-decisions:
  - "Core de agregação (aggregateMoves/RawMove) extraído para aggregate.ts em vez de permanecer inline em index.ts — necessário para o teste importar sem os imports Deno/URL de index.ts (deviation documentada abaixo)"
  - "aggregateInvoice mantém a assinatura (token, sellerId, inv) — inv.from/inv.to não são mais lidos internamente (within removido), mas inv.key continua necessário para fetchGroupMoves; nenhuma mudança de assinatura para não afetar os call sites (runDailySync)"

patterns-established:
  - "Lógica pura de Edge Function Deno vive em um arquivo sibling sem imports de URL, importado tanto por index.ts (uso real) quanto pelo teste (vitest/Node) — replicar para futuras EFs que precisem de testes unitários"

requirements-completed: []

duration: 6min
completed: 2026-07-03
status: complete
---

# Phase 84 Plan 02: Autoria da EF sync-ml-billing — regime de competência da venda Summary

**`aggregateInvoice()` da EF `sync-ml-billing` passa a agrupar por competência da venda (`competence_date = saleDate ?? charge_date`) e remove a exclusão `within`, com 7 testes unitários verdes cobrindo o novo regime; `ml_billing_monthly` (trilha de fatura) permanece com zero diff.**

## Performance

- **Duration:** ~6 min (17:36–17:42 UTC)
- **Started:** 2026-07-03T17:36:00Z
- **Completed:** 2026-07-03T17:42:25Z
- **Tasks:** 2/2
- **Files modified:** 3 (1 criado + 1 criado de teste + 1 editado)

## Accomplishments
- Core puro `aggregateMoves(moves: RawMove[])` extraído para `aggregate.ts`, agrupando por `(competence_date, charge_date, charge_type)` com `competence_date = saleDate ?? charge_date` e sinal de bonus SEMPRE negativo (exclusão `within` removida).
- `aggregate.test.ts` com 7 testes cobrindo: competência = saleDate, estorno fora da janela conta negativo (within removido), fallback para charge_date, grão novo (competence_date distinto → linha distinta), guard de campos ausentes, arredondamento, acúmulo por chave.
- `runDailySync()` grava `competence_date` no payload de insert de `ml_billing_daily`, mantendo delete-by-`source_invoice_key` + insert em lotes de 500 e idempotência.
- `fetchBillingPeriod`/`ml_billing_monthly` (trilha de fatura, "igual à fatura ML") verificados com **zero diff** (`git diff` confirma nenhuma linha tocada nessa seção).
- Nenhum deploy realizado — autoria pura, conforme escopo do plano (deploy é o plano 84-05, via MCP).

## Task Commits

Ciclo TDD completo (RED → GREEN) para Task 1, seguido de Task 2:

1. **Task 1 RED: aggregate.test.ts (falha esperada)** - `06002071` (test)
2. **Task 1 GREEN: aggregate.ts + index.ts usando aggregateMoves** - `e83df0c1` (feat)
3. **Task 2: competence_date no payload de runDailySync** - `00cac2af` (feat)

_Nenhum commit REFACTOR necessário — implementação já mínima e limpa na primeira passada GREEN._

## Files Created/Modified
- `supabase/functions/sync-ml-billing/aggregate.ts` - Core puro: `RawMove`, `AggregatedRow`, `aggregateMoves()` — regra de competência + sinal + arredondamento, sem I/O nem imports Deno/URL
- `supabase/functions/sync-ml-billing/aggregate.test.ts` - 7 testes unitários (vitest) do core de agregação
- `supabase/functions/sync-ml-billing/index.ts` - `aggregateInvoice()` agora delega para `aggregateMoves()` (grão novo, within removido); `runDailySync()` inclui `competence_date` no payload de insert; `fetchGroupMoves`/`resolveInvoice`/`fetchBillingPeriod`/`runAllAccountsDailySync`/modo monthly inalterados

## Decisions Made
- Extração para `aggregate.ts` (não inline em `index.ts`) foi necessária tecnicamente, não apenas estilística — ver Deviations.
- `aggregateInvoice` manteve a assinatura original (incluindo `inv.from`/`inv.to`, hoje não lidos por essa função) para não alterar o call site em `runDailySync` e reduzir o diff ao mínimo necessário.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Teste não pode importar `aggregateMoves` de `./index.ts` como o plano especificava**
- **Found during:** Task 1 (extrair core puro + testes RED→GREEN)
- **Issue:** O plano e os acceptance criteria pediam `aggregate.test.ts` importando de `./index.ts`. `index.ts` tem imports de topo `https://deno.land/std@0.168.0/http/server.ts`, `https://esm.sh/@supabase/supabase-js@2` e `https://deno.land/x/zod@v3.22.4/mod.ts` — URLs válidas só no runtime Deno. Testei diretamente antes de escrever a implementação (probe descartável, nunca commitado): `npx vitest run` contra um teste importando de `index.ts` falha com `Error: Only URLs with a scheme in: file and data are supported by the default ESM loader. Received protocol 'https:'`. Isso bloqueava 100% do Task 1 como escrito — nenhum teste conseguiria sequer carregar o módulo.
- **Fix:** Extraí `RawMove` (interface) e `aggregateMoves()` (função pura, sem I/O) para um novo arquivo `supabase/functions/sync-ml-billing/aggregate.ts`, sem nenhum import de URL. `index.ts` agora importa `{ aggregateMoves, type RawMove }` de `./aggregate.ts` e usa dentro de `aggregateInvoice()`. O teste importa de `./aggregate` (não de `./index.ts`). Este é exatamente o padrão já estabelecido no repositório para o mesmo problema em `supabase/functions/nexo-chat/` — `prompt.ts`/`tools.ts` são módulos puros importados tanto pela EF (`index.ts`) quanto pelos testes (`prompt.test.ts`/`tools.test.ts`), nunca o inverso.
- **Files modified:** `supabase/functions/sync-ml-billing/aggregate.ts` (novo), `supabase/functions/sync-ml-billing/index.ts` (import + uso de `aggregateMoves`)
- **Verification:** `npx vitest run supabase/functions/sync-ml-billing/aggregate.test.ts` → 7/7 verdes; `npx tsc --noEmit` → 0 erros; comportamento de `aggregateInvoice`/`runDailySync` idêntico ao especificado no plano (grão, sinal, competence_date), apenas a localização física do core mudou.
- **Committed in:** `06002071` (teste, RED) + `e83df0c1` (implementação, GREEN)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking issue)
**Impact on plan:** Deviation é puramente de localização de arquivo/import path; todo o comportamento exigido pelos `must_haves` e `acceptance_criteria` do plano foi entregue integralmente (grão `(competence_date, charge_date, charge_type)`, `within` removido, `competence_date` no payload, `grep -c "signed = null"` == 0). Nenhum scope creep.

## Issues Encountered
None além da deviation acima.

## User Setup Required
None - nenhuma configuração de serviço externo. Deploy real da EF é responsabilidade do plano 84-05 (via MCP `deploy_edge_function`), fora do escopo deste plano.

## Next Phase Readiness
- `aggregateMoves`/`RawMove`/`AggregatedRow` prontos para consumo por qualquer código futuro que precise da mesma lógica de agregação.
- `competence_date` já é escrito no payload de `runDailySync` — plano 84-05 pode deployar a EF sem trabalho adicional de código aqui.
- `ml_billing_monthly`/`fetchBillingPeriod` confirmados intactos (zero diff) — nenhum risco de regressão na trilha "fatura ML".
- Pendente (fora deste plano): deploy real (84-05), atualização do hook `useMLBillingDaily`/`coverageTo` para usar `competence_date` (Pitfall 2 do research, plano correspondente ainda não executado nesta sessão), e backfill sequencial de 2026-01 até o mês corrente (Pitfall 3).

---
*Phase: 84-dre-por-compet-ncia-de-venda-m-todo-tiny*
*Completed: 2026-07-03*

## Self-Check: PASSED
All created files found on disk (aggregate.ts, aggregate.test.ts, 84-02-SUMMARY.md). All task commit hashes (06002071, e83df0c1, 00cac2af) found in git log.
