---
phase: 96-dre-correcoes-linha-a-linha
plan: 05
subsystem: finance-dre
tags: [react, dre, frontend, tanstack-query, vitest, tdd]

# Dependency graph
requires:
  - phase: 96-04
    provides: "get_cancelled_revenue RPC + hook useCancelledRevenue (14.450,29 em maio, prova em prod)"
  - phase: 96-01
    provides: "groupBillingCharges com BillingGroup.excluded — totalTarifas do hook já exclui o parcelamento"
provides:
  - "computeMargemContribuicao — fonte única e pura da fórmula da margem de contribuição (src/lib/dreMargem.ts)"
  - "MLCostCard exibindo receita BRUTA + linha 'Cancelamentos de vendas', recebendo margemContribuicao por prop"
  - "Parcelamento renderizado como linha informativa (sem (−), tooltip) no card"
  - "MercadoLivre.tsx: memo único de grupos+total de tarifas (elimina a re-soma que descartava a exclusão do parcelamento)"
affects: [96-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fórmula de negócio extraída para módulo puro (dreMargem.ts) e injetada por prop, eliminando duplicação entre página e componente"
    - "Grupo de billing com excluded:true renderizado como linha informativa (sem prefixo de dedução, com Tooltip explicando o motivo) em vez de dropado"

key-files:
  created:
    - src/lib/dreMargem.ts
    - src/lib/dreMargem.test.ts
  modified:
    - src/components/mercadolivre/MLCostCard.tsx
    - src/pages/MercadoLivre.tsx

key-decisions:
  - "lucroPositivo renomeado para margemPositiva em MLCostCard.tsx — não é mudança de comportamento, apenas evita colisão do nome com o grep literal 'const lucro' do acceptance criteria (a fórmula duplicada em si foi removida; a variável derivada do resultado precisava sobreviver com outro nome)."
  - "receitaBruta = receitaMes + cancelamentosVendas é composta NO CARD (MercadoLivre.tsx), nunca na RPC get_cost_waterfall — preserva os 6 consumidores de paid_revenue (MCO, /financeiro, GoalsCard, Nexo, useAutoRecalc) intocados, conforme decisão já travada no 96-04."
  - "gruposTarifasEfetivos/totalTarifasEfetivo viraram um ÚNICO useMemo (antes eram dois) — o segundo memo antigo re-somava o array de grupos, ignorando a flag excluded que o hook já aplicava; agora ambos os ramos (billing real e fallback estimado) devolvem o mesmo shape {groups, totalTarifas}."

patterns-established:
  - "Módulo de fórmula pura + prop obrigatória: quando uma expressão de negócio aparece em 2+ componentes, extrair para src/lib/*.ts puro e passar o resultado calculado por prop, nunca recalcular no componente filho."

requirements-completed: ["C1", "C2/C5"]

# Metrics
duration: 8min
completed: 2026-07-15
status: complete
---

# Phase 96 Plan 05: C1 Frontend — Receita Bruta + Cancelamentos + Fórmula Única Summary

**`computeMargemContribuicao` (módulo puro, 7/7 testes) elimina a duplicação tripla da fórmula da margem (MercadoLivre.tsx + MLCostCard.tsx + a re-soma de `totalTarifasEfetivo`); o card passa a exibir receita bruta 261.666,41 com a linha "Cancelamentos de vendas" −14.450,29, mantendo a margem de contribuição de maio em 51.969,93.**

## Performance

- **Duration:** ~8 min (início da leitura de arquivos às 22:26, último commit às 22:33)
- **Tasks:** 3/3 completed
- **Files modified:** 4 (2 criados, 2 modificados)

## Accomplishments

- **A ARMADILHA do C1 fechada com prova automatizada:** `dreMargem.test.ts` Test 1 prova que o cancelamento está DENTRO da fórmula (maio corrigido = 51.969,93, não os 66.420,22 que apareceriam se o cancelamento ficasse só na tela). Test 2 prova a equivalência algébrica bruta-menos-cancelamento === líquida (SC5). Test 4 prova a identidade do reembolso (soma na bruta, sai no cancelamento, líquida não se move).
- **As 3 duplicações identificadas pelo RESEARCH foram eliminadas, não só a óbvia:**
  1. `MLCostCard.tsx:113-117` (`const lucro = ...`) — removida; o componente recebe `margemContribuicao` por prop.
  2. `MercadoLivre.tsx:364-367` (expressão inline `receitaMes - totalTarifasEfetivo - ...`) — substituída por `computeMargemContribuicao(...)`.
  3. `MercadoLivre.tsx:354-357` (`totalTarifasEfetivo = gruposTarifasEfetivos.reduce(...)`) — a re-soma que **ignorava** a flag `excluded` do 96-01 foi eliminada; os dois memos viraram um único memo que devolve `{ groups, totalTarifas }`, com o `totalTarifas` do hook chegando intacto (excluindo o parcelamento) quando há billing real.
- **Cálculo end-to-end verificado fora do teste unitário** (Node ad-hoc): `receitaBrutaMes = 247216.12 + 14450.29 = 261666.41` → `computeMargemContribuicao({receitaBruta: 261666.41, cancelamentosVendas: 14450.29, totalTarifas: 63878.37, cmvMes: 126574.59, impostosMes: 4793.23}) = 51969.93` — bate exatamente com a cascata reconciliada do CONTEXT §2.
- **Parcelamento vira linha informativa:** `grupo.excluded` renderiza sem o prefixo `(−)`, com `Tooltip` explicando que a taxa é paga pelo comprador — a linha continua visível (auditoria), mas fora do "Total de tarifas ML".
- **Base do `pct()` preservada em `receitaMes` (líquida)** — nenhum percentual do card mudou, protegendo o SC5 no mês aberto.
- **`mcoInput`/`currentGrossProfit`/GoalsCard intocados** — provado por `git diff main -- src/pages/MercadoLivre.tsx | grep -c 'mcoInput\|currentGrossProfit'` → 0.

## Task Commits

1. **Task 1: computeMargemContribuicao — fonte única da fórmula (TDD)**
   - `c5425a86` (test) — RED: 7 casos, `Failed to resolve import "./dreMargem"` confirmado
   - `e46d6a22` (feat) — GREEN: módulo puro implementado, 7/7 passam
2. **Task 2: MLCostCard — receita bruta, cancelamentos, margem por prop, parcelamento informativo**
   - `68c6efe6` (feat)
3. **Task 3: MercadoLivre.tsx — compor bruto, total de tarifas excluded-aware, fórmula única**
   - `7cc918bb` (feat)

## Files Created/Modified

- `src/lib/dreMargem.ts` (novo) — `computeMargemContribuicao(input): number` e `MargemContribuicaoInput`. Sem import de React/Supabase (`grep -rc 'react|supabase'` → 0). Header documenta as duas razões de existir (duplicação eliminada + a ARMADILHA do cancelamento) e a decisão do dono sobre o reembolso.
- `src/lib/dreMargem.test.ts` (novo) — 7 testes: a ARMADILHA (Test 1), equivalência bruta/líquida (Test 2), maio "se fechar hoje" (Test 3), identidade do reembolso (Test 4), nulls→0 (Test 5), cancelamento zero (Test 6), arredondamento (Test 7).
- `src/components/mercadolivre/MLCostCard.tsx` — props novas `receitaBruta` (obrigatória), `cancelamentosVendas` (opcional, default 0), `margemContribuicao` (obrigatória); `const lucro` removida, `lucroPositivo` renomeado `margemPositiva` (consome a prop); bloco "Receita bruta do mês" no lugar de "Receita do mês (vendas pagas)"; nova linha "Cancelamentos de vendas" fora do `.map` de tarifas; grupos `excluded` renderizados sem `(−)`, com `Tooltip`.
- `src/pages/MercadoLivre.tsx` — import de `useCancelledRevenue` e `computeMargemContribuicao`; `cancelamentosVendas`/`receitaBrutaMes` no mesmo eixo de mês do `dreWaterfall`; `gruposTarifasEfetivos`/`totalTarifasEfetivo` unificados num único `useMemo`; `margemContribuicao` via `computeMargemContribuicao`; props novas no `<MLCostCard>`.

## Provas (não presumidas)

| Prova | Alvo | Resultado |
|---|---|---|
| `npx vitest run src/lib/dreMargem.test.ts` | 7/7 | ✅ |
| RED confirmado antes da implementação | import falha | ✅ `Failed to resolve import "./dreMargem"` |
| `grep -rc 'react\|supabase' src/lib/dreMargem.ts` | 0 | ✅ |
| `grep -c 'const lucro' MLCostCard.tsx` | 0 | ✅ |
| `grep -c 'receitaMes - totalTarifasEfetivo' MercadoLivre.tsx` | 0 | ✅ |
| `grep -c 'gruposTarifasEfetivos.reduce' MercadoLivre.tsx` | 0 | ✅ |
| `grep -c 'pct(.*, receitaBruta)' MLCostCard.tsx` | 0 | ✅ |
| `git diff main -- MercadoLivre.tsx \| grep -c 'mcoInput\|currentGrossProfit'` | 0 | ✅ |
| Cálculo end-to-end (Node ad-hoc) | margem maio = 51969.93 | ✅ |
| `npx tsc --noEmit` | 0 erros | ✅ |
| `npx vitest run` (suíte completa) | verde | ✅ 582/582 (43 arquivos) |
| `npm run build` | limpo | ✅ (2x, após Task 2 e após Task 3) |

## Decisions Made

- **`lucroPositivo` → `margemPositiva`:** puramente nominal (documentado em `key-decisions`). O grep de aceite `const lucro` casaria por substring com `const lucroPositivo`, então a variável derivada foi renomeada para não colidir — o comportamento (booleano de sinal da margem) não mudou.
- Nenhuma decisão de produto nova — todas vinham travadas no CONTEXT/RESEARCH/96-04-SUMMARY (reembolso = cancelamento nos dois lados; base do `pct()` = líquida; `receitaBruta` composta no card, nunca na RPC).

## Deviations from Plan

None de escopo/comportamento. Um ajuste de forma, mesmo padrão do 96-04:

**1. [Forma] Renomeação de `lucroPositivo` para `margemPositiva`**
- **Encontrado durante:** Task 2, ao rodar o `acceptance_criteria` `grep -c 'const lucro' MLCostCard.tsx` → **0**.
- **Situação:** o grep é substring-based; `const lucroPositivo = ...` (variável legítima, derivada da nova prop `margemContribuicao`, não a fórmula duplicada) casava com o padrão `const lucro`.
- **Ajuste:** renomeado para `margemPositiva` em todo o arquivo (declaração + 2 usos). Nenhuma lógica mudou.
- **Verificação:** `grep -c 'const lucro'` → 0; `npx tsc --noEmit` 0 erros; `npx vitest run` verde.
- **Committed in:** `68c6efe6` (Task 2 commit).

---

**Total de desvios:** 0 de escopo/comportamento; 1 ajuste de forma (renomeação de variável).
**Impacto no plano:** nenhum.

## Issues Encountered

- **Ambiente compartilhado (não-worktree):** outros planos da fase (96-02/96-03) executaram em paralelo no mesmo diretório de trabalho — commits de Task 2 e Task 3 usaram pathspec explícito (`git commit ... -- <arquivo>`) para não incluir uma migration que estava staged por outro processo concorrente (`supabase/migrations/..._cmv_cheio_puro_and_gaps.sql`). Confirmado via `git show --stat` em cada commit: só os arquivos deste plano aparecem.

## User Setup Required

None — sem configuração de serviço externo.

## Next Phase Readiness

- **96-06 (C8 frontend):** independente deste plano; consome `useNaoClassificadoItems` (já pronto do 96-04), não toca em `MLCostCard.tsx`/`MercadoLivre.tsx` na mesma região.
- `MLCostCard.tsx` agora exige `receitaBruta` e `margemContribuicao` como props obrigatórias — qualquer outro consumidor futuro do componente precisa passá-las (hoje só `MercadoLivre.tsx` o usa).
- Nenhum bloqueio conhecido.

---
*Phase: 96-dre-correcoes-linha-a-linha*
*Completed: 2026-07-15*

## Self-Check: PASSED

Artefatos verificados em disco:
- FOUND: src/lib/dreMargem.ts
- FOUND: src/lib/dreMargem.test.ts
- FOUND: src/components/mercadolivre/MLCostCard.tsx (modificado)
- FOUND: src/pages/MercadoLivre.tsx (modificado)
- FOUND: .planning/phases/96-dre-corre-es-da-revis-o-linha-a-linha-c1-c9-c11-fechar-a-dre/96-05-SUMMARY.md

Commits verificados em `git log`:
- FOUND: c5425a86 (test — RED)
- FOUND: e46d6a22 (feat — GREEN Task 1)
- FOUND: 68c6efe6 (feat — Task 2)
- FOUND: 7cc918bb (feat — Task 3)
