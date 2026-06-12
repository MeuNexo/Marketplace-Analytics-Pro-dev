# Phase 24 — Publicidade: Ads Analytics Completo

## Objetivo

Transformar a página de Publicidade (`/publicidade`) em um painel de otimização de ads acionável, com:

1. **Métricas completas** nas tabelas de produtos e campanhas (ACoS, TACoS, CVR, Impressões, Share Ads%, ACoS Breakeven)
2. **Alertas de diagnóstico** — top 10 TACoS, anúncios sem conversão, ads em ruptura
3. **Sincronização real-time** — igual ao painel de Vendas (botão Atualizar, última sinc, auto-sync no mount)
4. **Remoção de cruft** — aba Relatórios e gráficos que não adicionam valor

## Playbook Laura (regras de negócio que devem aparecer na UI)

Fonte: `/root/paperclip-agents/laura/AGENTS.md` e `/root/nexo/wiki/ads_wiki.md`

| Situação | Diagnóstico | Ação sugerida |
|----------|-------------|---------------|
| MC < 0% E ACoS < 10% | Problema de PREÇO, não ads | Não pausar — revisar preço |
| MC < 0% E ACoS > 30% | Ads ineficiente | Pausar/reduzir lance |
| Gasto > R$10 sem venda em 7d | Gasto sem retorno | Pausar ads |
| ROAS > 8x | Campeão — escalar | Aumentar budget +30% máx/semana |
| TACoS > 8% | Zona crítica | Reduzir budget ou negativar termos |
| TACoS < 4% | Zona saudável | Manter ou escalar |
| Estoque = 0 + ads ativo | Custo sem retorno | Pausar imediatamente |

**Metas operacionais Pé Vermeio:** TACoS < 8%, ROAS > 4x, ROAS mínimo viável 2.5x

## Estrutura de Dados

### Tabelas Supabase (existentes)
- `ml_ads_daily_cache` — diário por store: `impressions, clicks, spend, attributed_revenue, attributed_orders, cpc, ctr, roas`
- `ml_ads_campaigns_cache` — por campanha: `campaign_id, name, status, daily_budget, impressions, clicks, spend, attributed_revenue, attributed_orders, cpc, ctr, roas`
- `ml_ads_products_cache` — por produto: `item_id, title, thumbnail, impressions, clicks, spend, attributed_revenue, attributed_orders, cpc, ctr, roas`
- `ml_daily_cache` — diário total: `total (receita bruta), approved (receita paga), qty (pedidos)`
- `product_costs` — custo por SKU: `item_id, unit_cost` — para `acos_breakeven`

### Métricas a calcular no frontend

| Métrica | Fórmula | Fonte |
|---------|---------|-------|
| `acos` | `spend / attributed_revenue * 100` | ads_products_cache |
| `cvr` | `attributed_orders / clicks * 100` | ads_products_cache |
| `tacos` | `spend / (attributed_revenue + organic_revenue) * 100` | ads + ml_daily_cache |
| `organic_revenue` | `total_daily_revenue - attributed_revenue` | ml_daily_cache |
| `share_ads_pct` | `attributed_orders / total_orders * 100` | ads + ml_daily_cache |
| `acos_breakeven` | `(price - unit_cost) / price * 100` | ads_products + product_costs |
| `sov` | Não disponível sem API específica | "—" |
| `tacos_global` | `total_spend / total_revenue * 100` | ads + ml_daily_cache |
| `acos_global` | `total_spend / total_attributed_revenue * 100` | ads_daily_cache |

### organic_revenue por período
- Buscar `ml_daily_cache` filtrado por `organization_id + ml_user_id + date range`
- Somar `approved` (ou `total`) = `total_revenue_period`
- `organic_revenue = total_revenue_period - total_attributed_revenue`

### ACoS Breakeven por produto
- Fetch `product_costs` table joinando por `item_id`
- `price = attributed_revenue / attributed_orders` (preço médio de venda via ads)
- `acos_be = (price - unit_cost) / price * 100`
- Se `unit_cost` null → mostrar "—"

### Ads sem conversão
- Filtrar `products` onde `attributed_orders === 0 AND spend > limiar`
- Limiar: R$10 padrão (configurável no futuro)

### Top 10 TACoS
- Filtrar produtos com `tacos > 0`, ordenar desc, pegar top 10

### Ads em ruptura
- Join com `MLInventoryContext` (`stockByItem`) onde `stock === 0 AND status === 'active'`

## Sincronização

### Problema atual
`useMLAds` usa `useState` + `useCallback` próprio — não está integrado ao React Query nem ao sistema de sync do `useMLSync`. Tem seu próprio `syncNow` que chama `sync-ads` edge function.

### O que adicionar (sem refatorar useMLAds inteiro)
1. **Auto-sync no mount** — verificar `localStorage("ads_last_synced_ts")`, se > 10min, chamar `syncNow()` automaticamente
2. **Última sinc** — já existe `lastUpdated` no hook, apenas exibir no header
3. **Cooldown UI** — desabilitar botão Atualizar durante sync + 30s após
4. **Supabase Realtime** — subscription em `ml_ads_daily_cache` para invalidar dados após sync automático

## Remoção de Cruft

### Remover
- Aba "Relatórios" e componente `PublicidadeRelatorios` (import + uso)
- `FunnelChart`, `ComposedChart`, `Area`, `Bar`, `Line` de recharts (se não usados em outro lugar)
- Tabs `TabsList/TabsTrigger/TabsContent` (se a única aba era Relatórios)
- Props `prevCampaigns`, `currentFrom/prevFrom` passadas para PublicidadeRelatorios

### Manter
- KPI cards no topo
- Tabela de Campanhas
- Tabela de Produtos Patrocinados
- Period picker
- Botão Atualizar + Última sinc

## Layout Final da Página

```
[Header: Publicidade | Última sinc: X | Período | Atualizar]

[KPI Row: Gasto Total | ROAS Global | ACoS Global | TACoS Global | Impressões | Cliques]

[Alertas (3 cards em linha)]
┌─────────────────┬─────────────────┬─────────────────┐
│ 🔴 Sem Conversão│ 🟡 Top TACoS    │ 🟠 Em Ruptura   │
│ N produtos      │ Produto: X%     │ N ads ativos    │
│ Gasto: R$X      │ Produto: X%     │ Gasto: R$X      │
│ [lista compacta]│ [lista compacta]│ [lista compacta]│
└─────────────────┴─────────────────┴─────────────────┘

[Tabela: Produtos Patrocinados]
Colunas: Produto | Impressões | Cliques | CTR | CVR | Gasto | Receita Ads | ROAS | ACoS | TACoS | Share Ads% | ACoS BE | Estoque

[Tabela: Campanhas]
Colunas: Campanha | Status | Budget/dia | Impressões | Cliques | CTR | Gasto | Receita | ROAS | ACoS
```

## Restrições
- Sem novas dependências
- Sem mudanças em edge functions
- SOV mostrado como "—" (dado não disponível via sync atual)
- Se `organic_revenue < 0` (erro de sync), TACoS mostra "—" ou usa só ACoS
- `acos_breakeven` só exibe para produtos COM custo cadastrado
