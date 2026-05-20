---
plan: "08-01"
phase: "08-infraestrutura-de-planos"
status: completed
completed_at: "2026-05-20"
---

# Summary — Plan 08-01: Migration DDL e Seed de Planos

## O que foi feito

Criados dois arquivos de migration SQL para a infraestrutura de planos e quotas do v3.0.

### Task 1 — Migration de schema (20260519120000_organization_plans_quota.sql)

- **ENUM `public.plan_tier`**: criado com 4 valores (`free`, `starter`, `pro`, `enterprise`)
- **Tabela `organization_plans`**: PK em `organization_id` (sem `id` separado), colunas `plan_tier`, `sync_interval_minutes` (default 1440), `history_days` (default 30), `created_at`, `updated_at`; FK para `public.organizations(id) ON DELETE CASCADE`
- **Tabela `sync_quota_daily`**: PK composta em `(organization_id, date)`, coluna `sync_count` (default 0); FK para `public.organizations(id) ON DELETE CASCADE`
- **Indexes**: `organization_plans_created_at_idx` e `sync_quota_daily_org_date_idx`
- **RLS `organization_plans`**: SELECT para membros (`is_org_member`), INSERT e UPDATE para owner (`get_org_role = 'owner'`)
- **RLS `sync_quota_daily`**: SELECT para membros; nenhuma policy de escrita para `authenticated` (service_role only)

### Task 2 — Migration de seed (20260519130000_seed_enterprise_plans.sql)

- INSERT idempotente: `plan_tier='enterprise'`, `sync_interval_minutes=-1`, `history_days=-1` para todas as orgs existentes
- Usa `ON CONFLICT (organization_id) DO NOTHING` — executar múltiplas vezes é seguro

## Artifacts

| Arquivo | Propósito |
|---------|-----------|
| `supabase/migrations/20260519120000_organization_plans_quota.sql` | DDL: ENUM + 2 tabelas + indexes + RLS |
| `supabase/migrations/20260519130000_seed_enterprise_plans.sql` | Seed idempotente: enterprise para todas as orgs |

## Verificações

- `CREATE TYPE public.plan_tier AS ENUM`: 1 ocorrência ✓
- `CREATE TABLE public.organization_plans`: 1 ocorrência ✓
- `CREATE TABLE public.sync_quota_daily`: 1 ocorrência ✓
- `PRIMARY KEY (organization_id, date)`: 1 ocorrência ✓
- `ENABLE ROW LEVEL SECURITY`: 2 ocorrências ✓
- `is_org_member`: 2 ocorrências ✓
- `get_org_role`: 2 ocorrências ✓
- Nenhuma policy INSERT/UPDATE para `sync_quota_daily` com role `authenticated` ✓
- `ON CONFLICT (organization_id) DO NOTHING`: presente ✓
- `'enterprise'`, `-1, -1`, `FROM public.organizations`: todos presentes ✓

## Commits

1. `feat(db): migration DDL — ENUM plan_tier + tabelas organization_plans e sync_quota_daily + RLS`
2. `feat(db): seed idempotente — plano enterprise para todas as organizações existentes`

## Próximos passos

Plan 08-02 aplica as migrations via `supabase db push` e verifica o schema no banco remoto.
