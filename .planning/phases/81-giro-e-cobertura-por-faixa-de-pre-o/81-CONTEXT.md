# Phase 81: Giro e Cobertura por Faixa de Preço - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Source:** Brainstorming (superpowers) → spec aprovado por Wesley

<domain>
## Phase Boundary

Estende a visão de **faixas de preço** da página `/analise-precos` (Phase 80,
`PrecoPraticadoReport.tsx`) para que cada faixa mostre **giro** (unidades/dia) e **cobertura em
dias** do estoque atual do anúncio. Responde: *"nesse preço, em quanto tempo esvazio meu
estoque?"* — decisão de pricing por elasticidade (vende rápido barato × devagar caro).

**Não entra nesta phase:** quebra por variação/SKU, modo "Cobertura" no toggle, tabela
separada, modelagem de lead time de reposição, previsão/sazonalidade. Zero RPC/migration/edge
function nova.
</domain>

<decisions>
## Implementation Decisions (LOCKED — aprovadas por Wesley)

### Cálculo do giro
- **Giro da faixa** = `unidades vendidas na faixa ÷ nº de dias-com-venda naquela faixa`.
  Denominador = quantos **pontos diários** (`McoSeriesPoint`, um por dia) tiveram o preço médio
  do dia caindo dentro da faixa. Escolha "giro real por faixa" (não giro médio único do anúncio).
- **Dias-com-venda, não dias corridos.** A RPC `orders_price_timeseries` deriva de `orders` →
  só há ponto diário nos dias com pedido. Dias parados no mesmo preço não existem na série. O
  giro é a velocidade **nos dias em que se vende naquele preço**; viés conservador (cobertura
  mais curta → alerta de ruptura mais cedo), aceitável. Comunicar no tooltip/rodapé.

### Cobertura
- **Cobertura da faixa** = `estoque atual do anúncio ÷ giro da faixa`, em dias. Arredondar para
  baixo; "<1d" quando < 1. `giro = 0 → cobertura = null`; `estoque = 0 → cobertura = 0`.
- **Estoque é um número só** (saldo de hoje do anúncio), compartilhado por todas as faixas. A
  cobertura por faixa é cenário hipotético: "a esse preço, o estoque de hoje duraria X dias".

### Robustez — baixa confiança
- Faixa com **< 3 dias** de amostra (`MIN_DIAS_CONFIANCA = 3`): mostra giro/cobertura mas
  sinaliza — rótulo com sufixo `?`, tom esmaecido, aviso no tooltip ("só N dias de dados —
  estimativa fraca"). Não esconde.

### Sinal de risco
- Cobertura em **vermelho** (texto do rótulo/tooltip) quando `< 7 dias`
  (`COBERTURA_RISCO_DIAS = 7`); neutra acima. A **cor da barra** continua sendo saúde de margem
  (`classificarSaude`) — cobertura colore só o texto do rótulo, sem conflito de sinal.

### Apresentação (escolha: "rótulo na barra + tooltip")
- Rótulo curto de cobertura em cada barra (ex.: `~2d`, `~15d`, `~2d?`).
- Tooltip da faixa: `giro X/dia · cobertura Y dias · estoque atual Z und` (+ aviso baixa confiança).
- Cartão-veredito (determinístico, sem LLM) ganha frase do preço vigente: "No preço atual R$X,
  seu estoque de N und dura ~Y dias."
- Rodapé de transparência: "Giro medido nos dias-com-venda do período; estoque = saldo atual do anúncio (sync diário)."

### Claude's Discretion
- Formatação exata dos rótulos/tooltip, nomes internos de helpers, estrutura de testes,
  tom/opacidade exata do "esmaecido", posição do rótulo na barra (LabelList).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec da phase (fonte de verdade das decisões)
- `docs/superpowers/specs/2026-07-02-giro-cobertura-por-faixa-design.md` — design completo aprovado.

### Faixas de preço (onde estender)
- `src/lib/precoFaixas.ts` — util puro; interface `FaixaPreco` (tem `unidades`, `mcoRsTotal`,
  `receita`, `precoMedio`, `mcoPctMedio`, `isOutlierBucket`, `isPrecoAtual`, `altura`);
  `computePrecoFaixas`, `computeVeredicto`, `classificarSaude`, `niceStep`, `ComputeFaixasOpts`,
  `FaixaMode`, `FaixasResult`, `SaudePreco`, `Veredicto`, const `MCO_SAUDAVEL_PCT`. **Estender
  aqui:** contagem de dias por faixa + giro + cobertura + flags; novas constantes.
- `src/lib/precoMcoSeries.ts` — define `McoSeriesPoint` (tem `bucket` data, `qtd`, preço). É a
  entrada consumida por `computePrecoFaixas`.
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — componente que faz fetch e
  renderiza o histograma (BarChart + LabelList + tooltip + veredito + KPIs). **UI muda aqui.**
- `src/pages/mercadolivre/MLAnalisePrecos.tsx` — wrapper; opera por `selectedId = item_id`.

### Estoque atual (fonte do dado novo)
- `src/contexts/MLInventoryContext.tsx` — DB-first; expõe `ProductItem.available_quantity` por
  `item_id` (`id: row.item_id`). Ler daqui o estoque do anúncio selecionado.
- `supabase/migrations/20260519150000_ml_inventory_cache.sql` — tabela `ml_inventory_cache`
  (PK `organization_id, ml_user_id, item_id`; `available_quantity int`). Sync diário 04:00 BRT.

### Padrão de referência (giro/cobertura já existente por anúncio)
- `src/hooks/useMLCoverage.ts` — já faz `coverage_days = floor(available_quantity / avg_daily_sales)`
  por `item_id`; classes ruptura/critico/alerta/ok. Reusar a semântica (não o código — lá o giro
  é média simples da janela; aqui é por faixa).

### RPC (não muda)
- `supabase/migrations/20260679000000_orders_price_timeseries_mco.sql` — `orders_price_timeseries`
  filtra `WHERE o.item_id = _item_id`, `status IN ('paid','shipped','delivered')`. Nenhuma mudança.
</canonical_refs>

<specifics>
## Specific Ideas

- Exemplo do Wesley: "Preço X vende 15/dia, estoque 30 und → dura 2 dias."
- A suíte de testes atual tem ~345 testes (Vitest) e serve de padrão para os novos testes puros.
- Paleta/estilo: cor da barra intocada; cobertura usa cor de texto (vermelho de risco reaproveitar
  token existente de erro/danger da UI, ex. o mesmo usado em margem negativa).
</specifics>

<deferred>
## Deferred Ideas

- Quebra de giro/cobertura por variação/SKU.
- Modo "Cobertura (dias)" no toggle e tabela comparativa por faixa.
- Modelagem de lead time / ponto de reposição por faixa.
- Migrar `orders.data_pedido` TEXT→timestamptz (item de outra frente).
</deferred>

---

*Phase: 81-giro-e-cobertura-por-faixa-de-pre-o*
*Context gathered: 2026-07-02 via brainstorming + spec aprovado*
