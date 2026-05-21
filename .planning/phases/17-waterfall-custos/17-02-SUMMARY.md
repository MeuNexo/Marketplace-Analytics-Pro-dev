---
phase: 17-waterfall-custos
plan: "02"
subsystem: tiny-erp-integration
tags: [migration, edge-function, tiny-erp, cmv, supabase, typescript]
dependency_graph:
  requires: []
  provides:
    - ml_tokens.tiny_access_token
    - ml_tokens.tiny_expires_at
    - ml_product_costs_user_sku unique index
    - edge function sync-tiny-costs
    - UI TinyIntegrationSection in /integracoes
  affects:
    - ml_product_costs (cost field populated by SKU)
    - CMV calculation downstream (via ml_product_costs.cost)
tech_stack:
  added: []
  patterns:
    - Deno edge function with client_credentials OAuth grant
    - Token caching in ml_tokens (tiny_access_token, tiny_expires_at)
    - Rate-limited batch processing (1.1s delay, 50 products/batch)
    - Upsert ON CONFLICT (user_id, seller_sku)
key_files:
  created:
    - supabase/migrations/20260521210000_ml_tokens_add_tiny.sql
    - supabase/functions/sync-tiny-costs/index.ts
  modified:
    - src/pages/Integrations.tsx
    - supabase/config.toml
decisions:
  - "item_id placeholder TINY_{sku} used because sync-ml-orders keys costMap by item_id — see Known Stubs"
  - "client_credentials grant (not authorization_code) per plan spec"
  - "TinyIntegrationSection inline in Integrations.tsx (not separate file) — consistent with existing page structure"
metrics:
  duration_seconds: 301
  completed_at: "2026-05-21T19:32:41Z"
  tasks_completed: 3
  files_changed: 4
---

# Phase 17 Plan 02: Tiny ERP CMV Pipeline Summary

**One-liner:** Tiny ERP CMV pipeline — client_credentials OAuth, sync-tiny-costs edge function reads precoCustoMedio and upserts ml_product_costs by seller_sku, with sync button in /integracoes.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Migration — ml_tokens add tiny columns + unique index | `0909e007` | `supabase/migrations/20260521210000_ml_tokens_add_tiny.sql` |
| 2 | Edge function sync-tiny-costs | `f953d30b` | `supabase/functions/sync-tiny-costs/index.ts`, `supabase/config.toml` |
| 3 | UI TinyIntegrationSection in /integracoes | `88d85327` | `src/pages/Integrations.tsx` |

---

## Migration Status

**File:** `supabase/migrations/20260521210000_ml_tokens_add_tiny.sql`
**Applied:** `supabase db push --linked` — success (`Finished supabase db push.`)
**Project:** `ckcdevcxgvueywivefgx`

Changes applied:
- `ALTER TABLE public.ml_tokens ADD COLUMN IF NOT EXISTS tiny_access_token TEXT`
- `ALTER TABLE public.ml_tokens ADD COLUMN IF NOT EXISTS tiny_expires_at BIGINT`
- `CREATE UNIQUE INDEX IF NOT EXISTS ml_product_costs_user_sku ON public.ml_product_costs (user_id, seller_sku) WHERE seller_sku IS NOT NULL`

---

## Edge Function Status

**Deployed:** `supabase functions deploy sync-tiny-costs --project-ref ckcdevcxgvueywivefgx`
**Bundle size:** 79.7kB
**Dashboard:** https://supabase.com/dashboard/project/ckcdevcxgvueywivefgx/functions
**verify_jwt:** false (consistent with other sync functions)

### How sync-tiny-costs works

1. Auth check: accepts user JWT or service_role. Requires `ml_user_id` in request body.
2. Token management: reads `ml_tokens.tiny_access_token` — re-generates via `client_credentials` grant if expired or missing.
3. Product fetch: paginates `GET /produtos?situacao=A` (100/page), skips `tipoVariacao=P` (parent products).
4. Cost fetch: `GET /produtos/{id}` → `precos.precoCustoMedio || precos.precoCusto`. Rate limited 1.1s between calls.
5. Upsert: batches of 50 rows into `ml_product_costs` with `onConflict: "user_id,seller_sku"`.
6. Returns: `{ ok, synced, errors, total_products, msg }`.

---

## SKU Matching — Important Caveat

**Current behavior:** `sync-tiny-costs` upserts rows with `item_id = "TINY_{sku}"` (placeholder).

**Why this matters:** `sync-ml-orders` builds its `costMap` keyed by `ml_product_costs.item_id` (real ML item IDs like `MLB123`). It does NOT look up costs by `seller_sku`.

**Impact:** After running `sync-tiny-costs`, `ml_product_costs` will have correct `cost` values keyed by `seller_sku`. However, `sync-ml-orders` will NOT pick these up for `orders.custo_unit` until a follow-up change adds SKU-based lookup to `sync-ml-orders`.

**Follow-up needed (tracked as deferred):** Modify `sync-ml-orders` to build a secondary `costMapBySku: Map<seller_sku, number>` from `ml_product_costs`, and use it as fallback when `costMap.get(itemId)` returns null. This requires reading `seller_sku` from orders' product info.

---

## How to Configure TINY_CLIENT_ID / TINY_CLIENT_SECRET

1. Go to: https://supabase.com/dashboard/project/ckcdevcxgvueywivefgx/settings/edge-functions
2. Add secrets:
   - `TINY_CLIENT_ID` = your Tiny ERP client_id
   - `TINY_CLIENT_SECRET` = your Tiny ERP client_secret
3. These are read at runtime by the edge function via `Deno.env.get("TINY_CLIENT_ID")`.

The `client_credentials` grant does not require user interaction — it uses the app credentials directly to authenticate as the Tiny account owner.

---

## UI Changes

**File:** `src/pages/Integrations.tsx`
**Addition:** `TinyIntegrationSection` component (inline, ~140 lines)

- Appears below the ML integrations grid with "ERPs e Ferramentas" section header
- Shows Tiny ERP card with Package icon (blue gradient)
- Features badges: CMV Automático, Custo Médio, SKU Matching
- Store selector shown when multiple ML stores connected (auto-selects first store if only one)
- "Sincronizar Custos" button invokes `sync-tiny-costs` with loading state
- Shows result: "X produtos sincronizados · Y erros" (green) or error text (red)
- Config note explaining how to set TINY env vars in Supabase dashboard

---

## TypeScript

Zero errors: `npx tsc --noEmit --project tsconfig.app.json` — clean.

---

## Deviations from Plan

### Auto-handled
None — plan executed as written.

### Notes
The plan mentioned `tiny_refresh_token` in 17-CONTEXT.md but the plan spec (17-02-PLAN.md) only specifies `tiny_access_token` and `tiny_expires_at` (no refresh token for client_credentials). The migration correctly adds only the two columns specified in the plan's SQL block.

---

## Known Stubs

| Location | Issue | Reason |
|----------|-------|--------|
| `supabase/functions/sync-tiny-costs/index.ts` line 157 | `item_id = "TINY_{sku}"` placeholder | `ml_product_costs.item_id` is NOT NULL — needs a value, but Tiny doesn't know ML item IDs. Real match happens via `seller_sku` index. |
| `sync-ml-orders` `costMap` | Keyed by `item_id`, not `seller_sku` | sync-ml-orders reads costs from `ml_product_costs` by `item_id` (MLB IDs) — won't match `TINY_{sku}` placeholders automatically. CMV will only populate for items that have been matched in both systems. Follow-up task required. |

---

## Self-Check: PASSED

- [x] Migration file exists: `/root/garment-glow-test/supabase/migrations/20260521210000_ml_tokens_add_tiny.sql`
- [x] Edge function file exists: `/root/garment-glow-test/supabase/functions/sync-tiny-costs/index.ts`
- [x] Commit `0909e007` exists (migration)
- [x] Commit `f953d30b` exists (edge function)
- [x] Commit `88d85327` exists (UI)
- [x] TypeScript: 0 errors
- [x] Migration applied to remote ckcdevcxgvueywivefgx
- [x] Edge function deployed to remote ckcdevcxgvueywivefgx (79.7kB)
