---
phase: 98-inss-de-folha-na-dre-deve-seguir-a-regua-m-1-competencia-igu
plan: 03
subsystem: dre-fiscal
tags: [react, typescript, dre, m+1, inss]

requires:
  - phase: 98-01
    provides: RPC get_inss_guia_by_competence viva em prod
  - phase: 98-02
    provides: src/lib/dreInss.ts (resolveInssForCascade, applyInssReal) + src/hooks/useInssGuiaReal.ts
provides:
  - Bloco Pessoal do card "DRE do Mês" usa INSS real M+1 em apuração; byte-idêntico em previsão
  - Describe do C11 em dreCascade.test.ts documentando a reversão da decisão de negócio da Phase 96
affects: [phase-99-gate-inss-ausente-candidata]

tech-stack:
  added: []
  patterns:
    - "Filtrar linha crua não-deslocada + somar valor M+1 resolvido no bloco já montado (mesmo padrão do C1 para cancelamentos)"

key-files:
  created: []
  modified:
    - src/pages/MercadoLivre.tsx
    - src/lib/dreCascade.test.ts

key-decisions:
  - "Task 1 (checkpoint:decision) NÃO foi reperguntada nesta execução — Wesley já respondeu 'option-a' ao orquestrador antes do disparo, registrado em 98-CONTEXT.md. A implementação do gate (canApurarInss em dreCloseGate.ts) fica pendente para uma phase futura dedicada (candidata Phase 99) — nenhum código de gate foi escrito nesta phase."

patterns-established:
  - "Régua M+1 para uma categoria isolada do bloco Pessoal: hook M+1 + resolver puro + filtro da linha crua + soma pós-processada, sem tocar na RPC agregada nem no resolver de imposto de venda"

requirements-completed: ["INSS-03", "INSS-04"]

duration: ~25min
completed: "2026-07-16"
status: complete
---

# Phase 98 Plan 03: Ligar régua M+1 do INSS no card DRE do Mês Summary

**Bloco Pessoal do card "DRE do Mês" (`MercadoLivre.tsx`) agora usa Salários/Pró-labore do mês corrente + INSS real da guia M+1 em apuração — byte-idêntico ao comportamento anterior em previsão — e o describe do C11 em `dreCascade.test.ts` documenta honestamente que a Phase 98 reverteu a decisão de negócio da Phase 96 sem que `buildDreCascade` em si tenha mudado.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3/3 (Task 1 checkpoint:decision resolvida antes do disparo; Task 2 e Task 3 executadas como `type="auto"`)
- **Files modified:** 2

## Accomplishments
- `useInssGuiaReal(dreSaleMonth)` ligado no mesmo eixo de mês já usado por `guiaReal`/`guiaNudge`/`monthClose` (nunca um eixo divergente).
- Novo `useMemo` compõe `resolveInssForCascade` → filtra a linha crua `Pessoal - INSS` (mês M, sem deslocar) e resolve o valor real M+1; `dreCascade` final = `applyInssReal(buildDreCascade(rowsFiltradas, margemContribuicao), inssReal)`.
- Em previsão: `resolveInssForCascade` devolve as rows sem alteração e `inssReal: null` → `applyInssReal` é no-op → cascata byte-idêntica à legada.
- Describe do C11 (`dreCascade.test.ts`) reescrito: título e comentário de cabeçalho agora explicam que a Phase 98 reverteu a decisão de negócio da Phase 96, mas a mudança observável vive inteiramente fora de `buildDreCascade` (em `dreInss.ts` + orquestração). As 4 asserções numéricas dos testes originais permanecem idênticas — só a narrativa mudou.
- Decisão do dono sobre o gate de fechamento (Opção A — estender ao INSS ausente) registrada verbatim aqui; implementação adiada para phase futura.

## Task Commits

1. **Task 2: Ligar a régua M+1 do INSS no card DRE do Mês** - `55f9f99a` (feat)
2. **Task 3: Reescrever o describe do C11 em dreCascade.test.ts** - `59a280bd` (docs/test)

(Task 1 foi um checkpoint de decisão pura — nenhum arquivo criado/editado; resposta registrada nesta SUMMARY.)

## Files Created/Modified
- `src/pages/MercadoLivre.tsx` - Import de `useInssGuiaReal`/`resolveInssForCascade`/`applyInssReal`; novo hook chamado no eixo `dreSaleMonth`; memo de `dreCascade` recomposto para filtrar INSS cru + somar INSS real M+1 em apuração.
- `src/lib/dreCascade.test.ts` - Describe do C11 renomeado e recomentado (reversão da Phase 96 documentada); descrições dos 4 `it(...)` prefixadas para deixar claro que testam o comportamento puro de soma, não a régua de competência.

## Decisions Made

**Task 1 — Decisão do gate de fechamento (registrada, NÃO implementada):**

> Pergunta: o gate de fechamento (`resolveCloseGate`/`canApurarImposto`, hoje só olha ICMS/PIS/COFINS) deve TAMBÉM bloquear "marcar mês como apurado" quando a guia de INSS (M+1) estiver ausente, mesmo padrão do C6/C7?

**Resposta de Wesley (registrada em `98-CONTEXT.md` antes deste plano rodar): "option-a"** — sim, estender o gate. Guia cancelada = crédito, não bloqueia; guia ausente = bloqueia (mesmo padrão do CMV cheio e do imposto de venda).

**Consequência:** esta phase (98) implementa SÓ a régua de valor (M+1 no bloco Pessoal). A extensão do gate (`canApurarInss` em `src/lib/dreCloseGate.ts`, mirror de `canApurarImposto`) fica como **pendência explícita para uma phase futura dedicada — candidata Phase 99**.

## Deviations from Plan

None - plan executado exatamente como escrito, incluindo a Task 1 pré-resolvida conforme instrução do orquestrador.

## Issues Encountered

**Perda acidental do arquivo SUMMARY.md original desta plan.** O agente executor original criou `98-03-SUMMARY.md` no worktree mas não chegou a commitá-lo antes do orquestrador remover o worktree (`git worktree remove --force`) após o merge — o arquivo foi perdido junto com o worktree. Este arquivo foi **reconstruído pelo orquestrador** a partir do relatório final verbatim retornado pelo agente executor na notificação de conclusão (que continha todos os detalhes: tasks, commits, verificações, decisões). Nenhum código foi perdido — só a documentação da SUMMARY, agora recuperada. Lição para o processo: sempre conferir `git status`/`git log` no worktree ANTES de `git worktree remove --force`.

## Next Phase Readiness

- **Pronto para ok visual do Wesley**: mês fechado (ex. junho, ICMS/PIS/COFINS já ok) agora deveria mostrar o bloco Pessoal com INSS deslocado — mas **junho ainda não tem guia de INSS na competência julho** (não verificado nesta phase; conferir antes do ok visual, pode precisar do mesmo tratamento dado a ICMS/PIS/COFINS de meses anteriores).
- **Pendência explícita para phase futura (candidata Phase 99):** implementar `canApurarInss` no gate de fechamento, mirror de `canApurarImposto`.
- **Suíte completa 606/606 verde, `tsc --noEmit` 0 erros**, guardrail confirmado: `git diff` vazio para `dreCascade.ts`/`dreRegime.ts`/`dreCloseGate.ts`.
- **Nada foi pushado/mergeado em `main`** — segue no branch `gsd/phase-97-dre-pipeline-confiavel` (mesmo branch das Phases 96/97), aguardando PR + ok visual do Wesley antes de ir pra produção.

---
*Phase: 98-inss-de-folha-na-dre-deve-seguir-a-regua-m-1-competencia-igu*
*Completed: 2026-07-16*
