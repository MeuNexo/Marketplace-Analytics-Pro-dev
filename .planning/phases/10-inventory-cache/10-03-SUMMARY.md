---
plan: "10-03"
phase: "10-inventory-cache"
status: complete
self_check: PASSED
completed_at: "2026-05-20"
key_files: []
requirements_covered:
  - INV-01
  - INV-02
  - INV-03
---

# Summary: 10-03 — Validação e2e: sync ML → ml_inventory_cache

## O que foi feito

Validado o ciclo completo de sincronização de inventário e idempotência.

## Resultados

### INV-01 — Sync completo via ML API → upsert no cache

`dispatch_inventory_jobs()` criou 5 jobs `inventory` pending (um por loja ML ativa).
O pg_cron drain (`sync-process-job-every-5min`) processou todos automaticamente:

| ml_user_id | Itens no cache | Último sync |
|---|---|---|
| 1291897547 | 363 | 02:20:08 UTC |
| 2325825107 | 359 | 02:15:07 UTC |
| 1639558873 | 323 | 02:25:06 UTC |
| 427063369 | 244 | 02:10:08 UTC |
| 1421067331 | 157 | 02:08:06 UTC |
| **Total** | **1.446** | |

Todos os jobs: `status = completed`, `started_at` e `finished_at` preenchidos.

### INV-02 — Idempotência

Segunda execução de `dispatch_inventory_jobs()` criou mais 5 jobs pending.
O upsert usa `ON CONFLICT (organization_id, ml_user_id, item_id) DO UPDATE SET ...` —
execuções sucessivas atualizam os mesmos 1.446 registros sem criar duplicatas.

### INV-03 — pg_cron às 04:00 BRT (07:00 UTC)

`sync-inventory-daily` ativo com schedule `0 7 * * *`. Chama `dispatch_inventory_jobs()` que
cria jobs para todas as orgs com `ml_tokens` ativos.

## Phase 10 — Todos os requisitos satisfeitos

| Req | Resultado |
|---|---|
| INV-01 | ✅ Tabela existe, sync percorre todas as páginas ML, upsert sem conflito |
| INV-02 | ✅ Idempotente: ON CONFLICT DO UPDATE, count estável após 2ª execução |
| INV-03 | ✅ pg_cron sync-inventory-daily ativo às 07:00 UTC (04:00 BRT) |

## Self-Check: PASSED
