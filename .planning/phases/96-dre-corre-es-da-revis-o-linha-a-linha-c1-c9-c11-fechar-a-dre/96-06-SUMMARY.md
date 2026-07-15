---
phase: 96-dre-correcoes-linha-a-linha
plan: 06
subsystem: finance-dre
tags: [react, dre, frontend, gate, tooltip, popover, ux, tanstack-query]

# Dependency graph
requires:
  - phase: 96-02
    provides: "resolveCloseGate/canApurarImposto (src/lib/dreCloseGate.ts) — a lógica pura de gate consumida aqui sem reimplementação"
  - phase: 96-03
    provides: "useCmvCheioGate (C6 backend) — lista de SKUs sem custo cheio"
  - phase: 96-04
    provides: "useNaoClassificadoItems (C8 backend) — lançamentos crus do bloco nao_classificado"
  - phase: 96-05
    provides: "MLCostCard já refatorado com receitaBruta/margemContribuicao por prop; dreMargem.ts fonte única"
provides:
  - "MercadoLivre.tsx fia useCmvCheioGate + resolveCloseGate + useNaoClassificadoItems no mesmo eixo de mês do dreWaterfall"
  - "closeBlocked = !monthClose.isClosed && closeGate.blocked — o gate só vale para FECHAR, nunca para reabrir"
  - "handleCloseDreMonth com early-return + toast.error (defesa em profundidade, a RLS de dre_month_close não conhece o gate)"
  - "MLCostCard: botão bloqueado com Tooltip explicando o motivo (resolve a contradição visual do nudge 🟢 x botão desabilitado)"
  - "CmvGapsTrigger — Popover tap-friendly com os SKUs sem custo cheio, distinguindo temCustoMedio (falta o cheio) de sem custo nenhum"
  - "NaoClassificadoTrigger — Popover com os lançamentos crus do bloco não classificado, só informativo"
  - "Tooltip de double-count (operacional + financeiro) agora mostra o valor da linha em risco"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "gaps: cmvGate.data ?? null — mapeamento explícito de undefined (useQuery em loading) para null, preservando o fail-closed de resolveCloseGate"
    - "Popover tap-friendly (open state + onMouseEnter/onMouseLeave/onClick toggle + onOpenAutoFocus preventDefault) clonado de MLMcoStrip.tsx para as duas listas novas (C6/C8)"
    - "Tooltip com wrapper <span> ao redor de botão disabled — necessário porque disabled:pointer-events-none no botão bloquearia o hover do Tooltip"

key-files:
  created: []
  modified:
    - src/pages/MercadoLivre.tsx
    - src/components/mercadolivre/MLCostCard.tsx

key-decisions:
  - "shouldNudgeClose NÃO foi alinhado ao gate (decisão do plano, não desta execução) — o nudge 🟢 pode aparecer ao lado de um botão desabilitado; o tooltip do botão explica o porquê em vez de suprimir o nudge."
  - "O valor exibido no tooltip de double-count é o total da linha (b.total/financeiro.total) — a quebra 'quanto disso é billing ML' não está disponível em runtime (é achado manual do Wesley sobre a fatura), então o tooltip mostra o valor em risco, não a decomposição exata do CONTEXT."
  - "Listas C6/C8 usam Popover (tap-friendly), motivo do botão usa Tooltip (consistente com o padrão existente do arquivo para o nudge/double-count) — replicando a decisão já registrada na Phase 46."

patterns-established: []

requirements-completed: ["C6", "C7", "C8", "C9"]

# Metrics
duration: 25min
completed: 2026-07-15
status: complete
---

# Phase 96 Plan 06: C6/C7/C8/C9 Frontend — Gates e Alertas na UI Summary

**O botão "Marcar mês como apurado" agora bloqueia com motivo legível quando falta custo cheio ou guia paga (com defesa em profundidade no handler), o Wesley vê a lista exata dos 39 SKUs sem custo cheio e dos 3 lançamentos "Não classificado" via Popover tap-friendly, e o alerta de double-count passou a mostrar o valor em risco — sem que a cascata pare de somar o valor cheio (decisão do dono) ou que `resolveDreRegime` seja tocado (SC5 intacto, 18/18 verdes).**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2/2 completed
- **Files modified:** 2

## Accomplishments

- **[C6/C7] Gate combinado fiado no eixo certo:** `useCmvCheioGate` chamado com o mesmo par `billingMonthIsCurrentMonth ? monthlyFrom/To : billingMonthFrom/To` que já alimenta `dreWaterfall` — gate e CMV enxergam sempre o mesmo mês.
- **Armadilha do `undefined !== null` evitada com prova em código, não em promessa:** `resolveCloseGate({ gaps: cmvGate.data ?? null, guia: guiaReal.data ?? null })` — o `?? null` explícito é o que preserva o fail-closed durante o loading do `useQuery` (que devolveria `data: undefined`, não `null`, e desarmaria o bloqueio se esquecido).
- **`closeBlocked` só se aplica ao caminho de fechar:** `!monthClose.isClosed && closeGate.blocked` — um mês já fechado continua reabrível mesmo que o gate (recalculado sobre o mês fechado) apontasse bloqueio, evitando a porta-trancada-para-sempre (T-96-19).
- **Defesa em profundidade no handler:** `handleCloseDreMonth` faz early-return com `toast.error` listando `closeGate.reasons` antes de chamar `monthClose.close()` — o `disabled` do botão é só UX; esta é a segunda barreira (a RLS de `dre_month_close` continua sendo a única autoridade real, T-96-18 aceito).
- **[C6] A lista é o produto, não um ícone de 12px:** `CmvGapsTrigger` (Popover tap-friendly, padrão clonado de `MLMcoStrip`) mostra o total de receita afetada + os top 10 SKUs por receita, distinguindo `temCustoMedio` (`true` → "falta o custo cheio", os 35 que o backfill do 96-07 resolve; `false` → "sem custo nenhum — cadastrar no Tiny", os 4 da tarefa manual do Wesley).
- **[C8] Lista do não classificado, só informativa:** `NaoClassificadoTrigger` lista fornecedor/descrição/data/valor de cada lançamento cru; texto explícito "o sistema só informa — Wesley recategoriza no Tiny; nada é corrigido sozinho". Nenhum valor é alterado, subtraído ou escondido.
- **[C9] Double-count com número:** os dois tooltips de `doubleCountRisk` (bloco operacional e financeiro) passaram de um texto genérico para incluir `{fmt(total)}` da linha — e o texto reforça que o valor **continua somado**, e que a correção é na fonte (Tiny), nunca auto-netting.
- **Pitfall 10 resolvido no lugar certo (tooltip, não removendo o nudge):** quando `closeBlocked` é true, o botão desabilitado ganha um Tooltip listando `closeBlockReasons` — o 🟢 "Guias parecem lançadas" e o botão cinza desabilitado deixam de parecer contraditórios porque o motivo fica visível ao passar o mouse.
- **`resolveDreRegime` byte-a-byte intocado:** nenhuma linha do arquivo `dreRegime.ts` foi tocada nesta execução; a chamada `resolveDreRegime({...})` em `MercadoLivre.tsx` permanece idêntica (prova: `grep -c '^[+-].*resolveDreRegime({'` → 0). `dreRegime.test.ts` roda 18/18 verde.

## Task Commits

Each task was committed atomically:

1. **Task 1: [C6/C7/C8] MercadoLivre.tsx — fiar os gates e o early-return**
   - `436e20cb` (feat)
2. **Task 2: [C6/C7/C8/C9] MLCostCard — botão bloqueado com motivo, listas e alerta com valor**
   - `d3fa6f45` (feat)

## Files Created/Modified

- `src/pages/MercadoLivre.tsx` — imports de `useCmvCheioGate`, `useNaoClassificadoItems`, `resolveCloseGate`; `cmvGate` no mesmo eixo do `dreWaterfall`; `closeGate`/`closeBlocked` derivados; `naoClassificadoItemsQuery`; `handleCloseDreMonth` com early-return + `toast.error`; 4 props novas passadas ao `<MLCostCard>` (`closeBlocked`, `closeBlockReasons`, `cmvGaps`, `naoClassificadoItems`).
- `src/components/mercadolivre/MLCostCard.tsx` — 4 props novas na interface (`closeBlocked?`, `closeBlockReasons?`, `cmvGaps?`, `naoClassificadoItems?`); `fmtCents` (formatador com centavos para as listas); `CmvGapsTrigger` e `NaoClassificadoTrigger` (componentes Popover tap-friendly, módulo-scope); botão de fechar com `disabled` gate-aware + `Tooltip` de motivos; tooltip de double-count (2 ocorrências: operacional + financeiro) com valor da linha.

## Provas (não presumidas)

| Prova | Alvo | Resultado |
|---|---|---|
| Task 1 — `resolveCloseGate` / `useCmvCheioGate` / `useNaoClassificadoItems` (import+uso) | ≥2 cada | ✅ 3 / 2 / 2 |
| Task 1 — `dreRegime.ts` diff `resolveDreRegime` | 0 | ✅ 0 |
| Task 1 — `MercadoLivre.tsx` diff `resolveDreRegime({` | 0 | ✅ 0 |
| Task 1 — `npx vitest run src/lib/dreRegime.test.ts` | 18/18 | ✅ |
| Task 1 — `isClosed && closeGate.blocked` presente | ≥1 | ✅ 1 |
| Task 2 — `closeBlocked` / `closeBlockReasons` / `cmvGaps` / `temCustoMedio` / `naoClassificadoItems` / `Popover` | ≥3/≥2/≥2/≥1/≥2/≥2 | ✅ 5/4/4/1/4/16 |
| Task 2 — disabled só considera gate no fechar (regex `mesClosed .*closeBlocked\|...`) | ≥1 | ✅ 2 |
| `npx tsc --noEmit` (após cada task) | 0 erros | ✅ |
| `npx vitest run` (suíte completa, 2x) | baseline verde | ✅ 582/582 (43 arquivos) |
| `npm run build` (2x) | limpo | ✅ |
| `git diff main -- MercadoLivre.tsx \| grep -c 'mcoInput\|currentGrossProfit'` | 0 | ✅ 0 (MCO/GoalsCard intocados) |

## Decisions Made

- `shouldNudgeClose` não foi tocado nem alinhado ao gate — a contradição visual (nudge 🟢 aceso ao lado de botão bloqueado) é resolvida no tooltip do botão, não suprimindo o nudge (decisão já travada no plano, apenas executada).
- O valor mostrado no tooltip de double-count é o total agregado da linha (`b.total`/`financeiro.total`), não a decomposição "quanto é billing ML puro" que o CONTEXT registra como achado manual do Wesley sobre a fatura de maio — esse número não existe como dado estruturado em nenhuma RPC/hook consumível em runtime.
- Listas (C6/C8) usam `Popover` tap-friendly; o motivo do botão bloqueado usa `Tooltip` (consistente com o padrão já existente no arquivo para nudge/double-count) — replica a decisão da Phase 46 registrada no plano.

## Deviations from Plan

None de escopo/comportamento — plano executado exatamente como escrito, incluindo a armadilha do `gaps === null` vs `undefined` (mapeada explicitamente com `?? null` desde a primeira escrita do código, não como correção posterior).

## Issues Encountered

Nenhum. Ambiente sem execução paralela de outros planos nesta wave (Wave 3, serial).

## User Setup Required

None — sem configuração de serviço externo. As listas exibidas (C6/C8) dependem dos hooks `useCmvCheioGate`/`useNaoClassificadoItems` já aplicados em prod pelos planos 96-03/96-04.

## Next Phase Readiness

- Phase 96 fica com C6/C7/C8/C9/C11 fiados end-to-end (backend + frontend). Falta o backfill do custo cheio (96-07, mencionado no CONTEXT como escopo obrigatório da phase) para o gate liberar maio em produção — sem ele, o gate continuará bloqueando com a lista correta dos 39 SKUs, o que é o comportamento pretendido (nunca mascarar).
- Nenhum bloqueio conhecido para os próximos planos da fase.

---
*Phase: 96-dre-correcoes-linha-a-linha*
*Completed: 2026-07-15*

## Self-Check: PASSED
