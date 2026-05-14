# Code Conventions

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

---

## Component Structure

### Named Exports
All components use **named exports** (not default exports) for components defined with `export function`. Default exports are used only for lazy-loaded pages (required by `React.lazy()`).

Example — named export in a shared component:
```tsx
// src/components/mercadolivre/MLKPIGrid.tsx
export function MLKPIGrid({ ... }: MLKPIGridProps) { ... }
```

Example — default export for a page (for React.lazy):
```tsx
// src/pages/MercadoLivre.tsx — default export
export default function MercadoLivre() { ... }
```

### File-per-component
Each component lives in its own file. Feature grouping by subdirectory:
- `src/components/mercadolivre/` — ML feature components
- `src/components/layout/` — shell, header, sidebar
- `src/components/auth/` — route guards and auth UI
- `src/components/admin/` — super-admin panel
- `src/components/org/` — organization settings tabs
- `src/components/ui/` — shadcn/ui primitives (auto-generated, not edited)
- `src/components/dashboard/` — reusable KPI widgets

### Props Destructuring
Props are always destructured in the function signature with defaults inline:
```tsx
export function KPICard({
  loading = false,
  refreshing = false,
  variant = "default",
  size = "default",
  animateValue = true,
  ...
}: KPICardProps) { ... }
```

### Class Components
Used only for `ErrorBoundary` (`src/components/ErrorBoundary.tsx`), which requires `componentDidCatch`. All other components are function components.

---

## Styling Approach

### Tailwind CSS
Tailwind is the primary styling mechanism. Classes are applied directly in JSX. `cn()` from `src/lib/utils.ts` (wraps `clsx` + `tailwind-merge`) is the standard way to compose conditional classes:
```tsx
import { cn } from "@/lib/utils";
cn(styles.card, refreshing && "animate-pulse opacity-60 transition-opacity duration-300", className)
```

### Design Tokens via CSS Custom Properties
Colors and spacing are defined as HSL CSS variables in `src/index.css` and mapped to Tailwind theme tokens in `tailwind.config.ts`. This enables dark mode via class toggling (`darkMode: ["class"]`). Token groups include:
- Semantic colors: `--background`, `--foreground`, `--card`, `--accent`, `--muted`, `--destructive`, `--success`, `--warning`
- Domain-specific tokens: `--kpi-positive`, `--kpi-negative`, `--kpi-neutral`, `--table-stripe`, `--table-hover`, `--table-header`
- Sidebar tokens: `--sidebar-background`, `--sidebar-accent`, `--sidebar-border`, etc.
- Custom gradient: `var(--gradient-primary)` used inline via `style={{ background: "var(--gradient-primary)" }}`

### shadcn/ui
All primitive UI components come from shadcn/ui in `src/components/ui/`. Components are composed via Radix UI primitives and styled with Tailwind. Usage pattern: import named exports from `@/components/ui/<component>`:
```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, ... } from "@/components/ui/dropdown-menu";
```

### Inline Arbitrary Values
Arbitrary Tailwind values are used for one-off colors not covered by the design system:
```tsx
className="bg-[hsl(270,70%,50%)]/10 text-[hsl(270,70%,50%)]"   // purple in KPICard
className="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]"     // orange in KPICard
```

### Responsive Classes
Breakpoint prefixes `sm:`, `md:`, `lg:` are used inline on layout components. Example from `Header.tsx`:
```tsx
className="flex items-center justify-between border-b border-border bg-card px-3 md:px-8 py-2.5 md:py-4 gap-2"
```

### Animation
Custom keyframes defined in `tailwind.config.ts`: `fade-in`, `slide-in`, `scale-in`, `logo-pulse`, `logo-halo`, `shimmer`. Loading skeletons use `animate-pulse`.

---

## Data Fetching Patterns

### Primary Pattern: TanStack React Query (v5)
New data fetching uses `useQuery` from `@tanstack/react-query`. Query key factories are exported as objects for consistency:
```ts
// src/hooks/useMLQueries.ts
export const mlKeys = {
  daily: (userId, mlIds, from, to, store) => ["ml", "daily", userId, mlIds, from, to, store] as const,
  hourly: (...) => [...] as const,
  ...
};
```

All queries use `keepPreviousData` (via `placeholderData: keepPreviousData`) to prevent content flicker on filter changes. `staleTime` is set per query (2–10 min). `enabled` guard pattern is used consistently to prevent fetching before auth resolves:
```ts
enabled: !!userId && resolvedMLUserIds.length > 0 && !!fetchFrom
```

Global QueryClient config in `src/App.tsx`:
```ts
defaultOptions: { queries: { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000, refetchOnWindowFocus: false, retry: 1 } }
```

Cache invalidation is done via a dedicated `useInvalidateMLQueries()` hook that returns scoped invalidate functions.

### Legacy Pattern: useState + useCallback + useEffect
Older hooks like `useMLReputation.ts` use manual state management:
```ts
const [loading, setLoading] = useState(false);
const fetchReputation = useCallback(async () => { ... }, [deps]);
useEffect(() => { fetchReputation(); }, [fetchReputation]);
```

### Module-level Singleton State (useSyncExternalStore)
`useMLSync.ts` uses a module-level singleton pattern to keep sync state alive across component unmounts. Uses `useSyncExternalStore` to subscribe React components to a non-React state store. This is a one-off pattern for the long-running sync operation.

### Supabase Edge Functions
Invoked via `supabase.functions.invoke("function-name", { body: {...} })`. Used for ML data sync (`mercado-libre-integration`), aggregated product queries (`ml-products-aggregated`), and others.

### Direct Supabase Queries
Used for auth, profiles, org membership, role lookup:
```ts
await supabase.from("organization_members").select("role, organization_id, organizations(...)").eq("user_id", uid);
```

---

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
The codebase uses Portuguese for UI text and route paths (`/pedidos`, `/estoque`, `/publicidade`). TypeScript identifiers remain in English. Database column names follow snake_case (`total_revenue`, `ml_user_id`, `qty_orders`).

---

## Import Patterns

### Path Aliases
`@/` maps to `src/`. Used everywhere instead of relative paths:
```ts
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
```

### Import Ordering (observed pattern)
1. React core imports
2. Third-party libraries (react-router-dom, @tanstack/react-query, recharts, date-fns, lucide-react)
3. Internal `@/components/ui/` shadcn primitives
4. Internal feature components (`@/components/mercadolivre/`, etc.)
5. Internal hooks and contexts
6. Internal types and services

### Re-exports
Types used by multiple modules are re-exported from their canonical location. Example in `useMLQueries.ts`:
```ts
export type { DailyBreakdown, HourlyBreakdown, MLUser };
```

---

## Context Pattern

All contexts follow a consistent shape:
1. Define `interface <Name>ContextType`
2. `const Context = createContext<ContextType | undefined>(undefined)`
3. Export `function <Name>Provider({ children }: { children: ReactNode })`
4. Export `function use<Name>()` that throws if used outside provider:
```ts
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
```

Context providers are composed in `App.tsx`. The full provider tree for the main app: `QueryClientProvider > TooltipProvider > BrowserRouter > AuthProvider > OrganizationProvider > MenuVisibilityProvider > SellerProvider > SettingsProvider > HeaderScopeProvider > MLStoreProvider > MLInventoryProvider`.

---

## Route / Auth Patterns

- `ProtectedRoute` (`src/components/auth/ProtectedRoute.tsx`) — renders `<Outlet />` if authenticated with an org, otherwise redirects.
- `RoleRoute` (`src/components/auth/RoleRoute.tsx`) — checks org-level role and viewer route permissions.
- `AdminProtectedRoute` — separate auth stack for super-admins, uses `AdminAuthContext`.
- All protected pages are wrapped in `<ErrorBoundary fallbackTitle="...">` in `App.tsx`.
- Pages are lazy-loaded with `React.lazy()` + `<Suspense fallback={<PageLoader />}>`.
