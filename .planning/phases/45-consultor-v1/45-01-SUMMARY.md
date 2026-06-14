---
phase: 45-consultor-v1
plan: "01"
subsystem: consultor-database
tags: [migration, rls, rpc, types, supabase]
dependency_graph:
  requires: [Phase 43 onboarding_progress, is_org_member, get_org_role]
  provides: [insights table, consultor_config table, consultor_health_snapshots table, get_consultor_* RPCs, TS types]
  affects: [Phase 45 Plan 02 (engine EF), Phase 45 Plan 03 (frontend hook)]
tech_stack:
  added: []
  patterns: [RLS org-first, SECURITY DEFINER RPC, migration idempotente]
key_files:
  created:
    - supabase/migrations/20260645000000_consultor_tables.sql
    - supabase/migrations/20260645010000_consultor_engine_rpcs.sql
  modified:
    - src/integrations/supabase/types.ts
decisions:
  - "insights usa coluna helper ml_user_id_key (text DEFAULT '') + UNIQUE INDEX normal, não índice funcional com COALESCE (Pitfall 7 — mais robusto)"
  - "TACoS e meta usam orders.receita_bruta (não ml_daily_cache.approved_revenue que é scoped por user_id)"
  - "4 RPCs SECURITY DEFINER para margem/cobertura/pausados/sem-custo — engine invoca via service_role para evitar truncamento PostgREST 1000 linhas"
metrics:
  duration: "~4 min"
  completed: "2026-06-14"
  tasks_completed: 3
  tasks_total: 4
  files_created: 2
  files_modified: 1
---

# Phase 45 Plan 01: Consultor Tables + Engine RPCs Summary

**One-liner:** Fundação de dados do Consultor v1 — 3 tabelas (insights, config, snapshots) com RLS org-first + 4 RPCs SECURITY DEFINER para o engine. Aguardando apply das migrations via MCP.

---

## Status: PARADO EM CHECKPOINT (Task 4 [BLOCKING])

Tasks 1-3 executadas e commitadas. Task 4 requer aplicação das migrations no banco `ckcdevcxgvueywivefgx` via MCP `apply_migration` — o executor não tem acesso ao Supabase MCP.

**As migrations NÃO foram aplicadas ao banco.** O orquestrador deve aplicá-las via MCP.

---

## Tasks Completed

### Task 1: Migration das 3 tabelas (commit e8edeb55)

Arquivo: `supabase/migrations/20260645000000_consultor_tables.sql`

- **`insights`**: uuid PK, organization_id FK ON DELETE CASCADE, ml_user_id (nullable), ml_user_id_key (helper col DEFAULT ''), rule_key, category, severity (CHECK: critical/high/medium), title, body, action_label, action_href, impact_brl (nullable), status (CHECK: active/resolved/dismissed, DEFAULT active), created_at, updated_at, resolved_at, dismissed_at. Index `insights_dedup_idx (org, rule_key, ml_user_id_key)` UNIQUE + `insights_org_status_idx`. RLS: SELECT=is_org_member; UPDATE=is_org_member (dismiss); sem INSERT/DELETE para authenticated.

- **`consultor_config`**: PK=organization_id, 12 limiares com defaults exatos do RESEARCH (margin_critical_pct=0, margin_alert_pct=10, tacos_alert_pct=15, acos_alert_pct=30, roas_min=3, ads_no_sale_days=7, stock_critical_days=7, stock_alert_days=15, ticket_drop_pct=10, claims_spike_pct=20, goal_risk_pct=10, paused_ads_lookback_days=30). RLS: SELECT=is_org_member; ALL=get_org_role='owner'.

- **`consultor_health_snapshots`**: uuid PK, organization_id FK, score (integer), 5 sub-scores, insights_total, insights_critical, snapshot_month (char(7)), UNIQUE (org, snapshot_month). RLS: SELECT=is_org_member; sem escrita para authenticated.

- Toda migration idempotente: IF NOT EXISTS, DROP POLICY IF EXISTS, DO/EXCEPTION para CHECKs.

### Task 2: RPCs SECURITY DEFINER (commit bd565ae2)

Arquivo: `supabase/migrations/20260645010000_consultor_engine_rpcs.sql`

1. `get_consultor_margin_by_product(p_org_id, p_user_ids, p_from, p_to)` → TABLE(item_id, receita, lucro, lucro_pct) — margem real por produto sem limite de linhas
2. `get_consultor_coverage(p_org_id, p_from)` → TABLE(item_id, title, price, coverage_days, avg_daily) — cobertura em dias por item ativo
3. `get_consultor_paused_with_sales(p_org_id, p_from)` → TABLE(item_id, title, price, vendas_30d) — anúncios pausados com histórico de venda
4. `get_consultor_no_cost_count(p_org_id)` → integer — COUNT de ativos sem CMV (match por item_id OU seller_sku)

Todas: LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public. GRANT EXECUTE a service_role.

**Nota documentada no arquivo**: TACoS e meta usam `orders.receita_bruta` inline na EF, não `ml_daily_cache.approved_revenue` (scoped por user_id, não por organization_id).

### Task 3: Tipos TS (commit 1f5291a8)

Arquivo: `src/integrations/supabase/types.ts`

Adicionadas manualmente as 3 tabelas no bloco `public.Tables` com Row/Insert/Update:
- `consultor_config`: todos os 12 limiares tipados como `number`, `organization_id: string`
- `consultor_health_snapshots`: 5 pilares + snapshot_month + id + created_at
- `insights`: todos os campos incluindo `ml_user_id_key: string`, `impact_brl: number | null`, `resolved_at: string | null`, `dismissed_at: string | null`

`npx tsc --noEmit` passa sem erros.

---

## Deviations from Plan

### Auto-fixed Issues

None — plan executado exatamente como escrito.

### Architecture Note (Resolved Open Question A4/Q3)

A coluna helper `ml_user_id_key text NOT NULL DEFAULT ''` foi escolhida sobre índice funcional `COALESCE(ml_user_id, '')` — conforme resolução Q3 do RESEARCH.md. Isso é mais robusto no PostgreSQL 14 do Supabase e é o padrão confirmado.

---

## Task 4: BLOQUEADA — Aguarda Apply via MCP

**O que deve ser aplicado:**
1. `supabase/migrations/20260645000000_consultor_tables.sql` via `mcp__supabase__apply_migration` no projeto `ckcdevcxgvueywivefgx`
2. `supabase/migrations/20260645010000_consultor_engine_rpcs.sql` via `mcp__supabase__apply_migration` no mesmo projeto

**Validações pós-apply:**
- `SELECT to_regclass('public.insights'), to_regclass('public.consultor_config'), to_regclass('public.consultor_health_snapshots');` → 3 não-nulos
- `SELECT COUNT(*) FROM pg_proc WHERE proname LIKE 'get_consultor_%';` → ≥ 4
- `SELECT indexname FROM pg_indexes WHERE tablename='insights';` → contém `insights_dedup_idx`
- Verificar nomes de coluna reais de `orders`/`ml_inventory_cache`/`ml_product_daily_cache` contra as RPCs; se houver divergência, corrigir o .sql e reaplicar

---

## Known Stubs

None — este plano cria apenas infraestrutura SQL + tipos. Nenhum componente UI ou dado mock.

---

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| RLS policies | 20260645000000_consultor_tables.sql | 3 novas tabelas em trust boundary authenticated→DB; T-45-01..04 cobertos por is_org_member + get_org_role policies |
| SECURITY DEFINER RPCs | 20260645010000_consultor_engine_rpcs.sql | Cross-table read sem RLS; mitigado por GRANT EXECUTE apenas a service_role + filtro org explícito em todas as RPCs |

---

## Self-Check: PASSED

- FOUND: supabase/migrations/20260645000000_consultor_tables.sql
- FOUND: supabase/migrations/20260645010000_consultor_engine_rpcs.sql
- FOUND: insights entry in src/integrations/supabase/types.ts
- FOUND: all 3 commits (e8edeb55, bd565ae2, 1f5291a8)
