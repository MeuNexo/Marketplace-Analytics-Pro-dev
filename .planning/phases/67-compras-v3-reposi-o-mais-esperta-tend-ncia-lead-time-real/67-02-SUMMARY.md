---
phase: 67-compras-v3-reposi-o-mais-esperta-tend-ncia-lead-time-real
plan: 02
subsystem: frontend-utils
tags: [typescript, vitest, ewma, sazonalidade, lead-time, replenishment, pure-functions, tdd]

# Dependency graph
requires:
  - phase: 67-01
    provides: migration 20260667000100 com RPC v7 e constantes finais (alpha=0.3/decay=0.7, clamp[0.5,2.5], 12 meses, K>=2, threshold=0.20, DEFAULT FALSE)
provides:
  - "calcEwmaDaily: espelho puro da CTE ewma_sales — POWER(0.7,weekOffset)/7, null se <2 semanas"
  - "calcSeasonalFactor: espelho da CTE seasonal_index — ratio-to-average, clamp[0.5,2.5], active >=12 meses"
  - "calcTrend: espelho do CASE tendencia — threshold 20%, null/zero older='~'"
  - "resolveSmartLeadTime: espelho do COALESCE lead_time_dias — K>=2 OCs vence param"
  - "resolveVendaDiaOrigem: espelho do CASE venda_dia_origem — ewma_sazonal/ewma/simples"
  - "Union types VendaDiaOrigem e LeadTimeOrigem exportados para tipagem dos badges"
  - "33 novos testes vitest cobrindo cada dimensao e seus fallbacks"
affects:
  - "67-03 — hook useReplenishmentBySku pode importar tipos VendaDiaOrigem/LeadTimeOrigem para interface ReplenishmentSkuRow"
  - "67-04 — badges de transparencia consomem os mesmos valores que as funcoes espelho validam"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED→GREEN: testes escritos primeiro com imports de funcoes inexistentes; implementacao depois"
    - "Espelho puro: funcoes TypeScript sem I/O, rede, DOM ou banco — testavel em isolamento total"
    - "Paridade SQL/TS: constantes identicas (alpha, clamp, limiares) — T-67-05 mitigado"

key-files:
  created: []
  modified:
    - src/lib/analysis/replenishmentUtils.ts
    - src/lib/analysis/replenishmentUtils.test.ts

key-decisions:
  - "calcTrend retorna '~' para ewmaOlderDaily=0 (plan behavior spec): diverge ligeiramente do SQL onde 0*1.20=0 poderia retornar '↑' para recent>0, mas SQL tem NULL older (nao 0) nas situacoes reais; seguir spec do plano"
  - "resolveSmartLeadTime exige medianLeadDays>0 alem de ocCount>=2: guard extra para valores invalidos (zero dias) nao cobertos pelo guard SQL data_entrega>=data_pedido"
  - "Union types VendaDiaOrigem e LeadTimeOrigem exportados: permite tipagem forte no hook e nos badges sem regenerar database.types.ts"

# Metrics
duration: ~3.5 min
completed: 2026-06-26
status: complete
---

# Phase 67 Plan 02: Espelho TS testavel do calculo esperto (replenishmentUtils) Summary

**5 funcoes puras espelho da RPC v7 implementadas com TDD (RED→GREEN): EWMA+sazonal+tendencia+lead-time com paridade de constantes e 33 novos testes cobrindo cada dimensao e fallback; 246 testes totais verdes, tsc limpo.**

## Performance

- **Duration:** ~3.5 min
- **Started:** 2026-06-26
- **Completed:** 2026-06-26
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments

- `calcEwmaDaily`: replica a CTE `ewma_sales` — POWER(0.7, weekOffset)/7; retorna null se <2 semanas (limiar SMART-03/D-09); alpha=0.3, decay=0.7 identicos a migration 67-01
- `calcSeasonalFactor`: replica a CTE `seasonal_index` — ratio-to-average por marca/mes; active=true somente com >=12 meses distintos; clamp [0.5, 2.5]; fallback globalAvg=0 e mes ausente
- `calcTrend`: replica o CASE `tendencia` no SELECT final — threshold 20%; null/zero older retorna '~' (comportamento conservador vs SQL para caso edge raro)
- `resolveSmartLeadTime`: replica o COALESCE lead_time_dias na CTE `params` — K>=2 OCs + medianLeadDays>0 → 'fornecedor_real'; qualquer fallback → 'param'
- `resolveVendaDiaOrigem`: replica o CASE `venda_dia_origem` na CTE `sales_smart` — ewma_sazonal/ewma/simples por limiares identicos (smart + weeks>=2 + sazonalAtiva)
- Union types `VendaDiaOrigem` e `LeadTimeOrigem` exportados para tipagem forte dos badges (67-03/67-04)
- TDD: 33 novos testes cobrindo todos os ramos de fallback (RED ca3a8804 → GREEN bae102f3)
- Zero regressao: 213 testes existentes (Phases 62-66) continuam verdes; total 246/246 passando
- tsc --noEmit limpo

## Task Commits

1. **Task 1 (RED) + Task 2 (RED): testes com imports de funcoes inexistentes** — `ca3a8804`
2. **Task 1 (GREEN) + Task 2 (GREEN): implementacao das 5 funcoes** — `bae102f3`

## Files Created/Modified

- `src/lib/analysis/replenishmentUtils.ts` — 5 funcoes novas + 2 union types exportados (calcEwmaDaily, calcSeasonalFactor, calcTrend, resolveSmartLeadTime, resolveVendaDiaOrigem, VendaDiaOrigem, LeadTimeOrigem); funcoes/constantes existentes intocadas
- `src/lib/analysis/replenishmentUtils.test.ts` — 33 novos testes em 5 novos blocos describe; imports atualizados; 20 testes existentes intocados

## Decisions Made

- **calcTrend retorna '~' para ewmaOlderDaily=0:** o plan behavior spec diz "null/zero → '~'"; no SQL a situacao real e older=NULL (nao 0) quando ha menos de 4 semanas no bucket; retornar '~' para zero e conservador e semanticamente correto.
- **resolveSmartLeadTime exige medianLeadDays>0 alem de K>=2:** guard adicional para dados invalidos (possivel caso edge nao coberto pelo guard SQL). Conservador — fallback para param neste caso.
- **Union types exportados imediatamente:** permite que 67-03 possa importar `VendaDiaOrigem | LeadTimeOrigem` na interface `ReplenishmentSkuRow` sem repetir literais de string.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Assertiva de teste errada no caso "offset real" de calcEwmaDaily**
- **Found during:** Task 1 GREEN (execucao do vitest pos-implementacao)
- **Issue:** O teste assertava `ewmaHighRecent > 20/7` mas EWMA e media ponderada entre 10 e 20, portanto sempre menor que 20/7. O comentario dizia "puxado para 20/7" mas isso so aconteceria se houvesse peso infinito em offset=0.
- **Fix:** Corrigido para `toBeGreaterThan(10/7)` + `toBeLessThan(20/7)` que e o comportamento matematicamente correto: EWMA com qty=20 em offset=0 e qty=10 em offset=3 resulta em ≈2.492/d, entre 10/7 e 20/7.
- **Files modified:** src/lib/analysis/replenishmentUtils.test.ts
- **Commit:** bae102f3

## Known Stubs

None — modulo puro sem dados mocados ou placeholders. Todas as funcoes retornam valores calculados a partir de inputs.

## Threat Flags

Nenhuma superficie nova de seguranca introduzida — modulo TypeScript puro sem I/O, rede, DOM ou banco. T-67-05 (divergencia espelho-TS vs RPC) mitigado: constantes e limiares identicos a migration 67-01 provados pelos 33 testes (cada limiar testado em ambos os lados).

## Self-Check: PASSED

- `src/lib/analysis/replenishmentUtils.ts` — existe e exporta 5 novas funcoes + 2 union types
- `src/lib/analysis/replenishmentUtils.test.ts` — 53 testes (20 existentes + 33 novos), todos passando
- Commits ca3a8804 e bae102f3 existem no git log
- vitest run: 246/246 passando
- tsc --noEmit: 0 erros
