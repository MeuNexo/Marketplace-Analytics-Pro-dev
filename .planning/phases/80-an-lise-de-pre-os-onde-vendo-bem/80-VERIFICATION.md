---
phase: 80-an-lise-de-pre-os-onde-vendo-bem
verified: 2026-07-02T17:21:32Z
status: human_needed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Abrir /analise-precos em produção/preview, selecionar um anúncio com variação de preço (ex. MLB4113792113), conferir o cartão-veredito, alternar o toggle Unidades↔Lucro R$, abrir a aba 'Evolução no tempo' e repetir em light e dark"
    expected: "Histograma renderiza faixas com cor+rótulo % coerentes, veredito muda de foco (volume vs R$) ao trocar o toggle, a barra do preço recente aparece destacada, e a aba temporal mostra o gráfico da Phase 79 intacto — em ambos os temas"
    why_human: "Renderização visual do recharts (cores CVD reais na tela, legibilidade dos rótulos, comportamento do accordion/tooltip) não é observável por grep/tsc/vitest — exige navegador. O próprio SUMMARY 80-02 registra isso como pendência explícita, não bloqueante para o fechamento do código."
---

# Phase 80: Análise de Preços — onde vendo bem Verification Report

**Phase Goal:** Redesenhar a visão principal de `/analise-precos` (`PrecoPraticadoReport.tsx`) para responder "em que preço eu vendo bem?", trocando a série temporal por um histograma de faixas de preço com veredito determinístico, toggle Unidades↔Lucro R$, 4 KPIs, aba temporal preservada e paleta CVD-safe.

**Verified:** 2026-07-02T17:21:32Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `computePrecoFaixas` reagrupa por faixa de preço os pontos diários de `computePrecoMcoSeries`, sem recalcular custo/imposto | ✓ VERIFIED | `src/lib/precoFaixas.ts:9,68-137` — importa apenas `type McoSeriesPoint`; usa `d.qtd`, `d.precoUnit`, `d.mco`, `d.bucket` (campos já reconciliados); nenhum acesso a `cmvUnit`/`comissaoUnit`/`impostoUnit` na agregação |
| 2 | `niceStep` snapa para série 1/2/5×10^n e nunca retorna ≤0 | ✓ VERIFIED | `precoFaixas.ts:14-21` `Math.max(1, nice*pow)`; testado em `precoFaixas.test.ts:5-17` (inclui `niceStep(0)` e `niceStep(-5)`) |
| 3 | Bucketização centra em ~90% das vendas (p05–p95 ponderado) e agrega outliers numa barra única | ✓ VERIFIED | `precoFaixas.ts:81-96` `weightedPercentile` p05/p95 + bucket `outlier` único; teste `precoFaixas.test.ts:54-66` confirma `r.faixas.length < 12` com outlier isolado |
| 4 | `faixaOtima` é a de mais unidades (modo unidades) ou maior MCO R$ (modo lucro) | ✓ VERIFIED | `precoFaixas.ts:125-128`; teste `precoFaixas.test.ts:45-52` cobre os dois modos com resultado diferente |
| 5 | Faixa do preço recente marcada `isPrecoAtual`, com `margemRecentePct` | ✓ VERIFIED | `precoFaixas.ts:78-79,113,129,133`; teste `precoFaixas.test.ts:68-78` |
| 6 | `computeVeredicto` classifica saúde por `MCO_SAUDAVEL_PCT` e a frase ótima muda com o modo | ✓ VERIFIED | `precoFaixas.ts:139-188`; testes `precoFaixas.test.ts:88-120` (limites prejuízo/apertada/saudável + modo unidades vs lucro) |
| 7 | Entrada vazia/sem variação degrada com transparência, nunca quebra | ✓ VERIFIED | `precoFaixas.ts:70-75` retorna `faixas:[]`, `faixaOtima:null`; `computeVeredicto` cobre `faixaOtima:null` com frase de transparência (`precoFaixas.ts:178-179`); testes `precoFaixas.test.ts:80-85,114-119` |
| 8 | Visão principal de `/analise-precos` é um `BarChart` por faixa de preço (não mais série temporal) | ✓ VERIFIED | `PrecoPraticadoReport.tsx:601-647` — `BarChart data={faixasChartData}` é o primeiro gráfico renderizado no `Card` principal (linhas 559-677) |
| 9 | Toggle Unidades↔Lucro R$ troca altura das barras e o texto do veredito acompanha o modo | ✓ VERIFIED | `PrecoPraticadoReport.tsx:211,391-397,590-599,607` — `faixaMode` alimenta `computePrecoFaixas`/`computeVeredicto` e o `tickFormatter` do eixo Y |
| 10 | Cada barra tem cor de margem (verde/âmbar/vermelho) E rótulo de margem % no topo — cor nunca é único sinal | ✓ VERIFIED | `PrecoPraticadoReport.tsx:611-645` — `Cell fill={SAUDE_COLOR[f.saude]}` + `LabelList` custom renderiza `pctFraction(f.mcoPctMedio)` em TODA barra (inclui outlier, sem condicional de `unidades>0` no texto) |
| 11 | Faixa do preço recente destacada + cartão-veredito (2 frases) acima do gráfico | ✓ VERIFIED | `PrecoPraticadoReport.tsx:578-587` (cartão com `saudeTexto`+`otimoTexto`); `617-619,633-637` (`stroke`/rótulo "seu preço" na barra `isPrecoAtual`) |
| 12 | 4 KPIs (Preço recente · Margem recente % · Faixa campeã · Unidades no período) com comparativo | ✓ VERIFIED | `PrecoPraticadoReport.tsx:523-556` — exatamente 4 `KPICard`, 3 com `comparativoNode` (delta vs período anterior), 1 sem delta (Faixa campeã, conforme documentado) |
| 13 | Gráfico temporal da Phase 79 preservado em aba/accordion secundária recolhida "Evolução no tempo" | ✓ VERIFIED | `PrecoPraticadoReport.tsx:683-823` — `Accordion type="single" collapsible` (recolhido por padrão, sem `defaultValue`) contendo o `ComposedChart` (Area/Line/Legend idênticos à Phase 79) + `BarChart` de unidades |
| 14 | Histograma consome pontos DIÁRIOS via fetch RPC dedicado `_granularity:'day'` independente do toggle de granularidade | ✓ VERIFIED | `PrecoPraticadoReport.tsx:290-324` — `useEffect` com deps `[selectedId, mlUserIds, fromDate, toDate]` (sem `granularity`), chama RPC com `_granularity: "day"` fixo → `dailyRows` → `dailyPoints` (386-389) |
| 15 | Paleta das barras validada CVD-safe (light+dark) | ✓ VERIFIED (re-executado, não apenas lido do SUMMARY) | Tokens `--chart-margin-*` em `src/index.css:63-65,148-150` convertidos p/ hex e revalidados de forma independente com `validate_palette.py --pairs all`: light → `ALL CHECKS PASS` (WARN de CVD-separation/contraste aceitável pois há rótulo %, per a própria nota do validador); dark → `ALL CHECKS PASS` sem warnings |

**Score:** 15/15 truths verified (0 present-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/precoFaixas.ts` | Util puro: bucketização + veredito, exports `niceStep/computePrecoFaixas/classificarSaude/computeVeredicto/MCO_SAUDAVEL_PCT/FaixaMode/FaixaPreco/FaixasResult/Veredicto`, min 120 linhas | ✓ VERIFIED | 188 linhas; todos os exports presentes e usados no componente |
| `src/lib/precoFaixas.test.ts` | Testes vitest, min 80 linhas | ✓ VERIFIED | 120 linhas, 11 testes, todos passam |
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` | Tela refeita, contém `computePrecoFaixas`, min 300 linhas | ✓ VERIFIED | 826 linhas; `computePrecoFaixas` importado (linha 38) e usado (linha 391) |
| `src/index.css` | Tokens de cor CVD-safe | ✓ VERIFIED | `--chart-margin-saudavel/apertada/prejuizo` em `:root` e `.dark` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `PrecoPraticadoReport.tsx` | `src/lib/precoFaixas.ts` | `import { computePrecoFaixas, computeVeredicto, classificarSaude }` | ✓ WIRED | Linhas 37-44 (import) + 390-399 (uso, resultado alimenta JSX do histograma/KPIs/veredito) |
| `PrecoPraticadoReport.tsx` | `src/lib/precoMcoSeries.ts` | `import { computePrecoMcoSeries }` gera pontos diários | ✓ WIRED | Linha 26 (import) + 386-389 (`dailyPoints = computePrecoMcoSeries(dailyRows ?? [], ...)`, alimenta `faixasResult`) |
| `PrecoPraticadoReport.tsx` | RPC `orders_price_timeseries` | fetch dedicado `_granularity:"day"` | ✓ WIRED | Linhas 290-324 — chamada real via `supabase.rpc`, não estático/vazio |
| `MLAnalisePrecos.tsx` (rota `/analise-precos`) | `PrecoPraticadoReport` | render direto | ✓ WIRED | `App.tsx:148` rota → `MLAnalisePrecos.tsx:91` renderiza `<PrecoPraticadoReport ...>` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| Histograma (`BarChart`) | `faixasChartData` | `dailyRows` (RPC `orders_price_timeseries`, `_granularity:"day"`) → `computePrecoMcoSeries` → `computePrecoFaixas` | Sim — query real via `supabase.rpc`, sem fallback estático/vazio hardcoded | ✓ FLOWING |
| KPIs | `faixasResult.{precoRecente,margemRecentePct,faixaOtima,totalUnidades}` | mesmo pipeline acima | Sim | ✓ FLOWING |
| Aba temporal | `chartData`/`serie` | `rows` (RPC `orders_price_timeseries`, granularidade do toggle) → `computePrecoMcoSeries` | Sim — código intocado da Phase 79 | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Suíte de testes do util (11 testes) | `npx vitest run` (suíte completa, 1x) | `345 passed (345)` incluindo `src/lib/precoFaixas.test.ts (11 tests)` | ✓ PASS |
| Compilação TypeScript | `npx tsc --noEmit` | sem output (limpo) | ✓ PASS |
| Build de produção | `npm run build` | `✓ built in 29.94s`, gera `MLAnalisePrecos-*.js` | ✓ PASS |
| Paleta CVD-safe light | `validate_palette.py "#22c35d,#ba7908,#dc2828" --mode light --pairs all` (executado pelo verificador, não copiado do SUMMARY) | `ALL CHECKS PASS` (2 WARN aceitáveis por haver rótulo %) | ✓ PASS |
| Paleta CVD-safe dark | `validate_palette.py "#1fad53,#ab6f07,#c62f2f" --mode dark --pairs all` (idem) | `ALL CHECKS PASS`, sem warnings | ✓ PASS |
| Renderização real no navegador (light+dark, toggle, aba temporal) | — | não executado (exige browser) | ? SKIP → human verification |

### Requirements Coverage

Fase declarada "ad-hoc — nenhum requirement ID" no ROADMAP.md (linha 583). As tags `APF-UTIL/APF-VEREDICTO/APF-UI/APF-KPIS/APF-TEMPORAL/APF-CVD` usadas no frontmatter dos planos não aparecem em `.planning/REQUIREMENTS.md` (não há linhas `APF-*` no arquivo) — consistente com a fase ser ad-hoc, não uma omissão. Nenhum requisito órfão identificado.

### Anti-Patterns Found

Nenhum. Varredura em `src/lib/precoFaixas.ts`, `src/lib/precoFaixas.test.ts`, `PrecoPraticadoReport.tsx` e `src/index.css` por `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` (case-insensitive) e por termos de stub (`coming soon`, `not yet implemented`, `not available`) não encontrou ocorrências reais — o único match de "placeholder" é o atributo HTML `placeholder="Buscar anúncio por título ou ID…"` do `CommandInput` (uso legítimo do atributo nativo, não um marcador de dívida técnica).

### Human Verification Required

### 1. Validação visual E2E em `/analise-precos`

**Test:** Abrir `/analise-precos` em produção/preview, selecionar um anúncio com variação de preço (ex. `MLB4113792113`), observar o cartão-veredito, alternar o toggle Unidades↔Lucro R$, expandir a aba "Evolução no tempo", repetir em tema claro e escuro.
**Expected:** Histograma renderiza barras coloridas por margem com rótulo % legível em todas elas; barra do preço recente com contorno destacado e rótulo "seu preço"; veredito muda a segunda frase (volume→R$) ao trocar o toggle; aba temporal abre recolhida por padrão e mostra o gráfico ComposedChart idêntico ao da Phase 79; paleta legível em light e dark.
**Why human:** Renderização visual real do recharts (cores, contraste percebido, comportamento de accordion/tooltip/responsividade) não é observável por grep, tsc ou vitest — requer navegador. Esta é exatamente a pendência já registrada pelo próprio executor no SUMMARY 80-02 ("Verificação pendente — não bloqueia o fechamento do código"), agora formalizada como item de verificação humana desta fase.

### Gaps Summary

Nenhum gap de código encontrado. Todos os 15 must-haves derivados do goal da Fase 80 (ROADMAP.md linhas 580-591) e dos frontmatters de `80-01-PLAN.md`/`80-02-PLAN.md` foram verificados diretamente no código-fonte (não apenas lidos do SUMMARY): `precoFaixas.ts` reagrupa sem recalcular custo/imposto, o histograma é a visão principal com toggle/cor/rótulo/destaque/veredito, os 4 KPIs existem com comparativo, o gráfico temporal da Phase 79 está intacto numa aba recolhida alimentada por um fetch independente, e a paleta CVD-safe foi revalidada de forma independente (não copiada do SUMMARY) com `ALL CHECKS PASS` em ambos os temas. `tsc --noEmit`, `npx vitest run` (345/345) e `npm run build` passam.

O único item pendente é a validação visual em navegador (`status: human_needed`), que o próprio time já classificou como não-bloqueante para o fechamento do código — mas que, por definição de goal-backward verification, não pode receber `status: passed` automaticamente enquanto não houver confirmação humana de que a renderização real corresponde ao esperado.

---

_Verified: 2026-07-02T17:21:32Z_
_Verifier: Claude (gsd-verifier)_
