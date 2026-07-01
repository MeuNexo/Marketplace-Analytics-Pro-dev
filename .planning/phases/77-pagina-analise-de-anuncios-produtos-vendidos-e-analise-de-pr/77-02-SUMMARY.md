---
phase: 77-pagina-analise-de-anuncios-produtos-vendidos-e-analise-de-pr
plan: "02"
subsystem: frontend-pages
tags:
  - mercadolivre
  - anuncios
  - produtos-vendidos
  - analise-precos
  - recharts
  - port
dependency_graph:
  requires:
    - soldProductsAgg (77-01)
    - useMLSoldProducts (77-01)
    - orders_price_timeseries RPC (77-01)
  provides:
    - PrecoPraticadoReport (componente portado + tipo PriceReportProduct)
    - MLProdutosVendidos (página painel duplo marca/categoria)
    - MLAnalisePrecos (página wrapper PrecoPraticadoReport)
  affects:
    - plans/77-03 (App.tsx + roleAccess.ts + ApiSidebar.tsx — fiação das rotas)
tech_stack:
  added: []
  patterns:
    - "Porte direto de componente oficial com zero alteração de lógica"
    - "Painel duplo botão-nativo mobile (não tabela) + tabela desktop"
    - "dual-layout lg:hidden / hidden lg:block (Phase 71 lição)"
    - "useMLFilters(30) + MLPeriodPicker — mesmo wiring de AnaliseDashboard.tsx"
    - "useMemo para derivar pvGroups/pvItems sem re-renders desnecessários"
    - "Dedup por item_id com acumulação de qty para seletor de PrecoPraticadoReport"
key_files:
  created:
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
    - src/pages/mercadolivre/MLProdutosVendidos.tsx
    - src/pages/mercadolivre/MLAnalisePrecos.tsx
  modified: []
decisions:
  - "PrecoPraticadoReport portado integralmente do oficial — zero alterações de lógica, apenas verificação de imports"
  - "MLProdutosVendidos usa botões nativos para lista de grupos (compatível mobile/desktop sem ResponsiveTable)"
  - "Deep-link ?item= em MLAnalisePrecos DEFERIDO — request={null}; registrado como follow-up"
  - "Seleção de grupo é togglável (click no selecionado deseleciona) para UX intuitivo"
  - "Troca de pvView (marca/categoria) limpa pvSelected para evitar estado inconsistente"
metrics:
  duration: "~6 min"
  completed_date: "2026-07-01"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 0
  tests_added: 0
  tests_passing: 0
status: complete
---

# Phase 77 Plan 02: PrecoPraticadoReport + MLProdutosVendidos + MLAnalisePrecos Summary

Porte do componente `PrecoPraticadoReport` do app oficial e criação das duas páginas independentes — Produtos Vendidos (painel duplo marca/categoria) e Análise de Preços (wrapper do componente portado) — consumindo a foundation de dados do Plano 01.

## One-liner

Porte direto de `PrecoPraticadoReport` (ComposedChart + 6 KPIs + RPC `orders_price_timeseries`) + página `MLProdutosVendidos` (painel duplo botão-nativo, dual-layout) + página `MLAnalisePrecos` (wrapper com período e dedup por item_id), zero pacote novo.

## What Was Built

### Task 1: PrecoPraticadoReport (porte do oficial)

Arquivo: `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx`

Exporta:
- `PriceReportProduct` — interface `{ id: string; title: string }`
- `PrecoPraticadoReport` — componente nomeado (named export)

Funcionalidades portadas integralmente:
- Seletor de anúncio via Command/Popover (busca por título ou ID)
- ToggleGroup granularidade: Diária / Semanal / Mensal
- ToggleGroup volume: Qtd / Receita (controla eixo esquerdo e barras do chart)
- 6 KPICards: Preço médio, Faixa de preço (+ variação %), Qtd vendida, Média diária (Qtd), Receita, Receita média diária
- ComposedChart (recharts): Bar (volume) + Line (preco_medio), dois eixos Y
- Tooltip customizado com preço/qtd/receita + faixa quando preco_min ≠ preco_max
- Chamada RPC: `(supabase.rpc as any)("orders_price_timeseries", { _item_id, _ml_user_ids, _from, _to, _granularity })`
- Cleanup anti-stale com flag `cancelled` no useEffect
- Mantém seleção válida quando lista de produtos muda (troca de período/loja)
- Atalho pré-seleção via `request?.itemId` (para deep-link futuro)
- Estados: loading (spinner), sem seleção (Package icon), sem dados (BarChart2 icon)

**Ajustes de porte:** Nenhuma alteração de lógica necessária. Todos os imports já resolvem no projeto (`@/components/dashboard/KPICard`, `@/components/ui/command`, `@/components/ui/popover`, `@/components/ui/toggle-group`, `recharts`, `date-fns`, `lucide-react`).

Linhas: 324 (> 150 mínimo do must_haves).

### Task 2: MLProdutosVendidos (painel duplo marca/categoria)

Arquivo: `src/pages/mercadolivre/MLProdutosVendidos.tsx` (default export)

**Header sticky** (padrão MLCompras.tsx):
- `<MLPageHeader title="Produtos Vendidos" />`
- ToggleGroup Marca / Categoria (estado `pvView`)
- `<MLPeriodPicker>` com wiring completo de `useMLFilters(30)`

**Dados:**
- `const { resolvedMLUserIds } = useMLStore()`
- `const { items: inventoryItems } = useMLInventory()`
- `useMLSoldProducts({ fromDate: currentFrom, toDate: currentTo, resolvedMLUserIds })`
- `itemsMap` = `useMemo(() => Map<item_id, { category_id, title, thumbnail }>)` de inventoryItems
- `pvGroups` = `useMemo(() => aggregatePvGroups(allRows, pvView, itemsMap))`
- `pvItems` = `useMemo(() => aggregatePvItems(allRows, pvSelected, pvView, itemsMap))`

**Layout:** `grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4`

**Coluna esquerda (grupos):**
- `<ul>` com `<button>` por grupo (mobile-native — lição Phase 71/dual-layout)
- Cada botão: nome do grupo + receita BRL + qtd unidades
- Highlight do selecionado com `bg-primary/10 text-primary font-medium`
- Click no selecionado = deseleciona (toggle)

**Coluna direita (anúncios do grupo):**
- Desktop (`hidden lg:block`): tabela com colunas Anúncio / Qtd / Receita / Estoque / % Grupo
- Mobile (`lg:hidden`): cards empilhados com as mesmas 4 informações
- Cross-ref com `itemsMap` para thumbnail, `available_quantity`
- Fallback `available_quantity` → "—" quando item ausente do inventory

**Estados:** loading (texto), vazio (ShoppingBag icon + mensagem), grupo não selecionado (instrução), grupo sem itens (mensagem).

Linhas: 330 (> 80 mínimo do must_haves).

### Task 3: MLAnalisePrecos (wrapper de PrecoPraticadoReport)

Arquivo: `src/pages/mercadolivre/MLAnalisePrecos.tsx` (default export)

**Header sticky** (mesmo padrão):
- `<MLPageHeader title="Análise de Preços" />`
- `<MLPeriodPicker>` com wiring de `useMLFilters(30)`

**Derivação de produtos:**
- `useMLSoldProducts` para obter todas as linhas do período
- `useMemo` — dedup por `item_id`, acumula `qty`, ordena por `qty desc`
- Título: `r.titulo ?? r.item_id` (fallback seguro)
- Mapa para `{ id, title }` (formato `PriceReportProduct`)

**Renderização:** `<PrecoPraticadoReport products={products} mlUserIds={resolvedMLUserIds} fromDate={currentFrom} toDate={currentTo} request={null} />`

**Deep-link deferido:** `request={null}` — atalho `?item=MLB...` registrado como follow-up conforme 77-CONTEXT.md Deferred.

Linhas: 99 (> 40 mínimo do must_haves).

## Commits

| Hash | Mensagem | Tarefa |
|------|----------|--------|
| `f3851c06` | feat(77-02): port PrecoPraticadoReport from official app | Task 1 |
| `3addae3c` | feat(77-02): create MLProdutosVendidos page — dual-panel brand/category | Task 2 |
| `96742629` | feat(77-02): create MLAnalisePrecos page — wrapper for PrecoPraticadoReport | Task 3 |

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` após Task 1 | PASS (clean) |
| `npx tsc --noEmit` após Task 2 | PASS (clean) |
| `npx tsc --noEmit` após Task 3 | PASS (clean) |
| PrecoPraticadoReport exporta `PrecoPraticadoReport` e `PriceReportProduct` | PASS |
| Contém `orders_price_timeseries` | PASS (2 ocorrências) |
| Contém `ComposedChart` | PASS (3 ocorrências) |
| Contém import `KPICard` | PASS (7 ocorrências) |
| Tamanho PrecoPraticadoReport ≥ 150 linhas | PASS (324 linhas) |
| MLProdutosVendidos tem `export default function MLProdutosVendidos` | PASS |
| Contém `useMLSoldProducts`, `aggregatePvGroups`, `aggregatePvItems` | PASS |
| Contém `<MLPageHeader title="Produtos Vendidos"` | PASS |
| Contém `MLPeriodPicker` | PASS (2 ocorrências) |
| Contém `lg:hidden` e `hidden lg:block` (dual-layout) | PASS (2 ocorrências) |
| Tamanho MLProdutosVendidos ≥ 80 linhas | PASS (330 linhas) |
| MLAnalisePrecos tem `export default` | PASS |
| Contém `<PrecoPraticadoReport` | PASS |
| Contém `<MLPageHeader title="Análise de Preços"` | PASS |
| Contém `useMLSoldProducts` | PASS |
| Tamanho MLAnalisePrecos ≥ 40 linhas | PASS (99 linhas) |
| Nenhum toque em App.tsx / roleAccess.ts / ApiSidebar.tsx | PASS (fiação no Plano 03) |
| Zero pacotes novos instalados | PASS |

## Key Links Verified

| From | To | Via | Status |
|------|----|-----|--------|
| `MLProdutosVendidos.tsx` | `useMLSoldProducts.ts` | `allRows` do hook + `aggregatePvGroups/aggregatePvItems` | PASS |
| `MLAnalisePrecos.tsx` | `PrecoPraticadoReport.tsx` | `<PrecoPraticadoReport products mlUserIds fromDate toDate />` | PASS |
| `PrecoPraticadoReport.tsx` | `orders_price_timeseries` (RPC) | `(supabase.rpc as any)("orders_price_timeseries", ...)` | PASS |

## Deviations from Plan

None — plano executado exatamente como escrito. O deep-link `?item=` foi registrado como `request={null}` conforme instrução do CONTEXT.md Deferred.

## Known Stubs

**Deep-link `?item=MLB...` em MLAnalisePrecos** (`src/pages/mercadolivre/MLAnalisePrecos.tsx`, linha `request={null}`):
- Stub: `request` sempre `null` — atalho de deep-link da listagem de anúncios não implementado.
- Razão: CONTEXT.md Deferred — "se complicar, entregar as páginas sem o atalho e registrar como follow-up".
- Resolução: implementar `const [searchParams] = useSearchParams()` + derivar `request` de `searchParams.get("item")` em wave/fase futura.
- Este stub NÃO impede o objetivo do plano (o seletor de anúncio do PrecoPraticadoReport funciona normalmente — o deep-link é apenas conveniência de navegação).

## Threat Flags

Nenhuma nova superfície de segurança introduzida neste plano. Todas as chamadas de dados são:
- `orders_price_timeseries` via `(supabase.rpc as any)` com SECURITY INVOKER (criada no Plano 01, T-77-04 documentado)
- `useMLSoldProducts` — query direta autenticada `orders`, RLS org-scoped (T-77-05 documentado)
- Rotas `/produtos-vendidos` e `/analise-precos` sem fiação em App.tsx/roleAccess.ts ainda — default-deny até o Plano 03 (T-77-06 transferido ao Plano 03)

## Pending (Plano 03)

1. `src/App.tsx` — lazy imports + rotas `<Route>` para `/produtos-vendidos` e `/analise-precos`
2. `src/config/roleAccess.ts` — adicionar `"/produtos-vendidos": OPERATIONAL` e `"/analise-precos": OPERATIONAL`
3. `src/components/layout/ApiSidebar.tsx` — adicionar itens de menu no grupo Dashboard

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` exists | FOUND |
| `src/pages/mercadolivre/MLProdutosVendidos.tsx` exists | FOUND |
| `src/pages/mercadolivre/MLAnalisePrecos.tsx` exists | FOUND |
| Commit `f3851c06` (PrecoPraticadoReport) | FOUND |
| Commit `3addae3c` (MLProdutosVendidos) | FOUND |
| Commit `96742629` (MLAnalisePrecos) | FOUND |
| `npx tsc --noEmit` final | PASS |
