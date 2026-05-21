---
phase: 16
plan: "01"
subsystem: dashboard-vendas
tags: [kpi, markup, custo-operacional, mercadolivre, react-query]
dependency_graph:
  requires: [orders table, ml_ads_daily_cache]
  provides: [useMLKPISummary hook, MLKPIGrid 7 cards]
  affects: [MercadoLivre dashboard page]
tech_stack:
  added: []
  patterns: [TanStack React Query v5, direct Supabase client query]
key_files:
  created:
    - src/hooks/useMLKPISummary.ts
  modified:
    - src/components/mercadolivre/MLKPIGrid.tsx
    - src/pages/MercadoLivre.tsx
decisions:
  - custo_operacional calculado no frontend somando custo_plataforma (DB) + ads_total (prop)
  - markup_ratio retorna null quando nenhum produto tem custo_unit cadastrado
  - grid expandido de 5 para 7 colunas no breakpoint lg
metrics:
  duration: "~15min"
  completed: "2026-05-21"
  tasks_completed: 3
  files_modified: 3
---

# Phase 16 Plan 01: KPI Cards Markup e Custo Operacional — Summary

**One-liner:** Hook `useMLKPISummary` consultando `public.orders` para markup (receita/custo) e custo operacional (frete + comissao + ads) exibidos em 2 novos KPI cards no Dashboard de Vendas.

## O que foi implementado

### Hook `useMLKPISummary`
- Localização: `src/hooks/useMLKPISummary.ts`
- Exporta interface `MLKPISummary` e função `useMLKPISummary(from, to, ads_total)`
- Query direta em `public.orders` filtrando por `organization_id`, `ml_user_id[]`, e `data_pedido` (range)
- Campos consultados: `receita_bruta`, `custo_unit`, `quantidade`, `frete`, `comissao`
- Cache: `staleTime: 5 * 60 * 1000` (5 minutos)
- `queryKey`: `["ml", "kpi-summary", orgId, resolvedMLUserIds, from, to]`

### MLKPIGrid.tsx
- Grid expandido de `lg:grid-cols-5` para `lg:grid-cols-7`
- 2 novos cards adicionados:
  1. **Markup das Vendas** (ícone TrendingUp, cor emerald): exibe `markup_ratio` em formato `X.XXx`, ou `"s/ custo"` quando nenhum produto tem custo cadastrado
  2. **Custo Operacional** (ícone Wallet, cor orange): exibe valor em BRL com subtitle `X.X% da receita`
- Novas props opcionais: `kpiSummary`, `kpiSummaryLoading`, `adsTotalForPeriod`
- Tooltip descritivo em ambos os cards

### MercadoLivre.tsx
- Import de `useMLKPISummary` adicionado
- Hook instanciado após `useMLOrders` usando `currentFrom`, `currentTo`, `adsSummary.total_spend`
- Props `kpiSummary`, `kpiSummaryLoading`, `adsTotalForPeriod` passadas para `<MLKPIGrid>`

## Fórmulas usadas

| KPI | Fórmula |
|---|---|
| `markup_ratio` | `sum(receita_bruta) / sum(custo_unit * quantidade)` — null se nenhum custo cadastrado |
| `custo_plataforma` | `sum(frete) + sum(comissao)` |
| `custo_operacional` | `custo_plataforma + ads_total` (ads vem via prop do adsSummary já calculado) |
| `pct_custo_operacional` | `round(custo_operacional / gross_revenue * 10000) / 100` |

## Status da verificação TypeScript

Zero erros nos arquivos criados/modificados neste plano.

Erros pré-existentes em `MLPedidos.tsx` (2 erros — fora do escopo deste plano):
- `TS2352`: conversão de tipo em linha 721
- `TS2345`: argumento de tipo em linha 769

## Commits

| Task | Hash | Descrição |
|---|---|---|
| Task 1 | `8a251cb7` | feat(16-01): add useMLKPISummary hook |
| Task 2 | `1810909d` | feat(16-01): add Markup das Vendas and Custo Operacional KPI cards |
| Task 3 | `176f5c80` | feat(16-01): wire useMLKPISummary into MercadoLivre page |

## Deviations from Plan

None — plano executado exatamente conforme especificado.

## Known Stubs

None — os cards exibem `"—"` quando `kpiSummary` é null (loading ou sem dados), comportamento intencional e correto.

## Self-Check: PASSED

- `src/hooks/useMLKPISummary.ts` — FOUND
- `src/components/mercadolivre/MLKPIGrid.tsx` — FOUND (modificado)
- `src/pages/MercadoLivre.tsx` — FOUND (modificado)
- Commits `8a251cb7`, `1810909d`, `176f5c80` — FOUND
