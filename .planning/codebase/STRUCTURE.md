# Structure

## Root

```
garment-glow-app-0cc0fcfc/
├── src/                   — React application source
├── supabase/              — Supabase config, migrations, edge functions
├── public/                — Static assets served verbatim
├── index.html             — Vite entry HTML
├── vite.config.ts         — Vite build config (path alias @/ → src/)
├── tsconfig.app.json      — TypeScript config for app code
├── tailwind.config.ts     — Tailwind CSS config
├── components.json        — shadcn/ui component config
├── package.json
└── vitest.config.ts       — Test runner config
```

---

## src/

### src/main.tsx
Entry point. Mounts `<App />` into `#root`.

### src/App.tsx
Top-level component. Defines the entire React Router tree (both admin and main app). Instantiates `QueryClient` with global defaults (5-min staleTime, no refetchOnWindowFocus). All page components are lazy-loaded.

### src/index.css / App.css
Global styles, Tailwind directives, CSS custom properties (design tokens for sidebar, gradients, shadows).

---

## src/pages/

Top-level page components. Each maps 1:1 to a route.

```
pages/
├── MercadoLivre.tsx         — / (Vendas dashboard: KPIs, revenue chart, hourly table, top products)
├── TVModeVendas.tsx         — /tv (full-screen TV dashboard for display boards)
├── Sellers.tsx              — /sellers (seller and store CRUD)
├── Profile.tsx              — /perfil (user profile, avatar upload)
├── Integrations.tsx         — /integracoes (ML OAuth connect/disconnect)
├── AdminMonitoring.tsx      — /monitoramento (DB row counts, sync logs)
├── AcceptInvite.tsx         — /aceitar-convite (org invite acceptance flow)
├── Login.tsx                — /login
├── ResetPassword.tsx        — /reset-password
├── NotFound.tsx             — * (404)
├── mercadolivre/            — ML sub-pages (all under /*)
│   ├── MLEstoque.tsx        — /estoque (inventory table with coverage analysis)
│   ├── MLProdutos.tsx       — /anuncios (product catalog, listing health)
│   ├── MLPedidos.tsx        — /pedidos (orders list)
│   ├── MLAnuncios.tsx       — /publicidade (advertising: campaigns, daily stats, products)
│   ├── MLFinanceiro.tsx     — /financeiro (margin analysis: fees, costs, shipping)
│   ├── MLReputacao.tsx      — /reputacao (seller reputation, ratings breakdown)
│   ├── MLDevolucoes.tsx     — /devolucoes (returns and claims)
│   ├── MLPerguntas.tsx      — /perguntas (buyer questions and messages)
│   ├── MLMetas.tsx          — /metas (monthly sales targets, PMT distribution)
│   └── MLPrecosCustos.tsx   — /precos-custos (pricing, commission calculator, competitive references)
├── org/
│   └── OrgSettings.tsx      — /organizacao (members, invites, viewer permissions, audit log)
└── admin/
    ├── AdminLogin.tsx        — /admin/login
    ├── AdminDashboard.tsx    — /admin (org stats overview)
    ├── AdminOrganizations.tsx — /admin/organizacoes
    └── AdminUsers.tsx        — /admin/usuarios
```

---

## src/components/

Organized by domain. No barrel `index.ts` files — imports use full paths.

### layout/

Shell, navigation, and header components.

```
layout/
├── LayoutShell.tsx          — Flex wrapper: sidebar + Header + <Outlet>. Handles mobile drawer.
├── ApiLayout.tsx            — Thin wrapper: instantiates ApiSidebar + ApiMobileSidebar inside LayoutShell.
├── ApiSidebar.tsx           — Sidebar nav definition (sections: Dashboard, Operações, Pós-venda, Configurações).
├── ApiMobileSidebar.tsx     — Mobile-specific sidebar (simplified for drawer context).
├── EnvironmentSidebar.tsx   — Reusable collapsible sidebar with role filtering, "coming soon" badges.
├── Header.tsx               — Top bar: OrganizationSwitcher, SellerMarketplaceBar, user avatar/dropdown.
├── SellerMarketplaceBar.tsx — Seller switcher + StoreGroupSelector in the header.
├── StoreGroupSelector.tsx   — Per-store toggle chips (backed by HeaderScopeContext.setStoreId).
├── OrganizationSwitcher.tsx — Org dropdown (backed by OrganizationContext.switchOrg).
├── PageHeader.tsx           — Generic page title + subtitle block.
└── routeMeta.ts             — Static map of path → { title, subtitle } used by LayoutShell/Header.
```

### auth/

Route guards and OAuth utilities.

```
auth/
├── ProtectedRoute.tsx       — Requires user + currentOrg; redirects admins to /admin.
├── RoleRoute.tsx            — Per-route org role check via canAccessWithViewer().
├── AdminProtectedRoute.tsx  — Requires admin === non-null (AdminAuthContext).
├── TVRoleGuard.tsx          — Guards /tv using the same permission as /.
├── OAuthCodeRedirect.tsx    — Intercepts ?code= on any URL and sends to /integracoes.
├── SuperAdminRoute.tsx      — (unused directly; AdminProtectedRoute is the actual guard)
└── PasswordStrengthIndicator.tsx — Visual password strength bar for registration/reset forms.
```

### mercadolivre/

ML-specific display components used across ML pages.

```
mercadolivre/
├── MLKPIGrid.tsx            — Grid of KPI metric cards (revenue, orders, avg ticket, etc.)
├── MLRevenueChart.tsx       — Recharts area/bar chart switching between daily and hourly modes.
├── MLPeriodPicker.tsx       — Date range picker (quick presets: Hoje, 7d, 15d, 30d + custom calendar).
├── MLPageHeader.tsx         — Page header with sync button, last sync timestamp, period picker.
├── MLStoreSelector.tsx      — Store scope dropdown (backed by HeaderScopeContext).
├── TopSellingProducts.tsx   — Product sales ranking table.
├── MLTopProducts.tsx        — Alternative products component.
├── HourlySalesTable.tsx     — Hourly breakdown table for same-day view.
├── GoalsCard.tsx            — Monthly goal progress vs actual (uses useMLMonthlyDailyQuery).
├── BrazilHeatMap.tsx        — SVG heatmap of order density by Brazilian state.
├── HistoricalSyncModal.tsx  — Modal to trigger a historical sync for a custom date range.
├── MLCostCard.tsx           — Cost analysis card (fees, commissions).
├── CoverageAlerts.tsx       — Stock coverage alert badges (ruptura, crítico, alerta).
├── CoverageSettingsPopover  — Threshold configuration for coverage classification.
└── PublicidadeRelatorios.tsx — Ads reports with campaign/product breakdown.
```

### org/

Org settings tabs, rendered by `OrgSettings` page.

```
org/
├── OrgGeneralTab.tsx        — Org name, slug, logo.
├── OrgMembersTab.tsx        — Member list, role change, remove member.
├── OrgInvitesTab.tsx        — Send invite by email, list pending invites.
├── OrgAuditTab.tsx          — Activity audit log.
└── ViewerPermissionsDialog.tsx — Per-viewer route access toggle.
```

### admin/

Admin panel layout and cards.

```
admin/
├── AdminLayout.tsx          — Admin-specific layout (own sidebar, no org context).
├── AuditLogCard.tsx         — Recent activity log widget.
└── MenuVisibilityCard.tsx   — Per-role menu visibility configuration UI.
```

### dashboard/

```
dashboard/
└── KPICard.tsx              — Generic metric card with value, delta, and trend indicator.
```

### chat/

```
chat/
└── FloatingChat.tsx         — Floating help/chat button (UI only).
```

### login/

```
login/
└── FloatingFeatureCards.tsx — Animated feature highlight cards on the login page.
```

### ui/

shadcn/ui primitives: `button`, `card`, `dialog`, `dropdown-menu`, `input`, `table`, `tabs`, `tooltip`, `sheet`, `collapsible`, `sonner`, `toaster`, `avatar`, `badge`, `popover`, `calendar`, `select`, `skeleton`, `PageLoader`, etc.

### ErrorBoundary.tsx
Class-based error boundary. Takes a `fallbackTitle` prop. Renders an error card instead of crashing the subtree.

### NavLink.tsx
Thin wrapper around React Router `<Link>` with active state styling.

---

## src/contexts/

All contexts follow the pattern: Provider component + `useXxx()` hook + `useXxxSafe()` hook (safe variant returns null instead of throwing if used outside provider).

| File | Context | Key state |
|---|---|---|
| `AuthContext.tsx` | `AuthContext` | `user`, `session`, `role` (global app role), `profile` |
| `AdminAuthContext.tsx` | `AdminAuthContext` | `admin` (User or null), `session` — admin-only auth stack |
| `OrganizationContext.tsx` | `OrganizationContext` | `orgs`, `currentOrg`, `orgRole`, `viewerPermissions` |
| `SellerContext.tsx` | `SellerContext` | `sellers`, `selectedSeller`, `selectedMarketplace`, `selectedStoreIds`, CRUD methods |
| `HeaderScopeContext.tsx` | `HeaderScopeContext` | `sellerId`, `storeId`, `resolvedMLUserIds`, `scopeKey`, `tokens` |
| `MLStoreContext.tsx` | `MLStoreContext` | `stores` (ML store list), `selectedStore`, `salesCache`, `scopeKey` |
| `MLInventoryContext.tsx` | `MLInventoryContext` | `items` (ProductItem[]), `summary`, live polling via ml-inventory |
| `SettingsContext.tsx` | `SettingsContext` | `targets` (MonthlyTarget[]), persisted to `ml_targets` table + localStorage |
| `MenuVisibilityContext.tsx` | `MenuVisibilityContext` | `config` (per-role hidden routes), persisted to localStorage |

---

## src/hooks/

Custom hooks, all prefixed `use`.

| File | Purpose |
|---|---|
| `useMLQueries.ts` | TanStack Query wrappers: `useMLDailyQuery`, `useMLHourlyQuery`, `useMLProductsQuery`, `useMLUserQuery`, `useMLMonthlyDailyQuery`, `useMLStateQuery`, `useInvalidateMLQueries` |
| `useMLSync.ts` | Module-level sync singleton: `syncFromAPI()`, `shouldAutoSync()`, `syncProgress` |
| `useMLFilters.ts` | Date range and period state for ML pages: `useMLFilters(initialPeriod)`, `getFilterDates()`, `getComparisonRanges()` |
| `useMLAds.ts` | Advertising data from `ml-ads` edge function with module-level Map cache |
| `useMLReputation.ts` | Seller reputation from `ml-reputation` edge function |
| `useMLPrecosCustos.ts` | Pricing/costs from `ml-precos-custos` edge function (items, references, costs modes) |
| `useMLCoverage.ts` | Stock coverage analysis computed from `ml_product_daily_cache` + inventory items |
| `useMLProductCosts.ts` | Read/upsert `ml_product_costs` (cost + tax_rate per item_id) |
| `use-mobile.tsx` | `useIsMobile()` — breakpoint detection via `matchMedia` |
| `use-toast.ts` | Toast state management (shadcn pattern) |
| `useCountAnimation.ts` | Animated number counter for KPI cards |

---

## src/services/

```
services/
└── mlCacheService.ts   — Supabase query helpers for all ML cache tables.
                          Exports: fetchDailyCache, fetchHourlyCache, fetchProductDailyCache,
                          fetchStateDailyCache, fetchUserCache, syncMLData, fetchInventory,
                          upsertDailyCache, upsertSyncLog.
                          Core pattern: fetchScopedRows() — queries by user_id, then by
                          organization_id, merges, deduplicates by (ml_user_id, date/hour/item).
```

---

## src/config/

```
config/
├── roleAccess.ts       — roleAccess map, canAccess(), canAccessWithViewer(), VIEWER_ELIGIBLE_ROUTES
├── marketplaceConfig.ts — Marketplace brand definitions (name, icon, gradient colors)
└── storeColors.ts      — Color palette for store chips and charts
```

---

## src/types/

```
types/
├── mlCache.ts          — Row types for all ML cache tables (DailyRow, HourlyRow,
                          ProductDailyRow, MLUserCacheRow, StateDailyRow) + mappers
├── seller.ts           — Seller, SellerStore, ALL_MARKETPLACES constant, buildSeller(), generateInitials()
└── settings.ts         — MonthlyTarget, DailyPMT, generateTargetId(), generateDefaultPMTDistribution()
```

---

## src/data/

Mock data files used as fallbacks when real API data is unavailable.

```
data/
├── devolucoesMockData.ts
├── financialMockData.ts
├── pedidosMockData.ts
├── perguntasMockData.ts
└── reputacaoMockData.ts
```

---

## src/lib/

```
lib/
├── utils.ts        — cn() (clsx + tailwind-merge), generic helpers
├── formatters.ts   — Currency, date, percentage formatters (pt-BR locale)
└── logger.ts       — Thin console wrapper with log levels
```

---

## src/utils/

```
utils/
└── passwordValidation.ts  — Password strength scoring
```

---

## src/integrations/supabase/

Auto-generated by Supabase CLI.

```
integrations/supabase/
├── client.ts   — createClient() with URL + anon key; exported as `supabase`
└── types.ts    — Full Database type definitions for all tables/views/functions
```

---

## supabase/

```
supabase/
├── config.toml         — Project config (project_id, API settings)
├── migrations/         — 50 SQL migration files (timestamped)
│   └── ...             — Tables: organizations, organization_members, member_route_permissions,
│                         sellers, seller_stores, ml_tokens, ml_daily_cache, ml_hourly_cache,
│                         ml_product_daily_cache, ml_user_cache, ml_state_daily_cache,
│                         ml_ads_daily_cache, ml_sync_log, ml_targets, ml_product_costs,
│                         profiles, user_roles, audit_log
└── functions/          — 19 Deno edge functions (see ARCHITECTURE.md for full list)
    ├── mercado-libre-integration/
    ├── ml-inventory/
    ├── ml-ads/
    ├── ml-reputation/
    ├── ml-precos-custos/
    ├── ml-products-aggregated/
    ├── ml-oauth/
    ├── ml-token-refresh/
    ├── sync-ads/
    ├── sync-ml-orders/
    ├── org-invite-create/
    ├── org-invite-accept/
    ├── org-member-remove/
    ├── org-member-update-role/
    ├── org-transfer-ownership/
    ├── admin-create-user/
    ├── admin-list-users/
    ├── admin-toggle-user/
    ├── admin-update-role/
    ├── super-admin-orgs/
    └── super-admin-users/
```

---

## public/

Static assets (images, icons, favicons). Served at `/` without transformation.

---

## Naming Conventions

- **Pages**: PascalCase, no suffix. ML sub-pages prefixed `ML` (e.g., `MLEstoque.tsx`). Admin pages prefixed `Admin`.
- **Components**: PascalCase, no suffix. Named exports (not default).
- **Contexts**: `XxxContext.tsx` file, exports `XxxProvider` + `useXxx()`.
- **Hooks**: `useCamelCase.ts` (or `.tsx` if returning JSX).
- **Types**: `camelCase.ts`, PascalCase interfaces.
- **Config/utils**: `camelCase.ts`.
- **Edge functions**: kebab-case directories matching invocation name.
- **DB migrations**: `YYYYMMDDHHMMSS_<uuid>.sql` or `YYYYMMDDHHMMSS_<descriptive-name>.sql`.
- **Routes**: Portuguese slugs matching the app's pt-BR language (e.g., `/integracoes`, `/pedidos`, `/reputacao`).
