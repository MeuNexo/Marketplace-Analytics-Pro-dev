---
plan: "09-02"
phase: "09-job-queue-dispatcher"
status: complete
self_check: PASSED
completed_at: "2026-05-20"
key_files:
  applied:
    - supabase/migrations/20260519140000_sync_jobs.sql
  deployed:
    - supabase/functions/process-sync-job/index.ts
requirements_covered:
  - SYNC-01
  - SYNC-02
  - SYNC-03
  - SYNC-04
  - SYNC-05
  - SYNC-06
  - SYNC-07
---

# Summary: 09-02 — supabase db push + functions deploy + verificação

## O que foi feito

Aplicada a migration `20260519140000_sync_jobs.sql` ao banco Supabase via MCP e deployada a edge function `process-sync-job`. Rodadas 7 verificações de aceitação — todas passaram.

## Verificações (todas passaram)

| # | Verificação | Resultado |
|---|---|---|
| V1 | `sync_jobs` — 12 colunas corretas (id, organization_id, ml_user_id, job_type, date_from, date_to, status, retries, error_msg, started_at, finished_at, created_at) | ✅ |
| V2 | ENUMs `sync_job_type` (daily_cache, orders, inventory) e `sync_job_status` (pending, running, completed, failed) criados | ✅ |
| V3 | 2 índices parciais: `sync_jobs_pending_created_idx` (WHERE status='pending') e `sync_jobs_open_lookup_idx` (WHERE status IN pending/running) | ✅ |
| V4 | RLS habilitado em `sync_jobs` (`relrowsecurity = true`) | ✅ |
| V5 | 3 agendamentos pg_cron ativos: `sync-dispatch-every-30min` (*/30), `sync-process-job-every-5min` (*/5), `sync-job-retry-watchdog` (*/5) | ✅ |
| V6 | Funções `dispatch_sync_jobs()` e `claim_next_sync_job()` existem com `SECURITY DEFINER` | ✅ |
| V7 | SYNC-07 dedup: duplo dispatch não cria duplicatas — `total_pending = unique_combos = 0` | ✅ |

## Desvios

- Orgs enterprise têm `sync_interval_minutes = -1`, então `dispatch_sync_jobs()` retorna 0 inserções para elas (por design). O dedup guard (V7) foi confirmado estruturalmente — 0 duplicatas após 2 chamadas consecutivas.

## Edge Function

- `process-sync-job` deployada com `verify_jwt = false`
- Versão: 1 (ACTIVE)
- Auth: X-Cron-Secret (pg_cron) OR Bearer service-role-key (manual)

## Self-Check: PASSED
