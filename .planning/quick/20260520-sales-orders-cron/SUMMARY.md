---
slug: sales-orders-cron
status: complete
completed_at: "2026-05-20"
commit: fcb74e4
---

# Summary: pg_cron vendas e pedidos

## O que foi feito

- `dispatch_sales_jobs()`: cria jobs `daily_cache` com `date_from = D-1, date_to = D-1` para todas as orgs com ml_tokens ativos. Deduplicação por `(ml_user_id, job_type, date_from)`.
- `dispatch_orders_jobs()`: mesma lógica para `job_type = orders`.
- `sync-sales-daily` e `sync-orders-daily` no pg_cron às `0 9 * * *` (09:00 UTC = 06:00 BRT). Confirmados ativos no banco.
- `process-sync-job` v5: adicionado branch `daily_cache` → chama `mercado-libre-integration` com `{ ml_user_id, date_from, date_to }`. Deployed ACTIVE.
- Migration aplicada: `sales_orders_cron`.
