---
phase: 48-mco-com-ads
plan: 02
subsystem: api
tags: [supabase, edge-functions, consultor-insights, ads, margem, score]

# Dependency graph
requires:
  - phase: 48-01
    provides: "RPC get_margin_with_ads_by_product + colunas ads_eating_critical_pct/ads_eating_alert_pct em consultor_config"
  - phase: 45
    provides: "engine consultor-insights (estrutura de regras, score, upsert idempotente, pilar Ads)"
provides:
  - "RULE ads_eating_margin por produto (MCO-04): lucro operacional > 0 mas pós-ads ≤ limiar → insight per-item"
  - "RULE ads_no_sale item-level (MCO-05): spend > 0 E attributed_orders = 0 por item_id via ml_ads_products_cache"
  - "Pilar Ads do score penaliza ads_eating_margin com -15 pts (além de ads_no_sale -20 e tacos -5 por pp)"
  - "Auto-resolução do insight org-level antigo ads_no_sale (ml_user_id_key='') ao parar de ser gerado"
affects: [48-03, phase-46, phase-47]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RULE ads_eating_margin: RPC SECURITY INVOKER 30 dias → filtra lucro>0 E pós-ads≤limiar → insight per-item"
    - "Paginação .range() em loop para ml_ads_products_cache (PostgREST trunca em 1000 linhas)"
    - "rule_key preservado (ads_no_sale) ao mudar granularidade org→item; ml_user_id_key diferencia as linhas"
    - "activeRuleKeys por execução escopada à org corrente (sem vazamento cross-tenant)"

key-files:
  created: []
  modified:
    - supabase/functions/consultor-insights/index.ts

key-decisions:
  - "ads_eating_margin é SEPARADO de margin_critical (D-07): produto pode ter lucro operacional > 0 e estar em ads_eating sem estar em margin_critical"
  - "RULE 3 ads_no_sale mantém rule_key='ads_no_sale' ao migrar org→item-level (D-09/D-10): o índice único (org,rule_key,ml_user_id_key) diferencia '' de item_id, auto-resolvendo o insight antigo"
  - "Paginação .range() loop em ml_ads_products_cache para respeitar limite 1000 linhas PostgREST"
  - "Pilar Ads penalidade: ads_eating_margin adiciona -15 (hasErosaoAds) sem remover -20 ads_no_sale nem -5*tacos"

patterns-established:
  - "Regra per-item no engine consultor-insights: ml_user_id_key=item_id, category='Ads', action_href='/anuncios?items=<item_id>'"
  - "Separação de alertas no motor de regras: dois rule_keys distintos (ads_eating_margin vs margin_critical) para fontes de insight conceitualmente diferentes"

requirements-completed: [MCO-04, MCO-05]

# Metrics
duration: 30min
completed: 2026-06-14
---

# Phase 48 Plan 02: MCO com Ads — Insights ads_eating_margin e ads_no_sale item-level Summary

**Nova RULE ads_eating_margin per-produto (RPC 30d, lucro>0 pós-ads≤10%) + upgrade ads_no_sale para item-level via ml_ads_products_cache paginado + penalidade -15 no pilar Ads do score — deployada e smoke PASS (30 ads_eating / 9 ads_no_sale)**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-06-14
- **Tasks:** 3 (2 auto + 1 checkpoint:human-action executado pelo orquestrador)
- **Files modified:** 1 (supabase/functions/consultor-insights/index.ts)

## Accomplishments

- Nova RULE `ads_eating_margin` per-item: filtra produtos com lucro operacional > 0 mas margem pós-ads ≤ limiar (crítico ≤0%, alerta ≤10%) via RPC `get_margin_with_ads_by_product` (30 dias); body leigo em R$ e percentuais. Separada conceitualmente de `margin_critical` (D-07/MCO-04).
- Upgrade completo da RULE 3 `ads_no_sale` de org-level (ml_ads_daily_cache) para item-level (ml_ads_products_cache com paginação .range() em loop): gera insight por item_id com spend > 0 e attributed_orders = 0; mantém rule_key `ads_no_sale` para auto-resolver o insight org-level antigo (D-09/D-10/MCO-05).
- Pilar Ads do score ganha penalidade `hasErosaoAds ? -15 : 0` para `ads_eating_margin`, preservando as penalidades existentes (`hasCampanhaSemVenda ? -20 : 0` e `tacosOver15*5`).
- EF deployada em ckcdevcxgvueywivefgx (141,4 kB, ACTIVE, verify_jwt=false preservado). Smoke PASS: Pé Vermeio 47 insights / score 75; Thales 84 insights / score 49. 30 ads_eating_margin ativos (3 críticos pós-ads ≤0% + 27 alertas pós-ads ≤10%); 9 ads_no_sale item-level; ads_no_sale org-level antigo (ml_user_id_key='') = 0 ativos (auto-resolvido D-10).

## must_haves — verificação com dados do smoke

| Truth | Status | Evidência |
|-------|--------|-----------|
| ads_eating_margin por item quando lucro>0 e pós-ads≤limiar (MCO-04) | PASS | 30 insights per-item (3 críticos + 27 alertas) via ml_user_id_key=item_id |
| ads_eating_margin SEPARADO de margin_critical (D-07) | PASS | 30 itens ads_eating têm lucro operacional > 0, distintos dos 184 em margin_critical |
| ads_no_sale por produto: spend>0 E attributed_orders=0 por item_id (MCO-05) | PASS | 9 insights item-level na janela de 7 dias |
| rule_key permanece 'ads_no_sale'; ml_user_id_key=item_id; org-level antigo auto-resolvido (D-09/D-10) | PASS | ads_no_sale com ml_user_id_key='' = 0 ativos |
| ads_eating_margin penaliza pilar Ads do score (peso 25) | PASS | hasErosaoAds ? -15 implementado; score 75 Pé Vermeio reflte penalidade |
| EF consultor-insights deployada em ckcdevcxgvueywivefgx | PASS | ACTIVE 141,4 kB, invocação real HTTP 200 pelo orquestrador |

## Task Commits

1. **Task 1: Config + nova RULE ads_eating_margin** — `70c8de1e` (feat)
2. **Task 2: Upgrade RULE 3 ads_no_sale item-level + pilar Ads** — `482808ea` (feat)
3. **Task 3: Deploy EF consultor-insights** — checkpoint:human-action executado pelo orquestrador (não gera commit de código)

## Files Created/Modified

- `supabase/functions/consultor-insights/index.ts` — ConsultorConfig + DEFAULT_CONFIG ganham `ads_eating_critical_pct` / `ads_eating_alert_pct`; nova RULE ads_eating_margin (RPC 30d, per-item, body leigo R$, penalidade -15 no score); RULE 3 ads_no_sale refatorada para item-level com paginação `.range()` loop

## Decisions Made

- **D-07 (MCO-04): regras separadas por conceito** — `ads_eating_margin` é exclusivo para produtos com lucro operacional > 0 cujos ads corroem a margem; `margin_critical` é para prejuízo operacional. Não há mesclagem de rule_keys.
- **D-09/D-10 (MCO-05): manter rule_key 'ads_no_sale' ao migrar granularidade** — o índice único `(organization_id, rule_key, ml_user_id_key)` diferencia `ml_user_id_key=''` (org-level antigo) de `ml_user_id_key=item_id` (novo). O auto-resolver do engine (filtra linhas ativas não emitidas) marca o org-level como resolved sem intervenção.
- **Paginação .range() loop**: ml_ads_products_cache com ~6.000 linhas/30 dias ultrapassa o limite PostgREST de 1.000 linhas; implementado loop `.range(offset, offset+999)` até retornar < 1.000 linhas.
- **Penalidade -15 no pilar Ads**: `hasErosaoAds ? -15 : 0` adiciona penalidade sem remover as existentes (ads_no_sale -20, tacos -5×pp); mantém coerência do pilar Ads peso 25.

## Deviations from Plan

Nenhuma — plano executado exatamente como escrito. Checkpoint:human-action de deploy executado pelo orquestrador conforme previsto.

## Issues Encountered

Nenhum. A EF foi deployada pelo orquestrador sem erros; smoke confirmou geração correta de insights com os números esperados.

## User Setup Required

Nenhum. A EF está ativa com as credenciais e configurações existentes; `consultor_config` já contém as colunas `ads_eating_critical_pct` / `ads_eating_alert_pct` criadas na Phase 48-01.

## Next Phase Readiness

- **48-03 (frontend)** pode iniciar imediatamente: os insights `ads_eating_margin` e `ads_no_sale` per-item já estão gravados em `insights` e o score reflete as penalidades corretas. A RPC de margem+ads (48-01) e os insights (48-02) são as duas fontes necessárias para o painel MCO.
- Sem bloqueadores.

---

*Phase: 48-mco-com-ads*
*Completed: 2026-06-14*
