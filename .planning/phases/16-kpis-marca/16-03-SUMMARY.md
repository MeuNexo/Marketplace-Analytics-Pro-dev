---
phase: 16
plan: "03"
subsystem: mercadolivre-brand-charts
tags: [recharts, brand-analytics, area-chart, pie-chart, line-chart, supabase-types]
key-files:
  created:
    - src/hooks/useMLOrdersByBrand.ts
    - src/components/mercadolivre/BrandRevenueChart.tsx
    - src/components/mercadolivre/BrandMarkupChart.tsx
    - src/components/mercadolivre/CustoOperacionalChart.tsx
    - src/components/mercadolivre/BrandSharePieChart.tsx
  modified:
    - src/pages/MercadoLivre.tsx
    - src/integrations/supabase/types.ts
    - src/pages/mercadolivre/MLPedidos.tsx
decisions:
  - "Marca adicionada ao Supabase types manualmente (types.ts) porque 16-02 fez migration mas nao regenerou tipos"
  - "CustoOperacionalChart aceita Array<{date,spend}> compativel com AdsDailyStat sem importar o tipo"
  - "renderCustomLabel em BrandSharePieChart tipado explicitamente (sem any) para satisfazer TS strict"
metrics:
  duration: "~20min"
  completed: "2026-05-21"
  tasks: 6
  files: 8
---

# Phase 16 Plan 03: Brand Breakdown Charts Summary

5 graficos de breakdown por marca implementados — stacked AreaChart faturamento, LineChart markup ratio, LineChart custo operacional (frete+comissao+ads), 2 donuts receita/volume — alimentados por hook React Query que consulta `orders.marca` direto do Supabase.

## Componentes Criados

### `src/hooks/useMLOrdersByBrand.ts`

Hook React Query que consulta `public.orders` filtrando por `organization_id`, `ml_user_id[]`, `data_pedido` range.

Retorna `MLOrdersByBrandResult`:
- `brandRevenueSeries: BrandTimeSeries[]` — receita diaria por marca (top 7 + Outros)
- `brandMarkupSeries: BrandMarkupSeries[]` — ratio receita/custo diario por marca (null quando custo ausente)
- `custoSeries: CustoOperacionalSeries[]` — frete+comissao agregados por dia
- `topBrands: string[]` — top 7 marcas por receita total no periodo
- `brandAggregates: BrandAggregate[]` — totais por marca com markup_ratio e color
- `hasData: boolean`

Marcas alem do top 7 sao agrupadas no bucket "Outros". `BRAND_COLORS` exportado (7 cores HSL) para uso nos componentes.

### `BrandRevenueChart.tsx`

AreaChart empilhado (stackId="1") com `ChartContainer` + `ChartTooltipContent`. Formata eixo Y como `R$Xk`. Inclui Area "Outros" quando presente no dataset.

### `BrandMarkupChart.tsx`

LineChart com `connectNulls={false}` — linhas quebradas onde custo_unit nao esta cadastrado. Eixo Y em formato `X.Xx`. Empty state especifico para "Requer custo cadastrado nos anuncios" quando ha dados mas nao ha markup.

### `CustoOperacionalChart.tsx`

LineChart linha unica `custo_total = custo_plataforma (frete+comissao) + ads spend`. Ads sao mesclados via `Map<date, spend>` construido a partir de `adsDaily` (prop `Array<{date: string; spend: number}>`) — compativel diretamente com `AdsDailyStat[]` de `useMLAds` sem necessidade de importar o tipo.

### `BrandSharePieChart.tsx`

Renderiza 2 Cards lado a lado (grid 1/2 col). Cada um tem um donut (innerRadius=60, outerRadius=100). `renderCustomLabel` tipado explicitamente sem `any`. Labels percentuais brancos dentro dos segmentos, ocultos quando `percent < 0.04`.

## Wiring em MercadoLivre.tsx

`useMLOrdersByBrand(currentFrom, currentTo)` adicionado apos `useMLOrders`. Bloco de graficos inserido abaixo de `MLCostCard/MLTopProducts` na `TabsContent value="vendas"`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Coluna `marca` ausente nos tipos TypeScript gerados**
- **Found during:** Task 1 (TypeScript check pos-implementacao)
- **Issue:** O Plano 16-02 adicionou `marca` via migration SQL no Supabase mas nao regenerou `src/integrations/supabase/types.ts`. O cliente Supabase retornava `SelectQueryError<"column 'marca' does not exist on 'orders'">` em nivel de tipo, bloqueando todas as propriedades do resultado.
- **Fix:** Adicionado `marca: string | null` em Row, Insert e Update da tabela `orders` em `types.ts`.
- **Files modified:** `src/integrations/supabase/types.ts`
- **Commit:** f219a209

**2. [Rule 1 - Bug] `setSyncProgress` type mismatch em MLPedidos.tsx**
- **Found during:** TypeScript check final
- **Issue:** Estado tipado como `{ current: number; total: number } | null` mas linha 769 passava `Math.round(...)` (number) diretamente.
- **Fix:** Substituido por `setSyncProgress({ current: done, total: totalJobs })`.
- **Files modified:** `src/pages/mercadolivre/MLPedidos.tsx`
- **Commit:** f219a209

**3. [Rule 1 - Bug] Cast `data as OrderRow[]` invalido em MLPedidos.tsx**
- **Found during:** TypeScript check apos adicao de `marca` aos tipos
- **Issue:** Query sem `marca` no SELECT nao era atribuivel ao tipo `OrderRow` (que agora inclui `marca`). TS2352.
- **Fix:** Alterado para `data as unknown as OrderRow[]`.
- **Files modified:** `src/pages/mercadolivre/MLPedidos.tsx`
- **Commit:** f219a209

## Known Stubs

Nenhum stub. Todos os graficos consultam dados reais de `public.orders`. Empty states sao exibidos quando `marca IS NULL` nos registros (situacao esperada ate que o sync popule a coluna).

## Self-Check: PASSED

Arquivos criados:
- FOUND: /root/garment-glow-test/src/hooks/useMLOrdersByBrand.ts
- FOUND: /root/garment-glow-test/src/components/mercadolivre/BrandRevenueChart.tsx
- FOUND: /root/garment-glow-test/src/components/mercadolivre/BrandMarkupChart.tsx
- FOUND: /root/garment-glow-test/src/components/mercadolivre/CustoOperacionalChart.tsx
- FOUND: /root/garment-glow-test/src/components/mercadolivre/BrandSharePieChart.tsx

Commits: f277ace7, 1188d07e, f219a209

TypeScript check: 0 erros
