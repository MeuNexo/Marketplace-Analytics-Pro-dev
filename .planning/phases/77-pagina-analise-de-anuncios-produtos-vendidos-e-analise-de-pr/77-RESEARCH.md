# Phase 77: Produtos Vendidos + Análise de Preços — Research

**Researched:** 2026-07-01
**Domain:** React SPA — porte de sub-abas do app oficial como páginas independentes; agregação de dados de vendas por produto/marca/categoria; série temporal de preços via RPC PostgreSQL
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Escopo:** Portar SOMENTE Produtos Vendidos e Análise de Preços. "Análise por Categoria" do app oficial ficou FORA.
- **Localização no menu:** DOIS itens separados no grupo "Dashboard" do menu lateral (`src/components/layout/ApiSidebar.tsx`, array `apiSections`, children do item "Dashboard"), NÃO uma página única com abas e NÃO sub-abas de Relatórios em MLAnuncios.
- **Processo:** Phase GSD completa: plan → execute → verify.

### Claude's Discretion
- Nomes exatos de rotas, labels e ícones lucide dos itens de menu.
- Nível de acesso em `roleAccess.ts` (seguir o padrão de páginas de análise análogas; rota fora do mapa = default-deny).
- Como adaptar o atalho "coluna Preços" (deep-link `?item=MLB...`) — ou ficar de fora se acoplar demais.
- Estrutura de dados: reusar hooks/utils existentes quando fizer sentido vs. utils novos.

### Deferred Ideas (OUT OF SCOPE)
- "Análise por Categoria" (excluída por decisão do Wesley).
- PriceDetailSheet + sugestão de preço da aba Catálogo do oficial.
- Atalho "coluna Preços" na listagem de anúncios → deep-link para `/analise-precos?item=...` (opcional; se complicar, entregar sem e registrar como follow-up).
</user_constraints>

---

## Summary

Esta phase porta duas análises do app oficial (`/root/garment-glow-official/`) como **páginas independentes** no nosso dashboard: (1) **Produtos Vendidos** — painel duplo que lista marcas/categorias com receita+quantidade do período e, ao selecionar um grupo, exibe os anúncios vendidos daquele grupo; (2) **Análise de Preços** — série temporal de preço praticado (médio/mín/máx) com volume sobreposto por anúncio, granularidade dia/semana/mês.

A diferença crítica entre o app oficial e o nosso é a **fonte de dados**: o oficial usa `ml_product_daily_cache` (com colunas `brand` e `category_id`) para derivar `pvGroups`/`pvItems` e depois monta a lista de anúncios a partir de `useMLInventory().items`; a Análise de Preços usa a RPC `orders_price_timeseries`. **Em nosso projeto:**

- Para **Produtos Vendidos**: a fonte correta são as tabelas `orders` (coluna `marca`, `item_id`, `titulo`, `data_pedido` TEXT, `status='paid'`) + `ml_inventory_cache` (para `thumbnail`, `brand`, `available_quantity`, `category_id`). A agregação por marca/categoria é feita client-side sobre os rows de `orders` (exatamente como a Phase 73 fez para vendas por item). `ml_product_daily_cache` tem coluna `marca` mas NÃO tem `category_id` — portanto para Categoria usar `orders` diretamente.
- Para **Análise de Preços**: a RPC `orders_price_timeseries` do oficial **não existe em nosso projeto** (está apenas nas migrations do oficial). Precisa ser criada no nosso Supabase como migração nova. A RPC funciona sobre nossa tabela `orders` (cujos campos `preco_unit`, `receita_bruta`, `quantidade`, `data_pedido` TEXT, `item_id`, `ml_user_id` existem).

**Recomendação primária:** Para Produtos Vendidos, agregar client-side sobre `orders` filtrado por período (padrão Phase 73, evitando RPC). Para Análise de Preços, criar a migração `orders_price_timeseries` portada do oficial (adaptando o cast de `data_pedido` TEXT → `::date`) e chamar via `supabase.rpc()`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Agregar vendas por marca/categoria (Produtos Vendidos) | Frontend / Client | — | Mesma decisão da Phase 73: query direta `orders` + agregação JS client-side. Sem RPC, sem EF. |
| Série temporal de preços por anúncio (Análise de Preços) | Database (RPC) | Frontend (render) | Agrupamento por dia/semana/mês com `date_trunc` é mais limpo e eficiente em SQL do que client-side, especialmente com granularidade semanal/mensal. |
| Seletor de loja/período | Frontend | — | `useMLStore()` + `useMLFilters()` existentes; sem lógica de backend. |
| Thumbnails, brand, available_quantity por anúncio | Browser cache (MLInventoryContext) | — | `useMLInventory().items` já está em memória global na página. |
| Roteamento e acesso | Frontend (SPA) | — | `roleAccess.ts` + `App.tsx` + `ApiSidebar.tsx`. |

---

## Standard Stack

### Core (todos já instalados no projeto) [VERIFIED: inspecionando package.json + código do projeto]

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.3.1 | UI | Framework do projeto |
| TypeScript | 5.8.3 | Tipagem | Convenção do projeto |
| react-router-dom | 6.30.1 | Roteamento SPA | Padrão do projeto |
| @tanstack/react-query | 5.83.0 | Server state | Padrão do projeto (mas Produtos Vendidos usará useState/useEffect como Phase 73) |
| recharts | 2.15.4 | Gráfico ComposedChart | Já usado em PrecoPraticadoReport e no projeto inteiro |
| @supabase/supabase-js | 2.98.0 | Client Supabase | Padrão do projeto |
| shadcn/ui (Radix) | — | UI primitives | Command/Popover/ToggleGroup/Card/Table |
| lucide-react | 1.7.0 | Ícones | Padrão do projeto |
| date-fns | 3.6.0 | Formatação de datas | Usado em PrecoPraticadoReport e no projeto |
| cmdk | 1.1.1 | Command palette | Seletor de anúncio em PrecoPraticadoReport usa Command/Popover |

**Nenhuma nova dependência necessária.** [VERIFIED: inspeção do código oficial de PrecoPraticadoReport.tsx e MLAnuncios.tsx]

---

## Package Legitimacy Audit

> Nenhum pacote novo a instalar. Todas as dependências já estão no `package.json` do projeto.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Mapeamento de Fontes de Dados (De-Para Crítico)

### Página 1: Produtos Vendidos

| Dado | Fonte Oficial | Fonte Nossa | Adaptação Necessária |
|------|---------------|-------------|---------------------|
| Vendas por período (qty + revenue por item) | `ml_product_daily_cache` (date range, paginação paralela 5 páginas) | `orders` WHERE `status='paid'` AND `data_pedido` (TEXT) ≥ fromDate AND ≤ toDate + `.range()` paginado | Padrão Phase 73: loop de paginação com `.range(0, 999)`, `data_pedido` TEXT → cast `.slice(0,10)` para extrair YYYY-MM-DD. GROUP BY `item_id` client-side. |
| Marca do anúncio | `ml_product_daily_cache.marca` | `orders.marca` (coluna existe — foi adicionada na Phase 36, migration `20260604000000_product_cache_add_marca.sql`) OU `ml_inventory_cache.brand` | `orders.marca` é a mais simples (mesmo loop de paginação). `ml_inventory_cache.brand` como fallback para itens sem venda no período. |
| Categoria do anúncio | `ml_product_daily_cache.category_id` (existe no oficial?) | `ml_inventory_cache.category_id` (existe: `20260519150000_ml_inventory_cache.sql`) | **`ml_product_daily_cache` em nosso projeto NÃO tem `category_id`.** Para categoria, precisar fazer join com `ml_inventory_cache`. Alternativa: mostrar só Marcas (mais simples) e deixar Categoria como opcional (o oficial tem `pvView === "marca" | "categoria"` — replicar o toggle). |
| Título do anúncio | `items` (useMLInventory) → `item.title` | `orders.titulo` OU `ml_inventory_cache.title` | `orders.titulo` está disponível na query de vendas. Usar `titulo` do orders como fallback, ou cruzar com `useMLInventory().items` em memória (já disponível). |
| Thumbnail do anúncio | `items` (useMLInventory) → `item.thumbnail` | `ml_inventory_cache.thumbnail` via `useMLInventory().items` (já em memória) | Cross-reference por `item_id` com o array `items` em memória. Sem query extra. |
| Estoque do anúncio | `items.available_quantity` | `ml_inventory_cache.available_quantity` via `useMLInventory().items` | Idem — cross-reference em memória. |
| `resolvedMLUserIds` para filtro de loja | `useMLStore().resolvedMLUserIds` | `useMLStore().resolvedMLUserIds` (existe em `src/contexts/MLStoreContext.tsx` linha 73) | **Idêntico.** Usar `.in("ml_user_id", resolvedMLUserIds)` no filtro de `orders`. |
| Datas do período | `rankingDates` (derivado do `rankingPeriod`/`rankingRange`) | `useMLFilters(30)` — `currentFrom`/`currentTo` | A página nova deve ter seu próprio `useMLFilters` e `MLPeriodPicker` (autossuficiente). Ver padrão de `AnaliseDashboard.tsx`. |
| pvGroups (lista de marcas com qty+revenue) | Derivado de `rankingAll` (array de items com sold+revenue) | Derivado client-side dos rows de `orders` agrupados por `marca` | `Map<marca, {qty, revenue}>` reduzida client-side. Idêntico ao oficial. |
| pvItems (anúncios do grupo selecionado) | Filtro sobre `rankingAll` por `brand === pvSelected` | Filtro sobre os rows de `orders` por `marca === pvSelected` | Idem — filtrar os rows acumulados. |
| groupShare (% de participação) | `pvItems[i].revenue / totalRev` | Idem | Client-side. |

### Página 2: Análise de Preços

| Dado | Fonte Oficial | Fonte Nossa | Adaptação Necessária |
|------|---------------|-------------|---------------------|
| Série temporal preço (bucket, preco_medio, preco_min, preco_max, qtd, total, orders) | RPC `orders_price_timeseries` (migration `20260630170000_orders_price_timeseries.sql` no oficial) | **NÃO EXISTE em nosso projeto** | **Criar migration** portando a RPC do oficial. Ver seção "Migration orders_price_timeseries" abaixo. |
| Lista de anúncios selecionáveis (priceReportProducts) | `rankingAll` ordenado por `sold` desc → `{id, title}` | Query direta de `orders` agrupando por `item_id, titulo` ORDER BY SUM(quantidade) DESC, dentro do período | Ou: cruzar `useMLInventory().items` com os aggregated results por item. Recomendar: query direta `orders` com SELECT DISTINCT `item_id, titulo` WHERE status='paid' AND data_pedido no período, paginado. |
| `mlUserIds` para filtro de loja | `resolvedMLUserIds` | `useMLStore().resolvedMLUserIds` | **Idêntico.** |
| Datas do período | `rankingDates` (fromDate, toDate) | `useMLFilters(30)` | Página nova com seu próprio `useMLFilters`. |

### Migration orders_price_timeseries para nosso projeto [VERIFIED: inspeção de `20260630170000_orders_price_timeseries.sql` no oficial]

A RPC do oficial usa `o.data_pedido >= _from` onde `_from` é tipo `date`. Em nosso projeto, `data_pedido` é armazenado como **TEXT** (confirmado: `73-CONTEXT.md` e migration `20260521300000` com `p_data_pedido TEXT`). Adaptação necessária: usar cast `o.data_pedido::date` no filtro de data.

A RPC deve ser SECURITY INVOKER (não DEFINER) para respeitar RLS de `orders` (padrão do projeto — Phase 63, Phase 69).

```sql
-- Portada de /root/garment-glow-official/supabase/migrations/20260630170000_orders_price_timeseries.sql
-- Adaptação: data_pedido TEXT → cast ::date; status inclui 'paid'/'shipped'/'delivered'
CREATE OR REPLACE FUNCTION public.orders_price_timeseries(
  _item_id      text,
  _ml_user_ids  text[] DEFAULT NULL,
  _from         date   DEFAULT NULL,
  _to           date   DEFAULT NULL,
  _granularity  text   DEFAULT 'day'
)
RETURNS TABLE(bucket date, preco_medio numeric, preco_min numeric, preco_max numeric, qtd bigint, total numeric, orders bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT date_trunc(
           CASE WHEN lower(_granularity) IN ('week','month') THEN lower(_granularity) ELSE 'day' END,
           o.data_pedido::date  -- ADAPTAÇÃO: cast TEXT→date (nosso schema usa TEXT)
         )::date AS bucket,
         (SUM(o.receita_bruta) / NULLIF(SUM(o.quantidade), 0))::numeric AS preco_medio,
         MIN(o.preco_unit)::numeric AS preco_min,
         MAX(o.preco_unit)::numeric AS preco_max,
         SUM(o.quantidade)::bigint  AS qtd,
         SUM(o.receita_bruta)::numeric AS total,
         COUNT(*)::bigint AS orders
  FROM orders o
  WHERE o.item_id = _item_id
    AND o.status IN ('paid','shipped','delivered')
    AND (_ml_user_ids IS NULL OR array_length(_ml_user_ids,1) IS NULL OR o.ml_user_id = ANY(_ml_user_ids))
    AND (_from IS NULL OR o.data_pedido::date >= _from)
    AND (_to   IS NULL OR o.data_pedido::date <= _to)
  GROUP BY 1
  ORDER BY 1;
$function$;
-- Sem GRANT extra: SECURITY INVOKER com RLS de orders já garante isolamento de org.
```

**Nota sobre `data_pedido` TEXT:** A RPC usa `::date` para converter. No client TS, passar os parâmetros `_from`/`_to` como strings `"YYYY-MM-DD"` (PostgREST coerce automaticamente).

---

## Architecture Patterns

### System Architecture Diagram

```
Página /produtos-vendidos                    Página /analise-precos
─────────────────────────────────            ──────────────────────────────────
MLPeriodPicker + MLStoreSelector             MLPeriodPicker + MLStoreSelector
(useMLFilters + useMLStore)                  (useMLFilters + useMLStore)
        │                                             │
        ▼                                             ▼
useMLSoldProductsData (hook novo)            usePrecoPraticadoData (hook novo)
  → supabase.from("orders")                   → supabase.rpc("orders_price_timeseries")
    .select("item_id,titulo,marca,            (item_id, mlUserIds, fromDate, toDate, granularity)
     quantidade,receita_bruta,                         │
     data_pedido,ml_user_id")                          ▼
    .eq("status","paid")                     PrecoPraticadoReport (portado do oficial)
    .gte/.lte("data_pedido", dates)          ComposedChart recharts
    .in("ml_user_id", resolvedIds)           KPICard × 6
    .range() paginado                        Command/Popover seletor anúncio
        │
        ▼
Agregação client-side:
  Map<marca, {qty, revenue}> → pvGroups
  Cross-ref useMLInventory.items → thumbnail, stock
        │
   ┌────┴────┐
   ▼          ▼
Painel Esq.  Painel Dir.
(pvGroups)   (pvItems do grupo selecionado)
Card lista   Table: thumbnail, título, vendidos, vendas, estoque, %part
```

### Recommended Project Structure

```
src/
├── pages/mercadolivre/
│   ├── MLProdutosVendidos.tsx     # Página nova — "Produtos Vendidos"
│   └── MLAnalisePrecos.tsx        # Página nova — "Análise de Preços"
├── hooks/
│   ├── useMLSoldProducts.ts       # Hook: query orders + agregação pvGroups/pvItems
│   └── (reusar PrecoPraticadoReport diretamente com hook interno)
├── components/mercadolivre/anuncios/
│   └── PrecoPraticadoReport.tsx   # Portado do oficial (já existe pasta analise/)
supabase/migrations/
│   └── 20260677000000_orders_price_timeseries.sql  # RPC nova
```

### Pattern 1: Página nova (padrão MLCompras)

**O que:** Lazy route em App.tsx + RoleRoute + ErrorBoundary + MLPageHeader.
**Quando:** Toda página nova no projeto.

```tsx
// App.tsx — adicionar junto das outras lazy imports
const MLProdutosVendidos = React.lazy(() => import("./pages/mercadolivre/MLProdutosVendidos"));
const MLAnalisePrecos    = React.lazy(() => import("./pages/mercadolivre/MLAnalisePrecos"));

// Dentro do bloco de rotas protegidas (junto com /compras, /fluxo-de-caixa, etc.):
<Route path="/produtos-vendidos" element={
  <RoleRoute><ErrorBoundary fallbackTitle="Erro em Produtos Vendidos"><MLProdutosVendidos /></ErrorBoundary></RoleRoute>
} />
<Route path="/analise-precos" element={
  <RoleRoute><ErrorBoundary fallbackTitle="Erro em Análise de Preços"><MLAnalisePrecos /></ErrorBoundary></RoleRoute>
} />
```

### Pattern 2: roleAccess.ts (OBRIGATÓRIO — default-deny)

**Pitfall Phase 54:** `/consultor` não estava em `roleAccess.ts` → redirecionava para /vendas. NUNCA esquecer.

```tsx
// src/config/roleAccess.ts — adicionar junto de /compras, /fluxo-de-caixa, etc.
const OPERATIONAL: OrgRole[] = ["owner", "admin", "member"];

export const roleAccess: Record<string, OrgRole[]> = {
  // ... existentes ...
  "/produtos-vendidos": OPERATIONAL,  // análise analítica — mesmo nível que /compras
  "/analise-precos": OPERATIONAL,
};
```

### Pattern 3: Menu lateral (ApiSidebar.tsx)

**O que:** Adicionar 2 itens no array `children` do grupo "Dashboard".

```tsx
// src/components/layout/ApiSidebar.tsx
// Grupo Dashboard atualmente tem: Vendas, Consultor, Publicidade, Margem
// Adicionar ao final do array children:
{ icon: ShoppingBag, label: "Produtos Vendidos", path: "/produtos-vendidos" },
{ icon: LineChart,   label: "Análise de Preços", path: "/analise-precos"   },

// Ícones sugeridos (já no lucide-react):
// ShoppingBag — já usado em "Anúncios" (Operações)
// LineChart ou TrendingUp ou BarChart2 — análise de preços
// Reconsiderar se houver conflito visual; alternativas: PackageSearch, Activity
```

### Pattern 4: Hook de query paginada de orders (padrão Phase 73)

```typescript
// src/hooks/useMLSoldProducts.ts — padrão IDÊNTICO ao useMLListingSales da Phase 73
const PAGE     = 1_000;
const MAX_ROWS = 50_000;

const { data, error } = await supabase
  .from("orders")
  .select("item_id, titulo, marca, quantidade, receita_bruta, data_pedido, ml_user_id")
  .eq("status", "paid")
  .gte("data_pedido", fromDate)   // data_pedido é TEXT — string "YYYY-MM-DD" funciona
  .lte("data_pedido", toDate)
  .in("ml_user_id", resolvedMLUserIds)  // quando > 1 loja
  .range(offset, offset + PAGE - 1);

// Agregação client-side após paginar tudo:
const pvGroupsMap = new Map<string, { qty: number; revenue: number }>();
for (const row of allRows) {
  const key = pvView === "marca" ? (row.marca ?? "Sem marca") : "...";
  // ...acumular...
}
```

### Pattern 5: PrecoPraticadoReport (portado do oficial)

O componente `PrecoPraticadoReport` do oficial é **quase plug-and-play**. Mudanças necessárias:
1. Props `products`, `mlUserIds`, `fromDate`, `toDate` — derivados localmente na página nova.
2. O campo `request` (deep-link) é opcional — pode ser `null` se não implementar o atalho da coluna Preços.
3. A chamada `supabase.rpc("orders_price_timeseries", {...})` funciona após criar a migration.
4. O componente importa `KPICard` de `@/components/dashboard/KPICard` — existe no projeto.
5. Remover o cast `as any` no `supabase.rpc` após a migration criar os tipos (ou manter o cast — já é o padrão do projeto).

### Anti-Patterns to Avoid

- **Usar `/anuncios?report=precos`:** No oficial, a Análise de Preços é uma sub-aba de `/anuncios`. Em nosso projeto, Wesley decidiu: páginas independentes com rotas próprias. Não adicionar sub-abas em `MLAnuncios.tsx`.
- **Esquecer de registrar a rota em `roleAccess.ts`:** Causa default-deny silencioso (redirecionamento para /vendas sem erro visível). Pitfall confirmado na Phase 54.
- **Subquery correlacionada na RPC:** A `orders_price_timeseries` usa `GROUP BY date_trunc(...)` sobre a tabela filtrada por `item_id` — sem subquery correlacionada, sem risco de timeout.
- **Não paginar a query de orders:** PostgREST trunca em 1000 linhas. Para períodos > 30 dias com múltiplos anúncios, facilmente > 1000 rows. Usar `.range()` loop.
- **Usar `ml_product_daily_cache` para `category_id`:** Em nosso projeto, essa tabela NÃO tem `category_id`. Para categorias, usar `ml_inventory_cache` via cross-reference com `useMLInventory().items` (já em memória).

---

## Don't Hand-Roll

| Problema | Não Construir | Usar Existente | Por Quê |
|----------|---------------|----------------|---------|
| Gráfico ComposedChart (barras + linha dual-axis) | Implementação própria SVG | `recharts` — exatamente como o oficial usa em PrecoPraticadoReport | Já no projeto; o código do oficial já tem a implementação exata a portar |
| Seletor de anúncio com busca | Input+dropdown custom | `Command`/`Popover` (cmdk + shadcn) — exatamente como o oficial usa | Já no projeto; o código do oficial já tem a implementação |
| Paginação de `orders` | Carregar 1 página e esperar | Loop `.range()` idêntico ao Phase 73 / oficial (PARALLEL 5 ou sequencial) | PostgREST trunca 1000 linhas; padrão documentado e testado |
| Filtro de período | State/DatePicker custom | `useMLFilters(30)` + `MLPeriodPicker` — existem no projeto, usados em `AnaliseDashboard.tsx` | Roda na Phase 73 e em múltiplas páginas; reusar evita inconsistência |
| Filtro de loja | State + fetch custom | `useMLStore().resolvedMLUserIds` + `MLStoreSelector` (se necessário) | Já existe, já propagado por contexto |
| Formatação moeda BRL | Função própria | `currencyFmt` do projeto (já usada em MLAnuncios, MLCompras, etc.) | Padrão. Ou usar `brl()` local como o oficial faz em PrecoPraticadoReport |
| Data do bucket | `new Date(textField)` diretamente | `slice(0,10)` para TEXT ou cast `::date` na RPC | Lição Phase 63: `data_pedido` TEXT → comportamento de `new Date()` imprevisível com fuso |

---

## Common Pitfalls

### Pitfall 1: `category_id` não existe em `ml_product_daily_cache` no nosso projeto
**O que vai errado:** O oficial deriva categorias de `ml_product_daily_cache.category_id`. Em nosso projeto, essa coluna não existe na tabela (ela existe em `ml_inventory_cache`).
**Por que acontece:** O oficial tem um schema ligeiramente diferente do nosso.
**Como evitar:** Para o toggle Marca/Categoria na aba Produtos Vendidos: usar `orders.marca` para marcas + cross-reference `item_id` → `ml_inventory_cache.category_id` via `useMLInventory().items` (em memória) para categorias. Alternativa mais simples: entregar só a view Marca inicialmente (o Wesley pediu "marcas/categorias" mas se category_id não está em orders, é mais custoso).
**Sinal de alerta:** Query retorna `categoria = null` para todos os registros.

### Pitfall 2: `data_pedido` é TEXT — não `date` nem `timestamptz`
**O que vai errado:** `supabase.from("orders").gte("data_pedido", dateObj)` pode se comportar inesperadamente com um objeto Date.
**Por que acontece:** `data_pedido` foi armazenado como TEXT no nosso banco (upsert faz `p_data_pedido TEXT`).
**Como evitar:** Passar strings `"YYYY-MM-DD"` nos filtros `.gte("data_pedido", "2026-06-01")`. Na RPC, usar `o.data_pedido::date` para cast. Confirmado funcionando no Phase 73.
**Sinal de alerta:** Filtros de data retornam linhas de outros períodos.

### Pitfall 3: `orders_price_timeseries` não existe no nosso banco ainda
**O que vai errado:** `supabase.rpc("orders_price_timeseries", ...)` retorna erro de função desconhecida.
**Por que acontece:** A migration existe apenas no app oficial, não foi portada ao nosso projeto.
**Como evitar:** Criar a migration `20260677000000_orders_price_timeseries.sql` com a RPC adaptada (cast `data_pedido::date` ao invés de uso direto como date). Aplicar via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`.
**Sinal de alerta:** Console `Unhandled error: function orders_price_timeseries does not exist`.

### Pitfall 4: Rota não registrada em `roleAccess.ts` → default-deny silencioso
**O que vai errado:** Ao navegar para `/produtos-vendidos` ou `/analise-precos`, o usuário é redirecionado para `/vendas` sem mensagem de erro.
**Por que acontece:** `canAccess` retorna `false` para qualquer rota não mapeada.
**Como evitar:** Sempre registrar a rota em `roleAccess` antes do merge. Pitfall vivido na Phase 54 com `/consultor`.
**Sinal de alerta:** Clicar no item do menu redireciona instantaneamente para outra página.

### Pitfall 5: Não paginar query de `orders` → dados truncados
**O que vai errado:** Painel Produtos Vendidos mostra apenas os primeiros 1000 pedidos do período, subestimando vendas de alguns anúncios.
**Por que acontece:** PostgREST trunca em 1000 rows sem aviso.
**Como evitar:** Usar loop de paginação `.range(offset, offset + 999)` igual ao Phase 73 e ao oficial. Usar `MAX_ROWS = 50000` como teto de segurança.
**Sinal de alerta:** Total de receita na página difere do painel de Vendas (/).

### Pitfall 6: `resolvedMLUserIds` vazio → não filtrar por loja
**O que vai errado:** Se `resolvedMLUserIds` for array vazio, `.in("ml_user_id", [])` pode retornar 0 resultados.
**Por que acontece:** Quando não há lojas ML conectadas.
**Como evitar:** Guard `if (!resolvedMLUserIds?.length) return;` antes de disparar a query. O oficial usa `if (resolvedMLUserIds && resolvedMLUserIds.length > 0) q = q.in(...)` — replicar.

### Pitfall 7: Mobile — interações por item nos DOIS layouts
**O que vai errado:** Em mobile (< lg), tabelas são substituídas por cards. Se clicar no grupo da lista esquerda só funcionar na tabela desktop, mobile fica quebrado.
**Por que acontece:** Padrão dual-layout documentado em `feedback_mlanuncios_dual_layout.md`.
**Como evitar:** O painel de Produtos Vendidos usa uma lista de botões (não tabela) para pvGroups — mobile nativo. A tabela direita de pvItems precisa usar `ResponsiveTable` ou implementar o padrão de cards mobile. Verificar no mobile antes do verifier.

---

## Code Examples

### Exemplo 1: Estrutura de pvGroups derivada de orders (Produtos Vendidos)
```typescript
// Padrão idêntico ao oficial, adaptado para nossa fonte (orders)
// Source: inspeção MLAnuncios.tsx oficial linhas 1328-1342
const pvGroupsMap = new Map<string, { qty: number; revenue: number }>();
for (const row of allOrderRows) {
  const key = pvView === "marca"
    ? (row.marca ?? "")
    : (itemsMap.get(row.item_id)?.category_id ?? ""); // cross-ref ml_inventory_cache
  const prev = pvGroupsMap.get(key) ?? { qty: 0, revenue: 0 };
  pvGroupsMap.set(key, {
    qty: prev.qty + row.quantidade,
    revenue: prev.revenue + row.receita_bruta,
  });
}
const pvGroups = Array.from(pvGroupsMap.entries())
  .map(([key, d]) => ({
    key,
    name: pvView === "marca" ? (key || "Sem marca") : (key || "Sem categoria"),
    ...d,
  }))
  .sort((a, b) => b.revenue - a.revenue);
```

### Exemplo 2: PrecoPraticadoReport.tsx — chamada RPC
```typescript
// Source: inspeção PrecoPraticadoReport.tsx oficial (linhas 128-155)
const { data, error } = await (supabase.rpc as any)("orders_price_timeseries", {
  _item_id: selectedId,
  _ml_user_ids: mlUserIds && mlUserIds.length > 0 ? mlUserIds : null,
  _from: fromDate,   // "YYYY-MM-DD" string ou null
  _to: toDate,       // "YYYY-MM-DD" string ou null
  _granularity: granularity,  // "day" | "week" | "month"
});
```

### Exemplo 3: Paginação de orders (padrão Phase 73)
```typescript
// Source: inspeção useMLListingSales.ts + padrão loop oficial MLAnuncios.tsx linhas 806-842
const PAGE = 1_000;
const MAX_ROWS = 50_000;
let allRows: OrderRow[] = [];
let offset = 0;
let done = false;

while (!done && allRows.length < MAX_ROWS) {
  const { data, error } = await supabase
    .from("orders")
    .select("item_id, titulo, marca, quantidade, receita_bruta, data_pedido, ml_user_id")
    .eq("status", "paid")
    .gte("data_pedido", fromDate)
    .lte("data_pedido", toDate)
    .in("ml_user_id", resolvedMLUserIds)
    .range(offset, offset + PAGE - 1);
  if (error || !data || data.length === 0) { done = true; break; }
  allRows.push(...(data as OrderRow[]));
  if (data.length < PAGE) done = true;
  offset += PAGE;
}
```

### Exemplo 4: Registro de rota (padrão consolidado do projeto)
```tsx
// App.tsx — lazy import (linha ~40 do arquivo atual)
const MLProdutosVendidos = React.lazy(() => import("./pages/mercadolivre/MLProdutosVendidos"));
const MLAnalisePrecos    = React.lazy(() => import("./pages/mercadolivre/MLAnalisePrecos"));

// Bloco de rotas (linha ~144 do arquivo atual, junto com /compras):
<Route path="/produtos-vendidos" element={
  <RoleRoute><ErrorBoundary fallbackTitle="Erro em Produtos Vendidos"><MLProdutosVendidos /></ErrorBoundary></RoleRoute>
} />
<Route path="/analise-precos" element={
  <RoleRoute><ErrorBoundary fallbackTitle="Erro em Análise de Preços"><MLAnalisePrecos /></ErrorBoundary></RoleRoute>
} />
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dados de vendas por produto em sub-abas de /anuncios | Páginas independentes com rotas próprias (decisão Wesley) | Phase 77 | Navegação mais direta; sem poluir MLAnuncios.tsx |
| Agregação de grupos marca/categoria server-side (possível) | Client-side sobre rows de `orders` | Phase 73 (padrão) | Evita RPC; RLS org-scoped pelo client já garante isolamento |
| `ml_product_daily_cache` como fonte de vendas por anúncio | `orders` diretamente para análises ad-hoc | Phases 73, 77 | `ml_product_daily_cache` não tem category_id nem detalhes de preço unitário |

**Deprecated/outdated:**
- Usar `ml_orders` como nome de tabela: **a tabela real é `orders`** (pitfall documentado na Phase 63).
- Usar `supabase.rpc()` sem guard de itens: pode retornar dados cross-org se SECURITY DEFINER sem RLS.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ml_product_daily_cache` em nosso projeto NÃO tem `category_id` — confirmado por inspeção das migrations | Mapeamento de Fontes | Se existir, simplifica o caminho de categoria. Baixo risco. |
| A2 | `orders.marca` é populada pela EF `mercado-libre-integration` (Phase 36 adicionou `marca` no cache, a migration de batch_upsert confirma a coluna) | Mapeamento de Fontes | Se `marca` for nula para muitos orders, a view por Marca terá dados vazios. Verificar em prod antes de confirmar. |
| A3 | `useMLInventory().items` está disponível globalmente nas páginas filhas do LayoutShell (via `MLInventoryContext`) | Architecture | Se não estiver disponível em `/produtos-vendidos`, precisar de query separada de `ml_inventory_cache`. Baixo risco — Context wraps toda a app. |
| A4 | Nomes de rotas sugeridos: `/produtos-vendidos` e `/analise-precos` (PT-BR, consistentes) | Pattern 3 | A critério do planner — o CONTEXT.md diz "nomes finais a critério do planner". Risco zero. |
| A5 | `data_pedido` em nosso banco é armazenado como TEXT (confirmar vs. timestamptz) | Pitfall 2 | Phase 73 CONTEXT diz TEXT; migrations confirmam `p_data_pedido TEXT` no upsert. Se for timestamptz, o `.gte("data_pedido", "YYYY-MM-DD")` ainda funciona (PostgREST converte). Baixo risco. |

---

## Open Questions (RESOLVED)

1. **Categoria em Produtos Vendidos: usar `orders.marca` + cross-ref `ml_inventory_cache.category_id` ou só exibir Marcas?** — RESOLVED: implementar toggle Marca/Categoria; Categoria via cross-ref com `useMLInventory().items` em memória; anúncios ausentes do inventory caem em "Sem categoria".
   - O que sabemos: `orders` não tem `category_id`; `ml_inventory_cache` tem mas requer cross-reference por `item_id` em memória.
   - O que está incerto: Se `useMLInventory().items` cobrirá todos os `item_id` presentes nos orders do período (anúncios pausados/encerrados podem não estar em inventory).
   - Recomendação: Implementar toggle Marca/Categoria; para Categoria, usar cross-ref com `items` em memória (exatamente como o oficial faz com `i.category_id`). Para anúncios não encontrados no inventory, usar "Sem categoria".

2. **Atalho da coluna Preços (`openPriceAnalysis`):** — RESOLVED: deep-link `/analise-precos?item=MLB...` lido via `useSearchParams()`; feature OPCIONAL conforme CONTEXT.md.
   - O oficial implementa um botão na coluna "Preços" da tabela de Produtos Vendidos que abre a Análise de Preços com o anúncio pré-selecionado. No oficial: `window.open(url + "?report=precos&item=MLB...", "_blank")`.
   - Em nosso projeto, a rota seria `/analise-precos?item=MLB...` com `useSearchParams()` para pré-selecionar.
   - Recomendação: Implementar como deep-link `?item=MLB...` se a página de Análise de Preços ler `useSearchParams()` — simples, sem acoplamento. Registrar como opcional (CONTEXT.md: "OPCIONAL").

3. **`orders.titulo` vs `ml_inventory_cache.title` como nome do anúncio:** — RESOLVED: usar `ml_inventory_cache.title` via cross-ref quando disponível, com fallback para `orders.titulo`.
   - `orders.titulo` pode estar desatualizado (título pode ter mudado após a venda).
   - `ml_inventory_cache.title` é o título atual.
   - Recomendação: Usar `ml_inventory_cache.title` via cross-ref (via `useMLInventory().items`) quando disponível, com fallback para `orders.titulo`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase `orders` table com cols `item_id, titulo, marca, quantidade, receita_bruta, data_pedido, ml_user_id, status` | Produtos Vendidos | ✓ | — (confirmado via migrations) | — |
| Supabase `ml_inventory_cache` com `category_id, brand, thumbnail, available_quantity` | Produtos Vendidos (cross-ref) | ✓ | — (confirmado via migration `20260519150000`) | — |
| RPC `orders_price_timeseries` | Análise de Preços | ✗ (não existe no nosso projeto) | — | **Criar migration** — bloqueante |
| `useMLFilters` hook | Ambas as páginas | ✓ | — (`src/hooks/useMLFilters.ts`) | — |
| `useMLStore().resolvedMLUserIds` | Ambas as páginas | ✓ | — (`src/contexts/MLStoreContext.tsx`) | — |
| `useMLInventory().items` | Produtos Vendidos (cross-ref) | ✓ | — (`src/contexts/MLInventoryContext.tsx`) | — |
| `MLPeriodPicker` | Ambas as páginas | ✓ | — (`src/components/mercadolivre/MLPeriodPicker.tsx`) | — |
| `KPICard` | Análise de Preços | ✓ | — (`src/components/dashboard/KPICard.tsx`) | — |
| Componente `Command`/`Popover` de shadcn | Análise de Preços (seletor anúncio) | ✓ | — (cmdk 1.1.1 instalado) | — |
| `ToggleGroup`/`ToggleGroupItem` de shadcn | Análise de Preços (granularidade/volume) | ✓ | — (Radix installado) | — |

**Missing dependencies with no fallback:**
- RPC `orders_price_timeseries` — precisa de migration. Não é opcional: Análise de Preços depende dela.

---

## Validation Architecture

> `nyquist_validation: false` em `.planning/config.json` — seção OMITIDA conforme regra.

---

## Security Domain

> `security_enforcement` não está configurado como `false` no config — aplicando por padrão.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | sim | Supabase Auth + ProtectedRoute — já implementado |
| V4 Access Control | sim | RLS em `orders` (org-scoped) + `roleAccess.ts` (default-deny) |
| V5 Input Validation | sim | Validar `fromDate`/`toDate` como strings ISO antes de enviar ao RPC; validar `item_id` como string não-nula |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR via query `orders` de outra org | Elevation of Privilege | RLS org-scoped no client autenticado (já em produção) — SECURITY INVOKER na RPC |
| RPC SECURITY DEFINER com parâmetro org | Elevation of Privilege | Usar SECURITY INVOKER (sem parâmetro org) — padrão Phase 63/69 |
| Query sem paginação retorna dados truncados | Tampering (dados incompletos) | Loop `.range()` obrigatório; MAX_ROWS como teto |
| Rota nova sem registro em roleAccess | Broken Access Control | SEMPRE registrar antes do merge — padrão Phase 54 |

---

## Project Constraints (from CLAUDE.md)

- **Stack:** React 18 + TypeScript + Vite + shadcn/ui + recharts + TanStack Query. Não usar Next.js patterns.
- **Routing:** react-router-dom 6 (SPA). Lazy com `React.lazy()`.
- **Charts:** recharts (não alternatives).
- **Auth:** Supabase Auth com `ProtectedRoute` + `RoleRoute`.
- **RPC:** SECURITY INVOKER sem parâmetro org (anti-IDOR).
- **Mobile:** `lg` breakpoint (1024px) para switch table→card. `useIsMobile()` só para lógica.
- **Sem novas dependências externas** — tudo que precisa já está instalado.
- **Supabase correto:** `ckcdevcxgvueywivefgx` (CLAUDE.md menciona o antigo `gionpsuunfkkzzjdubfy` — desatualizado; sempre usar `ckcdevcxgvueywivefgx`).

---

## Sources

### Primary (HIGH confidence)
- `/root/garment-glow-official/src/pages/mercadolivre/MLAnuncios.tsx` — inspecionado (linhas 665-843, 1164-1342, 2773-2941, 3029-3038) para entender `pvGroups`, `rankingAll`, `priceReportProducts`, `resolvedMLUserIds`, `rankingDates` e a query de `ml_product_daily_cache`
- `/root/garment-glow-official/src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — inspecionado integralmente; tipos `SeriesRow`/`PriceReportProduct`, chamada `orders_price_timeseries`, gráfico ComposedChart
- `/root/garment-glow-official/supabase/migrations/20260630170000_orders_price_timeseries.sql` — RPC SQL completa inspecionada
- `/root/garment-glow-test/src/config/roleAccess.ts` — mapa atual de rotas
- `/root/garment-glow-test/src/App.tsx` — padrão lazy route existente
- `/root/garment-glow-test/src/components/layout/ApiSidebar.tsx` — estrutura do menu com grupos e children
- `/root/garment-glow-test/src/contexts/MLStoreContext.tsx` — `resolvedMLUserIds` disponível
- `/root/garment-glow-test/src/contexts/MLInventoryContext.tsx` — `ProductItem` interface + `useMLInventory()`
- `/root/garment-glow-test/src/hooks/useMLFilters.ts` — `useMLFilters()` + `getFilterDates()`
- `/root/garment-glow-test/src/components/mercadolivre/anuncios/listingSalesAgg.ts` — padrão Phase 73
- `/root/garment-glow-test/src/components/mercadolivre/anuncios/useMLListingSales.ts` — padrão de paginação e query
- `/root/garment-glow-test/supabase/migrations/` — várias migrações inspecionadas para confirmar schema de `orders`, `ml_product_daily_cache`, `ml_inventory_cache`
- `73-CONTEXT.md` — confirmação que `data_pedido` é TEXT

### Secondary (MEDIUM confidence)
- `STATE.md` e `MEMORY.md` — histórico de decisões e pitfalls do projeto

---

## Metadata

**Confidence breakdown:**
- Mapeamento de fontes de dados: HIGH — inspecionado diretamente no código oficial e nas migrations do nosso projeto
- Migration `orders_price_timeseries` (adaptação): HIGH — SQL examinado; única mudança é o cast `::date`
- Padrão de página nova (App.tsx, roleAccess, ApiSidebar): HIGH — verificado no código real do projeto
- Coluna `orders.marca` populada em produção: MEDIUM — confirmada pela migration mas não verificada em prod ao vivo

**Research date:** 2026-07-01
**Valid until:** 30 dias (schema estável; App e stack maduros)
