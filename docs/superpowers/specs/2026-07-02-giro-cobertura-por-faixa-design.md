# Giro e Cobertura por Faixa de Preço — Análise de Preços

**Data:** 2026-07-02
**Página:** `/analise-precos` (garment-glow-test)
**Autor:** Wesley + Nexo
**Status:** Design aprovado — pronto para planejamento GSD

## Contexto

A página `/analise-precos` (Phases 77 → 79 → 80) responde hoje "em que preço eu vendo bem?"
via um histograma de **faixas de preço** com toggle Unidades ↔ Lucro R$. Cada barra é uma
faixa (`FaixaPreco`) com unidades, MCO R$, margem % e preço médio, agregados a partir dos
pontos diários reconciliados de `computePrecoMcoSeries` (`McoSeriesPoint`), por `item_id`
(anúncio), sobre um período escolhido pelo usuário (default 30 dias, até 365).

Falta a dimensão de **velocidade × estoque**: saber a que ritmo se vende em cada preço e
quanto tempo o estoque atual dura naquele ritmo. Essa é uma decisão de pricing direta —
baixar o preço vende mais rápido mas esvazia o estoque; manter mais caro dá mais fôlego.

## Objetivo

Para o anúncio selecionado, exibir em **cada faixa de preço** o giro (unidades/dia) e a
cobertura em dias do estoque atual, mantendo a página simples e mobile-friendly.

## O cálculo

Para cada faixa de preço já computada:

- **Giro da faixa** = `unidades vendidas na faixa ÷ nº de dias com venda naquela faixa`
  - As unidades já são somadas hoje. O denominador é novo: contar quantos **pontos diários**
    (`McoSeriesPoint`, um por dia) tiveram o preço médio caindo dentro da faixa.

  **Definição precisa do denominador — dias COM venda, não dias corridos.** A RPC
  `orders_price_timeseries` deriva de `orders`, logo só existe um ponto diário nos dias em que
  houve pelo menos um pedido. Dias em que o anúncio esteve naquele preço mas não vendeu **não
  aparecem** (a tabela `orders` não os registra, e não há fonte que ligue preço-do-dia a um dia
  sem venda). Portanto o giro é a velocidade **nos dias em que se vende naquele preço**, não a
  média sobre dias corridos. Consequências assumidas: (a) o giro tende a ser um pouco mais alto
  e a cobertura um pouco mais curta que a média real — um viés **conservador** (alerta de
  ruptura mais cedo), aceitável; (b) o tooltip explicita "giro nos dias com venda" para não
  induzir a leitura de média diária corrida.
- **Cobertura da faixa** = `estoque atual do anúncio ÷ giro da faixa`
  - Resultado em dias. Arredondamento para baixo (dias inteiros de fôlego), com "<1d" quando < 1.

### Semântica importante — estoque compartilhado

O estoque atual é **um único número** (saldo de hoje do anúncio no ML). A cobertura de cada
faixa é sempre um **cenário hipotético**: *"a esse preço, o estoque que tenho hoje duraria X
dias"*. Todas as faixas usam o mesmo estoque; o que varia é o giro. Isso é intencional e é o
que expõe o trade-off de elasticidade (ex.: R$55 → 2 dias, R$70 → 15 dias).

### Horizonte temporal

O giro é medido sobre o **período selecionado** (histórico); o estoque é um **snapshot
atual** (sync diário 04:00 BRT). Os dois lados têm horizontes diferentes — isso é aceitável
para a leitura "se eu praticar esse preço, quanto dura", mas deve ficar **explícito** num
rodapé de transparência.

## Fonte de dados — zero RPC nova

- **Giro:** derivado inteiramente dos pontos diários que a página **já busca**
  (`orders_price_timeseries` com `_granularity: "day"`). Nenhuma query nova; a contagem de
  dias por faixa e o giro são calculados no util puro `precoFaixas.ts` a partir dos
  `McoSeriesPoint` já em memória.
- **Estoque atual:** `ml_inventory_cache.available_quantity`, chaveado por
  `(organization_id, ml_user_id, item_id)`, exposto como `ProductItem.available_quantity` via
  `MLInventoryContext` (DB-first, sem chamada live). Mesmo `item_id` das faixas → **sem
  mapeamento SKU**. Anúncios com variações usam o `available_quantity` de topo (consolidado do
  anúncio), coerente com a agregação por `item_id` da RPC.

## Robustez — faixas de amostra fraca

Faixa com **menos de 3 dias distintos** de amostra tem giro pouco confiável (ex.: preço
testado 1 dia). Tratamento:

- Mostra o giro/cobertura mesmo assim, porém **sinalizado**: rótulo com sufixo `?`, tom
  esmaecido, e aviso no tooltip (ex.: "só 2 dias de dados — estimativa fraca").
- Não esconde a informação, mas deixa claro que é frágil.

Constante configurável: `MIN_DIAS_CONFIANCA = 3`.

## Sinal de risco de ruptura

- Cobertura pintada de **vermelho** (no texto do rótulo/tooltip) quando `cobertura < 7 dias`
  (risco de esvaziar antes de conseguir repor); **neutra** acima disso.
- A **cor da barra** continua representando a saúde de margem (`classificarSaude`) — a
  cobertura só colore o **texto do rótulo**, sem conflito de sinais.

Constante configurável: `COBERTURA_RISCO_DIAS = 7`.

## O que muda na tela

`PrecoPraticadoReport.tsx` (visão de faixas):

1. **Rótulo de cobertura em cada barra** — texto curto (ex.: `~2d`, `~15d`, `~2d?` para baixa
   confiança), colorido por risco. A altura da barra segue o toggle atual (unidades/lucro).
2. **Tooltip por faixa** ganha 3 linhas: `giro X/dia · cobertura Y dias · estoque atual Z und`
   (+ aviso de baixa confiança quando aplicável).
3. **Cartão-veredito** (determinístico, sem LLM) ganha uma frase sobre o preço vigente:
   *"No preço atual R$X, seu estoque de N und dura ~Y dias."*
4. **Rodapé de transparência**: "Giro medido no período selecionado; estoque = saldo atual do
   anúncio (sincronizado diariamente)."

Sem mudança na aba secundária "Evolução no tempo".

## Componentes e responsabilidades

- **`src/lib/precoFaixas.ts`** (util puro, estende o existente):
  - Nova função de contagem de dias por faixa a partir dos `McoSeriesPoint`.
  - `computeGiroFaixa(unidades, diasNaFaixa)` e `computeCoberturaFaixa(estoqueAtual, giro)`.
  - Estende `FaixaPreco` com: `diasNaFaixa: number`, `giroDia: number | null`,
    `coberturaDias: number | null`, `baixaConfianca: boolean`.
  - Novas constantes: `MIN_DIAS_CONFIANCA = 3`, `COBERTURA_RISCO_DIAS = 7`.
  - Recebe `estoqueAtual` via `ComputeFaixasOpts` (injetado, mantém o util sem I/O).
- **`PrecoPraticadoReport.tsx`**: lê `available_quantity` do `item_id` selecionado via
  `MLInventoryContext`, injeta em `computePrecoFaixas`, renderiza rótulo + tooltip + frase de
  veredito + rodapé.
- **Sem novas migrations, sem novas edge functions, sem alteração de RPC.**

## Testes

- Util puro `precoFaixas.ts` com Vitest (segue o padrão da suíte atual, ~345 testes):
  - contagem de dias por faixa (incl. faixa com dias não contíguos);
  - giro e cobertura (incl. giro 0 → cobertura null; estoque 0 → cobertura 0);
  - flag de baixa confiança no limiar (2 dias = frágil, 3 dias = ok);
  - arredondamento "<1d".
- Build (`tsc`) limpo; suíte verde.

## Fora de escopo (YAGNI)

- Quebra por variação/SKU (a RPC agrega por anúncio; estoque de topo já é o consolidado).
- Modo "Cobertura (dias)" no toggle ou tabela separada abaixo do gráfico.
- Modelagem de lead time de reposição (só sinalizamos risco por limiar fixo).
- Previsão de demanda / sazonalidade sobre o giro (usa média simples da faixa).

## Critérios de sucesso

1. Cada faixa mostra giro e cobertura corretos, batendo com verificação manual (unidades ÷
   dias × estoque) para um anúncio de exemplo.
2. Faixas com < 3 dias aparecem sinalizadas como baixa confiança.
3. Cobertura < 7 dias aparece em vermelho no rótulo.
4. Cor da barra (saúde de margem) permanece inalterada.
5. Nenhuma RPC/migration nova; suíte de testes verde; build limpo.
