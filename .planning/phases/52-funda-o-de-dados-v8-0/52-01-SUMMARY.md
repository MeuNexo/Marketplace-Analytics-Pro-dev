---
phase: 52-funda-o-de-dados-v8-0
plan: 01
subsystem: data-schema
tags: [supabase, migrations, rls, state-machine, multi-tenant, consultor-v2]
requires:
  - public.organizations
  - public.insights
  - public.consultor_config
  - public.consultor_health_snapshots
  - public.is_org_member
  - public.get_org_role
  - public.org_role
provides:
  - public.proposed_actions
  - public.action_audit_log
  - public.llm_analysis_cache
  - public.claim_approved_action
  - insights.snoozed_until
  - consultor_config.llm_enabled
  - consultor_health_snapshots.ml_user_id_key
affects:
  - supabase/migrations
tech-stack:
  added: []
  patterns:
    - org-first RLS (is_org_member / get_org_role)
    - state-machine via text + CHECK (não enum nativo)
    - índice UNIQUE PARCIAL para dedup de ações abertas
    - append-only por ausência-de-grant (default-deny)
    - RPC SECURITY INVOKER + REVOKE EXECUTE de PUBLIC/anon/authenticated
key-files:
  created:
    - supabase/migrations/20260652000000_v8_action_tables.sql
    - supabase/migrations/20260652000100_v8_llm_cache.sql
    - supabase/migrations/20260652000200_v8_alter_existing.sql
    - supabase/migrations/20260652000300_v8_action_transition_rpc.sql
  modified: []
decisions:
  - "status/action_type como text + CHECK idempotente (DO/EXCEPTION), nunca enum nativo (Pitfall P5)"
  - "prompt_version entra na UNIQUE do cache (SC-1); prompt_hash fica como coluna de staleness fora da key (Pitfall P2)"
  - "imutabilidade do action_audit_log = ausência de policy INSERT/UPDATE/DELETE para authenticated; sem trigger"
  - "claim_approved_action é SECURITY INVOKER (RLS enforça escopo, anti-IDOR) + REVOKE de PUBLIC/anon/authenticated (Pitfall P4)"
  - "WITH CHECK do UPDATE authenticated limita status a ('approved','rejected') — owner nunca forja executing/done/failed (Pitfall P7)"
metrics:
  duration: ~2min
  completed: 2026-06-24
status: complete
---

# Phase 52 Plan 01: Fundação de Dados v8.0 (schema) Summary

Quatro migrations idempotentes de fundação do Consultor v2 escritas em `supabase/migrations/` com prefixo `20260652*` (ordena após `20260650000400`): 3 tabelas novas (`proposed_actions`, `action_audit_log`, `llm_analysis_cache`), os ALTERs de extensão (`insights`/`consultor_config`/`consultor_health_snapshots`) e a RPC de transição atômica `claim_approved_action`. RLS org-first, state-machine de 6 estados via CHECK, dedup parcial e REVOKE de EXECUTE público — todos replicando verbatim os padrões em produção do Consultor v1.

## Escopo deste executor (Tasks 1, 2, 3)

O gsd-executor **apenas escreveu os arquivos `.sql`**. A aplicação (Task 4) é um `checkpoint:human-action gate="blocking-human"` do **orquestrador** via MCP `apply_migration` em `ckcdevcxgvueywivefgx` + `get_advisors` — gsd-executor não tem MCP/deploy Supabase. **Apply PENDENTE orquestrador.**

## O que foi escrito

### M1 — `20260652000000_v8_action_tables.sql`
- `proposed_actions`: 20 colunas conforme DDL do research, incluindo as colunas de auditoria (`approved_by`/`approved_at`/`executed_at`/`result_summary`) já agora (Pitfall P6).
- CHECK `status` (6 estados: proposed/approved/rejected/executing/done/failed) e CHECK `action_type` (5 tipos), ambos idempotentes via `DO/EXCEPTION duplicate_object`.
- Índice `proposed_actions_open_dedup` UNIQUE **PARCIAL** `WHERE status IN ('proposed','approved','executing')` (SC-2) + `proposed_actions_org_status_idx`.
- RLS: SELECT (is_org_member), INSERT (membro força `proposed_by=auth.uid()` + `status='proposed'`), UPDATE (owner only, WITH CHECK `status IN ('approved','rejected')` — nunca executing/done/failed, Pitfall P7). Sem DELETE.
- `action_audit_log`: append-only com **apenas** policy de SELECT (is_org_member). Sem INSERT/UPDATE/DELETE para authenticated → escrita só via service_role. Índices `audit_log_action_idx` e `audit_log_org_idx`. Cap de 4KB em `detail` documentado como responsabilidade do executor (fase 54), não CHECK no schema (Q4).

### M2 — `20260652000100_v8_llm_cache.sql`
- `llm_analysis_cache` org-first; UNIQUE `(organization_id, analysis_date, prompt_version)` com `organization_id` liderando a key (anti cross-tenant leak, Pitfall P1).
- `prompt_hash text NULL` separado da key (staleness LLM-06, não dedup, Pitfall P2).
- Índice `llm_cache_org_date_idx`. RLS SELECT-only (is_org_member); escrita só via service_role (EF fase 53).

### M3 — `20260652000200_v8_alter_existing.sql`
- `insights`: `+snoozed_until timestamptz NULL`, `+snooze_count int NOT NULL DEFAULT 0`. Sem policy nova (insights_dismiss já cobre, Pitfall P8). NÃO re-adiciona `ml_user_id`/`ml_user_id_key`.
- `consultor_config`: `+llm_enabled boolean NOT NULL DEFAULT true`, `+llm_model text NOT NULL DEFAULT 'claude-haiku-4-5'`. NÃO re-adiciona os 14 limiares existentes.
- `consultor_health_snapshots`: `+ml_user_id_key text NOT NULL DEFAULT ''`; `DROP CONSTRAINT IF EXISTS snapshots_org_month`; `ADD CONSTRAINT snapshots_org_store_month UNIQUE (organization_id, ml_user_id_key, snapshot_month)` dentro de `DO/EXCEPTION` (troca re-entrant, Pitfall P3).

### M4 — `20260652000300_v8_action_transition_rpc.sql`
- `claim_approved_action(p_action_id uuid) RETURNS public.proposed_actions`, LANGUAGE sql, **SECURITY INVOKER**, `SET search_path = public`. Gate atômico `UPDATE ... WHERE id = p_action_id AND status = 'approved' RETURNING *` (0 linhas = já reivindicada → anti-TOCTOU).
- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role` (Pitfall P4).

## Decisões principais

- **Status como CHECK, nunca enum** — alterável por migration; padrão `insights.status`.
- **prompt_version na key, prompt_hash fora** — segue SC-1 (diverge do ARCHITECTURE que usava só prompt_hash); isola caches por bump de prompt sem invalidar todas as orgs.
- **Imutabilidade por ausência-de-grant** — padrão do projeto; sem trigger defensivo.
- **RPC INVOKER + REVOKE** — RLS enforça escopo (anti-IDOR); REVOKE evita advisor `*_security_definer_function_executable`.
- Comentário do header de M4 reformulado ("rodar como INVOKER") para que `grep -c "SECURITY INVOKER"` retorne exatamente 1 (só a definição da função), atendendo ao critério do plano.

## Deviations from Plan

None - os 4 arquivos foram escritos exatamente como especificado nos blocos `<action>`. Único ajuste: reformulação textual de um comentário no header de M4 para satisfazer o critério `grep -c "SECURITY INVOKER" == 1` (sem mudança de DDL/semântica).

## Known Stubs

None - fase de dados pura; nenhum stub de UI/dados.

## Task 4 (apply) — PENDENTE ORQUESTRADOR

O orquestrador aplica via MCP `apply_migration` em `ckcdevcxgvueywivefgx`, na ordem 000000 → 100 → 200 → 300, rodando `get_advisors` após cada apply. NUNCA `supabase db push` (CLI linkado no projeto errado `gionpsuunfkkzzjdubfy`). Validação SC-1..SC-5 via `execute_sql`/`list_tables`/`get_advisors`.

## Verificação automatizada (greps do plano) — todos PASS

| Check | Resultado |
|-------|-----------|
| M1 `WHERE status IN ('proposed','approved','executing')` | 1 (≥1 OK) |
| M1 `CREATE TABLE ... proposed_actions` / `action_audit_log` | 1 / 1 |
| M1 action_audit_log → só policy `audit_log_select` | OK |
| M1 UPDATE WITH CHECK `status IN ('approved','rejected')`, sem executing/done/failed | OK |
| M2 `UNIQUE (organization_id, analysis_date, prompt_version)` | 1 (≥1 OK) |
| M2 `prompt_hash text NULL` separado da key | presente |
| M3 `ADD COLUMN IF NOT EXISTS` | 6 (≥5 OK) |
| M3 não re-adiciona `insights.ml_user_id` | 0 OK |
| M3 troca de UNIQUE (DROP + ADD snapshots_org_store_month) | OK |
| M4 `SECURITY INVOKER` | 1 (==1 OK) |
| M4 REVOKE PUBLIC/anon/authenticated + GRANT service_role | 1 / 1 |

## Self-Check: PASSED

Arquivos confirmados em disco (4/4); greps de aceitação 11/11 PASS. Sem commits (orquestrador commita após aplicar — Task 4).
