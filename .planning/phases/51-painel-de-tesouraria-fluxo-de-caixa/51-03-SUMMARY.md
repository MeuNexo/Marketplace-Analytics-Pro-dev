---
phase: 51-painel-de-tesouraria-fluxo-de-caixa
plan: "03"
subsystem: financial/treasury-ui
tags: [treasury, kpi, recharts, cashflow, ui]
dependency_graph:
  requires: ["51-01", "51-02"]
  provides: [TreasuryPanel, CostCompositionChart, SupplierExposureChart]
  affects: [MLFluxoCaixa]
tech_stack:
  added: []
  patterns: [recharts-stacked-bar, recharts-grouped-bar, kpi-band-grid, pivot-long-wide]
key_files:
  created:
    - src/components/financial/TreasuryPanel.tsx
    - src/components/financial/CostCompositionChart.tsx
    - src/components/financial/SupplierExposureChart.tsx
  modified:
    - src/pages/mercadolivre/MLFluxoCaixa.tsx
decisions:
  - "D-08 Burn Rate: mantido como média mensal (3m) — NÃO janela 30d para evitar duplicidade com Saída Real. Ponto confirmado com Wesley via pre-authorization."
  - "D-01: TodayBalanceCard/ProjectedBalanceCard/CapacityCard removidos da página (arquivos em disco intocados)"
  - "Categorias de custo tratadas dinamicamente — sem hardcode; backfill enriquece sozinho"
metrics:
  duration: "~25min"
  completed: "2026-06-19"
  tasks_completed: 4
  files_changed: 4
requirements: [TESO-01, TESO-02, TESO-05]
---

# Phase 51 Plan 03: Treasury Panel UI Summary

**One-liner:** Painel de Tesouraria com 12 KPIs em 3 faixas (Saúde/Realizado/Exposição) + 2 gráficos Recharts (empilhado por categoria, agrupado por fornecedor) — aba Caixa Real reconfigurada; Simulador e CashFlowChart preservados.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | TreasuryPanel — 12 KPIs em 3 faixas (TESO-01) | 84066bdd | src/components/financial/TreasuryPanel.tsx |
| 2 | CostCompositionChart + SupplierExposureChart (TESO-02) | c2dcc334 | src/components/financial/CostCompositionChart.tsx, SupplierExposureChart.tsx |
| 3 | Wiring em MLFluxoCaixa (TESO-05) | fb94b60c | src/pages/mercadolivre/MLFluxoCaixa.tsx |
| 4 | Checkpoint visual (pre-authorized by Wesley 2026-06-19) | — | approved |

## What Was Built

### TreasuryPanel.tsx
Container dos 12 KPIs em 3 faixas rotuladas:

- **Faixa 1 — Saúde de Caixa** (header amber): Saldo Atual (`useProjectedBalance(90).current_balance`, verde/vermelho), Runway em meses (`current_balance / burn_rate`, guard div/0, neutro), Saldo Mín 90d (`projected.min_balance`, vermelho se < alert_threshold; subtítulo = data do mínimo via `treasury.min_balance_date`), Alerta (AlertTriangle + "Saldo abaixo de R$X em DD/MM/AAAA" quando `alert_date != null`, borda destructive).
- **Faixa 2 — Realizado (30d)** (header blue): Entrada Real (`treasury.entrada_real_30d`, kpi-positive), Saída Real (kpi-negative), Resultado (entrada−saída, condicional), Burn Rate (kpi-neutral, subtítulo "média mensal (3m)").
- **Faixa 3 — Exposição a Fornecedor** (header orange): Fornec ≤30d / ≤60d / ≤90d / Total Exposição (todos kpi-negative).

Helpers: `currFmt` (pt-BR/BRL), `dateFmt` (ISO → DD/MM/AAAA). Loading skeleton 3×4. Consome `useTreasuryPanel()` + `useProjectedBalance(90)` + `useFinancialSettings()`.

### CostCompositionChart.tsx
BarChart empilhado Recharts. Consome `useCostByMonth(9)`. Pivot long→wide via `useMemo` (agrupar por mês, set `row[category]=total`). Mapa `CATEGORY_COLORS` com 9 categorias + "Outros" (`#94a3b8` fallback). `<Bar stackId="stack">` por categoria dinâmica; radius `[3,3,0,0]` apenas na última. XAxis = mês formatado (Abr/26 etc.), YAxis em R$k. Empty state quando sem dados.

### SupplierExposureChart.tsx
BarChart agrupado Recharts. Consome `useSupplierExposure(10)`. 3 `<Bar>` sem stackId: amount_30d (≤ 30d #3b82f6), amount_60d (≤ 60d #f59e0b), amount_90d (≤ 90d #ef4444). Helper `truncate(s, 12)` no XAxis. Legend + Tooltip com currFmt. Empty state quando sem dados.

### MLFluxoCaixa.tsx (cirúrgico)
- REMOVIDOS: imports + JSX de `TodayBalanceCard`, `ProjectedBalanceCard`, `CapacityCard`
- ADICIONADOS: imports de `TreasuryPanel`, `CostCompositionChart`, `SupplierExposureChart`
- SUBSTITUÍDO: `<div className="grid grid-cols-1 md:grid-cols-3 gap-4">` com 3 cards → `<TreasuryPanel />`
- ADICIONADO: grid `lg:grid-cols-2` com `<CostCompositionChart />` + `<SupplierExposureChart />` abaixo do bloco CashFlowChart
- PRESERVADOS: `CashFlowChart` (D-11), `CashFlowSimulator` (D-TESO-05), `AdjustBalanceDialog`, botão "Ajustar saldo de hoje", header sticky

## Verification

- `npx tsc --noEmit`: CLEAN (zero erros)
- `npm run build`: PASS (✓ built in 22.85s)
- Zero referências a TodayBalanceCard/ProjectedBalanceCard/CapacityCard em MLFluxoCaixa.tsx
- TreasuryPanel + CostCompositionChart + SupplierExposureChart presentes na aba Caixa Real
- CashFlowChart e CashFlowSimulator grep: FOUND
- Aprovação visual: pre-authorized by Wesley (2026-06-19)

## Decisions Made

1. **Burn Rate = média mensal (3m)** — mantido deliberadamente distinto da "Saída Real" (30d) para evitar KPI duplicado. Subtítulo "média mensal (3m)" deixa explícito no painel. Confirmado via pre-authorization Wesley.
2. **Categorias dinâmicas no CostCompositionChart** — sem hardcode da lista; `allCategories` derivada do Set dos dados da RPC. Backfill de categorias enriquece o gráfico automaticamente.
3. **Cards antigos não deletados do disco** — apenas removidos da página (D-01). Arquivos `TodayBalanceCard.tsx`, `ProjectedBalanceCard.tsx`, `CapacityCard.tsx` permanecem em `src/components/financial/` para referência futura.

## Deviations from Plan

None — plan executed exactly as written. Task 4 (checkpoint) pre-authorized by Wesley (2026-06-19 explicit authorization in orchestrator prompt).

## Known Stubs

None. Todos os 12 KPIs consomem dados reais via RPCs (`get_treasury_panel`, `get_projected_balance_summary`) e hooks Wave 2. Os gráficos podem mostrar poucos dados inicialmente enquanto o backfill de categorias roda em background — comportamento esperado e documentado no PLAN.

## Threat Flags

None. Todos os componentes UI consomem hooks que usam RPCs SECURITY INVOKER com RLS org-first. Nenhum org_id passado manualmente pela UI. CashFlowSimulator e CashFlowChart preservados sem modificação (T-51-08 mitigado pela edição cirúrgica verificada via grep).

## Self-Check: PASSED

- [x] `src/components/financial/TreasuryPanel.tsx` exists (284 lines)
- [x] `src/components/financial/CostCompositionChart.tsx` exists (142 lines)
- [x] `src/components/financial/SupplierExposureChart.tsx` exists (104 lines)
- [x] `src/pages/mercadolivre/MLFluxoCaixa.tsx` modified (wired)
- [x] Commits 84066bdd, c2dcc334, fb94b60c exist in git log
- [x] `npx tsc --noEmit` clean
- [x] `npm run build` passes
