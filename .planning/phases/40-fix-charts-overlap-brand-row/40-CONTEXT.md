# Phase 40 — fix-charts-overlap-brand-row

**Mode:** bugfix
**Reportado por:** Wesley (print 2026-06-04, Dashboard › Vendas)
**Depends on:** Nothing (correção puramente visual/layout — não toca dados nem edge functions)

## Sintoma

Na página `/` (Vendas), a linha com os 3 gráficos de marca renderiza **sobreposta**:
- "Faturamento por Marca", "Markup por Marca" e "Custo Operacional Diário" lado a lado.
- O eixo X de um chart invade o vizinho (datas 05/27, 05/29, 05/31 empilhadas/duplicadas).
- As legendas (Pralana, Zebu, Sandrini, TXC, Eldorado, Radade, Marcatto) de dois charts se misturam na mesma linha.
- O eixo X do "Custo Operacional Diário" estoura para fora do Card (06/03 aparece além da borda).

## Causa raiz

Layout pai em `src/pages/MercadoLivre.tsx:607`:

```tsx
<div key="brand_row" className="grid grid-cols-1 lg:grid-cols-3 gap-3">
  <BrandRevenueChart ... />
  <BrandMarkupChart ... />
  <CustoOperacionalChart ... />
</div>
```

Itens de **CSS grid têm `min-width: auto` por padrão**. O `ResponsiveContainer`/SVG do
Recharts (renderizado dentro do `ChartContainer` shadcn) possui largura intrínseca > 0.
Resultado: cada coluna `1fr` cresce além do permitido e **transborda sobre as vizinhas**,
sobrepondo eixos e legendas. É o bug clássico Recharts-em-grid/flex sem `min-w-0`.

Os 3 componentes têm `<Card>` como raiz **sem className** (logo, sem `min-w-0`):
- `src/components/mercadolivre/BrandRevenueChart.tsx:62` (sucesso) + ~31/44 (loading/erro)
- `src/components/mercadolivre/BrandMarkupChart.tsx:59` (sucesso) + ~24/41 (loading/erro)
- `src/components/mercadolivre/CustoOperacionalChart.tsx:70` (sucesso) + ~30/43 (loading/erro)

## Fix proposto

Aplicar `className="min-w-0 overflow-hidden"` ao `<Card>` raiz dos **3 componentes**, em
**TODOS os returns** (sucesso + loading + erro) — para que loading/erro também respeitem a
coluna. Usar `cn(...)` se o Card já receber className em algum estado.

Alternativa equivalente (menos completa): envolver cada chart num `<div className="min-w-0">`
no grid pai. Preferir o fix no componente, pois cobre os estados de loading/erro também.

Se após `min-w-0` a **legenda** do Recharts ainda forçar largura mínima maior que a coluna,
adicionar `overflow-hidden` / `flex-wrap` no wrapper da legenda (ChartLegend) ou reduzir a
fonte da legenda.

## Critérios de aceite

1. `lg` (≥1024px): 3 charts lado a lado, cada um em 1/3 da largura, sem invasão de eixo X.
2. Legendas de cada chart abaixo do próprio chart, sem duplicar/misturar com o vizinho.
3. Eixo X do "Custo Operacional Diário" não vaza do Card.
4. Mobile (`grid-cols-1`): cada chart full-width, empilhado.
5. Estados de loading e erro também confinados à coluna.
6. `npx tsc --noEmit` sem erros.

## Validação

- `npx tsc --noEmit`
- Dev server (`vite`, porta 8080) → `/` → conferir os 3 charts em `lg` e mobile (DevTools responsive).
- Conferir os 3 estados: carregando, com dados, e sem dados (erro/vazio).

## Arquivos afetados

- `src/components/mercadolivre/BrandRevenueChart.tsx`
- `src/components/mercadolivre/BrandMarkupChart.tsx`
- `src/components/mercadolivre/CustoOperacionalChart.tsx`
- (opcional) `src/pages/MercadoLivre.tsx:607` — wrapper `min-w-0` se optar por fix no pai

## Escopo

Apenas layout/CSS. **Não** altera queries, hooks de dados, edge functions nem schema.
