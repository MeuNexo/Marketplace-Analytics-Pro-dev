---
phase: 50-simulador-de-cenarios-de-caixa-e-se
plan: 01
subsystem: ui
tags: [cashflow, simulation, vitest, tdd, pure-module, typescript]

# Dependency graph
requires:
  - phase: 49-fluxo-de-caixa
    provides: "RPC get_cashflow + hook useCashFlowData expondo CashFlowDataPoint (fullDate, accumulated_balance_sma) usado como baseline"
provides:
  - "Módulo puro src/lib/cashflowSimulation.ts com simulateCashflow(base, params) → { series, verdict }"
  - "Tipos SimEvent / SimParams / SimPoint / SimVerdict / SimBasePoint exportados para os planos 50-02 e 50-03"
  - "Suíte vitest cobrindo os 6 casos do spec §8"
affects: [50-02, 50-03, CashFlowSimulator, SimulatorVerdictCard, CashFlowChart]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Núcleo matemático isolado em módulo puro (sem React/Supabase) testável via vitest"
    - "Comparação de datas yyyy-MM-dd lexicográfica == cronológica para eventos pontuais"

key-files:
  created:
    - src/lib/cashflowSimulation.ts
    - src/lib/cashflowSimulation.test.ts
  modified: []

key-decisions:
  - "Import type-only de CashFlowDataPoint (erased em compile-time) mantém o módulo puro mesmo reusando o tipo do hook"
  - "Baseline vazio retorna série vazia + veredito neutro (não lança) — edge §7"

patterns-established:
  - "simulateCashflow é a única fonte da regra SIM-01; componentes React apenas chamam e renderizam"

requirements-completed: [SIM-01]

# Metrics
duration: 5min
completed: 2026-06-19
---

# Phase 50 Plan 01: Módulo puro de simulação de fluxo de caixa Summary

**Função pura `simulateCashflow` que projeta a série simulada ponto a ponto (deltas de média + eventos pontuais sobre `accumulated_balance_sma`) e emite o veredito Saudável/Risco com folga/necessidade no dia do vale — construída via TDD, 6/6 testes verdes e `tsc --noEmit` limpo.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-19T01:42:00Z
- **Completed:** 2026-06-19T01:43:30Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2 (ambos criados)

## Accomplishments
- Contrato de tipos do simulador definido e exportado (`SimEvent`, `SimParams`, `SimPoint`, `SimVerdict`, `SimBasePoint`).
- `simulateCashflow` implementada exatamente conforme a matemática do spec §5 (LOCKED no CONTEXT.md): `deltaMediaAcum`, `eventosAcum`, `cenario`, veredito por argmin do vale.
- Edge case de baseline vazio tratado sem lançar (§7).
- Suíte vitest determinística (baseline de 10 pontos, vale no índice 4) cobrindo os 6 casos do spec §8.

## Task Commits

Cada task foi commitada atomicamente:

1. **Task 1: Contrato de tipos + testes RED** - `084be1f6` (test)
2. **Task 2: Implementar simulateCashflow (GREEN)** - `444a731b` (feat)

_Sem refactor adicional: a implementação inicial já espelha o spec §5 e está limpa._

## Files Created/Modified
- `src/lib/cashflowSimulation.ts` - Função pura `simulateCashflow` + tipos do simulador. Núcleo da regra SIM-01.
- `src/lib/cashflowSimulation.test.ts` - 6 testes vitest (sem-simulação, gasto→risco, recebimento→folga, evento saída/entrada na data, vale/argmin).

## Decisions Made
- **Import type-only de `CashFlowDataPoint`**: reusa o tipo do hook `useCashFlowData` sem acoplar React/Supabase ao módulo (apagado em compile-time → `grep -E "react|supabase"` vazio).
- **Baseline vazio → veredito neutro**: segue edge §7, evita exceção e divisão por zero (`diasAteVale >= 1` sempre).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## TDD Gate Compliance
- RED gate: commit `084be1f6` (`test(...)`) com os 6 testes falhando (stub lança).
- GREEN gate: commit `444a731b` (`feat(...)`) — 6/6 testes passam.
- REFACTOR: não necessário (implementação já mínima e aderente ao spec).

## User Setup Required
None - módulo puro frontend, sem configuração externa, sem backend.

## Next Phase Readiness
- `simulateCashflow` e seus tipos prontos para serem consumidos pelos planos 50-02 (`CashFlowSimulator` / `SimulatorVerdictCard`) e a extensão de `CashFlowChart`.
- Verificação: `npx vitest run src/lib/cashflowSimulation.test.ts` → 6/6; `npx tsc --noEmit` limpo; módulo puro (sem react/supabase).

## Self-Check: PASSED

- FOUND: src/lib/cashflowSimulation.ts
- FOUND: src/lib/cashflowSimulation.test.ts
- FOUND: .planning/phases/50-simulador-de-cenarios-de-caixa-e-se/50-01-SUMMARY.md
- FOUND commit 084be1f6 (test RED)
- FOUND commit 444a731b (feat GREEN)
- `npx vitest run src/lib/cashflowSimulation.test.ts` → 6/6 passam
- `npx tsc --noEmit` limpo
- `grep -E "react|supabase" src/lib/cashflowSimulation.ts` → vazio (módulo puro)

---
*Phase: 50-simulador-de-cenarios-de-caixa-e-se*
*Completed: 2026-06-19*
