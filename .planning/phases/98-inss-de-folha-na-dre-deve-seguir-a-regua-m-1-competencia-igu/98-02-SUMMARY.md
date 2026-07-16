---
phase: 98-inss-de-folha-na-dre-deve-seguir-a-regua-m-1-competencia-igu
plan: 02
subsystem: finance-dre
tags: [typescript, vitest, tanstack-query, dre, inss, m-plus-1, pure-function]

# Dependency graph
requires:
  - phase: 94
    provides: "dreRegime.ts (DreRegime, GuiaRealCategoryTotal, monthPlusOne, apuracaoImpostoReal pattern) e useImpostoGuiaReal.ts (hook M+1 de imposto de venda) — moldes clonados literalmente nesta phase"
  - phase: 88
    provides: "dreCascade.ts (DreCascade, DreCascadeBlocoLine, DreOperationalRow, OPERACIONAL_BLOCOS, buildDreCascade) — tipo consumido por applyInssReal sem reimplementar soma de blocos"
provides:
  - "src/lib/dreInss.ts — módulo puro: INSS_FOLHA_CATEGORY, resolveInssReal, filterRawInssRow, applyInssReal, resolveInssForCascade"
  - "src/lib/dreInss.test.ts — 17 casos provando pago/cancelado/ausente/múltiplas-linhas-mesma-competência (abril real) + gate previsão×apuração + inssReal=0"
  - "src/hooks/useInssGuiaReal.ts — hook TanStack Query, mirror de useImpostoGuiaReal, chama get_inss_guia_by_competence em p_competence=monthPlusOne(saleMonth)"
affects: ["98-03 (fiação em MercadoLivre.tsx/dreCloseGate.ts)", "Phase 99 (candidata — canApurarInss no gate de fechamento)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Módulo puro dedicado por regra de negócio de 1 categoria (mirror de dreRegime.ts), consumindo o tipo DreCascade já pronto sem reimplementar buildDreCascade"
    - "Curto-circuito explícito em `== null` (nunca falsy) quando 0 é um valor de negócio válido (mês 100% crédito)"

key-files:
  created:
    - src/lib/dreInss.ts
    - src/lib/dreInss.test.ts
    - src/hooks/useInssGuiaReal.ts
  modified: []

key-decisions:
  - "resolveInssReal clona literalmente a regra apuracaoImpostoReal de dreRegime.ts (status !== 'cancelled' soma, ausente/vazio → null, tudo cancelado → 0)"
  - "applyInssReal insere a linha 'pessoal' na FRENTE do array quando o bloco não existe (pessoal é o primeiro de OPERACIONAL_BLOCOS), preservando a ordem dos demais blocos"
  - "useInssGuiaReal não clona useImpostoGuiaNudge — o empurrãozinho de 3 sinais está fora de escopo desta phase (CONTEXT.md <deferred>)"

patterns-established:
  - "Pattern: régua M+1 de uma categoria isolada (INSS) vira módulo próprio (dreInss.ts) em vez de estender dreRegime.ts — mantém dreRegime.ts focado em imposto de venda"

requirements-completed: ["INSS-02"]

# Metrics
duration: 20min
completed: 2026-07-16
status: complete
---

# Phase 98 Plan 02: dreInss M+1 módulo puro + hook Summary

**Módulo puro `dreInss.ts` (resolver/filtro/merge/gate) e hook `useInssGuiaReal` provam por teste o deslocamento M+1 do INSS de folha no bloco Pessoal, incluindo a fixture real de abril (cancelada+paga na mesma competência resolvendo para R$2.652,31 sem código especial).**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-16T20:47:00Z
- **Completed:** 2026-07-16T20:53:22Z
- **Tasks:** 2 (Task 1 TDD com sub-commits RED/GREEN; Task 2 single commit)
- **Files modified:** 3 (todos novos)

## Accomplishments
- `resolveInssReal`, `filterRawInssRow`, `applyInssReal`, `resolveInssForCascade` provados por 17 testes cobrindo pago/cancelado/ausente/pending, a fixture real de abril (`{1550,cancelled}+{2652.31,paid}` → 2652.31), o caso `inssReal=0` (prova `== null`, nunca falsy) e o gate previsão×apuração (incluindo integração completa `resolveInssForCascade → buildDreCascade → applyInssReal`).
- `useInssGuiaReal(saleMonth)` criado como mirror exato de `useImpostoGuiaReal`, chamando `get_inss_guia_by_competence` em `p_competence = monthPlusOne(saleMonth)`.
- Zero edição em `dreCascade.ts`, `dreRegime.ts`, `dreCloseGate.ts`, `useImpostoGuiaReal.ts` ou `MercadoLivre.tsx` — escopo estritamente isolado, fiação fica para o Plano 98-03.
- Suíte completa (`npx vitest run`) sem regressão: 606/606 testes verdes em 44 arquivos.

## Task Commits

Cada task foi commitada atomicamente (TDD na Task 1: RED → GREEN):

1. **Task 1 (RED): dreInss.test.ts** - `de985acc` (test)
2. **Task 1 (GREEN): dreInss.ts** - `e5ce6e16` (feat)
3. **Task 2: useInssGuiaReal.ts** - `c121f1bd` (feat)

_Sem etapa REFACTOR: implementação já ficou limpa na primeira passada GREEN — nenhuma limpeza necessária._

**Plan metadata:** commit deste SUMMARY.md/STATE.md/ROADMAP.md fica a cargo do orquestrador (não deste executor, por instrução explícita do prompt).

## Files Created/Modified
- `src/lib/dreInss.ts` - Módulo puro: `INSS_FOLHA_CATEGORY`, `resolveInssReal`, `filterRawInssRow`, `applyInssReal`, `resolveInssForCascade`
- `src/lib/dreInss.test.ts` - 17 casos TDD (pago/cancelado/ausente/pending/múltiplas-linhas-abril-real/gate previsão×apuração/inssReal=0)
- `src/hooks/useInssGuiaReal.ts` - Hook TanStack Query, mirror de `useImpostoGuiaReal`

## Decisions Made
- Clone literal da regra `apuracaoImpostoReal` (dreRegime.ts:130-137) para `resolveInssReal`, restrita a 1 categoria — sem generalizar em RPC/módulo parametrizado (consistente com o estilo do repo: 1 módulo dedicado por grupo de categoria com régua própria).
- `applyInssReal` sempre devolve um NOVO objeto `DreCascade` (nunca mutação in-place), mesmo no caminho de "cria a linha pessoal do zero".
- Comentário de cabeçalho de `dreInss.ts` documenta explicitamente por que o módulo existe separado de `dreRegime.ts` (regra de folha, não de imposto sobre venda) — conforme exigido pela Task 1.

## Deviations from Plan

**1. [Rule 1 - ajuste de teste] Reescrita do comentário de cabeçalho do hook para não duplicar a string `get_inss_guia_by_competence`**
- **Found during:** Task 2 (verificação de acceptance criteria)
- **Issue:** O comentário de cabeçalho citava `get_inss_guia_by_competence` no texto explicativo, além da chamada real no `queryFn` — o critério de aceite exige `grep -c "get_inss_guia_by_competence" == 1` (prova de que o nome da RPC aparece só no ponto de chamada, sem duplicação acidental).
- **Fix:** Reescrito o comentário para citar a RPC de imposto de venda (`get_imposto_guia_by_competence`) como referência de clone, sem repetir o nome da RPC nova.
- **Files modified:** `src/hooks/useInssGuiaReal.ts`
- **Verification:** `grep -c "get_inss_guia_by_competence" src/hooks/useInssGuiaReal.ts` → `1`; `npx tsc --noEmit` → 0 erros.
- **Committed in:** `c121f1bd` (parte do commit da Task 2, antes do commit final — ajuste feito durante a mesma task, não separado)

---

**Total deviations:** 1 auto-fixed (ajuste de comentário para satisfazer critério de aceite mensurável)
**Impact on plan:** Nenhum impacto funcional — só clareza de comentário. Nenhum scope creep.

## Issues Encountered
None.

## User Setup Required
None - nenhuma configuração externa necessária (módulo puro + hook; a RPC `get_inss_guia_by_competence` que o hook chama é escopo do Plano 98-01, aplicada via MCP pelo orquestrador).

## Next Phase Readiness
- As 4 peças puras (`resolveInssReal`, `filterRawInssRow`, `applyInssReal`, `resolveInssForCascade`) e o hook `useInssGuiaReal` estão prontos e 100% testados para o Plano 98-03 fazer a fiação em `MercadoLivre.tsx`/`dreCloseGate.ts`.
- Pendência já registrada em `98-CONTEXT.md`: a extensão do gate de fechamento (`canApurarInss`, mirror de `canApurarImposto`) foi só CAPTURADA como decisão (Opção A confirmada por Wesley), não implementada — fica para uma phase futura dedicada (candidata a Phase 99), a ser aberta após a Phase 98 fechar.
- Nenhum bloqueio conhecido para o Plano 98-03 prosseguir.

---
*Phase: 98-inss-de-folha-na-dre-deve-seguir-a-regua-m-1-competencia-igu*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: src/lib/dreInss.ts
- FOUND: src/lib/dreInss.test.ts
- FOUND: src/hooks/useInssGuiaReal.ts
- FOUND: .planning/phases/98-inss-de-folha-na-dre-deve-seguir-a-regua-m-1-competencia-igu/98-02-SUMMARY.md
- FOUND commit: de985acc (test RED)
- FOUND commit: e5ce6e16 (feat GREEN)
- FOUND commit: c121f1bd (feat hook)
