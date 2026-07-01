# Phase 77: Produtos Vendidos + Análise de Preços — Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 8 (2 páginas, 1 hook, 1 util, 1 componente portado, 1 migration, 2 modificados)
**Analogs found:** 7 / 8 (migration SQL: sem analog direto — usar SQL do oficial adaptado)

---

## File Classification

| Novo/Modificado | Role | Data Flow | Analog Mais Próximo | Qualidade |
|---|---|---|---|---|
| `src/pages/mercadolivre/MLProdutosVendidos.tsx` | page | request-response + client-aggregate | `src/pages/mercadolivre/MLCompras.tsx` | role-match (page c/ filtros + card/table) |
| `src/pages/mercadolivre/MLAnalisePrecos.tsx` | page | request-response | `src/pages/mercadolivre/MLCompras.tsx` | role-match (page wrapper simples) |
| `src/hooks/useMLSoldProducts.ts` | hook | CRUD paginado + client-aggregate | `src/components/mercadolivre/anuncios/useMLListingSales.ts` | exact (paginação orders, mesmo padrão) |
| `src/components/mercadolivre/anuncios/soldProductsAgg.ts` | utility | transform | `src/components/mercadolivre/anuncios/listingSalesAgg.ts` | exact (util pura de agregação client-side) |
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` | component | request-response (RPC) | `/root/garment-glow-official/src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` | exact (porte direto do oficial) |
| `supabase/migrations/20260677000000_orders_price_timeseries.sql` | migration | — | oficial `20260630170000_orders_price_timeseries.sql` | exact (porte com adaptação cast TEXT→date) |
| `src/App.tsx` *(modificado)* | config | — | `src/App.tsx` linhas 40-41, 144 | exact |
| `src/config/roleAccess.ts` *(modificado)* | config | — | `src/config/roleAccess.ts` linhas 22-23 | exact |
| `src/components/layout/ApiSidebar.tsx` *(modificado)* | config | — | `src/components/layout/ApiSidebar.tsx` linhas 34-39 | exact |

---

## Pattern Assignments

### `src/pages/mercadolivre/MLProdutosVendidos.tsx` (page, request-response + client-aggregate)

**Analog:** `src/pages/mercadolivre/MLCompras.tsx`

**Imports pattern** (MLCompras.tsx linhas 1-16):
```tsx
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
// Adicionar para esta página:
import { useMLSoldProducts } from "@/hooks/useMLSoldProducts";
import { useMLInventory } from "@/contexts/MLInventoryContext";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLFilters } from "@/hooks/useMLFilters";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
```

**Estrutura da página** (MLCompras.tsx linhas 124-306 — padrão geral):
```tsx
export default function MLProdutosVendidos() {
  // Estado local do toggle marca/categoria
  const [pvView, setPvView] = useState<"marca" | "categoria">("marca");
  const [pvSelected, setPvSelected] = useState<string | null>(null);

  // Hooks de contexto (existentes no projeto)
  const { resolvedMLUserIds } = useMLStore();
  const { items: inventoryItems } = useMLInventory();
  const { currentFrom, currentTo, ...filterProps } = useMLFilters(30);

  // Hook de dados (novo)
  const { allRows, isLoading, error } = useMLSoldProducts({
    fromDate: currentFrom,
    toDate: currentTo,
    resolvedMLUserIds,
  });

  // Mapa item_id → inventory (para thumbnail, category_id, title atual)
  const itemsMap = useMemo(() => {
    const m = new Map<string, typeof inventoryItems[0]>();
    inventoryItems.forEach((i) => { if (i.id) m.set(i.id, i); });
    return m;
  }, [inventoryItems]);

  // Grupos (marca ou categoria) derivados client-side
  const pvGroups = useMemo(() => { /* ver Pattern soldProductsAgg */ }, [allRows, pvView, itemsMap]);
  const pvItems  = useMemo(() => pvSelected
    ? allRows.filter((r) => (pvView === "marca" ? r.marca : itemsMap.get(r.item_id)?.category_id) === pvSelected)
    : [],
    [allRows, pvSelected, pvView, itemsMap]);

  return (
    <div className="space-y-5">
      {/* Sticky header — padrão MLCompras.tsx linhas 166-220 */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
          <MLPageHeader title="Produtos Vendidos" />
          {/* MLPeriodPicker + toggle marca/categoria */}
        </div>
      </div>
      {/* Painel duplo: esquerda = pvGroups, direita = pvItems */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Coluna esquerda: lista de grupos */}
        {/* Coluna direita: tabela de anúncios do grupo selecionado */}
      </div>
    </div>
  );
}
```

**Guard de resolvedMLUserIds vazio** (padrão do oficial — aplicar no hook):
```tsx
// Em useMLSoldProducts: guard antes de disparar fetch
if (!resolvedMLUserIds?.length) return; // sem lojas conectadas
```

---

### `src/pages/mercadolivre/MLAnalisePrecos.tsx` (page, request-response)

**Analog:** `src/pages/mercadolivre/MLCompras.tsx` (estrutura de página) + oficial (lógica)

**Estrutura mínima** (wrapper que alimenta PrecoPraticadoReport):
```tsx
import { useMemo } from "react";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLFilters } from "@/hooks/useMLFilters";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { PrecoPraticadoReport } from "@/components/mercadolivre/anuncios/PrecoPraticadoReport";
import { useMLSoldProducts } from "@/hooks/useMLSoldProducts"; // reutilizar para obter lista de produtos

export default function MLAnalisePrecos() {
  const { resolvedMLUserIds } = useMLStore();
  const { currentFrom, currentTo, ...filterProps } = useMLFilters(30);

  // Lista de produtos com vendas (id + título) para o seletor do PrecoPraticadoReport
  const { allRows, isLoading } = useMLSoldProducts({ fromDate: currentFrom, toDate: currentTo, resolvedMLUserIds });

  // Deduplica por item_id, ordena por quantidade vendida desc
  const products = useMemo(() => {
    const map = new Map<string, { id: string; title: string; qty: number }>();
    for (const r of allRows) {
      const prev = map.get(r.item_id);
      if (!prev) map.set(r.item_id, { id: r.item_id, title: r.titulo ?? r.item_id, qty: r.quantidade });
      else prev.qty += r.quantidade;
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  }, [allRows]);

  // Deep-link: ?item=MLB... pré-seleciona o anúncio (OPCIONAL — registrar como follow-up se complicar)
  // const [searchParams] = useSearchParams();
  // const preRequest = searchParams.get("item") ? { itemId: searchParams.get("item")!, nonce: 1 } : null;

  return (
    <div className="space-y-5">
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <MLPageHeader title="Análise de Preços" />
          <MLPeriodPicker {...filterProps} />
        </div>
      </div>
      <PrecoPraticadoReport
        products={products}
        mlUserIds={resolvedMLUserIds}
        fromDate={currentFrom}
        toDate={currentTo}
        request={null}
      />
    </div>
  );
}
```

---

### `src/hooks/useMLSoldProducts.ts` (hook, CRUD paginado + client-aggregate)

**Analog:** `src/components/mercadolivre/anuncios/useMLListingSales.ts` (cópia quase direta)

**Imports pattern** (useMLListingSales.ts linhas 1-19):
```typescript
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
```

**Paginação loop — padrão Phase 73** (useMLListingSales.ts linhas 71-130):
```typescript
// Constantes (ajustar MAX_ROWS para cenário multi-anúncio)
const PAGE     = 1_000;
const MAX_ROWS = 50_000; // mais alto que o useMLListingSales (5_000) — cobre todos os anúncios

interface OrderRow {
  item_id: string;
  titulo: string | null;
  marca: string | null;
  quantidade: number;
  receita_bruta: number;
  data_pedido: string | null;
  ml_user_id: string;
}

export interface UseMLSoldProductsParams {
  fromDate: string | null;
  toDate: string | null;
  resolvedMLUserIds: string[];
}

export interface UseMLSoldProductsResult {
  allRows: OrderRow[];
  isLoading: boolean;
  error: string | null;
}

export function useMLSoldProducts({ fromDate, toDate, resolvedMLUserIds }: UseMLSoldProductsParams): UseMLSoldProductsResult {
  const [allRows, setAllRows] = useState<OrderRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Guard: sem datas ou sem lojas, não buscar
    if (!fromDate || !toDate || !resolvedMLUserIds.length) {
      setAllRows([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setAllRows([]);
    setError(null);

    async function fetchAll() {
      let accumulated: OrderRow[] = [];
      let offset = 0;

      while (!cancelled && accumulated.length < MAX_ROWS) {
        let q = supabase
          .from("orders")
          .select("item_id, titulo, marca, quantidade, receita_bruta, data_pedido, ml_user_id")
          .eq("status", "paid")
          .gte("data_pedido", fromDate!)      // data_pedido é TEXT — string "YYYY-MM-DD" funciona
          .lte("data_pedido", toDate!)
          .range(offset, offset + PAGE - 1);

        // Filtro por loja apenas quando há lojas (guard acima garante .length > 0)
        q = q.in("ml_user_id", resolvedMLUserIds);

        const { data, error: qErr } = await q;
        if (cancelled) return;
        if (qErr) { setError(qErr.message); setIsLoading(false); return; }

        const page = (data ?? []) as OrderRow[];
        accumulated = accumulated.concat(page);

        if (page.length < PAGE) break; // última página
        offset += PAGE;
      }

      if (!cancelled) {
        setAllRows(accumulated);
        setIsLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [fromDate, toDate, resolvedMLUserIds]);  // primitivos estáveis — sem stringify necessário

  return { allRows, isLoading, error };
}
```

**Nota crítica:** `resolvedMLUserIds` é array — pode causar re-render infinito se não estabilizado. Verificar se `useMLStore` já retorna referência estável (memorizada). Se não, o chamador deve envolver em `useMemo`.

---

### `src/components/mercadolivre/anuncios/soldProductsAgg.ts` (utility, transform)

**Analog:** `src/components/mercadolivre/anuncios/listingSalesAgg.ts` (estrutura idêntica — util pura sem dependências)

**Padrão da util pura** (listingSalesAgg.ts linhas 1-11):
```typescript
/**
 * Utilitário puro de agregação de pedidos por marca/categoria.
 * Zero dependências de React, Supabase ou rede — 100% testável isoladamente.
 * data_pedido é TEXT — usar slice(0,10) se necessário, nunca new Date() cego.
 */

export interface SoldProductRow {
  item_id: string;
  titulo: string | null;
  marca: string | null;
  quantidade: number;
  receita_bruta: number;
  data_pedido: string | null;
  ml_user_id: string;
}

export interface PvGroup {
  key: string;     // valor de marca ou category_id
  name: string;    // label para exibição
  qty: number;
  revenue: number;
}

export interface PvItem {
  item_id: string;
  title: string;
  qty: number;
  revenue: number;
  shareOfGroup: number;  // revenue / totalRevenue do grupo, 0–1
}

/**
 * Agrupa pedidos por marca ou category_id (cross-ref).
 * @param rows        - Linhas brutas de orders
 * @param pvView      - "marca" | "categoria"
 * @param itemsMap    - Map<item_id, { category_id, title, thumbnail }> (de useMLInventory)
 */
export function aggregatePvGroups(
  rows: SoldProductRow[],
  pvView: "marca" | "categoria",
  itemsMap: Map<string, { category_id?: string | null; title?: string }>,
): PvGroup[] {
  const map = new Map<string, { qty: number; revenue: number }>();
  for (const row of rows) {
    const key = pvView === "marca"
      ? (row.marca ?? "")
      : (itemsMap.get(row.item_id)?.category_id ?? "");
    const prev = map.get(key) ?? { qty: 0, revenue: 0 };
    map.set(key, { qty: prev.qty + row.quantidade, revenue: prev.revenue + row.receita_bruta });
  }
  return Array.from(map.entries())
    .map(([key, d]) => ({
      key,
      name: key || (pvView === "marca" ? "Sem marca" : "Sem categoria"),
      ...d,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Itens (anúncios) do grupo selecionado, com % de participação.
 */
export function aggregatePvItems(
  rows: SoldProductRow[],
  pvSelected: string,
  pvView: "marca" | "categoria",
  itemsMap: Map<string, { category_id?: string | null; title?: string; thumbnail?: string }>,
): PvItem[] {
  const filtered = rows.filter((r) =>
    pvView === "marca"
      ? (r.marca ?? "") === pvSelected
      : (itemsMap.get(r.item_id)?.category_id ?? "") === pvSelected,
  );
  const byItem = new Map<string, { qty: number; revenue: number; title: string }>();
  for (const r of filtered) {
    const title = itemsMap.get(r.item_id)?.title ?? r.titulo ?? r.item_id;
    const prev = byItem.get(r.item_id) ?? { qty: 0, revenue: 0, title };
    byItem.set(r.item_id, { ...prev, qty: prev.qty + r.quantidade, revenue: prev.revenue + r.receita_bruta });
  }
  const totalRev = Array.from(byItem.values()).reduce((s, v) => s + v.revenue, 0);
  return Array.from(byItem.entries())
    .map(([item_id, v]) => ({
      item_id,
      title: v.title,
      qty: v.qty,
      revenue: v.revenue,
      shareOfGroup: totalRev > 0 ? v.revenue / totalRev : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}
```

---

### `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` (component, request-response via RPC)

**Analog:** `/root/garment-glow-official/src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — PORTE DIRETO

**Imports pattern** (oficial linhas 1-18):
```typescript
import { useEffect, useMemo, useState } from "react";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, ChevronsUpDown, RefreshCw, TrendingUp, Package, BarChart2, DollarSign, Activity, Gauge } from "lucide-react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KPICard } from "@/components/dashboard/KPICard";
```

**Props e tipos** (oficial linhas 22-48):
```typescript
export interface PriceReportProduct {
  id: string;
  title: string;
}

type Granularity = "day" | "week" | "month";
type VolumeMetric = "qtd" | "receita";

interface SeriesRow {
  bucket: string;       // YYYY-MM-DD
  preco_medio: number;
  preco_min: number;
  preco_max: number;
  qtd: number;
  total: number;        // receita
  orders: number;
}

interface Props {
  products: PriceReportProduct[];
  mlUserIds: string[];
  fromDate: string | null;
  toDate: string | null;
  /** Pré-seleciona anúncio via deep-link. Null = sem atalho. */
  request?: { itemId: string; nonce: number } | null;
}
```

**Chamada RPC** (oficial linhas 126-156 — PADRÃO CRÍTICO):
```typescript
// Cast `as any` é padrão do projeto para RPC sem tipo gerado
const { data, error } = await (supabase.rpc as any)("orders_price_timeseries", {
  _item_id: selectedId,
  _ml_user_ids: mlUserIds && mlUserIds.length > 0 ? mlUserIds : null,
  _from: fromDate,          // "YYYY-MM-DD" string ou null
  _to: toDate,              // "YYYY-MM-DD" string ou null
  _granularity: granularity, // "day" | "week" | "month"
});
// Cleanup anti-stale: flag cancelled + return () => { cancelled = true; }
```

**Atenção no porte:** O único ajuste necessário é verificar que `KPICard` está no path `@/components/dashboard/KPICard` (existe no nosso projeto — confirmado no RESEARCH.md). Nenhuma outra mudança de lógica.

---

### `supabase/migrations/20260677000000_orders_price_timeseries.sql` (migration, sem analog no projeto)

**Referência:** `/root/garment-glow-official/supabase/migrations/20260630170000_orders_price_timeseries.sql`

**SQL a portar com adaptação** (RESEARCH.md — código completo já validado):
```sql
-- ADAPTAÇÃO vs. oficial: data_pedido TEXT → cast ::date
-- SECURITY INVOKER (padrão Phase 63/69 — sem DEFINER, sem parâmetro org)
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
           o.data_pedido::date   -- ADAPTAÇÃO: cast TEXT→date (nosso schema usa TEXT)
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
-- Sem GRANT extra: SECURITY INVOKER com RLS de orders garante isolamento de org.
```

**Deploy:** via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` (não via SQL Editor — proibido por feedback).

---

### `src/App.tsx` *(modificado)* (config, routing)

**Analog:** `src/App.tsx` — adicionar junto dos lazy imports existentes

**Lazy imports** (linhas 40-41, junto de MLCompras):
```tsx
const MLProdutosVendidos = React.lazy(() => import("./pages/mercadolivre/MLProdutosVendidos"));
const MLAnalisePrecos    = React.lazy(() => import("./pages/mercadolivre/MLAnalisePrecos"));
```

**Rotas** (linha 144, logo após a rota `/compras`):
```tsx
<Route path="/produtos-vendidos" element={
  <RoleRoute><ErrorBoundary fallbackTitle="Erro em Produtos Vendidos"><MLProdutosVendidos /></ErrorBoundary></RoleRoute>
} />
<Route path="/analise-precos" element={
  <RoleRoute><ErrorBoundary fallbackTitle="Erro em Análise de Preços"><MLAnalisePrecos /></ErrorBoundary></RoleRoute>
} />
```

---

### `src/config/roleAccess.ts` *(modificado)* (config, access control)

**Analog:** `src/config/roleAccess.ts` linhas 22-23 (padrão OPERATIONAL = owner/admin/member)

**Adicionar** (após `/compras: OPERATIONAL`):
```typescript
"/produtos-vendidos": OPERATIONAL,   // análise analítica — mesmo nível que /compras
"/analise-precos":    OPERATIONAL,
```

**CRÍTICO:** Sem este registro, `canAccess` retorna `false` para qualquer role → redirecionamento silencioso para /vendas (pitfall Phase 54, confirmado em `/consultor`).

---

### `src/components/layout/ApiSidebar.tsx` *(modificado)* (config, navigation)

**Analog:** `src/components/layout/ApiSidebar.tsx` linhas 34-39 (array `children` do grupo "Dashboard")

**Adicionar** ao final do `children` do grupo Dashboard (após `{ icon: Receipt, label: "Margem", ... }`):
```tsx
{ icon: ShoppingBag,  label: "Produtos Vendidos", path: "/produtos-vendidos" },
{ icon: BarChart2,    label: "Análise de Preços",  path: "/analise-precos"   },
```

**Ícones:** `ShoppingBag` já importado (linha 18 do arquivo); `BarChart2` já importado no PrecoPraticadoReport do oficial (linha 4) e disponível no lucide-react do projeto. Alternativa: `LineChart` (também disponível).

---

## Shared Patterns

### Paginação de `orders` (obrigatório em todos os hooks que tocam essa tabela)
**Fonte:** `src/components/mercadolivre/anuncios/useMLListingSales.ts` linhas 33-34, 84-108
**Aplicar em:** `useMLSoldProducts.ts`
```typescript
const PAGE     = 1_000;  // limite PostgREST
const MAX_ROWS = 50_000; // teto de segurança

// Loop:
while (!cancelled && accumulated.length < MAX_ROWS) {
  const { data, error } = await supabase.from("orders").select(...).range(offset, offset + PAGE - 1);
  if (!data || data.length === 0) break;
  accumulated.push(...data);
  if (data.length < PAGE) break;
  offset += PAGE;
}
```

### `data_pedido` TEXT — filtros de data
**Fonte:** `src/components/mercadolivre/anuncios/listingSalesAgg.ts` linhas 67-68 + useMLListingSales linhas 76-91
**Aplicar em:** `useMLSoldProducts.ts`, migration SQL
```typescript
// Filtro client: passar string "YYYY-MM-DD" diretamente
.gte("data_pedido", fromDate)   // fromDate = "2026-06-01"
.lte("data_pedido", toDate)     // toDate   = "2026-07-01"

// Agregação: key via slice, nunca new Date()
const key = row.data_pedido.slice(0, 10);
```

### Cleanup com flag `cancelled` (todos os useEffect com fetch assíncrono)
**Fonte:** `src/components/mercadolivre/anuncios/useMLListingSales.ts` linhas 71, 94, 110, 127-129
```typescript
let cancelled = false;
// ... fetch ...
if (cancelled) return;
return () => { cancelled = true; };
```

### Lazy route + RoleRoute + ErrorBoundary
**Fonte:** `src/App.tsx` linhas 127-144
```tsx
const Página = React.lazy(() => import("./pages/mercadolivre/Página"));
// ...
<Route path="/rota" element={
  <RoleRoute><ErrorBoundary fallbackTitle="Erro"><Página /></ErrorBoundary></RoleRoute>
} />
```

### Sticky header da página
**Fonte:** `src/pages/mercadolivre/MLCompras.tsx` linhas 166-220
```tsx
<div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
    <MLPageHeader title="Nome da Página" />
    {/* controles de filtro/toggle */}
  </div>
</div>
```

### Mobile dual-layout (painel Produtos Vendidos)
**Fonte:** feedback `feedback_mlanuncios_dual_layout.md` + RESEARCH.md Pitfall 7
**Aplicar em:** `MLProdutosVendidos.tsx`
- Lista de pvGroups: usar botões (`<button>`) — funciona mobile nativo sem tabela
- Tabela de pvItems: usar `ResponsiveTable` (disponível em `src/components/ui/responsive-table.tsx`) OU padrão de cards mobile (`lg:hidden` / `hidden lg:block`)
- Garantir que clicar em um grupo funcione tanto no layout mobile (card) quanto desktop (tabela)

---

## Sem Analog Direto

| Arquivo | Role | Motivo |
|---|---|---|
| `supabase/migrations/20260677000000_orders_price_timeseries.sql` | migration SQL | Nenhuma RPC de série temporal de preços existe no projeto — porte do oficial com cast adaptado |

---

## Metadata

**Escopo de busca de analogs:** `src/pages/mercadolivre/`, `src/hooks/`, `src/components/mercadolivre/anuncios/`, `src/config/`, `src/App.tsx`, `src/components/layout/ApiSidebar.tsx`, `/root/garment-glow-official/src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx`
**Arquivos lidos:** 9
**Data do mapeamento:** 2026-07-01
