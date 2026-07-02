# Análise de Preços — Linha de MCO + gráfico preço vs. break-even

**Data:** 2026-07-02
**Status:** Aprovado por Wesley (design verbal); aguarda plano de implementação
**Página:** `/analise-precos` (Phase 77) — componente `PrecoPraticadoReport`

## Problema

A página Análise de Preços mostra a evolução do preço praticado por anúncio, mas não
responde à pergunta real do Wesley: **"o preço praticado deu MCO?"**. O gráfico atual
(barras de volume + linha de preço médio) é confuso para esse propósito — volume e preço
em eixos distintos não dizem se o preço cobriu os custos.

## Decisões do Wesley (2026-07-02)

1. **Composição do MCO: completa (com imposto)** — `venda − custo − comissão − frete −
   publicidade − imposto`, idêntica ao `src/lib/mco.ts` (`computeMco`), para bater com o
   resto do dashboard.
2. **Gráfico: preço praticado × break-even com colchão** — duas linhas em R$/un; a área
   entre elas é o MCO (verde quando preço ≥ break-even, vermelha quando afunda); linha de
   MCO% no eixo direito. As barras de volume saem (eram a fonte de confusão).

## Fontes de dado — firme vs. modelado

| Componente | Fonte | Qualidade |
|---|---|---|
| Receita, preço, qtd | `orders` (receita_bruta, preco_unit, quantidade) | Firme — já na RPC |
| CMV | `orders.custo_unit × quantidade` | Firme — agregar por bucket |
| Comissão | `orders.comissao` | Firme — agregar por bucket |
| Frete | `orders.frete` | Firme — agregar por bucket |
| Imposto | `ml_tax_config` + helpers `src/lib/tax/*` (alíquota efetiva × receita do bucket) | Determinístico |
| Publicidade | **Não existe ads por item por dia.** `ml_ads_products_cache` tem spend por item sem data; `ml_ads_daily_cache` tem data sem item. → **Rateio** (ver nota) | Melhor-esforço, carimbado |

**Nota do rateio de ads:** o spend total do item (de `ml_ads_products_cache`) é
distribuído pelos buckets proporcionalmente à receita:
`ads_bucket = spend_item × (receita_bucket / receita_total_do_período)`.
Como é melhor-esforço, a UI ganha um **toggle
"incluir ads"** — desligado, a parcela de ads zera e o MCO exibido usa só dado firme +
imposto. Rodapé do gráfico deixa o método explícito.

## Arquitetura

### 1. Backend — estender RPC `orders_price_timeseries`

Migration nova (`CREATE OR REPLACE`), mantendo **SECURITY INVOKER** (RLS de `orders`
isola a org — padrão anti-IDOR Phases 63/69; deploy via MCP `apply_migration`, nunca SQL
Editor). Acrescentar ao RETURNS TABLE, por bucket:

- `cmv numeric` — `SUM(custo_unit * quantidade)`
- `comissao numeric` — `SUM(comissao)`
- `frete numeric` — `SUM(frete)`
- `qtd_sem_custo bigint` — `SUM(quantidade) FILTER (WHERE custo_unit IS NULL)` (para o aviso de custo ausente)

Sem subquery correlacionada (lição [[feedback-rpc-rls-correlated-subquery-timeout]]);
é a mesma agregação de grupo já existente, só com mais colunas. Smoke como role
`authenticated` com dados reais, não só postgres.

`data_pedido` é TEXT com formatos mistos → manter o cast `::date` já existente.

### 2. Camada TS — util puro `src/lib/precoMcoSeries.ts`

Função pura testável (padrão `soldProductsAgg`/`replenishmentUtils`) que recebe as linhas
da RPC + `taxaEfetiva` + `adsRatio` + flag `incluirAds` e devolve, por bucket:

- `imposto = receita × taxaEfetiva`
- `ads = incluirAds ? spendItem × (receita / receitaTotalPeriodo) : 0`
- `mco`, `mcoPct` — via `computeMco` reusado (`platformCost = comissao + frete`)
- `precoUnit = receita / qtd`
- `breakevenUnit = (cmv + comissao + frete + ads + imposto) / qtd`
- `custoAusente = qtd_sem_custo > 0`

Alíquota efetiva: resolver a partir de `ml_tax_config` da(s) loja(s) selecionada(s) usando
`computeOrderTaxRate`/helpers de `src/lib/tax/`. Sem UF de destino por bucket, usar a
taxa efetiva média da loja (mesma simplificação de outras telas agregadas). Com múltiplas
lojas selecionadas, ponderar pela receita ou usar a config da loja principal — decidir no
plano com base no que `MLCostCard` já faz.

spendItem: buscar `ml_ads_products_cache` pelo `item_id` selecionado (coluna `spend`);
se ausente, ads = 0.

### 3. UI — `PrecoPraticadoReport`

**Gráfico (ComposedChart, recharts — ler skill dataviz antes de codar):**
- Eixo esquerdo (R$/un): linha `precoUnit` + linha `breakevenUnit`.
- Colchão: `Area` entre as duas linhas — verde (`--success`) quando preço ≥ break-even,
  vermelho (`--destructive`) quando preço < break-even (técnica de série dividida:
  `gainBand`/`lossBand` calculadas no util).
- Eixo direito (%): linha `mcoPct`.
- Tooltip: preço, break-even, MCO R$/un, MCO %, e a decomposição (custo, comissão,
  frete, ads, imposto) por unidade — transparência total.
- Mantém: seletor de anúncio, granularidade dia/semana/mês.
- Sai: toggle Qtd/Receita e as barras de volume.
- Entra: toggle "incluir ads" (Switch, default ON).
- Rodapé: "Ads rateado pela participação de receita · imposto pelo regime configurado ·
  linha tracejada = break-even".

**KPIs (6, mesmo grid):** Preço médio · Break-even médio · MCO (R$) · MCO % (verde/
vermelho pelo sinal) · Qtd vendida · Receita. Saem: faixa de preço, média diária (qtd),
receita média diária.

### 4. Estados e erros

- Sem vendas no período → estados vazios atuais inalterados.
- `custo_unit` NULL em pedidos do bucket → break-even calculado sem a parte ausente +
  badge/aviso "custo ausente em N un — break-even subestimado" (não inventar número;
  lição do diagnóstico custo_unit).
- Sem `ml_tax_config` para a loja → imposto = 0 + aviso "regime fiscal não configurado".
- Sem ads no cache → parcela ads = 0 silenciosamente (toggle continua visível).
- RPC error → comportamento atual (console.warn + estado vazio).

### 5. Testes

- Unit do `precoMcoSeries.ts`: composição do MCO, bandas verde/vermelha (cruzamento de
  linhas), custo ausente, toggle ads, divisão por zero (qtd 0).
- Smoke da RPC em prod como `authenticated` (dados Pé Vermeio) comparando 2–3 buckets
  contra soma manual em SQL.
- `npx tsc -p tsconfig.app.json` não é gate limpo (erros pré-existentes) — usar
  `npm run build` + vitest como gates.

## Fora de escopo

- Ads por item por dia real (exigiria novo sync da API de ads com breakdown diário por
  item) — se o rateio incomodar, vira phase futura.
- Deep-link `?item=` (já deferido na Phase 77).
- Mudanças em Produtos Vendidos.

## Processo

Phase GSD nova no milestone atual (plan-phase → execute-phase → verifier), branch
empilhada a partir de `main` (Phases 71–78 já mergeadas).
