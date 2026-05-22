# Phase 20: Dashboard Vendas Personalizável — Context

**Created:** 2026-05-21
**Milestone:** v7.0
**Status:** Planning

---

## Goal

Duas melhorias no dashboard de Vendas (`/`):

1. **KPIs expandidos** — Os 7 cards compactos atuais são difíceis de ler. Todos os indicadores disponíveis devem aparecer em formato maior, igual ao padrão dos outros menus.

2. **Dashboard personalizável** — O usuário escolhe quais seções ver, em qual ordem, salvo em `localStorage`. Sem nova dependência de biblioteca; apenas toggle de visibilidade + reordenação com setas, acessível via botão "Personalizar" no topo da página.

---

## Estado Atual da Página Vendas

### KPI Grid (MLKPIGrid.tsx)
- 7 cards com `size="compact"` e `variant="minimal"` em grid `lg:grid-cols-7`
- KPIs: Receita Total, Pedidos, Ticket Médio, Visitas, Conversão, Markup das Vendas, Custo Operacional
- **Faltando:** Compradores Únicos (`unique_buyers`), Impostos (`total_tax`), Unidades Vendidas (`units_sold`)

### Seções da página (de cima para baixo)
1. `kpi_grid` — MLKPIGrid (7 cards compactos)
2. `revenue_chart` — MLRevenueChart + GoalsCard (grid `lg:grid-cols-[1fr_320px]`)
3. `cost_waterfall` — MLCostCard + MLTopProducts (grid `lg:grid-cols-6`)
4. `brand_charts` — BrandRevenueChart, BrandMarkupChart, CustoOperacionalChart, BrandSharePieChart

### Arquivos-chave
```
src/pages/MercadoLivre.tsx                    ← página principal (orquestra seções)
src/components/mercadolivre/MLKPIGrid.tsx     ← grid de KPI cards
src/components/dashboard/KPICard.tsx          ← card individual (size: compact/default/tv)
src/hooks/useMLKPISummary.ts                  ← já tem total_tax e has_tax_data
```

---

## Requisitos Funcionais

### RF-01: KPIs Expandidos
- Cards no tamanho `default` (não `compact`)
- Grid responsivo: 2 cols mobile → 3 cols sm → 4 cols md → 5 cols lg → sem limite fixo de colunas
- Adicionar 3 KPIs que já existem nos dados mas não aparecem:
  - **Compradores Únicos** (`metrics.unique_buyers`)
  - **Unidades Vendidas** (`metrics.units_sold`)
  - **Impostos** (`kpiSummary.total_tax` — com `has_tax_data` guard)

### RF-02: Dashboard Personalizável
- Botão "Personalizar" no topo da página abre um `Sheet` lateral (shadcn/ui — já disponível)
- Lista de widgets com nome, descrição e toggle (Switch) de visibilidade
- Reordenação via botões ↑ ↓ por widget
- Preferências salvas em `localStorage` com key `ml_dashboard_layout_v1`
- Widgets visíveis renderizados na ordem definida pelo usuário
- Botão "Restaurar padrão" reseta para configuração default

### RF-03: Persistência
- `localStorage` apenas (sem banco, sem API) — instantâneo, sem loading
- Prefixado por `ml_user_id` se houver múltiplas contas: `ml_dashboard_layout_v1__{ml_user_id}` ou global se "all"
- Graceful degradation: se localStorage falhar, usa defaults

---

## Widgets Definidos

| ID | Label | Descrição | Padrão |
|----|-------|-----------|--------|
| `kpi_grid` | KPIs de Vendas | Cards com receita, pedidos, ticket, visitas, etc. | visível, pos 1 |
| `revenue_chart` | Gráfico de Receita | Evolução diária/horária + card de metas | visível, pos 2 |
| `cost_waterfall` | Custos & Top Produtos | Waterfall financeiro + produtos mais vendidos | visível, pos 3 |
| `brand_charts` | Gráficos de Marca | Faturamento, markup, custo operacional e share por marca | visível, pos 4 |

---

## Restrições Técnicas

- **Sem novas dependências** — não usar `react-grid-layout`, `dnd-kit` ou similares
- Reordenação simples via botões ↑ ↓ (não drag-and-drop)
- `Sheet` já está disponível via shadcn/ui (`src/components/ui/sheet.tsx`)
- `Switch` já disponível via shadcn/ui (`src/components/ui/switch.tsx`)
- Manter compatibilidade com Modo TV (`/tv`) — layout fixo sem personalização
- `size="default"` no KPICard já está implementado; basta remover `size="compact"`

---

## Critérios de Sucesso

1. KPI cards aparecem em tamanho default (maior) com pelo menos 10 indicadores
2. Botão "Personalizar" aparece no header da página Vendas
3. Sheet abre com lista de widgets + toggles + setas de reordenação
4. Ocultar uma seção a remove da página; reabrir a traz de volta
5. Reordenar widgets muda a ordem de renderização na página
6. Preferências sobrevivem a reload da página (localStorage)
7. "Restaurar padrão" reseta para configuração inicial
8. TypeScript sem erros; nenhum KPI ou funcionalidade existente regride
