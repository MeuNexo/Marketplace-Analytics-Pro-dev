# Phase 23 — Dashboard Granular: Margem, % Custo e Layout por Card

## Objetivo

Três melhorias visuais/analíticas na página de Vendas:

1. **Margem Média em Top Anúncios** — nova coluna "Margem" no card Top Anúncios mostrando a margem bruta média (%) de cada produto no período filtrado, calculada a partir da tabela `orders`.

2. **% no Custo Operacional Diário** — o gráfico existente (`CustoOperacionalChart`) exibe R$ ao longo do tempo. Adicionar uma segunda linha (eixo Y direito) mostrando o custo como % da receita do dia — sem substituir o valor absoluto.

3. **Layout granular no Personalizar** — hoje os widgets "Gráficos de Marca" e "Análises Detalhadas" agrupam vários cards em bloco. O usuário quer controle individual sobre cada card (BrandRevenueChart, BrandMarkupChart, CustoOperacionalChart, BrandSharePieChart, MLSalesAnalytics) — cada um com seu próprio toggle no Personalizar. Sem seções/cabeçalhos de grupo no layout.

## Contexto técnico

### Top Anúncios — Margem Média
- Componente: `src/components/mercadolivre/MLTopProducts.tsx`
- Tipo atual: `ProductSalesRow` (item_id, title, thumbnail, qty_sold, revenue, available_quantity) — **sem custo**
- Fonte de custo: tabela `orders` tem `custo_unit`, `quantidade`, `comissao`, `frete`, `receita_bruta`, `item_id`
- Solução: query Supabase agrupada por `item_id` no período filtrado → `avg_margin_pct = (SUM(receita_bruta - custo_unit*quantidade - comissao - frete)) / SUM(receita_bruta)`
- Novo hook: `useMLProductMargins(from, to)` retorna `Map<item_id, margin_pct>`
- Fallback: produtos sem custo cadastrado (`custo_unit IS NULL`) mostram "—" na coluna

### Custo Operacional Diário — % por dia
- Componente: `src/components/mercadolivre/CustoOperacionalChart.tsx`
- Dados atuais: `CustoOperacionalSeries[]` com `date` e `custo_plataforma`
- Falta: receita diária por dia — disponível em `allDaily` (ml_daily_cache, campo `approved_revenue` ou `total`) em `MercadoLivre.tsx`
- Solução: passar `dailyRevenue: Array<{ date: string; revenue: number }>` como nova prop
- No chart: calcular `pct_custo = custo_total / revenue * 100` por dia; adicionar segunda linha com `YAxis yAxisId="right"` (0–100%) e `Line dataKey="pct_custo"`
- Tooltip: mostrar ambos valor e %

### Layout granular
- Hook: `src/hooks/useDashboardLayout.ts`
- Storage key atual: `ml_dashboard_layout_v1` — bumpar para `ml_dashboard_layout_v2`
- Widget `brand_charts` atual agrupa: BrandRevenueChart, BrandMarkupChart, CustoOperacionalChart, BrandSharePieChart
- Widget `analytics` atual: MLSalesAnalytics
- Nova lista de widgets individuais:
  ```
  kpi_grid          → KPIs de Vendas (inalterado)
  revenue_chart     → Gráfico de Receita (inalterado)
  cost_waterfall    → Custos & Top Anúncios (inalterado)
  brand_revenue     → Receita por Marca (BrandRevenueChart)
  brand_markup      → Markup por Marca (BrandMarkupChart)
  operational_cost  → Custo Operacional Diário (CustoOperacionalChart)
  brand_share       → Share de Marca (BrandSharePieChart)
  analytics         → Análises Detalhadas (MLSalesAnalytics)
  ```
- `MercadoLivre.tsx`: substituir bloco `if (widget.id === "brand_charts")` e `if (widget.id === "analytics")` por renderização individual de cada widget
- Remover qualquer `<div className="space-y-3">` wrapper que crie agrupamento visual
- Cada card já ocupa 100% de largura ou usa grid próprio — sem espaços vazios

## Restrições
- Sem novas dependências de pacotes
- Sem mudanças em edge functions (apenas frontend + hook Supabase)
- Margem: se `orders` não tiver dados para um produto, coluna mostra "—" (não quebra)
- Layout granular: storage v2 reseta automaticamente para novos defaults (código de merge já existente em `loadLayout`)
