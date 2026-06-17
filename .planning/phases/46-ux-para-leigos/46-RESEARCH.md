# Phase 46: UX para Leigos — Research

**Researched:** 2026-06-17
**Domain:** React/TypeScript UI — tooltips, empty states, responsive tables, design token consistency
**Confidence:** HIGH (all findings grounded in actual codebase reads)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (UX-01):** Criar um glossário central (arquivo único mapeando termo → definição leiga). Fonte única de verdade reutilizada por todos os ~16 pontos KPI.
- **D-02 (UX-01):** O gatilho é um ícone "?" clicável que funciona tanto em hover (desktop) quanto em clique/tap (mobile/touch). Adaptar o KPICard existente — não construir do zero.
- **D-03 (UX-01):** Definições em linguagem de lojista leigo, curtas (1 frase), com exemplo quando ajudar. Tom: "CFFE = o frete que o ML te cobra".
- **D-04 (UX-02):** Criar componente `<EmptyState>` reutilizável (ícone + título + instrução de ação específica + botão CTA).
- **D-05 (UX-02):** Instrução específica por página — o que fazer para ter dados aqui. Reaproveitar linguagem do Consultor v1.
- **D-06 (UX-03):** Abaixo de ~768px, tabelas das três páginas viram lista de cards empilhados (1 registro = 1 card com pares label:valor).
- **D-07 (UX-03):** Acima de 768px, mantém layout de tabela atual.
- **D-08 (UX-04):** Escopo de auditoria: /anuncios, /pedidos, /financeiro, /estoque, dashboard ML, /precificacao. Corrigir tokens kpi, espaçamentos e dark mode.
- **D-09 (UX-04):** As demais ~14 rotas ficam fora desta auditoria.

### Claude's Discretion

- Implementação concreta do toggle hover/click do tooltip (Radix Popover vs Tooltip controlado).
- Estrutura de dados/local do glossário (ex.: `src/lib/kpi-glossary.ts` vs JSON).
- Redação final das definições leigas de cada KPI — agentes redigem; Wesley revisa no checkpoint visual.

### Deferred Ideas (OUT OF SCOPE)

- Onboarding/tutorial guiado para primeiro acesso.
- Auditoria visual das ~14 rotas restantes.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UX-01 | Todo KPI tem tooltip/glossário em linguagem leiga acessível via hover+tap | Seção "Tooltip hover+tap" — padrão Popover controlado via useState; glossário em `src/lib/kpi-glossary.ts` |
| UX-02 | Toda página tem empty state que orienta ação específica | Seção "EmptyState component" — API proposta + 8 locais de migração mapeados |
| UX-03 | Tabelas de /anuncios, /pedidos e /financeiro sem overflow em mobile | Seção "Responsive table→cards" — padrão `useIsMobile` existente + render condicional |
| UX-04 | Consistência visual revisada nos 6 páginas principais (tokens kpi, espaçamentos, dark mode) | Seção "Visual audit" — ~20 ocorrências de hardcoded color mapeadas |

</phase_requirements>

---

## Summary

O objetivo desta fase é puramente de clareza e responsividade do que já existe — nenhum novo dado ou nova funcionalidade. Quatro entregáveis independentes e bem delimitados: (1) glossário central de KPIs com tooltip hover+tap; (2) componente `EmptyState` reutilizável; (3) tabelas das três páginas-alvo viram cards em mobile; (4) auditoria de tokens de cor e dark mode em 6 páginas.

Todo o stack necessário já existe no projeto: Radix UI Popover está instalado e tem `src/components/ui/popover.tsx` pronto; `useIsMobile` em `src/hooks/use-mobile.tsx` já funciona no breakpoint 768px; os tokens `kpi.positive/negative/neutral` estão mapeados no Tailwind config; o `KPICard` já tem prop `tooltip` com Radix Tooltip (hover-only) — a tarefa é estender para click/tap. Nenhum pacote novo é necessário.

O principal risco técnico é o tooltip em mobile: Radix Tooltip não dispara em touch por design. A solução validada é substituir o primitivo de Tooltip pelo Popover controlado via `useState<boolean>` no próprio KPICard, mantendo a mesma aparência visual. A alternativa de usar `Tooltip` com `open` controlado + `onOpenChange` funciona mas tem comportamento inconsistente em alguns browsers mobile — Popover é mais confiável e já está instalado.

**Primary recommendation:** Use Radix Popover (já em `src/components/ui/popover.tsx`) com estado `open` controlado para o "?" do KPICard. Crie o glossário como `src/lib/kpi-glossary.ts` (Record tipado). Crie `EmptyState` em `src/components/ui/empty-state.tsx`. Use `useIsMobile()` (já existe) para o render condicional tabela↔cards.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| KPI tooltip glossário | Browser/Client | — | Conteúdo estático; nenhuma chamada de rede necessária |
| Empty state por página | Browser/Client | — | Estado local baseado em props de loading/dados |
| Tabela→card mobile | Browser/Client | — | CSS/render condicional puro; dado já está no componente |
| Auditoria visual (tokens) | Browser/Client | — | Apenas classes Tailwind; sem mudanças de lógica |

---

## Standard Stack

### Core (tudo já instalado — sem novas dependências)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@radix-ui/react-popover` | já instalado (listado em CLAUDE.md stack) | Trigger hover+click para o tooltip "?" | Popover do Radix é click/tap nativo, ao contrário do Tooltip |
| `@radix-ui/react-tooltip` | já instalado | Tooltip hover-only existente no KPICard | Reusado para colunas de tabela (desktop-only ok) |
| `lucide-react` | 1.7.0 | Ícones `HelpCircle`, `Info`, `Package`, `AlertCircle`, `Plug` | Já é o padrão de ícones do projeto |
| `tailwindcss` | 3.4.17 | Classes responsivas `md:hidden`, `hidden md:table` para tabela→card | Já é o sistema de styling |
| `use-mobile.tsx` | já existe em `src/hooks/` | `useIsMobile()` ao breakpoint 768px | Evita duplicar lógica de breakpoint |

**Nenhum novo pacote a instalar.** [VERIFIED: codebase grep]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Radix Popover controlado | Radix Tooltip com `open` controlado | `Tooltip` tem `disableHoverableContent` e `onOpenChange` que às vezes não dispara corretamente em tap-then-scroll em iOS Safari — Popover é mais previsível |
| Radix Popover controlado | shadcn HoverCard | HoverCard também é hover-only por design (idêntico ao Tooltip nesse aspecto) |
| `useIsMobile()` + render condicional | CSS puro `hidden md:table` | CSS puro não funciona bem para `<table>` vs `<div>` pois `display: table` vs `display: block` requer um reset; render condicional é mais explícito e previsível |

---

## Package Legitimacy Audit

> Nenhum novo pacote externo será instalado nesta fase. Todos os primitivos usados já estão no projeto.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Usuário (mobile touch / desktop hover)
        │
        ▼
KPICard (src/components/dashboard/KPICard.tsx)
  │  tooltip prop (key do glossário OU string direta)
  │
  ├──[desktop]──► Radix Popover open=true on mouseenter
  │               ◄── close on mouseleave
  │
  └──[mobile]───► Radix Popover open=true on click/tap
                  ◄── close on click/tap fora
        │
        ▼
src/lib/kpi-glossary.ts (Record<GlossaryKey, GlossaryEntry>)
  └── definição leiga + exemplo opcional

Páginas com dados ausentes
  │
  ▼
src/components/ui/empty-state.tsx (EmptyState)
  └── icon + title + description + CTA button

Tabelas /anuncios /pedidos /financeiro
  │
  ├──[≥768px]──► <table> layout atual (sem alteração)
  │
  └──[<768px]───► render de cards via useIsMobile()
                  (1 record = 1 Card com pares label:valor)
```

### Recommended Project Structure

```
src/
├── lib/
│   └── kpi-glossary.ts        # [NOVO] glossário central de KPIs
├── components/
│   ├── ui/
│   │   └── empty-state.tsx    # [NOVO] componente EmptyState reutilizável
│   └── dashboard/
│       └── KPICard.tsx        # [MODIFICAR] tooltip hover+tap via Popover
├── pages/mercadolivre/
│   ├── MLAnuncios.tsx         # [MODIFICAR] tabela→card mobile + UX-04
│   ├── MLPedidos.tsx          # [MODIFICAR] tabela→card mobile + UX-04
│   ├── MLFinanceiro.tsx       # [MODIFICAR] tabela→card mobile + UX-04
│   └── MLEstoque.tsx          # [MODIFICAR] auditoria UX-04
└── components/mercadolivre/
    └── MLKPIGrid.tsx          # [MODIFICAR] wiring glossário nas 10 KPIs
```

---

## Pattern 1: Tooltip hover+tap (UX-01) — Radix Popover controlado

**O que:** Substituir o `<Tooltip>` dentro do KPICard pelo `<Popover>` com `open` controlado. O ícone "?" abre via `onMouseEnter`/`onMouseLeave` (desktop) e `onClick` (touch).

**Por que Popover e não Tooltip controlado:** Radix Tooltip, mesmo com `open` controlado, exige que o usuário mantenha foco ou hover para permanecer visível — em touch, o evento `blur` fecha imediatamente. Popover tem semântica de "permanece aberto até fechar explicitamente", ideal para tap em mobile.

**Implementação concreta para KPICard.tsx:**

```typescript
// src/components/dashboard/KPICard.tsx
// Substituir o bloco Tooltip existente (linhas 94–106) por:

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HelpCircle } from "lucide-react";

// Dentro do componente KPICard, adicionar estado:
const [tooltipOpen, setTooltipOpen] = useState(false);

// No JSX, substituir o bloco TooltipProvider/Tooltip por:
{tooltip && (
  <Popover open={tooltipOpen} onOpenChange={setTooltipOpen}>
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label="Explicação do indicador"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground/60 hover:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
        onMouseEnter={() => setTooltipOpen(true)}
        onMouseLeave={() => setTooltipOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setTooltipOpen((v) => !v);
        }}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      align="start"
      className="w-auto max-w-[240px] px-3 py-2 text-xs text-popover-foreground"
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      {tooltip}
    </PopoverContent>
  </Popover>
)}
```

**Source:** [ASSUMED] — baseado em comportamento documentado do Radix Popover e análise do KPICard existente. O padrão `onMouseEnter` + `onClick` é o padrão canônico para trigger híbrido desktop/mobile sem nova dependência.

**Nota importante:** O `<TooltipProvider>` global já envolve o app inteiro em `src/App.tsx` (linha 68). O Popover não precisa de Provider. O import do `TooltipProvider` local no KPICard (linha 95 atual) será removido.

---

## Pattern 2: Glossário central (UX-01)

**Arquivo:** `src/lib/kpi-glossary.ts`

**Estrutura recomendada:**

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
  term: string;               // rótulo técnico (ex: "CFFE")
  definition: string;         // 1 frase em linguagem leiga
  example?: string;           // (opcional) "Ex: se vendeu R$100, o CFFE foi R$14"
}

export const KPI_GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  receita_total: {
    term: "Receita Total",
    definition: "Tudo que entrou de vendas no período, antes de descontar qualquer custo.",
  },
  cffe: {
    term: "CFFE",
    definition: "O frete que o Mercado Livre te cobra por cada venda — aparece na sua fatura mensal.",
    example: "Ex: numa venda de R$100, o ML pode cobrar ~R$14 de frete.",
  },
  comissao_ml: {
    term: "Comissão ML",
    definition: "A parte que o Mercado Livre fica de cada venda (depende do tipo de anúncio).",
    example: "Ex: anúncio Clássico: ~11% da venda.",
  },
  cfonpn: {
    term: "CFONPN / Parcelamento",
    definition: "Custo de parcelamento: quando o comprador parcela, o ML desconta uma taxa do repasse.",
  },
  cmv: {
    term: "CMV",
    definition: "Custo do produto — quanto você pagou para ter o item em estoque.",
    example: "Ex: se comprou por R$30 e vendeu por R$100, o CMV é R$30.",
  },
  impostos: {
    term: "Impostos",
    definition: "Estimativa dos impostos sobre a venda, calculada pelo regime tributário configurado.",
  },
  markup: {
    term: "Markup",
    definition: "Quantas vezes o preço de venda é maior que o custo do produto.",
    example: "Ex: Markup 3x = você vende por 3x o que pagou.",
  },
  custo_operacional: {
    term: "Custo Operacional",
    definition: "Soma de todos os custos do Mercado Livre: frete (CFFE) + comissão + publicidade.",
  },
  ticket_medio: {
    term: "Ticket Médio",
    definition: "Valor médio de cada pedido no período selecionado.",
  },
  conversao: {
    term: "Conversão",
    definition: "De cada 100 pessoas que visitaram seus anúncios, quantas compraram.",
    example: "Ex: 2% = 2 compradores a cada 100 visitas.",
  },
  visitas: {
    term: "Visitas",
    definition: "Número de vezes que alguém acessou qualquer um dos seus anúncios.",
  },
  compradores: {
    term: "Compradores",
    definition: "Clientes únicos que compraram no período — cada pessoa conta uma vez.",
  },
  unidades_vendidas: {
    term: "Unidades Vendidas",
    definition: "Total de itens vendidos (um pedido pode ter mais de um item).",
  },
  pedidos: {
    term: "Pedidos",
    definition: "Número de compras realizadas no período selecionado.",
  },
  receita_bruta: {
    term: "Receita Bruta",
    definition: "Total de vendas sem descontar nenhum custo.",
  },
  receita_liquida: {
    term: "Receita Líquida",
    definition: "O que sobra após descontar comissão, frete e custos do produto.",
  },
  lucro_bruto: {
    term: "Lucro Bruto",
    definition: "Receita menos todos os custos: produto, frete, comissão, imposto e publicidade.",
  },
  publicidade: {
    term: "Publicidade",
    definition: "Quanto foi gasto em anúncios pagos no Mercado Livre (Product Ads).",
  },
  roas: {
    term: "ROAS",
    definition: "Retorno sobre o gasto de publicidade — quantos reais de venda para cada R$1 em ads.",
    example: "Ex: ROAS 5x = R$5 de venda para cada R$1 gasto.",
  },
  acos: {
    term: "ACoS",
    definition: "Percentual da receita que foi para publicidade (menor é melhor).",
    example: "Ex: ACoS 20% = de cada R$100 vendidos, R$20 foram para ads.",
  },
  tacos: {
    term: "TACoS",
    definition: "Igual ao ACoS mas calculado sobre toda a receita da conta (não só a atribuída a ads).",
  },
  cobertura: {
    term: "Cobertura",
    definition: "Quantos dias de estoque você tem com base no ritmo de vendas atual.",
    example: "Ex: cobertura 15 dias = estoque acaba em 15 dias no ritmo atual.",
  },
  ruptura: {
    term: "Ruptura",
    definition: "Produto com estoque zero — anúncio pausado automaticamente pelo ML.",
  },
  margem_bruta: {
    term: "Margem Bruta",
    definition: "Percentual que sobra da receita após descontar comissão e frete do ML.",
  },
  margem_liquida: {
    term: "Margem Líquida",
    definition: "Percentual que sobra após comissão, frete e custo do produto.",
  },
  margem_operacional: {
    term: "Mg. Op.",
    definition: "Margem calculada com base nas vendas reais do período selecionado (operacional = sem ads).",
  },
  margem_pos_ads: {
    term: "Mg. Pós-Ads",
    definition: "Margem após descontar o gasto de publicidade atribuído ao produto.",
  },
};
```

**Como o KPICard consome:** A prop `tooltip` continua aceitando `string` (texto direto) ou pode ser passado o `definition` + `example` do glossário. O MLKPIGrid e outras páginas fazem o lookup:

```typescript
// Padrão de consumo em MLKPIGrid.tsx
import { KPI_GLOSSARY } from "@/lib/kpi-glossary";

const g = KPI_GLOSSARY;

<KPICard
  title="Receita Total"
  tooltip={g.receita_total.definition}
  // ...
/>

<KPICard
  title="CFFE"
  tooltip={`${g.cffe.definition}${g.cffe.example ? ` ${g.cffe.example}` : ""}`}
  // ...
/>
```

**Por que string direta e não key lookup dentro do KPICard:** O KPICard é um componente genérico reutilizado em contextos sem KPIs ML (ex: Integrações, TV). Manter `tooltip?: string` preserva flexibilidade e evita acoplamento do componente ao domínio ML. Os consumidores (MLKPIGrid, MLFinanceiro, etc.) fazem o lookup.

---

## Pattern 3: EmptyState component (UX-02)

**Arquivo:** `src/components/ui/empty-state.tsx`

**API proposta:**

```typescript
// src/components/ui/empty-state.tsx
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;             // instrução específica de ação
  actionLabel?: string;            // texto do botão CTA
  actionHref?: string;             // link interno (react-router)
  onAction?: () => void;           // alternativa: callback
  className?: string;
  size?: "default" | "compact";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  className,
  size = "default",
}: EmptyStateProps) {
  const py = size === "compact" ? "py-10" : "py-16";
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 text-center", py, className)}>
      <Icon className={cn("text-muted-foreground/30", size === "compact" ? "w-8 h-8" : "w-12 h-12")} />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground max-w-[280px]">{description}</p>
      </div>
      {actionLabel && (actionHref ? (
        <Button asChild size="sm" variant="default">
          <Link to={actionHref}>{actionLabel}</Link>
        </Button>
      ) : onAction ? (
        <Button size="sm" variant="default" onClick={onAction}>{actionLabel}</Button>
      ) : null)}
    </div>
  );
}
```

**Sites de migração mapeados:**

| Componente / Arquivo | Linha aprox | Estado atual | EmptyState proposto |
|---|---|---|---|
| `TopSellingProducts.tsx` | L95 | `<div>` + `<Package>` + "Nenhum produto encontrado" | icon=Package, title="Nenhum produto encontrado", description="Sincronize suas vendas para ver os produtos mais vendidos.", sem CTA (dados vêm do sync automático) |
| `MLSalesAnalytics.tsx` (TabHorario) | L107 | EmptyState local genérico | icon=Clock, title="Nenhuma venda por hora", description="Selecione o período 'Hoje' ou um dia específico para ver as vendas por hora." |
| `MLSalesAnalytics.tsx` (TabDiario) | L261 | EmptyState local genérico | icon=TrendingUp, title="Sem dados de vendas", description="Nenhum dado de vendas para o período. Ajuste o filtro de período ou sincronize." |
| `MLSalesAnalytics.tsx` (TabConversao) | L539 | EmptyState local genérico | icon=Percent, title="Sem dados de conversão", description="Nenhum dado de conversão disponível. Requer visitas e vendas no período." |
| `PublicidadeRelatorios.tsx` | L107 | `<div>` + `<Target>` + texto | icon=Megaphone, title="Sem dados de publicidade", description="Não há campanha ativa ou dados de ads no período. Ative uma campanha no Gerenciador de Ads do ML.", actionLabel="Ir para Publicidade", actionHref="/publicidade" |
| `MLPedidos.tsx` `EmptyReport` | L612 | `<div>` + `<TrendingUp>` + texto | icon=ClipboardList, title="Sem pedidos no período", description="Nenhum pedido para exibir. Ajuste o filtro de período ou sincronize os dados." |
| `MLAnuncios.tsx` (filtered empty) | L1241 | `<div>` + `<ShoppingBag>` + texto | icon=ShoppingBag, title="Nenhum anúncio encontrado", description="Nenhum anúncio corresponde ao filtro atual. Tente limpar os filtros." |
| `MLEstoque.tsx` (not connected) | L971 | `<div>` + `<Plug>` + texto | icon=Plug, title="Mercado Livre não conectado", description="Conecte sua conta para visualizar o estoque.", actionLabel="Ir para Integrações", actionHref="/integracoes" |

**Observação:** Os estados `NotConnected` em MLPedidos e MLFinanceiro (com `<Plug>` + texto + botão já inline) também são candidatos à migração para EmptyState — unificaria o padrão "não conectado" em todas as páginas.

---

## Pattern 4: Tabela → Cards mobile (UX-03)

**Breakpoint:** `useIsMobile()` já usa `768px` como threshold — exatamente o especificado no critério UX-03. [VERIFIED: src/hooks/use-mobile.tsx L3]

**Abordagem:** Render condicional via `useIsMobile()` dentro de cada página. Não usar CSS puro (`hidden md:table`) porque as três tabelas-alvo usam `<table>` HTML nativo (não shadcn Table nos casos de MLFinanceiro e MLPedidos) e a troca de `display` no `<table>` requer reset de todos os filhos — mais frágil do que um render condicional.

**Estrutura de tabela atual nos três arquivos:**
- `MLAnuncios.tsx` — usa shadcn `<Table>` dentro de `<div className="max-h-[600px] overflow-auto">` (L1246-1316) [VERIFIED: codebase read]
- `MLPedidos.tsx` — usa `<table>` HTML nativo dentro de `<div className="overflow-x-auto">` (L241, L406, L1294) [VERIFIED: codebase read]
- `MLFinanceiro.tsx` — usa `<table>` HTML nativo dentro de `<div className="overflow-x-auto">` (L739, L888, L982) [VERIFIED: codebase read]

**Padrão de implementação:**

```typescript
// Em cada página, importar useIsMobile:
import { useIsMobile } from "@/hooks/use-mobile";

// No componente:
const isMobile = useIsMobile();

// No render:
{isMobile ? (
  // Card list — 1 record = 1 card
  <div className="space-y-3">
    {rows.map((row) => (
      <div key={row.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{row.titulo}</span>
          <StatusBadge status={row.status} />
        </div>
        {([
          ["Receita bruta", currFmt(row.gross_revenue)],
          ["Comissão ML",   currFmt(row.ml_commission)],
          ["Frete",         currFmt(row.shipping_cost)],
          ["Receita líq.",  currFmt(row.net_revenue)],
        ] as [string, string][]).map(([label, val]) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono tabular-nums">{val}</span>
          </div>
        ))}
      </div>
    ))}
  </div>
) : (
  // Tabela existente — sem modificação
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      {/* ... existente ... */}
    </table>
  </div>
)}
```

**Escopo concreto das tabelas a converter por página:**

| Página | Tabela | Linhas aprox | Colunas principais para card |
|---|---|---|---|
| MLPedidos.tsx | Lista de pedidos principal | L1294 | Data, produto, receita bruta, comissão, frete, receita líquida, status |
| MLPedidos.tsx | SubTabTopProdutos | L241 | Produto, pedidos, bruto, líquido, margem |
| MLPedidos.tsx | SubTabUF | L406 | Estado, pedidos, receita |
| MLFinanceiro.tsx | Tabela por produto | L739 | Produto, receita bruta, comissão, frete, lucro |
| MLFinanceiro.tsx | Tabela por marca | L888 | Marca, receita, comissão, lucro |
| MLFinanceiro.tsx | Tabela por SKU | L982 | SKU, receita, comissão, lucro |
| MLAnuncios.tsx | Tabela de anúncios (shadcn Table) | L1247 | Anúncio, preço, estoque, margem |

**Nota de escopo:** A tabela de anúncios (MLAnuncios) tem ~10 colunas em modo financeiro e ~6 em modo preço. No card mobile, exibir apenas as 4-5 colunas mais relevantes (não todas) é o approach correto — o objetivo é legibilidade, não paridade total.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tooltip click+hover | Wrapper personalizado com `document.addEventListener` | Radix Popover com `onOpenChange` | Radix já gerencia foco, escape, portal, z-index, animações — evitar bugs de accessibility |
| Glossário | Busca em banco de dados / API call | Record TypeScript estático em `src/lib/kpi-glossary.ts` | Dados são estáticos e de manutenção editorial — não precisam de round-trip de rede |
| Breakpoint detection | `window.innerWidth` inline | `useIsMobile()` existente em `src/hooks/use-mobile.tsx` | Já usa MediaQueryList com event listener correto; reescrever é risco desnecessário |
| Card mobile | Biblioteca de card layout responsivo | Tailwind classes + `<div>` semântico | Stack já tem tudo necessário; nova biblioteca seria over-engineering |

**Key insight:** Esta fase é 100% de conteúdo + wiring — os componentes primitivos já existem. O risco está em introduzir lógica desnecessariamente complexa onde uma solução simples resolve.

---

## Common Pitfalls

### Pitfall 1: Radix Tooltip não funciona em touch
**What goes wrong:** O `<Tooltip>` do Radix UI não dispara em eventos de touch (tap) no iOS Safari e Android Chrome. O KPICard atual usa Tooltip — nenhum usuário mobile vê as definições.
**Why it happens:** Radix Tooltip é baseado em `mouseenter`/`focus`, não em `click` ou `touchend`.
**How to avoid:** Usar `<Popover>` controlado via `useState` como descrito no Pattern 1. Não usar `disableHoverableContent` ou truques de `open` controlado no Tooltip — o comportamento é inconsistente.
**Warning signs:** Testar no DevTools com modo touch emulado — o tooltip não abre ao clicar.

### Pitfall 2: `display: table` não funciona bem com Tailwind `hidden md:table`
**What goes wrong:** A classe Tailwind `md:table` define `display: table`, mas `<table>` HTML nativo precisa de todos os filhos (`<thead>`, `<tbody>`, `<tr>`, `<td>`) também tendo seus `display` corretos. Em alguns navegadores, esconder/mostrar via CSS break o layout sem resetar os filhos.
**Why it happens:** O padrão CSS para tabelas responsivas via CSS puro exige `display: block` em todos os elementos quando collapsed.
**How to avoid:** Usar render condicional via `useIsMobile()` — evitar `hidden/table` puro para este caso.
**Warning signs:** Tabela aparece "achatada" ou com colunas sobrepostas em mobile.

### Pitfall 3: Hardcoded `text-emerald-600` / `text-red-600` vs tokens KPI
**What goes wrong:** O projeto tem tokens `kpi.positive` (= `text-kpi-positive`) e `kpi.negative` (= `text-kpi-negative`) no Tailwind config, mas ~20 ocorrências em MLFinanceiro e MLPedidos usam `text-emerald-600` / `text-red-600` diretamente. Em dark mode, `text-emerald-600` pode ter contraste insuficiente (a variante dark do token é diferente).
**Why it happens:** Desenvolvido antes dos tokens serem estabelecidos.
**How to avoid:** Na auditoria UX-04, substituir `text-emerald-600` por `text-kpi-positive` e `text-red-600` por `text-kpi-negative` nos contextos semânticos de positivo/negativo financeiro. Exceção: cores de chart (hardcoded hex `#10b981` em `fill=` de SVG) não precisam mudar — Recharts não suporta CSS vars diretamente.
**Warning signs:** Verificar em dark mode se valores positivos (verde) e negativos (vermelho) têm contraste de leitura adequado.

### Pitfall 4: PopoverContent padrão tem largura fixa `w-72`
**What goes wrong:** O `PopoverContent` de `src/components/ui/popover.tsx` tem `w-72` como classe padrão — 288px pode ser grande demais para um tooltip de 1 frase.
**Why it happens:** O componente shadcn gerado tem default generoso para popovers de formulário.
**How to avoid:** Ao usar `<PopoverContent>` para o tooltip do KPICard, sempre passar `className="w-auto max-w-[240px] ..."` para sobrescrever o `w-72`.
**Warning signs:** Tooltip com muito espaço em branco ao lado do texto.

### Pitfall 5: useIsMobile() retorna `undefined` no primeiro render
**What goes wrong:** `useIsMobile()` usa `useState<boolean | undefined>(undefined)` e retorna `!!isMobile`. No SSR (irrelevante aqui, é SPA) ou no primeiro render antes do `useEffect`, retornaria `false` mesmo em mobile.
**Why it happens:** O hook precisa de um ciclo de render para detectar `window.innerWidth`.
**How to avoid:** O `!!isMobile` já retorna `false` no primeiro render, então a tabela (modo desktop) aparece brevemente antes de trocar para cards. Em SPA com Vite isso é imperceptível (< 16ms). Não é necessário nenhum tratamento especial. [VERIFIED: src/hooks/use-mobile.tsx]

---

## Visual Consistency Audit Findings (UX-04)

### Ocorrências de hardcoded colors que devem usar tokens KPI

| Arquivo | Linha | Atual | Correto | Contexto |
|---|---|---|---|---|
| `MLPedidos.tsx` | L113-116 | `text-emerald-600`, `text-amber-600`, `text-red-600` em `marginColor()` | `text-kpi-positive`, (manter amber para warning), `text-kpi-negative` | Cor da margem por produto |
| `MLPedidos.tsx` | L282 | `text-red-600` em custo | `text-kpi-negative` | Coluna custo na tabela |
| `MLPedidos.tsx` | L538 | `text-red-600` | `text-kpi-negative` | Cancelamentos |
| `MLPedidos.tsx` | L1371 | `text-red-600` | `text-kpi-negative` | Custo total no pedido |
| `MLFinanceiro.tsx` | L579-584 | Ternários com `#3b82f6`, `#10b981`, `#ef4444` | manter para charts Recharts (SVG não suporta CSS vars) | Cores em Recharts Bar |
| `MLFinanceiro.tsx` | L808, L816, L818, L951, L959, L961, L1023, L1031 | `text-emerald-600`, `text-red-600` | `text-kpi-positive`, `text-kpi-negative` | Lucro por produto/marca/SKU |
| `MLAnuncios.tsx` | L392 | `text-emerald-700` | `text-kpi-positive` | Preço sugerido positivo |
| `MLAnuncios.tsx` | L517 | `text-emerald-600` / `text-destructive` | `text-kpi-positive` / `text-kpi-negative` | Diferença de preço |

**Regra clara:** Cores em `fill=` / `stroke=` de componentes Recharts (SVG) devem permanecer como hex — Recharts não suporta `hsl(var(--kpi-positive))`. Cores em Tailwind classes (`className=`) nos elementos React devem usar os tokens quando o contexto é semântico (positivo/negativo financeiro).

### Dark mode: ausência de variantes explícitas
Os arquivos auditados não usam classes `dark:text-*` explícitas — isso é correto porque os tokens CSS (`--kpi-positive`, `--kpi-negative`) já têm variantes `.dark { }` definidas em `src/index.css` (linhas 131-133). Quando as hardcoded `text-emerald-600` forem substituídas por `text-kpi-positive`, o dark mode automático funciona.

**Exceção encontrada:** `MLEstoque.tsx` usa `dark:text-blue-400`, `dark:text-violet-400`, etc. para os badges logísticos (L43-48) — esses são corretos pois são cores de categorias (não semântica positivo/negativo) e precisam de variante dark explícita.

### Espaçamentos inconsistentes
- MLFinanceiro KPI row: usa `grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3` sem breakpoint `md:` intermediário. Em telas ~600px, resulta em 4 colunas com cards muito pequenos. Recomendação: adicionar `md:grid-cols-4` ou `md:grid-cols-6`.
- MLPedidos KPI row: usa `grid-cols-2 lg:grid-cols-4 gap-4` — ok.
- MLKPIGrid: usa `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3` — bem estruturado, não precisa alterar.

---

## Code Examples

### Exemplo: KPICard com Popover híbrido

```typescript
// Bloco completo após modificação — substitui linhas 93–106 de KPICard.tsx
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HelpCircle } from "lucide-react";

// Dentro do KPICard, antes do return:
const [tooltipOpen, setTooltipOpen] = useState(false);

// No JSX:
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

### Exemplo: EmptyState usage

```typescript
// Em MLEstoque.tsx, substituir o bloco NotConnected inline (L971-983):
import { EmptyState } from "@/components/ui/empty-state";
import { Plug } from "lucide-react";

// Antes:
<div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
  <Plug className="w-12 h-12 text-muted-foreground opacity-50" />
  <p>Conecte sua conta...</p>
  <Button asChild><Link to="/integrations">Ir para Integrações</Link></Button>
</div>

// Depois:
<EmptyState
  icon={Plug}
  title="Mercado Livre não conectado"
  description="Conecte sua conta para visualizar o estoque em tempo real."
  actionLabel="Ir para Integrações"
  actionHref="/integracoes"
/>
```

### Exemplo: Card mobile em MLPedidos

```typescript
// Pattern para cada tabela de pedidos em MLPedidos.tsx
const isMobile = useIsMobile();

{isMobile ? (
  <div className="space-y-2 p-2">
    {paginatedOrders.map((order) => (
      <div key={order.id} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium line-clamp-2 flex-1">{order.titulo}</p>
          <StatusBadge status={order.status} />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {[
            ["Data",      order.date],
            ["Bruto",     currFmt(order.gross_revenue)],
            ["Comissão",  `−${currFmt(order.ml_commission)}`],
            ["Frete",     order.shipping_cost > 0 ? `−${currFmt(order.shipping_cost)}` : "—"],
            ["Líquido",   currFmt(order.net_revenue)],
            ["Margem",    pctFmt(order.net_margin_pct)],
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
  /* tabela existente não modificada */
)}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tooltip hover-only (Radix) | Popover controlado hover+tap | Phase 46 | Usuários mobile passam a ver definições dos KPIs |
| Empty states ad-hoc inline | `<EmptyState>` componente padronizado | Phase 46 | Manutenção centralizada; tom consistente |
| `text-emerald-600`/`text-red-600` hardcoded | `text-kpi-positive`/`text-kpi-negative` tokens | Phase 46 | Dark mode automático sem patches manuais |

**Deprecated/outdated:**
- `function EmptyState({ message })` local em `MLSalesAnalytics.tsx` e `MLRelatorios.tsx` → substituídas pelo componente compartilhado
- `function EmptyReport()` local em `MLPedidos.tsx` → substituída pelo componente compartilhado
- `function NotConnected()` inline em MLFinanceiro, MLPedidos, MLEstoque → consolidar em EmptyState

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Radix Popover com `onMouseEnter`/`onClick` combinado funciona corretamente em iOS Safari sem quirks | Pattern 1 | Pode precisar de `onTouchEnd` em vez de `onClick` em alguns dispositivos — baixo risco, fácil de ajustar |
| A2 | `useIsMobile()` retornando `false` no primeiro render (antes do `useEffect`) não causa flash perceptível em SPA Vite | Pattern 4 | Em conexões muito lentas pode haver flash de tabela→card; resolver com `isMobile === undefined` check se reportado |

**Se esta tabela estiver vazia:** Todas as afirmações foram verificadas ou citadas — não é o caso; A1 e A2 são suposições de comportamento browser que precisarão ser confirmadas no checkpoint visual com Wesley.

---

## Open Questions

1. **Tom das definições do glossário**
   - What we know: D-03 especifica "linguagem de lojista leigo, 1 frase, sem jargão, com exemplo quando ajudar"
   - What's unclear: O glossário proposto nesta pesquisa traz rascunhos iniciais — Wesley precisa revisar e aprovar o tom antes do go-live (D-03 diz "agentes redigem; Wesley revisa")
   - Recommendation: Incluir checkpoint visual explícito no plano onde Wesley revisa o glossário completo (~ 26 definições)

2. **Escopo das tabelas mobile no MLAnuncios**
   - What we know: A tabela principal tem ~10 colunas em modo financeiro; modo mobile não pode exibir todas
   - What's unclear: Quais 4-5 colunas priorizar no card mobile (preço? margem? estoque? nome?)
   - Recommendation: No plano, o agente decide as 5 colunas prioritárias baseadas em frequência de uso; Wesley confirma no checkpoint visual

3. **Tabelas de sub-relatórios em MLPedidos**
   - What we know: MLPedidos tem 3 sub-tabelas em relatórios (Top Produtos, Por Estado, Tipo de Anúncio)
   - What's unclear: As sub-tabelas de relatórios (SubTabTopProdutos, SubTabUF) precisam de versão card mobile ou basta overflow-x scroll para relatórios?
   - Recommendation: Converter a tabela de pedidos principal (a mais usada); sub-relatórios com scroll horizontal aceitável como segunda prioridade

---

## Environment Availability

> Step 2.6: SKIPPED — fase é puramente de mudanças de código frontend/UI. Nenhuma dependência externa além do projeto React já em execução.

---

## Validation Architecture

> `workflow.nyquist_validation` = `false` em `.planning/config.json`. Seção omitida.

---

## Security Domain

> Esta fase não introduz novas superfícies de autenticação, autorização, entrada de usuário (sem forms novos), ou chamadas de rede. Os componentes criados (`EmptyState`, `kpi-glossary.ts`) são puramente de apresentação. Nenhuma ASVS category aplicável nova.
>
> **ASVS V5 Input Validation:** O campo `tooltip` do KPICard recebe string proveniente do glossário estático (não de input do usuário) — sem risco de XSS.

---

## Sources

### Primary (HIGH confidence)
- Codebase direto — todos os arquivos mencionados foram lidos nesta sessão [VERIFIED: codebase read]
  - `src/components/dashboard/KPICard.tsx` — tooltip prop, Tooltip shadcn, estrutura
  - `src/components/ui/tooltip.tsx` — primitivo Radix, hover-only
  - `src/components/ui/popover.tsx` — Radix Popover disponível, API
  - `src/components/ui/hover-card.tsx` — HoverCard disponível (hover-only, descartado)
  - `src/hooks/use-mobile.tsx` — useIsMobile, breakpoint 768px
  - `src/index.css` — tokens --kpi-positive/negative/neutral, dark mode
  - `tailwind.config.ts` — kpi.positive/negative/neutral mapeados
  - `src/components/mercadolivre/MLKPIGrid.tsx` — 10 KPIs, 4 com tooltip existente
  - `src/pages/mercadolivre/MLAnuncios.tsx` — tabela shadcn Table, tooltip em colunas
  - `src/pages/mercadolivre/MLPedidos.tsx` — tabela HTML nativa, empty states, cores hardcoded
  - `src/pages/mercadolivre/MLFinanceiro.tsx` — tabela HTML nativa, cores hardcoded, KPI cards
  - `src/pages/mercadolivre/MLEstoque.tsx` — NotConnected inline, tabela shadcn
  - `src/components/mercadolivre/MLSalesAnalytics.tsx` — EmptyState local, KPI cards
  - `src/components/mercadolivre/PublicidadeRelatorios.tsx` — empty state ad-hoc
  - `src/components/mercadolivre/TopSellingProducts.tsx` — empty state inline
  - `CLAUDE.md` — stack completo verificado

### Secondary (MEDIUM confidence)
- Conhecimento da API Radix UI Popover (`onOpenChange`, `open` controlado, `onOpenAutoFocus`) [ASSUMED] — comportamento documentado mas não verificado via Context7 nesta sessão

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — todos os packages verificados na codebase real
- Architecture: HIGH — baseado em leitura direta dos arquivos fonte
- Pitfalls: HIGH — pitfall 1 (Radix Tooltip mobile) é comportamento documentado do Radix; pitfall 3-4 verificados no código
- Glossário KPI (conteúdo): MEDIUM — rascunhos iniciais, precisam revisão de Wesley
- Popover iOS behavior: MEDIUM — comportamento esperado mas não testado em dispositivo real nesta sessão

**Research date:** 2026-06-17
**Valid until:** 2026-07-17 (stack estável; nenhuma dependência em mudança)
