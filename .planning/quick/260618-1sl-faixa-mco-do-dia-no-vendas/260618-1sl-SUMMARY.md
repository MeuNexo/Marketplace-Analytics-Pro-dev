---
phase: quick-260618-1sl
plan: "01"
subsystem: vendas-dashboard
tags: [mco, kpi-strip, glossary, pure-helper, tdd]
dependency_graph:
  requires: []
  provides: [MCO-STRIP-01]
  affects: [src/pages/MercadoLivre.tsx, src/lib/kpi-glossary.ts]
tech_stack:
  added: []
  patterns: [pure-helper, tdd-vitest, popover-hover-tap-pattern]
key_files:
  created:
    - src/lib/mco.ts
    - src/lib/mco.test.ts
    - src/components/mercadolivre/MLMcoStrip.tsx
  modified:
    - src/lib/kpi-glossary.ts
    - src/pages/MercadoLivre.tsx
decisions:
  - "computeMco é um helper puro (sem React) para máxima testabilidade — wiring fica exclusivamente em MercadoLivre.tsx"
  - "Fallback CMV/tax por % do waterfall mensal aplicado à receita do período — consistente com o DRE do MLCostCard"
  - "MLMcoStrip é um componente de apresentação puro (sem fetch, sem estado de cálculo) — recebe valores prontos via props"
  - "platformCost = kpiSummary.custo_plataforma (frete+comissão, exclui ads); ads via adsSummary.total_spend (exatamente uma vez)"
metrics:
  duration_minutes: 15
  completed_date: "2026-06-18"
  tasks_completed: 3
  files_count: 5
---

# Phase quick-260618-1sl Plan 01: Faixa MCO do Dia no /Vendas — Summary

**One-liner:** Faixa slim "MCO do dia/período" (R$ + %) entre ConsultorCard e MLKPIGrid, com helper puro testado, popover de glossário e fallback consistente com o DRE.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Helper puro computeMco + vitest + glossário | b4c5fa74 | src/lib/mco.ts, src/lib/mco.test.ts, src/lib/kpi-glossary.ts |
| 2 | Componente de apresentação MLMcoStrip | c8485c4f | src/components/mercadolivre/MLMcoStrip.tsx |
| 3 | Wiring em MercadoLivre.tsx | 4c02ced1 | src/pages/MercadoLivre.tsx |

## What Was Built

### src/lib/mco.ts
Helper puro `computeMco(McoInput): McoResult`. Recebe `{ grossRevenue, cmv, platformCost, ads, tax }` e retorna `{ mco, pct }`. Sem React, sem imports de runtime — 100% testável isoladamente. Comentário documenta a separação ads/platformCost e reconciliação com o MLCostCard.

### src/lib/mco.test.ts
Suíte vitest (4 casos): cálculo correto de R$ e %, sinal negativo quando custos > receita, receita=0 retorna pct=null sem NaN, ads contabilizado exatamente uma vez (diff = N, nunca 2N).

### src/lib/kpi-glossary.ts
Adicionado `"mco"` ao union type `GlossaryKey` e entrada `KPI_GLOSSARY.mco` com `term: "MCO"`, definição em linguagem leiga e `example: "Receita − CMV − Custo Operacional − Impostos = MCO"`.

### src/components/mercadolivre/MLMcoStrip.tsx
Componente de apresentação puro (named export `MLMcoStrip`). Faixa slim de largura total com layout `flex items-center gap-2 flex-wrap text-sm`. Conteúdo: `● label · R$ X · Y% · (i)`. Marcador `●` e `%` em `text-kpi-positive`/`text-kpi-negative` por sinal; demais textos neutros. Estado `empty`/`pct=null` exibe `—` sem NaN. Estado `loading` exibe skeleton `animate-pulse`. Popover `(i)` com padrão exato do KPICard (hover+tap, `onMouseEnter/Leave`, `onClick stopPropagation`, `aria-label`). Exibe `KPI_GLOSSARY.mco.definition` + `.example` como texto plano (sem `dangerouslySetInnerHTML`).

### src/pages/MercadoLivre.tsx
Imports: `MLMcoStrip` e `computeMco`. Three `useMemo` blocks:
1. `mcoInput`: monta o input do MCO a partir de `kpiSummary` (gross_revenue, custo_plataforma sem ads, cmv/tax com fallback por % mensal via `monthlyCostWaterfall`) e `adsSummary.total_spend` (ads uma vez).
2. `{ mco: mcoValue, pct: mcoPct }`: aplica `computeMco(mcoInput)`.
3. `mcoLabel`: detecta "hoje" via `filters.singleDayRange ?? (currentFrom === currentTo && currentTo === todayUTC())`.
Render: `<MLMcoStrip>` inserida exatamente entre `ConsultorCard` e `widgets.map(...)` com gate `{connected && ...}`. `MLKPIGrid` e suas props permanecem inalterados.

## Verification Results

- `npx vitest run src/lib/mco.test.ts`: 4/4 testes passando
- `npx tsc --noEmit`: 0 erros
- `npm run build`: build de produção concluído sem erro (warning de chunk size é pré-existente, não introduzido por esta mudança)
- Inspeção estrutural: `<MLMcoStrip` aparece 1x no render (+ 1x no import); `kpi_grid` block inalterado
- Anti-duplicação de ads: `platformCost = kpiSummary.custo_plataforma` (sem ads) + `ads = adsSummary.total_spend` (1x)

## Deviations from Plan

None — plano executado exatamente conforme especificado.

## Known Stubs

None — todos os valores da faixa são derivados de dados reais já disponíveis na página (kpiSummary, adsSummary, monthlyCostWaterfall).

## Threat Flags

None — nenhuma nova fronteira de confiança introduzida. A faixa re-exibe agregados financeiros já exibidos em outros cards do /vendas sob a mesma RLS org-first. Todo texto renderizado como texto plano via JSX (sem dangerouslySetInnerHTML).

## Self-Check

- [x] src/lib/mco.ts existe
- [x] src/lib/mco.test.ts existe (4 testes verdes)
- [x] src/components/mercadolivre/MLMcoStrip.tsx existe
- [x] src/lib/kpi-glossary.ts contém "mco" no GlossaryKey e KPI_GLOSSARY.mco
- [x] src/pages/MercadoLivre.tsx contém MLMcoStrip entre ConsultorCard e widgets.map
- [x] Commits b4c5fa74, c8485c4f, 4c02ced1 existem no git log

## Self-Check: PASSED
