# Phase 2 Research: Configuração Fiscal

Generated: 2026-05-15

---

## 1. Routing & Access Control

### How routes are defined in `src/App.tsx`

All app routes live inside a `<Route path="*">` that wraps `AuthProvider > OrganizationProvider > ... > SettingsProvider`. Every page that needs auth goes through `<ProtectedRoute />`. Pages that need role-gating wrap their element in `<RoleRoute>`. Lazy imports use `React.lazy(() => import(...))` as top-level consts before the JSX.

**Lazy import pattern (copy-paste template):**
```tsx
const MLFiscal = React.lazy(() => import("./pages/mercadolivre/MLFiscal"));
```

**Route registration pattern (inside the `ApiLayout` outlet block, around line 133):**
```tsx
<Route path="/fiscal" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página Fiscal"><MLFiscal /></ErrorBoundary></RoleRoute>} />
```

The `/integracoes` route is at line 133. `/fiscal` should be inserted directly after it.

### How `RoleRoute` works (`src/components/auth/RoleRoute.tsx`)

```tsx
export function RoleRoute({ children }: { children: React.ReactNode }) {
  const { orgRole, loading, viewerPermissions } = useOrganization();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!orgRole) return <Navigate to="/login" replace />;
  if (!canAccessWithViewer(orgRole, location.pathname, viewerPermissions)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
```

Access is controlled via `canAccessWithViewer` which reads `roleAccess` from `src/config/roleAccess.ts`.

### How to declare owner-only routes (`src/config/roleAccess.ts`)

```ts
const OWNER_ONLY: OrgRole[] = ["owner"];

export const roleAccess: Record<string, OrgRole[]> = {
  // existing routes...
  "/sellers": OWNER_ONLY,
  "/integracoes": OWNER_ONLY,
  "/monitoramento": OWNER_ONLY,
  // ADD:
  "/fiscal": OWNER_ONLY,
};
```

`/fiscal` is NOT in `VIEWER_ELIGIBLE_ROUTES` — it is owner-only, not viewer-eligible. **No entry needed in `VIEWER_ELIGIBLE_ROUTES`.**

Also add to `routeMeta.ts`:
```ts
"/fiscal": { title: "Configuração Fiscal", subtitle: "Configure o regime tributário de cada conta Mercado Livre" },
```

---

## 2. Sidebar

### Where to add the `/fiscal` item (`src/components/layout/ApiSidebar.tsx`)

The sidebar is built from the `apiSections` array. The "Configurações" group (last group) currently contains:
```ts
{
  icon: Settings2,
  label: "Configurações",
  path: "/metas",
  noSelfLink: true,
  children: [
    { icon: Target,   label: "Metas",       path: "/metas"       },
    { icon: Users,    label: "Sellers",     path: "/sellers"     },
    { icon: Plug,     label: "Integrações", path: "/integracoes" },
  ],
},
```

Add `/fiscal` as a child **after** `/integracoes`:
```ts
{ icon: FileText, label: "Fiscal", path: "/fiscal" },
// (FileText from lucide-react, or use Receipt/ReceiptText/Landmark)
```

### How owner-only hiding works

`EnvironmentSidebar.tsx` (lines 289–304) filters items via:
```tsx
const visibleItems = section.items
  .map((item) => {
    // Filter children...
    const visibleChildren = item.children.filter(
      (child) =>
        isMenuItemVisible(child.path, role) &&
        canAccessWithViewer(role, child.path, viewerPermissions)
    );
    return { ...item, children: visibleChildren };
  })
  .filter((item) => {
    if (!canAccessWithViewer(role, item.path, viewerPermissions)) return false;
    if (item.children && item.children.length === 0) return false;
    return true;
  });
```

Because `/fiscal` is `OWNER_ONLY` in `roleAccess`, `canAccessWithViewer` returns false for non-owner roles, so the item auto-hides. **No extra conditional needed in the sidebar.**

---

## 3. ML Page Patterns

### How to get the list of ML stores

Use `useMLStore()` from `src/contexts/MLStoreContext.tsx`:

```tsx
import { useMLStore } from "@/contexts/MLStoreContext";

const { stores, loading } = useMLStore();
// stores: MLStore[]
```

**`MLStore` shape:**
```ts
export interface MLStore {
  ml_user_id: string;        // key used in ml_tax_config
  nickname: string | null;   // ML username
  custom_name: string | null;
  displayName: string;       // computed: custom_name || nickname || `Loja ${ml_user_id}`
  seller_id: string | null;
}
```

`displayName` is the pre-computed display name — use this for store cards.

### How `useMLStore` gets its data

`MLStoreProvider` requires `HeaderScopeProvider > MLStoreProvider` as ancestors. This provider chain is already present in `App.tsx` at the `ApiLayout` level:
```tsx
<Route element={<HeaderScopeProvider><MLStoreProvider><MLInventoryProvider><ApiLayout /></MLInventoryProvider></MLStoreProvider></HeaderScopeProvider>}>
```

So `useMLStore()` is available from any page inside `ApiLayout` — including `/fiscal`.

### How org context is accessed

```tsx
import { useOrganization } from "@/contexts/OrganizationContext";
const { currentOrg } = useOrganization();
// currentOrg.id  ← organization_id for tax config queries
```

---

## 4. Form & Validation Patterns

### Zod + react-hook-form availability

Both are in `package.json`:
- `"react-hook-form": "^7.61.1"`
- `"zod": "^3.25.76"`

The shadcn `Form` component exists at `src/components/ui/form.tsx` and wraps `react-hook-form`'s `FormProvider` + `Controller`. It exports: `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`.

**However:** No existing page in the app currently uses `useForm` + `zodResolver`. Forms in the existing codebase use **uncontrolled `useState` with manual `parseFloat` validation** (see `MLPrecosCustos.tsx`).

**Decision required for planner:** Should `MLFiscal` forms use `useForm + zodResolver` (leveraging the installed libs) or follow the existing `useState` pattern? Recommendation: use `useState` for consistency; zod can be used just for a standalone validation helper without `react-hook-form`.

### Tabs pattern (from `MLProdutos.tsx` line 23)

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// shadcn Tabs — used throughout the codebase
```

Usage pattern (from MLProdutos and others):
```tsx
<Tabs value={tab} onValueChange={setTab}>
  <TabsList>
    <TabsTrigger value="simples">Simples Nacional</TabsTrigger>
    <TabsTrigger value="presumido">Lucro Presumido</TabsTrigger>
    <TabsTrigger value="real">Lucro Real</TabsTrigger>
  </TabsList>
  <TabsContent value="simples">...</TabsContent>
  ...
</Tabs>
```

### Numeric input with validation (from `MLPrecosCustos.tsx`)

No `%` suffix wrapper exists in the codebase. Pattern used is plain `<Input>` with `onChange` parsing. For a `%` suffix, build a wrapper div:

```tsx
<div className="relative">
  <Input
    id="effective-rate"
    type="number"
    step="0.1"
    min="0.5"
    max="19.5"
    value={rate}
    onChange={(e) => setRate(e.target.value)}
    className="pr-8"
  />
  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
</div>
```

Tooltip on label pattern (from `MLPrecosCustos.tsx` lines 224–234):
```tsx
<Label className="text-xs flex items-center gap-1">
  Alíquota efetiva
  <Tooltip>
    <TooltipTrigger asChild>
      <Info className="w-3 h-3 cursor-help text-muted-foreground" />
    </TooltipTrigger>
    <TooltipContent>
      Informe a alíquota efetiva do DAS. Permitido: 0,5% a 19,5%.
    </TooltipContent>
  </Tooltip>
</Label>
```

---

## 5. Dialog Patterns

### Confirmation dialog pattern — `AlertDialog` (`src/components/org/OrgMembersTab.tsx`)

This is the standard pattern used for destructive confirmations:

```tsx
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="ghost" size="sm">Alterar Regime</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Alterar regime tributário?</AlertDialogTitle>
      <AlertDialogDescription>
        Esta alteração afetará os cálculos de margem daqui em diante.
        O histórico anterior não será recalculado.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction onClick={handleConfirmRegimeChange}>Confirmar</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

For a **controlled** dialog (open/close from outside), use `<Dialog>` from `src/components/ui/dialog.tsx` — already imported in `Integrations.tsx`:
```tsx
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Confirmar alteração?</DialogTitle>
      <DialogDescription>...</DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
      <Button onClick={handleConfirm}>Confirmar</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Recommendation:** Use controlled `Dialog` (not `AlertDialog`) for the regime change confirmation so it can be opened programmatically after selecting a new regime.

---

## 6. Upsert Pattern

### Direct Supabase upsert (from `src/hooks/useMLProductCosts.ts`)

The codebase uses **direct supabase calls in hooks**, not `useMutation`. Pattern:

```ts
const { error } = await supabase.from("ml_tax_config").upsert(
  {
    organization_id: orgId,
    ml_user_id: mlUserId,
    regime: "simples_nacional",
    // ... regime-specific fields
    updated_at: new Date().toISOString(),
  },
  { onConflict: "organization_id,ml_user_id" },
);
if (error) console.warn("upsert error", error);
```

### TanStack Query invalidation

`useQueryClient` is imported in `useMLQueries.ts` for `keepPreviousData`, but `useMutation` is **not used anywhere** in the codebase. After a successful upsert, use `queryClient.invalidateQueries` to refresh:

```ts
import { useQueryClient } from "@tanstack/react-query";
const queryClient = useQueryClient();
// after successful upsert:
queryClient.invalidateQueries({ queryKey: ["ml", "taxConfig", orgId] });
```

### Existing tax config hook

`src/hooks/useMLTaxConfig.ts` already exists and fetches from `ml_tax_config` table. It:
- Accepts `mlUserIds: string[]` and `orgId: string`
- Returns `Map<string, MLTaxConfigEntry>` where entry has `{ regime: string, effective_rate: number }`
- Uses `useQuery` with key `["ml", "taxConfig", orgId, mlUserIds]`

The write side (upsert) is **not yet implemented** — the fiscal page will need to create a `useMLTaxConfigMutation` hook or inline the upsert.

---

## 7. Badge & Card Patterns

### Badge (from `src/components/ui/badge.tsx`)

```tsx
import { Badge } from "@/components/ui/badge";

// Named variants: "default" | "secondary" | "destructive" | "outline"
// Colored badges use className override (no color variants built-in):

// Active regime badge:
<Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-xs">
  Simples Nacional
</Badge>

// Not configured:
<Badge variant="secondary" className="text-xs">Não configurado</Badge>

// Credit badge (Lucro Real negative rate):
<Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 text-xs">
  Crédito
</Badge>
```

Color badge pattern (from `MLPrecosCustos.tsx` line 262):
```tsx
<Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 gap-1 text-xs">
  <CheckCircle2 className="w-3 h-3" /> Comissões reais
</Badge>
```

### Card pattern (from `MLProdutos.tsx` and `OrgMembersTab.tsx`)

```tsx
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

<Card>
  <CardHeader className="pb-3">
    <CardTitle className="text-sm font-medium flex items-center gap-2">
      <Store className="w-4 h-4" />
      {store.displayName}
    </CardTitle>
    <CardDescription className="text-xs">
      ID: {store.ml_user_id}
    </CardDescription>
  </CardHeader>
  <CardContent>
    ...
  </CardContent>
</Card>
```

---

## 8. Toast / Feedback

### `useToast` pattern (from `src/hooks/use-toast.ts` and `OrgMembersTab.tsx`)

```tsx
import { useToast } from "@/hooks/use-toast";

const { toast } = useToast();

// Success:
toast({ title: "Regime atualizado com sucesso" });

// Error:
toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
```

`Toaster` is already mounted in `App.tsx` (line 67), so no additional setup is needed.

---

## Ambiguities & Decisions for Planner

### DECISION-1: Form state approach
No existing page uses `useForm + zodResolver`. Options:
- **A (Recommended):** Use `useState` with inline `parseFloat` validation, matching all existing ML pages. Simple and consistent.
- **B:** Use `useForm + zodResolver` — leverages installed libs, gives typed form state and error messages via `FormMessage`. More boilerplate.

### DECISION-2: Where to put the save/upsert logic
The `useMLTaxConfig` hook is read-only. Options:
- **A (Recommended):** Create a new `useMLTaxConfigMutation` hook with an `upsert(mlUserId, payload)` function that calls supabase + invalidates the query. Pattern matches `useMLProductCosts.ts`.
- **B:** Inline the supabase upsert directly in `MLFiscal.tsx`. Simpler but not reusable.

### DECISION-3: Tabs vs separate drawer/sheet for regime forms
- **A (Recommended):** Clicking "Configurar/Editar" opens a `Dialog` containing `<Tabs>` for the three regimes. Keeps the list clean.
- **B:** Expand inline within the card. More complex layout.

### DECISION-4: `ml_tax_config` table schema
`useMLTaxConfig` returns `{ regime, effective_rate }` where `effective_rate` comes from a DB trigger `calculate_effective_rate`. The Lucro Presumido and Lucro Real field names are **not visible in the frontend code**. The planner must check the migration in `.planning/phases/01-infraestrutura/` or the Supabase schema to confirm column names for PIS/COFINS/IRPJ/CSLL (Presumido) and debit/credit PIS/COFINS/ICMS (Real) before writing the upsert payload.

### DECISION-5: `canAccessWithViewer` with `/fiscal`
`/fiscal` must be added to `roleAccess` in `src/config/roleAccess.ts` under `OWNER_ONLY`. It must **not** be added to `VIEWER_ELIGIBLE_ROUTES`. This is consistent with `/sellers` and `/integracoes`.

### DECISION-6: `routeMeta.ts` entry
Add an entry for `/fiscal` in `src/components/layout/routeMeta.ts` for the page header subtitle to render correctly.
