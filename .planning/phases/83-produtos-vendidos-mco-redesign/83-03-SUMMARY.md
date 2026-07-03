---
phase: 83-produtos-vendidos-mco-redesign
plan: 03
subsystem: ui
tags: [react, typescript, tanstack-query, mco, tailwind, dataviz]

# Dependency graph
requires:
  - phase: 83-produtos-vendidos-mco-redesign
    provides: "83-01 mcoHealth.ts (classifyMcoHealth/mcoHealthRole/MCO_SAUDAVEL_PCT) + soldProductsMcoAgg.ts (aggregateMcoGroups/aggregateMcoItems); 83-02 migration marca em get_margin_with_ads_by_product (deployada em prod)"
provides:
  - "Página /produtos-vendidos consumindo get_margin_with_ads_by_product (via useMLMarginWithAds) em vez de orders_sold_products_agg"
  - "Coluna MCO% com semáforo CVD-safe + rótulo sempre visível + tooltip de quebra de custos"
  - "Coluna % Ads (ACoS) por anúncio"
  - "Tabela ordenável por qualquer coluna (qty/revenue/mcoPct/acosPct/estoque/share)"
  - "Painel esquerdo (marcas/categorias) com MCO% agregado por grupo"
  - "Cabeçalho-resumo do grupo: Receita total · MCO% médio · nº de anúncios no vermelho"
  - "Cards mobile com as mesmas métricas"
affects: [83-produtos-vendidos-mco-redesign]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Semáforo MCO% reutiliza classifyMcoHealth/mcoHealthRole (83-01) mapeado para tokens Tailwind do projeto (bg-success/text-success, bg-warning/text-warning, bg-destructive/text-destructive, bg-muted-foreground/40 para 'indefinido')"
    - "Tabela ordenável client-side: estado sortKey/sortDir local, comparador que empurra valores null (MCO%/ACoS indefinidos, estoque ausente) para o fim independentemente da direção"
    - "Tooltip de quebra de custos consome diretamente os campos já agregados de PvMcoItem (mcoReais/adsSpend/comissao/frete/impostos) — zero recálculo na UI"

key-files:
  created: []
  modified:
    - src/hooks/useMLMarginWithAds.ts
    - src/pages/mercadolivre/MLProdutosVendidos.tsx

key-decisions:
  - "Tooltip do MCO% sempre mostra a quebra de custos (mesmo quando has_cmv=false), mas antecede com aviso 'Sem custo cadastrado — MCO indefinido' quando aplicável — não omite os campos conhecidos (ads/comissão/frete/impostos), só deixa claro que o CMV está ausente"
  - "% Ads (ACoS) renderizado sem destaque de cor extra (item opcional do plano) — mantém a página focada no semáforo de MCO como sinal primário; pode ser adicionado depois se Wesley pedir no checkpoint"
  - "Colunas ordenáveis restritas às 6 numéricas (Qtd/Receita/MCO%/%Ads/Estoque/%Grupo); 'Anúncio' (título) não é ordenável, conforme enum sortKey do plano"

patterns-established:
  - "Bolinha de cor + rótulo % sempre visível ao lado (cor nunca é sinal único) — padrão a repetir em qualquer nova exibição de MCO% na plataforma"

requirements-completed: ["MCO-PV-UI"]

# Metrics
duration: ~35min
completed: 2026-07-03
status: blocked
---

# Phase 83 Plan 03: Produtos Vendidos com MCO (UI) — Summary

**Página /produtos-vendidos reescrita para consumir get_margin_with_ads_by_product com coluna MCO% (semáforo CVD-safe), % Ads, tabela ordenável e cabeçalho-resumo por marca — aguardando checkpoint visual de Wesley (Task 3, bloqueante).**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-03T12:20:00Z (aprox.)
- **Completed (tasks automatizadas):** 2026-07-03T12:55:00Z (aprox.)
- **Tasks:** 2/3 concluídas (Task 3 é checkpoint bloqueante, pendente aprovação de Wesley)
- **Files modified:** 2

## Accomplishments
- `useMLMarginWithAds` agora expõe `marca: string | null`, retrocompatível com os 3 consumidores existentes (MLAnuncios.tsx, ListingDetailModal.tsx, ListingIndicatorsTab.tsx)
- `/produtos-vendidos` trocou completamente de fonte de dados: `useMLMarginWithAds(currentFrom, currentTo)` no lugar de `useMLSoldProducts`/`orders_sold_products_agg`, filtrando `unidades > 0`
- Painel direito com 7 colunas (Anúncio · Qtd · Receita · MCO% · % Ads · Estoque · % Grupo), MCO% com semáforo + rótulo + tooltip de quebra de custos, tabela ordenável por qualquer coluna numérica com indicador visual da coluna ativa
- Painel esquerdo (marcas/categorias) com MCO% agregado do grupo (bolinha de cor ao lado da receita) via `aggregateMcoGroups`
- Cabeçalho-resumo ao selecionar um grupo: Receita total · MCO% médio · nº de anúncios no vermelho (destacado em vermelho quando > 0) · aviso quando o grupo tem algum anúncio sem custo cadastrado
- Cards mobile com as mesmas métricas (MCO% + % Ads)
- `npx tsc --noEmit`, `npm run build` e `npx vitest run` (suíte inteira, 407/407) verdes, sem regressão

## Task Commits

Each task was committed atomically:

1. **Task 1: Expor marca no hook useMLMarginWithAds** - `81bfb80c` (feat)
2. **Task 2: Reescrever MLProdutosVendidos.tsx com MCO, semáforo, %Ads, tabela ordenável e cabeçalho-resumo** - `bccfe142` (feat)
3. **Task 3 [BLOCKING]: Checkpoint visual do Wesley (light + dark)** - **PENDENTE** (não iniciada; aguarda validação humana)

**Plan metadata:** commit deste SUMMARY (a seguir)

## Files Created/Modified
- `src/hooks/useMLMarginWithAds.ts` - Adiciona `marca: string | null` à interface `ProductMarginWithAds` e ao mapper
- `src/pages/mercadolivre/MLProdutosVendidos.tsx` - Reescrita completa: fonte `useMLMarginWithAds`, agregação `aggregateMcoGroups`/`aggregateMcoItems`, semáforo MCO%, coluna % Ads, tabela ordenável, cabeçalho-resumo do grupo, cards mobile

## Decisions Made
- Tooltip do MCO% sempre exibe a quebra de custos consumindo os campos já agregados (`mcoReais`, `adsSpend`, `comissao`, `frete`, `impostos`) do item — nunca recalcula na UI. Quando `hasCmv=false`, antecede com aviso "Sem custo cadastrado — MCO indefinido" em vez de omitir a quebra.
- Mapeamento de cor: `McoColorRole` (`good`/`warning`/`critical`/`neutral`) → tokens Tailwind do projeto (`bg-success`/`text-success`, `bg-warning`/`text-warning`, `bg-destructive`/`text-destructive`, `bg-muted-foreground/40`/`text-muted-foreground` para indefinido) — reutiliza tokens já validados em light/dark por phases anteriores (79-82), sem inventar paleta nova.
- % Ads não recebeu destaque de cor extra (item explicitamente opcional do plano) para manter o semáforo de MCO% como sinal visual primário da página.

## Deviations from Plan

None - plan executado conforme especificado (Tasks 1 e 2). Task 3 é checkpoint bloqueante e está corretamente pendente, não é um desvio.

## Issues Encountered

None.

## User Setup Required

None - nenhuma configuração externa necessária. A migration da coluna `marca` já foi aplicada e validada em produção no 83-02 (fora do escopo desta plan).

## Next Phase Readiness

**BLOQUEADO em Task 3 (checkpoint visual do Wesley).** Antes de liberar merge/PR:

1. Abrir `/produtos-vendidos` em preview/produção logado como Pé Vermeio.
2. Validar em tema CLARO e ESCURO: as 3 cores do semáforo (🔴≤5% / 🟡6–8% / 🟢≥9%) são distinguíveis e legíveis; o rótulo % está sempre visível ao lado da bolinha.
3. Selecionar uma marca e conferir o cabeçalho-resumo (Receita total, MCO% médio, nº de anúncios no vermelho).
4. Ordenar por MCO% (asc) e confirmar que aparecem os "micos" (vende bem, MCO baixo); testar ordenação em % Ads, Receita, Qtd, Estoque, % Grupo — indicador da coluna ativa deve aparecer.
5. Confirmar que um anúncio sem custo mostra "—" no MCO% + aviso, nunca 0%.
6. Confirmar que o hover no MCO% mostra a quebra (MCO R$, Ads, Comissão, Frete, Imposto).
7. Conferir mobile: cards mostram MCO% (com cor) e % Ads.
8. (Esperado, não é bug) números de Receita/Qtd podem mudar levemente vs. a versão anterior — critério de vendas passou de só `paid` para `paid+shipped+delivered`.

Se Wesley pedir ajustes de paleta, rodar o validador da skill `dataviz` nas cores usadas antes de ajustar. Só após "aprovado" (ou ajustes aplicados e reaprovados) o plano pode ser marcado `status: complete` e seguir para merge/PR.

---
*Phase: 83-produtos-vendidos-mco-redesign*
*Plan 03 — Tasks 1-2 completas, Task 3 pendente checkpoint visual*

## Self-Check: PASSED

- FOUND: src/hooks/useMLMarginWithAds.ts
- FOUND: src/pages/mercadolivre/MLProdutosVendidos.tsx
- FOUND commit: 81bfb80c
- FOUND commit: bccfe142
