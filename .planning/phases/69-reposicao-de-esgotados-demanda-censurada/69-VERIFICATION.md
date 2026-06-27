---
phase: 69-reposicao-de-esgotados-demanda-censurada
verified: 2026-06-27T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Abrir /compras com Wesley logado e confirmar que SKUs repor_esgotado exibem o badge 'estoque zerado · demanda estimada pelo histórico (X.X/d)' na coluna 'O que fazer'"
    expected: "Badge âmbar visível; venda/dia exibido é a estimativa do melhor ritmo (não zero); coluna 'O que fazer' mostra '🔴 Repor N'"
    why_human: "Renderização React no browser — grep confirma o código mas não a renderização DOM real"
  - test: "No filtro 'Situação' da /compras, selecionar cada uma das 3 novas opções: '🔴 Repor esgotado', '⚠️ Revisar parado', '⚫ Descontinuar?' e verificar que a tabela filtra corretamente"
    expected: "Cada filtro mostra apenas os SKUs do balde correspondente; contadores no mini-resumo batem (29 repor, 59 revisar, 13 descontinuar nos dados de hoje da Pé Vermeio)"
    why_human: "Interação com UI — applyFilters e statusCounts foram verificados no código mas o fluxo visual requer o browser"
---

# Phase 69: Reposição de esgotados (demanda censurada) Verification Report

**Phase Goal:** SKUs esgotados (estoque 0) que não venderam nos últimos 30d ficam com `venda_dia=0` → `compra_sugerida=0` e somem da lista de compra, mesmo com demanda real. A `/compras` passa a tratar esses casos com um esquema híbrido por recência, estimando a demanda pelo melhor ritmo histórico em vez de descartar o SKU.
**Verified:** 2026-06-27
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SKUs esgotados que venderam ≤90d voltam com `compra_sugerida>0`, venda/dia pelo melhor ritmo histórico | ✓ VERIFIED | SQL: LATERAL `vbeff` injeta `best_rate` (ou fallback conservador 90d) para `repor_esgotado`. Prod: 29 SKUs resgatados, 27 com compra>0, 100% `venda_dia_origem='historico_esgotado'`, +232 un / R$21.219 antes invisíveis |
| 2 | SKUs 90–365d aparecem como `revisar_esgotado`, sem quantidade sugerida | ✓ VERIFIED | SQL: `esg` LATERAL classifica 91–365d como `revisar_esgotado`; `vbeff` LATERAL não injeta taxa (fallback `avg_simples=0`) → `compra=0` estruturalmente. Prod: 59 SKUs, compra 0 |
| 3 | SKUs sem venda há +1 ano marcados `descontinuar`, fora do total de compra | ✓ VERIFIED | SQL: `ultima_venda IS NULL OR dias_desde_ultima_venda > 365` → `descontinuar`; `calc` CTE: `WHEN b.venda_base = 0 THEN 0`. Prod: 13 SKUs, compra 0. Validação cross-org `count(*) WHERE status_esgotado IN ('revisar_esgotado','descontinuar') AND compra_sugerida>0` = 0 |
| 4 | A tela `/compras` distingue visualmente demanda estimada de real (badge) | ✓ VERIFIED (código) | `AcaoCell` em `ReplenishmentSkuTable.tsx`: `isDemandaEstimada(row.venda_dia_origem)` → Badge âmbar `"estoque zerado · demanda estimada pelo histórico (X/d)"`. `MasterAcaoCell`: badge agrupado. `applyFilters` trata `repor_esgotado`/`revisar_esgotado`/`descontinuar`. `ReplenishmentSkuFilters` tem 3 novos `SelectItem`. Badge derivado da RPC (não heurística client-side — T-69-05). Requer confirmação visual no browser (ver Human Verification) |
| 5 | RPC SECURITY INVOKER; espelho TS (classificação + estimativa, 22 testes); sem regressão | ✓ VERIFIED | Migration linha 60: `SECURITY INVOKER`. Anti-IDOR prod: user Thales lendo Pé Vermeio → 0 linhas. TS: `classifyStatusEsgotado` (12 testes ESGOT-01) + `estimateBestRate` (6 testes ESGOT-02) + `isDemandaEstimada` (4 testes ESGOT-03) = 22 novos. `VendaDiaOrigem` inclui `'historico_esgotado'`. `StatusEsgotado` type exportado. `types.ts`: `status_esgotado: string` em Returns, `p_smart?: boolean` em Args. SUMMARY: tsc 0 / 278/278 vitest / build 16.90s |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260669000000_get_replenishment_by_sku_esgotados.sql` | Migration com 4 novas CTEs, 6 constantes, `status_esgotado` (36ª col) | ✓ VERIFIED | 389 linhas; SECURITY INVOKER confirmado; 4 CTEs: `sales_history_by_sku`, `daily_qty_180d`, `window_sums_30d`, `best_rate_by_sku`; 6 constantes no DECLARE; `REVOKE/GRANT` com assinatura 4-arg; aplicada em prod via MCP |
| `src/lib/analysis/replenishmentUtils.ts` | `StatusEsgotado`, constantes, 3 funções puras, `VendaDiaOrigem+='historico_esgotado'` | ✓ VERIFIED | Linhas 169–596: `VendaDiaOrigem` inclui `'historico_esgotado'`; `StatusEsgotado` type; 6 constantes `RECENCY_*`/`BEST_*`; `classifyStatusEsgotado`, `estimateBestRate`, `isDemandaEstimada` implementados |
| `src/lib/analysis/replenishmentUtils.test.ts` | 22 novos testes ESGOT-01/02/03 | ✓ VERIFIED | 12 testes `classifyStatusEsgotado` + 6 `estimateBestRate` + 4 `isDemandaEstimada` = 22 (linhas 607–759); funções importadas e chamadas |
| `src/integrations/supabase/types.ts` | `status_esgotado: string` em Returns; `p_smart?: boolean` em Args | ✓ VERIFIED | Linha 2081: `p_smart?: boolean`; linha 2107: `status_esgotado: string` |
| `src/hooks/useReplenishmentBySku.ts` | `status_esgotado: StatusEsgotado` em `ReplenishmentSkuRow`; `mapRow` com fallback `'com_giro'` | ✓ VERIFIED | Linha 65: `status_esgotado: StatusEsgotado`; linha 159: `((r.status_esgotado as string) ?? "com_giro") as StatusEsgotado`; importa `StatusEsgotado` de `replenishmentUtils` |
| `src/components/mercadolivre/ReplenishmentSkuTable.tsx` | `AcaoCell` com 3 estados esgotados + badge `isDemandaEstimada`; `MasterAcaoCell` com estado agregado | ✓ VERIFIED | Linhas 132–194: `AcaoCell` classifica esgotados PRIMEIRO (`descontinuar`/`revisar_esgotado`/`repor_esgotado`) antes da lógica `com_giro`; badge condicional em `isDemandaEstimada(row.venda_dia_origem)`. Linhas 198–267: `MasterAcaoCell` com prioridade `repor>revisar>descontinuar`. Importa `isDemandaEstimada` |
| `src/components/mercadolivre/ReplenishmentSkuFilters.tsx` | `FilterStatus` com 3 novos valores; 3 `SelectItem` novos | ✓ VERIFIED | Linha 14–20: `FilterStatus` union inclui `repor_esgotado`/`revisar_esgotado`/`descontinuar`. Linhas 93–95: 3 `SelectItem` correspondentes |
| `src/pages/mercadolivre/MLCompras.tsx` | `applyFilters` trata os 3 novos valores; `statusCounts` inclui `reporEsgotado`/`revisarEsgotado`/`descontinuar` | ✓ VERIFIED | Linhas 37–41: `applyFilters` filtra por `status_esgotado` para os 3 novos valores. Linhas 154–160: `statusCounts` mapeia os 4 baldes. `regroupRows` inclui `total_a_caminho` (bug pré-existente corrigido em 3ee8f52e) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ReplenishmentSkuTable.tsx` | `replenishmentUtils.ts` | `import { isDemandaEstimada }` (linha 28) | ✓ WIRED | Badge usa `isDemandaEstimada(row.venda_dia_origem)` — fonte de verdade é a RPC, não heurística |
| `useReplenishmentBySku.ts` | `replenishmentUtils.ts` | `import type { VendaDiaOrigem, LeadTimeOrigem, StatusEsgotado }` (linha 4) | ✓ WIRED | Tipos da RPC mapeados via `mapRow` |
| `MLCompras.tsx` | `useReplenishmentBySku.ts` | `const { data } = useReplenishmentBySku(30, 1.0, smartMode)` (linha 128) | ✓ WIRED | `p_smart` propagado; `status_esgotado` disponível nos rows |
| `MLCompras.tsx` | `ReplenishmentSkuFilters.tsx` | `filterStatus: FilterStatus` prop + `applyFilters` (linhas 37–41) | ✓ WIRED | `applyFilters` trata os 3 novos valores de `FilterStatus` |
| Migration SQL | Prod Supabase `ckcdevcxgvueywivefgx` | `apply_migration` MCP (checkpoint 69-01 aprovado) | ✓ WIRED | Migration aplicada em prod; 5/5 validações PASS; timing 2,1s < 8s |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `ReplenishmentSkuTable.tsx` | `row.status_esgotado` | RPC `get_replenishment_by_sku` → `mapRow` | Sim (4 baldes reais em prod) | ✓ FLOWING |
| `ReplenishmentSkuTable.tsx` | `row.venda_dia_origem` | RPC coluna 36 → `mapRow` linha 150 | Sim (`'historico_esgotado'` para 27 SKUs em prod) | ✓ FLOWING |
| `ReplenishmentSkuTable.tsx` | `row.compra_sugerida` | Calculado na RPC via `venda_base_eff` | Sim (27 compras com valor > 0) | ✓ FLOWING |
| `MLCompras.tsx` | `statusCounts.reporEsgotado` | `filteredRows.filter(r => r.status_esgotado === 'repor_esgotado').length` | Sim (derivado de dados reais) | ✓ FLOWING |

### Behavioral Spot-Checks

Não executados (requerem banco em prod e browser). Substituídos pela prova em prod do checkpoint 69-01 (5/5 validações via `execute_sql` no projeto `ckcdevcxgvueywivefgx`):

| Behavior | Validação em prod | Result | Status |
|----------|-------------------|--------|--------|
| 4 baldes distintos | `SELECT status_esgotado, count(*) FROM get_replenishment_by_sku(org) GROUP BY 1` | com_giro 192, repor_esgotado 29, revisar_esgotado 59, descontinuar 13 | ✓ PASS |
| Resgate repor_esgotado | `SELECT count(*) FILTER (WHERE compra_sugerida>0)` WHERE status='repor_esgotado' | 27 com compra, 100% `venda_dia_origem='historico_esgotado'`, +232 un | ✓ PASS |
| revisar+descontinuar fora da compra | `count(*) WHERE status IN (...) AND compra_sugerida>0` | 0 | ✓ PASS |
| Anti-IDOR cross-org | SET LOCAL ROLE authenticated; outra org lendo Pé Vermeio | 0 linhas | ✓ PASS |
| SECURITY INVOKER | `pg_get_functiondef … LIKE '%SECURITY INVOKER%'` | `prosecdef=false` (INVOKER confirmado) | ✓ PASS |
| Performance | Execution time sob role `authenticated` | 2,114s < 8s (statement_timeout) | ✓ PASS |
| Regressão com_giro | Baseline pré-Phase 69 vs pós | 87 compras / 1003 un / R$126.815 = idêntico | ✓ PASS |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|------------|-------------|--------|----------|
| ESGOT-01 | Classificação por recência: `repor_esgotado` ≤90d / `revisar_esgotado` 90–365d / `descontinuar` >365d, parametrizável | ✓ SATISFIED | SQL: 4 baldes via `esg` LATERAL + 6 constantes no DECLARE. TS: `classifyStatusEsgotado` + constantes exportadas. 12 testes unitários |
| ESGOT-02 | Estimativa = melhor janela 30d/180d ÷ 30; anti-pico ≥2 dias; reusa ponto/alvo/MOQ/pack/a-caminho | ✓ SATISFIED | SQL: CTEs `daily_qty_180d`, `window_sums_30d`, `best_rate_by_sku`; fallback conservador `soma_90d/90`; `vbeff` LATERAL reusa calc CTE existente. TS: `estimateBestRate` com 6 testes unitários |
| ESGOT-03 | Transparência: `status_esgotado` + `venda_dia_origem='historico_esgotado'` na RPC; badge + filtro na tela | ✓ SATISFIED | SQL: 36ª coluna `status_esgotado` + CASE `venda_dia_origem`. Frontend: `AcaoCell` badge âmbar, `MasterAcaoCell` estado agregado, `FilterStatus` 3 novos valores, `applyFilters` e `statusCounts` |
| ESGOT-04 | RPC SECURITY INVOKER anti-IDOR; espelho TS + testes; sem regressão 62–68 | ✓ SATISFIED | Migration: `SECURITY INVOKER` linha 60 + REVOKE/GRANT 4-arg. Prod: anti-IDOR 0 linhas. TS: `StatusEsgotado`, `VendaDiaOrigem+='historico_esgotado'`, 22 testes. Regressão: `com_giro` idêntico ao baseline |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | Nenhum | — | Sem TBD/FIXME/XXX/placeholder nas 7 fontes modificadas; zero retornos `null`/`{}`/`[]` hardcoded nos caminhos de dado |

Verificação específica de stubs: `isDemandaEstimada` é função pura não-stub (`return vendaDiaOrigem === "historico_esgotado"`). Badge condicionado a dado real da RPC (não mock). Filtro condicionado a `status_esgotado` real. `mapRow` tem fallback seguro `"com_giro"` (valor real, não placeholder). Nenhuma função existente teve assinatura alterada.

### Human Verification Required

#### 1. Badge visual em SKU repor_esgotado

**Test:** Logar como Wesley em prod → acessar `/compras` → identificar qualquer SKU marcado `🔴 Repor (esgotado)` na coluna "O que fazer" → confirmar que o badge âmbar "estoque zerado · demanda estimada pelo histórico (X.X/d)" aparece abaixo do texto de ação, com o valor venda/dia correto
**Expected:** Badge âmbar visível; `venda_dia` exibido é estimativa positiva (não zero); coluna mostra quantidade `compra_sugerida > 0`
**Why human:** Renderização React DOM em browser real — grep confirma o código JSX presente e condicionado corretamente, mas não a renderização visual nem o valor numérico estimado exibido

#### 2. Filtro Situação com os 3 novos valores

**Test:** Na /compras, clicar no filtro "Situação" → selecionar cada um dos 3 novos valores em sequência: "🔴 Repor esgotado", "⚠️ Revisar parado", "⚫ Descontinuar?" → observar a tabela filtrar e o contador atualizar
**Expected:** Cada seleção filtra corretamente; contadores no mini-resumo mostram aproximadamente 29 / 59 / 13 SKUs (dados Pé Vermeio hoje); ao selecionar "⚠️ Revisar parado" e "⚫ Descontinuar?" a coluna "Comprar" mostra 0 para todas as linhas
**Why human:** Fluxo de interação UI (React state + re-render) — `applyFilters` e `statusCounts` foram verificados no código, mas a sequência de estado no browser requer teste manual

### Gaps Summary

Nenhum gap identificado. Todos os 5 Success Criteria têm evidência completa em código + evidência em produção para os comportamentos de backend. As 2 verificações humanas são complementares (visual/UX), não blockers do goal principal.

**Desvio corrigido durante a phase:** `regroupRows` em `MLCompras.tsx` não incluía `total_a_caminho` (bug pré-existente); corrigido em commit `3ee8f52e` como parte da Phase 69-02.

---

_Verified: 2026-06-27_
_Verifier: Claude (gsd-verifier)_
