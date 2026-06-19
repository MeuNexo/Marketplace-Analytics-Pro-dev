# Phase 46: UX para Leigos - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 9 (2 new, 7 modified)
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/kpi-glossary.ts` | utility/config | static-data | `src/lib/utils.ts` (estrutura de módulo) | partial-match (mesmo padrão de export nomeado) |
| `src/components/ui/empty-state.tsx` | component/ui | request-response (props) | `src/components/ui/card.tsx` | role-match (primitivo shadcn, forwardRef, cn, named export) |
| `src/components/dashboard/KPICard.tsx` | component | request-response (props) | si mesmo (modificação) | exact |
| `src/components/mercadolivre/MLKPIGrid.tsx` | component | request-response (props) | si mesmo (modificação) | exact |
| `src/pages/mercadolivre/MLAnuncios.tsx` | page | request-response + CRUD | si mesmo (modificação) | exact |
| `src/pages/mercadolivre/MLPedidos.tsx` | page | request-response + CRUD | si mesmo (modificação) | exact |
| `src/pages/mercadolivre/MLFinanceiro.tsx` | page | request-response + CRUD | si mesmo (modificação) | exact |
| `src/pages/mercadolivre/MLEstoque.tsx` | page | request-response | `MLPedidos.tsx` (NotConnected pattern) | role-match |
| `src/components/mercadolivre/MLSalesAnalytics.tsx` | component | request-response | si mesmo (modificação) | exact |

---

## Pattern Assignments

### `src/lib/kpi-glossary.ts` (utility, static-data)

**Analog:** `src/lib/utils.ts`

Este é um novo arquivo de módulo TypeScript puro — sem JSX, sem imports de componentes. O padrão do projeto para módulos lib é: named exports, sem default export, tipagem explícita no topo.

**Estrutura do módulo analog** (`src/lib/utils.ts` linhas 1–6):
```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Padrão a copiar para `kpi-glossary.ts`:**
- Arquivo sem default export — apenas named exports
- Tipar o Record com um union type explícito (`GlossaryKey`) antes de usar
- Exportar o tipo `GlossaryEntry` e o `GlossaryKey` para consumo pelos componentes
- Nenhuma dependência de runtime além de TypeScript puro

**Estrutura concreta (copiar diretamente):**
```typescript
// src/lib/kpi-glossary.ts
export type GlossaryKey =
  | "receita_total" | "pedidos" | "ticket_medio" | "visitas"
  | "conversao" | "compradores" | "unidades_vendidas"
  | "markup" | "custo_operacional" | "impostos"
  | "cffe" | "comissao_ml" | "cfonpn" | "cmv"
  | "receita_bruta" | "receita_liquida" | "lucro_bruto" | "publicidade"
  | "roas" | "acos" | "tacos" | "cobertura" | "ruptura"
  | "margem_bruta" | "margem_liquida" | "margem_operacional" | "margem_pos_ads";

export interface GlossaryEntry {
  term: string;
  definition: string;
  example?: string;
}

export const KPI_GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  // ... entradas conforme RESEARCH.md §Pattern 2
};
```

---

### `src/components/ui/empty-state.tsx` (component/ui, request-response)

**Analog:** `src/components/ui/card.tsx`

O padrão de componentes em `src/components/ui/` segue o gerado pelo shadcn/ui: `React.forwardRef`, `cn()` para classes, named exports, interface de props acima do componente.

**Estrutura shadcn/ui para primitivos** (`src/components/ui/card.tsx` linhas 1–43):
```typescript
import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-xl border-0 bg-card text-card-foreground shadow-sm", className)} {...props} />
  ),
);
Card.displayName = "Card";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
```

**Divergência para EmptyState:** Este componente tem props de domínio (`icon`, `title`, `description`, `actionLabel`, `actionHref`, `onAction`, `size`) — não é um forwardRef simples. O padrão correto é function component com interface explícita, como é feito em `src/components/dashboard/KPICard.tsx`.

**Imports necessários** (copiar do button.tsx + card.tsx):
```typescript
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
```

**Button pattern** para o CTA (de `src/components/ui/button.tsx` linhas 39–43):
```typescript
// Button com asChild + Link (react-router)
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
// Uso: <Button asChild size="sm"><Link to="/rota">Label</Link></Button>
```

**Named export esperado:** `export function EmptyState(...)` — sem default export, consistente com todos os outros `src/components/ui/*.tsx`.

---

### `src/components/dashboard/KPICard.tsx` (component, modification)

**Analog:** si mesmo — é uma modificação cirúrgica do bloco tooltip existente.

**Bloco atual a substituir** (linhas 94–106):
```typescript
{tooltip && (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}
```

**Imports a adicionar / remover:**
```typescript
// REMOVER (linha 5):
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ADICIONAR:
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HelpCircle } from "lucide-react";
// Manter Info importado pois pode ser usado em outros lugares; verificar antes de remover
```

**Estado a adicionar** dentro do componente, antes do `return`:
```typescript
const [tooltipOpen, setTooltipOpen] = useState(false);
```

**Popover pattern** (de `src/components/ui/popover.tsx` linhas 6–29):
```typescript
// Popover controlado — substitui o bloco Tooltip (linhas 94-106 de KPICard.tsx)
{tooltip && (
  <Popover open={tooltipOpen} onOpenChange={setTooltipOpen}>
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label="Ver definição"
        className="inline-flex w-3.5 h-3.5 items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors focus:outline-none"
        onMouseEnter={() => setTooltipOpen(true)}
        onMouseLeave={() => setTooltipOpen(false)}
        onClick={(e) => { e.stopPropagation(); setTooltipOpen(v => !v); }}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      align="start"
      sideOffset={6}
      className="w-auto max-w-[240px] px-3 py-2 text-xs"
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      {tooltip}
    </PopoverContent>
  </Popover>
)}
```

**Nota sobre PopoverContent padrão:** `src/components/ui/popover.tsx` linha 20 tem `w-72` hardcoded como classe base. Sempre passar `className="w-auto max-w-[240px] ..."` para sobrescrever. O `className` passado é merged via `cn()` interno do componente.

---

### `src/components/mercadolivre/MLKPIGrid.tsx` (component, modification)

**Analog:** si mesmo — é wiring do glossário nas 10 KPICards existentes.

**Padrão de consumo do tooltip hoje** (linhas 143–146):
```typescript
// Compradores — único KPI que já tem tooltip hoje:
<KPICard
  title="Compradores"
  // ...
  tooltip="Compradores únicos no período selecionado."
/>
```

**Padrão a replicar para todos os outros KPIs:**
```typescript
// No topo do arquivo, adicionar:
import { KPI_GLOSSARY } from "@/lib/kpi-glossary";

// Helper local (evita repetição):
const g = KPI_GLOSSARY;
const tip = (key: keyof typeof KPI_GLOSSARY) => {
  const e = g[key];
  return e.example ? `${e.definition} ${e.example}` : e.definition;
};

// Uso em cada KPICard:
<KPICard title="Receita Total" tooltip={tip("receita_total")} ... />
<KPICard title="Pedidos"       tooltip={tip("pedidos")} ... />
<KPICard title="Ticket Médio"  tooltip={tip("ticket_medio")} ... />
<KPICard title="Visitas"       tooltip={tip("visitas")} ... />
<KPICard title="Conversão"     tooltip={tip("conversao")} ... />
<KPICard title="Compradores"   tooltip={tip("compradores")} ... />  // substituir string atual
<KPICard title="Unidades Vendidas" tooltip={tip("unidades_vendidas")} ... />
// Markup, Custo Operacional, Impostos — idem
```

**Grid wrapper** (linha 76) — não modificar:
```typescript
<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
```

---

### `src/pages/mercadolivre/MLAnuncios.tsx` (page, modification)

**Tabela atual** — usa shadcn `<Table>` dentro de `<div className="max-h-[600px] overflow-auto">` (linhas 1246–1316).

**Empty state atual** (linhas 1240–1244):
```typescript
// ANTES:
<div className="p-8 text-center text-muted-foreground">
  <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-30" />
  <p className="text-sm">{search || stockFilter !== "all" || statusFilter !== "all"
    ? "Nenhum produto encontrado" : "Nenhum produto ativo"}</p>
</div>

// DEPOIS:
import { EmptyState } from "@/components/ui/empty-state";
<EmptyState
  icon={ShoppingBag}
  title={search || stockFilter !== "all" || statusFilter !== "all"
    ? "Nenhum produto encontrado" : "Nenhum produto ativo"}
  description={search || stockFilter !== "all" || statusFilter !== "all"
    ? "Nenhum anúncio corresponde ao filtro atual. Tente limpar os filtros."
    : "Você não tem anúncios ativos no Mercado Livre."}
  size="compact"
/>
```

**Padrão tabela→cards mobile** (analog: MLPedidos.tsx — render condicional com `useIsMobile`):
```typescript
import { useIsMobile } from "@/hooks/use-mobile";

// No componente:
const isMobile = useIsMobile();

// No render — substituir o bloco do Table:
{isMobile ? (
  <div className="space-y-2 p-2">
    {filtered.map((item) => (
      <div key={item.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium line-clamp-2 flex-1">{item.title}</p>
          {/* badge de status se houver */}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {[
            ["Preço",   currFmt(item.price)],
            ["Estoque", String(item.available_quantity)],
            // columnView === "financeiro":
            ["Mg. Bruta",  pctFmt(item.margem_bruta)],
            ["Mg. Líq.",   pctFmt(item.margem_liquida)],
            ["Mg. Op.",    pctFmt(item.margem_operacional)],
          ].map(([label, val]) => (
            <div key={label}>
              <span className="text-muted-foreground">{label} </span>
              <span className="font-mono tabular-nums">{val}</span>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
) : (
  <div className="max-h-[600px] overflow-auto">
    <Table>{/* existente — sem modificação */}</Table>
  </div>
)}
```

**Cores a substituir em MLAnuncios.tsx:**
- linha 392: `text-emerald-700` → `text-kpi-positive`
- linha 517: `text-emerald-600` → `text-kpi-positive`, `text-destructive` já está correto (é token)

---

### `src/pages/mercadolivre/MLPedidos.tsx` (page, modification)

**Tabela principal atual** — `<table>` HTML nativo dentro de `<div className="overflow-x-auto max-h-[560px] overflow-y-auto">` (linhas 1293–1295).

**Padrão de uma row atual** (linhas 1341–1384):
```typescript
<tr key={`${order.id}-${idx}`} className="hover:bg-muted/30 transition-colors">
  <td className="px-6 py-3 text-muted-foreground text-xs whitespace-nowrap">
    {order.date ? format(parseISO(order.date), "dd/MM/yy") : "—"}
  </td>
  <td className="px-3 py-3 max-w-[220px]">
    <p className="font-medium text-xs truncate">{order.id}</p>
    <p className="text-xs text-muted-foreground truncate">{order.titulo}</p>
  </td>
  // ... mais colunas
  <td className="px-3 py-3 text-right text-xs">
    {order.cost_total != null
      ? <span className="text-red-600 font-mono">−{currFmt(order.cost_total)}</span>
      : <span className="text-muted-foreground/60">—</span>}
  </td>
```

**Padrão mobile cards** (mesmo padrão descrito em MLAnuncios — copiar estrutura):
```typescript
const isMobile = useIsMobile();

{isMobile ? (
  <div className="space-y-2 p-2">
    {filtered.map((order, idx) => (
      <div key={`${order.id}-${idx}`} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{order.id}</p>
            <p className="text-xs text-muted-foreground line-clamp-2">{order.titulo}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {[
            ["Data",      order.date ? format(parseISO(order.date), "dd/MM/yy") : "—"],
            ["Bruto",     currFmt(order.gross_revenue)],
            ["Comissão",  `−${currFmt(order.ml_commission)}`],
            ["Frete",     order.free_shipping ? `−${currFmt(order.shipping_cost)}` : "—"],
            ["Líquido",   currFmt(order.net_revenue)],
            ["M. Líquida", pctFmt(order.net_margin_pct)],
          ].map(([label, val]) => (
            <div key={label}>
              <span className="text-muted-foreground">{label} </span>
              <span className="font-mono tabular-nums">{val}</span>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
) : (
  <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
    <table className="w-full text-sm">{/* existente */}</table>
  </div>
)}
```

**Cores a substituir em MLPedidos.tsx:**
- linhas 113–116, função `marginColor()`:
  ```typescript
  // ANTES:
  function marginColor(pct: number) {
    if (pct >= 10) return "text-emerald-600";
    if (pct >= 5)  return "text-amber-600";
    if (pct >= 0)  return "text-orange-500";
    return "text-red-600";
  }
  // DEPOIS:
  function marginColor(pct: number) {
    if (pct >= 10) return "text-kpi-positive";
    if (pct >= 5)  return "text-amber-600";       // warning — manter amber
    if (pct >= 0)  return "text-orange-500";      // borderline — manter orange
    return "text-kpi-negative";
  }
  ```
- linha 282: `text-red-600` → `text-kpi-negative`
- linha 538: `text-red-600` → `text-kpi-negative`
- linha 1371: `text-red-600` → `text-kpi-negative`

**Empty states:**
- `function NotConnected()` (linha 155) → substituir por `<EmptyState icon={Plug} ... actionHref="/integracoes">`
- `function EmptyReport()` (linha ~612) → substituir por `<EmptyState icon={ClipboardList} ...>`

---

### `src/pages/mercadolivre/MLFinanceiro.tsx` (page, modification)

**Tabela por produto atual** — `<table>` HTML nativo dentro de `<div className="overflow-x-auto">` (linhas 739–840).

**Row pattern** (linhas 764–837):
```typescript
{pagedProducts.map((p, i) => (
  <tr key={p.item_id} className={`border-b border-border/40 last:border-0 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
    <td className="px-3 py-2.5 pl-5 text-xs text-muted-foreground tabular-nums">{pageStart + i + 1}</td>
    <td className="px-3 py-2.5">
      <p className="font-medium line-clamp-1 max-w-[220px]">{p.titulo}</p>
    </td>
    // colunas com tabular-nums text-xs whitespace-nowrap
    <td className={`... ${p.lucro >= 0 ? "text-emerald-600" : "text-red-600"}`}>
      {currFmt(p.lucro)}
    </td>
```

**Padrão mobile cards** (mesma estrutura das outras páginas):
```typescript
const isMobile = useIsMobile();

{isMobile ? (
  <div className="space-y-2 p-2">
    {pagedProducts.map((p) => (
      <div key={p.item_id} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
        <p className="text-xs font-medium line-clamp-2">{p.titulo}</p>
        {p.sku && <p className="text-[11px] font-mono text-muted-foreground">{p.sku}</p>}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {[
            ["Receita",    currFmt(p.receita)],
            ["Comissão",   currFmt(p.comissao)],
            ["Frete",      currFmt(p.frete)],
            ["Lucro R$",   currFmt(p.lucro)],
            ["Lucro %",    p.lucro_pct != null ? pctFmt(p.lucro_pct) : "—"],
          ].map(([label, val]) => (
            <div key={label}>
              <span className="text-muted-foreground">{label} </span>
              <span className={`font-mono tabular-nums ${label === "Lucro R$" || label === "Lucro %" ? (p.lucro >= 0 ? "text-kpi-positive" : "text-kpi-negative") : ""}`}>
                {val}
              </span>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
) : (
  <div className="overflow-x-auto">{/* tabela existente */}</div>
)}
```

**Cores a substituir em MLFinanceiro.tsx:**
- linha 808: `text-emerald-600` → `text-kpi-positive` (lucro por produto)
- linha 816: `text-emerald-600` → `text-kpi-positive`
- linha 818: `text-red-600` → `text-kpi-negative`
- linha 951: `text-emerald-600` → `text-kpi-positive` (lucro por marca)
- linha 959: `text-emerald-600` → `text-kpi-positive`
- linha 961: `text-red-600` → `text-kpi-negative`
- linha 1023: `text-emerald-600` → `text-kpi-positive` (lucro por SKU)
- linha 1031: `text-red-600` → `text-kpi-negative`
- **NÃO substituir:** `#10b981`, `#ef4444`, `#3b82f6` em `fill=` de Recharts SVG (linhas 579–584) — Recharts não suporta CSS vars

**Spacing fix** no grid de KPIs: linha com `grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3` — adicionar `md:grid-cols-4` ou `md:grid-cols-6` para evitar cards muito pequenos em ~600px.

---

### `src/pages/mercadolivre/MLEstoque.tsx` (page, modification — UX-04 only)

**Analog:** `MLPedidos.tsx` `NotConnected` pattern (linhas 155–...)

**Modificação:** Substituir o bloco `NotConnected` inline (linha 971) por `<EmptyState>`. Não há tabela a converter para mobile nesta fase (RESEARCH.md §UX-03 escopo = /anuncios, /pedidos, /financeiro).

**UX-04:** `MLEstoque.tsx` usa `dark:text-blue-400`, `dark:text-violet-400` nos badges logísticos (linhas 43–48) — esses são corretos e não devem ser alterados (são cores de categoria, não semântica positivo/negativo).

---

### `src/components/mercadolivre/MLSalesAnalytics.tsx` (component, modification)

**Analog:** si mesmo (substituição de EmptyState local).

**EmptyState local atual** (linha 107):
```typescript
// ANTES — EmptyState local genérico:
return <EmptyState message="Selecione o período 'Hoje' ou um dia específico para ver vendas por hora." />;

// DEPOIS — componente compartilhado:
import { EmptyState } from "@/components/ui/empty-state";
import { Clock } from "lucide-react";

return (
  <EmptyState
    icon={Clock}
    title="Nenhuma venda por hora"
    description="Selecione o período 'Hoje' ou um dia específico para ver as vendas por hora."
    size="compact"
  />
);
```

---

## Shared Patterns

### Popover controlado (hover + tap)
**Source:** `src/components/ui/popover.tsx` (linhas 6–29) + modificação de `KPICard.tsx`
**Apply to:** KPICard.tsx (único ponto de modificação; todos os outros herdam via prop)

```typescript
// popover.tsx exports (linhas 6–8, 29):
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
// PopoverContent tem w-72 default — SEMPRE sobrescrever com className="w-auto max-w-[240px] ..."
export { Popover, PopoverTrigger, PopoverContent };
```

### useIsMobile hook
**Source:** `src/hooks/use-mobile.tsx` (linhas 1–19)
**Apply to:** MLAnuncios.tsx, MLPedidos.tsx, MLFinanceiro.tsx

```typescript
// use-mobile.tsx — linha 3: breakpoint é 768px (< 768px = mobile)
// Retorna boolean; false no primeiro render (imperceptível em SPA Vite)
import { useIsMobile } from "@/hooks/use-mobile";
const isMobile = useIsMobile();
```

### Card mobile row pattern
**Apply to:** MLAnuncios.tsx, MLPedidos.tsx, MLFinanceiro.tsx

Classes base consistentes para cards mobile:
```typescript
// Container:
<div className="space-y-2 p-2">
// Card individual:
<div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
// Grid de pares label:valor:
<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
// Par label:valor:
<span className="text-muted-foreground">{label} </span>
<span className="font-mono tabular-nums">{val}</span>
```

### KPI token substitution
**Source:** `src/index.css` linhas ~69-71 (light) e ~131-133 (dark)
**Apply to:** MLPedidos.tsx, MLFinanceiro.tsx, MLAnuncios.tsx

```typescript
// Regra: substituir em className= de elementos React
"text-emerald-600" → "text-kpi-positive"   // lucro positivo, margens positivas
"text-red-600"     → "text-kpi-negative"   // custo, lucro negativo, cancelamentos

// EXCEÇÕES (não substituir):
// 1. fill= / stroke= em Recharts SVG (não suportam CSS vars)
// 2. bg-emerald-*/text-emerald-* em STATUS_CONFIG (cores de status são categorias fixas, não semântica)
// 3. dark:text-* explícitos em MLEstoque badges logísticos (são corretos)
```

### EmptyState usage pattern
**Source:** `src/components/ui/empty-state.tsx` (novo componente desta fase)
**Apply to:** MLAnuncios.tsx, MLPedidos.tsx, MLFinanceiro.tsx, MLEstoque.tsx, MLSalesAnalytics.tsx, TopSellingProducts.tsx

```typescript
import { EmptyState } from "@/components/ui/empty-state";
import { [IconName] } from "lucide-react";

// Padrão sem CTA (dados vêm de sync automático):
<EmptyState
  icon={Package}
  title="Nenhum produto encontrado"
  description="Sincronize suas vendas para ver os produtos mais vendidos."
  size="compact"
/>

// Padrão com CTA de navegação:
<EmptyState
  icon={Plug}
  title="Mercado Livre não conectado"
  description="Conecte sua conta para visualizar o estoque em tempo real."
  actionLabel="Ir para Integrações"
  actionHref="/integracoes"
/>
```

---

## No Analog Found

Nenhum arquivo desta fase ficou sem analog adequado. Todos os padrões têm fonte verificada no codebase.

---

## Metadata

**Analog search scope:** `src/components/ui/`, `src/components/dashboard/`, `src/components/mercadolivre/`, `src/pages/mercadolivre/`, `src/hooks/`, `src/lib/`
**Files read:** 12 arquivos fonte
**Pattern extraction date:** 2026-06-17

### Notas de implementação críticas

1. **PopoverContent default `w-72`** (popover.tsx linha 20) — sempre sobrescrever com `className="w-auto max-w-[240px] px-3 py-2 text-xs"` no KPICard.
2. **TooltipProvider global** em `src/App.tsx` linha 68 — o `TooltipProvider` local removido do KPICard não afeta o app (o global continua).
3. **Recharts SVG** — `fill="#10b981"` e similares em MLFinanceiro.tsx linhas ~579-584 NÃO devem ser alterados para tokens CSS.
4. **`useIsMobile()` retorna `false` no 1º render** — a tabela aparece por <16ms antes de trocar para cards em mobile. Comportamento aceitável, não requer tratamento especial.
5. **MLSalesAnalytics tem `EmptyState` local** na linha 107 com prop `message` — é um componente diferente do novo `EmptyState`. Substituir completamente, não reusar.
