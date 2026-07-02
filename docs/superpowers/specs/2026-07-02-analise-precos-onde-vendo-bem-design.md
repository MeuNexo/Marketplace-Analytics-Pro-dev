# Análise de Preços — "Em que preço eu vendo bem?" (redesign)

**Data:** 2026-07-02
**Página:** `/analise-precos` (componente `PrecoPraticadoReport.tsx`)
**Origem:** feedback do Wesley de que o gráfico de série temporal (Phase 79) continua confuso e
não deixa "qualquer um entender e fazer a análise de preço sozinho".

## Problema

A tela atual responde a pergunta errada. Ela plota **data no eixo X** com 3 linhas
(preço, break-even, MCO%) + área de margem + 2 eixos Y. É uma ferramenta de analista.

A pergunta que o usuário realmente faz ao abrir a tela de um anúncio é:
**"em que preço eu vendo bem?"** — ou seja, a relação **preço × volume × margem**, e
principalmente **em que preço eu ganho mais dinheiro**.

Dado empírico que valida a abordagem (top 6 anúncios, últimos 90 dias): há variação
de preço de sobra para responder isso empiricamente — de 7 a 11 preços distintos por
anúncio (ex.: MLB4113792113 vendeu de R$47,49 a R$149,99 com 11 preços distintos).

## Objetivo

Reorganizar a tela de um anúncio para que o **preço** seja o protagonista, mostrando de
bandeja onde há saída (volume) e onde há lucro (margem), com uma leitura de 3 segundos
em português. Reusar a fonte de dados já em produção e reconciliada ao centavo — só muda
a **forma de mostrar**.

## Escopo

- **Uma tela por anúncio** (item selecionado), como já é hoje.
- **Aposenta** o gráfico de linha temporal como visão principal; ele vira aba secundária recolhida.
- **Não** mexe na RPC nem na fonte de dados. Reusa `orders_price_timeseries` e `precoMcoSeries.ts`.

## Design

### 1. Faixa-veredito (leitura de 3 segundos)

Duas frases em português geradas por **regra determinística** (sem LLM — nunca inventa número):

- Saúde do preço atual:
  *"No preço de hoje (R$59,90) sua margem é 17% — saudável."*
  (classificação por threshold: saudável / apertada / prejuízo)
- Ponto ótimo (acompanha o modo do toggle, ver §2):
  - modo Unidades: *"Você vende mais entre R$58 e R$62: 12.400 unidades, 19% de margem."*
  - modo Lucro: *"Seu maior lucro veio vendendo a ~R$62: R$94 mil no período, contra R$52 mil a R$55."*

Quando não há dado suficiente (item sem custo, ou uma só faixa de preço), a frase degrada
com transparência ("ainda não há variação de preço suficiente para comparar faixas").

### 2. Gráfico de barras "onde eu vendo bem" (protagonista)

- **Eixo X:** faixas de preço (buckets), não data.
- **Altura da barra:** depende do toggle.
- **Toggle Unidades ↔ Lucro R$** (o coração da tela), botão no canto superior do gráfico:
  - **Unidades** (padrão): altura = unidades vendidas na faixa. Responde "onde tem saída".
  - **Lucro R$**: altura = lucro total da faixa (Σ unidades × MCO R$/un). Responde "onde ganho
    mais dinheiro". A barra mais alta aqui é o preço ótimo real.
- **Cor da barra:** margem % média da faixa — verde (boa) / âmbar (apertada) / vermelho
  (prejuízo), reusando os tokens CVD-safe já validados (`--success` / `--warning` / `--destructive`
  ou os `--chart-*` conforme melhor contraste). **Rótulo de margem % em cima de cada barra**
  para não depender só da cor (acessibilidade).
- **Marcador "seu preço hoje":** referência vertical na faixa do preço atual.
- **Tooltip por faixa:** preço médio da faixa, unidades, margem %, margem R$/un, lucro total, receita.
- **Faixa vazia** (sem venda) no meio do range aparece vazia — sinaliza preço não testado.

### 3. Bucketização das faixas de preço

- Largura de faixa "redonda" escolhida pela escala do preço do produto (R$2, R$5 ou R$10),
  centrada em **onde estão ~90% das vendas** (evita que outlier estique o gráfico).
- Tudo acima do corte vira **uma barra agregada "+R$X"** em vez de N faixas vazias.
- Regra de escolha de largura: baseada no range interquartil / preço mediano do item
  (determinística, testável).

### 4. KPIs (enxutos, alinhados à pergunta)

Trocar os 6 atuais por **4**:
- **Preço hoje** · **Margem hoje %** (cor pelo sinal) · **Faixa campeã** (maior lucro) ·
  **Unidades no período**
- Cada um mantém o comparativo vs. período anterior (mesma duração) que já existe
  (`computePriceKpis` / `percentDelta` / `pointDelta`).

### 5. Evolução no tempo (aba secundária recolhida)

O gráfico de linha atual (preço + break-even + colchão + MCO%) **não é removido** —
passa a viver atrás de um clique (aba/accordion "Evolução no tempo"), para quem quiser
investigar "minha margem caiu porque o custo subiu em maio".

## Arquitetura / unidades de código

- **Util novo `precoFaixasSeries.ts`** (TDD): recebe as mesmas `PrecoSeriesRow[]` já usadas,
  reagrupa por faixa de preço em vez de por tempo, e devolve `FaixaPreco[]`
  (`{ min, max, label, unidades, mcoRsTotal, mcoPctMedio, receita, precoMedio, isOutlierBucket }`).
  Inclui: escolha de largura de bucket, corte de outlier, cálculo do ponto ótimo por modo
  (unidades vs lucro), e geração das strings do veredito.
- **Componente `PrecoPraticadoReport.tsx` refeito**: veredito + BarChart (recharts, já no stack)
  com toggle, KPIs enxutos, e a aba secundária com o gráfico temporal atual preservado.
- Reuso sem alteração: RPC `orders_price_timeseries`, `computePrecoMcoSeries`, `computePriceKpis`.
- Testes: suíte do util novo + manter a suíte existente verde.

## Confiabilidade

- Números vêm da mesma RPC reconciliada ao centavo (Phase 79). O util novo só **reagrupa**;
  não recalcula custo/imposto/comissão.
- Veredito é template determinístico sobre os números do util — sem LLM.
- Paleta validada no script CVD/contraste da skill dataviz (light e dark) antes de fechar.

## Fora de escopo

- Simulação/what-if de preço (existe o Simulador em outra tela).
- Recomendação de preço via IA.
- Mudança na fonte de dados / RPC.

## Verificação (o que "pronto" significa)

- Tela de um anúncio abre com veredito + histograma de faixas; toggle Unidades↔Lucro
  troca altura das barras e o texto do veredito.
- Cor + rótulo de margem em cada barra; marcador do preço atual visível.
- Outliers agregados numa barra "+R$X"; nenhuma cascata de faixas vazias.
- 4 KPIs com comparativo.
- Aba "Evolução no tempo" preserva o gráfico temporal atual.
- Suíte de testes verde; build ok; paleta CVD PASS light+dark.
- Entrega direto em produção (main) para validação visual do Wesley.
