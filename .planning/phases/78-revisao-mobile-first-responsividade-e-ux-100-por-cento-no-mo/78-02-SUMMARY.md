---
phase: 78-revisao-mobile-first-responsividade-e-ux-100-por-cento-no-mo
plan: "02"
subsystem: mobile-responsividade
tags: [mobile, responsive, dual-layout, ux]
dependency_graph:
  requires: [78-01]
  provides: [paginas-publicidade-financeiro-vendas-mobile-ok]
  affects: [MLPublicidade, MLFinanceiro, MLProdutosVendidos, PrecoPraticadoReport, MercadoLivre]
tech_stack:
  added: []
  patterns: [dual-layout isMobile ternário, flex-wrap gap-x gap-y, cards mobile vs table desktop]
key_files:
  created: []
  modified:
    - src/pages/mercadolivre/MLPublicidade.tsx
    - src/pages/mercadolivre/MLFinanceiro.tsx
    - src/pages/mercadolivre/MLProdutosVendidos.tsx
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
    - src/pages/MercadoLivre.tsx
decisions:
  - "A-10 sem mudança: KPI grid já usa grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 — KPICard compact trata truncamento adequadamente"
  - "A-09 ação mínima: title= adicionado (aria-label já existia); texto permanece hidden sm:inline por design intencional de economia de espaço"
  - "Dual-layout mantém ramo desktop intacto (mesmas colunas/dados/ordem); zero mudança de cálculo/fetch"
metrics:
  duration: "~6 minutos"
  completed_date: "2026-07-02"
  tasks: 3
  files: 5
status: complete
---

# Phase 78 Plan 02: /publicidade, /financeiro, /produtos-vendidos, /analise-precos e / (Vendas) — Responsividade Mobile Summary

**One-liner:** Dual-layout isMobile (cards mobile + tabela desktop) em 5 tabelas largas de /publicidade e /financeiro; rodapé de campanhas com flex-wrap; copy correta e controles agrupados em /produtos-vendidos, /analise-precos e /vendas.

## Tasks Completed

| # | Task | Commit | Files Modificados |
|---|------|--------|------------------|
| 1 | /publicidade — rodapé flex-wrap (BLOCKER) + dual-layout Campanhas e Produtos Patrocinados | `06a31021` | MLPublicidade.tsx |
| 2 | /financeiro — tabelas Marca/Estado dual-layout + chart Composição margem condicional + KPI grid check | `850eedd7` | MLFinanceiro.tsx |
| 3 | Fixes MINOR copy/controles — /produtos-vendidos, /analise-precos, / Vendas | `af3d05e8` | MLProdutosVendidos.tsx, PrecoPraticadoReport.tsx, MercadoLivre.tsx |

## Findings Resolvidos

| Finding | Severidade | Arquivo | Ação |
|---------|-----------|---------|------|
| A-02 — rodapé campanhas gap-8 sem wrap | BLOCKER | MLPublicidade.tsx | `flex flex-wrap gap-x-4 gap-y-1` — 4 totais visíveis em 360px |
| A-07 — tabela Campanhas 10 col. sem mobile | MAJOR | MLPublicidade.tsx | dual-layout: cards (Nome/Status/Gasto/ROAS/Pedidos/ACoS) + tabela desktop |
| A-03 — tabela Produtos Patrocinados 15 col. sem mobile | MAJOR | MLPublicidade.tsx | dual-layout: cards (Produto/Gasto/ROAS/ACoS/Estoque) + tabela desktop |
| A-04 — tabelas Marca/Estado sem mobile | MAJOR | MLFinanceiro.tsx | dual-layout para ambas: cards (campos-chave) + tabela desktop |
| A-05 — chart Composição margin right:48 comprime barras | MAJOR | MLFinanceiro.tsx | `right: isMobile ? 4 : 48` — barras legíveis em 360px |
| A-10 — KPI 8-cards pode truncar valores | MINOR | MLFinanceiro.tsx | Sem mudança necessária — grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 já adequado |
| A-06 — copy "à esquerda" incorreto no mobile | MINOR | MLProdutosVendidos.tsx | Substituído por "acima" (correto em layout empilhado) |
| A-08 — controles Análise de Preços quebra estranha | MINOR | PrecoPraticadoReport.tsx | Dois ToggleGroup agrupados em `div flex items-center gap-2 ml-auto` |
| A-09 — botões Atualizar/Personalizar ícone-only | MINOR | MercadoLivre.tsx | Adicionado `title=` (tooltip nativo); texto hidden sm:inline mantido por design |

## Deviations from Plan

### A-10 — Nenhuma mudança necessária (documentado conforme previsto no plano)

O KPI grid de 8 cards usa `grid-cols-2 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-8`. Em 360px renderiza 2 colunas (4 linhas). O KPICard com `size="compact"` trata overflow de valores monetários internamente — sem truncamento observado ao verificar o código. Sem mudança necessária para A-10.

## Verification

- `npx vitest run` → **318 testes verdes** (22 arquivos de teste, exit 0)
- `npx vite build` → **build limpo** (exit 0, sem warnings TS)
- Grep gates Task 1: `flex-wrap` ✓ + `isMobile` ✓ → GATES_OK
- Grep gates Task 2: `isMobile ? 4 : 48` ✓ + count isMobile ≥ 3 (= 5) ✓ → GATES_OK
- Grep gates Task 3: `acima` ✓ + `flex items-center gap-2 ml-auto` ✓ → GATES_OK

## Known Stubs

Nenhum stub identificado — todas as variantes mobile leem os mesmos dados já carregados (zero novo fetch, zero mock/placeholder).

## Threat Flags

Nenhuma superfície de segurança nova introduzida. Mudanças exclusivamente de layout/CSS/copy conforme `<threat_model>` do plano.

## Self-Check: PASSED

- [x] src/pages/mercadolivre/MLPublicidade.tsx — modificado (verificado pelo commit 06a31021)
- [x] src/pages/mercadolivre/MLFinanceiro.tsx — modificado (verificado pelo commit 850eedd7)
- [x] src/pages/mercadolivre/MLProdutosVendidos.tsx — modificado (verificado pelo commit af3d05e8)
- [x] src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx — modificado (verificado pelo commit af3d05e8)
- [x] src/pages/MercadoLivre.tsx — modificado (verificado pelo commit af3d05e8)
- [x] 318 testes verdes
- [x] build limpo
