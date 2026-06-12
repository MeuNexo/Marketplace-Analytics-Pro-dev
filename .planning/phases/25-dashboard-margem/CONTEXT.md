# Phase 25 — Dashboard de Margem & Lucro Bruto

## Objetivo

Transformar a página `/financeiro` (MLFinanceiro.tsx) de 100% mock data para um painel real e acionável de margem e lucro bruto, com:

1. **Dados 100% reais** da tabela `orders` — zero dependência de `financialMockData.ts`
2. **Filtro de período** igual às páginas Vendas e Publicidade (MLPeriodPicker + calendar)
3. **KPIs completos** — Receita Bruta, Comissão, Frete, CMV, Impostos, Lucro Bruto R$ e %
4. **Waterfall de margem** — onde o dinheiro vai (cascata visual)
5. **Lucro por Produto** com Curva ABC (A/B/C por concentração de lucro)
6. **Lucro por Marca** — tabela com margem por marca
7. **Lucro por Estado** — tabela com pedidos e margem por UF
8. **Tendência de Lucro Bruto** — gráfico de linha com % ao longo do tempo
9. **Sync real-time** — botão Atualizar + Supabase Realtime em `orders`

## Fonte de Dados Real

### Tabela `orders` (já existente, dados reais)
Campos disponíveis:
- `data_pedido` — data do pedido (filtro de período)
- `status` — filtrar por `["paid","shipped","delivered"]`
- `receita_bruta` — faturamento por item
- `comissao` — comissão ML por item (campo real, não estimativa)
- `frete` — frete do vendedor por item (campo real, não estimativa)
- `custo_unit` — CMV unitário
- `quantidade` — quantidade vendida
- `tax_amount` — imposto calculado
- `item_id`, `titulo`, `sku`, `marca` — dimensões de produto
- `estado` — estado do comprador (UF do destino)
- `listing_type` — tipo de anúncio (classic/premium)
- `preco_unit` — preço unitário

### Hook a criar: `useMLMarginAnalysis`
Única query que busca todos os campos de orders e retorna:
- `daily` — agregado por data (para gráfico diário)
- `byProduct` — agregado por item_id (para tabela de produtos + curva ABC)
- `byBrand` — agregado por marca (para tabela de marcas)
- `byEstado` — agregado por estado (para tabela de estados)
- `summary` — totais do período

### Fórmulas
```
lucro_bruto_item = receita_bruta - (custo_unit * quantidade) - comissao - frete - tax_amount
lucro_bruto_pct = lucro_bruto_item / receita_bruta * 100
```

### Curva ABC (por lucro bruto R$)
- Ordenar produtos por lucro_bruto desc
- Calcular % acumulada do lucro total
- A = acumula até 80%
- B = de 80% até 95%
- C = acima de 95%

## Cards / Seções da Página

### 1. KPI Row (7 cards)
| Card | Fonte | Cor |
|------|-------|-----|
| Receita Bruta | SUM(receita_bruta) | azul |
| CMV Total | SUM(custo_unit*quantidade) | slate |
| Comissão ML | SUM(comissao) | laranja |
| Frete | SUM(frete) | azul |
| Impostos | SUM(tax_amount) | roxo |
| Lucro Bruto R$ | receita - cmv - comissao - frete - impostos | verde/vermelho |
| Lucro Bruto % | lucro / receita * 100 | verde/vermelho |

### 2. Composição da Receita por Dia (manter, com dados reais)
Gráfico de barras empilhadas: Lucro Bruto + CMV + Comissão + Frete + Impostos = Receita
Linha secundária: Lucro % (eixo direito)

### 3. Waterfall de Margem (novo)
Gráfico cascata horizontal mostrando: Receita → -CMV → -Comissão → -Frete → -Impostos → Lucro Bruto
Usando `ComposedChart` do recharts com bars positivas/negativas

### 4. Lucro por Produto (novo)
Tabela com chips ABC + busca:
Colunas: # | Produto | Receita | CMV | Comissão | Frete | Impostos | Lucro R$ | Lucro % | Curva
Sort por Lucro R$ desc por default
Paginação (20/pág)

### 5. Lucro por Marca (novo)
Tabela: Marca | Pedidos | Receita | CMV | Comissão | Frete | Lucro R$ | Lucro %
Sort por Lucro R$ desc

### 6. Lucro por Estado (novo)
Tabela: Estado | Pedidos | Receita | Lucro R$ | Lucro %
Sort por Lucro R$ desc

### 7. Tendência de Lucro Bruto (novo)
LineChart: linha de Lucro % por dia + linha de referência 0%
Delta vs período anterior no título

## O que Remover
- `financialMockData.ts` (ou desconectar — não deletar para não quebrar imports)
- Cards "Comissão por Tipo de Anúncio" (estimativa mock)
- Card "Frete (Custo do Vendedor)" (estimativa mock)
- Disclaimer "Valores estimados"
- Selector de período 7/15/30 dias (substituir por MLPeriodPicker)
- Badge "Dados simulados" / "Receita real · Taxas estimadas"

## Comportamento de Sync
- Usar `useMLSync` já existente (mesmo sistema do painel Vendas)
- Botão Atualizar com spinner/cooldown
- Supabase Realtime: subscription em `orders` via canal `orders_changes_{orgId}`
- Auto-sync: verificar `ml_last_synced_ts` no localStorage, sync se > 10min

## Restrições
- Sem novas dependências
- Sem mudanças em edge functions
- Produtos sem `custo_unit`: mostrar Lucro Bruto sem CMV (parcial), sinalizar com "sem CMV"
- Se `orders` vazio para o período: mostrar empty state adequado
