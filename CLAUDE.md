<!-- GSD:project-start source:PROJECT.md -->
## Project

**Módulo Fiscal — Tributação por Regime**

Módulo de configuração tributária para a plataforma de gestão de vendedores do Mercado Livre. Permite que cada organização configure o regime tributário de cada loja ML (Simples Nacional, Lucro Presumido ou Lucro Real), e usa essa configuração para calcular automaticamente o valor e percentual de impostos exibidos na coluna Impostos do Catálogo de Anúncios.

**Core Value:** Cada loja ML tem seu regime tributário configurado, e o imposto sobre cada anúncio é calculado corretamente — sem digitação manual por produto.

### Constraints

- **Role**: Configuração restrita a `owner` — usar `RoleRoute` existente ou verificação inline
- **Scope**: Configuração é por `ml_user_id` (loja ML), não por organização inteira
- **Cálculo**: Imposto sempre sobre preço de venda (receita bruta), não sobre margem
- **Stack**: React + TypeScript + shadcn/ui + Supabase — sem novas dependências de cálculo fiscal externas
- **Display**: Coluna Impostos mostra `R$ X,XX (Y,Y%)` — ambos
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Framework & Runtime
- **React 18.3.1** — UI framework (not Next.js; pure SPA)
- **TypeScript 5.8.3** — all source files in `src/`
- **Vite 5.4.19** — build tool and dev server (port 8080, SWC-based transpiler)
- **@vitejs/plugin-react-swc 3.11.0** — SWC replaces Babel for fast compilation
## Edge Functions Runtime
- **Deno** (Supabase-hosted) — all edge functions use `https://deno.land/std@0.168.0/http/server.ts`
- Deno imports: `@supabase/supabase-js@2` via `https://esm.sh/`, `zod@v3.22.4` via `https://deno.land/x/zod`
## Routing
- **react-router-dom 6.30.1** — client-side routing (SPA)
## Server State & Data Fetching
- **@tanstack/react-query 5.83.0** — server state, caching, background refetch
## UI Component Library
- **shadcn/ui** pattern (components.json present) — Radix UI primitives + Tailwind CSS
- Full Radix UI suite: accordion, alert-dialog, aspect-ratio, avatar, checkbox, collapsible, context-menu, dialog, dropdown-menu, hover-card, label, menubar, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, slider, slot, switch, tabs, toast, toggle, toggle-group, tooltip
- **lucide-react 1.7.0** — icon library
- **cmdk 1.1.1** — command palette
- **vaul 0.9.9** — drawer component
- **react-resizable-panels 2.1.9** — resizable panel layouts
- **embla-carousel-react 8.6.0** — carousel
- **input-otp 1.4.2** — OTP input
## Styling
- **Tailwind CSS 3.4.17** — utility-first CSS
- **tailwindcss-animate 1.0.7** — animation utilities
- **@tailwindcss/typography 0.5.16** (dev)
- **postcss 8.5.6** + **autoprefixer 10.4.21**
- Custom design tokens: `kpi.positive/negative/neutral`, `table.stripe/hover/header`, `sidebar.*`, shadow variables (`shadow-glow`)
- Font: **Plus Jakarta Sans** (custom font family)
- **class-variance-authority 0.7.1** — variant-based className generation
- **clsx 2.1.1** + **tailwind-merge 2.6.0** — conditional class merging
## Forms & Validation
- **react-hook-form 7.61.1**
- **@hookform/resolvers 3.10.0**
- **zod 3.25.76** — schema validation (used both in frontend and edge functions)
## Charts & Data Visualization
- **recharts 2.15.4** — primary charting library
## Animation
- **framer-motion 12.38.0** — motion animations
## Date Handling
- **date-fns 3.6.0**
- **react-day-picker 8.10.1** — date picker UI
## Theming
- **next-themes 0.3.0** — dark/light mode toggle
## Notifications / Toast
- **sonner 1.7.4** — toast notifications
## Export
- **xlsx 0.20.3** (from cdn.sheetjs.com) — Excel file generation
## Backend (BaaS)
- **@supabase/supabase-js 2.98.0** — client SDK
- Supabase project ID: `gionpsuunfkkzzjdubfy`
- Auth: session stored in `localStorage`, `autoRefreshToken: true`, `persistSession: true`
## Testing
- **vitest 3.2.4** — test runner
- **@testing-library/react 16.0.0** + **@testing-library/jest-dom 6.6.0**
- **jsdom 20.0.3** — DOM environment for tests
## Linting
- **eslint 9.32.0** + **typescript-eslint 8.38.0**
- **eslint-plugin-react-hooks 5.2.0**
- **eslint-plugin-react-refresh 0.4.20**
## Build Output (Vite manual chunks)
- `react-vendor`: react, react-dom, react-router-dom
- `supabase`: @supabase/supabase-js
- `charts`: recharts
- `motion`: framer-motion
- `query`: @tanstack/react-query
- `dates`: date-fns
## Dev Tooling
- **lovable-tagger 1.1.13** — component tagging in dev mode (Lovable.dev platform)
- **bun** — lockfile present (`bun.lock`, `bun.lockb`), though `package-lock.json` also present (npm used for CI)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## TypeScript Patterns
### Strict Typing
- All components and hooks use explicit TypeScript interfaces. Props interfaces are defined inline in the same file, above the component. Example: `src/components/mercadolivre/MLKPIGrid.tsx` defines `interface Metrics` and `interface MLKPIGridProps` at the top of the file.
- Context types are always defined with an explicit interface before `createContext`. Example: `AuthContextType` in `src/contexts/AuthContext.tsx`.
- Return types are annotated on async query functions: `queryFn: async (): Promise<MLUser | null>` in `src/hooks/useMLQueries.ts`.
- The `any` type is used in a few spots for third-party data shapes (e.g., ML API responses in `useMLReputation.ts` — `raw: any`) and for Supabase query result mapping with `.map((m: any) => ...))` in `OrganizationContext.tsx`.
- Union types are used for domain discriminators: `type AppRole = "admin" | "editor" | "viewer"`, `type OrderStatus = "paid" | "shipped" | "delivered" | "cancelled" | "returned" | "pending"`, `type CardVariant = "default" | "success" | "warning" | ...`.
- `as const` is used on configuration arrays: `QUICK_RANGES` in `src/hooks/useMLFilters.ts`.
- Type aliases for Supabase scope columns: `type ScopeColumn = "user_id" | "organization_id"` in `src/services/mlCacheService.ts`.
### Nullability
- Nullable state is typed with `| null`: `useState<User | null>(null)`, `useState<Organization | null>(null)`.
- The nullish coalescing pattern `?? ""` and `?? null` is used consistently for safe defaults.
- Optional chaining is used on external data: `data.seller_reputation?.level_id`, `currentOrg?.id ?? null`.
## Component Structure
### Named Exports
### File-per-component
- `src/components/mercadolivre/` — ML feature components
- `src/components/layout/` — shell, header, sidebar
- `src/components/auth/` — route guards and auth UI
- `src/components/admin/` — super-admin panel
- `src/components/org/` — organization settings tabs
- `src/components/ui/` — shadcn/ui primitives (auto-generated, not edited)
- `src/components/dashboard/` — reusable KPI widgets
### Props Destructuring
### Class Components
## Styling Approach
### Tailwind CSS
### Design Tokens via CSS Custom Properties
- Semantic colors: `--background`, `--foreground`, `--card`, `--accent`, `--muted`, `--destructive`, `--success`, `--warning`
- Domain-specific tokens: `--kpi-positive`, `--kpi-negative`, `--kpi-neutral`, `--table-stripe`, `--table-hover`, `--table-header`
- Sidebar tokens: `--sidebar-background`, `--sidebar-accent`, `--sidebar-border`, etc.
- Custom gradient: `var(--gradient-primary)` used inline via `style={{ background: "var(--gradient-primary)" }}`
### shadcn/ui
### Inline Arbitrary Values
### Responsive Classes
### Animation
## Data Fetching Patterns
### Primary Pattern: TanStack React Query (v5)
### Legacy Pattern: useState + useCallback + useEffect
### Module-level Singleton State (useSyncExternalStore)
### Supabase Edge Functions
### Direct Supabase Queries
## Naming Conventions
### Files
- React components: `PascalCase.tsx` (e.g., `MLKPIGrid.tsx`, `ProtectedRoute.tsx`)
- Hooks: `use<Name>.ts` or `use<Name>.tsx` — camelCase with `use` prefix (e.g., `useMLFilters.ts`, `useMLSync.ts`)
- Contexts: `<Name>Context.tsx` (e.g., `AuthContext.tsx`, `OrganizationContext.tsx`)
- Services: camelCase (e.g., `mlCacheService.ts`)
- Types: camelCase (e.g., `mlCache.ts`, `seller.ts`)
- Pages: `PascalCase.tsx`, grouped in subdirectories by feature (`pages/mercadolivre/`, `pages/admin/`, `pages/org/`)
### Functions and Variables
- Components: `PascalCase`
- Hooks: `use<PascalCase>`
- Helper functions: `camelCase` (e.g., `calcDelta`, `mapDailyRow`, `dedupeLatestRows`)
- Constants: `SCREAMING_SNAKE_CASE` for module-level constants (e.g., `LAST_ML_SYNC_KEY`, `AUTO_SYNC_STALE_MS`, `SYNC_CHUNK_DAYS`)
- Type aliases / interfaces: `PascalCase`
### ML-Domain Naming
## Import Patterns
### Path Aliases
### Import Ordering (observed pattern)
### Re-exports
## Context Pattern
## Route / Auth Patterns
- `ProtectedRoute` (`src/components/auth/ProtectedRoute.tsx`) — renders `<Outlet />` if authenticated with an org, otherwise redirects.
- `RoleRoute` (`src/components/auth/RoleRoute.tsx`) — checks org-level role and viewer route permissions.
- `AdminProtectedRoute` — separate auth stack for super-admins, uses `AdminAuthContext`.
- All protected pages are wrapped in `<ErrorBoundary fallbackTitle="...">` in `App.tsx`.
- Pages are lazy-loaded with `React.lazy()` + `<Suspense fallback={<PageLoader />}>`.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Overview
## Routing
### Two independent auth stacks
- `AdminAuthProvider` is instantiated only for `/admin/login` and `/admin/*` routes.
- `AdminProtectedRoute` gates access; requires `user_roles.role = 'admin'`.
- Renders `AdminLayout` (its own layout shell without org context).
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
### OAuth redirect
## Auth Model
### Supabase Auth
### Two-tier role system
- `admin` — super-admin; can only log in at `/admin/login`; cannot access the main app.
- `editor` / `viewer` — standard app users; must belong to at least one organization.
- `owner` — full access, can manage sellers/integrations/org settings.
- `admin` — same as owner except org ownership transfer.
- `member` — operational access (orders, returns, questions, goals, pricing).
- `viewer` — default-deny; access only to routes explicitly granted by owner/admin via `member_route_permissions`.
### Access control
- `roleAccess` — static map of path → allowed org roles.
- `canAccess(role, path)` — simple role check.
- `canAccessWithViewer(role, path, viewerPermissions)` — same as above but for `viewer` role checks against the per-user granted route set stored in `viewerPermissions`.
- `VIEWER_ELIGIBLE_ROUTES` — 11 routes that can be individually unlocked for viewers.
## Context / Data Flow
### Context provider tree (main app)
```
```
### HeaderScopeContext
### MLStoreContext
### MLInventoryContext
## Data Fetching Patterns
### Pattern 1 — TanStack React Query (main sales data)
- `useMLDailyQuery(from, to)` → reads `ml_daily_cache` via `fetchDailyCache()` in `mlCacheService.ts`.
- `useMLHourlyQuery(isHourlyAvailable, targetDate)` → reads `ml_hourly_cache`.
- `useMLProductsQuery(from, to)` → calls `ml-products-aggregated` edge function.
- `useMLUserQuery()` → reads `ml_user_cache`.
- `useMLMonthlyDailyQuery()` → always fetches the current calendar month (used by `GoalsCard`).
- `useMLStateQuery(from, to)` → reads `ml_state_daily_cache`.
### Pattern 2 — Module-level singleton state (ML sync)
### Pattern 3 — In-memory Map cache + direct fetch (ads, reputation, pricing)
### Pattern 4 — Polling (inventory)
### Pattern 5 — Direct Supabase client (product costs, coverage)
## Edge Functions
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
## Real-time vs Polling
- Inventory: 5-minute `setInterval` in `MLInventoryContext`.
- Sales data (daily/hourly): manual sync via `useMLSync.syncFromAPI()` with a 30-second cooldown. Auto-sync triggers once on mount if stale (> 10 minutes).
- Ads/reputation/pricing: fetched on mount, cached in memory for 5 minutes (ads/reputation) or 1 minute (pricing).
## Key Design Patterns
### scopeKey as cache-buster
### Primitive dependency stabilization
### Optimistic updates
### Error boundaries
### Admin isolation
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
