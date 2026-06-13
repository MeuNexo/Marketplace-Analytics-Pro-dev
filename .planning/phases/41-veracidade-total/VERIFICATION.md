---
phase: 41-veracidade-total
verified: 2026-06-13T00:00:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 2
overrides:
  - must_have: "Comissao em /anuncios vem da API ML (sale_fee/listing_prices) — LISTING_TYPE_RATES removido"
    reason: "Comissao real via commCache/listing_prices e a fonte primaria (cache-first em todos os call sites, populado para todos os itens filtrados). LISTING_TYPE_RATES preservado deliberadamente APENAS como fallback transitorio (itens ainda nao no cache) e por dependencia de funcoes mock de graficos em financialMockData.ts — remocao total e cleanup da Phase 46, documentado no 41-03-PLAN (Pitfall 4) e aprovado por Wesley no checkpoint blocking."
    accepted_by: "Wesley (checkpoint human-verify 41-03)"
    accepted_at: "2026-06-12"
  - must_have: "KPIs de /vendas, /financeiro e /anuncios batem entre si e com referencia Nexo Abril/2026 (comissao R$39,2k, CFFE R$40k, CFONPN R$15,9k)"
    reason: "Consistencia entre paginas VERIFICADA (mesma RPC get_cost_waterfall por construcao). CFFE abril R$40.065,33 EXATO; CFONPN abril R$15.902,70 EXATO; comissao % bate (11,14% vs 11,15%). Unica divergencia: comissao absoluta abril (garment R$34.484 vs Nexo R$39.170, ~R$4.686) — diferenca de BASE de orders, nao de tarifa. Aceito por Wesley como 'Aprovado com ressalva' no checkpoint blocking; investigacao registrada em Open Items para Phase 47/QA (41-03-SUMMARY)."
    accepted_by: "Wesley (checkpoint human-verify 41-03, 'Aprovado com ressalva')"
    accepted_at: "2026-06-12"
deferred:
  - truth: "Comissao absoluta de abril identica a referencia Nexo (R$39.170)"
    addressed_in: "Phase 47"
    evidence: "41-03-SUMMARY Open Items: 'Investigacao fica para a Phase 47/QA'; Phase 47 goal = QA End-to-End antes do go-live"
  - truth: "LISTING_TYPE_RATES removido do codebase"
    addressed_in: "Phase 46"
    evidence: "41-03-PLAN: 'cleanup e Phase 46'; objeto ainda usado por getFinancialDailyStats/getListingTypeBreakdown em financialMockData.ts (mocks sao escopo das Phases 42/46)"
---

# Phase 41: Veracidade Total — Verification Report

**Phase Goal:** Usuarios veem KPIs financeiros corretos em /vendas, /financeiro e /anuncios — sem calculos hardcoded, com billing real e fonte unica consistente
**Verified:** 2026-06-13
**Status:** passed (com 2 deviations aceitas por Wesley em checkpoints blocking)
**Re-verification:** No — initial verification

## Inputs taken as given (validated by orchestrator/Wesley nesta sessao)

- EF `sync-ml-billing` deployada como v4/version-5 ACTIVE em ckcdevcxgvueywivefgx
- `ml_billing_monthly` em producao com 4 meses (2026-03..2026-06) incluindo bonuses; jun cancelamentos = -674,87; jun CFONPN = 3.008,28 (bate com print Wesley)
- `npm run build` passa; `npx vitest run` 63/63 verde

## Goal Achievement

### Observable Truths (roadmap SCs + plan must-haves mesclados)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Card Custos exibe CMV e Impostos nao-nulos quando ha config (DATA-01) | VERIFIED | `useMLCostWaterfall.ts` retorna `total_tax`/`has_tax_data` (l.20-22, 66-67); RPC `get_cost_waterfall` (migration 20260612120000, commit fc090c46); DRE renderiza `cmvMes`/`impostosMes` com fallback "s/ custo"/"s/ config" (`MLCostCard.tsx` l.176-221); Wesley aprovou visual (41-01 checkpoint) |
| 2 | Filtro "Hoje" carrega via auto-recalc silencioso com skeleton (DATA-02) | VERIFIED | `useAutoRecalc.ts` implementa Caso 1 (null + inclui hoje → sync-ml-orders + recalc, l.45-76) e Caso 2 (sem has_cmv/has_tax_data → recalc, l.99-103) com `firedRef`; wired em `MercadoLivre.tsx` l.285-286 (periodo + mensal); `isRecalcing` alimenta `kpiSummaryLoading \|\| isRecalcing` l.640; `MLPedidos.tsx` auto-sync hoje quando count===0 l.757-769 |
| 3 | Lucro Bruto mensal de useMLCostWaterfall (fonte unica), sem cancelados (DATA-03) | VERIFIED | `currentGrossProfit` derivado exclusivamente de `monthlyCostWaterfall` (`MercadoLivre.tsx` l.267-279); RPC agrega apenas paid (`cancelled_revenue: 0` comentado no hook l.61); `GoalsCard` recebe `grossProfitRevenue={monthlyCostWaterfall?.paid_revenue ?? 0}` l.662 e usa como denominador de `grossProfitPct` (`GoalsCard.tsx` l.87-88); 0 ocorrencias de `rangeSyncedRef` |
| 4 | CFFE real da billing API + linha CFONPN + indicador "billing" vs "estimado" (DATA-04) | VERIFIED | Evoluiu para DRE mensal (pedido Wesley mid-phase, plan 41-04): CFFE em grupo "Envios Mercado Livre", CFONPN em "Taxas de parcelamento" (`BILLING_GROUP_MAP`, `useMLBilling.ts` l.32-68); badge "billing ML"/"estimado" (`MLCostCard.tsx` l.103-111); `dreFonte = billingData ? "billing" : "estimado"` (`MercadoLivre.tsx` l.242); fallback estimado de orders l.245-260 |
| 5 | Comissao /anuncios vem da API ML real; LISTING_TYPE_RATES removido (DATA-05) | PASSED (override) | Guard `columnView !== "financeiro"` removido — populacao do commCache so depende de `!filteredItemKey` (`MLAnuncios.tsx` l.821) com dedupe l.822; call sites cache-first l.1319-1320 e l.1497-1498; LISTING_TYPE_RATES preservado SOMENTE como fallback (override: cleanup Phase 46) |
| 6 | KPIs batem entre si e com referencia Nexo Abril/2026 (DATA-06) | PASSED (override) | /vendas e /financeiro usam a mesma `useMLCostWaterfall(currentFrom, currentTo)` (`MLFinanceiro.tsx` l.162-166) — identicos por construcao; SQL producao: CFFE R$40.065,33 EXATO, CFONPN R$15.902,70 EXATO, comissao % 11,14 vs 11,15; comissao absoluta divergente aceita "com ressalva" → Phase 47 |
| 7 | Tabela ml_billing_monthly populada pela EF escopada org+ml_user_id+period_month (DATA-04) | VERIFIED | Migration com UNIQUE(org, ml_user_id, period_month) + RLS `org_member_billing` via `is_org_member`; EF upsert onConflict identico (`index.ts` l.225-242); 4 meses em producao (given) |
| 8 | sync-ml-billing disparado pelo fluxo de sync existente, sem invocacao manual (DATA-04) | VERIFIED | `useMLSync.ts` l.181-189: loop por `capturedMLUserIds` invoca EF non-fatal (try/catch + console.warn) antes de `invalidateAll` |
| 9 | Card Custos exibe DRE do mes com grupos de tarifas reais (41-04) | VERIFIED | `groupBillingCharges()` com 8 grupos + bucket Outras (nunca dropa types); `MLCostCard.tsx` reescrito como DRE (Receita → grupos → Total tarifas → CMV → Impostos → Lucro/margem); `dreWaterfall` instancia waterfall do mes do filtro quando ≠ mes corrente (`MercadoLivre.tsx` l.208-214) |
| 10 | Total de tarifas = soma dos grupos; lucro/margem do mes corretos; degrada para estimado com badge (41-04) | VERIFIED | `totalTarifas = groups.reduce(...)` (`useMLBilling.ts` l.137); `totalTarifasEfetivo` re-soma grupos efetivos (`MercadoLivre.tsx` l.262-264); lucro = receita − totalTarifas − cmv − impostos (`MLCostCard.tsx` l.59-65); fallback estruturado com badge ambar "estimado" |
| 11 | Cancelamentos (bonuses B*) entram nos charges e viram ultima linha; totalTarifas liquido (regra de dominio) | VERIFIED | EF: `charges = [...rawCharges, ...bonuses]` de `bill_includes.bonuses` (`index.ts` l.89-91); regra fatura = mes de fechamento (consumo N → key N+1, l.53-64); `groupBillingCharges` captura `type.startsWith("B")` ANTES do bucket Outras e emite "Cancelamentos de tarifas" como ultima linha (l.94-98, 130-135); totalTarifas inclui cancelamentos (liquido); jun = -674,87 em producao (given) |
| 12 | Navegacao de meses no DRE com sync on-demand para mes sem dados | VERIFIED | `dreMonthOverride` + `shiftDreMonth` + reset ao mudar filtro (`MercadoLivre.tsx` l.169-198); `canGoNext = billingMonth < currentCalendarMonth`; ChevronLeft/Right + spinner `syncing` (`MLCostCard.tsx` l.79-102); `useMLBillingWithSync` invoca EF com user JWT 1x por periodo (`attemptedMonths` ref) e refaz a query (`useMLBilling.ts` l.193-228) |

**Score:** 12/12 (10 VERIFIED + 2 PASSED via override aceito por Wesley)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | Comissao absoluta abril == referencia Nexo (R$39.170 vs R$34.484 atual) | Phase 47 | 41-03-SUMMARY Open Items: investigacao de base de orders na Phase 47/QA |
| 2 | Remocao total de LISTING_TYPE_RATES (financialMockData.ts) | Phase 46 | 41-03-PLAN: objeto ainda usado por funcoes mock de graficos; cleanup Phase 46 |

### Required Artifacts (Levels 1-3: exists, substantive, wired)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260612140000_ml_billing_monthly.sql` | Tabela + RLS is_org_member | VERIFIED | DDL completa, UNIQUE composto, policy org_member_billing; aplicada em producao (given) |
| `supabase/functions/sync-ml-billing/index.ts` | EF 2-call flow + bonuses + deny-by-default | VERIFIED | 265 linhas substantivas: fetchBillingPeriod, key N+1, bonuses B*, zod YYYY-MM, dual-path auth, 403 para org NULL nao-service-role, skip upsert em 404, 0 logs com access_token |
| `src/hooks/useMLBilling.ts` | useMLBilling + groupBillingCharges + useMLBillingWithSync | VERIFIED | 228 linhas; exporta os 3 + tipos; wired em MercadoLivre.tsx l.21, 174, 218 |
| `src/hooks/useMLSync.ts` | Trigger non-fatal sync-ml-billing | VERIFIED | l.181-189; padrao identico a sync-ml-orders |
| `src/components/mercadolivre/MLCostCard.tsx` | DRE mensal + navegacao + badge | VERIFIED | Reescrito; "Total de tarifas ML" l.162; Chevrons + canGoNext + syncing; wired em MercadoLivre.tsx l.669-683 |
| `src/hooks/useAutoRecalc.ts` | Caso 1 + Caso 2 + firedRef | VERIFIED | Wired 2x em MercadoLivre.tsx (periodo + mensal) |
| `src/hooks/useMLCostWaterfall.ts` | total_tax + has_tax_data | VERIFIED | Wired em MercadoLivre.tsx, MLFinanceiro.tsx |
| `src/components/mercadolivre/GoalsCard.tsx` | prop grossProfitRevenue → grossProfitPct | VERIFIED | l.20, 87-88 |
| `src/pages/mercadolivre/MLAnuncios.tsx` | commCache sem guard columnView, cache-first | VERIFIED | Guard removido (l.821 so checa filteredItemKey); dedupe preservado |
| `src/integrations/supabase/types.ts` | entrada ml_billing_monthly | VERIFIED | l.377+ |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| sync-ml-billing EF | ml_billing_monthly | upsert onConflict org+ml_user_id+period_month | WIRED | index.ts l.225-242 |
| useMLSync | sync-ml-billing | functions.invoke non-fatal pos-sync | WIRED | useMLSync.ts l.181-189 |
| MercadoLivre.tsx | useMLBillingWithSync | billingMonth = dreMonthOverride ?? filterMonth | WIRED | l.167-174 |
| MLCostCard | billing props | gruposTarifas/totalTarifas/fonte/canGoNext/syncing | WIRED | l.669-683 |
| useMLBillingWithSync | sync-ml-billing (user JWT) | on-demand para mes sem dados, 1x por periodo | WIRED | useMLBilling.ts l.201-225 |
| MercadoLivre.tsx | useAutoRecalc | periodo + mensal; isRecalcing → loading do KPI grid | WIRED | l.285-286, 640 |
| MLPedidos.tsx | sync-ml-orders | auto-sync hoje quando 0 orders | WIRED | l.757-769 |
| MLAnuncios.tsx | ml-precos-custos | commCache cache-first, fallback getCommissionRate | WIRED | l.821-825, 1319-1320, 1497-1498 |
| GoalsCard | monthlyCostWaterfall.paid_revenue | grossProfitRevenue prop | WIRED | MercadoLivre.tsx l.662 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| MLCostCard (DRE) | gruposTarifas/totalTarifas | ml_billing_monthly.charges → groupBillingCharges | Sim (4 meses em producao com bonuses) | FLOWING |
| MLCostCard (DRE) | receitaMes/cmvMes/impostosMes | RPC get_cost_waterfall (dreWaterfall do mes exibido) | Sim (jun: CMV R$46.165, tax R$23.667) | FLOWING |
| GoalsCard | grossProfitPct | monthlyCostWaterfall.paid_revenue | Sim | FLOWING |
| MLAnuncios comissao | commCache | EF ml-precos-custos → listing_prices (sale_fee real) | Sim | FLOWING |
| Fallback estimado | gruposTarifasEfetivos | dreWaterfall.total_comissao/total_frete + adsSpendMes | Sim (fallback explicito, sinalizado com badge) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Build limpo | npm run build | passa (given, esta sessao) | PASS |
| Suite de testes | npx vitest run | 63/63 (given, esta sessao) | PASS |
| EF deployada | MCP list (orquestrador) | v4/version-5 ACTIVE | PASS |
| Dados producao | SQL ml_billing_monthly | 4 meses, jun cancel -674,87 / CFONPN 3.008,28 | PASS |

### Probe Execution

SKIPPED — nenhum `scripts/*/tests/probe-*.sh` no projeto; nenhum probe declarado nos PLANs.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| DATA-01 | 41-01 | SATISFIED | Truth #1; backend fc090c46 + visual aprovado |
| DATA-02 | 41-01 | SATISFIED | Truth #2 |
| DATA-03 | 41-01 | SATISFIED | Truth #3 |
| DATA-04 | 41-02, 41-04 | SATISFIED | Truths #4, #7, #8 |
| DATA-05 | 41-03 | SATISFIED (override) | Truth #5 |
| DATA-06 | 41-03, 41-04 | SATISFIED (override) | Truth #6 |

Sem requirements orfaos: REQUIREMENTS.md mapeia exatamente DATA-01..06 para a Phase 41 e todos foram reivindicados pelos plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| .planning/REQUIREMENTS.md | 17-19, 91-94 | DATA-02/03/04 ainda desmarcados / "Pending" na tabela | INFO | Drift documental — codigo entregue, checklist nao atualizado |
| .planning/STATE.md | 29-31 | "Phase 41 EXECUTING, Plan 2 of 3" | INFO | Drift documental — ROADMAP ja marca 4/4 Complete 2026-06-13 |

Nenhum TBD/FIXME/XXX/TODO/placeholder nos arquivos de codigo modificados pela fase. Nenhum log da EF interpola access_token (grep count = 0).

### Human Verification Required

Nenhum item pendente. Todos os checkpoints blocking human-verify da fase foram resolvidos por Wesley:
- 41-01: "aprovado" (DATA-01/02/03 visual em /vendas)
- 41-02: smoke de producao validado (sync popula ml_billing_monthly; CFONPN/badge visiveis)
- 41-03: "Aprovado com ressalva" (ressalva = comissao absoluta abril, registrada como deferred Phase 47)
- 41-04: DRE conferida contra tela Tarifas ML (jun CFONPN R$3.008,28 bate exato com print; cancelamentos e navegacao de meses validados nesta sessao)

### Gaps Summary

Nenhum gap bloqueante. O goal da fase — KPIs financeiros corretos em /vendas, /financeiro e /anuncios com billing real e fonte unica — esta observavelmente entregue no codigo e validado em producao. Duas deviations documentadas e aceitas por Wesley (LISTING_TYPE_RATES como fallback ate Phase 46; divergencia de comissao absoluta de abril investigada na Phase 47) estao registradas como overrides + deferred items.

---

_Verified: 2026-06-13_
_Verifier: Claude (gsd-verifier)_
