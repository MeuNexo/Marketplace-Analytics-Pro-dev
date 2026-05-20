---
phase: 09-job-queue-dispatcher
plan: "01"
status: completed
executed_at: 2026-05-20
---

# Plan 09-01 — Summary

## Objetivo

Criar a infraestrutura completa de fila de jobs para a Phase 9: migration SQL com ENUMs, tabela `sync_jobs`, RLS, funções PL/pgSQL e agendamentos pg_cron; edge function `process-sync-job`; entrada em `config.toml`.

## Artefatos Produzidos

| Arquivo | Descrição |
|---------|-----------|
| `supabase/migrations/20260519140000_sync_jobs.sql` | DDL completo: 2 ENUMs, tabela `sync_jobs` com 12 campos, 2 indexes parciais, RLS com policy SELECT, `dispatch_sync_jobs()` SECURITY DEFINER, `claim_next_sync_job()` com FOR UPDATE SKIP LOCKED, 3 agendamentos pg_cron |
| `supabase/functions/process-sync-job/index.ts` | Edge function: auth dual (X-Cron-Secret + service role key), claim atômico via `sb.rpc('claim_next_sync_job')`, dispatch para `sync-ml-orders`, graceful failure para `daily_cache`/`inventory`, status sempre atualizado com `finished_at` |
| `supabase/config.toml` | Entrada `[functions.process-sync-job]` com `verify_jwt = false` adicionada |

## Tasks Executadas

### Task 1 — Migration SQL
- ENUMs `sync_job_type` e `sync_job_status` criados
- Tabela `sync_jobs` com todos os 12 campos especificados em SYNC-01
- Index `sync_jobs_pending_created_idx` (WHERE status = 'pending') para drain eficiente
- Index `sync_jobs_open_lookup_idx` (WHERE status IN ('pending', 'running')) para dedup de dispatch
- RLS: habilitado com policy SELECT via `is_org_member`; sem policies INSERT/UPDATE/DELETE para `authenticated`
- `dispatch_sync_jobs()`: SECURITY DEFINER, loop sobre `ml_tokens`, guard SYNC-07 (NOT EXISTS pending/running), verificação de intervalo via `organization_plans`
- `claim_next_sync_job()`: SECURITY DEFINER, FOR UPDATE SKIP LOCKED para claim concurrency-safe
- 3 pg_cron: `sync-dispatch-every-30min` (*/30), `sync-process-job-every-5min` (*/5), `sync-job-retry-watchdog` (*/5) com backoff 5/15/30 min e cap em retries < 3
- Unschedule idempotente via `DO $$ BEGIN PERFORM cron.unschedule(...); EXCEPTION WHEN OTHERS THEN NULL; END $$;`

### Task 2 — Edge Function process-sync-job
- Auth dual: X-Cron-Secret (pg_cron automático, validado via vault REST API) OU Bearer service role key (invocações manuais)
- Dev local: sem guard quando `SUPABASE_SERVICE_ROLE_KEY` não configurado
- Claim atômico via `sb.rpc('claim_next_sync_job')` — usa FOR UPDATE SKIP LOCKED internamente
- job_type `orders`: invoca `sync-ml-orders` com `ml_user_id`, `date_from`, `date_to`; marca `completed` se `resp.ok`
- job_type `daily_cache`/`inventory`: marca `failed` com `error_msg: "not yet supported in Phase 9: ..."` sem crash
- Catch global: sempre atualiza `status = 'failed'` com `error_msg` e `finished_at` para evitar jobs presos em 'running'
- Retorno 200 `{ ok: true, msg: "no pending jobs" }` quando fila vazia

### Task 3 — config.toml
- Entrada `[functions.process-sync-job]` com `verify_jwt = false` adicionada após `[functions.recalc-order-costs]`

## Commits

| Commit | Mensagem |
|--------|---------|
| `e21a289` | feat(09-01): migration SQL — sync_jobs table, ENUMs, RLS, dispatch_sync_jobs(), pg_cron schedules |
| `d9ed381` | feat(09-01): edge function process-sync-job — auth dual, claim atômico, dispatch, status tracking |
| `2873fd1` | feat(09-01): config.toml — adicionar [functions.process-sync-job] com verify_jwt = false |

## Verificação

Todos os checks do plano passaram:

```
Migration:
  CREATE TYPE public.sync_job_type       ✓ (1)
  CREATE TYPE public.sync_job_status     ✓ (1)
  CREATE TABLE public.sync_jobs          ✓ (1)
  claim_next_sync_job                    ✓ (3)
  FOR UPDATE SKIP LOCKED                 ✓ (2)
  sync-dispatch-every-30min              ✓ (2)
  sync-process-job-every-5min            ✓ (2)
  sync-job-retry-watchdog                ✓ (2)
  retries < 3 (com espaços extras)       ✓
  ENABLE ROW LEVEL SECURITY              ✓ (1)
  is_org_member                          ✓ (1)

Edge function:
  requireCronOrServiceRole/x-cron-secret ✓ (7)
  claim_next_sync_job                    ✓ (2)
  sync-ml-orders                         ✓ (3)
  completed                              ✓ (3)
  failed                                 ✓ (2)
  finished_at                            ✓ (3)
  not yet supported                      ✓ (2)

config.toml:
  [functions.process-sync-job]           ✓ (1)
  verify_jwt = false                     ✓
```

## Observações

- Os três arquivos já existiam no worktree (criados por agente anterior ao iniciar esta sessão de execução). Verificação confirma que todos os artefatos atendem completamente aos acceptance criteria do plano.
- O `CRON_SECRET` no vault não foi recriado — referenciado apenas via `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)` conforme instrução do plano.
- `config.toml` já continha a entrada antes da sessão (modificação prévia não commitada); o commit formalizou essa mudança.

## Próximo Passo

Plan 09-02: aplicar a migration ao banco remoto via `supabase db push` e implantar a edge function via `supabase functions deploy process-sync-job`.
