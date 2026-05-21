# Phase 16: KPIs de Marca — Context

**Created:** 2026-05-21
**Milestone:** v6.0 — Dashboard de Vendas — KPIs de Marca
**Status:** Planning

---

## Goal

Adicionar 7 novos KPIs ao Dashboard de Vendas (`/`) que revelam markup real, custo operacional e breakdown por marca — dados que hoje não existem no dashboard.

## Business Context

O dashboard já mostra comissão e frete reais (Phase 14 ✅). O próximo passo natural é:
1. Calcular **markup** (quanto o preço de venda representa em relação ao custo)
2. Agregar **custo operacional total** (frete + ads + comissão em um único número)
3. Quebrar tudo **por marca** — Zebu, Pralana, TXC, Sandrini, etc. — para saber qual marca puxa receita, qual tem melhor markup e qual consome mais custo

## KPIs a Implementar

### Cards de KPI (novos, sem brand)
1. **Markup das Vendas** = `SUM(receita_bruta) / SUM(custo_unit * quantidade)` — card com valor e trend
2. **Custo Operacional da Plataforma** = `frete + ads + comissão` total — card com R$ e % sobre receita

### Gráficos (requerem campo `marca` em `orders`)
3. **Gráfico de linha: markup por marca ao longo do tempo** — cada marca = uma linha, Y = markup ratio
4. **Gráfico de área empilhado: faturamento por marca ao longo do tempo** — receita acumulada por marca
5. **Gráfico de linha: custo operacional ao longo do tempo** — total diário de frete+ads+comissão
6. **Pizza: participação de receita por marca** — donut, top 7 marcas + "Outros"
7. **Pizza: participação de volume por marca (unidades)** — donut, mesma estrutura

## Data Sources

### Tabela `public.orders` (existente)
- Campos disponíveis: `item_id`, `titulo`, `quantidade`, `preco_unit`, `receita_bruta`, `comissao`, `frete`, `custo_unit`, `data_pedido`, `status`, `ml_user_id`, `organization_id`
- Campo FALTANTE: `marca` — precisa ser adicionado e populado via ML API

### `ml_ads_daily_cache` (existente)
- Usado para ads spend no custo operacional

### ML API — endpoint de itens em batch
- `GET /items?ids=MLB123,MLB456,...` — retorna até 20 itens por request
- O campo `brand` está em `item.attributes` (array de `{id: "BRAND", value_name: "Pralana"}`)
- Necessário para popular `orders.marca`

## Technical Approach

### Plano de Dados (sem `marca`, KPIs 1-2):
- KPI cards de Markup e Custo Operacional calculados diretamente de `public.orders` + `ml_ads_daily_cache`
- Sem mudanças no banco ou edge functions

### Plano de Marca (KPIs 3-7):
1. **Migration**: Adicionar coluna `marca TEXT` em `public.orders`
2. **Edge function `sync-ml-orders` v5→v6**: Após buscar orders, para cada batch de `item_id` únicos, chamar ML API `/items?ids=...` e popular `marca` no upsert
3. **Hook `useMLOrdersByBrand`**: Agrega receita, unidades e markup por marca + time series por marca
4. **Componentes**: BrandRevenueChart, BrandMarkupChart, CustoOperacionalChart, BrandSharePieChart (receita), BrandVolumePieChart (unidades)

## Referência Visual

Baseado na análise do `nexointeligence` (repo GitHub MeuNexo/nexointeligence):
- Biblioteca: **Recharts** (já presente no projeto)
- BrandRevenueChart: `AreaChart` com `stackOffset="expand"` ou empilhamento absoluto
- BrandMarkupChart: `LineChart` multi-série (1 linha por marca)
- Pies: `PieChart` com `innerRadius` (donut), legendas externas
- Cores definidas via HSL usando tokens do theme existente

## Current State

```
/root/garment-glow-test/
  src/
    hooks/
      useMLOrders.ts        ← agrega comissão/frete/receita total, SEM breakdown por marca
      useMLAds.ts           ← ads spend diário
    pages/mercadolivre/
      MercadoLivre.tsx      ← página principal (rota /)
    components/ui/chart.tsx ← wrapper Recharts existente (shadcn/ui)
  supabase/
    functions/
      sync-ml-orders/index.ts  ← v5, já em produção (verify_jwt: false)
    migrations/
      20260521190000_orders_rls_and_unique_fix.sql ← última migration de orders
```

## Supabase Project
- ID: `ckcdevcxgvueywivefgx`
- `public.orders` tem 0 rows de `marca` (coluna não existe ainda)
- Recharts já instalado: `recharts 2.15.4`

## Success Criteria

1. Card "Markup das Vendas" exibe ratio correto (ex: 2.3x) calculado de `SUM(receita_bruta) / SUM(custo_unit * quantidade)` — sem hardcode
2. Card "Custo Operacional" exibe R$ e % calculados de `SUM(frete) + SUM(comissao) + ads_total` para o período selecionado
3. `public.orders` tem coluna `marca` populada para orders sincronizados após deploy
4. Gráfico de faturamento por marca exibe curvas distintas para as top 5 marcas (Zebu, Pralana, TXC, Sandrini, Radade) no período
5. Gráficos de pizza mostram participação correta por marca — soma = 100%
6. Gráfico de markup por marca mostra linha por marca ao longo do período selecionado
7. KPIs existentes (comissão, frete, ticket médio, receita) NÃO regridem

## Constraints

- Stack: React + TypeScript + shadcn/ui + Recharts (já instalado) — sem novas dependências de gráfico
- Edge function em Deno — usar fetch nativo, sem npm packages de HTTP
- `sync-ml-orders` já está em produção: mudanças devem ser não-breaking (coluna `marca` nullable)
- Scope: `organization_id` + `ml_user_id` em todas queries (multi-tenant)
- ML API batch items: máximo 20 IDs por request — iterar em batches se necessário
