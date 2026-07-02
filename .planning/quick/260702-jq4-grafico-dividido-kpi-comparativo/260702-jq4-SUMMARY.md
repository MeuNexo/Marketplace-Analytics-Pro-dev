---
phase: quick-260702-jq4
plan: 01
subsystem: mercadolivre/anuncios
tags: [recharts, kpi-comparativo, tdd, precos]
status: complete
dependency-graph:
  requires:
    - src/lib/mco.ts (computeMco)
    - src/lib/precoMcoSeries.ts (computePrecoMcoSeries, bucketKeyForDate — Phase 79)
  provides:
    - "computePreviousWindow / computePriceKpis / percentDelta / pointDelta em src/lib/precoMcoSeries.ts"
    - "gráfico dividido (ComposedChart + BarChart) e comparativo de KPIs em PrecoPraticadoReport.tsx"
  affects:
    - "página /analise-precos (aba de Análise de Preços)"
tech-stack:
  added: []
  patterns:
    - "Promise.all para buscar período atual + período anterior em paralelo (mesma RPC/tabela, só datas mudam)"
    - "Util puro testado (TDD RED/GREEN) para agregação de KPIs e deltas, reusado tanto pelo período atual quanto pelo anterior"
key-files:
  created: []
  modified:
    - src/lib/precoMcoSeries.ts
    - src/lib/precoMcoSeries.test.ts
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
decisions:
  - "computePriceKpis chama computePrecoMcoSeries internamente para reconciliar o ads bucketizado com a série do gráfico — nenhuma duplicação de lógica de agregação"
  - "comparativoNode usa cor 'neutra' para Preço médio e Break-even médio (aumento não é claramente bom ou ruim) e 'direcional' para MCO R$/MCO %/Qtd/Receita (mais é sempre melhor)"
metrics:
  duration: "~25min"
  completed: "2026-07-02"
---

# Quick Task 260702-jq4: Gráfico dividido + KPI comparativo Summary

Dividiu o gráfico único de `/analise-precos` em dois (principal preço×break-even×MCO% + BarChart de unidades) e adicionou comparativo "vs período anterior" nos 6 KPI cards, via 4 novas funções puras testadas em `precoMcoSeries.ts`.

## O que foi feito

**Task 1 (TDD) — Utils puros do comparativo** (`src/lib/precoMcoSeries.ts` + `.test.ts`):
- `computePreviousWindow(from, to)`: janela anterior de mesma duração, imediatamente antes (7 dias → 7 dias anteriores; 1 dia → dia anterior; from/to null → null).
- `computePriceKpis(rows, opts)`: agrega `PriceKpis` (qtd, receita, precoMedio, breakevenMedio, mco, mcoPct) reusando `computePrecoMcoSeries` + `computeMco` — reconcilia o ads bucketizado com a série do gráfico, idêntico ao cálculo antes inline no componente.
- `percentDelta(current, previous)`: variação % com `Math.abs` no denominador (mantém sinal correto quando o valor anterior é negativo); previous=0 → null.
- `pointDelta(current, previous)`: diferença absoluta (p.p.); qualquer argumento null → null.
- 6 novos testes (3 describe blocks) + 10 existentes = 16 testes no arquivo.

**Task 2 — Gráfico dividido em dois** (`PrecoPraticadoReport.tsx`):
- `ComposedChart` principal: removidos o 3º eixo `yAxisId="qtd"` oculto, a `Line` de unidades vendidas e o item "Unidades vendidas" da legenda (ficam 4 itens: Preço praticado, Break-even, MCO %, Margem).
- Novo `BarChart` de 140px logo abaixo, no mesmo `CardContent`, só renderizado quando `hasData && !loading && selectedId`. Mesmas margens laterais (`left:4, right:8`), mesma largura do eixo esquerdo (56) e um `YAxis` direito invisível (`width={44} hide`) para casar com o eixo MCO% do principal — os buckets alinham no eixo X entre os dois gráficos.
- `BarTooltip` local (mesmo estilo de card do `ChartTooltip` existente) mostra só "Unidades: N" do bucket.

**Task 3 — Comparativo vs período anterior nos KPI cards** (`PrecoPraticadoReport.tsx`):
- Estado novo `prevRows`/`prevAdsDaily`; os dois `useEffect` de busca (rows via RPC `orders_price_timeseries` e ads via `ml_ads_products_cache`) agora disparam a busca do período atual **e** do período anterior (`computePreviousWindow(fromDate, toDate)`) em `Promise.all` — mesma RPC/tabela, mesmos filtros de escopo (`_item_id`/`_ml_user_ids`/`item_id`/`ml_user_id`), só as datas mudam.
- `kpis` agora usa `computePriceKpis` (mantendo `qtdSemCusto`/`temImpostoAusente` calculados inline, fora do util); `prevKpis` calculado da mesma forma a partir de `prevRows`/`prevAdsDaily` (null quando não há dados anteriores).
- `deltas` (useMemo): `percentDelta` para Preço médio/Break-even médio/MCO R$/Qtd/Receita, `pointDelta` para MCO % (p.p.).
- `comparativoNode(delta, unidade, cor)`: renderiza "+X% vs período anterior" / "−X p.p. vs período anterior" colorido (verde/vermelho quando `cor="direcional"`; sempre cinza quando `cor="neutra"` — usado em Preço médio e Break-even médio, onde "maior" não é claramente bom nem ruim) ou "— vs período anterior" quando `deltas` é null.
- Todos os 6 `KPICard` passam `subtitleNode={comparativoNode(...)}`.

## Verificação

- `npx vitest run` — **334/334 verde** (baseline 327 + 7 novos: 6 do Task 1 + nenhum arquivo novo de teste, apenas describes adicionais).
- `npm run build` — limpo, sem erros de TypeScript.
- Greps do `<done>` de cada task conferidos manualmente (BarChart, `<Bar `, `dataKey="qtd"`==1, `yAxisId="qtd"`==0, `BarTooltip`>=2, `computePreviousWindow`/`computePriceKpis`/`prevKpis`/`subtitleNode`>=1/1/1/6, "vs período anterior", "p.p.").

## Deviations from Plan

None - plan executado exatamente como escrito.

## Threat Flags

Nenhum surface novo introduzido fora do já mapeado no `<threat_model>` do plano (T-jq4-01/02): a única mudança é uma segunda chamada às MESMAS RPC/tabela já em produção (RLS org-first, mesmos filtros de escopo), só com datas diferentes.

## Known Stubs

Nenhum stub. Toda a lógica de comparativo é real: busca dados reais do período anterior via a mesma RPC/tabela do período atual.

## Self-Check: PASSED

- `src/lib/precoMcoSeries.ts` — FOUND (contém `computePreviousWindow`, `computePriceKpis`, `percentDelta`, `pointDelta`)
- `src/lib/precoMcoSeries.test.ts` — FOUND (16 testes)
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — FOUND (BarChart + comparativo)
- Commits `152c054f`, `23651e34`, `5370606f` — FOUND em `git log --oneline`
