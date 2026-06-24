---
phase: 52-funda-o-de-dados-v8-0
status: passed
verified: 2026-06-24
method: execute_sql + get_advisors em ckcdevcxgvueywivefgx (MCP)
---

# Verificação — Phase 52: Fundação de Dados v8.0

Verdito: **PASSED** (6/6 Success Criteria confirmados em produção).

Migrations aplicadas via MCP `apply_migration` em `ckcdevcxgvueywivefgx`:
`20260652000000_v8_action_tables` → `..000100_v8_llm_cache` → `..000200_v8_alter_existing` → `..000300_v8_action_transition_rpc`.

## Success Criteria

| SC | Critério | Evidência | Status |
|----|----------|-----------|--------|
| SC-1 | `llm_analysis_cache` org-first key `(organization_id, analysis_date, prompt_version)` + RLS | tabela criada; UNIQUE `llm_cache_org_date_version` org-first; policy `llm_cache_select` (is_org_member); sem policy de escrita p/ authenticated | ✓ |
| SC-2 | `proposed_actions` 6 estados + dedup parcial | CHECK status (6) + CHECK action_type (5); índice UNIQUE PARCIAL `proposed_actions_open_dedup ... WHERE status IN ('proposed','approved','executing')` (confirmado: dedup_index=1) | ✓ |
| SC-3 | `action_audit_log` append-only | tabela criada; APENAS policy `audit_log_select`; sem INSERT/UPDATE/DELETE p/ authenticated (default-deny) | ✓ |
| SC-4 | colunas novas | `insights.snoozed_until`=1, `consultor_config.llm_enabled`=1, `consultor_health_snapshots.ml_user_id_key`=1; `ml_user_id` e os 14 limiares NÃO re-adicionados | ✓ |
| SC-5 | RPC transição atômica INVOKER + REVOKE | `claim_approved_action` existe; `pg_proc.prosecdef = false` (SECURITY INVOKER, não DEFINER); EXECUTE revogado de PUBLIC/anon/authenticated (não aparece nos advisors de SECURITY DEFINER executável) | ✓ |
| SC-6 | types.ts + advisors sem erro novo + build | types.ts atualizado manual (3 tabelas + 5 colunas); `tsc --noEmit` PASS; `npm run build` PASS; get_advisors sem erro crítico NOVO (claim_approved_action ausente; 3 tabelas novas com RLS+policy fora do rls_enabled_no_policy) | ✓ |

## Notas
- Todos os WARNs do `get_advisors` são **pré-existentes** (helpers org-role/dispatch jobs com search_path mutável + SECURITY DEFINER executável por anon; `cat_backfill_queue` rls_enabled_no_policy; leaked-password off) — backlog já registrado no fechamento da Phase 47, NÃO introduzido pela Phase 52.
- 4 migrations idempotentes commitadas em `supabase/migrations/` (source of truth), aplicadas via MCP (CLI local linkado no projeto errado — nunca `db push`).

## Desbloqueio
Phase 52 desbloqueia 53 (LLM), 54 (Ações), 55 (Multi-Loja), 56 (Snooze/Limiares). 53 e 54 podem rodar em paralelo.
