---
phase: 79-analise-de-precos-com-mco
verified: 2026-07-02T00:00:00Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Abrir /analise-precos logado, selecionar anúncio, conferir colchão verde/vermelho, toggle 'Incluir publicidade', granularidade dia/semana/mês, tooltip decomposto, 6 KPIs e paridade mobile"
    expected: "Colchão verde quando preço ≥ break-even e vermelho quando preço < break-even; toggle de ads recalcula break-even/MCO%; granularidade realinha buckets/ads; tooltip mostra decomposição por unidade; 6 KPIs corretos; funciona em mobile"
    why_human: "Comportamento visual e de renderização real (cores, layout, responsividade) não é verificável por grep/testes estáticos — checkpoint humano já previsto no 79-03-PLAN.md (Task 2, pendente do Wesley) e não conta como gap de código"
---

# Phase 79: Análise de Preços com MCO Verification Report

**Phase Goal:** A página `/analise-precos` responde "o preço praticado deu MCO?" via RPC `orders_price_timeseries` estendida com 6 colunas firmes por bucket, util puro `precoMcoSeries.ts` (reusando `computeMco`), e gráfico refeito em `PrecoPraticadoReport` (colchão preço × break-even + MCO% + toggle ads + 6 KPIs).
**Verified:** 2026-07-02
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Migration 20260679000000: DROP+CREATE, 13 colunas, SECURITY INVOKER, sem org param, sem subquery correlacionada, cast `::date` | ✓ VERIFIED | `supabase/migrations/20260679000000_orders_price_timeseries_mco.sql` — `DROP FUNCTION IF EXISTS public.orders_price_timeseries(text, text[], date, date, text)` seguido de `CREATE FUNCTION`; `RETURNS TABLE` com 13 colunas (7 originais + cmv, comissao, frete, qtd_sem_custo, impostos, qtd_sem_imposto); `SECURITY INVOKER` explícito; zero `grep -c org_id` / zero `SECURITY DEFINER`; todas as 6 colunas novas são agregações simples (`COALESCE(SUM(...))`/`FILTER`) no mesmo `GROUP BY 1` — nenhuma subquery correlacionada; `o.data_pedido::date` presente no `date_trunc` e nos filtros de data. **Aplicação em prod já provada no 79-02-SUMMARY.md** (MCP `apply_migration`, smoke role `authenticated`, 3 buckets reconciliados ao centavo, anti-IDOR = 0 linhas cross-org) — evidência aceita, não re-executável neste verifier |
| 2 | `src/lib/precoMcoSeries.ts`: reusa `computeMco`, bandas mutuamente exclusivas, bucketização dia/semana(segunda ISO)/mês(dia 1), qtd=0 defensivo, `incluirAds=false` zera ads; suíte vitest completa verde | ✓ VERIFIED | Import `computeMco` de `./mco` (1 ocorrência); `gainBand`/`lossBand` calculados com `>=`/`<` mutuamente excludentes (confirmado no teste "bandas... mutuamente exclusivas"); `bucketKeyForDate` usa `startOfWeek(weekStartsOn:1)` e `startOfMonth`; `qtd>0 ? ... : 0` em todos os `*Unit`; `incluirAds` controla o `Map` de ads (vazio quando false). `npx vitest run` executado neste verifier: **23 files, 327/327 passed** (inclui `precoMcoSeries.test.ts` 9/9) |
| 3 | `PrecoPraticadoReport.tsx`: mapeia as 6 colunas novas; query `ml_ads_products_cache` filtrada por item_id+date; gráfico 3 Areas empilhadas `type="linear"` + linha preço + linha break-even (`strokeDasharray`) + linha `mcoPct` em eixo direito separado; barras de volume/toggle Qtd-Receita removidos; toggle incluir ads (Switch, default true); 6 KPIs exatos; avisos custo/imposto ausente; rodapé de transparência; controles `flex-wrap` | ✓ VERIFIED | Mapeamento das 6 colunas no `.map((r:any)=>...)` (linhas 166-177); query a `ml_ads_products_cache` com `.eq("item_id")`, `.gte/.lte("date")`, `.range(0,4999)`; 3 `<Area>` (`base`/`gainBand`/`lossBand`) todas `type="linear"`, `stackId="mco"`; `<Line dataKey="precoUnit">` e `<Line dataKey="breakevenUnit" strokeDasharray="5 4">`; `<Line dataKey="mcoPct" yAxisId="mco">` em `YAxis yAxisId="mco" orientation="right"`; `grep volumeMetric` = 0 ocorrências; `Switch id="incluir-ads"` com `checked={incluirAds}` default `useState(true)`; 6 `KPICard` (Preço médio, Break-even médio, MCO R$, MCO % com `variant` success/danger pelo sinal, Qtd vendida, Receita); avisos condicionais `kpis.qtdSemCusto > 0` / `kpis.temImpostoAusente`; rodapé de transparência presente; container de controles com `className="flex flex-wrap items-center gap-2"` |
| 4 | `npm run build` verde | ✓ VERIFIED | Executado neste verifier: build concluído em 21.45s, sem erros |
| 5 | must_haves de cada plano (79-01/79-02/79-03) — item a item | ✓ VERIFIED | Ver tabela de Artefatos e Key Links abaixo — todos os `must_haves.truths`/`artifacts`/`key_links` dos 3 planos batem com o código |
| 6 | Nada de escopo deferred (deep-link `?item=`, sync novo de ads) implementado | ✓ VERIFIED | `grep "?item="` no componente = 0 ocorrências; nenhuma edge function nova de ads-por-item-diário criada (`ml_ads_products_cache` já existia da Phase 78/anterior, só consumida via query direta); nenhum novo arquivo de sync em `supabase/functions/` relacionado a ads |

**Score:** 6/6 truths verified (0 present-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260679000000_orders_price_timeseries_mco.sql` | RPC estendida com 6 colunas firmes, DROP+CREATE | ✓ VERIFIED | 84 linhas; DROP+CREATE presente; aplicada em prod (79-02-SUMMARY) |
| `src/lib/precoMcoSeries.ts` | Util puro `computePrecoMcoSeries` + `bucketKeyForDate` + tipos | ✓ VERIFIED | 153 linhas; exports `computePrecoMcoSeries`, `bucketKeyForDate`, `PrecoSeriesRow`, `AdsDailyRow`, `McoSeriesPoint`, `SeriesGranularity`, `ComputePrecoMcoSeriesOpts`; zero import de react/@supabase |
| `src/lib/precoMcoSeries.test.ts` | Testes vitest do util | ✓ VERIFIED | 199 linhas, 9 `it()` cobrindo composição, bandas, ausências, toggle, bucketização (dia/semana/mês), div/0 — todos passando |
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` | Componente refeito consumindo `computePrecoMcoSeries` | ✓ VERIFIED | 445 linhas (≥250 exigido); `computePrecoMcoSeries` importado e usado em `useMemo`; wired em `MLAnalisePrecos.tsx` (import + render intactos) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/lib/precoMcoSeries.ts` | `src/lib/mco.ts` | `import { computeMco }` | ✓ WIRED | `import { computeMco } from "./mco"` — usado dentro de `computePrecoMcoSeries` para `mco`/`pct` |
| `supabase/migrations/20260679000000...sql` | `orders` (tabela) | `SUM(...)` agregado no GROUP BY do bucket | ✓ WIRED | `SUM(o.custo_unit*o.quantidade)`, `SUM(o.comissao)`, `SUM(o.frete)`, `SUM(o.tax_amount)` — mesmo GROUP BY 1 |
| `PrecoPraticadoReport.tsx` | `src/lib/precoMcoSeries.ts` | `computePrecoMcoSeries(rows, {...})` | ✓ WIRED | chamado em `useMemo` (linha ~217), resultado usado em `chartData`/`kpis` |
| `PrecoPraticadoReport.tsx` | `ml_ads_products_cache` | query direta RLS-scoped item_id+date | ✓ WIRED | `supabase.from("ml_ads_products_cache").select("spend, date").eq("item_id", selectedId)...` |
| `PrecoPraticadoReport.tsx` | `orders_price_timeseries` (RPC) | mapeamento das 6 colunas novas | ✓ WIRED | `.map((r:any)=>({... cmv, comissao, frete, qtd_sem_custo, impostos, qtd_sem_imposto}))` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Suíte de testes completa (existência + comportamento do util) | `npx vitest run` | 23 files, 327/327 passed | ✓ PASS |
| Build de produção | `npm run build` | built in 21.45s, sem erros | ✓ PASS |
| Migration aplicada em prod + reconciliação + anti-IDOR | (evidência do 79-02-SUMMARY.md, não re-executável por este verifier — MCP não disponível na sessão de verificação) | 3 buckets reconciliados ao centavo; anti-IDOR = 0 linhas cross-org | ✓ PASS (evidência aceita) |

### Anti-Patterns Found

Nenhum. `grep -nE "TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER"` nos 4 arquivos da phase (migration, util, teste, componente) = 0 ocorrências. `volumeMetric` removido (0 ocorrências). Sem `console.log` órfão introduzido (apenas `console.warn` preexistente para erro de fetch, comportamento preservado).

### Requirements Coverage

Phase ad-hoc, sem requirement IDs formais no ROADMAP (`Requirements: (phase ad-hoc — nenhum requirement ID)`). Cobertura mapeada via must_haves dos 3 planos (79-01/79-02/79-03), todos satisfeitos — ver truths 1-6 acima.

### Human Verification Required

1. **Checkpoint visual do Wesley em preview** (79-03-PLAN.md Task 2, `checkpoint:human-verify`, ainda pendente conforme 79-03-SUMMARY.md)
   - **Test:** Abrir `/analise-precos` logado com dados reais da Pé Vermeio, selecionar anúncio com vendas, conferir colchão verde/vermelho, alternar "Incluir publicidade", trocar granularidade, ver tooltip decomposto, conferir 6 KPIs, testar em mobile.
   - **Expected:** Colchão coerente com preço vs. break-even; toggle de ads recalcula break-even/MCO% de forma consistente; granularidade realinha buckets e ads; tooltip mostra decomposição por unidade; KPIs corretos; paridade mobile/desktop.
   - **Why human:** Renderização visual (cores, layout responsivo, comportamento interativo real do gráfico) não é verificável por grep/análise estática de código — este é o checkpoint humano padrão do fluxo GSD e **não conta como gap de código** (nota explícita no prompt de verificação).

### Gaps Summary

Nenhum gap de código encontrado. Os 6 truths derivados do goal da Phase 79 estão verificados no código real (migration, util, componente), com testes e build verdes. A única pendência é o checkpoint visual do Wesley — item de UAT humano previsto desde o planejamento (79-03-PLAN.md Task 2), não uma lacuna de implementação.

---

_Verified: 2026-07-02_
_Verifier: Claude (gsd-verifier)_
