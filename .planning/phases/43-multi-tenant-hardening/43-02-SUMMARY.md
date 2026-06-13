---
phase: 43-multi-tenant-hardening
plan: "02"
subsystem: edge-functions-security-quota
tags: [multi-tenant, security, quota, pg-cron, me-04, me-05, tenant-03]
dependency_graph:
  requires:
    - 43-01 (RLS org-first + backfill + billing FOR SELECT)
  provides:
    - Token lookup determinístico (ORDER BY updated_at DESC) em sync-ml-orders, sync-ml-billing, ml-reputation, ml-inventory
    - Guard is_org_member auditado e confirmado em ml-reputation, ml-inventory, ml-ads
    - RPC public.check_quota(_org_id uuid) SECURITY DEFINER
    - Gate check_quota em process-sync-job (antes do dispatch)
    - Migration cron Pattern B (ckcdevcxgvueywivefgx + vault service_role_key)
  affects:
    - supabase/functions/sync-ml-orders/index.ts
    - supabase/functions/sync-ml-billing/index.ts
    - supabase/functions/ml-reputation/index.ts
    - supabase/functions/ml-inventory/index.ts
    - supabase/functions/process-sync-job/index.ts
    - supabase/migrations/20260614122000_tenant03_check_quota_rpc.sql (NOVO)
    - supabase/migrations/20260614122500_tenant03_fix_sync_cron_pattern_b.sql (NOVO)
tech_stack:
  added: []
  patterns:
    - ME-04: token lookup com .order("updated_at", ascending:false) + .limit(1).maybeSingle()
    - ME-05: is_org_member guard antes de aceitar ml_user_id de input (403 genérico)
    - TENANT-03: RPC check_quota SECURITY DEFINER (ON CONFLICT atomico) + gate no dispatch
    - Pattern B: vault.decrypted_secrets WHERE name = 'service_role_key' para pg_cron
key_files:
  created:
    - supabase/migrations/20260614122000_tenant03_check_quota_rpc.sql
    - supabase/migrations/20260614122500_tenant03_fix_sync_cron_pattern_b.sql
  modified:
    - supabase/functions/sync-ml-orders/index.ts
    - supabase/functions/sync-ml-billing/index.ts
    - supabase/functions/ml-reputation/index.ts
    - supabase/functions/ml-inventory/index.ts
    - supabase/functions/process-sync-job/index.ts
decisions:
  - "ME-04: ORDER BY updated_at DESC é determinístico em multi-tenant; sem ORDER BY, lookup pode retornar token de org errada"
  - "ME-05: ml-reputation e ml-inventory JA tinham is_org_member (parcial em 43-RESEARCH era correto); ml-ads também ja tinha. Nenhuma EF precisou ter o guard adicionado — só ORDER BY"
  - "TENANT-03: gate fail-open em erro de RPC (log + continua) para nao travar orgs enterprise"
  - "Cron: apenas sync-process-job-every-5min recriado; sync-dispatch e watchdog usam SQL inline (sem HTTP) — nao afetados"
  - "GRANT service_role only no check_quota — usuários autenticados nao podem chamar diretamente"
metrics:
  duration: "~30min"
  completed_date: "2026-06-13"
  tasks_completed: 2
  tasks_total: 3
  files_changed: 7
---

# Phase 43 Plan 02: ME-04/ME-05 + TENANT-03 check_quota + cron Pattern B Summary

**One-liner:** Token lookup determinístico (ORDER BY updated_at DESC) em 4 EFs, guard is_org_member auditado (já existia em todas), RPC check_quota SECURITY DEFINER com gate no process-sync-job, e cron sync-process-job recriado com URL correta + Pattern B vault.

## Objective

Endurecer segurança multi-tenant nas Edge Functions (ME-04: lookup determinístico, ME-05: guard is_org_member) e habilitar enforcement de quota de sync (TENANT-03: RPC check_quota + gate no dispatch). Corrigir pg_cron apontando para projeto errado (Pitfall 4 — URL gionpsuunfkkzzjdubfy → ckcdevcxgvueywivefgx).

## Tasks Completed

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | ME-04 token lookup ORDER BY + ME-05 is_org_member audit em 4 EFs | COMPLETO | 624f0fdf |
| 2 | RPC check_quota + gate process-sync-job + migration cron Pattern B | COMPLETO | e0fdce0e |
| 3 | [BLOCKING] Aplicar migrations via MCP + deploy EFs | AGUARDANDO CHECKPOINT | — |

## Task 1 — ME-04 e ME-05 (audit por EF)

### Estado de cada EF após Task 1

| EF | is_org_member (ME-05) | ORDER BY updated_at (ME-04) | Ação |
|----|----------------------|----------------------------|------|
| sync-ml-orders | Existia (skip para service role) | NAO TINHA → ADICIONADO | ORDER BY adicionado |
| sync-ml-billing | Existia (skip para service role) | NAO TINHA → ADICIONADO | ORDER BY adicionado |
| ml-reputation | EXISTIA (linhas 57-62) | NAO TINHA → ADICIONADO | ORDER BY adicionado |
| ml-inventory | EXISTIA (linhas 103-113) | NAO TINHA → ADICIONADO | ORDER BY adicionado |
| ml-ads | EXISTIA (linha 368) + ORDER BY | Ja tinha (linhas 77/356) | Nenhuma alteracao |
| sync-ml-inventory | Service role only (sem input userId) | Nao aplicável | Nenhuma alteracao |
| process-sync-job | Service role only | Nao aplicável | Gate check_quota adicionado |

**Conclusão ME-05:** Todas as EFs que aceitam ml_user_id de input de usuário já tinham is_org_member. O RESEARCH (43-RESEARCH.md) dizia que ml-ads e ml-reputation faltavam o guard — a auditoria real mostrou que ambas JA TINHAM. Apenas ORDER BY faltava.

### Padrão aplicado (ME-04)

```typescript
// Antes (não-determinístico):
.eq("ml_user_id", mlUserId)
.not("access_token", "is", null)
.limit(1)
.maybeSingle();

// Depois (determinístico — token mais recente):
.eq("ml_user_id", mlUserId)
.not("access_token", "is", null)
.order("updated_at", { ascending: false })
.limit(1)
.maybeSingle();
```

## Task 2 — RPC check_quota + gate + cron

### Migration A: `20260614122000_tenant03_check_quota_rpc.sql`

- `CREATE OR REPLACE FUNCTION public.check_quota(_org_id uuid) RETURNS boolean`
- `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`
- Lógica:
  1. Busca `sync_interval_minutes` em `organization_plans`
  2. `IS NULL` ou `= -1` → `RETURN true` (enterprise/unlimited nunca bloqueia — D-04)
  3. `INSERT sync_quota_daily ON CONFLICT DO UPDATE sync_count+1 RETURNING sync_count`
  4. `v_limit := greatest(1, floor(1440.0 / v_interval))`
  5. `RETURN v_count <= v_limit`
- `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO service_role`
- Idempotente via `CREATE OR REPLACE`

### process-sync-job/index.ts — gate injetado

```typescript
// Após claim_next_sync_job(), antes do dispatch:
if (job.organization_id) {
  const { data: withinQuota, error: quotaErr } = await sb.rpc("check_quota", {
    _org_id: job.organization_id,
  });
  if (quotaErr) {
    console.error(...); // fail-open: log + continua
  } else if (withinQuota === false) {
    console.warn(`quota EXCEEDED org=${job.organization_id}...`);
    await sb.from("sync_jobs").update({
      status: "failed",
      error_msg: "quota exceeded for org ... — sync blocked by check_quota",
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return json({ ok: false, error: "quota_exceeded" }, 200);
  }
}
```

### Migration B: `20260614122500_tenant03_fix_sync_cron_pattern_b.sql`

- Recria `sync-process-job-every-5min` com:
  - URL: `https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/process-sync-job`
  - Auth: `'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)`
- `sync-dispatch-every-30min` e `sync-job-retry-watchdog` não são alterados (usam SQL inline, sem HTTP)
- Idempotente: `DO $$ BEGIN cron.unschedule(...) EXCEPTION WHEN OTHERS THEN NULL; END $$;`

## Deviations from Plan

### [Rule 1 - Observação] ME-05 já existia em mais EFs do que o RESEARCH indicava

- **Found during:** Task 1 (auditoria real dos arquivos)
- **Issue:** 43-RESEARCH.md indicava que ml-ads e ml-reputation "faltavam" is_org_member. A auditoria mostrou que ambas JA TINHAM o guard completo.
- **Fix:** Nenhum fix necessário para ME-05. Apenas ORDER BY (ME-04) adicionado em todas as 4 EFs de forma idempotente.
- **Impact:** Zero — mudanças foram apenas aditivas (ORDER BY) em código já correto.

## Known Stubs

Nenhum — migrations escritas e prontas para apply. EFs atualizadas. Nenhum placeholder.

## Threat Flags

Nenhum — as mudanças aplicam mitigações do threat register (T-43-05, T-43-06, T-43-07, T-43-08). Nenhuma nova superfície introduzida.

## Task 3 — [AGUARDANDO] Aplicação via MCP + Deploy EFs

**Status:** BLOCKING — aguarda aprovação de Wesley e execução pelo orquestrador.

### Pre-flight obrigatório (antes de aplicar migration de cron):

```sql
-- Verificar vault tem service_role_key (Pattern B)
SELECT name, length(secret) > 0 AS has_value
FROM vault.secrets
WHERE name = 'service_role_key';

-- Se ausente: inserir antes de aplicar a migration de cron
-- SELECT vault.create_secret('<sb_secret_value>', 'service_role_key', 'Service role key para pg_cron');
```

### Estado atual do cron (verificar antes de aplicar):

```sql
SELECT jobname, schedule, LEFT(command, 150) AS command_preview
FROM cron.job
WHERE jobname LIKE 'sync-%'
ORDER BY jobname;
```

Esperado após apply da migration B:
- `sync-process-job-every-5min`: URL = `ckcdevcxgvueywivefgx`, Bearer = vault service_role_key
- `sync-dispatch-every-30min`: SQL `SELECT public.dispatch_sync_jobs()` (inalterado)
- `sync-job-retry-watchdog`: SQL INSERT de retry (inalterado)

### Ordem de aplicação das migrations:

1. `20260614122000_tenant03_check_quota_rpc.sql` (RPC check_quota)
2. `20260614122500_tenant03_fix_sync_cron_pattern_b.sql` (cron Pattern B — requer vault)

### EFs para deploy (em qualquer ordem):

- `sync-ml-orders` (ME-04: ORDER BY)
- `sync-ml-billing` (ME-04: ORDER BY)
- `ml-reputation` (ME-04: ORDER BY)
- `ml-inventory` (ME-04: ORDER BY)
- `process-sync-job` (gate check_quota)

### Smoke pós-deploy:

```bash
# 1. process-sync-job sem auth → 401
curl -s -o /dev/null -w "%{http_code}" \
  https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/process-sync-job \
  -X POST -H "Content-Type: application/json" -d '{}'

# 2. process-sync-job com service role + fila vazia → {ok:true, msg:"no pending jobs"}
curl -s \
  https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/process-sync-job \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -d '{}'

# 3. Confirmar check_quota funciona (enterprise retorna true)
-- Via SQL Editor:
SELECT public.check_quota('<org_pevermeio_uuid>');
-- Esperado: true (enterprise, sync_interval_minutes = -1)
```

## Self-Check: PASSED (Tasks 1 e 2)

Verificações:
- [x] sync-ml-orders tem `order("updated_at"`: `grep -q 'order("updated_at"' supabase/functions/sync-ml-orders/index.ts`
- [x] sync-ml-billing tem `order("updated_at"`: `grep -q 'order("updated_at"' supabase/functions/sync-ml-billing/index.ts`
- [x] ml-reputation tem is_org_member: confirmado linha 58
- [x] ml-reputation tem ORDER BY: `grep -q 'order("updated_at"' supabase/functions/ml-reputation/index.ts`
- [x] ml-inventory tem is_org_member: confirmado linha 104
- [x] ml-inventory tem ORDER BY: `grep -q 'order("updated_at"' supabase/functions/ml-inventory/index.ts`
- [x] Migration check_quota existe: `supabase/migrations/20260614122000_tenant03_check_quota_rpc.sql`
- [x] Migration tem FUNCTION public.check_quota: confirmado
- [x] Migration tem = -1 (enterprise check): confirmado
- [x] process-sync-job tem check_quota: confirmado
- [x] Migration cron tem ckcdevcxgvueywivefgx: confirmado
- [x] Migration cron NAO tem URL do projeto errado no SQL funcional: confirmado
- [x] Commit 624f0fdf existe (Task 1)
- [x] Commit e0fdce0e existe (Task 2)
