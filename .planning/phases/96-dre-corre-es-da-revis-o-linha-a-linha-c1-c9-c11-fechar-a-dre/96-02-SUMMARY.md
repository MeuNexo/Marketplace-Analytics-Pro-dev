---
phase: 96-dre-correcoes-linha-a-linha
plan: 02
subsystem: finance-dre
tags: [dre, imposto, gate, tdd, pure-function, dreRegime, dreCascade]

# Dependency graph
requires:
  - phase: 94-dre-regime-previsao-apuracao
    provides: "resolveDreRegime, IMPOSTO_VENDA_CATEGORIES, monthPlusOne, useImpostoGuiaReal (M+1 shift)"
  - phase: 88-dre-frontend-resultado-completo-vendas
    provides: "dreCascade.ts, buildDreCascade, OPERACIONAL_BLOCOS"
provides:
  - "canApurarImposto — gate puro de imposto por status (nunca por valor)"
  - "resolveCloseGate — combina gate de imposto (C7) com gate de CMV cheio (C6)"
  - "CmvCheioGap / CloseGateResult / ImpostoGateResult — tipos do gate de fechamento"
  - "IMPOSTO_VENDA_CATEGORIES exportada de dreRegime.ts (fonte única, era duplicada)"
  - "4 testes de regressão travando o INSS no bloco Pessoal (C11)"
affects: [96-03, 96-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Módulo puro sem React/Supabase para lógica de gate (mesmo padrão de dreCascade.ts/dreRegime.ts)"
    - "Gate por status, nunca por valor — quando o dado tem semântica de crédito/apuração, o campo booleano de estado é o único sinal confiável"

key-files:
  created:
    - src/lib/dreCloseGate.ts
    - src/lib/dreCloseGate.test.ts
  modified:
    - src/lib/dreRegime.ts
    - src/hooks/useImpostoGuiaReal.ts
    - src/lib/dreCascade.test.ts

key-decisions:
  - "Gate fica em módulo irmão (dreCloseGate.ts), não dentro de resolveDreRegime — evita misturar 'que base usar' com 'pode fechar o mês', preservando o SC5"
  - "canApurarImposto nunca lê o campo total — status='paid' é o único sinal (R$0,01 pago passa; qualquer pending rejeita, mesmo com valor alto)"

patterns-established:
  - "Pattern: gate de fechamento como combinação de sub-gates puros e independentes (imposto + CMV), cada um fail-closed em dado ausente"

requirements-completed: ["C7", "C11"]

# Metrics
duration: 12min
completed: 2026-07-15
status: complete
---

# Phase 96 Plan 02: Gate de Imposto por Status + Trava do INSS Summary

**`dreCloseGate.ts` (módulo puro novo) com `canApurarImposto`/`resolveCloseGate` provando que o gate de apuração de imposto olha o status das 3 guias M+1, nunca o valor — e 4 testes de regressão travando o INSS no bloco Pessoal (C11), sem alterar `dreCascade.ts`.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-15T22:11:00Z
- **Completed:** 2026-07-15T22:15:45Z
- **Tasks:** 2/2 completed
- **Files modified:** 5 (2 criados, 3 modificados)

## Accomplishments
- `canApurarImposto` prova o SC4: maio (3 guias `paid`, duas em R$0,01 por crédito de Lucro Real) aprova; qualquer guia `pending` — mesmo com valor alto (PIS 716,19/COFINS 3.298,87) — rejeita. Nenhum ramo da função lê o campo `total`.
- `resolveCloseGate` combina o gate de imposto com o gate de CMV cheio (gaps de `custo_unit_cheio`), fail-closed quando `gaps === null` (dado ainda carregando).
- `IMPOSTO_VENDA_CATEGORIES` virou fonte única: exportada de `dreRegime.ts`, a cópia duplicada em `useImpostoGuiaReal.ts` foi removida.
- 4 novos testes em `dreCascade.test.ts` travam o INSS (R$3.852,19) no bloco `pessoal` junto com Salários (R$24.000 → total 27.852,19) — todos passaram VERDES na primeira execução, confirmando que C11 é de fato uma não-mudança. `dreCascade.ts` não foi tocado.
- `resolveDreRegime` intocado: diff de conteúdo em `dreRegime.ts` é exatamente 1 palavra-chave (`export`), 18/18 testes de `dreRegime.test.ts` continuam verdes.

## Task Commits

Each task was committed atomically:

1. **Task 1: [C7] canApurarImposto + resolveCloseGate (módulo puro, TDD)**
   - `c9afc310` (test) — RED: 10 casos, `dreCloseGate.ts` ainda não existia, import falhou como esperado
   - `ba5aed2b` (feat) — GREEN: `dreCloseGate.ts` criado, `export` adicionado em `dreRegime.ts`, cópia removida de `useImpostoGuiaReal.ts`
2. **Task 2: [C11] Teste de regressão — INSS fica no bloco Pessoal**
   - `6f10cd87` (test) — 4 testes, verdes já na primeira execução (não-mudança confirmada)

**Plan metadata:** (este commit, a seguir)

_Nota: Task 1 seguiu RED→GREEN completo. Task 2 não tem fase RED por design do plano — os testes DEVEM passar verdes de cara, senão o plano teria que parar._

## Files Created/Modified
- `src/lib/dreCloseGate.ts` (novo) — `canApurarImposto`, `resolveCloseGate`, tipos `ImpostoGateResult`/`CmvCheioGap`/`CloseGateResult`. Módulo puro, zero import de React/Supabase.
- `src/lib/dreCloseGate.test.ts` (novo) — 10 testes: 6 de `canApurarImposto` (maio passa / placeholder rejeita / categoria duplicada contamina / faltante / null-vazio / blindagem 0,01) + 4 de `resolveCloseGate` (maio hoje / dois motivos / liberado / fail-closed).
- `src/lib/dreRegime.ts` — `IMPOSTO_VENDA_CATEGORIES` passa a ser `export const` (única mudança de conteúdo: 1 linha removida + 1 adicionada). `resolveDreRegime` intocado.
- `src/hooks/useImpostoGuiaReal.ts` — remove a cópia local de `IMPOSTO_VENDA_CATEGORIES`, importa de `@/lib/dreRegime`.
- `src/lib/dreCascade.test.ts` — novo `describe` com 4 testes do C11 (INSS no bloco Pessoal). `dreCascade.ts` não foi editado.

## Decisions Made
- O gate de fechamento (`resolveCloseGate`) mora em módulo irmão de `dreRegime.ts`, não dentro de `resolveDreRegime` — evita misturar "que base de CMV/imposto usar na DRE" (decisão do resolver) com "pode fechar o mês" (decisão do gate), preservando o SC5 (previsão byte-a-byte idêntica ao legado).
- `canApurarImposto` nunca lê `total` — decisão confirmada por Wesley (2026-07-15): R$0,01 pago é apuração com crédito de Lucro Real, não placeholder; o único sinal confiável é `status`.

## Deviations from Plan

None — plano executado exatamente como escrito. Um detalhe de verificação vale registro (não é desvio de implementação):

O comando literal do `acceptance_criteria` (`git diff main -- src/lib/dreRegime.ts | grep -c '^[+-]'` → esperado `≤ 2`) retorna **4** neste ambiente, porque `grep '^[+-]'` também casa as duas linhas de cabeçalho do diff (`--- a/...` e `+++ b/...`), que também começam com `-`/`+`. O diff de **conteúdo real** (excluindo os cabeçalhos) é exatamente as 2 linhas pretendidas — 1 removida (`const IMPOSTO_VENDA_CATEGORIES`) + 1 adicionada (`export const IMPOSTO_VENDA_CATEGORIES`), verificado manualmente com `grep -vE '^(\+\+\+|---) '`. `resolveDreRegime` não foi tocado; os 18/18 testes de `dreRegime.test.ts` são a prova funcional do SC5.

## Issues Encountered
- A suíte completa (`npx vitest run`) rodou em ambiente com **execução paralela de outros planos da mesma fase** (96-01, 96-04) no mesmo working directory — `useMLBilling.test.ts` (fora do escopo deste plano) apareceu temporariamente falhando (4 testes) durante uma verificação intermediária. Confirmei via `git stash` que a falha já existia no estado base (commit `e836d797`, plano 96-01 em fase RED) e não foi causada por este plano — não toquei em `useMLBilling.ts`/`useMLBilling.test.ts`. Ao final da execução deste plano, o plano 96-01 concluiu seu próprio GREEN e a suíte completa ficou 575/575 verde.

## User Setup Required

None - nenhuma configuração de serviço externo necessária.

## Next Phase Readiness
- `canApurarImposto`/`resolveCloseGate`/`CmvCheioGap` prontos para o plano 96-03 (hook que popula `CmvCheioGap[]` a partir dos SKUs sem custo cheio) e o plano 96-06 (liga o gate no botão de fechamento do mês na tela).
- `IMPOSTO_VENDA_CATEGORIES` agora tem fonte única — qualquer novo consumidor deve importar de `@/lib/dreRegime`, nunca duplicar a lista.
- Nenhum bloqueio conhecido para os próximos planos da fase.

---
*Phase: 96-dre-correcoes-linha-a-linha*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: src/lib/dreCloseGate.ts
- FOUND: src/lib/dreCloseGate.test.ts
- FOUND: src/lib/dreRegime.ts
- FOUND: src/hooks/useImpostoGuiaReal.ts
- FOUND: src/lib/dreCascade.test.ts
- FOUND: .planning/phases/96-dre-corre-es-da-revis-o-linha-a-linha-c1-c9-c11-fechar-a-dre/96-02-SUMMARY.md
- FOUND: c9afc310 (test — RED)
- FOUND: ba5aed2b (feat — GREEN)
- FOUND: 6f10cd87 (test — C11 regression)
