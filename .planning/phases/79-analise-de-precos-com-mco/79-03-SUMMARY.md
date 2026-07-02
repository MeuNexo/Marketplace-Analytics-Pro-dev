---
phase: 79-analise-de-precos-com-mco
plan: 03
subsystem: analise-precos
tags: [ui, recharts, mco, banda, kpi, toggle-ads]
requires: ["79-01", "79-02"]
provides:
  - "PrecoPraticadoReport refeito: colchão preço×break-even (gainBand/lossBand) + MCO% eixo direito + toggle ads + 6 KPIs + tooltip decomposto + avisos"
affects: []
tech-stack:
  added: []
  patterns:
    - "Banda colorida condicional via 3 Areas empilhadas (base transparente + gain/loss) type=linear"
    - "Query direta ml_ads_products_cache com .range() explícito (PostgREST trunca 1000)"
    - "Ads fetch não chaveado por granularidade — bucketização no util (evita refetch)"
key-files:
  created: []
  modified:
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
decisions:
  - "KPIs reconciliados com a série: ads dos KPIs = Σ p.ads dos buckets exibidos (já zerado pelo util com toggle OFF)"
  - "MCO R$/un do tooltip = precoUnit − breakevenUnit (opção do plano; McoSeriesPoint não expõe qtd)"
  - "Eixo direito de MCO% mantido por decisão travada do Wesley (mockup aprovado) — desvio consciente da regra genérica 'one axis' da skill dataviz"
metrics:
  duration: "~15 min"
  completed: "2026-07-02"
status: complete
---

# Phase 79 Plan 03: UI Análise de Preços com MCO Summary

**One-liner:** `PrecoPraticadoReport` refeito — colchão verde/vermelho entre preço praticado e break-even (3 Areas empilhadas type=linear), MCO% no eixo direito, toggle "Incluir publicidade" (default ON), 6 KPIs novos, tooltip com decomposição por unidade e avisos de custo/imposto ausente; build + 327/327 testes verdes.

## O que foi feito

### Task 1 — Refatoração completa do componente (commit `d2d721ea`)

**Dados:**
- `SeriesRow` local substituído pelo `PrecoSeriesRow` importado de `@/lib/precoMcoSeries`; mapeamento da RPC ganhou as 6 colunas novas (`cmv`, `comissao`, `frete`, `qtd_sem_custo`, `impostos`, `qtd_sem_imposto`) com `Number(r.x ?? 0)`. Comportamento de erro preservado (console.warn + `setRows([])`).
- Novo `useEffect` sibling (mesmo cancelled-guard) busca o spend diário de ads: query direta a `ml_ads_products_cache` (`spend, date`, `.eq("item_id")`, `.in("ml_user_id")` só quando há ids, `.gte/.lte("date")`, `.range(0, 4999)` contra truncagem PostgREST). NÃO chaveado pela granularidade — a bucketização é do util. Cobertura ausente / erro → array vazio → ads=0 silencioso (caso comum, não quebra nada).
- Estado `incluirAds` (default `true`); série computada em `useMemo` via `computePrecoMcoSeries(rows ?? [], { adsDaily, incluirAds, granularity })`; `chartData` = série + `label` (bucketLabel preservado).
- REMOVIDOS: `volumeMetric`, toggle Qtd/Receita, `Bar` de volume, `differenceInCalendarDays` (KPIs de média diária saíram).

**KPIs (6, mesmo grid `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`):**
Preço médio · Break-even médio (= (Σcmv+Σcomissao+Σfrete+ΣadsBucket+Σimpostos)/qtd) · MCO R$ (ícone colorido pelo sinal) · MCO % (`variant` success/danger pelo sinal) · Qtd vendida · Receita. MCO calculado via `computeMco` sobre os totais do período com `ads = Σ p.ads` da série (reconcilia KPI ↔ gráfico; toggle OFF zera nos dois). SAÍRAM: Faixa de preço, Média diária (Qtd), Receita média diária.

**Gráfico (ComposedChart):**
- Eixo esquerdo `yAxisId="preco"` (R$/un, brlCompact) + eixo direito `yAxisId="mco"` (%).
- 3 Areas empilhadas `stackId="mco"` `type="linear"` `isAnimationActive={false}`: `base` (transparente), `gainBand` (`hsl(var(--success))` 0.25), `lossBand` (`hsl(var(--destructive))` 0.25).
- Linha `precoUnit` (accent, sólida, 2.2) + `breakevenUnit` (muted-foreground, `strokeDasharray="5 4"`, dot=false), ambas `type="linear"` (evita overshoot cúbico nos cruzamentos — pitfall do research); `mcoPct` no eixo direito (primary, monotone permitido).
- Skill `dataviz` lida ANTES do código do gráfico (regra do repo): texto sempre em text tokens, tooltip como camada de hover padrão, grid recessivo preservado. O eixo duplo (R$ × MCO%) contraria a regra genérica "one axis" da skill, mas é decisão travada do Wesley (mockup aprovado no brainstorming) — documentado como desvio consciente.

**Tooltip:** decomposição completa — Preço, Break-even, MCO R$/un (verde/vermelho pelo sinal), MCO %, e seção "Por unidade" com custo, comissão, frete, ads, imposto; nota de custo/imposto ausente no próprio bucket quando aplicável.

**Avisos (sem inventar número):** `qtd_sem_custo` somado > 0 → "custo ausente em N un — break-even subestimado"; algum `qtd_sem_imposto` > 0 → "regime fiscal não configurado em parte das vendas". Texto discreto entre gráfico e rodapé.

**Rodapé de transparência:** "Linha sólida = preço praticado · linha tracejada = break-even · colchão verde/vermelho = MCO por unidade · linha do eixo direito = MCO% · Ads = relatório diário de publicidade (melhor esforço; ausente = 0) · imposto pelo regime configurado · granularidade X" — reflete o adendo pós-research (série diária real de ads, não rateio).

**Paridade mobile (lição Phase 78):** componente renderizado uma única vez em `MLAnalisePrecos` (sem ramo mobile/desktop); controles em `flex flex-wrap` (grupo granularidade+Switch também com wrap) — gráfico, granularidade e toggle utilizáveis nos dois tamanhos.

## Desvios do plano

Nenhum desvio funcional — plano executado como escrito. Registros:
1. **[Documentado] Eixo duplo vs skill dataviz:** a skill proíbe dual-axis genericamente; a decisão travada do Wesley (mockup aprovado, CONTEXT.md) prevalece. Não é desvio do plano — o plano manda exatamente isso — mas fica registrado para o verifier.
2. **[Menor] `.range(0, 4999)` na query de ads:** não estava literal no plano, mas é regra do projeto (PostgREST trunca em 1000 — feedback registrado em memória). Defensivo, aditivo.
3. **[Menor] `.in("ml_user_id", ...)` só aplicado quando `mlUserIds.length > 0`:** espelha a semântica da RPC (`null` = todas as lojas); `.in(..., [])` retornaria vazio incorretamente.

## Provas (gates)

| Gate | Resultado |
|------|-----------|
| `npm run build` | ✅ built in 24.29s |
| `npx vitest run` (suíte completa) | ✅ 23 files, 327/327 passed |
| grep `computePrecoMcoSeries` | ✅ 2 |
| grep `ml_ads_products_cache` | ✅ 3 |
| grep `gainBand` / `lossBand` | ✅ 1 / 1 |
| grep `breakevenUnit` / `mcoPct` | ✅ 3 / 5 |
| grep `Switch` | ✅ 3 |
| grep `volumeMetric` | ✅ 0 (removido) |
| grep `type="monotone"` | ✅ só na Line mcoPct (permitido); bandas e linhas de preço/break-even são `type="linear"` |

## Commits

| Hash | Mensagem |
|------|----------|
| `d2d721ea` | feat(79-03): refaz PrecoPraticadoReport — colchão preço×break-even com MCO |

## Pendências

- **Task 2 (checkpoint:human-verify) — PENDENTE: ok visual do Wesley em preview.** Wesley ausente; o orquestrador vai publicar o preview Vercel da branch `gsd/phase-79-analise-precos-mco` e conduzir os passos 2–9 do checkpoint (colchão coerente, toggle ads recalcula, granularidade realinha, tooltip decomposto, 6 KPIs, paridade mobile, avisos de dado ausente). Ajustes de cor/opacidade/cópia que o Wesley pedir voltam para a Task 1.

## Self-Check: PASSED

- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` existe (445 linhas ≥ 250 exigidas)
- Commit `d2d721ea` presente no git log
- 0 deleções de arquivos no commit; 0 untracked deixados
- 0 stubs/placeholders introduzidos (toda a UI está ligada a dado real da RPC/cache)
