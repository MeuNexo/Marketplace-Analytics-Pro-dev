---
phase: 77-pagina-analise-de-anuncios-produtos-vendidos-e-analise-de-pr
verified: 2026-07-01T23:07:00Z
status: passed
score: 10/10
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 77: Produtos Vendidos + Análise de Preços — Verification Report

**Phase Goal:** Duas análises portadas do app oficial, entregues como DOIS itens separados no grupo "Dashboard" do menu lateral: (1) Produtos Vendidos — painel duplo marcas/categorias → produtos do grupo no período; (2) Análise de Preços — `PrecoPraticadoReport` (preço médio/mín/máx + volume, granularidade dia/semana/mês). Queries adaptadas ao nosso schema (`orders`, `data_pedido` TEXT, `status='paid'`, RLS org-scoped, paginação `.range()`); rotas registradas em App.tsx + roleAccess.ts (default-deny) + ApiSidebar.tsx.

**Verified:** 2026-07-01T23:07:00Z
**Status:** PASSED
**Re-verification:** No — initial verification
**Branch:** `gsd/phase-77-pagina-analises`

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Util `soldProductsAgg` exporta `aggregatePvGroups` e `aggregatePvItems` — testável isoladamente, sem dependências React/Supabase/rede | VERIFIED | `soldProductsAgg.ts` 141 linhas, sem nenhum `import` de react/supabase; exporta as 2 funções + 3 tipos; `npx vitest run soldProductsAgg.test.ts` → 9/9 PASS |
| 2 | Hook `useMLSoldProducts` busca pedidos pagos com paginação `.range()` e guard de `resolvedMLUserIds` vazio | VERIFIED | `useMLSoldProducts.ts` 123 linhas; contém `.eq("status","paid")`, loop `.range(offset, offset+PAGE-1)`, guard `if (!fromDate \|\| !toDate \|\| !resolvedMLUserIds.length)`, flag `cancelled` no cleanup |
| 3 | Migration `orders_price_timeseries` usa `SECURITY INVOKER` e faz cast `data_pedido::date` (schema TEXT) | VERIFIED | `20260677000000_orders_price_timeseries.sql` 60 linhas; contém `o.data_pedido::date` em 4 lugares; sem `SECURITY DEFINER`; RPC aplicada no banco real pelo orquestrador (evidência fornecida no contexto de verificação) |
| 4 | Página Produtos Vendidos tem painel duplo (marcas/categorias + produtos do grupo) com dual-layout mobile/desktop | VERIFIED | `MLProdutosVendidos.tsx` 330 linhas; contém `useMLSoldProducts`, `aggregatePvGroups`, `aggregatePvItems`, `<MLPageHeader title="Produtos Vendidos"`, `MLPeriodPicker`, `hidden lg:block` (tabela desktop) e `lg:hidden` (cards mobile) |
| 5 | Página Análise de Preços renderiza `PrecoPraticadoReport` com granularidade dia/semana/mês e alimentada pela RPC | VERIFIED | `MLAnalisePrecos.tsx` 99 linhas; importa e renderiza `<PrecoPraticadoReport products={products} mlUserIds={resolvedMLUserIds} fromDate={currentFrom} toDate={currentTo} request={null} />`; usa `useMLSoldProducts` para derivar lista de produtos |
| 6 | `PrecoPraticadoReport` chama `orders_price_timeseries` via `supabase.rpc` com parâmetros corretos | VERIFIED | Linha 129: `(supabase.rpc as any)("orders_price_timeseries", { _item_id, _ml_user_ids, _from, _to, _granularity })`; `ComposedChart` (recharts) presente; 6 `KPICard`s; cleanup `cancelled`; supabase importado de `@/integrations/supabase/client` (cliente autenticado normal, sem service_role) |
| 7 | Rotas `/produtos-vendidos` e `/analise-precos` registradas em App.tsx com `React.lazy` + `RoleRoute` + `ErrorBoundary` | VERIFIED | `src/App.tsx` linhas 41-42 (lazy imports) e linhas 147-148 (Routes com RoleRoute+ErrorBoundary); greps confirmados |
| 8 | Ambas as rotas em `roleAccess.ts` como `OPERATIONAL` — evita default-deny silencioso (lição Phase 54) | VERIFIED | `src/config/roleAccess.ts` linhas 24-25: `"/produtos-vendidos": OPERATIONAL,` e `"/analise-precos": OPERATIONAL,` |
| 9 | Grupo Dashboard do menu lateral tem exatamente 2 novos itens navegáveis: Produtos Vendidos e Análise de Preços | VERIFIED | `ApiSidebar.tsx` linhas 41-42: `{ icon: PackageSearch, label: "Produtos Vendidos", path: "/produtos-vendidos" }` e `{ icon: BarChart2, label: "Análise de Preços", path: "/analise-precos" }`; ícones importados de lucide-react nas linhas 2 e 13 |
| 10 | `npx tsc --noEmit` e `npx vitest run` (suíte completa) passam sem regressão; `vite build` compila | VERIFIED | tsc exit 0 (sem output); vitest 318/318 PASS (22 test files); vite build exit 0 gerando `MLAnalisePrecos-3E37fnim.js` e chunks das páginas novas |

**Score:** 10/10 truths verified (0 present-but-behavior-unverified)

---

### Required Artifacts

| Artifact | Expected (Plan must_have) | Lines | Status | Details |
|----------|--------------------------|-------|--------|---------|
| `src/components/mercadolivre/anuncios/soldProductsAgg.ts` | `aggregatePvGroups` + `aggregatePvItems` + tipos; min 60 linhas; zero React/Supabase | 141 | VERIFIED | Exports: `SoldProductRow`, `PvGroup`, `PvItem`, `aggregatePvGroups`, `aggregatePvItems`; zero imports externos |
| `src/components/mercadolivre/anuncios/soldProductsAgg.test.ts` | Testes unitários; min 30 linhas | 194 | VERIFIED | 9 testes cobrindo marca, categoria, fallback, shareOfGroup, caso vazio — todos verdes |
| `src/hooks/useMLSoldProducts.ts` | Hook paginado + guard; min 40 linhas | 123 | VERIFIED | `.eq("status","paid")`, `.range()`, `MAX_ROWS=50000`, guard, cleanup `cancelled` |
| `supabase/migrations/20260677000000_orders_price_timeseries.sql` | `CREATE OR REPLACE FUNCTION public.orders_price_timeseries`; `data_pedido::date`; sem SECURITY DEFINER | 60 | VERIFIED | SECURITY INVOKER (implícito, sem DEFINER); `o.data_pedido::date` em 4 lugares; RPC aplicada no banco real |
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` | Exporta `PrecoPraticadoReport` + `PriceReportProduct`; min 150 linhas | 324 | VERIFIED | Named exports corretos; `ComposedChart`, 6 KPICards, granularidade day/week/month, `orders_price_timeseries` |
| `src/pages/mercadolivre/MLProdutosVendidos.tsx` | Default export; painel duplo; min 80 linhas | 330 | VERIFIED | `export default function MLProdutosVendidos`; dual-layout `hidden lg:block`/`lg:hidden`; botões nativos para mobile |
| `src/pages/mercadolivre/MLAnalisePrecos.tsx` | Default export; wrapper PrecoPraticadoReport; min 40 linhas | 99 | VERIFIED | `export default function MLAnalisePrecos`; renderiza `<PrecoPraticadoReport>`; deriva produtos via useMLSoldProducts |
| `src/App.tsx` | `produtos-vendidos` lazy + Route | modified | VERIFIED | Linhas 41-42 (lazy) + 147-148 (Routes); padrão idêntico a `/compras` |
| `src/config/roleAccess.ts` | `/analise-precos` como OPERATIONAL | modified | VERIFIED | Linhas 24-25; ambas as rotas em OPERATIONAL |
| `src/components/layout/ApiSidebar.tsx` | `Análise de Preços` no Dashboard | modified | VERIFIED | Linhas 41-42; ícones `PackageSearch`/`BarChart2` importados |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `useMLSoldProducts.ts` | `orders` (Supabase) | `.from("orders").eq("status","paid").range()` | VERIFIED | Linha 85: `supabase.from("orders").select(...)` com `.eq("status","paid")` e `.range(offset, offset+PAGE-1)` |
| `migration .sql` | `orders` (Supabase) | `FROM orders o WHERE o.data_pedido::date` | VERIFIED | Linha 47: `FROM orders o`; linhas 39/51/52: `o.data_pedido::date` |
| `MLProdutosVendidos.tsx` | `useMLSoldProducts.ts` | `useMLSoldProducts({ fromDate, toDate, resolvedMLUserIds })` | VERIFIED | Linha 8 (import) + linha 51 (chamada); `allRows` alimenta `aggregatePvGroups`/`aggregatePvItems` via `useMemo` |
| `MLAnalisePrecos.tsx` | `PrecoPraticadoReport.tsx` | `<PrecoPraticadoReport products mlUserIds fromDate toDate />` | VERIFIED | Linha 7 (import) + linha 90 (render); `products` derivado de `allRows` via `useMemo` |
| `PrecoPraticadoReport.tsx` | `orders_price_timeseries` (RPC) | `(supabase.rpc as any)("orders_price_timeseries", ...)` | VERIFIED | Linha 129; passa `_item_id`, `_ml_user_ids`, `_from`, `_to`, `_granularity` |
| `App.tsx` | `MLProdutosVendidos.tsx` | `React.lazy(() => import("./pages/mercadolivre/MLProdutosVendidos"))` | VERIFIED | Linha 41 |
| `ApiSidebar.tsx` | `/produtos-vendidos` | `children` do grupo Dashboard | VERIFIED | Linha 41 |
| `roleAccess.ts` | `/produtos-vendidos` | `"/produtos-vendidos": OPERATIONAL` | VERIFIED | Linha 24 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `MLProdutosVendidos.tsx` | `allRows` | `useMLSoldProducts` → `supabase.from("orders").select(...)` (RLS org-scoped, paginado) | Yes — query direta ao banco com filtros reais | FLOWING |
| `MLAnalisePrecos.tsx` | `products` | `useMLSoldProducts` (mesmo acima) → `useMemo` dedup por item_id | Yes — derivado de query real | FLOWING |
| `PrecoPraticadoReport.tsx` | `series` (chart data) | `(supabase.rpc as any)("orders_price_timeseries", ...)` → banco real (migration aplicada) | Yes — RPC com dados reais | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| soldProductsAgg 9 testes unitários | `npx vitest run src/components/mercadolivre/anuncios/soldProductsAgg.test.ts` | 9/9 PASS (8ms) | PASS |
| Suíte completa — sem regressão | `npx vitest run` | 318/318 PASS (22 test files) | PASS |
| TypeScript sem erros | `npx tsc --noEmit` | exit 0, sem output | PASS |
| Build de produção | `npx vite build` | exit 0; `MLAnalisePrecos-3E37fnim.js` emitido | PASS |

---

### Probe Execution

Nenhuma probe declarada no PLAN para esta phase. Smoke da RPC `orders_price_timeseries` foi executado pelo orquestrador via MCP (evidência fornecida no contexto: RPC aplicada em `ckcdevcxgvueywivefgx`, smoke retornou buckets diários com `preco_medio/min/max/qtd` — fora do escopo de verificação de repositório).

---

### Requirements Coverage

Phase 77 declara `Requirements: TBD` no ROADMAP (sem IDs formais de requisitos). Os critérios de entrega do goal foram todos cobertos pelos must_haves dos 3 planos.

---

### Anti-Patterns Found

Scan em todos os 10 arquivos criados/modificados:

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `MLAnalisePrecos.tsx` | linha `request={null}` | `request={null}` hard-coded | INFO | Atalho deep-link `?item=` explicitamente deferido em `77-CONTEXT.md` Deferred — não é stub de feature obrigatória; PrecoPraticadoReport funciona com seleção manual |

Sem `TBD`, `FIXME`, `XXX` em nenhum dos arquivos modificados. Sem `service_role` no frontend. Sem `SECURITY DEFINER` na migration. Sem `new Date()` em `soldProductsAgg.ts` (apenas comentário de aviso, não uso).

---

### Locked Decisions Verified

| Decisão (77-CONTEXT.md LOCKED) | Status |
|-------------------------------|--------|
| Dois itens **separados** no grupo Dashboard (NÃO abas de MLAnuncios) | VERIFIED — 2 Routes + 2 items no sidebar; MLAnuncios.tsx não foi tocado nesta fase |
| "Análise por Categoria" NÃO implementada como página/aba | VERIFIED — apenas `MLProdutosVendidos` e `MLAnalisePrecos` criadas; sem `AnalisePorCategoria` no repo |
| `MLAnuncios.tsx` NÃO ganhou sub-abas novas | VERIFIED — `git log --follow MLAnuncios.tsx` mostra último commit da Phase 71, não da 77 |
| Nenhum merge/deploy automático | VERIFIED — branch `gsd/phase-77-pagina-analises`, PR não mergeado |
| SECURITY INVOKER sem parâmetro org (anti-IDOR) | VERIFIED — migration sem `SECURITY DEFINER`, sem `p_org_id` |
| Paginação `.range()` obrigatória | VERIFIED — `useMLSoldProducts.ts` linha 91 |
| `data_pedido` TEXT → cast `::date` na RPC, string "YYYY-MM-DD" no client | VERIFIED — migration linha 39; hook passa strings direto |
| Dual-layout mobile/desktop nos dois ramos | VERIFIED — `hidden lg:block` (tabela) e `lg:hidden` (cards) em MLProdutosVendidos |
| `roleAccess.ts` OPERATIONAL para ambas as rotas (lição Phase 54) | VERIFIED — linhas 24-25 |

---

### Threat Model Verification

| Ameaça | Controle declarado | Status |
|--------|--------------------|--------|
| T-77-01 IDOR via RPC | SECURITY INVOKER + RLS orders | VERIFIED — sem SECURITY DEFINER; sem parâmetro org na função |
| T-77-02 Truncagem PostgREST | Loop `.range()` com MAX_ROWS | VERIFIED — `useMLSoldProducts.ts` linha 83: `while (!cancelled && accumulated.length < MAX_ROWS)` |
| T-77-03 Guard lojas vazias | `resolvedMLUserIds.length` antes do fetch | VERIFIED — linha 66 do hook |
| T-77-07 Default-deny silencioso | `roleAccess.ts` OPERATIONAL | VERIFIED |
| T-77-08 Elevation via rotas novas | `<RoleRoute>` em App.tsx | VERIFIED |
| Frontend sem service_role | Usar cliente autenticado normal | VERIFIED — `@/integrations/supabase/client` sem service_role_key |

---

### Human Verification Required

Nenhum item requer verificação humana obrigatória para aprovar a phase. Os itens abaixo são conveniências opcionais:

1. **Ok visual Wesley em /produtos-vendidos** — painel duplo (coluna marcas/categorias + coluna itens) com dados reais do período selecionado, toggle Marca/Categoria, dual-layout mobile.
2. **Ok visual Wesley em /analise-precos** — seletor de anúncio (Popover/Command), ComposedChart com granularidade dia/semana/mês, 6 KPICards.
3. **Deep-link `?item=MLB...`** — atalho deferido explicitamente (CONTEXT.md Deferred); `request={null}` registrado como follow-up. Não bloqueia a entrega.

---

## Summary

Todos os 10 truths verificados. A phase entregou exatamente o prometido:

- **Foundation (Plano 01):** `soldProductsAgg.ts` (util pura, 9 testes verdes) + `useMLSoldProducts.ts` (hook paginado, guard, cleanup) + migration `orders_price_timeseries` (SECURITY INVOKER, cast `data_pedido::date`, aplicada no banco real).
- **UI (Plano 02):** `PrecoPraticadoReport.tsx` (porte integral do oficial, 324 linhas, ComposedChart + 6 KPICards + seletor Command/Popover) + `MLProdutosVendidos.tsx` (painel duplo, dual-layout, 330 linhas) + `MLAnalisePrecos.tsx` (wrapper, 99 linhas).
- **Fiação (Plano 03):** rotas lazy+RoleRoute+ErrorBoundary em App.tsx, OPERATIONAL em roleAccess.ts (sem default-deny), 2 itens `PackageSearch`/`BarChart2` no grupo Dashboard do ApiSidebar.

Decisões travadas do Wesley (2 itens separados, sem sub-abas em MLAnuncios, Análise por Categoria fora) respeitadas integralmente. Threat model (IDOR/truncagem/guard/default-deny) mitigado em código. 318/318 testes, tsc clean, vite build OK.

---

_Verified: 2026-07-01T23:07:00Z_
_Verifier: Claude (gsd-verifier)_
