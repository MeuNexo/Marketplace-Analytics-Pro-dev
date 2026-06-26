---
phase: 63-compras-reposi-o-por-sku-p-gina-pr-pria
plan: "05"
subsystem: ui/ux
tags: [replenishment, ux, leigo, tooltips, presentation]
status: complete

dependency_graph:
  requires: ["63-03"]
  provides: ["CMP-05", "CMP-06", "CMP-08"]
  affects: ["/compras page", "ReplenishmentSkuTable", "ReplenishmentParamsDialog"]

tech_stack:
  added: []
  patterns:
    - shadcn/ui Tooltip (TooltipProvider/Tooltip/TooltipTrigger/TooltipContent) na tabela
    - HelpCircle + SlidersHorizontal de lucide-react
    - useMemo statusCounts para mini-resumo sem nova query

key_files:
  modified:
    - src/components/mercadolivre/ReplenishmentSkuTable.tsx
    - src/components/mercadolivre/ReplenishmentParamsDialog.tsx
    - src/pages/mercadolivre/MLCompras.tsx
    - src/components/mercadolivre/ReplenishmentSkuFilters.tsx
  created: []

decisions:
  - "Emojis Unicode diretamente no JSX para os 4 estados de ação (sem dependência extra)"
  - "ParamsTooltip usa button sem type-submit para não interferir com forms na página"
  - "statusCounts computa sobre filteredRows (flat), não sobre filteredGrouped — contagem por variação/SKU unitário conforme spec"
  - "Mini-resumo inserido dentro do CardHeader (div separado abaixo do CardTitle), acima dos filtros"
  - "Sem modo simples/avançado (YAGNI confirmado)"

metrics:
  duration: "~25min"
  completed: "2026-06-26"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 4
---

# Phase 63 Plan 05: UX Clareza Leigos — Summary

**One-liner:** Camada de apresentação de /compras traduzida para PT leigo — 8 colunas com tooltips explicativos, coluna "O que fazer" com 4 estados visuais, regras como tooltip discreto, dialog "Regras de Compra" com ajuda inline, e mini-resumo de status acima da tabela.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | ReplenishmentSkuTable — 8 colunas leigo, tooltips, AcaoCell, ParamsTooltip | cc864e3f | ReplenishmentSkuTable.tsx |
| 2 | ReplenishmentParamsDialog — rótulos leigos + ajuda inline + exemplos | 7f10531b | ReplenishmentParamsDialog.tsx |
| 3 | MLCompras mini-resumo + filtros leigos + xlsx headers | 4f160a0a | MLCompras.tsx, ReplenishmentSkuFilters.tsx |

## Must-Haves Status

| Must-Have | Status |
|-----------|--------|
| Cabeçalhos leigos (Produto/Estoque/Vende por dia/Dura quanto/Comprar/Custo estimado) com ícone HelpCircle + tooltip | PASS |
| Coluna "O que fazer" com 4 estados (Comprar N/Estoque ok/Sem vendas/Falta custo) | PASS |
| Parâmetros brutos removidos como coluna; ícone SlidersHorizontal por linha | PASS |
| Dialog "Regras de Compra" com rótulos leigos + ajuda + exemplo por campo | PASS |
| Mini-resumo acima da tabela (parComprar/ok/semGiro) via useMemo | PASS |
| Filtro "Situação" com "Precisa comprar"/"Sem vendas"; xlsx com headers leigos | PASS |
| vitest passa (208 testes), tsc --noEmit zero erros, build verde | PASS |
| hook useReplenishmentBySku, RPC, replenishmentUtils, CompraRecomendadaPanel intocados | PASS |

## Verification Results

- `npx tsc --noEmit`: 0 erros
- `npx vitest run`: 208 tests passed (17 test files)
- `npm run build`: sucesso em 26.29s, 0 warnings de TypeScript
- Prohibitions: `git diff --name-only 44a2e8d4..HEAD` lista somente os 4 arquivos de apresentação (+STATE.md de commit de planejamento anterior)

## Deviations from Plan

None — plano executado exatamente como escrito.

Decisões de design tomadas (não cobertas no plano):
1. **Emojis Unicode inline**: plan não especificou como renderizar os emojis nos estados. Optou-se por caracteres Unicode diretamente no JSX (ex: `🔴 Comprar N`) — sem dependência de biblioteca.
2. **button sem type**: O botão do ParamsTooltip recebeu `type="button"` para evitar submit acidental quando dentro de forms.
3. **Mini-resumo estrutura**: Inserido em `<div>` próprio dentro do CardHeader, abaixo do wrapper do CardTitle — mantém layout flex sem quebrar responsividade.

## Self-Check: PASSED

- FOUND: ReplenishmentSkuTable.tsx
- FOUND: ReplenishmentParamsDialog.tsx
- FOUND: MLCompras.tsx
- FOUND: ReplenishmentSkuFilters.tsx
- FOUND: commit cc864e3f (Task 1)
- FOUND: commit 7f10531b (Task 2)
- FOUND: commit 4f160a0a (Task 3)
