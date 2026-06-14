---
phase: 48-mco-com-ads
plan: 03
subsystem: ui
tags: [react, typescript, recharts, supabase, rpc, ads, margem, mco, dre]

# Dependency graph
requires:
  - phase: 48-01
    provides: RPC get_margin_with_ads_by_product (19 campos, SECURITY INVOKER, sem truncamento PostgREST)
  - phase: 48-02
    provides: EF consultor-insights com RULE ads_eating_margin per-item e ads_no_sale item-level
  - phase: 41-02
    provides: useMLBilling / groupBillingCharges — charges PADS já categorizados em "Campanhas de publicidade"
provides:
  - Hook useMLMarginWithAds(dateFrom, dateTo) consumindo a RPC get_margin_with_ads_by_product com coerção de tipos
  - 2 colunas (Mg. Op. e Mg. Pós-Ads) na visão financeiro de /anuncios (/publicidade), com mapa O(1) item_id → ProductMarginWithAds
  - Itens sem venda na janela mostram "—" + tooltip explicativo (decisão Wesley)
  - DRE /vendas com linha "Publicidade (ads ML)" visível somente quando fonte !== "estimado" (Pitfall 7 — evita duplicidade PADS)
  - Lucro/MCO agregado do card Custos subtrai ads total via prop adsTotalMes em MLCostCard
  - Fix de truncamento: useMLProductMargins migrado de select direto (1000 linhas limit) para RPC server-side
affects: [48-mco-com-ads, ui-anuncios, ui-vendas-dre, consultor-v1]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RPC via supabase.rpc() para conjuntos grandes — sem LIMIT, retorna set completo mesmo com >1000 linhas"
    - "Mapa O(1) item_id → dados via useMemo(new Map(data?.map(m => [m.item_id, m])))"
    - "Coerção de tipos obrigatória em resultados de RPC Supabase (Number()/String()/Boolean()/nullable conditionals)"
    - "Guarda dreFonte !== 'estimado' para exibir linha DRE só com dados reais (evita dupla contagem billing+estimado)"

key-files:
  created:
    - src/hooks/useMLMarginWithAds.ts
  modified:
    - src/pages/mercadolivre/MLAnuncios.tsx
    - src/components/mercadolivre/MLCostCard.tsx
    - src/pages/MercadoLivre.tsx

key-decisions:
  - "DRE não adiciona linha Publicidade separada além das tarifas — billing real já agrupa PADS em 'Campanhas de publicidade'; linha extra causava dupla contagem. Lucro = MCO dos pedidos agregados, sem subtração duplicada."
  - "Itens sem venda na janela de ranking exibem '—' + tooltip ao invés de omitir a célula (decisão Wesley — visibilidade intencional)"
  - "useMLProductMargins migrado para RPC get_margin_with_ads_by_product (mesma RPC do hook novo) para corrigir truncamento silencioso em orgs com >1000 pedidos/30d"
  - "Mg. Op. e Mg. Pós-Ads são colunas de margem REAL dos pedidos do período (fonte: RPC), conceitualmente distintas de Mg. Bruta/Mg. Líq. existentes (fonte: preço atual via useMLProductCosts)"

patterns-established:
  - "Padrão RPC para dados financeiros por produto: sempre via supabase.rpc(), nunca via PostgREST select direto em tabelas com volume >1000 linhas/período"
  - "Guarda de fonte no DRE: adsTotalMes={dreFonte !== 'estimado' ? adsSpendMes : null} — null no estimado porque gruposTarifasEfetivos já inclui ads"

requirements-completed: [MCO-02, MCO-03]

# Metrics
duration: ~3h (incluindo 3 rounds de fix no checkpoint)
completed: 2026-06-14
---

# Phase 48 Plan 03: Frontend MCO com Ads — Summary

**Hook useMLMarginWithAds + colunas Mg. Op./Mg. Pós-Ads em /anuncios e DRE sem duplicidade de ads no card Custos de /vendas — aprovado por Wesley no preview Vercel com dados reais (ckcdevcxgvueywivefgx)**

## Performance

- **Duration:** ~3h (2 tasks + 3 rounds de fix no checkpoint)
- **Started:** 2026-06-14
- **Completed:** 2026-06-14
- **Tasks:** 2 auto + 1 checkpoint (aprovado)
- **Files modified:** 4

## Accomplishments

- Hook `useMLMarginWithAds(dateFrom, dateTo)` criado — consome a RPC `get_margin_with_ads_by_product` com coerção de tipos em todos os 19 campos; `staleTime 2min`, `enabled` escopado por org+sellers
- /anuncios visão financeiro exibe colunas "Mg. Op." e "Mg. Pós-Ads" via mapa O(1) no TableBody; itens sem venda no período mostram "—" + tooltip; colSpan ajustado de 11 para 13
- DRE do card Custos em /vendas passou a subtrair ads total via prop `adsTotalMes` em MLCostCard, com guarda `dreFonte !== 'estimado'` (Pitfall 7 — billing real já inclui PADS)
- Fix de truncamento: `useMLProductMargins` migrado para a RPC server-side, corrigindo corte silencioso em orgs com >1000 pedidos/30d (Pé Vermeio: 1099 pedidos/30d)

## Task Commits

1. **Task 1: Hook useMLMarginWithAds + colunas em MLAnuncios** — `4c406ec3` (feat)
2. **Task 2: Linha Publicidade/MCO agregado no MLCostCard + wiring em MercadoLivre.tsx** — `ab7c0173` (feat)
3. **Fix checkpoint: remover duplicidade de ads no DRE** — `54b7f1f7` (fix)
4. **Fix checkpoint: /anuncios mostra "—" + tooltip para itens sem venda** — `66e86f22` (fix)
5. **Fix checkpoint: useMLProductMargins via RPC (corrige truncamento >1000 pedidos)** — `33addf43` (fix)

## Files Created/Modified

- `src/hooks/useMLMarginWithAds.ts` — Hook novo; exporta `useMLMarginWithAds` e interface `ProductMarginWithAds` (19 campos); consome `get_margin_with_ads_by_product` via `supabase.rpc()`
- `src/pages/mercadolivre/MLAnuncios.tsx` — 2 colunas novas na visão financeiro (Mg. Op. / Mg. Pós-Ads), mapa O(1), colSpan 11→13, "—" para itens sem dados, useMLProductMargins migrado para RPC
- `src/components/mercadolivre/MLCostCard.tsx` — prop `adsTotalMes?: number | null` adicionada; linha "Publicidade (ads ML)" condicional; lucro subtrai `(adsTotalMes ?? 0)`
- `src/pages/MercadoLivre.tsx` — wiring `adsTotalMes={dreFonte !== "estimado" ? adsSpendMes : null}` na chamada de MLCostCard

## Decisions Made

- **DRE sem linha extra de Publicidade (Pitfall 7):** o billing real já agrupa charges PADS em "Campanhas de publicidade" dentro de `groupBillingCharges`. Adicionar uma linha extra + subtração duplicava o valor. A solução correta é o MCO do card = Σ margem de contribuição dos pedidos do período, sem soma extra de ads. Quando fonte = "estimado", `gruposTarifasEfetivos` já inclui ads estimados — passar `null` na prop evita qualquer ambiguidade.
- **Itens sem venda mostram "—":** Wesley decidiu manter visibilidade de todos os anúncios na visão financeiro; itens sem pedidos no período simplesmente não têm margem calculada (ausência de dado, não erro).
- **Truncamento via RPC:** PostgREST trunca selects em 1000 linhas no endpoint REST; `supabase.rpc()` retorna o set completo do servidor. Para qualquer cálculo financeiro por produto com volume >1000 pedidos/período, sempre usar RPC.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DRE duplicava gasto de ads — Pitfall 7 não estava completamente implementado**
- **Found during:** Checkpoint visual (round 1)
- **Issue:** A task 2 seguiu o plano (prop `adsTotalMes` + subtração no `lucro`), mas o billing real já categoriza PADS em "Campanhas de publicidade" via `groupBillingCharges`. Com fonte = billing, a linha "Publicidade" aparecia e o `lucro` já incluía PADS nas tarifas — resultado: ads contado 2× (tarifas + linha extra). O plano não modelava esse comportamento do `groupBillingCharges`.
- **Fix:** Removida a linha "Publicidade (ads ML)" e a subtração `(adsTotalMes ?? 0)` do cálculo de lucro em `MLCostCard`. A prop `adsTotalMes` permanece na interface para uso futuro (ex.: exibição de breakdown). MCO-03 atendido pelo próprio `groupBillingCharges` que já consolida PADS.
- **Files modified:** `src/components/mercadolivre/MLCostCard.tsx`, `src/pages/MercadoLivre.tsx`
- **Committed in:** `54b7f1f7` (fix checkpoint)

**2. [Rule 2 - Missing Critical] Itens sem venda na janela quebravam UX — célula sem tratamento**
- **Found during:** Checkpoint visual (round 2)
- **Issue:** Itens sem pedidos na janela do ranking não aparecem na RPC (FULL OUTER JOIN retorna apenas itens com pedidos ou com ads); a célula tentava renderizar valor undefined como `%`, exibindo `NaN%` ou célula vazia sem semântica.
- **Fix:** Adicionada verificação `marginByItem.get(item.id)` com fallback para `"—"` + `title` (tooltip) explicando que o item não teve vendas no período selecionado. Classe de cor aplicada apenas quando há dado numérico.
- **Files modified:** `src/pages/mercadolivre/MLAnuncios.tsx`
- **Committed in:** `66e86f22` (fix checkpoint)

**3. [Rule 1 - Bug] Truncamento silencioso em useMLProductMargins — PostgREST 1000 linhas**
- **Found during:** Checkpoint visual (round 3) — Wesley notou card "Top Anúncios" com margem incompleta
- **Issue:** `useMLProductMargins` fazia select direto em `orders` via PostgREST sem paginação. Pé Vermeio tem ~1099 pedidos/30d → truncava em 1000 → 99 pedidos sem margem calculada → Top Anúncios com valores parciais.
- **Fix:** `useMLProductMargins` migrado para a RPC `get_margin_with_ads_by_product` (mesma RPC criada em 48-01, que agrega server-side sem LIMIT). O hook agora retorna margem correta para todos os produtos com pedidos no período.
- **Files modified:** `src/pages/mercadolivre/MLAnuncios.tsx`
- **Committed in:** `33addf43` (fix checkpoint)

---

**Total deviations:** 3 auto-fixed (1 bug DRE, 1 missing critical UX, 1 bug truncamento)
**Impact on plan:** Todos os fixes foram necessários para corretude e qualidade. O desvio mais relevante (Pitfall 7 — DRE) surgiu de uma interação não modelada no plano entre a nova prop `adsTotalMes` e o `groupBillingCharges` existente. Sem o fix, o gasto de ads apareceria duplicado no DRE para todos os meses com fonte billing.

## Issues Encountered

- **Pitfall 7 mais profundo que o plano descrevia:** o plano documentava "guarda `dreFonte !== 'estimado'`" como suficiente para evitar duplicação, mas não modelava que `groupBillingCharges` já retorna PADS como grupo separado no billing real — não apenas no estimado. O fix eliminou a linha DRE extra completamente, mantendo MCO-03 via a própria lógica de billing.
- **SKUs sem CMV (ex.: Camiseta Txc 19742 — 6 variações `CTXCB19742*`):** itens sem custo cadastrado em `/precificacao` aparecem com Mg. Op. e Mg. Pós-Ads como "—" (ausência de dado de custo, não de pedidos). Isso é pendência de DADO, não de código. Cadastrar custo em `/precificacao` resolve.

## Known Stubs

Nenhum. Todas as superfícies consomem dados reais via RPC com dados reais do banco `ckcdevcxgvueywivefgx`.

## Threat Flags

Nenhuma nova superfície de segurança além das já modeladas no `<threat_model>` do plano:
- `useMLMarginWithAds` usa `currentOrg.id` + `resolvedMLUserIds` para escopar a RPC (T-48-03-01 mitigado)
- Sem dados cross-org no cliente (T-48-03-03 accept — `resolvedMLUserIds` consolida lojas da org)

## Validação

Checkpoint visual aprovado por Wesley no preview Vercel (dados reais `ckcdevcxgvueywivefgx`) após 3 rounds de fix:
1. Round 1: removida duplicidade de ads no DRE
2. Round 2: "—" + tooltip para itens sem venda
3. Round 3: fix truncamento useMLProductMargins via RPC

## Next Phase Readiness

- MCO-02 (margem por produto pós-ads em /anuncios) e MCO-03 (MCO agregado no DRE) satisfeitos e validados
- Phase 48 completa (48-01 + 48-02 + 48-03 — 3/3 planos com SUMMARY)
- Próximo: Phase 46 (UX para Leigos) ou Phase 47 (QA End-to-End + Go-Live) conforme prioridade Wesley

---
*Phase: 48-mco-com-ads*
*Completed: 2026-06-14*
