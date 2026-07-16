---
phase: 99-dre-caixa-apura-o-por-recebimento-mercado-pago-p-gina-dedica
plan: 02
subsystem: financeiro
tags: [react, tanstack-query, supabase, vitest, tdd, dre, caixa]

# Dependency graph
requires:
  - phase: 99-01
    provides: "RPCs get_dre_cash / get_dre_cash_items / get_dre_cash_history (contrato de linhas travado no 99-CONTEXT/spec)"
provides:
  - "Lib pura src/lib/dreCashCascade.ts (cascata de caixa + badge-resposta + previsão de imposto null-safe)"
  - "4 hooks TanStack Query: useDreCash, useDreCashItems (drill-down lazy), useDreCashHistory, useCashFreshness (frescor duplo inflows/outflows)"
affects: [99-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Módulo 100% puro (zero React/Supabase) para cascata financeira testável — espelho de src/lib/dreCascade.ts (Phase 88)"
    - "Guardrail de particionamento por secao/bloco NA ENTRADA da função pura, antes de qualquer soma"
    - "Frescor de fonte dupla exposto separadamente (nunca combinado) para não mascarar staleness de uma fonte pela outra"

key-files:
  created:
    - src/lib/dreCashCascade.ts
    - src/lib/dreCashCascade.test.ts
    - src/hooks/useDreCash.ts
    - src/hooks/useDreCashItems.ts
    - src/hooks/useDreCashHistory.ts
    - src/hooks/useCashFreshness.ts
  modified: []

key-decisions:
  - "DESVIO_ALERT_PCT = 20 (limiar de alerta previsão x guia paga) — deixado a critério de Claude pelo CONTEXT, documentado em JSDoc"
  - "Badge com resultadoCaixa === 0 (movimento houve, mas fechou em zero) tratado como neutral 'Sem movimentação no mês' — caso não coberto pelos 8 comportamentos do plano, decisão local por analogia ao mês vazio"
  - "computePrevisaoDesvio trata previsto <= 0 (não só === 0) como null-safe — mais defensivo que o texto literal do plano ('previsto 0 ou null'), sem alterar nenhum dos casos testados"

patterns-established:
  - "Pattern espelhado: toda lib de cascata financeira nova (dreCascade.ts, dreCashCascade.ts) recebe linhas cruas + particiona por seção/bloco na entrada, nunca soma direto de rows não-filtradas"

requirements-completed: [DREC-04, DREC-05, DREC-06]

# Metrics
duration: 8min
completed: 2026-07-16
status: complete
---

# Phase 99 Plan 02: Camada Frontend não-visual da DRE Caixa Summary

**Lib pura `dreCashCascade.ts` (cascata de caixa + badge-resposta + previsão de imposto null-safe, 12 testes vitest) e 4 hooks TanStack Query (`useDreCash`, `useDreCashItems`, `useDreCashHistory`, `useCashFreshness`) isolando a página 99-03 do contrato das 3 RPCs do plano 99-01.**

## Performance

- **Duration:** ~8 min (22:45 → 22:53 UTC)
- **Tasks:** 2
- **Files modified:** 6 (todos novos)

## Accomplishments
- `buildDreCashCascade` monta a cascata completa (entradas informativas → 6 blocos de saída sempre presentes → resultado operacional → financeiro → resultado de caixa) com guardrail provado por teste: seções `entrada`/`previsao` e bloco `excluido` nunca contaminam a soma de saídas.
- Badge-resposta com os 3 tons LOCKED (`positive`/`negative`/`neutral`) e os textos exatos do CONTEXT ("As entradas do mês pagaram as contas — sobrou R$ X" / "Faltou R$ X — esse dinheiro saiu de outro lugar" / "Sem movimentação no mês").
- `computePrevisaoDesvio` null-safe (previsto ausente ou <= 0 → desvioPct null, sem falso-alarme) com limiar de alerta 20% exportado como constante.
- 4 hooks no padrão TanStack Query do projeto: 3 clonam `useDreOperational.ts` (RPC + org escopo + `p_month` "YYYY-MM-01"); o 4º (`useCashFreshness`) faz 2 leituras RLS diretas em paralelo (padrão `useMLLastSync.ts`) para expor frescor de `cash_inflows`/`cash_outflows` separadamente.
- Drill-down (`useDreCashItems`) só dispara sob clique (`enabled: !!bloco`) — nenhuma query desnecessária.
- Zero acoplamento com Fluxo de Caixa (`get_cashflow`/`get_treasury_panel`/`financial_settings`/`initial_balance`) e zero modificação em arquivos da DRE de faturamento — confirmado por grep e `git diff --name-only`.

## Task Commits

Cada task foi commitada atomicamente:

1. **Task 1: Lib pura dreCashCascade.ts (RED)** - `46162110` (test) — 12 testes vitest cobrindo os 8 comportamentos do plano + guardrail extra
2. **Task 1: Lib pura dreCashCascade.ts (GREEN)** - `a8c6686f` (feat) — implementação completa, 12/12 testes verdes
3. **Task 2: Hooks useDreCash/Items/History/Freshness** - `5883b17f` (feat)

**Plan metadata:** (a ser gerado pelo commit final de documentação)

_Nota: Task 1 é TDD (`tdd="true"`) — 2 commits (test → feat), sem etapa de refactor necessária._

## Files Created/Modified
- `src/lib/dreCashCascade.ts` - Lib pura: tipos `DreCashRow`/`DreCashBadge`/`DreCashPrevisao`/`DreCashCascade`, `buildDreCashCascade`, `computePrevisaoDesvio`, `SAIDA_BLOCOS`, `DESVIO_ALERT_PCT`
- `src/lib/dreCashCascade.test.ts` - 12 testes vitest (guardrail, matemática, badge x3, mês vazio, previsão null, desvio x3, nao_classificado gate x2, blocos sempre presentes)
- `src/hooks/useDreCash.ts` - Hook RPC `get_dre_cash`, retorna `DreCashRow[]` normalizado
- `src/hooks/useDreCashItems.ts` - Hook RPC `get_dre_cash_items`, drill-down lazy (`enabled` com bloco)
- `src/hooks/useDreCashHistory.ts` - Hook RPC `get_dre_cash_history`, série de até 12 meses
- `src/hooks/useCashFreshness.ts` - Hook de frescor duplo `cash_inflows`/`cash_outflows` via 2 leituras RLS diretas paralelas

## Decisions Made
- `DESVIO_ALERT_PCT = 20` (Claude's Discretion do CONTEXT) — documentado em JSDoc de 1 linha na constante.
- Badge para `resultadoCaixa === 0` com movimento (caso de borda não coberto pelos 8 testes do plano): tratado como `neutral` "Sem movimentação no mês", por analogia ao caso de mês vazio — nenhum teste explícito cobre esse ramo, mas o comportamento é determinístico e documentado inline no código.
- `computePrevisaoDesvio` usa `previsto <= 0` (não só `=== 0`) como guarda — mais defensivo contra previsto negativo hipotético, sem alterar nenhum dos 4 casos testados no plano.

## Deviations from Plan

None - plano executado exatamente como escrito. Os 6 arquivos, exports e comportamentos batem 1:1 com o `must_haves` e `acceptance_criteria` do plano.

## Issues Encountered
None.

## User Setup Required
None - nenhuma configuração de serviço externo necessária. Este plano é 100% frontend não-visual (lib pura + hooks); depende das 3 RPCs do plano 99-01 já estarem aplicadas em produção antes do 99-03 (página) consumir os hooks com dados reais.

## Next Phase Readiness
- 99-03 (página `MLDreCaixa.tsx` + rota + wiring) pode consumir `buildDreCashCascade` e os 4 hooks diretamente, sem conhecer o contrato bruto das RPCs.
- Nenhum bloqueio: `npx tsc --noEmit` limpo, `npx vitest run src/lib/dreCashCascade.test.ts` 12/12 verde, nenhum arquivo da DRE de faturamento ou do Fluxo de Caixa tocado.

---
*Phase: 99-dre-caixa-apura-o-por-recebimento-mercado-pago-p-gina-dedica*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 6 created files verified present on disk (dreCashCascade.ts/.test.ts, useDreCash.ts, useDreCashItems.ts, useDreCashHistory.ts, useCashFreshness.ts). All 3 task commits (46162110 test-RED, a8c6686f feat-GREEN, 5883b17f feat hooks) verified present in git log.
