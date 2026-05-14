# CONCERNS — garment-glow-app

_Generated: 2026-05-14_

---

## 1. Critically Large Files (Tech Debt)

| File | Lines |
|---|---|
| `src/pages/mercadolivre/MLProdutos.tsx` | **1,979** |
| `src/pages/mercadolivre/MLEstoque.tsx` | **1,366** |
| `src/pages/mercadolivre/MLPedidos.tsx` | **1,176** |
| `src/pages/mercadolivre/MLAnuncios.tsx` | 721 |
| `src/pages/mercadolivre/MLRelatorios.tsx` | 651 |
| `src/pages/mercadolivre/MLPrecosCustos.tsx` | 513 |

All are single-file monoliths combining data fetch, filtering, sorting, charting, and sub-component definitions simultaneously.

---

## 2. Mock Data Used in Production UI (Critical)

Three pages show **seeded fake data** to users with no real API behind them:

- `MLDevolucoes.tsx` — imports from `src/data/devolucoesMockData.ts` (claims/refund rates all fake)
- `MLPerguntas.tsx` — imports from `src/data/perguntasMockData.ts` (Q&A data all fake)
- `MLReputacao.tsx` — feedback entries from `src/data/reputacaoMockData.ts` (partially fake)
- `MLFinanceiro.tsx` — imports from `src/data/financialMockData.ts` (commission breakdowns use seeded PRNG `seededRandom`)

Users making business decisions based on this data see fabricated metrics.

---

## 3. Hardcoded Seller IDs in TVModeVendas

`src/pages/TVModeVendas.tsx` lines 16–19: hardcoded UUID array `SELLERS` bypasses the multi-tenant `SellerContext`. Any org besides "Sandrini" and "Buy Clock" gets nothing.

---

## 4. Credentials in Source Control

`src/integrations/supabase/client.ts` contains the Supabase URL and anon key as string literals tracked by git. `.gitignore` does not exclude `.env` where the same values are duplicated.

---

## 5. TypeScript `any` Bypass in Database Layer

`src/services/mlCacheService.ts` casts `supabase` to `any` on 6 lines (71, 110, 152, 196, 247, 259), disabling all type-safety on DB queries.

---

## 6. Double-Fetch Creates Double DB Load

`fetchScopedRows` in `mlCacheService.ts` makes two separate DB queries (user scope + org scope) and merges them client-side. For `fetchProductDailyCache` (limit 5000 per scope), up to 10,000 rows are fetched and then most are discarded.

---

## 7. Large Fixed Query Limits, Client-Side Aggregation

- `fetchDailyCache` — limit 2000/scope
- `fetchProductDailyCache` — limit 5000/scope
- `fetchStateDailyCache` — limit 5000/scope

All loaded into browser memory. No server-side aggregation; all grouping/summing happens in `useMemo`. Will degrade at scale.

---

## 8. No Pagination in Inventory Fetch

`MLInventoryContext.tsx` fetches all items per store via a serial loop over `ml_user_id`s with no pagination. All data is held in React state and filtered in-browser.

---

## 9. Missing Upsert Error Handling

`mlCacheService.ts` `upsertDailyCache` (lines 336–340): the batch upsert return value is never checked. Silent failures lose synced data with no user notification.

---

## 10. FloatingChat is Entirely Non-Functional

`src/components/chat/FloatingChat.tsx` (410 lines) has hardcoded `mockTickets` and sends messages nowhere — only to local React state. It is wired into the live app and misleads users.

---

## 11. Module-Level Sync Singleton Has Race Risk

`src/hooks/useMLSync.ts` stores all sync state in module-level vars. `_activePromise` is global but `autoSyncTriggeredRef` is per-hook-instance, meaning a component remount after an org switch is blocked from syncing by the previous instance's cooldown.

---

## 12. No Error Boundaries on ML Pages

`ErrorBoundary` is only at root. A runtime exception inside `MLProdutos` unmounts the entire app instead of showing a per-page error.

---

## 13. Only One Trivial Test

`src/test/example.test.ts` contains `expect(true).toBe(true)`. No tests exist for financial calculations, commission rate logic, date arithmetic, or any hook/context.

---

## 14. console.log in Production Code Path

`src/hooks/useMLPrecosCustos.ts` line 166: unconditional `console.log` bypasses the project's `logger` utility which silences debug output in production.

---

## 15. Token Refresh Not Automatic Mid-Session

ML OAuth token refresh requires manual user action in the Integrations page. If a token expires during an active session, sync fails with a generic error.

---

## 16. CORS Wildcard on Admin Edge Functions

All edge functions use `"Access-Control-Allow-Origin": "*"` including `admin-create-user`, `admin-toggle-user`, `admin-update-role`. The only protection is the `SERVICE_ROLE_KEY` check inside the function body.

---

## 17. Hardcoded BRT Timezone Offset

`supabase/functions/mercado-libre-integration/index.ts` line 12: `const BRT_OFFSET_MS = -3 * 60 * 60 * 1000`. Will produce incorrect hourly data for non-Brazilian ML accounts.

---

## 18. Products Query Silently Truncates to 50 Items

`useMLQueries.ts` `useMLProductsQuery` calls the Edge Function with `limit: 50, offset: 0` and has no pagination. All product analytics views are silently incomplete for high-SKU stores.

---

## 19. TODO: Error Monitoring Not Wired

`src/lib/logger.ts` line 27: `// TODO: forward to Sentry/Logflare when configured.` — production errors have no observability pipeline.
