# Phase 44: Monetização Stripe - Pattern Map

**Mapped:** 2026-06-14
**Files analyzed:** 11 (4 EFs/config, 4 migrations, 3 frontend/types)
**Analogs found:** 10 / 11 (1 partial — webhook signature has no exact analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/functions/stripe-checkout/index.ts` | EF (controller) | request-response | `supabase/functions/ml-inventory/index.ts` (JWT auth + external API + secret) + `supabase/functions/ml-oauth/index.ts` (action router + service-role admin client) | exact (role+flow) |
| `supabase/functions/stripe-webhook/index.ts` | EF (controller) | event-driven (webhook) | `supabase/functions/ml-oauth/index.ts` (verify_jwt=false + own auth) | partial — HMAC signature verify has no codebase precedent (use RESEARCH Pattern 2) |
| `supabase/config.toml` (modify) | config | — | existing `[functions.ml-oauth] verify_jwt=false` + `[functions.ml-inventory] verify_jwt=true` blocks | exact |
| `supabase/migrations/2026XXXX_subscriptions_billing_events.sql` | migration (model) | CRUD | `20260614123000_tenant04_onboarding_progress.sql` (org-first RLS) + `20260519120000_organization_plans_quota.sql` (table+enum+RLS+service-role-only writes) | exact |
| `supabase/migrations/2026XXXX_apply_subscription_tier_rpc.sql` | migration (RPC) | transform (atomic UPSERT+UPDATE) | `20260614122000_tenant03_check_quota_rpc.sql` (SECURITY DEFINER + atomic ON CONFLICT + REVOKE/GRANT service_role) | exact |
| `supabase/migrations/2026XXXX_tier_price_mapping.sql` | migration (model) | CRUD (seed) | `20260519120000_organization_plans_quota.sql` (table + RLS) | role-match |
| `supabase/migrations/2026XXXX_history_days_enforcement.sql` | migration (RPC/RLS) | transform/guard | `20260614122000_tenant03_check_quota_rpc.sql` (STABLE/DEFINER read of organization_plans) + `20260519120000` RLS policies | role-match |
| `src/pages/org/Planos.tsx` | page (component) | request-response (invoke + read) | `src/pages/Integrations.tsx` (owner-only page that invokes EFs via `functions.invoke`) | exact |
| `src/hooks/useSubscription.ts` | hook | CRUD (react-query read) | `src/hooks/useOnboardingProgress.ts` (org-scoped react-query read of a single org row) | exact |
| `src/services/mlCacheService.ts` (modify) | service | request-response (data clamp) | self — clamp `dateFrom` at the `.gte("date", dateFrom)` call sites | self-modify |
| `src/integrations/supabase/types.ts` (modify) | types | — | existing `organization_plans:` block (Row/Insert/Update/Relationships) + `Enums.plan_tier` | exact |

## Pattern Assignments

### `supabase/functions/stripe-checkout/index.ts` (EF, request-response)

**Analogs:** `ml-inventory/index.ts` (JWT-authenticated EF that fetches a secret server-side and calls an external API) + `ml-oauth/index.ts` (action-router + service-role admin client + `json()` helper).

**Imports + CORS + json() helper** — copy from `ml-oauth/index.ts:1-15`:
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```
Add the Stripe import (RESEARCH Standard Stack — NOT in codebase yet, pin major):
`import Stripe from "https://esm.sh/stripe@22?target=denonext";` with `httpClient: Stripe.createFetchHttpClient()`.

**JWT auth → service-role admin client** — copy the auth-gate shape from `ml-inventory/index.ts:48-71`:
```typescript
const authHeader = req.headers.get("Authorization");
if (!authHeader?.startsWith("Bearer ")) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: {...} });
}
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(
  authHeader.replace("Bearer ", ""),
);
if (authErr || !authData?.user) { /* 401 */ }
```

**Owner role enforcement** — `ml-inventory/index.ts:104-115` uses `supabaseAdmin.rpc("is_org_member", {...})`. For Phase 44, billing config is **owner-only** (CLAUDE.md), so call the role RPC instead and require owner:
```typescript
const { data: role } = await supabaseAdmin.rpc("get_org_role", {
  _user_id: authData.user.id, _org_id: organization_id,
});
if (role !== "owner") return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, ... });
```
(`get_org_role` is the same RPC used in `organization_plans` RLS at `20260519120000_organization_plans_quota.sql:45,50`.)

**Action router (`'checkout' | 'portal'`)** — copy the `if (action === ...)` dispatch shape from `ml-oauth/index.ts:32-198`:
```typescript
const body = await req.json();
const { action, ... } = body;
if (action === "checkout") { /* stripe.checkout.sessions.create(...) → json({ url }) */ }
if (action === "portal")   { /* stripe.billingPortal.sessions.create(...) → json({ url }) */ }
return json({ error: "Invalid action. Use: checkout, portal" }, 400);
```
Session params + portal params come from RESEARCH Pattern 1 / Pattern 4 (use `client_reference_id=organization_id`, `metadata`, server-side `APP_ORIGIN` allowlist for success/cancel URLs — NOT `req` Origin).

**Validation** — use Zod like `ml-inventory/index.ts:73-83` (`z.object({...}).safeParse(body)`). Zod is already a Deno dep (`https://deno.land/x/zod@v3.22.4/mod.ts`, see `ml-inventory/index.ts:3`).

**Error handling** — top-level `try/catch` returning `json({ error: "Internal server error" }, 500)` exactly as `ml-oauth/index.ts:199-202`.

---

### `supabase/functions/stripe-webhook/index.ts` (EF, event-driven)

**Analog:** `ml-oauth/index.ts` for the verify_jwt=false + own-auth shape and service-role admin client. **No codebase analog for HMAC signature verification** → use RESEARCH Pattern 2 verbatim (`req.text()` raw body + `constructEventAsync` + `createSubtleCryptoProvider`).

**verify_jwt=false precedent** — config block `[functions.ml-oauth] verify_jwt = false` (`config.toml:9-10`) and `[functions.org-invite-accept] verify_jwt = false` (`config.toml:41-42`). Auth = HMAC signature, not JWT.

**Service-role admin client for DB writes** — same as `ml-oauth/index.ts:90`:
```typescript
const admin = createClient(SUPABASE_URL, SERVICE_KEY);  // service role bypasses RLS
```

**Idempotent dedupe via insert-first** — RESEARCH Pattern 3 (insert `billing_events` with UNIQUE `event_id`; on `23505` return 200). The atomic UPSERT-on-conflict idiom mirrors `check_quota` RPC's `ON CONFLICT ... DO UPDATE` (`20260614122000_tenant03_check_quota_rpc.sql:44-48`).

**Mutation via RPC** — call `admin.rpc("apply_subscription_tier", {...})` (same `admin.rpc(...)` call pattern as `ml-inventory/index.ts:105`). RPC is the single source of truth for tier (RESEARCH Pattern 3).

**Note (Deno crypto):** `ml-oauth/index.ts:37-45` already uses `crypto.subtle.digest`/`crypto.getRandomValues` (Web Crypto), confirming the runtime has Web Crypto but NOT Node's sync `crypto` — exactly why webhook must use `constructEventAsync` + `createSubtleCryptoProvider` (RESEARCH Pitfall 1).

---

### `supabase/config.toml` (modify)

**Analog:** existing function blocks in the same file.

Append (mirroring `config.toml:9-10` and `:20-21`):
```toml
[functions.stripe-checkout]
verify_jwt = true   # owner authenticated (like ml-inventory)

[functions.stripe-webhook]
verify_jwt = false  # Stripe sends no JWT; auth = HMAC signature (like ml-oauth)
```
`project_id = "ckcdevcxgvueywivefgx"` is already correct at `config.toml:1` (matches RESEARCH constraint — NOT the CLAUDE.md/STACK.md ID).

---

### `supabase/migrations/2026XXXX_subscriptions_billing_events.sql` (migration, model/CRUD)

**Analogs:** `20260614123000_tenant04_onboarding_progress.sql` (org-first RLS, owner-only writes, idempotent guards) + `20260519120000_organization_plans_quota.sql` (table + enum + service-role-only write policy).

**Org-first RLS (member SELECT, owner write)** — copy from `20260614123000_tenant04_onboarding_progress.sql:53-66`:
```sql
CREATE POLICY "..._select" ON public.<table> FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "..._write" ON public.<table> FOR ALL TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role)
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role);
```

**Service-role-only writes for webhook-mutated tables** — for `subscriptions`/`billing_events` (only the webhook EF writes them), follow the `sync_quota_daily` precedent at `20260519120000_organization_plans_quota.sql:52-61`: enable RLS, add SELECT for org members, and **omit** INSERT/UPDATE policies so only `service_role` (the EF) can write:
```sql
-- NOTE: No INSERT or UPDATE policies for authenticated role.
-- Writes to <table> are exclusive to service_role (edge functions).
```

**FK + PK shape** — copy `organization_id uuid ... REFERENCES public.organizations(id) ON DELETE CASCADE` from `20260519120000:11` / `20260614123000:29`.

**Idempotency guards** — `CREATE TABLE IF NOT EXISTS` + `DROP POLICY IF EXISTS ... CREATE POLICY` + `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` for constraints — all from `20260614123000_tenant04_onboarding_progress.sql:28-50`.

**`billing_events.event_id` must be UNIQUE** (dedupe) — model like a CHECK/UNIQUE constraint analogous to `onboarding_progress_current_step_check` (`20260614123000:38-43`).

---

### `supabase/migrations/2026XXXX_apply_subscription_tier_rpc.sql` (migration, RPC/transform)

**Analog:** `20260614122000_tenant03_check_quota_rpc.sql` — the canonical SECURITY DEFINER atomic-mutation RPC in this codebase.

**Full skeleton** — copy structure from `20260614122000:21-61`:
```sql
CREATE OR REPLACE FUNCTION public.apply_subscription_tier(...)
RETURNS ...    -- void or boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ...
BEGIN
  -- 1. UPSERT subscriptions (ON CONFLICT (organization_id) DO UPDATE) — atomic
  -- 2. resolve plan_tier/sync_interval_minutes/history_days from tier_prices mapping by _price_id
  -- 3. UPDATE organization_plans SET plan_tier=..., sync_interval_minutes=..., history_days=...
END;
$$;
REVOKE ALL ON FUNCTION public.apply_subscription_tier(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_subscription_tier(...) TO service_role;
```
The atomic `INSERT ... ON CONFLICT ... DO UPDATE` idiom is at `20260614122000:44-48`. The `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role` pair (so only the webhook EF calls it) is at `20260614122000:60-61`. Header comment block style (rules + idempotency note) also from this file's `:1-20`.

---

### `supabase/migrations/2026XXXX_tier_price_mapping.sql` (migration, model/seed)

**Analog:** `20260519120000_organization_plans_quota.sql` (table + enum reuse + RLS).

**Reuse existing enum** — `plan_tier` already exists (`20260519120000:2-7`); do NOT recreate. Table `tier_prices(price_id text PK, plan_tier public.plan_tier, sync_interval_minutes int, history_days int)` mirrors the column semantics documented at `20260519120000:13-14` (1440/720/180/60/-1 for sync; -1=unlimited history). RLS: read-only to authenticated, writes service-role-only (same `sync_quota_daily` precedent, `20260519120000:52-61`).

**Limits mapping** — RESEARCH Pitfall 6 / Assumption A2: free=1440/30 and enterprise=-1/-1 known; **starter/pro values are ASSUMED and need Wesley confirmation** (planner should add `checkpoint:human`).

---

### `supabase/migrations/2026XXXX_history_days_enforcement.sql` (migration, RPC/RLS guard)

**Analogs:** `20260614122000_tenant03_check_quota_rpc.sql` (STABLE/DEFINER read of `organization_plans`) + `20260519120000` RLS policy style. **The frontend clamp side is `mlCacheService.ts` (below).**

**`org_history_floor` helper** — RESEARCH Pattern 5 esboço; structurally a `LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public` function reading `organization_plans.history_days` (same read target as `check_quota` at `20260614122000:33-36`):
```sql
CREATE OR REPLACE FUNCTION public.org_history_floor(_org_id uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN history_days = -1 THEN '1900-01-01'::date
              ELSE current_date - history_days END
  FROM organization_plans WHERE organization_id = _org_id;
$$;
```
RLS date policy `FOR SELECT USING (date >= public.org_history_floor(organization_id))` on the cache tables mirrors the SELECT policy form at `20260519120000:38-40`.

**Decision pending (Assumption A4):** RLS-by-date vs RPC-clamp vs hybrid — planner should add `checkpoint:human` (RLS adds cost to every cache query).

---

### `src/pages/org/Planos.tsx` (page, request-response)

**Analog:** `src/pages/Integrations.tsx` — the existing owner-only page that invokes EFs and reads org-scoped Supabase data.

**EF invoke pattern** — copy from `Integrations.tsx:600-609` (also `:140`, `:439`, `:473`):
```typescript
const { data, error } = await supabase.functions.invoke("stripe-checkout", {
  body: { action: "checkout", tier, organization_id: currentOrg?.id },
});
if (error || !data?.url) { toast({ title: "...", variant: "destructive" }); return; }
window.location.href = data.url;
```
Error/toast handling shape from `Integrations.tsx:616-624`.

**Org context** — `const { currentOrg } = useOrganization();` (`Integrations.tsx:598` uses `currentOrg?.id`). Subscription/tier state comes from `useSubscription` (below).

**Route registration + owner-only guard** — register in `App.tsx` lazy block (`App.tsx:25-46`) and as a `<RoleRoute>`-wrapped route in the owner-only style of `/sellers` and `/integracoes` at `App.tsx:134-135`:
```tsx
const Planos = React.lazy(() => import("./pages/org/Planos"));
// ...
<Route path="/planos" element={<RoleRoute><Planos /></RoleRoute>} />
```
Add `/planos` to `roleAccess` (owner) — see ARCHITECTURE Route list / access-control map.

---

### `src/hooks/useSubscription.ts` (hook, CRUD/read)

**Analog:** `src/hooks/useOnboardingProgress.ts` — org-scoped react-query read of a single-row-per-org table; secondary `src/hooks/useMLProductCosts.ts` for the org-scoped fetch shape.

**Hook skeleton** — copy from `useOnboardingProgress.ts:87-109`:
```typescript
const { currentOrg } = useOrganization();
const orgId = currentOrg?.id ?? null;
const subQuery = useQuery({
  queryKey: ["subscription", orgId],
  enabled: !!orgId,
  queryFn: async () => {
    if (!orgId) return null;
    const { data, error } = await supabase
      .from("subscriptions")
      .select("status, current_period_end, stripe_customer_id, ...")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) { console.warn("useSubscription fetch error", error); return null; }
    return data;
  },
});
```
Also read `organization_plans` (current `plan_tier`) the same way — org-scoped `.eq("organization_id", orgId).maybeSingle()` (cf. `useMLProductCosts.ts:40-43` `.eq("organization_id", currentOrg.id)`). Imports block: `useOnboardingProgress.ts:1-4` (`useQuery` from `@tanstack/react-query`, `supabase`, `useOrganization`).

---

### `src/services/mlCacheService.ts` (modify, data clamp)

**Self-modify.** Clamp `dateFrom` server-side at every `.gte("date", dateFrom)` call site: `fetchDailyCache` (`mlCacheService.ts:75`), `fetchProductDailyCache` (`:157`), `fetchStateDailyCache` (`:200`); `fetchHourlyCache` filters by `.eq("date", targetDate)` (`:127`) — clamp `targetDate` too.

Current unguarded pattern (`:73-79`):
```typescript
.from("ml_daily_cache").select("*").eq(scopeColumn, scopeValue)
.gte("date", dateFrom)   // ← dateFrom comes straight from the React filter, no ceiling
.lte("date", dateTo)
```
Enforcement options (RESEARCH Pattern 5 / Pitfall 7): the **server-side guarantee** must live in the DB (RLS-by-date or RPC clamp from `history_days_enforcement.sql`); this file's change is the **frontend/UX clamp** (e.g. `dateFrom = greatest(dateFrom, org_history_floor)` before the query). Frontend clamp alone is NOT sufficient (Pitfall 7) — pair with the migration.

---

### `src/integrations/supabase/types.ts` (modify, hand-edit)

**Analog:** the existing `organization_plans` block at `types.ts:1267-1301` (Row/Insert/Update + Relationships) and `Enums.plan_tier` at `:1628` / `:1761`.

**Hand-edit (do NOT regenerate — RESEARCH constraint):** add `subscriptions:`, `billing_events:`, and `tier_prices:` table blocks inside `Database["public"]["Tables"]`, each with `Row`/`Insert`/`Update`/`Relationships`, copying the exact shape of the `organization_plans` block (`:1267-1301`). `plan_tier` enum already present (`:1628`) — reuse via `Database["public"]["Enums"]["plan_tier"]` as `organization_plans.Row` does at `:1272`. If a new status enum is added (e.g. subscription status), mirror the enum entries at both `:1628` (type) and `:1761` (runtime `Constants`).

## Shared Patterns

### EF auth — JWT (owner) gate
**Source:** `supabase/functions/ml-inventory/index.ts:48-71` (Bearer check + `supabaseAdmin.auth.getUser`) + role RPC `get_org_role` (`20260519120000:45`).
**Apply to:** `stripe-checkout` (verify_jwt=true, require owner).

### EF auth — verify_jwt=false + own auth
**Source:** `supabase/functions/ml-oauth/index.ts` + `config.toml:9-10`.
**Apply to:** `stripe-webhook` (auth = HMAC signature instead of JWT; service-role admin client for writes).

### Atomic SECURITY DEFINER RPC, service-role-only
**Source:** `supabase/migrations/20260614122000_tenant03_check_quota_rpc.sql:21-61` (DEFINER + `SET search_path` + `ON CONFLICT DO UPDATE` + `REVOKE ALL FROM PUBLIC` / `GRANT EXECUTE TO service_role`).
**Apply to:** `apply_subscription_tier`, `org_history_floor`, all webhook-driven mutations.

### Org-first RLS (member read, owner write) + service-role-only writes
**Source:** `20260614123000_tenant04_onboarding_progress.sql:53-66` (member SELECT via `is_org_member`, owner FOR ALL via `get_org_role`) + `20260519120000_organization_plans_quota.sql:52-61` (omit authenticated write policies → service_role only).
**Apply to:** all new tables. `subscriptions`/`billing_events` = member SELECT + service-role-only writes (webhook owns them); `tier_prices` = read-only to authenticated.

### React → EF invoke + toast error handling
**Source:** `src/pages/Integrations.tsx:600-624`.
**Apply to:** `Planos.tsx` (checkout + portal buttons).

### Org-scoped single-row react-query read
**Source:** `src/hooks/useOnboardingProgress.ts:87-109`.
**Apply to:** `useSubscription.ts`.

### Owner-only route registration
**Source:** `src/App.tsx:38-46` (lazy) + `:134-135` (`<RoleRoute>` wrap, like `/sellers`, `/integracoes`).
**Apply to:** `/planos` route.

### types.ts hand-edit
**Source:** `src/integrations/supabase/types.ts:1267-1301` (table block) + `:1628`/`:1761` (enum + Constants).
**Apply to:** add `subscriptions`/`billing_events`/`tier_prices` blocks by hand.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `stripe-webhook/index.ts` (signature verification part only) | EF | event-driven | No HMAC/`constructEventAsync` precedent in codebase. The verify_jwt=false shell + service-role admin client + `admin.rpc(...)` DO have analogs (`ml-oauth`); only the Stripe signature verification block must come from RESEARCH Pattern 2 (`req.text()` raw body + `Stripe.createSubtleCryptoProvider()`). |

## Metadata

**Analog search scope:** `supabase/functions/`, `supabase/migrations/`, `supabase/config.toml`, `src/pages/`, `src/pages/org/`, `src/hooks/`, `src/services/`, `src/integrations/supabase/types.ts`, `src/App.tsx`.
**Files scanned:** ~14 read in full or targeted; greps across functions/migrations/pages/hooks.
**Pattern extraction date:** 2026-06-14
