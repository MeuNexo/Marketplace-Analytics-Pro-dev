---
phase: 78-revisao-mobile-first-responsividade-e-ux-100-por-cento-no-mo
plan: "03"
subsystem: frontend-responsive
tags:
  - mobile-first
  - layout
  - ux
  - anuncios
  - estoque
  - pedidos
  - precificacao
  - fluxo-de-caixa
dependency_graph:
  requires:
    - 78-01
    - 78-02
  provides:
    - responsividade-paginas-operacoes
  affects:
    - MLAnuncios.tsx
    - ListingDetailModal.tsx
    - MLEstoque.tsx
    - MLPedidos.tsx
    - SimuladorPrecificacao.tsx
    - CashFlowSimulator.tsx
tech_stack:
  added: []
  patterns:
    - dual-layout mobile/desktop (cards no mobile, tabela no desktop)
    - ternária isMobile ? jsx : jsx no JSX inline
    - flex-col gap-3 sm:flex-row para headers responsivos
    - min-w-[N] em tabelas com overflow-auto para scroll intencional
    - sm:order-N para reordenar grid no mobile sem alterar desktop
key_files:
  created: []
  modified:
    - src/pages/mercadolivre/MLAnuncios.tsx
    - src/components/mercadolivre/anuncios/ListingDetailModal.tsx
    - src/pages/mercadolivre/MLEstoque.tsx
    - src/pages/mercadolivre/MLPedidos.tsx
    - src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx
    - src/components/financial/CashFlowSimulator.tsx
decisions:
  - "ExtraField empilha em duas linhas no mobile: linha 1 = Switch + label; linha 2 = Select + Input (evita overflow de 380px+ em 360px viewport)"
  - "Tabela inventário /estoque usa dual-layout (cards mobile, tabela desktop) seguindo padrão Phase 71/MLPedidos — ExternalLink preservado no card mobile (paridade dual-layout)"
  - "PieChart Análise por Marca: label condicionado a !isMobile + Legend renderizado no mobile abaixo do gráfico (mesmo padrão de /estoque:232)"
  - "CashFlowSimulator e SimuladorPrecificacao: sm:grid-cols expõe a coluna de resultado já em tablet; ordem via sm:order reposiciona resultado acima dos inputs no mobile"
  - "Filtros catálogo /anuncios: busca flex-1 min-w-[120px] para crescer no espaço disponível; Selects w-full sm:w-36 (não drawer de filtros — mudança mínima sem regressão)"
metrics:
  duration: "~6 minutos"
  completed: "2026-07-02"
  tasks_completed: 4
  files_modified: 6
status: complete
---

# Phase 78 Plan 03: Operações Mobile-First Summary

Corrigidos 15 findings do audit Grupo B — 2 BLOCKERs, 8 MAJORs e 5 MINORs — nas páginas /anuncios (Sheet+Modal+relatórios), /estoque (inventário em cards), /pedidos (header), /precificacao (Simulador) e /fluxo-de-caixa (CashFlowSimulator). Zero mudança de dados ou comportamento.

## Tasks Executadas

| Task | Descrição | Commit | Findings |
|------|-----------|--------|---------|
| Task 1 | /anuncios BLOCKERs: PriceDetailSheet + ListingDetailModal + sticky header + Calendar | 175dcb38 | B-01, B-02, B-03, B-09 |
| Task 1b | /anuncios relatórios: controles empilhados + tabelas min-w + PieChart Legend + filtros fluidos | 1d761912 | B-05, B-06, B-07, B-14, B-15 |
| Task 2 | /estoque: dual-layout inventário (cards mobile) + min-w Reposição Urgente | 78271e1d | B-08, B-13 |
| Task 3 | /pedidos header + SimuladorPrecificacao + CashFlowSimulator | 769fdb4d | B-04, B-10, B-11, B-12 |

## Changes por Arquivo

### `src/components/mercadolivre/anuncios/ListingDetailModal.tsx`
- DialogContent: `max-w-4xl` → `w-full sm:max-w-4xl` (BLOCKER B-02 corrigido)

### `src/pages/mercadolivre/MLAnuncios.tsx`
- SheetContent: `w-[560px] sm:max-w-[560px]` → `w-full sm:max-w-[560px]` (BLOCKER B-01 corrigido)
- Sticky header: `flex items-center justify-between gap-4` → `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between` (B-03)
- Calendar `numberOfMonths`: `{2}` → `{isMobile ? 1 : 2}` (B-09)
- Controles Relatórios: `flex items-center justify-between gap-3` → `flex flex-col gap-3`; controles `flex items-center gap-2 flex-wrap` (B-05)
- Wrapper tabela catálogo: `overflow-auto` → `overflow-x-auto overflow-y-auto` (B-06)
- Tabela Ranking: `<Table className="min-w-[640px]">` (B-07)
- Tabela Marca: `<Table className="min-w-[500px]">` (B-07)
- Tabela ABC: `<Table className="min-w-[700px]">` (B-07)
- PieChart: `label={({ name, percent }) => ...}` → `label={!isMobile ? ... : undefined}` + `<Legend>` no mobile (B-14)
- Filtros catálogo: busca `w-44` → `flex-1 min-w-[120px] w-full`; Selects `w-36`/`w-32` → `w-full sm:w-36`/`w-full sm:w-32` (B-15)
- Import recharts: adicionado `Legend`

### `src/pages/mercadolivre/MLEstoque.tsx`
- Import: `useIsMobile` adicionado; `isMobile = useIsMobile()` no componente
- Tabela inventário (~1206, 12 colunas): dual-layout implementado — `isMobile ? <cards> : <table>`; cards mobile exibem Produto/Preço/Estoque/Cobertura/Saúde + ExternalLink (paridade dual-layout conforme lição Phase 71) (B-08)
- Tabela Reposição Urgente: `<Table className="min-w-[500px]">` (B-13)

### `src/pages/mercadolivre/MLPedidos.tsx`
- Sticky header: `flex items-center justify-between gap-4` → `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between` + `flex-wrap` nos botões (B-04)
- Dual-layout de cards de pedidos (~1311): NÃO tocado

### `src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx`
- Grid: `grid-cols-1 lg:grid-cols-[1fr_340px]` → `grid-cols-1 sm:grid-cols-[1fr_300px] lg:grid-cols-[1fr_340px]` (B-10)
- Inputs (LEFT): `sm:order-2 lg:order-none` — vai após o resultado no tablet (B-10)
- Resultado (RIGHT): `sm:order-1 lg:order-none` — aparece antes dos inputs no tablet/mobile (B-10)
- ExtraField: `flex items-center gap-2` → `flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2`; Switch+label linha 1, Select+Input linha 2 (B-11)

### `src/components/financial/CashFlowSimulator.tsx`
- Grid: `grid gap-4 lg:grid-cols-[340px_1fr]` → `grid gap-4 sm:grid-cols-[300px_1fr] lg:grid-cols-[340px_1fr]` (B-12)
- Controles: `sm:order-2 lg:order-none` (B-12)
- Resultado/gráfico: `sm:order-1 lg:order-none` — visível antes dos controles (B-12)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SimuladorPrecificacao: abordagem `order` em vez de reordenação DOM**
- **Found during:** Task 3
- **Issue:** O plano sugeria `order-first` no painel de resultado. Como o grid usa `sm:grid-cols-[...]`, a abordagem correta é `sm:order-1` no resultado e `sm:order-2` nos inputs — sem alterar a ordem do DOM (preserva acessibilidade e SSR).
- **Fix:** `sm:order-1 lg:order-none` no resultado; `sm:order-2 lg:order-none` nos inputs. Desktop (`lg:`) volta ao layout original.
- **Files modified:** `SimuladorPrecificacao.tsx`, `CashFlowSimulator.tsx`
- **Commit:** 769fdb4d

**2. [Rule 2 - Missing] Legend import em MLAnuncios**
- **Found during:** Task 1b
- **Issue:** `<Legend>` usado para o PieChart no mobile, mas não estava no import de recharts.
- **Fix:** Adicionado `Legend` ao import de recharts na linha 52.
- **Files modified:** `src/pages/mercadolivre/MLAnuncios.tsx`
- **Commit:** 1d761912

**3. [Rule 1 - Bug] MLEstoque dual-layout: ternária encadeada `filteredItems.length === 0 ? (...) : isMobile ? (...) : (...)`**
- **Found during:** Task 2
- **Issue:** A inserção inicial gerou `{filteredItems.length === 0 ? ... : ( {isMobile ? ...} )}` — JSX inválido (não pode abrir `{` dentro de `(`). Build falhou com "Expected } but found ?".
- **Fix:** Convertido para ternária encadeada: `filteredItems.length === 0 ? (...) : isMobile ? (...) : (...)` — sintaxe válida em JSX.
- **Files modified:** `src/pages/mercadolivre/MLEstoque.tsx`
- **Commit:** 78271e1d

## Verification Results

- `npx vite build` → exit 0 (18s, 4177 modules)
- `npx vitest run` → 318/318 tests passed
- Grep gates Task 1: GATES_OK
- Grep gates Task 1b: GATES_OK
- Grep gates Task 2: GATES_OK
- Grep gates Task 3: GATES_OK

## Known Stubs

Nenhum stub introduzido. Todas as alterações são de layout/CSS/order DOM.

## Threat Flags

Nenhuma nova superfície de segurança introduzida. Cards mobile renderizam subconjunto dos mesmos dados e disparam as mesmas ações já existentes no ramo desktop. Nenhum fetch/RPC/EF alterado.

## Self-Check: PASSED

- src/pages/mercadolivre/MLAnuncios.tsx: FOUND
- src/components/mercadolivre/anuncios/ListingDetailModal.tsx: FOUND
- src/pages/mercadolivre/MLEstoque.tsx: FOUND
- src/pages/mercadolivre/MLPedidos.tsx: FOUND
- src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx: FOUND
- src/components/financial/CashFlowSimulator.tsx: FOUND
- Commits 175dcb38, 1d761912, 78271e1d, 769fdb4d: FOUND
