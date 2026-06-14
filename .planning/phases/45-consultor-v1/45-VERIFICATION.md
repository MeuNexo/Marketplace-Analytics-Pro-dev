---
phase: 45-consultor-v1
verified: 2026-06-14T18:00:00Z
status: passed
score: 5/5
overrides_applied: 0
---

# Phase 45: consultor-v1 Verification Report

**Phase Goal:** A Pé Vermeio vê ≥5 insights reais e acionáveis no primeiro run e tem score de saúde visível no topo de /vendas.
**Verified:** 2026-06-14T18:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Engine consultor-insights roda por org, avalia ~12 regras e grava em tabela insights (severidade, categoria, ação recomendada, impacto estimado em R$) | VERIFIED | EF `supabase/functions/consultor-insights/index.ts` (1044 lines): 14 rule_keys, `runConsultorForOrg` writes to `insights` via upsert with `onConflict: organization_id,rule_key,ml_user_id_key`. Smoke confirmed 8 active insights for Pé Vermeio. |
| 2 | Card "O que fazer agora" aparece no topo de /vendas com os top insights acionáveis — em linguagem leiga | VERIFIED | `ConsultorCard` imported and rendered in `MercadoLivre.tsx` line 653 gated on `connected`, placed after `OnboardingBanner` and before content widgets. Top-3 insights with title, severity icon, loss framing ("Você está perdendo ~R$X/mês"), dismiss, and deep-link. Wesley visually confirmed. |
| 3 | Painel de insights exibe explicação por insight ("por que isso importa", "como resolver") | VERIFIED | `MLConsultor.tsx` InsightCard component renders `insight.body` (por que importa) at line 106, and `<Link to={insight.action_href}>{insight.action_label}</Link>` (como resolver) at line 116. Full insights list with severity badge, category, impact. |
| 4 | Score de saúde do negócio (0-100) visível — composto por margem, ads, estoque, reputação e completude | VERIFIED | Engine computes weighted score (Margem 30/Ads 25/Estoque 20/Reputação 15/Completude 10), upserts into `consultor_health_snapshots`. `useConsultorInsights` hook reads 2 latest snapshots for delta; `ConsultorCard` displays score badge with color band + trend arrow; `MLConsultor.tsx` shows score header + PillarRow breakdown for all 5 pillars. Smoke: score 83 (margin88/ads100/estoque94/rep88/comp0). |
| 5 | Org Pé Vermeio gera ≥5 insights reais e acionáveis no primeiro run do engine | VERIFIED | Orchestrator smoke (mode=all_orgs, org 7f615df7-7bac-45e5-8a93-827fb9ddeec7): 8 active insights — stock_critical(R$9.523), margin_critical(R$819), goal_at_risk(R$357.708), paused_with_sales(R$85.711), margin_alert(R$1.499), stock_alert, no_cost(38), claims_spike(+2400%). Idempotency confirmed: re-run kept count at 8. CONSUL-05 met. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260645000000_consultor_tables.sql` | 3 tables (insights, consultor_config, consultor_health_snapshots) + RLS org-first | VERIFIED | File exists. 4 CREATE TABLE statements, 6 `is_org_member` usages, idempotent (IF NOT EXISTS + DROP POLICY IF EXISTS). Includes `ml_user_id_key` helper column + UNIQUE INDEX for dedup. |
| `supabase/migrations/20260645010000_consultor_engine_rpcs.sql` | 4 SECURITY DEFINER RPCs for margin/coverage/paused/no-cost | VERIFIED | File exists. 5 `CREATE OR REPLACE FUNCTION` + 7 `SECURITY DEFINER` occurrences. All 4 `get_consultor_*` RPCs confirmed in engine calls. Additional `20260645011000` security fix: REVOKE PUBLIC execute. |
| `supabase/migrations/20260645020000_pg_cron_consultor.sql` | pg_cron daily 08:30 UTC Pattern B | VERIFIED | File exists. Contains `cron.schedule`, `consultor-insights-daily`, `service_role_key` vault reference, `all_orgs` mode. 9 matches across 4 key patterns. Cron confirmed ACTIVE in production. |
| `supabase/functions/consultor-insights/index.ts` | Engine with auth dual, 12+ rules, score, snapshot, upsert | VERIFIED | 1044 lines. Contains `runConsultorForOrg`, `authenticate`, 14 distinct rule_keys (margin_critical, margin_alert, ads_no_sale, tacos_high, ads_efficiency, stock_critical, stock_alert, no_cost, no_fiscal, ticket_drop, claims_spike, paused_with_sales, goal_at_risk, questions_old). All 4 `get_consultor_*` RPCs called. |
| `supabase/config.toml` | `[functions.consultor-insights]` with `verify_jwt = false` | VERIFIED | Lines 98-99: `[functions.consultor-insights]` / `verify_jwt = false` confirmed. |
| `src/integrations/supabase/types.ts` | Types for 3 new tables | VERIFIED | `consultor_config`, `consultor_health_snapshots`, `insights` all present with Row/Insert/Update types. `insights_critical` and `ml_user_id_key` fields visible. |
| `src/hooks/useConsultorInsights.ts` | org-scoped reads + on-demand invoke + dismiss | VERIFIED | 203 lines. Reads `insights` (line 74) and `consultor_health_snapshots` (line 106). On-demand invoke via `consultor-insights` EF with `mode:org_only` (lines 153-160). Dismiss mutation with `status:'dismissed'` + `invalidateQueries` (lines 171-186). staleTime 4h, severity sort (D-17). |
| `src/components/mercadolivre/ConsultorCard.tsx` | Top-3 + score card for /vendas | VERIFIED | Named export `ConsultorCard`. Score badge with band colors + trend arrow. Top 3 from `insights.slice(0,3)`. Per-item: SeverityIcon, title as Link to action_href, impact framing "Você está perdendo ~R$/mês", dismiss button. "Ver todos" link to /consultor. |
| `src/pages/mercadolivre/MLConsultor.tsx` | /consultor full panel with explanation + dismiss + deep-links | VERIFIED | Default export. Score header with PillarRow breakdown. InsightCard renders body (por que importa), action button linked to action_href (como resolver), dismiss. Empty/loading states handled. |
| `src/pages/MercadoLivre.tsx` | ConsultorCard wired at top of /vendas | VERIFIED | Import at line 48; hook call at line 104; render at line 652-661 gated on `connected` (ML connected), placed after OnboardingBanner, before content widgets. |
| `src/App.tsx` | Route /consultor with lazy MLConsultor inside RoleRoute/ErrorBoundary | VERIFIED | Line 37: `React.lazy(() => import("./pages/mercadolivre/MLConsultor"))`. Line 138: `<Route path="/consultor" element={<RoleRoute><ErrorBoundary ...><MLConsultor /></ErrorBoundary></RoleRoute>} />` |
| `src/components/layout/ApiSidebar.tsx` | Consultor sidebar item | VERIFIED | Line 7: `Lightbulb` imported. Line 34: `{ icon: Lightbulb, label: "Consultor", path: "/consultor" }` |
| `src/components/layout/routeMeta.ts` | /consultor in routeMeta | VERIFIED | Line 22: `"/consultor": { title: "Consultor", subtitle: "O que fazer agora — alertas e saúde do negócio" }` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `supabase/functions/consultor-insights/index.ts` | `insights` / `consultor_health_snapshots` | `supabase.upsert` (service role) | VERIFIED | Engine calls `.from("insights").upsert(...)` at line 884 and `.from("consultor_health_snapshots").upsert(...)` at line 926 |
| `pg_cron consultor-insights-daily` | `consultor-insights` EF | `net.http_post + vault service_role_key` | VERIFIED | Migration `20260645020000` contains `net.http_post` + vault `decrypted_secrets WHERE name='service_role_key'`. Cron confirmed ACTIVE in Supabase production at `30 8 * * *`. |
| `src/pages/MercadoLivre.tsx` | `ConsultorCard` | render after OnboardingBanner | VERIFIED | `ConsultorCard` rendered at line 652-661 after `OnboardingBanner` (line 645), before content. Gated on `connected`. |
| `src/hooks/useConsultorInsights.ts` | `insights` / `consultor_health_snapshots` | `supabase.from(...).eq(organization_id)` | VERIFIED | `.from("insights")` at line 74; `.from("consultor_health_snapshots")` at line 106. Both filtered by `organization_id` (org-scoped). |
| `src/App.tsx` | `MLConsultor` | `Route path=/consultor` | VERIFIED | `/consultor` route registered at line 138 with lazy MLConsultor. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ConsultorCard.tsx` | `insights`, `score`, `scoreBand`, `scoreDelta` | `useConsultorInsights` hook → Supabase `insights` + `consultor_health_snapshots` tables | Yes — tables populated by EF engine; smoke confirmed 8 real rows for Pé Vermeio. On-demand EF invoke when empty. | FLOWING |
| `MLConsultor.tsx` | `insights`, `pillars`, `score` | Same hook — `consultor_health_snapshots` for score/pillars | Yes — 5 pillar sub-scores (margin88/ads100/estoque94/rep88/comp0) from production smoke. | FLOWING |
| `consultor-insights/index.ts` | `marginRows`, `coverageRows`, `noCostCount`, `pausedRows` | RPCs `get_consultor_*` — SECURITY DEFINER SQL against real tables | Yes — RPCs confirmed in production with real row counts (margin=98 products, coverage=83 items, paused=50). | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| EF file is substantive (≥300 lines, has runConsultorForOrg) | `wc -l supabase/functions/consultor-insights/index.ts` | 1044 lines | PASS |
| 14 rule_keys distinct | `grep -c "rule_key:" index.ts` | 16 occurrences (14 distinct rules + 2 in interface/comment) | PASS |
| All 4 RPCs called in engine | grep for `get_consultor_margin_by_product`, `get_consultor_coverage`, `get_consultor_no_cost_count`, `get_consultor_paused_with_sales` | All 4 found | PASS |
| Score pillars in snapshot upsert | grep `score_margin\|score_ads\|score_estoque\|score_reputacao\|score_completude` | All 5 present in upsert at lines 931-935 | PASS |
| Deep-links use real routes | grep `/precificacao\|/fiscal` | `/precificacao` at line 485, `/fiscal` at line 515 | PASS |
| Auto-resolve touches only active, not dismissed | grep `status.*resolved\|not.*rule_key` | Lines 904-915: `.eq("status","active").not("rule_key","in",...)` — dismissed excluded by status filter | PASS |
| Hook reads real tables | grep `from("insights")\|from("consultor_health_snapshots")` | Lines 74 and 106 confirmed | PASS |
| ConsultorCard wired in /vendas | grep `connected && <ConsultorCard` in MercadoLivre.tsx | Line 652: `{connected && (<ConsultorCard .../>)}` | PASS |
| Route /consultor registered | grep `/consultor` in App.tsx | Line 138: `<Route path="/consultor" ...>` | PASS |

---

### Probe Execution

No probe scripts found (`scripts/*/tests/probe-*.sh`). Runtime state provided by orchestrator as ground truth:

| Check | Result | Status |
|-------|--------|--------|
| EF consultor-insights ACTIVE in production (ckcdevcxgvueywivefgx) | Confirmed ACTIVE via deploy_edge_function | PASS |
| Cron consultor-insights-daily 30 8 * * * active | Confirmed via `SELECT jobname, schedule FROM cron.job` | PASS |
| Pé Vermeio (7f615df7-...) active insights count | 8 insights (≥5 required) | PASS |
| Score snapshot for Pé Vermeio | score=83, margin=88, ads=100, estoque=94, rep=88, comp=0 | PASS |
| Idempotency (2nd run) | Count stable at 8, no duplicates | PASS |
| Auth fail-closed fix | commit f8518f39: missing SERVICE_KEY → 500, not all_orgs bypass | PASS |
| REVOKE PUBLIC execute on RPCs | migration 20260645011000 applied; ACL = postgres+service_role only | PASS |
| Wesley visual checkpoint | Approved 2026-06-14: card visible, deep-links filter, dismiss persists | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CONSUL-01 | 45-01, 45-02 | Engine roda por org com regras e grava insights | SATISFIED | EF deployed ACTIVE; 14 rules; 8 insights for Pé Vermeio in production |
| CONSUL-02 | 45-03 | Card "O que fazer agora" no topo de /vendas | SATISFIED | ConsultorCard in MercadoLivre.tsx line 652 gated on `connected`, top-3 insights in leiga language |
| CONSUL-03 | 45-03 | Painel com explicação por insight (por que importa / como resolver) | SATISFIED | MLConsultor.tsx: `insight.body` renders explanation; action button with `action_href` = deep-link to resolution |
| CONSUL-04 | 45-01, 45-02, 45-03 | Score de saúde 0-100 visível | SATISFIED | Score computed (Margem30/Ads25/Estoque20/Rep15/Comp10); ConsultorCard shows badge with band+trend; MLConsultor shows pillar breakdown |
| CONSUL-05 | 45-02 | Org Pé Vermeio gera ≥5 insights reais no primeiro run | SATISFIED | Smoke: 8 active insights (stock_critical, margin_critical, goal_at_risk, paused_with_sales, margin_alert, stock_alert, no_cost, claims_spike) |

---

### Anti-Patterns Found

No debt markers (TBD, FIXME, XXX) found in phase-modified files. No stubs, placeholders, or hardcoded empty returns. The two post-checkpoint deviations noted in 45-03-SUMMARY.md (gate changed from `onboardingComplete` to `connected`, and `?items=` deep-link filtering added) are both improvements — the first fixed a real bug that hid the card from established orgs, the second added requested functionality.

Non-blocking calibration notes from 45-02-SUMMARY.md (acknowledged by Wesley, adjustable via `consultor_config`):
- `goal_at_risk`: R$357k impact inflated (run-rate projection early in month)
- `claims_spike`: +2400% inflated due to low base in prior month

Neither is a BLOCKER — the thresholds are configurable and the insights do represent real operational signals.

---

### Human Verification Required

None — Wesley performed visual checkpoint on 2026-06-14 and approved:
- Card appears at top of /vendas with colored score + trend arrow
- Top 3 insights in leiga language with R$ loss framing
- Deep-links navigate to correct filtered pages (/anuncios, /estoque with ?items=)
- /consultor lists all 8 insights with body explanation + "como resolver" links
- Dismiss persists (insight does not reappear on reload)
- ≥5 insights confirmed (CONSUL-05)

All human verification items from Plan 03 Task 4 are closed.

---

## Gaps Summary

No gaps. All 5 success criteria verified against codebase artifacts and production runtime state.

---

_Verified: 2026-06-14T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
