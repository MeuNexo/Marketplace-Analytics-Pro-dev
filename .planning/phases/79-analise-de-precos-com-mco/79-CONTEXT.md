# Phase 79: Análise de Preços com MCO — Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Source:** PRD Express Path (docs/superpowers/specs/2026-07-02-analise-precos-mco-design.md — spec aprovada pelo Wesley via brainstorming 2026-07-02)

<domain>
## Phase Boundary

A página `/analise-precos` (entregue na Phase 77) passa a responder "o preço praticado
deu MCO?". Escopo: estender a RPC `orders_price_timeseries`, criar util puro de série
MCO, refazer o gráfico do `PrecoPraticadoReport` (preço × break-even com colchão
verde/vermelho + MCO% no eixo direito) e trocar KPIs. NÃO mexe em Produtos Vendidos,
não cria sync novo de ads, não implementa deep-link `?item=`.

</domain>

<decisions>
## Implementation Decisions

### Composição do MCO (decisão Wesley)
- MCO COMPLETO: `venda − custo − comissão − frete − publicidade − imposto` — idêntico a
  `computeMco` de `src/lib/mco.ts` (`platformCost = comissao + frete`), para bater com o
  resto do dashboard. REUSAR `computeMco`, não duplicar fórmula.

### Gráfico (decisão Wesley — escolheu entre 3 mockups)
- Linha preço praticado (R$/un) + linha break-even (R$/un), eixo esquerdo.
- Colchão (Area) entre as linhas: verde (`--success`) quando preço ≥ break-even,
  vermelho (`--destructive`) quando preço < break-even. Técnica de séries divididas
  (gainBand/lossBand calculadas no util, não no componente).
- Linha MCO% no eixo direito.
- SAEM: barras de volume e toggle Qtd/Receita. FICAM: seletor de anúncio,
  granularidade dia/semana/mês. ENTRA: toggle "incluir ads" (Switch, default ON).
- Tooltip: preço, break-even, MCO R$/un, MCO %, decomposição por unidade
  (custo, comissão, frete, ads, imposto) — transparência total.
- Rodapé: "Ads rateado pela participação de receita · imposto pelo regime configurado ·
  linha tracejada = break-even".

### Backend — RPC estendida
- `CREATE OR REPLACE` de `orders_price_timeseries` acrescentando por bucket:
  `cmv` (=SUM(custo_unit*quantidade)), `comissao` (SUM), `frete` (SUM),
  `qtd_sem_custo` (SUM(quantidade) FILTER (WHERE custo_unit IS NULL)).
- MANTER SECURITY INVOKER — RLS de `orders` isola org (anti-IDOR Phases 63/69).
  Sem parâmetro de org. Sem subquery correlacionada (lição RPC RLS timeout 8s).
- `data_pedido` é TEXT com formatos mistos → manter cast `::date`.
- Deploy via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` (nunca SQL Editor).
- Smoke como role `authenticated` com dados reais (não só postgres), comparando 2–3
  buckets contra soma manual em SQL.

### Camada TS — util puro `src/lib/precoMcoSeries.ts`
- Entrada: linhas da RPC + taxaEfetiva + spendItem + flag incluirAds. Saída por bucket:
  imposto (= receita × taxaEfetiva), ads (= spendItem × receita/receitaTotalPeriodo se
  incluirAds, senão 0), mco/mcoPct via computeMco, precoUnit, breakevenUnit
  (= (cmv+comissao+frete+ads+imposto)/qtd), custoAusente, gainBand/lossBand.
- Alíquota efetiva: `ml_tax_config` + `computeOrderTaxRate`/helpers de `src/lib/tax/`.
  Sem UF destino por bucket → taxa efetiva média da loja (mesma simplificação de telas
  agregadas). Múltiplas lojas: seguir o que `MLCostCard` já faz (ponderar por receita
  ou config da loja principal — planner decide olhando o código).
- spendItem: `ml_ads_products_cache` pelo item_id (coluna `spend`); ausente → ads=0.

### KPIs (6, mesmo grid)
- Preço médio · Break-even médio · MCO (R$) · MCO % (verde/vermelho pelo sinal) ·
  Qtd vendida · Receita. SAEM: faixa de preço, média diária (qtd), receita média diária.

### Estados e erros
- Sem vendas → estados vazios atuais inalterados.
- custo_unit NULL no bucket → break-even sem a parte ausente + aviso "custo ausente em
  N un — break-even subestimado" (NUNCA inventar número).
- Sem ml_tax_config → imposto=0 + aviso "regime fiscal não configurado".
- Sem ads no cache → parcela 0 silenciosamente (toggle continua visível).
- Erro RPC → comportamento atual (console.warn + vazio).

### Claude's Discretion
- Detalhes visuais do colchão (gradiente/opacidade), formatação do tooltip, layout
  exato do toggle — seguir design tokens do projeto e skill dataviz.
- Nome/formato exato dos campos do util e testes.
- Como resolver multi-loja na alíquota (espelhar MLCostCard).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec desta phase
- `docs/superpowers/specs/2026-07-02-analise-precos-mco-design.md` — decisão completa aprovada

### Código a estender/reusar
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — componente a refazer
- `src/pages/mercadolivre/MLAnalisePrecos.tsx` — página wrapper (Phase 77)
- `src/lib/mco.ts` — computeMco (REUSAR)
- `src/lib/tax/index.ts` + `src/lib/tax/perOrder.ts` — helpers de imposto (REUSAR)
- `src/components/mercadolivre/MLCostCard.tsx` — referência de como resolver tax config agregada
- `supabase/migrations/20260677000000_orders_price_timeseries.sql` — RPC atual a estender
- `src/components/dashboard/KPICard.tsx` — KPIs

### Lições/padrões obrigatórios
- SECURITY INVOKER sem org param (anti-IDOR) — Phases 63/69
- Sem subquery correlacionada em RPC INVOKER; testar como role authenticated (timeout 8s)
- `data_pedido` TEXT formatos mistos → cast `::date`
- PostgREST trunca 1000 → `.range()` quando query direta

</canonical_refs>

<specifics>
## Specific Ideas

- Mockup escolhido pelo Wesley: duas linhas com colchão sombreado entre elas, MCO% como
  anotação/linha no eixo direito — "o espaço entre as linhas É o MCO".
- Transparência: nada escondido; método do rateio de ads e origem do imposto sempre
  visíveis no rodapé/tooltip (padrão da Phase 70 "Consultor Confiável").

</specifics>

<deferred>
## Deferred Ideas

- Ads por item por dia real (novo sync da API de ads com breakdown diário por item) —
  phase futura se o rateio incomodar.
- Deep-link `?item=` (deferido desde a Phase 77).

</deferred>

---

*Phase: 79-analise-de-precos-com-mco*
*Context gathered: 2026-07-02 via PRD Express Path (spec aprovada)*
