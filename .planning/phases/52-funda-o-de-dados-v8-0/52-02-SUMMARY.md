---
phase: 52-funda-o-de-dados-v8-0
plan: 02
subsystem: data-types
tags: [supabase, typescript, types, v8.0, consultor-v2]
requires:
  - "52-01: migrations v8.0 aplicadas em ckcdevcxgvueywivefgx (3 tabelas novas + 5 colunas)"
provides:
  - "src/integrations/supabase/types.ts refletindo o schema v8.0 (tipos para fases 53–56)"
affects:
  - "src/integrations/supabase/types.ts"
tech-stack:
  added: []
  patterns:
    - "Edição manual de types.ts (CLI linkado no projeto errado gionpsuunfkkzzjdubfy → supabase gen types proibido; precedente Phase 18-02)"
    - "Nullability: NOT NULL DEFAULT → obrigatório no Row, opcional (?) no Insert/Update; NULL → | null"
key-files:
  created: []
  modified:
    - "src/integrations/supabase/types.ts"
decisions:
  - "types.ts editado à mão espelhando o DDL das migrations 20260652* (fonte da verdade), não via supabase gen types — CLI aponta para o projeto errado"
  - "Colunas e blocos inseridos em ordem alfabética, idêntico ao estilo dos blocos existentes (action_audit_log antes de audit_log; llm_analysis_cache entre insights e member_route_permissions; proposed_actions entre profiles e seller_stores)"
metrics:
  duration: "~6 min"
  completed: "2026-06-24"
status: complete
---

# Phase 52 Plan 02: Atualização manual de types.ts (schema v8.0) Summary

Atualização manual de `src/integrations/supabase/types.ts` para refletir o schema v8.0 do Consultor v2 — 3 tabelas novas (proposed_actions, action_audit_log, llm_analysis_cache) e 5 colunas novas em 3 tabelas existentes (insights, consultor_config, consultor_health_snapshots) — com `tsc --noEmit` e `npm run build` verdes.

## O que foi feito

### Task 1 — Colunas novas nas 3 tabelas existentes
Adicionadas em ordem alfabética dentro de cada sub-bloco Row/Insert/Update, espelhando `20260652000200_v8_alter_existing.sql`:

- **consultor_config**: `llm_enabled: boolean` e `llm_model: string` (ambos NOT NULL DEFAULT → obrigatórios no Row, opcionais `?` no Insert/Update).
- **consultor_health_snapshots**: `ml_user_id_key: string` (NOT NULL DEFAULT '' → obrigatório no Row, opcional no Insert/Update).
- **insights**: `snooze_count: number` (NOT NULL DEFAULT 0 → obrigatório no Row, opcional no Insert/Update) e `snoozed_until: string | null` (timestamptz NULL → `string | null` no Row, `snoozed_until?: string | null` no Insert/Update).

Relationships dos 3 blocos não foram tocadas (FKs inalteradas).

### Task 2 — 3 blocos de tabela novos + verificação de build
Inseridos com Row/Insert/Update/Relationships no estilo do bloco `insights` (org-first com FK para organizations), na posição alfabética correta dentro de `Tables`:

- **action_audit_log** (antes de `audit_log`): append-only; `actor_id`/`detail` nullable (`| null`); FKs para `proposed_actions(id)` e `organizations(id)`. `detail` jsonb → `Json | null`.
- **llm_analysis_cache** (entre `insights` e `member_route_permissions`): `prompt_hash`/`tokens_used` nullable; obrigatórios no Insert = organization_id, analysis_date, model_used, analysis_text; `prompt_version`/`insight_count`/`id`/`created_at` opcionais (têm default). FK para `organizations(id)`.
- **proposed_actions** (entre `profiles` e `seller_stores`): state-machine via `status: string`; jsonb `current_value`/`dry_run_preview` → `Json | null`, `proposed_value` → `Json` (NOT NULL); obrigatórios no Insert = organization_id, rule_key, action_type, target_ref, proposed_value, proposed_by; FKs para `insights(id)` e `organizations(id)`.

## Verificação

- `grep -c llm_enabled` = 3; `llm_model` = 3; `snoozed_until` = 3; `snooze_count` = 3; `ml_user_id_key` = 6 (3 insights pré-existentes + 3 consultor_health_snapshots novos).
- `grep -c "proposed_actions:"` = 1; `"action_audit_log:"` = 1; `"llm_analysis_cache:"` = 1.
- **`npx tsc --noEmit`**: PASS (exit 0, sem erros — consumidores existentes compilam com o novo types.ts).
- **`npm run build`**: PASS (exit 0, `✓ built in 15.40s`). Avisos de chunk > 500 kB são pré-existentes e informativos, não erros.

## Deviations from Plan

None - plan executed exactly as written.

## Threat surface
T-52-08 (drift de tipo) mitigado: types.ts espelha manualmente o DDL das migrations 20260652* e `tsc --noEmit` + `npm run build` verdes confirmam consistência com os consumidores. Sem nova superfície de ameaça introduzida. Sem instalação de pacotes.

## Self-Check: PASSED

- Arquivo modificado existe: `src/integrations/supabase/types.ts` (FOUND).
- tsc exit 0, build exit 0 — verificados nesta execução.
- Sem commit nesta etapa (orquestrador commita a Phase 52 inteira), conforme instruções.
