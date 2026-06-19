---
phase: 50-simulador-de-cenarios-de-caixa-e-se
plan: 03
subsystem: financial / fluxo-de-caixa
tags: [simulador, cashflow, tabs, shadcn, frontend]
requires:
  - "src/lib/cashflowSimulation.ts (simulateCashflow + tipos) — Wave 1"
  - "src/components/financial/CashFlowChart.tsx (prop simulatedSeries) — Wave 2"
  - "src/components/financial/SimulatorVerdictCard.tsx — Wave 2"
  - "src/hooks/useCashFlowData.ts + src/hooks/useFinancialSettings.ts — Phase 49"
provides:
  - "src/components/financial/CashFlowSimulator.tsx (aba Simulador)"
  - "MLFluxoCaixa com Tabs Caixa Real | Simulador"
affects:
  - "src/pages/mercadolivre/MLFluxoCaixa.tsx"
tech-stack:
  added: []
  patterns:
    - "Estado de sessão via useState (sem persistência)"
    - "Calendar dentro de Popover (mode=single) com disabled range para date picker"
    - "Tabs shadcn para segmentar conteúdo de página sem duplicar dados"
key-files:
  created:
    - src/components/financial/CashFlowSimulator.tsx
  modified:
    - src/pages/mercadolivre/MLFluxoCaixa.tsx
decisions:
  - "Layout grid lg:grid-cols-[340px_1fr]: controles à esquerda (desktop) / topo (mobile), resultado à direita"
  - "date picker = Calendar(mode=single) em Popover, disabled fora de [hoje, hoje+120]"
  - "simulatedSeries só é passado ao chart quando verdict.ativa (sem simulação → gráfico idêntico ao Caixa Real)"
  - "novo evento default: valor 0, data = hoje, tipo saida"
metrics:
  completed: 2026-06-19
  tasks_completed: 2
  tasks_total: 3
  files_created: 1
  files_modified: 1
---

# Phase 50 Plan 03: Simulador (Tabs + CashFlowSimulator) Summary

Aba "Simulador" plugada na página /fluxo-de-caixa: `Tabs` shadcn ("Caixa Real" intocada | "Simulador"), com `CashFlowSimulator` detendo o estado de sessão (2 sliders de média + até 2 eventos pontuais + Limpar), chamando `simulateCashflow` (Wave 1) e alimentando `CashFlowChart` (3ª linha azul) + `SimulatorVerdictCard` (Wave 2). Cálculo 100% frontend, sem persistência.

## What Was Built

### Task 1 — `CashFlowSimulator.tsx` (commit dbe9c538)
- Estado de sessão (`useState`): `recebExtra` (0), `gastoExtra` (0), `eventos: SimEvent[]` (`[]`). Recarregar → volta ao real (sem persistência, LOCKED).
- Baseline via `useCashFlowData(hoje, hoje+120)` (mesmo horizonte de MLFluxoCaixa) + margem via `useFinancialSettings()` (`safety_margin ?? 10000`).
- `{ series, verdict } = simulateCashflow(baseline ?? [], { recebExtra, gastoExtra, eventos, margem })`, memoizado por baseline/params/margem.
- **Sliders (ranges/steps LOCKED no CONTEXT.md):**
  - Recebimento extra/dia: −5000…+5000, step 100, default 0; label com `formatCurrency`.
  - Gasto extra/dia: 0…+10000, step 100, default 0.
- **Eventos pontuais (0 a 2):** subcomponente `EventoRow` com input de valor (R$), date picker (`Calendar` mode=single dentro de `Popover`, `disabled` fora de `[hoje, hoje+120]`), toggle entrada/saída (`Switch`), lixeira p/ remover. Botão "+ Adicionar evento" some quando `eventos.length === 2`.
- Botão "Limpar" zera os 2 sliders e a lista de eventos.
- **Edge §7:** baseline carregando → skeleton e controles desabilitados; baseline vazio → aviso e controles desabilitados. `simulatedSeries` só passa ao chart quando `verdict.ativa`.
- Layout responsivo `grid lg:grid-cols-[340px_1fr]`; cores via `hsl(var(--token))` (regra CLAUDE.md); formatação via `@/lib/formatters`.

### Task 2 — `MLFluxoCaixa.tsx` com Tabs (commit 394ac5fa)
- `Tabs defaultValue="real"` logo abaixo do header sticky (que permanece fora das Tabs).
- `TabsContent value="real"`: bloco atual MOVIDO sem alteração de conteúdo/comportamento (3 cards + botão "Ajustar saldo" owner-only + gráfico/`CashFlowEmptyState`). Aba Real intocada (validada com a planilha DFC do Wesley).
- `TabsContent value="simulador"`: renderiza `<CashFlowSimulator />`.
- `AdjustBalanceDialog` mantido fora das Tabs. Sem duplicação da chamada de `useCashFlowData` da aba Real (o simulador tem a sua própria).

## Verification

- `npx tsc --noEmit` → limpo (0 erros).
- `npm run build` → ✓ built in 15.23s.
- `npx vitest run` → 97/97 passing (inclui 6 testes de `cashflowSimulation` da Wave 1) — nenhuma regressão.
- grep links: `simulateCashflow`, `simulatedSeries`, `SimulatorVerdictCard` presentes em CashFlowSimulator; `Tabs` e `CashFlowSimulator` presentes em MLFluxoCaixa.

## Deviations from Plan

None — tasks de código executadas exatamente como escritas.

## Checkpoint Pendente (não executado por design)

Task 3 (`checkpoint:human-verify` — aprovação visual do Wesley no preview Vercel) NÃO foi executada: o orquestrador trata o deploy de preview e a validação visual após o código pronto. O código está completo, tsc/build/testes limpos, pronto para o checkpoint visual.

## Known Stubs

Nenhum. Todos os controles estão ligados ao baseline real (`useCashFlowData`) e à margem real (`useFinancialSettings`).

## Self-Check: PASSED
- FOUND: src/components/financial/CashFlowSimulator.tsx
- FOUND: src/pages/mercadolivre/MLFluxoCaixa.tsx (modificado)
- FOUND commit: dbe9c538
- FOUND commit: 394ac5fa
