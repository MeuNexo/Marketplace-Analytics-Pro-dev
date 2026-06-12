# Phase 41: Veracidade Total - Pattern Map

**Mapped:** 2026-06-12
**Files analyzed:** 6 new/modified files
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/20260612140000_ml_billing_monthly.sql` | migration | CRUD | `supabase/migrations/20260604130000_fix_batch_upsert_orders_seller_id_cast.sql` | role-match |
| `supabase/functions/sync-ml-billing/index.ts` | edge-function | request-response | `supabase/functions/sync-ml-orders/index.ts` | exact |
| `src/hooks/useMLBilling.ts` | hook | request-response | `src/hooks/useMLCostWaterfall.ts` | exact |
| `src/components/mercadolivre/MLCostCard.tsx` | component | CRUD | `src/components/mercadolivre/MLCostCard.tsx` (modify) | self |
| `src/pages/mercadolivre/MLAnuncios.tsx` | page (modify) | request-response | `src/pages/mercadolivre/MLAnuncios.tsx` (self) | self |
| `src/pages/MercadoLivre.tsx` | page (modify) | request-response | `src/pages/MercadoLivre.tsx` (self) | self |

---

## Pattern Assignments

### `supabase/migrations/20260612140000_ml_billing_monthly.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql` structure + RLS pattern from `sync-ml-orders` service.

**Table DDL pattern** — from RESEARCH.md DATA-04 (confirmed schema):
```sql
CREATE TABLE public.ml_billing_monthly (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  ml_user_id      TEXT NOT NULL,
  period_month    TEXT NOT NULL,  -- YYYY-MM
  charges         JSONB,          -- array [{type, label, amount}]
  resumo          JSONB,          -- {cffe, cfonpn, total_charges, synced_at}
  synced_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, ml_user_id, period_month)
);

ALTER TABLE public.ml_billing_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_billing"
  ON public.ml_billing_monthly
  FOR ALL
  USING (is_org_member(auth.uid(), organization_id));
```

**RLS function pattern** — `is_org_member` is already defined in the project; use exactly as done in `sync-ml-orders/index.ts` lines 457-466:
```typescript
const { data: isMember } = await supabaseAdmin.rpc("is_org_member", {
  _user_id: userId,
  _org_id:  tokenRow.organization_id,
});
if (!isMember) {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

---

### `supabase/functions/sync-ml-billing/index.ts` (edge-function, request-response)

**Analog:** `supabase/functions/sync-ml-orders/index.ts`

**Imports pattern** (sync-ml-orders lines 1-3):
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
```

**CORS headers pattern** (sync-ml-orders lines 5-9):
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, ...",
};
```

**Auth pattern — isServiceRole + userJWT + org check** (sync-ml-orders lines 390-467):
```typescript
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

const token = authHeader.replace("Bearer ", "");
const isServiceRole = token === serviceKey;

let userId: string | null = null;
if (!isServiceRole) {
  const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !authData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, ... });
  }
  userId = authData.user.id;
}
```

**Body validation pattern** (sync-ml-orders lines 422-435):
```typescript
const BodySchema = z.object({
  ml_user_id:   z.string().min(1),
  period_month: z.string().regex(/^\d{4}-\d{2}$/),  // YYYY-MM
});
const parsed = BodySchema.safeParse(await req.json());
if (!parsed.success) {
  return new Response(
    JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
```

**Token lookup pattern** (sync-ml-orders lines 440-453):
```typescript
const { data: tokenRow, error: tokenErr } = await supabaseAdmin
  .from("ml_tokens")
  .select("access_token, organization_id, seller_id")
  .eq("ml_user_id", ml_user_id)
  .not("access_token", "is", null)
  .limit(1)
  .maybeSingle();

if (tokenErr || !tokenRow?.access_token) {
  return new Response(JSON.stringify({ error: "No ML token found for this store" }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

**Numeric seller_id pattern** (sync-ml-orders line 474-475):
```typescript
const mlUser      = await mlFetch("/users/me", accessToken);
const mlNumericId = mlUser.id as number;
```

**mlFetch helper pattern** (sync-ml-orders lines 84-95):
```typescript
async function mlFetch(path: string, accessToken: string, timeoutMs = 15_000) {
  const res = await fetch(`${ML_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`ML API error [${path}]:`, data);
    throw new Error(data.message || `ML API error: ${res.status}`);
  }
  return data;
}
```

**Billing fetch core pattern** (from RESEARCH.md — validated via nexo-mcp produção):
```typescript
async function fetchBillingPeriod(
  token: string,
  sellerId: string,   // numeric ML ID
  periodMonth: string // YYYY-MM
): Promise<{ cffe: number; cfonpn: number; charges: any[] } | null> {
  const ML_API = "https://api.mercadolibre.com";

  // Step 1: list periods
  const periodsResp = await fetch(
    `${ML_API}/billing/integration/monthly/periods?seller_id=${sellerId}&group=ML&document_type=BILL`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  );
  if (!periodsResp.ok) return null; // 404 = seller sem Full

  const periodsData = await periodsResp.json();
  const periodList: any[] = periodsData.results ?? [];

  const month = periodMonth;
  const monthCompact = month.replace("-", "");
  const period = periodList.find((p: any) => {
    const k = String(p.key ?? "");
    return k.startsWith(month) || k.substring(0, 7) === month || k.startsWith(monthCompact);
  });
  if (!period?.key) return null;

  // Step 2: fetch summary/details
  const detailResp = await fetch(
    `${ML_API}/billing/integration/periods/key/${period.key}/summary/details?seller_id=${sellerId}&document_type=BILL`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  );
  if (!detailResp.ok) return null;

  const data = await detailResp.json();
  const charges: any[] = (data.bill_includes ?? {}).charges ?? [];
  const cffe   = charges.filter(c => String(c.type ?? "").includes("CFFE")).reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const cfonpn = charges.filter(c => String(c.type ?? "").includes("CFONPN")).reduce((s, c) => s + Number(c.amount ?? 0), 0);

  return {
    cffe,
    cfonpn,
    charges: charges.map(c => ({ type: c.type, label: c.label, amount: Number(c.amount ?? 0) })),
  };
}
```

**Upsert pattern** (adapt from sync-ml-orders batch upsert style):
```typescript
const { error: upsertErr } = await supabaseAdmin
  .from("ml_billing_monthly")
  .upsert({
    organization_id: organizationId,
    ml_user_id,
    period_month,
    charges: billing.charges,
    resumo: { cffe: billing.cffe, cfonpn: billing.cfonpn, synced_at: new Date().toISOString() },
    synced_at: new Date().toISOString(),
  }, { onConflict: "organization_id,ml_user_id,period_month" });
```

**Error handling pattern** (from RESEARCH.md — Phase 38 lesson):
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("sync-ml-billing error:", message);
  return new Response(JSON.stringify({ success: false, error: message }), { status: 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
```

**serve() entrypoint pattern** (sync-ml-orders style):
```typescript
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    // ... handler body ...
  } catch (err) { ... }
});
```

---

### `src/hooks/useMLBilling.ts` (hook, request-response)

**Analog:** `src/hooks/useMLCostWaterfall.ts`

**Imports pattern** (useMLCostWaterfall lines 1-4):
```typescript
import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
```

**Interface pattern** (useMLCostWaterfall lines 6-25):
```typescript
export interface MLBillingData {
  cffe:   number;
  cfonpn: number;
  charges: Array<{ type: string; label: string; amount: number }>;
  resumo: { cffe: number; cfonpn: number; synced_at: string };
  synced_at: string;
}
```

**useQuery pattern** (useMLCostWaterfall lines 27-73):
```typescript
export function useMLBilling(periodMonth: string) {  // YYYY-MM
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<MLBillingData | null>({
    queryKey: ["ml", "billing", orgId, resolvedMLUserIds, periodMonth],
    queryFn: async (): Promise<MLBillingData | null> => {
      if (!orgId || resolvedMLUserIds.length === 0) return null;

      const { data, error } = await supabase
        .from("ml_billing_monthly")
        .select("*")
        .eq("organization_id", orgId)
        .in("ml_user_id", resolvedMLUserIds)
        .eq("period_month", periodMonth)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        cffe:   Number(data.resumo?.cffe ?? 0),
        cfonpn: Number(data.resumo?.cfonpn ?? 0),
        charges: data.charges ?? [],
        resumo:  data.resumo ?? {},
        synced_at: data.synced_at,
      };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!periodMonth,
    staleTime: 30 * 60 * 1000,  // billing data changes at most once/day
  });
}
```

---

### `src/components/mercadolivre/MLCostCard.tsx` (component, modify)

**Analog:** Self — current file at `src/components/mercadolivre/MLCostCard.tsx`

**Current props interface** (lines 21-36) — extend with billing props:
```typescript
interface CostWaterfallCardProps {
  gross_revenue: number;
  cancelled_revenue: number;
  paid_revenue?: number;
  comissao: number;
  frete: number;           // uses CFFE when billingSource=true
  publicidade: number;
  cmv: number | null;
  impostos: number | null;
  loading?: boolean;
  // NEW for DATA-04:
  cfonpn?: number | null;       // null = no billing data
  billingSource?: boolean;      // true = frete is from CFFE billing
}
```

**Current WaterfallLine definition** (lines 11-18):
```typescript
interface WaterfallLine {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  nullLabel?: string;
  base: number;
  color: string;
}
```

**Add CFONPN line after "Frete" in the `lines` array** (after line 73) — pattern from RESEARCH.md:
```typescript
// After the frete line entry:
...(cfonpn !== undefined
  ? [{
      icon: <CreditCard className="w-3.5 h-3.5 text-violet-400" />,
      label: "Parcelamento (CFONPN)",
      value: cfonpn ?? null,
      nullLabel: undefined,   // hide when no billing
      base: gross_revenue,
      color: "text-foreground",
    }]
  : []),
```

**Billing source indicator** — inline next to "Frete" label (pattern from RESEARCH.md):
```typescript
// In the line.label render, when line.label === "Frete" and billingSource:
<span className="text-[9px] text-muted-foreground/60 ml-1">
  {billingSource ? "billing" : "estimado"}
</span>
```

**lucide import to add:** `CreditCard` from `lucide-react` (join existing import line 3).

---

### `src/pages/mercadolivre/MLAnuncios.tsx` (page modify — DATA-05)

**Analog:** Self — current `src/pages/mercadolivre/MLAnuncios.tsx`

**Current `getCommissionRate()` (lines 58-62) — BEFORE:**
```typescript
function getCommissionRate(listingTypeId: string | null): number {
  if (!listingTypeId) return LISTING_TYPE_RATES.classic.rate;
  if (listingTypeId.includes("gold_pro") || listingTypeId.includes("premium")) return LISTING_TYPE_RATES.premium.rate;
  if (listingTypeId.includes("free")) return LISTING_TYPE_RATES.free.rate;
  return LISTING_TYPE_RATES.classic.rate;
}
```

**AFTER (DATA-05):** `getCommissionRate` should accept `commCache` as a parameter and consult it first. But since `commCache` is component state (not accessible in a module-level function), the fix is at call site (line 1319) — the call site already does this correctly:
```typescript
// Line 1318-1321 (already correct pattern — commCache checked first):
const commCached = commCache.get(item.id);
const commRate = commCached ? commCached.pct / 100 : getCommissionRate(item.listing_type_id);
const commission = commCached ? effectivePrice * (commCached.pct / 100) : effectivePrice * commRate;
```

The fix for DATA-05 is to ensure `commCache` population runs even when `columnView !== "financeiro"` if the KPI total commission is needed. Check if the `useEffect` at line 820 needs to drop the `columnView === "financeiro"` guard. Pattern to change:

**Current guard (line 820):**
```typescript
if (columnView !== "financeiro" || !filteredItemKey) return;
```

**Proposed (DATA-05 — always populate commCache for filtered items):**
```typescript
if (!filteredItemKey) return;  // remove columnView guard
```

Do NOT delete `LISTING_TYPE_RATES` import or object — it is still used in `getFinancialDailyStats()` and `getListingTypeBreakdown()` in `financialMockData.ts`.

---

### `src/pages/MercadoLivre.tsx` (page modify — DATA-04 wiring)

**Analog:** Self — current `src/pages/MercadoLivre.tsx`

**Pattern for wiring new billing hook** (follow pattern of `monthlyCostWaterfall` at line 163):
```typescript
// Compute period_month from monthlyFrom (already a YYYY-MM-DD string)
const billingMonth = monthlyFrom.substring(0, 7);  // YYYY-MM

const { data: billingData } = useMLBilling(billingMonth);
```

**Pass billing props to MLCostCard** (follow existing `costWaterfallData` → `MLCostCard` pattern at ~line 585):
```typescript
<MLCostCard
  // ... existing props ...
  frete={billingData?.cffe ?? costWaterfallData?.total_frete ?? fretefromCache}
  cfonpn={billingData?.cfonpn ?? null}
  billingSource={!!billingData}
/>
```

---

## Shared Patterns

### Auth (Edge Functions)
**Source:** `supabase/functions/sync-ml-orders/index.ts` lines 390-467
**Apply to:** `sync-ml-billing/index.ts`

Pattern: `isServiceRole = token === serviceKey`. If not service role, validate JWT via `supabaseAdmin.auth.getUser(token)`. Then check org membership via `is_org_member` RPC. Skip org check for service role.

### ML Token Lookup
**Source:** `supabase/functions/sync-ml-orders/index.ts` lines 440-453
**Apply to:** `sync-ml-billing/index.ts`

```typescript
const { data: tokenRow } = await supabaseAdmin
  .from("ml_tokens")
  .select("access_token, organization_id, seller_id")
  .eq("ml_user_id", ml_user_id)
  .not("access_token", "is", null)
  .limit(1)
  .maybeSingle();
```

### Numeric seller_id Resolution
**Source:** `supabase/functions/sync-ml-orders/index.ts` lines 474-475
**Apply to:** `sync-ml-billing/index.ts`

```typescript
const mlUser      = await mlFetch("/users/me", accessToken);
const mlNumericId = String(mlUser.id);  // billing API uses string seller_id param
```

### React Query Hook Structure
**Source:** `src/hooks/useMLCostWaterfall.ts` lines 27-73
**Apply to:** `src/hooks/useMLBilling.ts`

Pattern: `useQuery` with `queryKey` including `[orgId, resolvedMLUserIds, period]`, `enabled: !!orgId && resolvedMLUserIds.length > 0`, `staleTime` set to appropriate duration.

### Error Handling (Edge Functions)
**Source:** RESEARCH.md Phase 38 lesson
**Apply to:** `sync-ml-billing/index.ts` top-level catch

```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[fn-name] error:", message);
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

### Frontend Production Trigger (sync-ml-billing)
**Source:** `src/hooks/useMLSync.ts` lines 159-171 (non-fatal `sync-ml-orders` invocation per chunk)
**Apply to:** `useMLSync.ts` — fire `sync-ml-billing` once per `ml_user_id` for the current period_month at the end of a sync run

Pattern: after the chunk loop completes, invoke `sync-ml-billing` per `capturedMLUserIds` for `format(today, "yyyy-MM")`, wrapped in try/catch (non-fatal, mirrors the `sync-ml-orders` guard so a billing failure never aborts the main sync). This guarantees `ml_billing_monthly` is populated whenever the operator syncs the dashboard — no separate cron required for v7.0.

### Deno Runtime Imports
**Source:** `supabase/functions/sync-ml-orders/index.ts` lines 1-3
**Apply to:** All new edge functions

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
```

Note: `sync-ads` uses `@supabase/supabase-js@2.49.1` — for new EFs use the `@2` (no pin) to match `sync-ml-orders`.

---

## No Analog Found

All files have close analogs. No files require fallback to RESEARCH.md-only patterns.

---

## Critical Constraints (re-stated for planner)

1. **Never use `supabase db push`** — always `apply_migration` via MCP with `--project-ref ckcdevcxgvueywivefgx`.
2. **Never restore `20260601000000` migration** — it was removed intentionally (contained bad seller_id cast).
3. **`LISTING_TYPE_RATES` object stays** in `financialMockData.ts` — only change the call site guard in `MLAnuncios.tsx` (commCache population useEffect).
4. **DATA-01 = visual validation only** — no new migration; backend already correct per commit fc090c46.
5. **Multi-tenant scope** — `ml_billing_monthly` rows always keyed by `organization_id + ml_user_id + period_month`; hook uses `resolvedMLUserIds` (already handles multi-store).

## Metadata

**Analog search scope:** `supabase/functions/`, `src/hooks/`, `src/components/mercadolivre/`, `src/pages/mercadolivre/`, `supabase/migrations/`
**Files scanned:** 8 source files read directly
**Pattern extraction date:** 2026-06-12
