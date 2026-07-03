---
phase: 83-produtos-vendidos-mco-redesign
plan: 01
subsystem: backend
tags: [supabase, rpc, postgres, vitest, mco, produtos-vendidos]

# Dependency graph
requires:
  - phase: 79-82-analise-de-precos
    provides: "RPC get_margin_with_ads_by_product (base sem marca), padrão de agregação client-side de soldProductsAgg.ts"
provides:
  - "Migration escrita (não aplicada) que adiciona coluna marca à RPC get_margin_with_ads_by_product"
  - "Helper puro mcoHealth.ts (MCO_SAUDAVEL_PCT, classifyMcoHealth, mcoHealthRole) — semáforo centralizado"
  - "Módulo puro soldProductsMcoAgg.ts (aggregateMcoGroups, aggregateMcoItems) — agregação pós-ads por marca/categoria e por anúncio, com campos de tooltip"
affects: [83-02-deploy-migration, 83-03-ui-produtos-vendidos]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Módulos puros (zero React/Supabase) para lógica testável isolada de RPC/UI, seguindo o padrão de soldProductsAgg.ts"
    - "Semáforo de saúde centralizado numa constante única (MCO_SAUDAVEL_PCT) reutilizável por grupo e por item"

key-files:
  created:
    - supabase/migrations/20260683000000_margin_with_ads_marca.sql
    - src/lib/mcoHealth.ts
    - src/lib/mcoHealth.test.ts
    - src/components/mercadolivre/anuncios/soldProductsMcoAgg.ts
    - src/components/mercadolivre/anuncios/soldProductsMcoAgg.test.ts
  modified: []

key-decisions:
  - "Migration usa DROP FUNCTION + CREATE (não CREATE OR REPLACE) porque a RETURNS TABLE ganha a coluna marca — Postgres recusa OR REPLACE quando o tipo de retorno muda"
  - "marca adicionada como ÚLTIMA coluna da RETURNS TABLE para preservar retrocompatibilidade com useMLMarginWithAds.ts (mapeia por nome de coluna, não por posição)"
  - "mcoPct do GRUPO = Σlucro_pos_ads ÷ Σreceita × 100 (agregado pós-ads), NUNCA a média simples dos mcoPct dos itens — consistente com o painel direito (decisão LOCKED do CONTEXT)"
  - "has_cmv=false → health='indefinido' (nunca zerado/inventado); mcoPct do item ainda é repassado fielmente de lucro_pct_pos_ads, cabendo à UI (83-03) decidir exibir '—' quando hasCmv=false"

patterns-established:
  - "Fonte única de campos de tooltip (cmv, comissao, frete, impostos, adsSpend, mcoReais) no item agregado — 83-03 não recalcula, só renderiza"

requirements-completed: ["MCO-PV-RPC", "MCO-PV-LOGIC"]

# Metrics
duration: 6min
completed: 2026-07-03
status: complete
---

# Phase 83 Plan 01: Fundação MCO em Produtos Vendidos Summary

**Migration (não aplicada) que adiciona `marca` à RPC `get_margin_with_ads_by_product`, helper puro de semáforo MCO% (`mcoHealth.ts`) e módulo de agregação pós-ads por marca/categoria e por anúncio (`soldProductsMcoAgg.ts`), com 33 testes vitest cobrindo bordas e fórmulas.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-03T12:26:06Z
- **Completed:** 2026-07-03T12:29:53Z
- **Tasks:** 3 (Task 2 e 3 em TDD: RED → GREEN)
- **Files modified:** 5 (1 migration + 4 arquivos TS/test)

## Accomplishments
- Migration `20260683000000_margin_with_ads_marca.sql` escrita: DROP FUNCTION + CREATE de `get_margin_with_ads_by_product`, adicionando `marca TEXT` como última coluna da RETURNS TABLE, `MAX(o.marca) AS marca` no CTE `orders_side` e `o.marca AS marca` na projeção final. Diff contra a migration original confirmado como exatamente 3 pontos de mudança (+ comentários de deploy/smoke).
- `src/lib/mcoHealth.ts`: `MCO_SAUDAVEL_PCT` (red=5, green=9), `classifyMcoHealth` (vermelho ≤5, amarelo 5<x<9, verde ≥9, indefinido null/undefined) e `mcoHealthRole` (mapeamento para role de cor CVD-safe). 14 testes vitest cobrindo todas as bordas exatas (5, 6, 8.9, 9, null, undefined).
- `src/components/mercadolivre/anuncios/soldProductsMcoAgg.ts`: `aggregateMcoGroups` (agrupamento por marca/categoria, mcoPct pós-ads agregado, redCount, hasMissingCost) e `aggregateMcoItems` (mcoPct, acosPct, health, shareOfGroup e os 6 campos de tooltip). 19 testes vitest, incluindo o caso do plano (grupo com receita 100/lucro 3 + receita 200/lucro 30 → mcoPct grupo = 11%, redCount = 1).

## Task Commits

Cada task foi commitada atomicamente (Task 2 e 3 em TDD: test → feat):

1. **Task 1: Migration — coluna marca na RPC** - `53acb910` (feat)
2. **Task 2: mcoHealth.ts (RED)** - `87900a47` (test)
3. **Task 2: mcoHealth.ts (GREEN)** - `472258c0` (feat)
4. **Task 3: soldProductsMcoAgg.ts (RED)** - `505ce680` (test)
5. **Task 3: soldProductsMcoAgg.ts (GREEN)** - `1a63a825` (feat)

**Plan metadata:** (a ser commitado nesta etapa)

## Files Created/Modified
- `supabase/migrations/20260683000000_margin_with_ads_marca.sql` - DROP+CREATE de get_margin_with_ads_by_product com coluna marca (não aplicada em prod — 83-02)
- `src/lib/mcoHealth.ts` - Constante MCO_SAUDAVEL_PCT + classifyMcoHealth + mcoHealthRole
- `src/lib/mcoHealth.test.ts` - 14 testes cobrindo bordas do semáforo
- `src/components/mercadolivre/anuncios/soldProductsMcoAgg.ts` - aggregateMcoGroups + aggregateMcoItems
- `src/components/mercadolivre/anuncios/soldProductsMcoAgg.test.ts` - 19 testes cobrindo agregação, fórmula pós-ads e tooltip

## Decisions Made
- DROP FUNCTION + CREATE em vez de CREATE OR REPLACE, pois a RETURNS TABLE muda de forma.
- `marca` no fim da RETURNS TABLE para não quebrar o mapeamento por nome de `useMLMarginWithAds.ts`.
- mcoPct do grupo é a razão de somas (Σlucro_pos_ads/Σreceita), não a média dos percentuais individuais — evita distorção quando anúncios têm receitas muito diferentes.
- `health` do item usa `has_cmv` como guarda antes de `classifyMcoHealth`, garantindo que "custo ausente" nunca vire falso vermelho/verde.

## Deviations from Plan

None - plano executado exatamente como escrito.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. A migration escrita NÃO foi aplicada em prod (isso é o plano 83-02, via MCP `apply_migration`, orquestrado separadamente).

## Next Phase Readiness
- 83-02 pode aplicar a migration em prod e rodar o smoke test (retrocompat de `useMLMarginWithAds.ts` + reconciliação de receita + anti-IDOR), conforme documentado no cabeçalho do arquivo de migration.
- 83-03 (UI) pode consumir `aggregateMcoGroups`/`aggregateMcoItems` e `classifyMcoHealth`/`mcoHealthRole` diretamente — toda a lógica determinística já está provada por testes; a UI só precisa renderizar e mapear `McoColorRole` em tokens/hex CVD-safe (skill dataviz).
- Nenhum bloqueio identificado.

## Verification Results
- `npx tsc --noEmit`: sem erros.
- `npx vitest run src/lib/mcoHealth.test.ts src/components/mercadolivre/anuncios/soldProductsMcoAgg.test.ts src/lib/mco.test.ts src/components/mercadolivre/anuncios/soldProductsAgg.test.ts`: 46/46 testes passando (14 + 19 + 4 + 9), incluindo as suítes preexistentes que não foram alteradas (nenhuma regressão).

---
*Phase: 83-produtos-vendidos-mco-redesign*
*Completed: 2026-07-03*

## Self-Check: PASSED

Todos os 6 arquivos criados verificados no filesystem; todos os 5 commits de task verificados em `git log`.
