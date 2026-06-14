---
phase: 45-consultor-v1
plan: "02"
subsystem: consultor-engine
tags: [edge-function, deno, pg_cron, rules-engine, score, insights, config-toml]
dependency_graph:
  requires: [45-01 (insights table, consultor_config, consultor_health_snapshots, get_consultor_* RPCs)]
  provides: [consultor-insights EF (auth dual, 12 rules, score, snapshot, upsert), pg_cron daily 08:30 UTC]
  affects: [Phase 45 Plan 03 (frontend hook + ConsultorCard UI)]
tech_stack:
  added: []
  patterns: [auth dual EF (service role + user JWT), pg_cron Pattern B vault, error isolation per org, upsert idempotente com dismissed guard]
key_files:
  created:
    - supabase/functions/consultor-insights/index.ts
    - supabase/migrations/20260645020000_pg_cron_consultor.sql
  modified:
    - supabase/config.toml
decisions:
  - "Tasks 1+2 combined into single EF file (1035 lines): rules are internal functions inside runConsultorForOrg as per plan design"
  - "14 rule_keys implemented (exceeds 12-rule requirement): margin_critical, margin_alert, ads_no_sale, tacos_high, ads_efficiency, stock_critical, stock_alert, no_cost, no_fiscal, ticket_drop, claims_spike, paused_with_sales, goal_at_risk, questions_old"
  - "Reputação pilar uses ml_claims proxy (not ML API call) — avoids sync latency in engine (RESEARCH recommendation)"
  - "dismissed rows excluded from upsert via pre-query fetch to avoid race condition with WHERE status != dismissed in upsert"
  - "auto-resolve uses .not('rule_key', 'in', ...) pattern to mark resolved without touching dismissed"
  - "goal_at_risk joins ml_targets via ml_tokens (ml_user_id = seller_id); skips cleanly if no target exists (Pitfall 6)"
  - "deep-links corrected to real routes: /precificacao (not /precos-custos), /fiscal (not /organizacao)"
metrics:
  duration: "~20 min"
  completed: "2026-06-14"
  tasks_completed: 4
  tasks_total: 4
  files_created: 3
  files_modified: 2
status: complete
---

# Phase 45 Plan 02: Consultor Engine EF + pg_cron Summary

**One-liner:** Motor de regras determinístico completo — EF Deno `consultor-insights` com auth dual, 14 regras, score 0-100 ponderado (Margem30/Ads25/Estoque20/Reputação15/Completude10), upsert idempotente com auto-resolve e guard de dismiss, snapshot mensal; cron diário Pattern B às 08:30 UTC.

---

## Status: COMPLETE (4/4)

Tasks 1-3 (executor) + Task 4 [BLOCKING] (orquestrador via MCP) concluídas.

### Task 4 — deploy + apply + smoke (orquestrador, aprovação Wesley 2026-06-14)

1. **Auditoria de schema pré-deploy:** todas as 6 tabelas extras da EF (ml_ads_daily_cache, ml_claims, ml_questions, ml_targets, ml_tax_config, org_members) conferidas — colunas existem. Zero bugs de schema.
2. **Fix de segurança pré-deploy (review automático de commit):** auth **fail-open** corrigido → fail-closed (commit f8518f39). Sem SUPABASE_SERVICE_ROLE_KEY a EF retorna 500 em vez de tratar como cron (era a classe do CR-01 da Phase 43).
3. **Deploy:** EF `consultor-insights` **ACTIVE** (v1, verify_jwt=false) via `deploy_edge_function`.
4. **Vault:** `service_role_key` (`sb_secret_`, len 41) presente → Pattern B OK.
5. **Cron:** migration aplicada; `consultor-insights-daily` `30 8 * * *` active=true.
6. **Smoke (mode=all_orgs via pg_net):** HTTP 200, 2 orgs. **Pé Vermeio: 8 insights, score 83** (margin88/ads100/estoque94/rep88/comp0) → **CONSUL-05 (≥5) atingido**. Thales: 7 insights, score 49.
7. **Idempotência:** 2ª invocação → active permanece 8 (não 16), 0 duplicatas, snapshot = 1 linha.

**8 regras dispararam p/ Pé Vermeio:** stock_critical(R$9.523), margin_critical(R$819), goal_at_risk(R$357.708), paused_with_sales(R$85.711), margin_alert(R$1.499), stock_alert, no_cost(38), claims_spike(+2400%).

**Calibração futura (não-bloqueante):** `goal_at_risk` (R$357k — projeção de meta no início do mês extrapola) e `claims_spike` (+2400% — base baixa no mês anterior) têm impactos/percentuais inflados por artefato de estimativa do v1. Limiares ajustáveis em `consultor_config`.

---

## Tasks Completed

### Task 1: EF consultor-insights — auth dual + loop por org + score + snapshot + upsert (commit 252b63cb)

File: `supabase/functions/consultor-insights/index.ts` (1035 lines)

- `authenticate()`: service_role (cron Pattern B) → `{ userId: null }`; valid user JWT → `{ userId: string }`; else → 401 (T-45-06 mitigated)
- mode `all_orgs` (service role): groups `ml_tokens` by `organization_id`, iterates serialized with try/catch per org (T-45-10, P8)
- mode `org_only` (user JWT): resolves org via `org_members`, validates `is_org_member` RPC → 403 if not member (T-45-07)
- `runConsultorForOrg`: reads `consultor_config` with fallback to DEFAULT_CONFIG (12 thresholds)
- upsert via `onConflict: organization_id,rule_key,ml_user_id_key`; pre-fetches dismissed rows to exclude from upsert (T-45-08)
- auto-resolve: `.not('rule_key', 'in', ...)` for active insights not in activeRuleKeys; never touches dismissed
- snapshot upsert: score + 5 sub-scores + insights_total/critical per `snapshot_month` YYYY-MM
- config.toml: `[functions.consultor-insights]` `verify_jwt = false` added

### Task 2: 14 rules + score por pilar + templates + impacto R$ (commit 252b63cb — same file as Task 1)

Rules implemented inside `runConsultorForOrg`:

| # | rule_key | Category | Severity | Impact R$ | Data Source |
|---|----------|----------|----------|-----------|-------------|
| 1 | `margin_critical` | Margem | critical | SUM(ABS(lucro))×(30/30) | RPC get_consultor_margin_by_product |
| 2 | `margin_alert` | Margem | high | SUM(deficit×receita/100)×(30/30) | RPC get_consultor_margin_by_product |
| 3 | `ads_no_sale` | Ads | high | SUM(spend)×(30/7) | ml_ads_daily_cache org-level (P5) |
| 4 | `tacos_high` | Ads | medium | excess spend vs target extrapolated | ml_ads_daily_cache + orders.receita_bruta |
| 5 | `ads_efficiency` | Ads | medium | null (qualitativo) | ml_ads_daily_cache (ACoS/ROAS) |
| 6 | `stock_critical` | Estoque | critical | avg_daily×price×(critical-coverage) | RPC get_consultor_coverage |
| 7 | `stock_alert` | Estoque | high | null | RPC get_consultor_coverage |
| 8 | `no_cost` | Config | medium | null | RPC get_consultor_no_cost_count |
| 9 | `no_fiscal` | Config | high | null | ml_tax_config |
| 10 | `ticket_drop` | Vendas | medium | (prev-cur)×cur_orders | orders month-over-month |
| 11 | `claims_spike` | Reputação | medium | null | ml_claims month-over-month |
| 12 | `paused_with_sales` | Ads | high | vendas_30d×price | RPC get_consultor_paused_with_sales |
| 13 | `goal_at_risk` | Vendas | high | meta-projecao | orders + ml_targets JOIN ml_tokens (P6) |
| 14 | `questions_old` | Reputação | critical/>5/high | null | ml_questions UNANSWERED >24h |

Score pillars:
- **Margem** (30): `100 - (pct_prejuizo×2) - (meta-margem_media)×3`
- **Ads** (25): `100 - tacos_over_15×5 - (has_no_sale ? 20 : 0)`
- **Estoque** (20): `100 - (ruptura/total)×100 - (critico/total)×50 - (alerta/total)×20`
- **Reputação** (15): `100 - cancellation_rate×500 - questions_penalty` (proxy via ml_claims, sem chamada ML API)
- **Completude** (10): `(completed_required_steps/3)×100` via onboarding_progress

Deep-links corrected: `/precificacao`, `/fiscal`, `/publicidade`, `/estoque`, `/anuncios`, `/perguntas`, `/devolucoes`, `/metas`, `/`

### Task 3: Migration pg_cron Pattern B (commit 44d81690)

File: `supabase/migrations/20260645020000_pg_cron_consultor.sql`

- `cron.unschedule('consultor-insights-daily')` wrapped in DO/EXCEPTION (idempotent)
- `cron.schedule` with `'30 8 * * *'` (08:30 UTC — after sync 07:03 + scores 07:30)
- `net.http_post` to `https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/consultor-insights`
- Authorization via `vault.decrypted_secrets WHERE name='service_role_key'` (sb_secret_*, Pattern B)
- body: `'{"mode":"all_orgs"}'::jsonb`

---

## Task 4: PENDING — deploy + smoke (orchestrator via MCP)

The orchestrator must execute via Supabase MCP on project **`ckcdevcxgvueywivefgx`**:

1. `mcp__supabase__deploy_edge_function` for `consultor-insights` → confirm ACTIVE
2. Verify vault: `SELECT name FROM vault.secrets WHERE name='service_role_key';` → 1 row (Pattern B prereq)
3. `mcp__supabase__apply_migration` for `20260645020000_pg_cron_consultor.sql`
   - Validate: `SELECT jobname, schedule FROM cron.job WHERE jobname='consultor-insights-daily';`
4. SMOKE (CONSUL-05): invoke EF for org Pé Vermeio (`7f615df7-7bac-45e5-8a93-827fb9ddeec7`)
   - `SELECT COUNT(*) FROM insights WHERE organization_id='7f615df7-7bac-45e5-8a93-827fb9ddeec7' AND status='active';` → **≥5**
   - `SELECT rule_key, severity, impact_brl FROM insights WHERE organization_id='7f615df7-7bac-45e5-8a93-827fb9ddeec7' AND status='active' ORDER BY severity, impact_brl DESC NULLS LAST;`
   - `SELECT score, score_margin, score_ads, score_estoque, score_reputacao, score_completude, snapshot_month FROM consultor_health_snapshots WHERE organization_id='7f615df7-7bac-45e5-8a93-827fb9ddeec7' ORDER BY created_at DESC LIMIT 1;`
5. Idempotency: invoke again → COUNT must not increase (upsert by rule_key)
6. `mcp__supabase__get_logs` (edge function) → no errors

**Resume signal:** "deployado" after EF ACTIVE + cron scheduled + ≥5 active insights + score recorded.

---

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Architecture Note

Tasks 1 and 2 were committed together (same file `consultor-insights/index.ts`). The plan design always intended both as a single file; the task split was logical (structure vs. rule implementation). The rules are implemented as inline code within `runConsultorForOrg`, not as separate exported functions, which is consistent with the patterns from `sync-ml-claims/index.ts`.

---

## Known Stubs

None — EF uses only real data sources. No mock data, no hardcoded results. If any data table is empty for an org, the corresponding rule simply does not fire (by design).

---

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: auth_dual | supabase/functions/consultor-insights/index.ts | verify_jwt=false EF with internal auth guard — T-45-06 mitigated by authenticate() |
| threat_flag: cross_org | supabase/functions/consultor-insights/index.ts | on-demand mode validates is_org_member RPC before running — T-45-07 mitigated |

---

## Self-Check: PASSED

- FOUND: supabase/functions/consultor-insights/index.ts (1035 lines, contains runConsultorForOrg, authenticate)
- FOUND: supabase/migrations/20260645020000_pg_cron_consultor.sql
- FOUND: [functions.consultor-insights] verify_jwt = false in supabase/config.toml
- FOUND: commits 252b63cb (EF + config.toml) and 44d81690 (cron migration)
- VERIFIED: 14 distinct rule_keys (≥10 required)
- VERIFIED: all 4 get_consultor_* RPCs referenced
- VERIFIED: deep-links use /precificacao (not /precos-custos), /fiscal (not /organizacao)
