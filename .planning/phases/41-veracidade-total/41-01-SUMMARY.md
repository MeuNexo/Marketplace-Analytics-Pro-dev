---
phase: 41-veracidade-total
plan: "01"
subsystem: frontend-verification
tags: [data-02, data-03, auto-recalc, lucro-bruto, waterfall]
dependency_graph:
  requires: [fc090c46]
  provides: [DATA-02-verified, DATA-03-verified]
  affects: [src/pages/MercadoLivre.tsx, src/hooks/useAutoRecalc.ts, src/hooks/useMLCostWaterfall.ts, src/components/mercadolivre/GoalsCard.tsx, src/pages/mercadolivre/MLPedidos.tsx]
tech_stack:
  added: []
  patterns: [useAutoRecalc-hook, waterfall-single-source, auto-sync-hoje]
key_files:
  created: []
  modified: []
decisions:
  - "DATA-02 e DATA-03 já estavam 100% implementados no codebase — nenhuma edição de src/ foi necessária"
  - "useAutoRecalc cobre Caso 1 (null + inclui hoje → sync+recalc) e Caso 2 (sem CMV/impostos → recalc) com firedRef"
  - "useMLCostWaterfall expõe total_tax e has_tax_data; retorna null quando paid_revenue=0 (comportamento correto)"
  - "GoalsCard usa grossProfitRevenue={monthlyCostWaterfall?.paid_revenue ?? 0} como denominador de grossProfitPct"
  - "MLPedidos auto-sync: loadOrders retorna Promise<number>; quando count===0 e dateTo>=hoje invoca sync-ml-orders"
  - "rangeSyncedRef removido (0 ocorrências em MercadoLivre.tsx)"
metrics:
  duration: "~10min"
  completed: "2026-06-12"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 0
---

# Phase 41 Plan 01: Veracidade Total — Verificação DATA-02/03 Summary

**One-liner:** Verificação end-to-end de DATA-02 (auto-recalc silencioso Hoje) e DATA-03 (Lucro Bruto mensal via useMLCostWaterfall fonte única) — todos os artefatos já estavam corretos, zero edições de src/. DATA-01/02/03 confirmados visualmente por Wesley.

## Checkpoint: APROVADO (Wesley, 2026-06-12)

Verificação visual em /vendas confirmada nos 3 itens:

1. **DATA-01** — Card "Custos" exibe CMV e Impostos com valores em R$ (backend via fc090c46)
2. **DATA-02** — Filtro "Hoje" carrega KPI cards via skeleton/auto-recalc silencioso
3. **DATA-03** — Lucro Bruto % consistente entre GoalsCard e MLCostCard, sem inflação por cancelados

## O Que Foi Feito

Verificação sistemática de todos os acceptance criteria do plano contra o código atual (Phases 21/31/32/38 já executadas em sessões anteriores). Nenhuma lacuna encontrada — plano executado como no-op de src/ com documentação.

## Resultados por Critério

| Critério | Status | Evidência |
|----------|--------|-----------|
| `useAutoRecalc` em MercadoLivre.tsx (período + mensal) | OK | linhas 188-189 |
| `isRecalcing` alimenta kpiSummaryLoading | OK | linha 563: `kpiSummaryLoading \|\| isRecalcing` |
| `useMLCostWaterfall` expõe `total_tax` e `has_tax_data` | OK | retorno do hook linha 20-24 |
| `monthlyCostWaterfall` como fonte de `currentGrossProfit` | OK | linhas 170-182 |
| `GoalsCard` recebe `grossProfitRevenue={monthlyCostWaterfall?.paid_revenue ?? 0}` | OK | linha 585 |
| `MLPedidos.loadOrders` retorna `Promise<number>` | OK | linha 690 |
| Auto-sync quando count===0 e dateTo>=hoje | OK | linhas 757-769 |
| `rangeSyncedRef` ausente em MercadoLivre.tsx | OK | 0 ocorrências |
| `npx tsc --noEmit` exit code 0 | OK | sem output = sem erros |

## Deviations from Plan

None - plan executed exactly as written. Todos os artefatos já estavam implementados corretamente pelas Phases 21, 31, 32 e 38. Task 2 foi no-op (nenhum arquivo src/ alterado, nenhum commit de código necessário).

## Known Stubs

Nenhum stub encontrado nos artefatos deste plano.

## Threat Flags

Nenhuma superfície nova de segurança introduzida (zero mudanças de código).

## Self-Check: PASSED

- [x] `src/hooks/useAutoRecalc.ts` — existe, implementa Caso 1 e Caso 2 com firedRef
- [x] `src/hooks/useMLCostWaterfall.ts` — expõe `has_tax_data` e `total_tax`
- [x] `src/pages/MercadoLivre.tsx` — wiring de `useAutoRecalc` (linha 188-189) + `grossProfitRevenue` (linha 585)
- [x] `src/pages/mercadolivre/MLPedidos.tsx` — auto-sync linhas 757-769
- [x] `src/components/mercadolivre/GoalsCard.tsx` — prop `grossProfitRevenue` usada em `grossProfitPct`
- [x] `npx tsc --noEmit` — código 0
- [x] Nenhuma migration criada (DATA-01 backend já aplicado via fc090c46)
