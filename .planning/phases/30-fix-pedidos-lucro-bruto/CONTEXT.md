# Phase 30 — Fix: Pedidos Não Carrega + Lucro Bruto Errado

## Contexto

Dois bugs reportados por Wesley em 2026-06-01 no dashboard garment-glow-test:

### Bug 1 — Lucro Bruto errado em `/vendas`

**Sintoma:** O card "Custos" (MLCostCard) exibe Lucro Bruto com valor incorreto.

**Root cause identificada via análise de código:**

Em `MercadoLivre.tsx` (linha 560), `gross_revenue` é definido como:
```typescript
gross_revenue={(costWaterfall?.paid_revenue ?? 0) > 0
  ? costWaterfall!.paid_revenue!        // fonte: orders (RPC)
  : effectiveMetrics?.total_revenue ?? 0  // fonte: ml_daily_cache
}
```

Mas `comissao` e `frete` são:
```typescript
comissao={costWaterfall?.total_comissao ?? ...}  // fonte: orders
frete={costWaterfall?.total_frete ?? ...}         // fonte: orders
```

Quando `get_cost_waterfall` retorna `paid_revenue = 0` (porque `receita_bruta` é null nos pedidos)
mas `total_comissao > 0` e `total_frete > 0` (porque `sale_fee` e frete estão preenchidos),
o card mistura:
- receita de `ml_daily_cache` (maior, inclui todos os pedidos)
- custos de `orders` (apenas pedidos pagos)

Resultado: Lucro Bruto = receita_daily_cache − custos_orders → valor inflado/errado.

**Localização do bug:**
- `src/pages/MercadoLivre.tsx` linhas 559-568 (props do MLCostCard)
- `src/hooks/useMLCostWaterfall.ts` (deveria sinalizar "sem dados" quando paid_revenue = 0)

### Bug 2 — Página `/pedidos` não carrega os pedidos

**Sintoma:** A página de pedidos exibe lista vazia mesmo com período selecionado.

**Root causes identificadas:**

**2a. Timezone mismatch na busca e armazenamento:**
- `sync-ml-orders` usa `date_from + T03:00:00Z` (BRT midnight) para o range da ML API
- Mas armazena `data_pedido = order.date_created.substring(0, 10)` = data UTC
- Pedidos criados entre `00:00Z` e `02:59Z` (antes da meia-noite BRT) ficam com a data UTC do dia anterior
- Esses pedidos nunca são re-buscados em syncs subsequentes

**2b. Gap de dados histórico:**
- Commit `9ba8d630` (2026-05-29) revelou que todos os jobs de orders falhavam desde 2026-05-25 (4 dias)
- A tabela `orders` pode estar vazia ou com dados muito escassos

**2c. Edge functions possivelmente não deployadas:**
- Último commit relevante: `9ba8d630` (2026-05-29)
- Não há evidência de deploy das edge functions `sync-ml-orders` e `process-sync-job` após esse fix

**2d. Query sem cast de data:**
- `MLPedidos.tsx` usa `.lte("data_pedido", dateTo)` onde `data_pedido` é `timestamptz`
- Comparação com string "yyyy-MM-dd" pode excluir pedidos por diferença de timezone

## Escopo da Phase

1. Verificar estado real da tabela `orders` via SQL no Supabase
2. Fazer deploy das edge functions se necessário
3. Corrigir Bug 1: lógica de fallback no MLCostCard para usar fonte consistente
4. Corrigir Bug 2: query de pedidos com cast correto + fix de timezone no armazenamento
5. Backfill de orders para preencher gap de dados se aplicável

## Dependências

- Nenhuma (fase de bugfix independente)
