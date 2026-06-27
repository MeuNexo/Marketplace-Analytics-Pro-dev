---
phase: 67-compras-v3-reposi-o-mais-esperta-tend-ncia-lead-time-real
verified: 2026-06-26T19:35:00Z
status: human_needed
score: 6/7 must-haves verified
behavior_unverified: 1
overrides_applied: 0
re_verification: false
behavior_unverified_items:
  - truth: "Toggle 'Cálculo esperto' + badges de transparência visíveis e funcionando na /compras (SMART-04 visual)"
    test: "Abrir /compras logado com a org Pé Vermeio; verificar: (1) toggle aparece no header LIGADO por padrão; (2) badges no ícone de params por SKU mostram origem da venda (EWMA+saz/EWMA/Simples), seta de tendência (↑/↓/~), fator sazonal quando aplicado, e prazo real vs fixo; (3) desligar o toggle reconsulta a RPC e mostra 100% 'Simples' na origem; (4) religar restaura o modo esperto"
    expected: "Toggle renderiza como Switch ON no header; ao desligar, sugestões mudam (venda_dia recalculada como média plana); badges mostram os metadados por SKU sem poluir as colunas da tabela"
    why_human: "Comportamento de renderização React e interação do Switch são invariantes de UI que grep/tsc/vitest não exercitam em browser real; a transição de estado (smartMode=true→false→true) requer observação visual"
human_verification:
  - test: "Verificação visual do toggle e badges na /compras (Task 3 — padrão Phases 62/63/65/66)"
    expected: "Toggle 'Cálculo esperto' ON no header sticky; badges EWMA/sazonal/lead-time no ParamsTooltip por SKU; desligar muda dados (retorna ao simples); religar restaura esperto sem reload"
    why_human: "Renderização de componentes React e transição de estado do Switch precisam ser validados em browser com dados reais de prod; pendência conhecida documentada em 67-03-SUMMARY (mesmo padrão de todas as fases de compras)"
---

# Phase 67: Compras v3 — Reposição mais esperta (tendência + lead time real) — Verification Report

**Phase Goal:** O motor da "Compra Recomendada" da `/compras` fica mais preciso: velocidade de venda = EWMA (recência) + índice sazonal marca/mês; lead time = mediana real por fornecedor das OCs em trânsito; cada camada com fallback transparente para o cálculo simples (nunca inventa); toggle "Cálculo esperto" + badges de transparência. Fundação Phases 62-66 intocada; toggle OFF reproduz exatamente a Phase 66.
**Verified:** 2026-06-26T19:35:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SMART-01: venda_dia usa EWMA semanal (POWER(0.7,week_offset), limiar >=2 semanas) + índice sazonal por marca/mês (ratio-to-average, >=12 meses, clamp [0.5,2.5]) | ✓ VERIFIED | CTE `ewma_sales` na migration (linha 100–118): `POWER(0.7, week_offset)`, `weeks_with_sales >= 2`; CTE `seasonal_index` (linha 120–142): `months_covered >= 12`, `GREATEST(0.5, LEAST(2.5, ...))`. Espelho TS: `calcEwmaDaily` usa `Math.pow(1-alpha, weekOffset)/7`, `calcSeasonalFactor` usa `size<12` fallback e `Math.max(0.5, Math.min(2.5, raw))`. 33 testes novos cobrem todos os ramos: 53/53 PASS |
| 2 | SMART-02: lead time usa mediana real por fornecedor via `percentile_cont(0.5)`, limiar >=2 OCs, guard `data_entrega>=data_pedido` | ✓ VERIFIED | CTE `lead_time_by_fornecedor` (linha 144–154): `percentile_cont(0.5) WITHIN GROUP (ORDER BY (po.data_entrega - po.data_pedido))`, `COUNT(*) AS oc_count`, `AND po.data_entrega >= po.data_pedido`. Espelho TS: `resolveSmartLeadTime` com `ocCount >= 2 && medianLeadDays > 0`. Prod: 93 SKUs com lead time real ativo |
| 3 | SMART-03: fallback transparente por dimensão; toggle OFF (p_smart=FALSE) reproduz **exatamente** Phase 66; 5 colunas de transparência expostas | ✓ VERIFIED | `CASE WHEN v_smart AND ... ELSE COALESCE(s.avg_daily, 0)` em sales_smart — fallback para média plana quando smart=FALSE. `p_smart DEFAULT FALSE` + `COALESCE(p_smart, FALSE)`. DROP do overload 3-arg garante que chamadas legadas caem no DEFAULT=FALSE. 5 colunas: `venda_dia_origem TEXT`, `lead_time_origem TEXT`, `tendencia TEXT`, `fator_sazonal NUMERIC`, `lead_time_real INTEGER`. Prod: off_nao_simples=0 com p_smart=FALSE confirmado pelo orquestrador |
| 4 | SMART-04: toggle "Cálculo esperto" (ON por padrão) + badges de transparência visíveis e funcionando na /compras | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Código wired: `useState(true)` em `MLCompras.tsx` L117; Switch+Label no header sticky L160–172; `useReplenishmentBySku(30, 1.0, smartMode)` L119; hook passa `p_smart: smartMode` explicitamente L217. Badges em `ParamsTooltip`: `tendenciaBadge`, `vendaOrigemBadge`, `leadTimeBadge`, `fator_sazonal` condicional, texto "modo simples". Comportamento visual em browser não observado — ver Human Verification |
| 5 | Espelho TS replica as fórmulas da RPC com constantes idênticas e 33 novos testes cobrindo todos os fallbacks | ✓ VERIFIED | 5 funções puras: `calcEwmaDaily`, `calcSeasonalFactor`, `calcTrend`, `resolveSmartLeadTime`, `resolveVendaDiaOrigem`. Constantes: alpha=0.3/decay=0.7, clamp[0.5,2.5], 12 meses, K>=2, threshold=0.20 idênticos ao SQL. 2 union types exportados (`VendaDiaOrigem`, `LeadTimeOrigem`). Test run confirmado: **53/53 PASS** (`npx vitest run replenishmentUtils.test.ts`) |
| 6 | Anti-IDOR: RPC SECURITY INVOKER, anon revogado, todas as CTEs novas filtram `organization_id=p_org_id` | ✓ VERIFIED | `SECURITY INVOKER` (L43). `REVOKE EXECUTE ... FROM PUBLIC, anon` (L278). `ewma_sales` filtra `o2.organization_id = p_org_id AND v_smart` (L113). `seasonal_index` filtra `mic.organization_id = p_org_id ... AND v_smart` (L123). `lead_time_by_fornecedor` filtra `po.organization_id = p_org_id AND v_smart` (L149). Prod: org alheia retorna 0 linhas confirmado |
| 7 | Fundação Phases 62-66 intocada; zero regressão nos testes existentes | ✓ VERIFIED | `67-01-SUMMARY key-files.modified: []` — somente a migration nova foi criada. `67-02-SUMMARY`: "funcoes/constantes existentes intocadas" + "20 testes existentes intocados". `67-03-SUMMARY`: "zero regressão das Phases 62–66". Testes confirmados: `replenishmentUtils.test.ts` 53/53 inclui 20 testes pre-existentes |

**Score: 6/7 truths verified (1 present, behavior-unverified)**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260667000100_get_replenishment_by_sku_smart.sql` | RPC v7 com p_smart, ewma_sales, seasonal_index, lead_time_by_fornecedor, 5 colunas de transparência | ✓ VERIFIED | 280 linhas, substantivo. DROP overload 3-arg (L24), 4-arg com DEFAULT FALSE (L26-31), #variable_conflict use_column (L46), 3 CTEs novas (L99–154), sales_smart (L155–173), 5 colunas no SELECT final (L263–272), REVOKE/GRANT corretos (L278-279) |
| `src/lib/analysis/replenishmentUtils.ts` | 5 funções puras + 2 union types espelhando RPC v7 | ✓ VERIFIED | calcEwmaDaily (L186), calcSeasonalFactor (L216), calcTrend (L247), resolveSmartLeadTime (L272), resolveVendaDiaOrigem (L298); VendaDiaOrigem/LeadTimeOrigem (L167-170). Funções existentes intocadas |
| `src/lib/analysis/replenishmentUtils.test.ts` | 33 novos testes + 20 existentes | ✓ VERIFIED | 53 testes totais; 6 describe blocks novos (calcEwmaDaily/calcSeasonalFactor/calcTrend/resolveSmartLeadTime/resolveVendaDiaOrigem); imports atualizados. **53/53 PASS confirmado** |
| `src/hooks/useReplenishmentBySku.ts` | 3º parâmetro smartMode, queryKey atualizada, p_smart explícito, interface com 5 campos novos | ✓ VERIFIED | `smartMode = true` (L204); `queryKey: [..., smartMode]` (L209); `p_smart: smartMode` (L217 — comentário "nunca undefined"); `ReplenishmentSkuRow` com `venda_dia_origem: VendaDiaOrigem` (L51), `lead_time_origem: LeadTimeOrigem` (L53), `tendencia` (L55), `fator_sazonal` (L57), `lead_time_real` (L59). Import dos tipos (L4) |
| `src/pages/mercadolivre/MLCompras.tsx` | useState(true) para smartMode + Switch toggle no header + propagação ao hook | ✓ VERIFIED | `const [smartMode, setSmartMode] = useState(true)` (L117); `useReplenishmentBySku(30, 1.0, smartMode)` (L119); Switch+Label L160–172 com `checked={smartMode}` e `onCheckedChange={setSmartMode}` |
| `src/components/mercadolivre/ReplenishmentSkuTable.tsx` | ParamsTooltip com badges de transparência (tendência, origem venda, sazonal, lead time, modo simples) | ✓ VERIFIED | `tendenciaBadge` (L166–170), `vendaOrigemBadge` (L172–177), `leadTimeBadge` (L179–182), `fator_sazonal` condicional (L214–220), `lead_time_origem` badge (L221), "modo simples" text (L222–224) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `MLCompras.tsx` | `useReplenishmentBySku.ts` | `smartMode` prop no hook | ✓ WIRED | `useReplenishmentBySku(30, 1.0, smartMode)` L119; Switch.onCheckedChange → setSmartMode → hook re-query |
| `useReplenishmentBySku.ts` | RPC `get_replenishment_by_sku` | `p_smart: smartMode` explícito | ✓ WIRED | `supabase.rpc("get_replenishment_by_sku", { ..., p_smart: smartMode })` L213-218 — nunca undefined |
| `ReplenishmentSkuTable.tsx` | `useReplenishmentBySku.ts` | Interface `ReplenishmentSkuRow` com 5 campos Phase 67 | ✓ WIRED | `import type { GroupedReplenishmentRow, ReplenishmentSkuRow }` L27; ParamsTooltip acessa `row.venda_dia_origem`, `row.tendencia`, `row.fator_sazonal`, `row.lead_time_origem`, `row.lead_time_real` |
| `replenishmentUtils.ts` | `replenishmentUtils.test.ts` | Imports + 33 novos testes | ✓ WIRED | `import { ..., calcEwmaDaily, calcSeasonalFactor, calcTrend, resolveSmartLeadTime, resolveVendaDiaOrigem }` linha 3 do test file |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 53 testes vitest (replenishmentUtils, inclui 33 novos SMART-01..04) | `npx vitest run src/lib/analysis/replenishmentUtils.test.ts` | 53 passed (53) in 14ms | ✓ PASS |
| calcEwmaDaily com 2 obs: offset 0 qty=14, offset 1 qty=7 (alpha=0.3) | Matemática: num=14*1+7*0.7=18.9, den=1.7, daily=18.9/1.7/7=≈1.5882 | Teste SMART-01 base PASS | ✓ PASS |
| calcSeasonalFactor com <12 meses retorna {factor:1.0, active:false} | Teste SMART-01 fallback <12 meses PASS | 53/53 verde | ✓ PASS |
| resolveSmartLeadTime com ocCount=1 retorna param (não fornecedor_real) | Teste SMART-03 ocCount<2 PASS | 53/53 verde | ✓ PASS |
| Toggle visual na /compras + badges por SKU | Browser real com Wesley logado | Pendente — Task 3 explicitamente adiada | ? SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| SMART-01 | 67-01-PLAN, 67-02-PLAN | EWMA semanal + índice sazonal por marca/mês, constantes alpha=0.3/decay=0.7/clamp[0.5,2.5]/threshold 12 meses | ✓ SATISFIED | SQL CTE ewma_sales + seasonal_index; TS calcEwmaDaily + calcSeasonalFactor; 33 testes cobrindo limiares |
| SMART-02 | 67-01-PLAN | Lead time real via mediana percentile_cont(0.5) por fornecedor, limiar K>=2 OCs | ✓ SATISFIED | SQL CTE lead_time_by_fornecedor; TS resolveSmartLeadTime; prod: 93 SKUs com lead time real |
| SMART-03 | 67-01-PLAN, 67-02-PLAN, 67-03-PLAN | Fallback por dimensão independente; 5 colunas de transparência; toggle OFF=Phase 66 exato | ✓ SATISFIED | 5 colunas na RETURNS TABLE + SELECT final; CASE logic com fallback COALESCE; p_smart DEFAULT FALSE; prod: off_nao_simples=0 |
| SMART-04 | 67-03-PLAN | Toggle "Cálculo esperto" (ON por padrão) + badges EWMA/sazonal/lead-time na UI | CODE WIRED / VISUAL PENDING | Switch+Label em MLCompras; badges em ParamsTooltip implementados; visual em browser = pendência conhecida Task 3 |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| Nenhum | — | — | Nenhum arquivo modificado contém TBD/FIXME/XXX, stubs ou retornos hardcoded vazios. Módulo puro sem I/O; RPC sem JSON estático |

---

## Notas Específicas do Verificador

### Sazonalidade ATIVA (não fallback como o research previa)

O research estimava fallback provável para `fator_sazonal=1.0` por insuficiência de dados. Na prática, os dados de `orders` cobrem **~13 meses-calendário** (2025-05 a 2026-06), superando o limiar de 12 meses distintos. Resultado em prod: **284 SKUs** com sazonalidade ativa, fatores no intervalo saudável min=0.93/max=1.68/avg=1.05, nenhum no clamp. Não é uma surpresa problemática — é uma entrega mais completa do que o planejado.

### Lead time real ATIVO (93 SKUs)

O limiar K>=2 OCs por fornecedor foi atingido por 93 SKUs (fornecedores com >=2 ordens de compra com datas válidas). Mediana real substitui o param fixo para esses SKUs.

### Ok visual do frontend é pendência conhecida (não-gap)

Task 3 do 67-03-PLAN é explicitamente um checkpoint visual pós-PR, adotado como padrão em todas as fases de compras (62, 63, 65, 66). O código está wired, tsc=0, build ok, 246/246 testes verdes conforme SUMMARY. A pendência é o merge do PR `gsd/phase-67-calculo-esperto` e o ok do Wesley em preview Vercel apontando para `ckcdevcxgvueywivefgx`.

### Consistência espelho TS vs SQL (verificada por leitura direta)

| Constante | SQL | TS | Match |
|-----------|-----|----|-------|
| Decaimento EWMA | `POWER(0.7, week_offset)` | `Math.pow(1-alpha, weekOffset)` onde `alpha=0.3` → `decay=0.7` | ✓ |
| Limiar semanas EWMA | `weeks_with_sales >= 2` | `weeklyObs.length < 2 return null` | ✓ |
| Limiar meses sazonal | `months_covered >= 12` | `monthlyAvgs.size < 12 return {factor:1.0, active:false}` | ✓ |
| Clamp sazonal | `GREATEST(0.5, LEAST(2.5, ...))` | `Math.max(clampMin=0.5, Math.min(clampMax=2.5, raw))` | ✓ |
| Limiar OCs lead time | `oc_count >= 2` | `ocCount >= 2 && medianLeadDays > 0` (guard extra conservador) | ✓ |
| Threshold tendência | `ewma_recent > ewma_older * 1.20` | `ratio > 1 + threshold=0.20` | ✓ |

---

## Human Verification Required

### 1. Toggle "Cálculo esperto" + badges de transparência na /compras

**Test:** Abrir `/compras` logado como Wesley (org Pé Vermeio), observar:
1. Toggle "Cálculo esperto" aparece no header sticky, iniciado LIGADO
2. Pelo menos um SKU mostra badge "EWMA + saz." ou "EWMA" no ícone de params
3. Ao menos um badge mostra "↑ Alta" ou "↓ Queda" ou "~ Estável" para tendência
4. Ao menos um badge mostra "Prazo real Xd" (lead time real) para SKU de fornecedor com >=2 OCs
5. Desligar o toggle → dados recarregam → todos os SKUs mostram "Simples" e sugestões podem mudar
6. Religar o toggle → modo esperto restaurado sem reload de página

**Expected:** Toggle visível e funcional; badges aparecem no tooltip de cada SKU; transição ON↔OFF reconsulta a RPC com `p_smart=true/false`; valores de `compra_sugerida` podem diferir entre os modos para os 76 SKUs que tiveram sugestão alterada pelo EWMA

**Why human:** Comportamento visual de renderização React + transição de estado `useState(true)↔false` em browser real; validação de que os dados da RPC com `p_smart=true` chegam corretamente ao badge via `mapRow` → `ReplenishmentSkuRow` → `ParamsTooltip`

---

## Gaps Summary

Nenhum gap bloqueador identificado. O único item não verificável programaticamente é a inspeção visual do toggle e badges no browser, que é a pendência conhecida Task 3 do plano — padrão adotado nas Phases 62, 63, 65 e 66. Todos os artefatos existem, são substantivos, estão wired e os 53 testes (incluindo os 20 pré-existentes e 33 novos SMART-01..04) passam.

---

_Verified: 2026-06-26T19:35:00Z_
_Verifier: Claude (gsd-verifier) — goal-backward, adversarial stance_
