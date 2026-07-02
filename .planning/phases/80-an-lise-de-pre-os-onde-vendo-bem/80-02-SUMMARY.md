---
phase: 80-an-lise-de-pre-os-onde-vendo-bem
plan: 02
subsystem: frontend
tags: [react, recharts, typescript, precificacao, mco, dataviz, cvd]

# Dependency graph
requires:
  - phase: 80-an-lise-de-pre-os-onde-vendo-bem
    plan: "01"
    provides: "computePrecoFaixas/computeVeredicto/classificarSaude/FaixaMode (src/lib/precoFaixas.ts)"
  - phase: 79-analise-de-precos-com-mco
    provides: "computePrecoMcoSeries (src/lib/precoMcoSeries.ts) — pontos diarios reconciliados ao centavo"
provides:
  - "PrecoPraticadoReport.tsx refeito: histograma de faixas de preco (BarChart) como visao principal, veredito determinístico, toggle Unidades<->Lucro R$, 4 KPIs enxutos, grafico temporal (Phase 79) preservado em aba secundaria"
  - "Tokens CSS --chart-margin-saudavel/apertada/prejuizo (light+dark) validados CVD-safe, dedicados ao histograma"
affects: [ui-analise-precos]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LabelList com content function (closure sobre o array de dados do grafico) para renderizar 2 informacoes por barra (rotulo de margem % + marcador 'seu preco') sem duplicar Bar/LabelList"
    - "Tokens de cor dedicados a um grafico especifico (--chart-margin-*) quando os tokens semanticos globais (--success/--warning/--destructive) nao satisfazem a banda OKLCH de luminosidade exigida para marcas adjacentes — mesmo padrao ja usado em --chart-price/breakeven/mco (Phase 79)"
    - "Fetch RPC diario dedicado e desacoplado do toggle de granularidade da UI (useEffect com deps sem 'granularity') quando um util consumidor (aqui: computePrecoFaixas) exige granularidade fixa independente do que o usuario ve em outra aba"

key-files:
  created: []
  modified:
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
    - src/index.css

key-decisions:
  - "precoFaixas.ts expressa margem como FRACAO (0-1), diferente de McoSeriesPoint.mcoPct (0-100, via computeMco) — criado formatter dedicado pctFraction() no componente para nao multiplicar por 100 duas vezes (bug silencioso evitado antes de commitar)"
  - "Cor de margem do histograma usa tokens NOVOS --chart-margin-saudavel/apertada/prejuizo em vez de --success/--warning/--destructive: os globais falham o check 'Lightness band' do validador CVD da skill dataviz quando usados lado a lado como marcas de grafico (warning/destructive saem da banda OKLCH 0.43-0.77 light / 0.48-0.67 dark)"
  - "Commits consolidados em 2 (histograma+KPIs+aba temporal juntos; paleta CVD separada) em vez dos 3 commits do plano-doc (Task 3/4/5) — o componente foi reescrito como uma unica unidade coerente (JSX de Task 3 e Task 4 estao entrelacados no mesmo arquivo/mesma renderizacao) e cada etapa foi verificada com tsc+vitest+build antes do commit"

patterns-established:
  - "Validacao de paleta de grafico com o script da skill dataviz (validate_palette.py --pairs all) documentada como comentario no proprio token CSS — proxima pessoa que mexer no token ve o motivo e o comando de re-validacao"

requirements-completed: ["APF-UI", "APF-KPIS", "APF-TEMPORAL", "APF-CVD"]

# Metrics
duration: ~35min
completed: 2026-07-02
status: complete
---

# Phase 80 Plan 2: Componente — histograma de faixas + toggle + KPIs + aba temporal Summary

**`/analise-precos` refeito: visão principal agora é um histograma de faixas de preço (BarChart, cor de margem + rótulo % em toda barra) com toggle Unidades↔Lucro e cartão-veredito em português; 4 KPIs enxutos; gráfico temporal da Phase 79 preservado intacto numa aba "Evolução no tempo".**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 (Task 3 histograma+veredito, Task 4 KPIs+aba, Task 5 paleta CVD) — implementadas juntas no componente, commitadas em 2 commits (ver Deviations)
- **Files modified:** 2

## Accomplishments

- **Histograma de faixas (visão principal):** `BarChart` (recharts) consumindo `computePrecoFaixas(dailyPoints, {mode})`, eixo X = faixas de preço (`label`), altura = unidades ou MCO R$ conforme `faixaMode`. Cada barra: `<Cell>` colorida por `classificarSaude(f.mcoPctMedio)` + `<LabelList>` com margem % SEMPRE visível (inclusive bucket outlier `+R$X` e faixas vazias) — cor nunca é o único sinal. Faixa que contém o preço recente ganha contorno destacado + rótulo "seu preço" acima da barra.
- **Cartão-veredito:** duas frases determinísticas (`computeVeredicto`) acima do gráfico, com bolinha de cor por `veredicto.saude` usando os novos tokens `--chart-margin-*`.
- **Toggle Unidades ↔ Lucro R$:** troca `faixaMode`, recalcula altura das barras, formatação do eixo Y (unidades inteiras vs R$ compacto) e o texto do veredito (frase de "faixa campeã" muda de foco unidades→lucro).
- **Fetch diário dedicado:** novo `useEffect` chama a RPC `orders_price_timeseries` sempre com `_granularity: "day"`, independente do toggle de granularidade da aba temporal (deps `[selectedId, mlUserIds, fromDate, toDate]`, sem `granularity`). Alimenta `dailyPoints` (`computePrecoMcoSeries`) → `faixasResult` → `veredicto`.
- **4 KPIs enxutos:** Preço recente · Margem recente % (cor pelo sinal via `classificarSaude`) · Faixa campeã (sem delta) · Unidades no período — mantendo comparativo vs período anterior nos 3 primeiros onde já existia (`deltas.precoMedio`/`mcoPp`/`qtd`).
- **Aba secundária "Evolução no tempo":** `ComposedChart` + `BarChart` de unidades (Phase 79) preservados intactos dentro de um `Accordion` (shadcn) recolhido por padrão; o toggle de granularidade (`day`/`week`/`month`) e o fetch `rows` existente passaram a servir só essa aba.
- **Rodapé de transparência** atualizado para descrever a nova visão (faixas, toggle, cor=margem, outliers agregados), mantendo os avisos de custo/imposto ausente.
- **Paleta CVD-safe validada:** tokens `--chart-margin-saudavel/apertada/prejuizo` (light+dark) — `python3 validate_palette.py --pairs all` → **ALL CHECKS PASS** nos dois modos (ver Task Commits e Deviations).

## Task Commits

O componente foi reescrito como uma unidade coerente cobrindo as Tasks 3+4 do plano-doc num único commit, e a validação/token CVD (Task 5) num segundo commit:

1. **Tasks 3+4 (histograma+veredito+toggle+4 KPIs+aba temporal)** — `d13b3639` (feat) — `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx`
2. **Task 5 (paleta CVD-safe)** — `40e0ede2` (style) — `src/index.css`

## Files Created/Modified

- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — reescrito (562 linhas). Novo fetch `dailyRows`, estado `faixaMode`, `dailyPoints`/`faixasResult`/`veredicto`/`faixasChartData` memoizados, cartão-veredito, `BarChart` de faixas com `Cell`+`LabelList` custom, `FaixaTooltip`, 4 `KPICard`, `Accordion` "Evolução no tempo" envolvendo o `ComposedChart`+`BarChart` de unidades existentes (código intocado, só realocado).
- `src/index.css` — 3 novos tokens de cor (`--chart-margin-saudavel/apertada/prejuizo`) em `:root` e `.dark`, comentados com a validação CVD (script, checks, resultado).

## Decisions Made

- **Unidade de margem (fração vs. percentual 0-100):** `precoFaixas.ts` (80-01) expressa `mcoPctMedio`/`margemRecentePct` como fração (`0.17` = 17%), enquanto `McoSeriesPoint.mcoPct` (usado pelo gráfico temporal existente, via `computeMco`) já vem multiplicado por 100. Criado um formatter dedicado `pctFraction()` no componente, separado do `pctFmt()` original, para não multiplicar por 100 duas vezes — verificado manualmente lendo `src/lib/mco.ts` antes de escrever o código (evitado antes de existir bug, não corrigido depois).
- **Tokens de cor dedicados ao histograma** (`--chart-margin-*`) em vez de reusar `--success`/`--warning`/`--destructive` diretamente: rodando o validador da skill `dataviz` nos valores atuais de `--warning`/`--destructive`, o check "Lightness band" falhava (light: `--warning` L=0.77, no limite superior da banda 0.43–0.77; dark: `--warning` L=0.71 e `--destructive` L=0.48, fora da banda 0.48–0.67 dark). Em vez de alterar os tokens globais (usados em botões/badges por todo o app — risco de regressão fora do escopo deste plano), criei tokens dedicados ao gráfico, seguindo o mesmo padrão já estabelecido para `--chart-price/breakeven/mco` na Phase 79. `--chart-margin-saudavel` reusa os MESMOS valores HSL de `--success` (que já passava no validador sem ajuste).
- **Consolidação de commits:** o plano-doc descreve 3 commits (Task 3, Task 4, Task 5), mas as Tasks 3 e 4 alteram o MESMO arquivo com JSX entrelaçado (o cartão-veredito e o BarChart de faixas da Task 3 ficam na mesma árvore de render que os KPIs e o Accordion da Task 4 — não há um ponto de corte limpo em hunks de diff sem reescrever trabalho). Optei por commitar as duas tasks juntas (`d13b3639`, verificado com tsc+vitest+build antes do commit) e a Task 5 (só `index.css`, mudança isolada) separadamente (`40e0ede2`). Sem perda de rastreabilidade: cada commit corresponde a uma unidade de trabalho verificável e revertível isoladamente.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Divisor de granularidade de unidade de margem verificado antes de codificar (não um bug corrigido depois — ver "Decisions Made" acima para o racional completo)**

Nenhum bug foi introduzido e corrigido; a checagem de unidades de `mcoPct` (fração vs. 0-100) foi feita PROATIVAMENTE lendo `src/lib/mco.ts` antes de escrever o `KPICard`/`LabelList`/`FaixaTooltip`, evitando o bug clássico de "dobrar a multiplicação por 100". Registrado aqui por transparência, não como correção pós-commit.

**2. [Rule 2 - Missing functionality] Tokens de cor CVD-safe dedicados criados (não estavam no `index.css`)**

- **Found during:** Task 5 (validação da paleta)
- **Issue:** `--warning` e `--destructive` (tokens globais já existentes) falham o check "Lightness band" do validador CVD quando usados lado a lado como cor de barra do histograma (ver "Decisions Made").
- **Fix:** Adicionados `--chart-margin-saudavel/apertada/prejuizo` em `:root` e `.dark`, com valores tunados especificamente para a banda OKLCH exigida, validados com `validate_palette.py --pairs all` → PASS nos dois modos.
- **Files modified:** `src/index.css`
- **Verification:** `python3 validate_palette.py "#22c35d,#ba7908,#dc2828" --mode light --pairs all` → ALL CHECKS PASS; `python3 validate_palette.py "#1fad53,#ab6f07,#c62f2f" --mode dark --pairs all` → ALL CHECKS PASS. Hex calculados a partir dos valores HSL exatos dos novos tokens (conversão verificada via script Python, não estimados).
- **Committed in:** `40e0ede2`

---

**Total deviations:** 1 auto-fixed (Rule 2 — tokens CVD dedicados); 1 verificação proativa documentada (não é uma deviation de código, mas registrada por transparência de decisão de unidades numéricas).
**Impact on plan:** Nenhum impacto de escopo — os `must_haves.truths` do frontmatter da 80-02 (cor+rótulo em toda barra, paleta CVD PASS light+dark, faixa do preço recente destacada, 4 KPIs, aba temporal preservada, fetch diário independente do toggle) foram todos satisfeitos.

## Issues Encountered

Nenhum, além das deviations documentadas acima.

## User Setup Required

None — sem configuração de serviço externo.

## Verificação pendente (não bloqueia o fechamento do código)

Conforme a `key_guidance` deste plano, a **verificação E2E com a skill `verify` em `/analise-precos`** (Task 5 Step 3 do plano-doc: selecionar um anúncio com variação, ex. `MLB4113792113`, conferir veredito, alternar o toggle Unidades↔Lucro, abrir a aba "Evolução no tempo", em light e dark) **exige navegador/produção** e foi deixada como pendência de validação visual do Wesley — não bloqueia o fechamento deste plano no código. Automatizado até aqui: `tsc --noEmit` limpo, `npx vitest run` 345/345 verdes, `npm run build` ok, paleta CVD validada por script (não visual).

## Next Phase Readiness

- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` está pronto para deploy/preview; nenhuma dependência de backend nova (RPC `orders_price_timeseries` e `computePrecoMcoSeries` intocadas, conforme constraint global do plano).
- Pendente (não-bloqueante): validação visual do Wesley em `/analise-precos` (veredito, toggle, aba temporal, light+dark) em produção/preview — igual ao padrão já usado nas entregas anteriores desta trilha (Phase 79).
- Nenhum bloqueio conhecido para fechar a Phase 80.

---
*Phase: 80-an-lise-de-pre-os-onde-vendo-bem*
*Completed: 2026-07-02*

## Self-Check: PASSED

- FOUND: src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
- FOUND: src/index.css
- FOUND: d13b3639 (Tasks 3+4 commit)
- FOUND: 40e0ede2 (Task 5 commit)
