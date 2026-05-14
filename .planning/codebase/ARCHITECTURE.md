# Architecture

## Overview

Analytics Pro is a MercadoLivre analytics dashboard built with React + TypeScript + Vite, backed by Supabase (PostgreSQL + Auth + Edge Functions + Storage). The app is a multi-tenant SaaS: each user belongs to one or more organizations, and organizations own sellers and their MercadoLivre store connections.

---

## Routing

React Router v6 (`BrowserRouter`) with nested `Routes`. All routes defined in `src/App.tsx`.

### Two independent auth stacks

**Admin panel** (`/admin/*`) — completely isolated from the main app:
- `AdminAuthProvider` is instantiated only for `/admin/login` and `/admin/*` routes.
- `AdminProtectedRoute` gates access; requires `user_roles.role = 'admin'`.
- Renders `AdminLayout` (its own layout shell without org context).

**Main app** (`/*`) — org-scoped:
- `AuthProvider` → `OrganizationProvider` → `MenuVisibilityProvider` → `SellerProvider` → `SettingsProvider` wrap the entire main app route tree.
- `ProtectedRoute` checks both auth and org membership; redirects to `/login` if unauthenticated or org-less.
- `RoleRoute` wraps every page and calls `canAccessWithViewer()` to enforce org-level role permissions with per-viewer custom route grants.
- `TVRoleGuard` gates `/tv` specifically against the `/` (Vendas) permission.

### Route list (main app)

| Path | Page Component | Role Access |
|---|---|---|
| `/` | `MercadoLivre` | ALL |
| `/estoque` | `MLEstoque` | ALL |
| `/anuncios` | `MLProdutos` | ALL |
| `/publicidade` | `MLAnuncios` | ALL |
| `/financeiro` | `MLFinanceiro` | ALL |
| `/reputacao` | `MLReputacao` | ALL |
| `/pedidos` | `MLPedidos` | owner/admin/member |
| `/perguntas` | `MLPerguntas` | owner/admin/member |
| `/devolucoes` | `MLDevolucoes` | owner/admin/member |
| `/metas` | `MLMetas` | owner/admin/member |
| `/precos-custos` | `MLPrecosCustos` | owner/admin/member |
| `/organizacao` | `OrgSettings` | owner/admin |
| `/sellers` | `Sellers` | owner only |
| `/integracoes` | `Integrations` | owner only |
| `/monitoramento` | `AdminMonitoring` | owner only |
| `/perfil` | `Profile` | ALL |
| `/tv` | `TVModeVendas` | mirrors `/` permission |
| `/aceitar-convite` | `AcceptInvite` | public |
| `/login` | `Login` | public |
| `/reset-password` | `ResetPassword` | public |

All main-app pages are wrapped in `React.lazy()` + `<Suspense fallback={<PageLoader />}>` for code-splitting.

### OAuth redirect

`OAuthCodeRedirect` is a router wrapper that detects a `?code=` query param on any page and redirects to `/integracoes` so the ML OAuth token exchange is centralized.

---

## Auth Model

### Supabase Auth

Session is persisted in `localStorage` with `autoRefreshToken: true`. The auth client is created in `src/integrations/supabase/client.ts`.

### Two-tier role system

**Global app role** (table `user_roles`):
- `admin` — super-admin; can only log in at `/admin/login`; cannot access the main app.
- `editor` / `viewer` — standard app users; must belong to at least one organization.

`AuthContext` (`src/contexts/AuthContext.tsx`) stores `user`, `session`, `role`, and `profile`. It guards against super-admins logging into the main app by checking `user_roles` on sign-in and rejecting `role = 'admin'`.

**Org-level role** (table `organization_members`, field `role`):
- `owner` — full access, can manage sellers/integrations/org settings.
- `admin` — same as owner except org ownership transfer.
- `member` — operational access (orders, returns, questions, goals, pricing).
- `viewer` — default-deny; access only to routes explicitly granted by owner/admin via `member_route_permissions`.

`OrganizationContext` (`src/contexts/OrganizationContext.tsx`) stores `orgs`, `currentOrg`, `orgRole`, and `viewerPermissions`. The active org is persisted to `localStorage` under key `currentOrgId`. Viewer permissions are loaded from `member_route_permissions` only when `orgRole === 'viewer'`.

### Access control

`src/config/roleAccess.ts` exports:
- `roleAccess` — static map of path → allowed org roles.
- `canAccess(role, path)` — simple role check.
- `canAccessWithViewer(role, path, viewerPermissions)` — same as above but for `viewer` role checks against the per-user granted route set stored in `viewerPermissions`.
- `VIEWER_ELIGIBLE_ROUTES` — 11 routes that can be individually unlocked for viewers.

`EnvironmentSidebar` filters sidebar items using `canAccessWithViewer` and `MenuVisibilityContext.isMenuItemVisible` so locked items simply disappear from nav.

---

## Context / Data Flow

### Context provider tree (main app)

```
QueryClientProvider (TanStack Query)
  BrowserRouter
    AuthProvider               — Supabase session, user, app role, profile
      OrganizationProvider     — org list, currentOrg, orgRole, viewerPermissions
        MenuVisibilityProvider — localStorage-backed menu hide config per role
          SellerProvider       — sellers+stores CRUD, selected seller, marketplace selection
            SettingsProvider   — monthly sales targets (ml_targets table + localStorage cache)
              HeaderScopeProvider  — ML token scope: which ml_user_ids are active (mounted inside ApiLayout)
                MLStoreProvider    — ML store list, salesCache shell, derived selectedStore
                  MLInventoryProvider — live inventory from ml-inventory edge function (polls every 5 min)
```

### HeaderScopeContext

`HeaderScopeContext` (`src/contexts/HeaderScopeContext.tsx`) is the pivot between seller/store selection and which MercadoLivre accounts to query. It:
1. Reads `ml_tokens` rows for the current org + selected seller.
2. Derives `resolvedMLUserIds` — the list of `ml_user_id` strings to filter all ML data queries by.
3. Publishes `scopeKey` — a string that changes whenever seller, store, or ML user id set changes; child contexts and hooks reset their cache on `scopeKey` changes.

Store selection is persisted to `localStorage` as `scope_store_<sellerId>`.

### MLStoreContext

Wraps scope fields from `HeaderScopeContext`, enriches them with display names from `ml_user_cache`, and provides a `salesCache` shell (daily, hourly, products, mlUser) that pages can populate. `setSelectedStore` is a no-op — store selection is owned by `HeaderScopeContext`.

### MLInventoryContext

Fetches inventory from the `ml-inventory` edge function once on mount (and every 5 minutes via `setInterval`). Resets when `scopeKey` changes.

---

## Data Fetching Patterns

### Pattern 1 — TanStack React Query (main sales data)

Used for ML daily/hourly/product data. Lives in `src/hooks/useMLQueries.ts`.

Queries:
- `useMLDailyQuery(from, to)` → reads `ml_daily_cache` via `fetchDailyCache()` in `mlCacheService.ts`.
- `useMLHourlyQuery(isHourlyAvailable, targetDate)` → reads `ml_hourly_cache`.
- `useMLProductsQuery(from, to)` → calls `ml-products-aggregated` edge function.
- `useMLUserQuery()` → reads `ml_user_cache`.
- `useMLMonthlyDailyQuery()` → always fetches the current calendar month (used by `GoalsCard`).
- `useMLStateQuery(from, to)` → reads `ml_state_daily_cache`.

Query key structure: `["ml", type, userId, mlIds, from, to, store]`.

`staleTime` ranges from 2 to 10 minutes. `refetchOnWindowFocus` is disabled globally.

Cache scope: data is scoped first by `user_id`, then merged with `organization_id` rows. `mlCacheService.fetchScopedRows()` runs two queries and deduplicates by `(ml_user_id, date)` taking the most recent `synced_at`.

### Pattern 2 — Module-level singleton state (ML sync)

`useMLSync` (`src/hooks/useMLSync.ts`) uses a module-level singleton (`_state`, `_listeners`) with `useSyncExternalStore` so sync state (progress, syncing flag, lastSyncedAt) survives component unmounts. Sync calls `mercado-libre-integration` edge function in day-by-day chunks. After sync completes, calls `useInvalidateMLQueries().invalidateAll()`.

Auto-sync triggers once per component mount if the last sync timestamp is more than 10 minutes old.

### Pattern 3 — In-memory Map cache + direct fetch (ads, reputation, pricing)

`useMLAds`, `useMLReputation`, `useMLPrecosCustos` maintain their own module-level `Map` caches keyed by `scopeKey` + date range. They call edge functions directly via `fetch()` using the Supabase session access token as a Bearer token. Cache TTL is 5 minutes for ads, 1 minute for pricing.

### Pattern 4 — Polling (inventory)

`MLInventoryContext` uses `setInterval(fetchData, 5 * 60 * 1000)`. No real-time subscriptions used anywhere in the codebase.

### Pattern 5 — Direct Supabase client (product costs, coverage)

`useMLProductCosts` reads/upserts `ml_product_costs` directly. `useMLCoverage` reads `ml_product_daily_cache` with a fixed 30-day lookback.

---

## Edge Functions

All in `supabase/functions/`. Invoked via `supabase.functions.invoke()` or direct `fetch()` to `https://<project>.supabase.co/functions/v1/<name>`.

| Function | Purpose |
|---|---|
| `mercado-libre-integration` | Main ML sync: fetches orders/sales for a date range and writes to `ml_daily_cache`, `ml_hourly_cache`, `ml_product_daily_cache`, `ml_user_cache` |
| `ml-inventory` | Fetches live inventory from ML API for a `ml_user_id` |
| `ml-ads` | Fetches advertising stats (impressions, clicks, spend, ROAS) |
| `ml-reputation` | Fetches seller reputation from ML API |
| `ml-precos-custos` | Multi-mode: `items` (list active listings with prices), `references` (competitive price suggestion for one item), `costs` (commission calculator) |
| `ml-products-aggregated` | Aggregates `ml_product_daily_cache` rows for top-selling products view |
| `ml-token-refresh` | Refreshes expired ML OAuth tokens |
| `ml-oauth` | Handles ML OAuth code exchange, stores token in `ml_tokens` |
| `sync-ads` | Background ads sync (writes to `ml_ads_daily_cache`) |
| `sync-ml-orders` | Background orders sync |
| `org-invite-create` | Creates org invite token and sends email |
| `org-invite-accept` | Validates invite token, adds user to org |
| `org-member-remove` | Removes member from org |
| `org-member-update-role` | Changes member's org role |
| `org-transfer-ownership` | Transfers org owner_id |
| `admin-create-user` | Super-admin: creates user account |
| `admin-list-users` | Super-admin: lists all users |
| `admin-toggle-user` | Super-admin: enable/disable user |
| `admin-update-role` | Super-admin: change global app role |
| `super-admin-orgs` | Super-admin: CRUD operations on organizations |
| `super-admin-users` | Super-admin: user management for admin panel |
| `mercado-libre-integration` | Also handles MercadoLivre OAuth setup on first connect |

---

## Real-time vs Polling

No Supabase real-time subscriptions are used. All live data is polling-based:
- Inventory: 5-minute `setInterval` in `MLInventoryContext`.
- Sales data (daily/hourly): manual sync via `useMLSync.syncFromAPI()` with a 30-second cooldown. Auto-sync triggers once on mount if stale (> 10 minutes).
- Ads/reputation/pricing: fetched on mount, cached in memory for 5 minutes (ads/reputation) or 1 minute (pricing).

---

## Key Design Patterns

### scopeKey as cache-buster

`HeaderScopeContext` derives `scopeKey = \`${sellerId}:${storeId}:${mlUserIds.join(",")}\`` and publishes it. Every hook and context that holds ML data clears its state in a `useEffect` on `scopeKey` change.

### Primitive dependency stabilization

All three context layers (`AuthContext`, `OrganizationContext`, `HeaderScopeContext`) depend on `user?.id` (a string primitive) rather than the `user` object. This prevents Supabase token refresh events (which produce a new `user` object reference) from triggering unnecessary re-renders and data refetches.

### Optimistic updates

`useMLProductCosts.upsert()` updates local `Map` state immediately, then persists to Supabase. If the DB write fails, state is not rolled back (fire-and-forget pattern).

### Error boundaries

Every major page is wrapped in `<ErrorBoundary fallbackTitle="...">` in `App.tsx`. The boundary renders a localized error message with the page title.

### Admin isolation

The admin panel (`/admin/*`) instantiates `AdminAuthProvider` as a sibling to the main `AuthProvider`, not a child. Both share the same Supabase auth session but maintain separate React state. The main `AuthProvider.signIn()` actively blocks admin users from signing into the main app.
