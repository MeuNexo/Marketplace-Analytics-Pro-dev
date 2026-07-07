# Análise de Preços por Variação — seletor de variação em /analise-precos

**Data:** 2026-07-03
**Página:** `/analise-precos` (garment-glow-test)
**Autor:** Wesley + Nexo
**Status:** Design aprovado — pronto para planejamento GSD (Phase 82)
**Evolui:** Phase 81 (giro e cobertura por faixa) — mesma branch `feat/analise-precos-giro-cobertura` / PR #27

## Motivação

A Phase 81 adicionou giro e cobertura por faixa de preço, mas calculados no **anúncio pai**
(soma de todas as variações). Validação manual com o MLB4113792113 (57 variações) expôs que
isso **engana**: o pai mostra "cobertura 6 dias" na faixa de preço baixo, mas a variação
campeã em vendas (SKU …420603, giro ~40/dia) tem só 19 unidades → esgota **hoje**; 31 das 57
variações já estão zeradas. A cobertura pelo pai é uma média que esconde rupturas por variação.

Giro, estoque e cobertura **só fazem sentido por variação**. Preço e margem fazem sentido no
anúncio (o preço é praticado no anúncio; em geral todas as variações compartilham o preço, mas
em alguns anúncios o preço varia por variação).

## Objetivo

Adicionar um **seletor de variação** em `/analise-precos`. Por padrão a análise é do anúncio
pai (comportamento da Phase 81). Ao selecionar uma variação, **toda a análise passa a ser
daquela variação** — faixas de preço, giro, estoque e cobertura. Simples, preciso, sem
agregações que enganam.

## Decisão-chave de UX (Wesley)

- **Base = anúncio pai.** Sem variação selecionada → análise geral do anúncio (Phase 81, intacta).
- **Seletor de variação** (default "Todas (anúncio)"). Selecionou uma → tudo filtra por ela.
- Isso resolve o caso "preço varia por variação" de graça: ao selecionar a variação, o gráfico
  usa o preço praticado **daquela** variação.

## Como funciona (reaproveita a Phase 81)

O cálculo de faixas/giro/cobertura de `src/lib/precoFaixas.ts` é **idêntico** — muda apenas a
**fonte de dados** que a UI injeta:

| | Sem variação (pai) | Com variação selecionada |
|---|---|---|
| Série de vendas (RPC) | `orders_price_timeseries(_item_id)` | `orders_price_timeseries(_item_id, _sku)` |
| Estoque atual | `available_quantity` do anúncio | `available_quantity` da variação |

Prova (dados reais, variação …420603, estoque 19): faixa R$40–60 → giro 95,6/dia → cobertura
**0 d** (vs 6 d no pai); faixa R$60–80 → giro 10,6/dia → cobertura 1 d. A variação tem
dispersão de preço porque o preço do anúncio mudou no tempo → histograma continua rico.

## Backend

- **RPC `orders_price_timeseries`**: novo parâmetro **opcional** `_sku text DEFAULT NULL`.
  Quando não-nulo, adiciona `AND o.sku = _sku` ao WHERE. Nada mais muda (mesmo GROUP BY por
  dia, SECURITY INVOKER, sem subquery correlacionada). Anúncio sem variação → `_sku` nulo →
  comportamento atual. Migration nova (DROP+CREATE por causa da assinatura; padrão Phase 79).
- **Deploy** via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` (nunca SQL Editor).
  Smoke: rodar como role authenticated, reconciliar 1 variação contra soma manual + anti-IDOR.

## LIÇÃO CRÍTICA — vínculo por SKU, não por variation_id

O `orders.variation_id` **NÃO casa** com o `id` das variações do estoque
(`ml_inventory_cache.variations[].id`) — testado: 0 de 43 casaram. O vínculo correto é por
**SKU**: `orders.sku` = `variations[].seller_custom_field` (casou 43/43). Portanto:
- O filtro da RPC e o join estoque↔vendas usam **SKU** (`o.sku` / `seller_custom_field`).
- O seletor lista variações por SKU; o estoque de cada uma vem do jsonb via `seller_custom_field`.

## Frontend

- **Dropdown de variação** ao lado do seletor de anúncio. Populado a partir do
  `MLInventoryContext` (variações do `item_id` selecionado): label = atributo/tamanho legível +
  estoque (ex.: "Tam 42 · SA…420603 · 19 und"); valor = SKU (`seller_custom_field`). Primeira
  opção fixa: **"Todas as variações (anúncio)"**.
- Ao selecionar variação: passar `_sku` à RPC e injetar `estoqueAtual` = estoque da variação em
  `computePrecoFaixas`. Indicador visual de que a análise é da variação X (badge/subtítulo).
- **Aviso no nível pai** (sem variação, e apenas quando o anúncio tem variações): linha discreta
  tipo "Anúncio com N variações (M esgotadas) — selecione uma variação para cobertura precisa."
  Evita que o número agregado do pai engane.
- Reset do seletor de variação ao trocar de anúncio.
- Anúncio **sem** variações (`has_variations = false`): seletor oculto/desabilitado; só pai.

## Componentes e responsabilidades

- `supabase/migrations/{ts}_orders_price_timeseries_sku.sql` — RPC com `_sku` opcional.
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — dropdown de variação, estado
  do SKU selecionado, fonte de estoque condicional, chamada da RPC com `_sku`, badge + aviso do pai.
- `src/lib/precoFaixas.ts` — **sem mudança de lógica** (recebe pontos e estoque como hoje). Se
  algum helper de contagem de variações esgotadas for útil ao aviso, adicionar como util puro testado.
- `MLInventoryContext` — já expõe `ProductVariation` (`available_quantity`, `seller_custom_field`);
  confirmar acesso ao atributo legível para o label (ex.: `attribute_combinations`/`variations` jsonb).

## Testes

- Util puro: se houver helper novo (ex.: resumo de variações esgotadas para o aviso), testar em
  Vitest seguindo o padrão da suíte (~366 testes). O cálculo de giro/cobertura já é coberto (Phase 81).
- RPC: smoke de reconciliação por variação (1 SKU, soma manual ao centavo) + anti-IDOR.
- `tsc --noEmit` limpo; suíte verde; build de produção OK.

## Critérios de sucesso

1. Sem variação selecionada, a página é idêntica à Phase 81 (análise do pai).
2. Selecionando a variação campeã do MLB4113792113, a faixa de preço baixo mostra cobertura ~0 d
   (não 6 d), batendo com verificação manual (unidades ÷ dias = giro; estoque da variação ÷ giro).
3. O seletor lista as variações por SKU com estoque; troca de anúncio reseta o seletor.
4. Nível pai exibe o aviso de variações esgotadas quando o anúncio tem variações.
5. RPC filtra por `_sku` corretamente (join por SKU), sem nova IDOR; suíte verde; build limpo.

## Fora de escopo (YAGNI)

- Métrica agregada "giro sustentável + % rompido" por faixa (descartada em favor do seletor — o
  seletor por variação é mais simples e mais preciso).
- Comparação lado-a-lado de múltiplas variações.
- Alerta/reposição automática por variação (isso vive em /compras e /reposicao).
- Migração `orders.data_pedido` TEXT→timestamptz (outra frente).
