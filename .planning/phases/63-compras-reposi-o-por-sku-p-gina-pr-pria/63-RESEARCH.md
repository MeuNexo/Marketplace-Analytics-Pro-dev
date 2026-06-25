# Phase 63: Compras — Reposição por SKU (página própria) - Research

**Researched:** 2026-06-25
**Domain:** Supabase RPC PostgreSQL + Edge Function sync + React SPA (shadcn/ui)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Reposição passa a ser por SKU/variação. Anúncio sem variação é tratado como um SKU único.
**D-02:** Ponte variação ML → custo/SKU do Tiny feita pelo SKU da própria variação no ML (`seller_custom_field` por variação). O sync de inventário (`ml-inventory` / `sync-ml-inventory`) passa a gravar `seller_custom_field` por variação. Join com `ml_product_costs.seller_sku`.
**D-03:** Custo nulo → sugere quantidade + flag `custo_ausente`, sem valor R$.
**D-04:** Velocidade por SKU vem de venda real, não rateada. O sync de vendas passa a gravar `seller_sku`/variação por item de pedido em `ml_product_daily_cache` (CMP-02). Hoje campo nulo no Pé Vermeio.
**D-05:** Anúncio sem variação → velocidade por item normal (já funciona).
**D-06:** Nova RPC (ou revisão de `get_replenishment`) opera por SKU: estoque por variação via unnest do jsonb `variations`; venda/dia por SKU; mantém modelo de ponto de reposição da Phase 62.
**D-07:** SECURITY INVOKER (anti-IDOR), paginação via `.range()`. Reaprovita `replenishmentUtils.ts`. Preferência: nova RPC `get_replenishment_by_sku`.
**D-08:** `replenishment_params` ganha escopo `sku`. Precedência SKU > marca > global.
**D-09:** UI de edição dos params na página `/compras`; write restrito a owner/admin.
**D-10:** Nova rota `/compras`; remover aba de `/estoque`. Acesso owner/admin/member.
**D-11:** Filtros (CMP-06) + drill anúncio→variações (CMP-08) + exportação xlsx.

### Claude's Discretion

- Forma exata da UI dos filtros e do drill (flat por SKU vs agrupado por anúncio com expand).
- Estrutura da edição de params (modal vs aba).
- Se RPC por SKU substitui `get_replenishment` ou nasce como `get_replenishment_by_sku` — preferência do contexto: nova RPC.
- Fonte exata para velocidade por SKU: se usa `ml_orders` diretamente no RPC (sem mudança de schema) ou se adiciona `variation_id` em `ml_product_daily_cache` (mudança de schema).

### Deferred Ideas (OUT OF SCOPE)

- Ordens de Compra / recebimento.
- Descontar "a chegar" (OC).
- Override por fornecedor nos params.
- Fallback ponte via Tiny (só se ML não retornar SKU por variação — mas retorna, via endpoint dedicado).
- Multi-loja (Thales) — foco no Pé Vermeio.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CMP-01 | Sync inventário grava SKU por variação | Confirmado: `sync-ml-inventory` precisa de segundo-passe por `/items/{id}/variations/{variationId}` — EF de exibição (`ml-inventory`) já faz isso, a de sync não faz |
| CMP-02 | Sync vendas grava seller_sku/variação por item | `ml_orders` já tem `variation_id`; abordagem via `ml_orders` direto na RPC não precisa de schema change em `ml_product_daily_cache` |
| CMP-03 | RPC reposição por SKU — unnest jsonb variations, anúncio sem variação = SKU único | Padrão `jsonb_to_recordset` documentado; SECURITY INVOKER confirmado |
| CMP-04 | Custo casado por SKU corrige "custo ausente" | Join `ml_product_costs.seller_sku = variation.seller_custom_field` — mesmo padrão LATERAL da Phase 62 |
| CMP-05 | Params editáveis por UI, precedência SKU>marca>global, write owner/admin | Adicionar `scope = 'sku'` no CHECK da tabela; RLS write já é owner/admin |
| CMP-06 | Filtros: marca, status/gatilho, sem giro, com/sem custo, busca título/SKU/tamanho | Padrão shadcn Select + Input + useMemo; sem nova dependência |
| CMP-07 | Rota /compras + nav; aba removida de /estoque; legacy compraUtils intocado | 4 arquivos de roteamento/nav + 1 remoção em MLEstoque.tsx |
| CMP-08 | Drill anúncio→variações + exportação | Radix Collapsible para expand; xlsx padrão TopSellingProducts.tsx |
| CMP-09 | Testes por SKU + anti-IDOR SECURITY INVOKER + sem regressão | `replenishmentUtils.ts` já tem 203 testes; estender para nível SKU; SECURITY INVOKER pattern confirmado |
</phase_requirements>

---

## Summary

Esta fase evolui a Phase 62 (reposição por anúncio) para operar por SKU/variação. Há três camadas independentes de trabalho: (1) fundação de dados — gravar SKU por variação no sync de inventário e derivar velocidade por variação no banco; (2) motor de reposição — nova RPC `get_replenishment_by_sku` que faz unnest do jsonb `variations` e cruza com custos por SKU; (3) frontend — nova página `/compras` com filtros, drill e export, removendo a aba atual de `/estoque`.

A descoberta mais importante da pesquisa é que o bloqueante do CMP-01 **já está 80% resolvido no código**: a EF `ml-inventory` (usada para exibição) já possui o segundo-passe que chama `/items/{id}/variations/{variationId}` para obter o `seller_custom_field` por variação, e a função `resolveSku` cobre `seller_custom_field` e o atributo `SELLER_SKU`. O gap é que a EF `sync-ml-inventory` (que grava no banco) não tem este segundo-passe — é uma adição de ~30 linhas de código.

Para CMP-02, a alternativa mais simples e sem risco de quebrar o schema existente é calcular a velocidade por SKU diretamente da tabela `ml_orders` (que já tem `variation_id` por linha de pedido) dentro da nova RPC, sem tocar em `ml_product_daily_cache`. Esta abordagem está dentro da discretion do Claude conforme o CONTEXT.md.

**Primary recommendation:** Nova RPC `get_replenishment_by_sku` (SECURITY INVOKER, padrão Phase 62/59) com quatro CTEs — stock_by_sku (unnest jsonb), sales_by_sku (de ml_orders), params_by_sku (COALESCE SKU>marca>global), base. Fix do `sync-ml-inventory` para popular `seller_custom_field` por variação. Página `/compras` seguindo padrão de tabela shadcn/ui já estabelecido.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SKU por variação (inventário) | Edge Function (`sync-ml-inventory`) | ML API `/items/{id}/variations/{vid}` | A EF é o único escritor do `ml_inventory_cache`; ML API é a fonte de verdade |
| Velocidade por SKU (CMP-02) | PostgreSQL RPC | `ml_orders` (tabela existente) | Evita schema change em `ml_product_daily_cache`; ml_orders já tem variation_id |
| Motor de reposição por SKU | PostgreSQL RPC (SECURITY INVOKER) | — | Mesmo padrão Phase 62; anti-IDOR via RLS org-first |
| Custos por SKU | PostgreSQL LATERAL JOIN | `ml_product_costs.seller_sku` | LATERAL já validado na Phase 62; chave = `seller_custom_field` por variação |
| Params editáveis | PostgreSQL table + RLS | Frontend CRUD | write gateado a owner/admin pela RLS existente |
| Filtros e drill | Browser (React/useMemo) | — | Dataset pequeno; filtragem client-side é suficiente |
| Exportação xlsx | Browser (XLSX lib) | — | Padrão TopSellingProducts.tsx já validado |
| Navegação `/compras` | Frontend SPA | `roleAccess.ts` | Rota client-side; roleAccess como gate estático |

---

## Standard Stack

### Core (já no projeto — sem nova dependência)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | 2.98.0 | RPC call `get_replenishment_by_sku` | Padrão do projeto [VERIFIED: codebase] |
| `@tanstack/react-query` | 5.83.0 | hook `useReplenishmentBySku` | Padrão de fetching de dados [VERIFIED: codebase] |
| `react-hook-form` + `zod` | 7.61.1 + 3.25.76 | CRUD de params | Padrão de formulários [VERIFIED: codebase] |
| `xlsx` (SheetJS) | 0.20.3 | Exportação xlsx | Já importado em `ImportacaoCustos.tsx` e `TopSellingProducts.tsx` [VERIFIED: codebase] |
| shadcn/ui (`Collapsible`, `Dialog`, `Select`) | — | Drill + params modal + filtros | Todos os primitivos já instalados [VERIFIED: codebase] |

**Installation:** nenhuma nova dependência necessária.

---

## Package Legitimacy Audit

> Nenhum pacote novo a instalar nesta fase. Todas as dependências já estão no projeto.

| Package | Verdict | Disposition |
|---------|---------|-------------|
| (nenhum novo) | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## CMP-01: Análise do Bloqueante — SKU por Variação no Sync

### Achado Crítico [VERIFIED: codebase]

O bloqueante **não é a API do ML** — é um gap entre duas EFs:

**`ml-inventory/index.ts`** (EF de exibição, não grava no banco):
```typescript
// linhas 196-226 — segundo-passe explícito
// "Neither multi-get nor full item GET (/items/{id}) returns variation.attributes.
//  Only GET /items/{id}/variations/{variationId} returns the full attributes array."
if (variationFetches.length > 0) {
  // chama /items/${item.id}/variations/${variation.variation_id}
  variation.seller_custom_field = resolveSku(fullVar) ?? variation.seller_custom_field;
}
```

**`sync-ml-inventory/index.ts`** (EF que GRAVA em `ml_inventory_cache`):
```typescript
// linhas 199-210 — SEM segundo-passe
const variations = rawVars.map((v: any) => ({
  ...
  seller_custom_field: resolveSku(v),  // null — multi-get não retorna isso por variação
}));
// Salva diretamente no banco sem buscar /items/{id}/variations/{variationId}
```

A função `resolveSku` nos dois arquivos é idêntica:
```typescript
const resolveSku = (obj: any): string | null =>
  obj.seller_custom_field
    ?? (obj.attributes as any[] | undefined)?.find((a: any) => a.id === "SELLER_SKU")?.value_name
    ?? null;
```

O multi-get (`/items?ids=...`) não retorna `seller_custom_field` nem `attributes` a nível de variação — apenas retorna o array `variations` com `id`, `attribute_combinations` (Color/Size), `available_quantity`, `sold_quantity`, `price`. O endpoint dedicado `/items/{id}/variations/{variationId}` retorna o payload completo da variação incluindo `seller_custom_field` e o array `attributes` (que contém `SELLER_SKU`).

### Fix para CMP-01 [ASSUMED: planner confirma estratégia de concorrência]

Adicionar segundo-passe em `sync-ml-inventory/index.ts` após a construção de `rows`, **antes** do upsert:

```typescript
// Segundo-passe: enriquecer seller_custom_field por variação
// (multi-get não retorna variation.seller_custom_field)
const variationFetches: Array<{ rowIdx: number; varIdx: number }> = [];
for (let ri = 0; ri < rows.length; ri++) {
  if (rows[ri].has_variations) {
    for (let vi = 0; vi < rows[ri].variations.length; vi++) {
      variationFetches.push({ rowIdx: ri, varIdx: vi });
    }
  }
}
const CONCURRENCY = 20;
for (let i = 0; i < variationFetches.length; i += CONCURRENCY) {
  const batch = variationFetches.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async ({ rowIdx, varIdx }) => {
    const row = rows[rowIdx];
    const variation = row.variations[varIdx];
    try {
      const fullVar = await mlFetch(
        `/items/${row.item_id}/variations/${variation.variation_id}`,
        access_token,
      );
      variation.seller_custom_field = resolveSku(fullVar) ?? variation.seller_custom_field;
    } catch (e) {
      console.warn(`Variation SKU fetch failed ${row.item_id}/${variation.variation_id}:`, e);
    }
  }));
}
```

**Risco de performance:** Pé Vermeio tem ~116 anúncios. Se metade tiver variações com média 4 variações = ~232 chamadas extras. A ~20 de concorrência = ~12 roundtrips de batch. Estimativa: +5–15 segundos. A EF não tem timeout hard limit, mas o default da invocação Supabase é 60s. Para catálogos maiores futuros, usar `EdgeRuntime.waitUntil` se necessário.

---

## CMP-02: Velocidade por SKU — Abordagem via `ml_orders` [ASSUMED: planner decide a abordagem]

### Estado Atual [VERIFIED: codebase]

`ml_product_daily_cache` tem unique constraint em `(organization_id, ml_user_id, date, item_id)` — sem `variation_id`. O campo `seller_sku` existe na tabela (migration `20260604120000`) mas `variation_id` não existe. O types.ts não inclui `seller_sku` nem `marca` (desatualizado — atualizar manualmente como convenção do projeto).

`ml_orders` tem `variation_id TEXT` e `quantidade INTEGER` por linha de pedido, confirmado em `types.ts` linhas 1400-1431 e no `expandOrder` de `sync-ml-orders`:
```typescript
variation_id: prod.variation_id ? String(prod.variation_id) : "",
```

### Abordagem Recomendada: Velocidade via `ml_orders` na RPC

CTE na nova RPC `get_replenishment_by_sku`:
```sql
WITH sales_by_sku AS (
  SELECT
    inv_var.item_id,
    inv_var.variation_id,
    COALESCE(SUM(o.quantidade), 0)::NUMERIC / NULLIF(p_sales_window_days, 0) AS avg_daily
  FROM inventory_by_sku inv_var   -- CTE anterior que faz unnest
  LEFT JOIN ml_orders o
    ON  o.organization_id = p_org_id
    AND o.item_id         = inv_var.item_id
    AND o.variation_id    = inv_var.variation_id
    AND o.data_pedido     >= CURRENT_DATE - p_sales_window_days
    AND o.status IN ('paid', 'confirmed')
  GROUP BY inv_var.item_id, inv_var.variation_id
)
```

Para anúncios sem variação (`variation_id IS NULL`), filtrar por `o.variation_id = ''` (valor padrão gravado pelo sync quando não há variação).

**Vantagem:** Sem mudança de schema em `ml_product_daily_cache`; sem risco de regressão no `mercado-libre-integration`; `ml_orders` já scoped por org via RLS.

**Alternativa descartada (schema change):** Adicionar `variation_id` em `ml_product_daily_cache`, mudar unique constraint, atualizar `mercado-libre-integration`. Risco de quebrar `ml-products-aggregated` EF e outros consumidores da daily cache. Não recomendado nesta fase.

---

## CMP-03: RPC `get_replenishment_by_sku` — Padrão de Unnest [VERIFIED: codebase + SQL pattern]

### Unnest de `variations` jsonb

```sql
-- CTE 1: estoque por SKU via unnest do jsonb variations
-- Itens COM variações: uma linha por variação
-- Itens SEM variações: uma linha usando dados item-level
WITH inventory_by_sku AS (
  -- Variações de itens com has_variations = true
  SELECT
    i.item_id,
    i.title,
    i.brand,
    i.logistic_type,
    TRUE                        AS has_variations,
    v.variation_id              AS variation_id,
    v.attribute_combinations    AS attribute_combinations,
    v.available_quantity        AS sku_stock,
    v.seller_custom_field       AS sku_code   -- ponte p/ ml_product_costs
  FROM ml_inventory_cache i
  CROSS JOIN LATERAL jsonb_to_recordset(i.variations) AS v(
    variation_id          TEXT,
    attribute_combinations JSONB,
    available_quantity    INTEGER,
    sold_quantity         INTEGER,
    seller_custom_field   TEXT
  )
  WHERE i.organization_id = p_org_id
    AND i.status = 'active'
    AND i.has_variations = TRUE
    AND jsonb_array_length(i.variations) > 0

  UNION ALL

  -- Itens sem variações (SKU único = item inteiro)
  SELECT
    i.item_id,
    i.title,
    i.brand,
    i.logistic_type,
    FALSE                       AS has_variations,
    NULL                        AS variation_id,
    NULL::JSONB                 AS attribute_combinations,
    i.available_quantity        AS sku_stock,
    i.seller_custom_field       AS sku_code
  FROM ml_inventory_cache i
  WHERE i.organization_id = p_org_id
    AND i.status = 'active'
    AND (i.has_variations = FALSE OR jsonb_array_length(i.variations) = 0)
)
```

### Assinatura da nova RPC

```sql
CREATE OR REPLACE FUNCTION public.get_replenishment_by_sku(
  p_org_id            UUID,
  p_sales_window_days INTEGER DEFAULT 30,
  p_demand_multiplier NUMERIC  DEFAULT 1.0
)
RETURNS TABLE (
  item_id               TEXT,
  variation_id          TEXT,       -- NULL para anúncios sem variação
  title                 TEXT,
  brand                 TEXT,
  sku_code              TEXT,       -- seller_custom_field da variação
  attribute_combinations JSONB,     -- [{id, name, value}] para mostrar Cor/Tamanho
  logistic_type         TEXT,
  sku_stock             INTEGER,    -- available_quantity da variação
  venda_dia             NUMERIC,
  cobertura_atual       NUMERIC,
  ponto_reposicao       NUMERIC,
  alvo                  NUMERIC,
  compra_sugerida       INTEGER,
  valor_estimado        NUMERIC,
  custo_ausente         BOOLEAN,
  sem_giro              BOOLEAN,
  gatilho_ativo         BOOLEAN,
  param_lead_time       INTEGER,
  param_cobertura       INTEGER,
  param_safety          INTEGER,
  param_moq             INTEGER,
  param_pack            INTEGER,
  param_origem          TEXT        -- 'sku' | 'marca' | 'global'
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$ ... $$;

REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC) TO authenticated;
```

### `get_replenishment` existente (Phase 62) PERMANECE intocado

A RPC `get_replenishment` (por anúncio, Phase 62) não é alterada — permanece em prod para não quebrar nada até a nova RPC ser validada. Após validação, a aba de `/estoque` é removida; nesse ponto a RPC antiga pode ser deprecada em uma fase futura.

---

## CMP-04: Join de Custo por SKU [VERIFIED: codebase]

O padrão LATERAL da Phase 62 é estendido para o nível de variação:

```sql
LEFT JOIN LATERAL (
  SELECT c.cost
  FROM ml_product_costs c
  WHERE c.organization_id = p_org_id
    AND (
      c.seller_sku = inv_var.sku_code          -- variação tem SKU → casa pelo SKU
      OR (inv_var.sku_code IS NULL AND c.item_id = inv_var.item_id)  -- fallback item_id
    )
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1
) cost_row ON TRUE
```

**Chave de join:** `ml_product_costs.seller_sku` vs `variation.seller_custom_field`. Formato Tiny: `020491CA35GRX`. A coluna `ml_product_costs.seller_sku` já existe e tem 604 linhas no Pé Vermeio.

**Custo nulo:** mantém regra da Phase 62 — sugere quantidade, flag `custo_ausente = true`, `valor_estimado = NULL`.

---

## CMP-05: Parâmetros Editáveis por UI

### Mudança de Schema [VERIFIED: codebase — migration 20260662000000]

A tabela `replenishment_params` tem `CHECK (scope IN ('global', 'marca'))`. Adicionar `'sku'`:

```sql
-- Migration CMP-05
ALTER TABLE public.replenishment_params
  DROP CONSTRAINT replenishment_params_scope_check;

ALTER TABLE public.replenishment_params
  ADD CONSTRAINT replenishment_params_scope_check
    CHECK (scope IN ('global', 'marca', 'sku'));
```

Para escopo `sku`, `scope_value` = `seller_custom_field` da variação (ex: `020491CA35GRX`).

### Precedência na nova RPC (COALESCE SKU > marca > global > hardcoded)

```sql
-- CTE params na get_replenishment_by_sku
COALESCE(
  (SELECT rp.lead_time_dias FROM replenishment_params rp
   WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
     AND rp.scope_value = COALESCE(inv_var.sku_code, '') LIMIT 1),
  (SELECT rp.lead_time_dias FROM replenishment_params rp
   WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
     AND rp.scope_value = COALESCE(inv_var.brand, '') LIMIT 1),
  (SELECT rp.lead_time_dias FROM replenishment_params rp
   WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
  30
) AS lead_time_dias
```

O campo `param_origem` retorna `'sku' | 'marca' | 'global'` para exibição na UI.

### UI de CRUD de Params — Padrão do Projeto [VERIFIED: codebase]

React Hook Form + zod para validação + shadcn `Dialog` para modal:

```typescript
// Schema zod dos params
const paramsSchema = z.object({
  scope: z.enum(["global", "marca", "sku"]),
  scope_value: z.string(),
  lead_time_dias: z.number().int().min(1).max(365),
  meta_cobertura_dias: z.number().int().min(1).max(730),
  safety_days: z.number().int().min(0).max(60),
  moq: z.number().int().min(1),
  pack_multiple: z.number().int().min(1),
});
```

Write é bloqueado pela RLS existente: `get_org_role(...) = ANY (ARRAY['owner', 'admin'])`. Nenhuma mudança de RLS necessária.

**Onde exibir o CRUD:** seção colapsável "Parâmetros" na nova página `/compras` (Claude's discretion — recomenda Dialog ativado por botão "Editar parâmetros" no cabeçalho da tabela, com lista de escopos configurados).

---

## CMP-06/07/08: Página `/compras` — Navegação, Filtros, Drill e Export

### CMP-07: Arquivos a Tocar [VERIFIED: codebase]

**1. `src/App.tsx`**
```typescript
// Adicionar lazy import
const MLCompras = React.lazy(() => import("./pages/mercadolivre/MLCompras"));

// Adicionar Route (dentro do bloco ProtectedRoute existente)
<Route path="/compras" element={
  <RoleRoute><ErrorBoundary fallbackTitle="Erro em Compras"><MLCompras /></ErrorBoundary></RoleRoute>
} />
```

**2. `src/config/roleAccess.ts`**
```typescript
// Adicionar em OPERATIONAL (owner/admin/member) conforme D-10
"/compras": OPERATIONAL,
```

**3. `src/components/layout/ApiSidebar.tsx`**
```typescript
// Adicionar sob "Operações" (items após "Estoque"):
{ icon: ShoppingCart, label: "Compras", path: "/compras" },
// import ShoppingCart from lucide-react (já no projeto)
```

**4. `src/contexts/MenuVisibilityContext.tsx`**
```typescript
// Adicionar em MENU_SECTIONS["Operações"]:
{ label: "Compras", path: "/compras" },
```

**5. `src/pages/mercadolivre/MLEstoque.tsx` — remover aba "Compra Recomendada"**

Linhas a remover:
- Import: `import { ReplenishmentPanel } from "@/components/mercadolivre/ReplenishmentPanel";` (linha 31)
- TabsTrigger: `<TabsTrigger value="compra"...>Compra Recomendada</TabsTrigger>` (linhas 1030-1033)
- TabsContent: `<TabsContent value="compra"><ReplenishmentPanel /></TabsContent>` (linhas 1411-1412)
- Import `ShoppingCart` se não usado em outro lugar (verificar)

**Importante:** `compraUtils.ts` e `CompraRecomendadaPanel.tsx` em `/precos-custos/analise` permanecem **intocados** (conforme CONTEXT.md).

### CMP-06: Filtros na Página `/compras`

Padrão client-side com `useMemo` (dataset pequeno — ~200-500 linhas SKU):

```typescript
// Filtros disponíveis
const [filterBrand, setFilterBrand]       = useState<string>("all");
const [filterStatus, setFilterStatus]     = useState<"all"|"gatilho"|"sem_giro">("all");
const [filterCusto, setFilterCusto]       = useState<"all"|"com"|"sem">("all");
const [filterSemGiro, setFilterSemGiro]   = useState(false);
const [searchText, setSearchText]         = useState("");

// Aplicar filtros via useMemo (não debounced — dataset pequeno)
const filteredRows = useMemo(() => {
  let rows = data ?? [];
  if (filterBrand !== "all") rows = rows.filter(r => r.brand === filterBrand);
  if (filterStatus === "gatilho") rows = rows.filter(r => r.gatilho_ativo);
  if (filterStatus === "sem_giro") rows = rows.filter(r => r.sem_giro);
  if (filterCusto === "com") rows = rows.filter(r => !r.custo_ausente);
  if (filterCusto === "sem") rows = rows.filter(r => r.custo_ausente);
  if (filterSemGiro) rows = rows.filter(r => !r.sem_giro);
  if (searchText) {
    const q = searchText.toLowerCase();
    rows = rows.filter(r =>
      r.title?.toLowerCase().includes(q) ||
      r.sku_code?.toLowerCase().includes(q) ||
      r.attribute_combinations_label?.toLowerCase().includes(q)
    );
  }
  return rows;
}, [data, filterBrand, filterStatus, filterCusto, filterSemGiro, searchText]);
```

Marcas disponíveis = `[...new Set(data?.map(r => r.brand).filter(Boolean))]`.

### CMP-08: Drill Anúncio → Variações

A tabela agrupa por `item_id` com expand/collapse (uma linha mestre por anúncio + linhas filha por variação):

```tsx
// Usar Radix Collapsible (já instalado no projeto)
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Estado de quais item_ids estão expandidos
const [expanded, setExpanded] = useState<Set<string>>(new Set());

// Linha mestre (agrega variações)
<CollapsibleTrigger onClick={() => toggleExpanded(item.item_id)}>
  <ChevronRight className={expanded.has(item.item_id) ? "rotate-90" : ""} />
  {item.title}
</CollapsibleTrigger>
<CollapsibleContent>
  {item.variations.map(v => <VariationRow key={v.variation_id} sku={v} />)}
</CollapsibleContent>
```

**Agrupamento na hook:** A RPC retorna uma linha por SKU (variação). O hook `useReplenishmentBySku` agrupa em `GroupedReplenishmentRow[]` com `item_id`, `title`, `brand`, e `skus: SkuRow[]`.

### CMP-08: Exportação xlsx

Padrão de `TopSellingProducts.tsx` (linhas 47+):

```typescript
import * as XLSX from "xlsx";

function exportToXlsx(rows: FlatSkuRow[]) {
  const data = rows.map(r => ({
    "Item ID":      r.item_id,
    "Anúncio":      r.title,
    "Marca":        r.brand,
    "SKU":          r.sku_code,
    "Tamanho/Cor":  r.attribute_combinations_label,
    "Estoque":      r.sku_stock,
    "Venda/dia":    r.venda_dia,
    "Cobertura(d)": r.cobertura_atual,
    "Sugestão":     r.compra_sugerida,
    "Valor Est.":   r.valor_estimado,
    "Custo ausente": r.custo_ausente ? "Sim" : "Não",
    "Sem giro":     r.sem_giro ? "Sim" : "Não",
    "Params":       `LT${r.param_lead_time} Cob${r.param_cobertura} Seg${r.param_safety} MOQ${r.param_moq} Pack${r.param_pack}`,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Compras");
  XLSX.writeFile(wb, `compras-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
```

---

## Architecture Patterns

### System Architecture — Fluxo de Dados Phase 63

```
ML API /items/{id}/variations/{variationId}
          │
          ▼
sync-ml-inventory (EF Deno)   ← segundo-passe novo
          │ upsert
          ▼
ml_inventory_cache
  variations JSONB [{variation_id, seller_custom_field, available_quantity, ...}]
          │
          │ jsonb_to_recordset LATERAL
          ▼
get_replenishment_by_sku (RPC PostgreSQL, SECURITY INVOKER)
          │ JOIN
ml_orders (variation_id, quantidade, data_pedido, status)
          │ JOIN
ml_product_costs (seller_sku → seller_custom_field)
          │ JOIN
replenishment_params (scope: sku/marca/global)
          │
          ▼
useReplenishmentBySku (React Query hook)
          │
          ▼
MLCompras page (/compras)
  ├── Filtros (marca, status, custo, busca)
  ├── Tabela agrupada por anúncio (drill Collapsible)
  ├── Seção Parâmetros (Dialog CRUD, owner/admin)
  └── Botão Exportar xlsx
```

### Estrutura de Arquivos Novos

```
src/
├── pages/mercadolivre/
│   └── MLCompras.tsx                    # Nova página /compras (CMP-07)
├── hooks/
│   └── useReplenishmentBySku.ts         # Hook React Query para nova RPC
├── components/mercadolivre/
│   ├── ReplenishmentSkuTable.tsx         # Tabela com drill
│   ├── ReplenishmentSkuFilters.tsx       # Barra de filtros
│   └── ReplenishmentParamsDialog.tsx     # CRUD params (Dialog)
└── lib/analysis/
    └── replenishmentUtils.ts             # ESTENDER para nível SKU (manter retrocompat)

supabase/
├── functions/
│   └── sync-ml-inventory/index.ts       # Adicionar segundo-passe (CMP-01)
└── migrations/
    ├── 20260663000000_replenishment_params_add_sku_scope.sql   # CMP-05
    └── 20260663000100_get_replenishment_by_sku_rpc.sql         # CMP-03
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unnest de JSONB arrays | Função TS recursiva | `jsonb_to_recordset` (PostgreSQL) | Tipado, eficiente, roda server-side |
| Export Excel | Biblioteca própria | `xlsx` (SheetJS, já no projeto) | Suporta xls/xlsx, fórmulas, múltiplas abas |
| Accordion/drill de linha | div + CSS aninhada | Radix `Collapsible` (já no projeto) | Acessível, animado, consistente |
| Form validation de params | validação ad-hoc | react-hook-form + zod (já no projeto) | Tipa e valida em runtime + compile-time |
| Antifraude multi-tenant | colunas `p_org_id` em parâmetros | SECURITY INVOKER + RLS org-first | DEFINER com org param = IDOR CRITICAL (pattern confirmado em Phase 43/48/62) |

---

## Common Pitfalls

### Pitfall 1: has_variations = true mas `variations` jsonb vazio
**O que acontece:** `jsonb_array_length(i.variations) = 0` mesmo com `has_variations = true`. Isso pode acontecer em sincronizações parciais.
**Como evitar:** A CTE do UNION ALL usa `jsonb_array_length(i.variations) > 0` para o ramo de variações, e o ramo `sem variação` usa `NOT has_variations OR jsonb_array_length(i.variations) = 0`. Cobre ambos os casos.

### Pitfall 2: `variation_id` em `ml_orders` como string vazia vs NULL
**O que acontece:** `sync-ml-orders` grava `variation_id = ""` (string vazia) quando não há variação (`prod.variation_id` falsy). O JOIN na RPC precisa tratar `""` como equivalente a "sem variação".
**Como evitar:** No JOIN da CTE sales_by_sku: `AND (o.variation_id = inv_var.variation_id OR (inv_var.variation_id IS NULL AND o.variation_id = ''))`.

### Pitfall 3: `seller_custom_field` case-sensitive no join
**O que acontece:** SKU Tiny `020491CA35GRX` vs `020491ca35grx` — join não casa.
**Como evitar:** Confirmar convenção de case no Tiny durante execução. Se necessário: `LOWER(c.seller_sku) = LOWER(inv_var.sku_code)`.

### Pitfall 4: Timeout do segundo-passe em `sync-ml-inventory` para catálogos grandes
**O que acontece:** Com muitas variações, as chamadas sequenciais a `/items/{id}/variations/{variationId}` excedem o timeout da EF.
**Como evitar:** Cap de 20 chamadas concorrentes (igual ao `ml-inventory`). Considerar `EdgeRuntime.waitUntil` se total de variações > 500 (lição da Phase 59).

### Pitfall 5: Paginação `.range()` esquecida na nova RPC
**O que acontece:** PostgREST trunca em 1000 linhas no endpoint REST. A RPC retorna tudo mas o client precisa de `.range()`.
**Como evitar:** O hook `useReplenishmentBySku` deve usar paginação `.range()` se dataset > 500 linhas. Para Pé Vermeio (~116 anúncios × ~4 variações = ~464 SKUs) provavelmente não precisa, mas implementar para robustez.

### Pitfall 6: `compraUtils.ts` legado
**O que acontece:** `src/lib/analysis/compraUtils.ts` e `CompraRecomendadaPanel.tsx` (em `/precos-custos/analise`) são similares aos novos mas pertencem a outra feature. Podem ser confundidos e editados por acidente.
**Como evitar:** Não tocar em nenhum arquivo com path `analise/Compra*`. Só remover a aba em `MLEstoque.tsx`.

### Pitfall 7: Unique constraint de `replenishment_params` quebra com scope `sku`
**O que acontece:** A constraint existente é `UNIQUE (organization_id, scope, scope_value)`. Para scope `sku`, `scope_value` = SKU string. Dois SKUs diferentes de mesma marca não conflitam — constraint é por `(org, scope, scope_value)` então está OK.
**Como evitar:** Nenhuma mudança na constraint — só alterar o CHECK para aceitar `'sku'`.

---

## Estado Atual das Tabelas-Chave [VERIFIED: codebase]

### `ml_inventory_cache`

Colunas relevantes:
- `item_id` TEXT (MLB...)
- `available_quantity` INTEGER (soma total — item-level)
- `has_variations` BOOLEAN
- `variations` JSONB (array de variações)
  - `variation_id` TEXT
  - `attribute_combinations` JSONB (COLOR/SIZE)
  - `available_quantity` INTEGER
  - `seller_custom_field` TEXT — **NULL hoje** (gap do sync, CMP-01)

### `ml_orders`

Colunas relevantes:
- `item_id` TEXT
- `variation_id` TEXT (string vazia se sem variação)
- `quantidade` INTEGER
- `data_pedido` DATE (BRT)
- `status` TEXT ('paid' | 'confirmed' | 'cancelled' etc.)
- `sku` TEXT — item-level seller_custom_field (NÃO variação)
- `organization_id` UUID

### `ml_product_costs`

- `seller_sku` TEXT — chave de join com variação (ex: `020491CA35GRX`)
- `cost` NUMERIC
- `organization_id` UUID
- 604 linhas no Pé Vermeio

### `replenishment_params`

- `scope` TEXT CHECK IN ('global', 'marca') → alterar para incluir 'sku'
- `scope_value` TEXT ('' para global, nome da marca, SKU para sku)
- `organization_id` UUID
- Sem linhas de seed (fallback hardcoded 30/60/7/1/1)

---

## Padrões de Código Confirmados

### SECURITY INVOKER — padrão Phase 62/59/43 [VERIFIED: codebase]

```sql
CREATE OR REPLACE FUNCTION public.get_replenishment_by_sku(...)
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$ ... $$;

REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(...) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment_by_sku(...) TO authenticated;
```

### React Query hook — padrão `useReplenishment.ts` [VERIFIED: codebase]

```typescript
export function useReplenishmentBySku(salesWindowDays = 30, demandMultiplier = 1.0) {
  const { currentOrg } = useOrganization();
  return useQuery({
    queryKey: ["get_replenishment_by_sku", currentOrg?.id, salesWindowDays, demandMultiplier],
    queryFn: async (): Promise<ReplenishmentSkuRow[]> => {
      if (!currentOrg?.id) return [];
      const { data, error } = await supabase.rpc("get_replenishment_by_sku", {
        p_org_id:             currentOrg.id,
        p_sales_window_days:  salesWindowDays,
        p_demand_multiplier:  demandMultiplier,
      });
      if (error) throw error;
      return (data ?? []).map(mapRow);
    },
    enabled: !!currentOrg?.id,
    staleTime: 5 * 60 * 1000,
  });
}
```

### `replenishmentUtils.ts` — extensão para nível SKU [VERIFIED: codebase]

O módulo atual já tem `resolveParams` e `calcReplenishment` testados por 203 testes. Para a Phase 63, estender:
- Adicionar tipo `ReplenishmentSkuInput` com `variationId`, `skuCode`, `attributeCombinations`
- Adicionar `resolveParamsBySku(skuCode, brand, skuRow, marcaRow, globalRow, defaults)` que espelha o COALESCE da RPC
- A lógica de cálculo (`calcReplenishment`) é idêntica — usar como está

### Teste anti-IDOR por SKU [VERIFIED: codebase — padrão Phase 62]

```typescript
it("cross-org retorna 0 linhas (anti-IDOR)", async () => {
  // Chama get_replenishment_by_sku com p_org_id de outra org
  // SECURITY INVOKER + RLS is_org_member → retorna []
});
```

---

## Sequência Sugerida de Planos (para o Planner)

A fase tem 4 blocos naturais:

**Bloco A — Fundação de dados (pre-requisito para C):**
- `63-A1`: Fix `sync-ml-inventory` (segundo-passe per-variação) + migration `replenishment_params` CHECK sku
- `63-A2`: Validar que `seller_custom_field` está populado nas variações após sync

**Bloco B — Motor (pode ser paralelo com A2):**
- `63-B1`: Migration `get_replenishment_by_sku` RPC (CTEs stock_by_sku + sales_by_sku + params + base)
- `63-B2`: Hook `useReplenishmentBySku` + extensão de `replenishmentUtils.ts` (com testes por SKU)

**Bloco C — Frontend (depende de B1 estar em prod ou em modo mock):**
- `63-C1`: Página `MLCompras.tsx` + rota/nav + remoção da aba de `/estoque` + filtros
- `63-C2`: Drill anúncio→variações + export xlsx + CRUD params Dialog

**Bloco D — Verificação:**
- `63-D1`: Checkpoint visual + testes de regressão (REPL-01..08 da Phase 62 continuam válidos)

---

## Environment Availability

> Fase é code/config + migrations. Sem novas dependências externas.

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| Supabase MCP `apply_migration` | Migrations CMP-01/05/RPC | ✓ | Padrão confirmado em todas as phases anteriores |
| Supabase MCP `deploy_edge_function` | CMP-01 sync-ml-inventory | ✓ | Padrão Phase 59 |
| ML API `/items/{id}/variations/{vid}` | CMP-01 segundo-passe | ✓ (assumed) | Já funcionando em `ml-inventory` EF [ASSUMED: rate limits OK para ~500 chamadas] |

---

## Security Domain

> `security_enforcement` não é `false` no config — seção obrigatória.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | JWT via Supabase Auth — inalterado |
| V4 Access Control | Yes | SECURITY INVOKER + RLS `is_org_member` (anti-IDOR) |
| V5 Input Validation | Yes | zod no CRUD de params; p_org_id via auth.uid() não de parâmetro |
| V6 Cryptography | No | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR via p_org_id alheio | Spoofing / Information Disclosure | SECURITY INVOKER + RLS `is_org_member` → 0 linhas para org alheia |
| Write de params por member | Elevation of Privilege | RLS `rp_write`: `get_org_role = ANY ('owner','admin')` — sem mudança necessária |
| Variation ID spoofing | Information Disclosure | RLS de `ml_inventory_cache` gateado por `organization_id` — INVOKER enforça |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ML API retorna `seller_custom_field` por variação via `/items/{id}/variations/{vid}` em produção para o Pé Vermeio | CMP-01 | Se Wesley não cadastrou SKUs nas variações do ML, o campo será null mesmo após o segundo-passe. Fallback: confirmar no ML dashboard antes de executar. Deferred fallback via Tiny existe no CONTEXT.md |
| A2 | `ml_orders.variation_id` está sendo populado corretamente pelo `sync-ml-orders` para pedidos com variação | CMP-02 | Se variation_id = "" em todos os pedidos históricos com variação, velocidade por SKU = 0 para todas as variações. Verificar por SQL antes de criar RPC |
| A3 | Rate limits do ML não bloqueiam ~500 chamadas extras por sync de inventário (segundo-passe) | CMP-01 | Throttling pode causar falha parcial do sync. Mitigação: try/catch por variação (já no padrão do ml-inventory); falha de 1 variação não aborta o sync |
| A4 | Os SKUs das variações no ML batem com os SKUs em `ml_product_costs.seller_sku` (Tiny format) | CMP-04 | Se Wesley não cadastrou os SKUs da variação no ML (campo "SKU do Produto" no anúncio), o join de custo por variação não funcionará — mesmo problema raiz do "custo ausente". Verificar por SQL após CMP-01 |

---

## Open Questions (RESOLVED)

Ambas são verificáveis apenas em runtime e estão **resolvidas por checkpoint nos planos** (descoberta no checkpoint, não pré-execução):

1. **Wesley cadastrou SKUs por variação no ML?** — **RESOLVED:** validada em runtime no checkpoint `63-01 Task 3` (SQL `jsonb_path_query_array(variations,'$[*].seller_custom_field')` após o fix de CMP-01); se `variacoes_com_sku = 0`, o plano escala para o Wesley antes de prosseguir. Caminho de escalonamento explícito no plano.
   - O que sabemos: A EF `ml-inventory` já chama o endpoint correto e retorna `seller_custom_field` por variação.
   - Verificação: `SELECT item_id, jsonb_path_query_array(variations, '$[*].seller_custom_field') FROM ml_inventory_cache WHERE organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7' AND has_variations = true LIMIT 10`.

2. **`ml_orders.variation_id` tem dados históricos reais?** — **RESOLVED:** validada em runtime no checkpoint `63-01 Task 3` (query de cobertura); o resultado é registrado no SUMMARY como input para o `63-04`. Se a cobertura for baixa, a velocidade por SKU cai para o ramo sem-variação (tratado na RPC).
   - O que sabemos: A coluna existe, o sync grava `prod.variation_id` dos order items. A ML orders API retorna `variation_id` nos order items.
   - Verificação: `SELECT count(*), count(NULLIF(variation_id,'')) FROM ml_orders WHERE organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7' AND data_pedido >= CURRENT_DATE - 60`.

---

## Sources

### Primary (HIGH confidence)
- Codebase `supabase/functions/ml-inventory/index.ts` — confirma comentário explícito: "Neither multi-get nor full item GET returns variation.attributes. Only GET /items/{id}/variations/{variationId} returns the full attributes array (including SELLER_SKU)."
- Codebase `supabase/functions/sync-ml-inventory/index.ts` — confirma ausência do segundo-passe
- Codebase `supabase/migrations/20260662000*` — schema de `replenishment_params` e RPC `get_replenishment`
- Codebase `src/integrations/supabase/types.ts` (linhas 1380-1480) — schema de `ml_orders` com `variation_id`
- Codebase `src/config/roleAccess.ts`, `src/components/layout/ApiSidebar.tsx`, `src/contexts/MenuVisibilityContext.tsx` — padrão de roteamento/nav

### Secondary (MEDIUM confidence)
- `63-CONTEXT.md` — decisões D-01..D-11 do Wesley (travadas)
- `62-CONTEXT.md` + `62-RESEARCH.md` — fórmula de ponto de reposição e padrões da Phase base

### Tertiary (LOW confidence)
- Suposição sobre rate limits da ML API para segundo-passe (A3 acima)

---

## Metadata

**Confidence breakdown:**
- CMP-01 root cause: HIGH — confirmado por análise de código (gap entre duas EFs)
- CMP-02 abordagem ml_orders: HIGH — schema confirmado; abordagem é Claude's discretion
- CMP-03 unnest pattern: HIGH — padrão PostgreSQL padrão + aplicado ao schema confirmado
- CMP-04 cost join: HIGH — extensão direta do padrão Phase 62
- CMP-05 schema change: HIGH — migration simples (ALTER CHECK)
- CMP-06/07/08 frontend: HIGH — todos os arquivos exatos identificados

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (30 dias — stack estável)
