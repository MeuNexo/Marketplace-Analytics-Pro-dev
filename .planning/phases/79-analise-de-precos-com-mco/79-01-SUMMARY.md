---
phase: 79-analise-de-precos-com-mco
plan: 01
subsystem: analise-precos
tags: [rpc, migration, mco, util-puro, vitest]
requires: []
provides:
  - "Migration orders_price_timeseries com 6 colunas firmes por bucket (não aplicada — 79-02)"
  - "computePrecoMcoSeries + bucketKeyForDate + tipos (SeriesGranularity, PrecoSeriesRow, AdsDailyRow, McoSeriesPoint)"
affects: [79-02, 79-03]
tech-stack:
  added: []
  patterns:
    - "DROP FUNCTION antes de CREATE quando RETURNS TABLE ganha colunas"
    - "Componentes firmes por bucket via COALESCE(SUM(...)) + FILTER (WHERE ... IS NULL)"
    - "Util puro colocado em src/lib/ com teste espelho (padrão mco.ts/mco.test.ts)"
key-files:
  created:
    - supabase/migrations/20260679000000_orders_price_timeseries_mco.sql
    - src/lib/precoMcoSeries.ts
    - src/lib/precoMcoSeries.test.ts
  modified: []
decisions:
  - "Imposto firme via SUM(tax_amount) na RPC (padrão MLCostCard/get_cost_waterfall), sem src/lib/tax no util"
  - "Ads = série diária real de ml_ads_products_cache bucketizada por bucketKeyForDate (sem rateio por receita)"
  - "SECURITY INVOKER explícito na função (era implícito na versão da Phase 77)"
metrics:
  duration: "~5 min"
  completed: "2026-07-02"
status: complete
---

# Phase 79 Plan 01: RPC estendida + util precoMcoSeries Summary

**One-liner:** RPC `orders_price_timeseries` estendida (migration DROP+CREATE com cmv/comissao/frete/impostos firmes por bucket, não aplicada) + util puro `computePrecoMcoSeries` reusando `computeMco`, com ads diário bucketizado e 9 testes vitest verdes.

## O que foi feito

### Task 1 — Migration (commit `396a5a3f`)
`supabase/migrations/20260679000000_orders_price_timeseries_mco.sql` (83 linhas):
- `DROP FUNCTION IF EXISTS public.orders_price_timeseries(text, text[], date, date, text);` seguido de `CREATE FUNCTION` — RETURNS TABLE ganha colunas, `CREATE OR REPLACE` falharia (Pitfall 1 do research).
- Mesma assinatura de entrada, mesmo corpo (date_trunc com whitelist de granularidade, cast `o.data_pedido::date`, status IN paid/shipped/delivered, filtros de ml_user_ids/from/to, GROUP BY 1 / ORDER BY 1).
- RETURNS TABLE com 13 colunas: as 7 originais + `cmv`, `comissao`, `frete`, `qtd_sem_custo`, `impostos` (=SUM(tax_amount)), `qtd_sem_imposto` — todas `COALESCE(SUM(...),0)`, contadores com `FILTER (WHERE ... IS NULL)`.
- `LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'` — sem DEFINER, sem parâmetro de organização, sem subquery correlacionada.
- **NÃO aplicada no banco** — deploy é o plano 79-02 (checkpoint do orquestrador via MCP apply_migration em `ckcdevcxgvueywivefgx`).

### Task 2 — Util puro + testes, TDD (commits `6460d9c2` RED / `6edab3d1` GREEN)
`src/lib/precoMcoSeries.ts` (152 linhas):
- Exports: `SeriesGranularity`, `PrecoSeriesRow`, `AdsDailyRow`, `McoSeriesPoint`, `bucketKeyForDate`, `computePrecoMcoSeries` (+ `ComputePrecoMcoSeriesOpts`).
- `bucketKeyForDate`: dia = a própria data; semana = `startOfWeek(weekStartsOn:1)` (segunda, igual `date_trunc('week')` do Postgres); mês = `startOfMonth` — formato `yyyy-MM-dd`.
- `computePrecoMcoSeries(rows, {adsDaily, incluirAds, granularity})`: pré-agrega ads em `Map<bucket, spend>`; por bucket calcula mco/mcoPct via `computeMco` (platformCost = comissao+frete), precoUnit, breakevenUnit = (cmv+comissao+frete+ads+impostos)/qtd, componentes por unidade, `base`/`gainBand`/`lossBand` mutuamente exclusivos, `custoAusente`/`impostoAusente`. Defensivo: qtd=0 → unidades 0, sem NaN/Infinity.
- Zero imports de UI/Supabase — só date-fns e `./mco`.

`src/lib/precoMcoSeries.test.ts` (199 linhas, padrão mco.test.ts com aritmética manual em comentário): 9 `it()` cobrindo os 6 casos exigidos — composição típica, bandas exclusivas, ausências, toggle ads (com diferença exata no break-even), bucketização dia/semana/mês, div/0.

## Desvios do plano

Nenhum — plano executado exatamente como escrito. Única adição menor: export do tipo auxiliar `ComputePrecoMcoSeriesOpts` (aditivo, não listado no plano mas útil para o 79-03 tipar o call-site).

## Provas (gates)

| Gate | Resultado |
|------|-----------|
| `npx vitest run src/lib/precoMcoSeries.test.ts` | ✅ 9/9 passed |
| `npx vitest run` (suíte completa) | ✅ 23 files, 327/327 passed (sem regressão) |
| `npm run build` | ✅ built in 25.42s |
| grep `DROP FUNCTION IF EXISTS public.orders_price_timeseries` | ✅ presente |
| grep -c `SECURITY DEFINER` na migration | ✅ 0 |
| grep -ci `org_id` na migration | ✅ 0 |
| grep `SUM(o.tax_amount)` + `qtd_sem_custo` + `security invoker` | ✅ presentes |
| grep -c `from "./mco"` no util | ✅ 1 (reuso, não reimplementação) |
| grep -c `src/lib/tax` no util | ✅ 0 |
| grep -ciE `react\|@supabase` no util | ✅ 0 |

## Ciclo TDD (gates de plano)

- RED `6460d9c2` — testes escritos primeiro, falha confirmada (módulo inexistente).
- GREEN `6edab3d1` — implementação mínima, 9/9 verdes.
- REFACTOR — não necessário (código já limpo na primeira passada).

## Commits

| Hash | Mensagem |
|------|----------|
| `396a5a3f` | feat(79-01): estende RPC orders_price_timeseries com componentes firmes por bucket |
| `6460d9c2` | test(79-01): testes falhando do util precoMcoSeries (TDD RED) |
| `6edab3d1` | feat(79-01): util puro precoMcoSeries — série de MCO por bucket (TDD GREEN) |

## Próximos consumidores

- **79-02**: aplica a migration via MCP `apply_migration` + smoke como role `authenticated` (2-3 buckets vs soma manual + anti-IDOR).
- **79-03**: UI do `PrecoPraticadoReport` consome `computePrecoMcoSeries` + query direta de `ml_ads_products_cache`.

## Self-Check: PASSED

- 4/4 arquivos existem (migration, util, teste, SUMMARY)
- 3/3 commits encontrados no git log
- 0 deleções acidentais nos commits
- 0 stubs/placeholders introduzidos
