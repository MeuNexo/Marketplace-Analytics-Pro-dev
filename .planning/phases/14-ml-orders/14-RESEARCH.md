# Phase 14: ml_orders - Research

**Researched:** 2026-05-21
**Domain:** Supabase Edge Functions, React Query, ML Orders sync pipeline
**Confidence:** HIGH

---

## Summary

The Dashboard de Vendas (`MercadoLivre.tsx`) already has all the plumbing to consume real `comissao` and `frete` values — the hook `useMLOrders` is written and wired, `costSummary` falls back to hardcoded 11%/5% only when `ordersSummary` is null, and the fallback is correct. The sole reason `ordersSummary` is always null is that `public.orders` has 0 rows: `sync-ml-orders` is never called during a Vendas sync.

The fix is surgical: after `mercado-libre-integration` completes each chunk in `useMLSync.syncFromAPI`, call `sync-ml-orders` for the same `ml_user_id` / date range in parallel (Option B from Q1). This requires no new infrastructure — `sync-ml-orders` already accepts `ml_user_id, date_from, date_to`, validates auth, and upserts into `public.orders` using `service_role` or user JWT. After adding this call, `invalidateAll()` (which invalidates all `["ml", ...]` queries including `["ml", "orders-summary", ...]`) will automatically refresh the hook.

A secondary fix is needed: `expandOrder` in `sync-ml-orders` does NOT calculate `receita_bruta` or `receita_liquida`, but those columns exist in the `orders` table and are used heavily in `MLPedidos.tsx`. They must be added to the upsert payload.

The fire-and-forget orders block in `mercado-libre-integration` (lines 786-866) is an incomplete duplicate of `sync-ml-orders` logic (no tax calculation, no `ml_product_costs` lookup, no `custo_unit`). It must be removed. The `fetchShipmentStates` expansion (`base_cost` + `cidade`) that was added to support that block is benign — it is used by the fire-and-forget block itself but `fetchShipmentStates` is separate from `fetchShipmentDetails` in `sync-ml-orders`. Reverting `fetchShipmentStates` is low priority; it does not cause correctness issues and does not affect `sync-ml-orders`.

**Primary recommendation:** Call `sync-ml-orders` from `useMLSync.syncFromAPI` after each `mercado-libre-integration` chunk completes. Remove the fire-and-forget block from `mercado-libre-integration`. Add `receita_bruta` and `receita_liquida` to `expandOrder`.

---

## Q1 — Trigger de sync: which option fits the existing architecture?

**Answer: Option B — the frontend calls both functions, sequenced within the existing chunk loop.**

**Evidence:**

`useMLSync.syncFromAPI` (lines 136-166 of `useMLSync.ts`) already loops over every `(mlUserId, dateChunk)` combination and awaits `supabase.functions.invoke("mercado-libre-integration", ...)` per chunk. After each chunk resolves, a second `supabase.functions.invoke("sync-ml-orders", ...)` with the same `ml_user_id, date_from, date_to` can be added immediately — no architectural change needed.

Option A (mercado-libre-integration calls sync-ml-orders internally) was attempted and left an incomplete fire-and-forget block (lines 786-866). It is wrong because:
- `mercado-libre-integration` runs under the user JWT; `sync-ml-orders` can accept a user JWT (it validates via `supabase.auth.getUser`).
- But the internal invoke would need a service-role key or a second HTTP call from within Deno, adding latency and complexity inside an already heavy function.
- The existing fire-and-forget block duplicates logic without the `ml_product_costs` or `ml_tax_config` lookups that `sync-ml-orders` performs.

Option C (pg_cron / scheduled job) is not available in the garment-glow-test Supabase project — there is no pg_cron schedule configured for `sync-ml-orders`, unlike nexo-mcp. The `process-sync-job` drain only runs when `bulk-dispatch-sync-jobs` creates queue entries (used by `MLPedidos.tsx` for long ranges). It is not appropriate for the Vendas sync trigger.

**Where to add the call:** Inside the `while (cursor <= rangeEnd)` loop in `syncFromAPI` (line 144), after the existing `mercado-libre-integration` invoke and before the chunk counter increment. Run them sequentially (await the orders sync after the main sync) to keep the progress counter meaningful. Total extra time per chunk: ~2-8 seconds depending on order volume and shipment fetching.

**Sequence:**
```
for mlUserId:
  for each chunk:
    1. await mercado-libre-integration  (existing)
    2. await sync-ml-orders             (NEW — same ml_user_id, same date range)
    3. chunksDone++; emit progress
```

**After the loop:** `invalidateRef.current.invalidateAll()` (line 169) already invalidates `["ml", ...]` which includes `["ml", "orders-summary", ...]` — no extra invalidation needed.

---

## Q2 — receita_bruta and receita_liquida

**Answer: Neither is calculated in `expandOrder`. Both must be added.**

**Evidence from `sync-ml-orders/index.ts` lines 286-312:**

`expandOrder` returns a record with: `ml_order_id, ml_user_id, seller_id, user_id, organization_id, item_id, variation_id, sku, titulo, listing_type, quantidade, preco_unit, comissao, frete, status, data_pedido, data_pagamento, estado, cidade, comprador, synced_at, custo_unit, tax_rate, tax_amount, uf_origem`.

Neither `receita_bruta` nor `receita_liquida` appears in the returned object.

**Confirmed formulas (from context and `MLPedidos.tsx` usage):**
```
receita_bruta   = preco_unit * quantidade
receita_liquida = receita_bruta - (comissao ?? 0) - (frete ?? 0) - (tax_amount ?? 0)
```

NULLs must be coerced to 0 before subtraction. If `preco_unit` itself is null, both values should be null (not 0).

**Add to `expandOrder` return object (after the existing fields):**
```typescript
receita_bruta:   precoUnit != null ? precoUnit * quantidade : null,
receita_liquida: precoUnit != null
  ? precoUnit * quantidade - (item.sale_fee != null ? Number(item.sale_fee) : 0)
    - (frete ?? 0) - (taxAmount ?? 0)
  : null,
```

Note: use the already-resolved local variables (`precoUnit`, `quantidade`, `frete`, `taxAmount`), not the raw `item.*` again — they are already computed above in `expandOrder`.

---

## Q3 — Campos que o dashboard de Vendas precisa

**Answer: The current `useMLOrders` select is sufficient. No missing fields.**

**Evidence:**

`costSummary` in `MercadoLivre.tsx` (lines 299-313) uses:
- `ordersSummary.total_comissao` — aggregated from `comissao` column ✓
- `ordersSummary.total_frete` — aggregated from `frete` column ✓
- `ordersSummary.paid_orders_count` — count of rows where `status = 'paid'` ✓
- `ordersSummary.paid_revenue` — `sum(preco_unit * quantidade)` for paid rows ✓

`effectiveMetrics` (lines 255-276) uses only `ordersSummary.paid_orders_count` and `ordersSummary.paid_revenue` for `avg_ticket`.

The `useMLOrders` hook (lines 33-57 of `useMLOrders.ts`) already selects `comissao, frete, status, preco_unit, quantidade` and computes all four aggregates in JavaScript. No additional columns are needed for the Vendas dashboard.

`receita_bruta` / `receita_liquida` are needed in `MLPedidos.tsx` but the hook there (`useMLOrders`) is a different query — or more precisely, `MLPedidos.tsx` reads orders directly (not via `useMLOrders`). The hook used in `MercadoLivre.tsx` is complete.

**`tax_amount` is NOT needed by `useMLOrders` for the Vendas dashboard** — the dashboard's `costSummary` shows `impostos: 0` explicitly (line 309, hardcoded to zero). Tax display on the Vendas page is out of scope for this phase.

---

## Q4 — Remoção do fire-and-forget errado

**Exact location in `mercado-libre-integration/index.ts`:**

| Lines | Content |
|-------|---------|
| 786 | `// Orders upsert — fire-and-forget, não bloqueia o response` |
| 787-841 | Build `orderRows` array (loop over orders and order_items) |
| 844-866 | `if (orderRows.length > 0) { (async () => { ... })(); }` — the fire-and-forget IIFE |

The block occupies **lines 786-866** (80 lines). Everything from the comment on line 786 through the closing `})();` on line 865 and `}` on line 866 must be removed.

**`fetchShipmentStates` expansion (`base_cost`):**

Lines 49-97 of `mercado-libre-integration/index.ts` show `fetchShipmentStates` was expanded to return `base_cost: number | null` and `cidade: string | null` in addition to `uf` and `state_name`. These extra fields are used by the fire-and-forget block at lines 807 (`shipInfo?.base_cost`) and 809 (`shipInfo?.cidade`).

**Decision: revert `fetchShipmentStates` partially.** After removing the fire-and-forget block, `base_cost` and `cidade` are no longer consumed anywhere in `mercado-libre-integration`. Keeping dead fields in the return type is harmless but clutters the code. The safe approach is to revert the return type to `{ uf: string; state_name: string }` and remove the `base_cost`/`cidade` extraction lines (89-97). This is a clean-up, not a correctness fix.

**`fetchShipmentDetails` in `sync-ml-orders`** is a different function entirely (lines 162-226 of `sync-ml-orders/index.ts`) — it already fetches `base_cost` + address correctly. No change needed there.

---

## Q5 — Deploy e teste

**Existing trigger in `MLPedidos.tsx`:**

`MLPedidos.tsx` lines 758-773 invoke `sync-ml-orders` directly via `supabase.functions.invoke("sync-ml-orders", ...)` for ranges ≤ 5 days, and via `bulk-dispatch-sync-jobs` for longer ranges. This is a working invocation path that can be used for manual testing.

**Testing plan after changes:**

1. **Unit test — `expandOrder` output:** Verify `receita_bruta` and `receita_liquida` appear in the returned record with correct values. No test file exists yet for this function; it is a pure TypeScript function and can be unit-tested.

2. **Integration test — orders table populated after Vendas sync:**
   - Navigate to `/` (MercadoLivre.tsx)
   - Click the sync button (`onClick={() => syncFromAPI()}` at line 448)
   - Check `public.orders` in Supabase: `SELECT count(*) FROM orders WHERE data_pedido >= '...'`
   - Check that `costSummary.comissao` in the UI is no longer using the 11% fallback

3. **Regression test — MLPedidos still works:**
   - Navigate to `/pedidos`
   - Sync a 1-day range via the sync button in `MLPedidos.tsx`
   - Verify orders appear with correct `receita_bruta` and `receita_liquida` values

4. **Smoke test — no duplicate rows:**
   - After syncing the same date range twice (once via Vendas, once via Pedidos), verify `SELECT count(*)` is unchanged (upsert on `ml_order_id,ml_user_id,item_id,variation_id` deduplicates correctly)

**Manual invocation via Supabase Dashboard:**
The `sync-ml-orders` function can be invoked from Supabase Dashboard > Edge Functions > sync-ml-orders > "Invoke" with body `{"ml_user_id":"<id>","date_from":"2026-05-20","date_to":"2026-05-20"}` and the user's session token. This is the fastest way to verify the function works before wiring the frontend.

---

## Architecture Patterns

### Standard Stack
| Component | Current | Status |
|-----------|---------|--------|
| `sync-ml-orders` edge function | 520 lines, complete | Needs `receita_bruta`/`receita_liquida` added |
| `useMLOrders` hook | 62 lines, correct | No change needed |
| `useMLSync.syncFromAPI` | 229 lines | Add `sync-ml-orders` invoke after each chunk |
| `mercado-libre-integration` | 946 lines | Remove fire-and-forget block (lines 786-866) |

### Invalidation Chain (already correct)
```
syncFromAPI completes loop
  → invalidateRef.current.invalidateAll()
  → invalidates ["ml", "orders-summary", ...] queryKey
  → useMLOrders refetches from public.orders
  → costSummary.comissao uses real value instead of 11% fallback
```

### Don't Hand-Roll
| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Deduplication | custom merge logic | existing `onConflict: "ml_order_id,ml_user_id,item_id,variation_id"` upsert |
| Cache invalidation | manual state updates | `queryClient.invalidateQueries({ queryKey: ["ml"] })` already called |
| Auth in sync-ml-orders | separate token fetch | function already accepts user JWT or service-role — `supabase.functions.invoke` sends user session automatically |

---

## Common Pitfalls

### Pitfall 1: Parallel vs Sequential chunk invocation
**What goes wrong:** Calling `mercado-libre-integration` and `sync-ml-orders` in parallel (Promise.all) for the same chunk means `sync-ml-orders` may start before the daily cache is written — but this is fine since they write to different tables. However, the progress counter becomes misleading if you count them separately.
**How to avoid:** Call sequentially within the chunk loop. Count one progress unit per chunk (not per sub-call). The user sees accurate progress.

### Pitfall 2: Cooldown lock blocks the second invoke
**What goes wrong:** `useMLSync` has a 30-second cooldown (`SYNC_COOLDOWN_MS`) and an `_activePromise` singleton. If `sync-ml-orders` is added as a separate `syncFromAPI` call (not inside the existing loop), the cooldown prevents it from running.
**How to avoid:** Add the `sync-ml-orders` invoke INSIDE the existing chunk loop in `syncFromAPI` — not as a second top-level call. It runs as part of the same promise, bypassing the cooldown entirely.

### Pitfall 3: `receita_liquida` going negative
**What goes wrong:** If `frete` is seller-absorbed (Full), the ML API returns `order.shipping.cost = 0` and `base_cost` from `/shipments/{id}` is the real cost. `sync-ml-orders` already handles this correctly via `fetchShipmentDetails`. But if `frete` is null (shipment fetch timed out), `receita_liquida` will be slightly over-estimated.
**How to avoid:** Treat null as 0 in the formula — already the pattern in `useMLOrders` with `?? 0`. Document that null frete means "unknown, not zero" but display conservatively.

### Pitfall 4: fire-and-forget block in mercado-libre-integration writes with wrong onConflict
**What goes wrong:** The fire-and-forget block at line 855 uses `onConflict: "ml_order_id,ml_user_id,item_id,variation_id"` — same as `sync-ml-orders`. But it does NOT populate `custo_unit`, `tax_rate`, `tax_amount`, `uf_origem`, `receita_bruta`, or `receita_liquida`. If it runs before `sync-ml-orders`, it upserts incomplete rows; `sync-ml-orders` then upserts the complete version. If it runs after, `sync-ml-orders` data is overwritten with the incomplete row.
**How to avoid:** Remove the block entirely. Do not attempt to reconcile the two — `sync-ml-orders` is the authoritative path.

### Pitfall 5: `variation_id` empty string vs null in unique constraint
**What goes wrong:** Both functions write `variation_id: ""` (empty string) when there is no variation. The unique constraint `orders_upsert_key (ml_order_id, ml_user_id, item_id, variation_id)` treats `""` as a valid value (not null), so duplicates from two paths would conflict on the same key — which is correct deduplication behavior. But if one path writes `""` and another writes `null`, the constraint does not deduplicate.
**How to avoid:** Verify `sync-ml-orders` line 293: `variation_id: prod.variation_id ? String(prod.variation_id) : ""` — empty string, consistent with the fire-and-forget block. No change needed.

---

## Files to Modify

| File | What to Do | Lines |
|------|-----------|-------|
| `src/hooks/useMLSync.ts` | Inside the `while` chunk loop, after the `mercado-libre-integration` invoke (after line 154), add `await supabase.functions.invoke("sync-ml-orders", { body: { ml_user_id: mlUserId, date_from: format(chunkStart, "yyyy-MM-dd"), date_to: format(chunkEnd, "yyyy-MM-dd") } })` — ignore errors (non-fatal, log only) | 144-165 |
| `supabase/functions/sync-ml-orders/index.ts` | In `expandOrder`, add `receita_bruta` and `receita_liquida` to the returned record | 286-312 |
| `supabase/functions/mercado-libre-integration/index.ts` | Remove fire-and-forget block (lines 786-866). Optionally revert `fetchShipmentStates` return type to remove `base_cost`/`cidade` (lines 49-97) | 786-866 (remove); 49-97 (optional cleanup) |

**No migration needed** — `receita_bruta` and `receita_liquida` columns already exist in the `orders` table (confirmed in phase context). The upsert will populate them on the next sync.

**No new dependencies** — all changes are in existing files using existing patterns.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Hardcoded 11% comissao, 5% frete in costSummary | Real values from `public.orders` via `useMLOrders` | Already implemented; just needs data in the table |
| No tax calculation | `sync-ml-orders` computes `tax_rate`/`tax_amount` per regime (Simples/LP/LR) | Already in production code; out of scope for this phase |
| fire-and-forget orders upsert in mercado-libre-integration | Remove in favor of dedicated `sync-ml-orders` | This phase fixes the regression |

---

## Open Questions

1. **Should `sync-ml-orders` errors abort the Vendas sync or be silently swallowed?**
   - What we know: `mercado-libre-integration` errors throw and show a toast. `sync-ml-orders` errors are currently non-fatal in the fire-and-forget path.
   - What's unclear: If `sync-ml-orders` fails (e.g., ML API rate limit), the daily cache is still populated. The user sees updated charts but stale cost data.
   - Recommendation: Catch `sync-ml-orders` errors in `syncFromAPI`, log to console, do NOT throw — keep it non-fatal. The fallback to 11%/5% is acceptable for one sync cycle.

2. **Should `sync-ml-orders` be called for ALL chunks or only recent ones?**
   - What we know: For historical periods (e.g., 30-day sync), calling `sync-ml-orders` per chunk adds significant latency (each chunk hits `/shipments/{id}` for all orders).
   - Recommendation: Always call it — the upsert deduplicates, and historical data is only synced manually by the user who explicitly chose a long range.

---

## Sources

### Primary (HIGH confidence)
- `/root/garment-glow-test/src/hooks/useMLSync.ts` — full file read, lines 81-206
- `/root/garment-glow-test/src/hooks/useMLOrders.ts` — full file read
- `/root/garment-glow-test/src/pages/MercadoLivre.tsx` — lines 100-320
- `/root/garment-glow-test/supabase/functions/sync-ml-orders/index.ts` — lines 1-520
- `/root/garment-glow-test/supabase/functions/mercado-libre-integration/index.ts` — lines 40-110 and 780-870
- `/root/garment-glow-test/src/pages/mercadolivre/MLPedidos.tsx` — lines 745-801
- `/root/garment-glow-test/supabase/functions/process-sync-job/index.ts` — lines 1-140

### Secondary (MEDIUM confidence)
- `/root/nexo-mcp/supabase/functions/sync-ml-orders/index.ts` — reference architecture for incremental sync pattern

## Metadata

**Confidence breakdown:**
- Q1 (trigger): HIGH — direct code read of `useMLSync.ts` and `MLPedidos.tsx`
- Q2 (receita_bruta): HIGH — direct code read of `expandOrder` return object
- Q3 (fields needed): HIGH — direct code read of `costSummary` and `effectiveMetrics` in `MercadoLivre.tsx`
- Q4 (fire-and-forget location): HIGH — grep + line-number verified
- Q5 (testing): HIGH — existing invocation patterns observed in `MLPedidos.tsx`

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (stable — no external APIs researched)
