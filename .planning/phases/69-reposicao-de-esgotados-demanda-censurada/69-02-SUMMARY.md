---
phase: 69-reposicao-de-esgotados-demanda-censurada
plan: "02"
subsystem: frontend-compras
tags: [esgotados, demanda-censurada, tdd, ui, replenishment]
status: complete

dependency_graph:
  requires: ["69-01"]
  provides: ["UI-esgotados", "espelho-TS-classificacao", "badge-demanda-estimada"]
  affects: ["src/lib/analysis/replenishmentUtils", "src/hooks/useReplenishmentBySku", "src/components/mercadolivre/ReplenishmentSkuTable", "src/components/mercadolivre/ReplenishmentSkuFilters", "src/pages/mercadolivre/MLCompras"]

tech_stack:
  added:
    - "StatusEsgotado (type TS) — espelho da classificação RPC"
    - "classifyStatusEsgotado, estimateBestRate, isDemandaEstimada — helpers puros"
    - "VendaDiaOrigem estendido com 'historico_esgotado'"
  patterns:
    - "TDD RED→GREEN: teste falhou primeiro (22 novos), depois implementação (85/85 verde)"
    - "Badge derivado de venda_dia_origem='historico_esgotado' da RPC (fonte de verdade, não heurística client-side)"
    - "FilterStatus union estendida sem quebrar casos existentes"

key_files:
  created: []
  modified:
    - "src/lib/analysis/replenishmentUtils.ts — StatusEsgotado, constantes, 3 funções puras, VendaDiaOrigem+='historico_esgotado'"
    - "src/lib/analysis/replenishmentUtils.test.ts — 22 novos testes (classifyStatusEsgotado/estimateBestRate/isDemandaEstimada)"
    - "src/integrations/supabase/types.ts — p_smart?: boolean em Args; status_esgotado: string em Returns"
    - "src/hooks/useReplenishmentBySku.ts — status_esgotado: StatusEsgotado em ReplenishmentSkuRow + mapRow"
    - "src/components/mercadolivre/ReplenishmentSkuTable.tsx — AcaoCell e MasterAcaoCell com 3 estados esgotados + badge"
    - "src/components/mercadolivre/ReplenishmentSkuFilters.tsx — FilterStatus + 3 SelectItem novos"
    - "src/pages/mercadolivre/MLCompras.tsx — applyFilters + statusCounts + regroupRows fix"

decisions:
  - "Badge 'demanda estimada pelo histórico' derivado de isDemandaEstimada(venda_dia_origem) para garantir fonte-de-verdade na RPC (T-69-05)"
  - "MasterAcaoCell agrega status_esgotado com prioridade repor > revisar > descontinuar > lógica de giro normal"
  - "AcaoCell classifica esgotados ANTES da lógica com_giro (break-first pattern, evita interferência)"
  - "regroupRows em MLCompras.tsx corrigido para incluir total_a_caminho (bug pré-existente de mismatch com GroupedReplenishmentRow)"

metrics:
  duration_minutes: 36
  completed_date: "2026-06-27"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 7
  tests_added: 22
  tests_total: 278
---

# Phase 69 Plan 02: Esgotados Frontend (Demanda Censurada) Summary

Espelho TS puro da classificação por recência + estimativa de taxa histórica para SKUs esgotados; exposição na tela /compras dos 3 estados novos na coluna "O que fazer", badge que distingue demanda estimada de real, e 3 opções novas no filtro Situação — sem regressão das Phases 62–68.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| RED  | Testes falhando (TDD) | b3ac86c9 | replenishmentUtils.test.ts |
| GREEN (Task 1) | Espelho TS classificação + estimativa | 28788aca | replenishmentUtils.ts |
| Task 2 | status_esgotado em types.ts e hook | 4304e2ed | types.ts, useReplenishmentBySku.ts |
| Task 3 | UI — 3 estados, badge, filtro | 3ee8f52e | ReplenishmentSkuTable.tsx, ReplenishmentSkuFilters.tsx, MLCompras.tsx |

## Verification Results

- `npx tsc --noEmit`: **0 errors**
- `npx vitest run` (suite completa): **278/278 passed** (22 novos + 256 existentes)
- `npm run build`: **built in 16.90s** (sem erros/warnings)

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED — test(`69-02`) | b3ac86c9 | PASS — 22 testes falharam, 63 existentes passaram |
| GREEN — feat(`69-02`) | 28788aca | PASS — 85/85 verde |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] regroupRows em MLCompras.tsx não incluía total_a_caminho**
- **Found during:** Task 3 — ao popular GroupedReplenishmentRow no regroup da página
- **Issue:** MLCompras.tsx tinha sua própria `regroupRows` que não populava `total_a_caminho`, causando TypeError pois `GroupedReplenishmentRow.total_a_caminho` é um campo obrigatório (definido pelo hook)
- **Fix:** Adicionado `total_a_caminho: row.qtd_a_caminho` na criação inicial e `existing.total_a_caminho += row.qtd_a_caminho` na agregação
- **Files modified:** `src/pages/mercadolivre/MLCompras.tsx`
- **Commit:** 3ee8f52e

## Known Stubs

Nenhum stub identificado. Todos os campos são derivados de dados reais da RPC (status_esgotado, venda_dia_origem, venda_dia) via mapRow com fallback seguro.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-69-05 mitigado | ReplenishmentSkuTable.tsx | Badge "demanda estimada pelo histórico" derivado exclusivamente de `venda_dia_origem === 'historico_esgotado'` da RPC (fonte de verdade); não calculado client-side. isDemandaEstimada() é o ponto central de decisão. |

## Self-Check

- [x] Todos os arquivos modificados existem no sistema de arquivos
- [x] 4 commits existem no histórico: b3ac86c9, 28788aca, 4304e2ed, 3ee8f52e
- [x] StatusEsgotado exportado de replenishmentUtils.ts
- [x] VendaDiaOrigem inclui 'historico_esgotado'
- [x] status_esgotado em types.ts (Returns) e p_smart em Args
- [x] status_esgotado em ReplenishmentSkuRow com mapRow + fallback 'com_giro'
- [x] AcaoCell classifica esgotados antes da lógica com_giro
- [x] Badge "estoque zerado · demanda estimada pelo histórico" com venda/dia estimada
- [x] MasterAcaoCell com estado agregado (repor > revisar > descontinuar)
- [x] FilterStatus estendido com 3 novos valores
- [x] applyFilters trata os 3 novos valores
- [x] Nenhuma função existente teve assinatura alterada
- [x] tsc 0 erros, vitest 278/278, build ok

## Self-Check: PASSED
