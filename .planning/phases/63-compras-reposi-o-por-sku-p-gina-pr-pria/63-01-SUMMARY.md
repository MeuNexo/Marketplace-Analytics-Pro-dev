---
phase: 63-compras-reposi-o-por-sku-p-gina-pr-pria
plan: "01"
subsystem: sync-ml-inventory / replenishment_params
tags: [edge-function, migration, sku, inventory, sync, deno]
status: complete

dependency_graph:
  requires: []
  provides:
    - sync-ml-inventory writes seller_custom_field per variation (CMP-01)
    - replenishment_params.scope accepts 'sku' (CMP-05)
  affects:
    - ml_inventory_cache.variations[].seller_custom_field (populated after next sync)
    - downstream: Plan 63-02 (get_replenishment_by_sku RPC cost join via variation SKU)

tech_stack:
  added: []
  patterns:
    - second-pass per-variation via /items/{id}/variations/{variationId} (mirrors ml-inventory EF)
    - Promise.all batches capped at CONCURRENCY=20 (rate-limit mitigation)
    - try/catch per variation — single failure does not abort sync (Assumption A3)
    - ALTER TABLE DROP/ADD CONSTRAINT pattern for inline check evolution

key_files:
  modified:
    - supabase/functions/sync-ml-inventory/index.ts
  created:
    - supabase/migrations/20260663000000_replenishment_params_add_sku_scope.sql

decisions:
  - "Iterate over ALL variations regardless of has_variations flag — items with exactly 1 variation have has_variations=false but variations[0] exists and must be enriched"
  - "CONCURRENCY=20 matches ml-inventory pattern; console.warn per failure (non-fatal) per plan instruction and Assumption A3"

metrics:
  duration: ~5 minutes
  completed: "2026-06-26"
  tasks_completed: 2
  tasks_pending_orchestrator: 1 (Task 3 - MCP checkpoint)
  files_created: 1
  files_modified: 1
---

# Phase 63 Plan 01: Fundação de dados SKU por variação — Summary

**One-liner:** Second-pass `/items/{id}/variations/{variationId}` added to `sync-ml-inventory` to populate `seller_custom_field` per variation; `replenishment_params.scope` CHECK extended to accept `'sku'`.

---

## What Was Built

### Task 1: Segundo-passe per-variação no sync-ml-inventory (CMP-01)

Added ~38 lines to `supabase/functions/sync-ml-inventory/index.ts`, positioned **after** the multi-get loop (line ~238) and **before** the upsert loop. The block:

1. Collects all `(rowIdx, varIdx)` pairs from rows whose `variations.length > 0` (regardless of `has_variations` flag).
2. If any pairs exist, logs count and processes in batches of 20 with `Promise.all`.
3. Each call: `mlFetch(/items/${row.item_id}/variations/${variation.variation_id}, access_token)`.
4. Assigns: `variation.seller_custom_field = resolveSku(fullVar) ?? variation.seller_custom_field`.
5. `try/catch` per variation → `console.warn` with item_id + variation_id; does not throw.
6. The existing `resolveSku(b)` item-level call and all upsert logic remain unchanged.

**Key design choice:** Iterates over `variations.length > 0` instead of `has_variations` — this ensures items with exactly 1 variation (where `has_variations = rawVars.length > 1 = false`) are still enriched.

### Task 2: Migration — replenishment_params aceita scope 'sku' (CMP-05)

Created `supabase/migrations/20260663000000_replenishment_params_add_sku_scope.sql`:

```sql
ALTER TABLE public.replenishment_params
  DROP CONSTRAINT IF EXISTS replenishment_params_scope_check;

ALTER TABLE public.replenishment_params
  ADD CONSTRAINT replenishment_params_scope_check
    CHECK (scope IN ('global', 'marca', 'sku'));
```

No changes to RLS, indexes, or the UNIQUE `(organization_id, scope, scope_value)` constraint — the existing constraint already covers `scope='sku'` with `scope_value = seller_custom_field` of the variation.

### Task 3: [PENDING — ORCHESTRATOR]

The deploy of `sync-ml-inventory` edge function and the apply of the migration are **checkpoint tasks for the orchestrator** (MCP Supabase `deploy_edge_function` + `apply_migration` + SQL validation). The executor does not have MCP Supabase nor `SUPABASE_ACCESS_TOKEN`.

---

## Commits

| Hash | Message |
|------|---------|
| `7949f5a4` | feat(63-01): add second-pass per-variation SKU enrichment to sync-ml-inventory |
| `e60ff691` | feat(63-01): add migration to accept scope='sku' in replenishment_params |

---

## Deviations from Plan

None — plan executed exactly as written.

The only design note: the plan referenced the RESEARCH code snippet which used `if (rows[ri].has_variations)` as the guard. However, the plan text explicitly states "Iterar sobre o array `variations` independentemente do flag `has_variations`" — so `variations.length > 0` was used instead. This is consistent with the plan instruction and not a deviation.

---

## Must-Haves Status

| # | Truth / Artifact / Prohibition | Status |
|---|-------------------------------|--------|
| T1 | sync-ml-inventory faz segundo-passe /items/{id}/variations/{vid} e grava seller_custom_field por variação | DONE (code) — PENDING deploy |
| T2 | Após sync, variações de anúncios com SKU deixam de ter seller_custom_field nulo | PENDING (requires deploy + sync execution) |
| T3 | replenishment_params.scope aceita 'sku' além de 'global'/'marca' | DONE (migration) — PENDING apply |
| A1 | supabase/functions/sync-ml-inventory/index.ts contém variations/{variation_id} | VERIFIED |
| A2 | supabase/migrations/20260663000000_replenishment_params_add_sku_scope.sql contém ALTER TABLE public.replenishment_params | VERIFIED |
| P1 | NÃO remover/alterar resolveSku item-level (seller_custom_field do item) | VERIFIED — untouched |
| P2 | NÃO abortar sync se chamada de variação falhar — try/catch por variação | VERIFIED |
| P3 | NÃO tocar a EF ml-inventory | VERIFIED — untouched |

---

## Pending Orchestrator Actions (Task 3)

The orchestrator must complete the following via MCP Supabase in project `ckcdevcxgvueywivefgx` (Org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7`):

1. **apply_migration** — content of `supabase/migrations/20260663000000_replenishment_params_add_sku_scope.sql`
2. **Confirm CHECK** — execute_sql in ROLLBACK transaction: INSERT with `scope='sku'` must pass; INSERT with `scope='xpto'` must violate constraint.
3. **deploy_edge_function** `sync-ml-inventory` (full script from repo).
4. **Trigger sync** — invoke `sync-ml-inventory` for Pé Vermeio `ml_user_id` (Bearer service-role) and wait.
5. **Validate CMP-01** — execute_sql:
   ```sql
   SELECT count(*) AS variacoes_total,
          count(*) FILTER (WHERE sku IS NOT NULL AND sku <> '') AS variacoes_com_sku
   FROM ml_inventory_cache i
   CROSS JOIN LATERAL jsonb_to_recordset(i.variations) AS v(seller_custom_field TEXT)
   , LATERAL (SELECT v.seller_custom_field AS sku) s
   WHERE i.organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'
     AND i.has_variations = true;
   ```
   Expected: `variacoes_com_sku > 0`. If = 0, escalate to Wesley (SKU not registered in ML variations).
6. **Validate coverage** (insumo 63-02) — execute_sql:
   ```sql
   SELECT count(*) AS pedidos, count(NULLIF(variation_id,'')) AS com_variation
   FROM ml_orders
   WHERE organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'
     AND data_pedido >= CURRENT_DATE - 60;
   ```
   Record `com_variation / pedidos` ratio in SUMMARY.
7. **get_advisors** (security) — confirm no new ERROR related to replenishment_params.

---

## Threat Surface Scan

No new security-relevant surface introduced:

- The second-pass uses the same `access_token` already in scope for the EF — no cross-org token leakage (T-63-01: INVOKER pattern preserved).
- Concurrency capped at 20 mitigates ML API rate limit / timeout risk (T-63-02).
- Migration only changes CHECK domain — RLS `rp_write` unchanged (T-63-03).

---

## Known Stubs

None. The code produces real data once deployed and synced.

---

## Self-Check: PASSED

- `supabase/functions/sync-ml-inventory/index.ts` — FOUND
- `supabase/migrations/20260663000000_replenishment_params_add_sku_scope.sql` — FOUND
- Commit `7949f5a4` — FOUND in git log
- Commit `e60ff691` — FOUND in git log
- Grep `/items/${row.item_id}/variations/${variation.variation_id}` — 2 matches (call + warn log)
- Grep `ADD CONSTRAINT replenishment_params_scope_check` + `'sku'` — both present
