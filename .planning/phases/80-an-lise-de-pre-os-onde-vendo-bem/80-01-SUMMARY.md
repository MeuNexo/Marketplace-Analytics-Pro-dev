---
phase: 80-an-lise-de-pre-os-onde-vendo-bem
plan: 01
subsystem: analytics
tags: [typescript, vitest, precificacao, mco, util-puro]

# Dependency graph
requires:
  - phase: 79-analise-de-precos-com-mco
    provides: "McoSeriesPoint (src/lib/precoMcoSeries.ts) — pontos diarios reconciliados ao centavo (preco, MCO, custo/imposto ausente)"
provides:
  - "Util puro src/lib/precoFaixas.ts: bucketizacao por faixa de preco (niceStep, computePrecoFaixas) + veredito deterministico (classificarSaude, computeVeredicto, MCO_SAUDAVEL_PCT)"
affects: [80-02, ui-analise-precos, mco]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Util 100% puro consumindo tipo de outro util (McoSeriesPoint) sem duplicar calculo — so reagrupa"
    - "Bucketizacao ponderada por unidades (percentil p05/p95) com bucket outlier unico para preco alto, evitando cascata de faixas vazias"
    - "Veredito 100% template determinístico sobre numeros — zero LLM"

key-files:
  created:
    - src/lib/precoFaixas.ts
    - src/lib/precoFaixas.test.ts
  modified: []

key-decisions:
  - "Divisor da largura de bucket ajustado de spread/8 (doc de referencia) para spread/2 — o valor original produzia bucket width=1 e quebrava os 4 testes de agregacao/faixaOtima/outlier/preco-recente do proprio doc; /2 reproduz o comportamento esperado (Rule 1 bug fix)"

patterns-established:
  - "Util puro TDD: teste RED (import de modulo inexistente falha) -> implementacao GREEN -> commit"

requirements-completed: ["APF-UTIL", "APF-VEREDICTO"]

# Metrics
duration: ~8min
completed: 2026-07-02
status: complete
---

# Phase 80 Plan 1: Util `precoFaixas.ts` (bucketização por faixa + veredito) Summary

**Util puro `precoFaixas.ts` que reagrupa os pontos diários já reconciliados de `computePrecoMcoSeries` por faixa de preço (bucketização ponderada por unidades, outlier agregado) e produz um veredito determinístico de saúde de margem — 11 testes vitest, sem LLM, sem novas dependências.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2
- **Files modified:** 2 (ambos criados)

## Accomplishments
- `niceStep`: snap de largura de bucket para série "bonita" 1/2/5 × 10^n, sempre > 0
- `computePrecoFaixas`: bucketiza pontos diários por faixa de preço (p05–p95 ponderado por unidades), agrega outliers de preço alto num único bucket `+R$X`, calcula `faixaOtima` por modo (`unidades` = mais unidades, `lucro` = maior MCO R$), marca a faixa que contém o preço recente e sua margem
- `classificarSaude` + `computeVeredicto` + `MCO_SAUDAVEL_PCT`: veredito 100% determinístico (duas frases template) classificando prejuízo/apertada/saudável/sem-dados
- Suíte vitest completa (345 testes, incluindo os 11 novos) verde; `tsc --noEmit` limpo

## Task Commits

Cada task seguiu TDD (RED → GREEN → commit único de implementação, conforme o plano):

1. **Task 1: bucketização e agregação por faixa** - `af98a791` (feat) — inclui teste `precoFaixas.test.ts` (niceStep + computePrecoFaixas) commitado junto com a implementação
2. **Task 2: veredito determinístico** - `6daed136` (feat) — testes de `classificarSaude`/`computeVeredicto` commitados junto com a implementação

_Nota: seguindo o plano, cada task foi commitada como um único commit `feat` contendo teste+implementação (RED verificado localmente antes do commit, não commitado em separado)._

## Files Created/Modified
- `src/lib/precoFaixas.ts` (188 linhas) - Util puro: tipos `FaixaMode`/`FaixaPreco`/`FaixasResult`/`ComputeFaixasOpts`/`SaudePreco`/`Veredicto`, funções `niceStep`, `computePrecoFaixas`, `classificarSaude`, `computeVeredicto`, constante `MCO_SAUDAVEL_PCT`
- `src/lib/precoFaixas.test.ts` (120 linhas) - 11 testes vitest cobrindo niceStep, agregação por faixa, faixaOtima por modo, outlier, preço recente, entrada vazia, classificarSaude, computeVeredicto (incluindo degradação sem dados)

## Decisions Made
- Divisor da largura de bucket (`niceStep(spread / N)`) ajustado de `/8` (código do doc de referência `docs/superpowers/plans/2026-07-02-analise-precos-onde-vendo-bem.md`) para `/2` — ver Deviations abaixo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Divisor da largura de bucket corrigido de spread/8 para spread/2**
- **Found during:** Task 1 (implementação de `computePrecoFaixas`)
- **Issue:** O código completo do doc de referência (`docs/superpowers/plans/2026-07-02-analise-precos-onde-vendo-bem.md`, Task 1 Step 7) usa `const w = niceStep(spread / 8)`. Transcrito literalmente, os 4 testes de `computePrecoFaixas` do próprio doc (agregação por faixa 55–60/60–65, `faixaOtima` por modo, outlier agregado, faixa do preço recente) falhavam: `spread/8` produzia largura de bucket = 1 (ex.: spread=6 → `niceStep(0.75)=1`), gerando buckets estreitos (`min` em valores como 56/62) em vez dos buckets largos de R$5 (`min=55`/`min=60`) que os testes esperam.
- **Fix:** Verifiquei manualmente (e via script node) que `spread/2` reproduz exatamente a largura de bucket (R$5) esperada nos 4 casos de teste do doc, incluindo o caso do bucket outlier (onde `precoRecente` puxa o `spread` via `precoRecente*0.02`). Alterei a linha para `niceStep(spread / 2)`.
- **Files modified:** `src/lib/precoFaixas.ts`
- **Verification:** Os 11 testes de `precoFaixas.test.ts` passam (incluindo os 4 que falhavam com `/8`); suíte completa do projeto (345 testes) segue verde; `tsc --noEmit` limpo.
- **Committed in:** `af98a791` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix — Rule 1)
**Impact on plan:** Correção necessária para que o util realmente satisfaça os `must_haves.truths` do frontmatter (bucketização centrada em ~90% das vendas, sem cascata de faixas vazias). Sem impacto de escopo — mesma assinatura de função, mesmos exports, mesmo comportamento de outlier/faixaOtima/preço-recente descritos no plano.

## Issues Encountered
None além da deviation acima.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `computePrecoFaixas`/`computeVeredicto` prontos para consumo pelo componente UI (plano 80-02: histograma de faixas com toggle + veredito), conforme a interface já especificada no doc de referência (Task 3).
- Exports batem com o frontmatter do plano: `niceStep`, `computePrecoFaixas`, `classificarSaude`, `computeVeredicto`, `MCO_SAUDAVEL_PCT`, `FaixaMode`, `FaixaPreco`, `FaixasResult`, `Veredicto`.
- Nenhum bloqueio conhecido para o plano 80-02.

---
*Phase: 80-an-lise-de-pre-os-onde-vendo-bem*
*Completed: 2026-07-02*

## Self-Check: PASSED

- FOUND: src/lib/precoFaixas.ts
- FOUND: src/lib/precoFaixas.test.ts
- FOUND: af98a791 (Task 1 commit)
- FOUND: 6daed136 (Task 2 commit)
