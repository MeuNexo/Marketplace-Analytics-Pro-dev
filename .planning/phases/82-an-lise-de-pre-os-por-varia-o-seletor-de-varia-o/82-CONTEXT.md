# Phase 82: Análise de Preços por Variação - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning
**Source:** Brainstorming + validação manual com dados reais (Wesley) → spec aprovado

<domain>
## Phase Boundary

Adiciona **seletor de variação** em `/analise-precos` (`PrecoPraticadoReport.tsx`). Default =
anúncio pai (Phase 81 intacta). Variação selecionada → toda a análise (faixas de preço, giro,
estoque, cobertura) passa a ser daquela variação. Evolui a Phase 81 na MESMA branch
`feat/analise-precos-giro-cobertura` (PR #27) — a 81 sozinha (cobertura só pelo pai) NÃO vai
pra prod isolada; o pai vira o caso default e a variação é o refinamento preciso.

**Não entra:** métrica agregada "giro sustentável + % rompido" (descartada), comparação de
múltiplas variações, reposição automática. Preço/margem seguem no nível do anúncio.
</domain>

<decisions>
## Implementation Decisions (LOCKED — aprovadas por Wesley)

### UX
- Base = anúncio pai. Sem variação selecionada → análise geral (comportamento Phase 81).
- Seletor de variação com opção default fixa "Todas as variações (anúncio)". Selecionou uma →
  tudo filtra por ela.
- Isso resolve "preço varia por variação" de graça: ao selecionar, o gráfico usa o preço
  praticado daquela variação.
- Reset do seletor ao trocar de anúncio. Seletor oculto/desabilitado se `has_variations=false`.

### Fonte de dados condicional (o util precoFaixas.ts NÃO muda)
- Série: `orders_price_timeseries(_item_id)` (pai) OU `orders_price_timeseries(_item_id, _sku)` (variação).
- Estoque injetado em `computePrecoFaixas`: `available_quantity` do anúncio (pai) OU da variação.

### Backend (RPC)
- `orders_price_timeseries` ganha `_sku text DEFAULT NULL` (opcional). Não-nulo → `AND o.sku = _sku`.
  Nada mais muda (GROUP BY por dia, SECURITY INVOKER, sem subquery correlacionada). DROP+CREATE
  (assinatura muda; padrão Phase 79). Deploy via MCP `apply_migration` no `ckcdevcxgvueywivefgx`.

### Aviso no nível pai
- Quando o anúncio tem variações e nenhuma está selecionada, mostrar linha discreta:
  "Anúncio com N variações (M esgotadas) — selecione uma variação para cobertura precisa."
  Evita o número agregado do pai enganar.

### Claude's Discretion
- Formato exato do label da variação no dropdown, do badge e do aviso; posição do seletor;
  se o resumo de variações esgotadas vira util puro testado ou cálculo inline.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec e fase anterior
- `docs/superpowers/specs/2026-07-03-analise-precos-por-variacao-design.md` — design completo.
- `docs/superpowers/specs/2026-07-02-giro-cobertura-por-faixa-design.md` — Phase 81 (base).
- `.planning/phases/81-*/81-CONTEXT.md` — decisões da Phase 81.

### Onde mexer
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — dropdown de variação, estado
  do SKU, fonte de estoque condicional, chamada RPC com `_sku`, badge + aviso do pai.
- `src/lib/precoFaixas.ts` — SEM mudança de lógica (recebe pontos + estoque como hoje).
- `src/contexts/MLInventoryContext.tsx` — expõe `ProductItem` (`available_quantity`, `has_variations`)
  e `ProductVariation` (`available_quantity`, `seller_custom_field`, atributos p/ label). Fonte do dropdown.
- `supabase/migrations/20260679000000_orders_price_timeseries_mco.sql` — RPC ATUAL a estender (copiar
  padrão, adicionar `_sku`).

### RPC — join
- **Vínculo por SKU, NÃO variation_id.** Filtro da RPC = `o.sku = _sku`. Estoque da variação =
  jsonb `variations[].available_quantity` onde `seller_custom_field = SKU`.
</canonical_refs>

<specifics>
## Achados da validação manual (dados reais — MLB4113792113, 57 variações, 2026-06-03..07-03)

- `orders.variation_id` casa **0 de 43** com o `id` do jsonb de estoque; `orders.sku` casa
  **43 de 43** com `seller_custom_field`. **USAR SKU.**
- Cobertura pelo pai (faixa R$40–60) = 6 dias. Variação campeã (SKU …420603, estoque 19) na
  mesma faixa = giro 95,6/dia → cobertura **0 dias**. É o número que o pai esconde.
- Variação tem dispersão de preço (vendeu a R$47 e a R$69) porque o preço do anúncio mudou no
  tempo → histograma por variação continua com 2 faixas (rico).
- Estoque pai (4401) = soma de 57 variações; 31 zeradas.
- Colunas de `orders`: `sku text`, `variation_id text`. `ml_inventory_cache.variations` jsonb tem
  `id`, `available_quantity`, `seller_custom_field`.
</specifics>

<deferred>
## Deferred Ideas
- Métrica "giro sustentável + % rompido" agregada por faixa (substituída pelo seletor).
- Comparar múltiplas variações lado a lado.
- Reposição/alerta por variação (vive em /compras, /reposicao).
</deferred>

---

*Phase: 82-analise-precos-por-variacao*
*Context gathered: 2026-07-03 via brainstorming + validação com dados reais*
