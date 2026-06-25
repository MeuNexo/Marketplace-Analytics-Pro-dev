---
phase: 62-reposicao-server-side
plan: 02
subsystem: analysis
tags: [typescript, vitest, pure-module, replenishment, formula, tdd, reposicao]

# Dependency graph
requires:
  - phase: 62-reposicao-server-side
    plan: 01
    provides: "RPC get_replenishment com fórmula travada (ponto de reposição, gatilho, MOQ/pack, custo nulo, sem giro)"
provides:
  - "replenishmentUtils.ts — módulo TS puro testável em isolamento"
  - "replenishmentUtils.test.ts — suite vitest com 10 testes, 8 casos do PLAN cobertos"
affects: [62-03, ReplenishmentPanel, useReplenishment, REPL-04, REPL-05, REPL-06, REPL-07, REPL-08, REPL-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Módulo puro (zero deps externas) espelhando fórmula SQL da RPC — fonte-de-verdade testável offline"
    - "TDD RED/GREEN: test commit antes da implementação; 2 commits separados"
    - "resolveParams com precedência marca>global>hardcoded espelhando CTE params da RPC"
    - "T-62-06 guardrail packMultiple<1→1 (espelha NULLIF(pack,0) SQL)"

key-files:
  created:
    - src/lib/analysis/replenishmentUtils.ts
    - src/lib/analysis/replenishmentUtils.test.ts
  modified: []

key-decisions:
  - "TDD RED/GREEN: test file commitado antes da implementação para garantir que os testes testam algo real"
  - "resolveParams recebe brand como parâmetro informativo (documentação da intent), sem uso em lógica"
  - "REPLENISHMENT_DEFAULTS exportado como const para reuso nos testes e na UI futura"
  - "packMultiple guardrail (Math.max(1, pack)) no calcReplenishment espelha NULLIF da RPC (T-62-06)"

# Metrics
duration: 2min
completed: 2026-06-25
status: complete
---

# Phase 62 Plan 02: replenishmentUtils — Módulo TS Puro + Testes Vitest

**Módulo TS puro `replenishmentUtils.ts` + suite vitest de 10 testes (8 casos do PLAN) verdes; fórmula de ponto de reposição espelhando a RPC `get_replenishment` (Phase 62-01), testável em isolamento.**

## Performance

- **Duration:** ~2 min (TDD RED → GREEN, 2 tasks)
- **Started:** 2026-06-25T20:50:27Z
- **Completed:** 2026-06-25T20:52:41Z
- **Tasks:** 2 (Task 1 TDD + Task 2 verificação)
- **Files modified:** 2 criados (replenishmentUtils.ts + .test.ts)

## Accomplishments

- **`replenishmentUtils.ts`** (176 linhas): interface `ReplenishmentParams`, const `REPLENISHMENT_DEFAULTS` (30/60/7/1/1), `calcReplenishment` (fórmula travada: ponto, gatilho, alvo, necessidade, MOQ+pack, custo nulo, sem-giro), `resolveParams` (precedência marca > global > defaults). Zero imports de supabase/React.
- **`replenishmentUtils.test.ts`** (138 linhas): 10 `it()` blocks em 2 `describe` groups (`calcReplenishment` + `resolveParams`). Cobre os 8 casos do PLAN (normal, estoque>ponto, sem-giro, MOQ, pack, custo-nulo, override-marca, fallback-sem-global) + 2 casos bônus.
- **Fórmula idêntica à RPC**: ponto = vendaDia×(lead+safety); alvo = vendaDia×(meta+safety); compra = GREATEST(CEIL(nec/pack)×pack, moq); guardrail pack<1→1; custo nulo → custoAusente=true.
- **Zero regressão**: 203/203 testes passam no vitest run completo; compraUtils.ts e compraUtils.test.ts intocados.
- **TDD RED/GREEN**: commit `test(62-02)` (f071a2cb) antes do commit `feat(62-02)` (fa4642de).

## Task Commits

1. **Task 1 RED — test file (failing):** `f071a2cb` — `test(62-02): add failing tests for calcReplenishment and resolveParams`
2. **Task 1 GREEN — implementation:** `fa4642de` — `feat(62-02): implement replenishmentUtils pure TS module`
3. **Task 2:** Nenhum commit novo — test file já commitado no RED phase; verificação de suite completa executada (203/203).

## Files Created/Modified

- `src/lib/analysis/replenishmentUtils.ts` — Módulo puro: ReplenishmentParams, REPLENISHMENT_DEFAULTS, calcReplenishment, resolveParams
- `src/lib/analysis/replenishmentUtils.test.ts` — Suite vitest: 10 testes em 2 describe blocks

## Acceptance Criteria Verification

| Critério | Resultado |
|----------|-----------|
| `grep -c "export function calcReplenishment" replenishmentUtils.ts` | 1 ✓ |
| `grep -c "export function resolveParams" replenishmentUtils.ts` | 1 ✓ |
| `grep -cE "import .*(supabase\|react)" replenishmentUtils.ts` | 0 ✓ |
| `npx tsc --noEmit` | EXIT 0 (sem novos erros) ✓ |
| `npx vitest run replenishmentUtils.test.ts` | 10/10 PASS ✓ |
| `grep -c "it(" replenishmentUtils.test.ts` | 10 (>= 8) ✓ |
| `npx vitest run` (suite completa) | 203/203 PASS ✓ |
| compraUtils.ts / compraUtils.test.ts intocados | git diff vazio ✓ |

## Decisions Made

- **TDD RED antes de GREEN:** test file commitado como `test(62-02)` antes da implementação para garantir que os testes testam algo real e não são escritos retroativamente.
- **`resolveParams` recebe `brand: string | null`:** parâmetro informativo — documenta que a function é chamada "para a marca X", sem influenciar a lógica (marcaRow já vem resolvido pelo caller).
- **`REPLENISHMENT_DEFAULTS` exportado:** permite reutilização nos testes (sem duplicar 30/60/7/1/1) e pela UI futura.
- **Guardrail `Math.max(1, packMultiple)`:** espelha `NULLIF(pack_multiple, 0)` da RPC (T-62-06); previne divisão por zero mesmo que a tabela não tenha o CHECK constraint aplicado.

## Deviations from Plan

None — plano executado exatamente como escrito. Task 2 não precisou de commit separado porque o test file já foi criado e commitado durante a fase RED da Task 1 (TDD flow padrão).

## Known Stubs

None — módulo puro com aritmética determinística; sem placeholders ou dados mock.

## Threat Flags

None — módulo de cálculo puro sem I/O, rede, auth ou dados externos. Superfície de ataque: zero.

## Self-Check: PASSED

- `src/lib/analysis/replenishmentUtils.ts` — FOUND
- `src/lib/analysis/replenishmentUtils.test.ts` — FOUND
- Commit f071a2cb — FOUND
- Commit fa4642de — FOUND
- 203/203 tests pass — VERIFIED

---
*Phase: 62-reposicao-server-side*
*Completed: 2026-06-25*
