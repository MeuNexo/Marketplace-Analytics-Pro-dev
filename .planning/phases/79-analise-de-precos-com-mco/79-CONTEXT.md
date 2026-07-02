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
- Estender `orders_price_timeseries` acrescentando por bucket:
  `cmv` (=SUM(custo_unit*quantidade)), `comissao` (SUM), `frete` (SUM),
  `imposto` (=SUM(tax_amount) — achado do research), e
  `qtd_sem_custo` (SUM(quantidade) FILTER (WHERE custo_unit IS NULL)).
- **PITFALL (research):** mudar RETURNS TABLE exige `DROP FUNCTION IF EXISTS
  public.orders_price_timeseries(text, text[], date, date, text);` antes do CREATE —
  `CREATE OR REPLACE` falha ao mudar OUT params.
- MANTER SECURITY INVOKER — RLS de `orders` isola org (anti-IDOR Phases 63/69).
  Sem parâmetro de org. Sem subquery correlacionada (lição RPC RLS timeout 8s).
- `data_pedido` é TEXT com formatos mistos → manter cast `::date`.
- Deploy via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` (nunca SQL Editor).
- Smoke como role `authenticated` com dados reais (não só postgres), comparando 2–3
  buckets contra soma manual em SQL.

### Camada TS — util puro `src/lib/precoMcoSeries.ts`
**[ATUALIZADO pós-research 2026-07-02 — dois achados mudam a fonte de imposto e ads:]**
- **Imposto = dado FIRME via RPC**: `orders.tax_amount` já existe por pedido (calculado
  com UF de destino real por `recalc-order-costs`). A RPC soma `SUM(tax_amount)` por
  bucket — mesmo padrão de `get_cost_waterfall`/`MLCostCard`. NÃO usar taxa efetiva
  média client-side. Aviso "regime fiscal não configurado" quando tax_amount vier
  NULL/0 em bucket com receita (verificar semântica real ao planejar).
- **Ads = série diária REAL**: `ml_ads_products_cache` TEM coluna `date` (migration
  20260522_ads_products_daily). Buscar spend diário do item_id no período e agregar
  pelos MESMOS buckets da granularidade — sem rateio por receita. Cobertura do cache
  não garantida (sync sob demanda, cap 90d) → ausente = 0 e o toggle "incluir ads"
  cobre a incerteza. Rodapé do gráfico ajustado: ads vem do relatório diário de
  publicidade, não de rateio.
- Entrada do util: linhas da RPC + linhas de ads diárias + flag incluirAds. Saída por
  bucket: imposto (da RPC), ads (do cache bucketizado, 0 se toggle off), mco/mcoPct via
  computeMco, precoUnit, breakevenUnit (= (cmv+comissao+frete+ads+imposto)/qtd),
  custoAusente, gainBand/lossBand.

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
