---
phase: quick-260618-1sl
verified: 2026-06-18T01:28:30Z
status: human_needed
score: 7/7 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Abrir /vendas no preview Vercel e verificar rendering visual da faixa MCO"
    expected: "Faixa slim aparece entre ConsultorCard e MLKPIGrid com '● MCO do dia · R$ X.XXX,XX · XX,X% · (i)'; marcador e % em verde/vermelho conforme sinal do MCO"
    why_human: "Rendering condicional (`{connected && ...}`) e tokens CSS kpi.positive/kpi.negative nao sao verificaveis por grep/tsc"
  - test: "Clicar (i) — verificar popover de glossario"
    expected: "Popover abre ao hover e ao tap com definicao leiga e o breakdown 'Receita − CMV − Custo Operacional − Impostos = MCO'; sem HTML injetado"
    why_human: "Interacao de UI — hover/tap e estado open/onOpenChange do Popover"
  - test: "Alternar periodo entre 'Hoje' e um range de datas anterior"
    expected: "Rotulo muda dinamicamente entre 'MCO do dia' e 'MCO do periodo'"
    why_human: "Logica singleDayRange vs currentFrom/currentTo requer inspecao em runtime com filtros reais"
  - test: "Selecionar periodo sem vendas (receita = 0)"
    expected: "Faixa mostra '— / —' sem NaN; marcador fica em cor neutra (text-muted-foreground)"
    why_human: "Requer periodo real sem dados para validar condicao mcoEmpty=true em runtime"
---

# Quick Task 260618-1sl: Verificacao — Faixa "MCO do dia" no /vendas

**Task Goal:** Implementar a faixa "MCO do dia" no topo do /vendas, 100% aditiva, conforme spec aprovada.
**Verified:** 2026-06-18T01:28:30Z
**Status:** human_needed
**Re-verification:** No — verificacao inicial

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Lojista ve faixa slim entre ConsultorCard e MLKPIGrid com MCO em R$ e % | VERIFIED | `MLMcoStrip` renderizado em linhas 708–716 de `MercadoLivre.tsx`, exatamente apos o bloco `{connected && <ConsultorCard.../>}` (linha 694) e antes do `widgets.map(...)` que inicia o `kpi_grid` (linha 729) |
| 2 | Marcador ● e % ficam verdes (MCO >= 0) ou vermelhos (MCO < 0) via tokens kpi.positive/kpi.negative | VERIFIED | `MLMcoStrip.tsx` linhas 34–44: `dotClass` e `pctClass` aplicam `text-kpi-positive` ou `text-kpi-negative` conforme `isPositive = mco >= 0`; quando `isEmpty` usa `text-muted-foreground` (neutro) |
| 3 | Rotulo dinamico "MCO do dia" vs "MCO do periodo" | VERIFIED | `mcoLabel` (linhas 335–341 da pagina) usa `filters.singleDayRange` e `currentFrom/currentTo === todayUTC()` para decidir o rotulo; passado como prop `label` |
| 4 | (i) abre popover com breakdown "Receita − CMV − Custo Op. − Impostos = MCO" | VERIFIED | `MLMcoStrip.tsx` linhas 77–105: Popover controlado por useState, `PopoverTrigger asChild` com `HelpCircle`, `onMouseEnter/onMouseLeave` para hover, `onClick stopPropagation + toggle` para tap — mesmo padrao do KPICard; conteudo le `KPI_GLOSSARY.mco.definition` e `.example` como texto plano (sem `dangerouslySetInnerHTML`) |
| 5 | Receita = 0 → faixa mostra "—" sem NaN/divisao por zero | VERIFIED | `mco.ts` linha 38: `pct = grossRevenue > 0 ? ... : null`; `MLMcoStrip.tsx` linhas 31/46/50: `isEmpty = empty || pct === null` gera `formattedBRL = "—"` e `formattedPct = "—"`; confirmado pelos testes vitest: `pct === null` e `mco = -850` (sem NaN) |
| 6 | Ads contabilizado exatamente uma vez | VERIFIED | `MercadoLivre.tsx` linha 309: `platformCost = kpiSummary?.custo_plataforma ?? 0` (frete+comissao, exclui ads per comment e semantica de `custo_plataforma` no useMLKPISummary); linha 310: `ads = adsSummary.total_spend` somado separadamente; `computeMco` subtrai ambos uma unica vez; teste vitest "ads contabilizado exatamente uma vez" confirma diff exato = N |
| 7 | Nenhum KPI do MLKPIGrid removido ou alterado — mudanca 100% aditiva | VERIFIED | Render do `MLKPIGrid` (linhas 731–743) com props `metrics`, `previousMetrics`, `loading`, `syncing`, `hasSyncProgress`, `kpiSummary`, `kpiSummaryLoading`, `adsTotalForPeriod` permanece identico; `MLMcoStrip` inserido ANTES do bloco `widgets.map(...)`, nao dentro dele |

**Score: 7/7 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/mco.ts` | Helper puro `computeMco` com tipos `McoInput`/`McoResult` | VERIFIED | 40 linhas; exporta `McoInput`, `McoResult`, `computeMco`; formula correta; sem imports de runtime |
| `src/lib/mco.test.ts` | Suite vitest cobrindo R$/%, negativo, receita=0, ads uma vez | VERIFIED | 4 testes, todos verdes (`npx vitest run src/lib/mco.test.ts`: 4 passed) |
| `src/components/mercadolivre/MLMcoStrip.tsx` | Faixa de apresentacao (props: mco, pct, label, loading, empty) | VERIFIED | 108 linhas; named export `MLMcoStrip`; Popover/HelpCircle; tokens kpi.positive/negative; tabular-nums; sem fetch |
| `src/lib/kpi-glossary.ts` | Nova entrada `"mco"` no union `GlossaryKey` + entrada em `KPI_GLOSSARY` | VERIFIED | `"mco"` adicionado na linha 29 do union; entrada `mco:` na linha 191 com `term`, `definition` e `example` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `MercadoLivre.tsx` | `src/lib/mco.ts` | `import computeMco` + montagem `mcoInput` useMemo | WIRED | Linha 51: `import { computeMco } from "@/lib/mco"`; linhas 307–332: useMemo monta input e chama `computeMco(mcoInput)` |
| `MercadoLivre.tsx` | `MLMcoStrip.tsx` | render `<MLMcoStrip>` entre ConsultorCard e MLKPIGrid | WIRED | Linha 50: `import { MLMcoStrip } from "@/components/mercadolivre/MLMcoStrip"`; linhas 708–716: render com todas as props |
| `MLMcoStrip.tsx` | `src/lib/kpi-glossary.ts` | `KPI_GLOSSARY.mco` para o popover | WIRED | Linha 4: `import { KPI_GLOSSARY } from "@/lib/kpi-glossary"`; linha 52: `const glossaryEntry = KPI_GLOSSARY.mco`; usada nas linhas 100–102 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `MLMcoStrip.tsx` | `mco`, `pct`, `label`, `empty` | `computeMco(mcoInput)` alimentado por `kpiSummary.gross_revenue`, `kpiSummary.custo_plataforma`, `adsSummary.total_spend`, CMV/tax com fallback de `monthlyCostWaterfall` — todos de hooks com queries existentes (sem novo fetch) | Sim — reutiliza dados ja presentes na pagina | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| computeMco calcula MCO correto | `npx vitest run src/lib/mco.test.ts` | 4 testes passed em 4ms | PASS |
| TypeScript sem erros | `npx tsc --noEmit` | sem output (exit 0) | PASS |
| Build de producao conclui | `npm run build` | `built in 20.00s` sem erros (apenas aviso pre-existente de chunk size) | PASS |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | Nenhum encontrado | — | Sem TBD/FIXME/XXX em nenhum dos 4 arquivos modificados; sem `dangerouslySetInnerHTML`; sem retorno `null`/`[]`/`{}` de apresentacao sem condicional valida |

---

### Human Verification Required

#### 1. Rendering visual da faixa no /vendas

**Test:** Abrir /vendas no preview Vercel com conta ML conectada e verificar que a faixa aparece entre o ConsultorCard e o grid de KPIs.
**Expected:** Faixa slim em largura total exibindo `● MCO do dia · R$ X.XXX,XX · XX,X% · (i)`; marcador e % verdes quando MCO >= 0, vermelhos quando MCO < 0.
**Why human:** A condicao `{connected && <MLMcoStrip .../>}` e os tokens CSS `text-kpi-positive`/`text-kpi-negative` so sao verificaveis em runtime com conta conectada.

#### 2. Popover (i) hover + tap

**Test:** No /vendas, passar o mouse sobre o icone `(i)` e clicar nele.
**Expected:** Popover abre ao hover e fecha ao sair; abre/fecha ao clicar. Conteudo mostra a definicao leiga do MCO e o breakdown `Receita − CMV − Custo Operacional − Impostos = MCO`. Sem HTML bruto visivel.
**Why human:** Interacao hover/tap e comportamento de `open`/`onOpenChange` do Popover requerem inspecao em browser.

#### 3. Rotulo dinamico por periodo

**Test:** Alternar o seletor de periodo entre "Hoje" e um intervalo de datas passadas.
**Expected:** Rotulo muda de "MCO do dia" para "MCO do periodo" ao sair do filtro de hoje.
**Why human:** Logica `filters.singleDayRange === todayUTC()` vs `currentFrom === currentTo && currentTo === todayUTC()` requer inspecao em runtime com o seletor de filtro real.

#### 4. Estado receita zero (—)

**Test:** Selecionar periodo futuro ou sem dados de venda.
**Expected:** Faixa exibe `— / —` no lugar de R$ e %, marcador em cor neutra, sem NaN.
**Why human:** Requer periodo sem dados para exercitar `mcoEmpty = true` e `pct = null` em runtime.

---

### Gaps Summary

Sem gaps. Todos os 7 must-haves verificados programaticamente. Os 4 itens de human_verification sao checkpoint visuais/interativos que nao bloqueiam a corretude do codigo — o comportamento esta implementado e testado; falta somente confirmacao visual no browser.

---

_Verified: 2026-06-18T01:28:30Z_
_Verifier: Claude (gsd-verifier)_
