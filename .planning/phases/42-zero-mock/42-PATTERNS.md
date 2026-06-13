# Phase 42: Zero Mock — Pattern Map

**Mapped:** 2026-06-13
**Files analyzed:** 12 new/modified files
**Analogs found:** 11 / 12

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/YYYYMMDD_ml_questions_claims.sql` | migration | CRUD | `supabase/migrations/20260612140000_ml_billing_monthly.sql` | exact |
| `supabase/migrations/YYYYMMDD_pg_cron_questions_claims.sql` | migration | event-driven | `supabase/migrations/20260521300000_recalc_tax_and_cron_custos.sql` lines 154–184 | exact |
| `supabase/functions/sync-ml-questions/index.ts` | service | request-response (cron-invoked) | `supabase/functions/sync-ads/index.ts` | exact |
| `supabase/functions/sync-ml-claims/index.ts` | service | request-response (cron-invoked) | `supabase/functions/sync-ads/index.ts` | exact |
| `supabase/functions/reply-ml-question/index.ts` | service | request-response (user-invoked) | `supabase/functions/ml-reputation/index.ts` | role-match |
| `supabase/functions/ml-reputation/index.ts` (expand) | service | request-response | `supabase/functions/ml-reputation/index.ts` | exact |
| `src/hooks/useMLQuestions.ts` | hook | CRUD | `src/hooks/useMLBilling.ts` (useMLBilling) | exact |
| `src/hooks/useMLClaims.ts` | hook | CRUD | `src/hooks/useMLBilling.ts` (useMLBilling) | exact |
| `src/pages/mercadolivre/MLPerguntas.tsx` (modify) | component | request-response | self (existing) + `src/hooks/useMLBilling.ts` pattern | role-match |
| `src/pages/mercadolivre/MLDevolucoes.tsx` (modify) | component | CRUD | self (existing) | role-match |
| `src/pages/mercadolivre/MLReputacao.tsx` (modify) | component | request-response | self (existing) + `src/hooks/useMLReputation.ts` | role-match |
| `src/pages/TVModeVendas.tsx` (modify) | component | CRUD | self (existing) lines 111–128 (`fetchSellerData`) | exact |
| `src/data/perguntasMockData.ts` (delete) | data | — | — | — |
| `src/data/reputacaoMockData.ts` (partial) | data | — | — | types only, getMock* removed |
| `src/data/devolucoesMockData.ts` (delete) | data | — | — | — |

---

## Pattern Assignments

---

### `supabase/migrations/YYYYMMDD_ml_questions_claims.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20260612140000_ml_billing_monthly.sql`

**CREATE TABLE + RLS pattern** (lines 1–19 of analog):
```sql
-- ml_billing_monthly is the direct model: org-scoped table with UNIQUE on (org, ml_user_id, key)
CREATE TABLE public.ml_billing_monthly (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  ml_user_id      TEXT NOT NULL,
  period_month    TEXT NOT NULL,
  charges         JSONB,
  resumo          JSONB,
  synced_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, ml_user_id, period_month)
);

ALTER TABLE public.ml_billing_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_billing"
  ON public.ml_billing_monthly
  FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id));
```

**Copy pattern for ml_questions / ml_claims:**
- Same `organization_id UUID NOT NULL REFERENCES public.organizations(id)` FK
- Same `ml_user_id TEXT NOT NULL`
- Same `UNIQUE (organization_id, ml_user_id, <entity_id>)` — use `question_id BIGINT` / `claim_id TEXT`
- Same `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- Same single-policy pattern `FOR ALL USING (public.is_org_member(auth.uid(), organization_id))`
- Name policy `"org_member_questions"` / `"org_member_claims"` following the convention

**Index pattern** — follow `ml_billing_daily` (20260613020000):
```sql
-- Composite indexes for the two most common query patterns:
CREATE INDEX idx_<table>_scope  ON public.<table> (organization_id, ml_user_id);
CREATE INDEX idx_<table>_status ON public.<table> (organization_id, ml_user_id, status);
CREATE INDEX idx_<table>_data   ON public.<table> (organization_id, ml_user_id, data_pergunta DESC);
```

---

### `supabase/migrations/YYYYMMDD_pg_cron_questions_claims.sql` (migration, event-driven)

**Analog:** `supabase/migrations/20260521300000_recalc_tax_and_cron_custos.sql` lines 154–184

**pg_cron Pattern B (Bearer service_role_key via vault):**
```sql
-- supabase/migrations/20260521300000_recalc_tax_and_cron_custos.sql:159-184
DO $$
BEGIN
  PERFORM cron.schedule(
    'sync-tiny-costs-daily',
    '0 3 * * *',
    $cmd$
      SELECT net.http_post(
        url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-tiny-costs',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'service_role_key' LIMIT 1
          )
        ),
        body    := '{"ml_user_id": "1639558873"}'::jsonb
      ) AS request_id;
    $cmd$
  );
  UPDATE cron.job
  SET schedule = '0 3 * * *', active = true
  WHERE jobname = 'sync-tiny-costs-daily';
EXCEPTION WHEN others THEN
  RAISE WARNING 'sync-tiny-costs-daily cron not created: %', SQLERRM;
END $$;
```

**Copy pattern for new schedules:**
- Replace `DO $$ BEGIN PERFORM cron.schedule(...)` with idempotent unschedule + schedule (per RESEARCH.md)
- URL: `'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-questions'`
- `body := '{}'::jsonb` (no ml_user_id — EF reads all tokens itself)
- Schedule: `'*/15 * * * *'` for questions, `'*/30 * * * *'` for claims
- Vault key name: `'service_role_key'` (confirmed present — used in prod by sync-tiny-costs)

**CRITICAL:** Do NOT use `X-Cron-Secret` (Pattern A). Pattern B (Bearer service_role_key) is the correct one for these EFs. The EF checks `auth !== "Bearer " + SERVICE_KEY` and returns 401 otherwise.

---

### `supabase/functions/sync-ml-questions/index.ts` + `sync-ml-claims/index.ts` (service, cron-invoked)

**Analog:** `supabase/functions/sync-ads/index.ts` — full file, exact match for structure.

**Top-of-file constants + CORS** (lines 9–29 of analog):
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY  = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_APP_ID    = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";
const ML_API = "https://api.mercadolibre.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
```

**Auth guard** (lines 47–57 of analog — copy verbatim):
```typescript
function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return null;
}
```

**Token refresh helper** (lines 61–104 of analog — copy verbatim as `getAccessToken()`):
```typescript
async function getAccessToken(sb: any, mlUserId: string): Promise<string> {
  const { data: row } = await sb
    .from("ml_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);

  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  const now       = Date.now() / 1000;
  if (row.access_token && expiresTs - now > 300) return row.access_token;

  // ... refresh via POST /oauth/token (copy full block from sync-ads:76-103)
}
```

**ML GET with retry** (lines 132–150 of analog):
```typescript
async function mlGet(url: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token, "api-version": "2" },
    });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise(r => setTimeout(r, (wait || 2) * 1000));
      continue;
    }
    if (i < 2 && [500, 502, 503, 504].includes(res.status)) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    throw new Error("ML " + res.status + " " + url.split("?")[0]);
  }
  throw new Error("ML retries exhausted");
}
```

**Main handler loop — read all tokens + per-user sync** (lines 309–348 of analog):
```typescript
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const guard = requireServiceRole(req);
  if (guard) return guard;

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Busca todos ml_user_ids com refresh_token (usuários ativos)
    const { data: tokenRows, error: tokErr } = await sb
      .from("ml_tokens")
      .select("ml_user_id,user_id,organization_id,seller_id")
      .not("refresh_token", "is", null);

    if (tokErr) return json({ ok: false, error: tokErr.message }, 500);
    if (!tokenRows || tokenRows.length === 0) return json({ ok: true, msg: "no active users" });

    const results: any[] = [];
    for (const row of tokenRows) {
      try {
        const counts = await syncUser(sb, row);
        results.push({ ml_user_id: row.ml_user_id, ...counts });
      } catch (e: any) {
        console.error("sync-ml-questions ml_user_id=" + row.ml_user_id + " error:", e.message);
        results.push({ ml_user_id: row.ml_user_id, error: e.message });
      }
    }
    return json({ ok: true, results });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
```

**Upsert pattern** (lines 243–248 of analog):
```typescript
const { error } = await sb
  .from("ml_questions")
  .upsert(rows, { onConflict: "organization_id,ml_user_id,question_id" });
if (error) console.error("sync-ml-questions upsert:", error.message);
```

**Rate limiting between pages** (add 200ms sleep between ML API pages per RESEARCH.md):
```typescript
await new Promise(r => setTimeout(r, 200));
```

**Pagination loop pattern** (from sync-ads lines 184–232):
```typescript
let offset = 0;
while (true) {
  const data = await mlGet(url + "?limit=50&offset=" + offset + "&...", token);
  const items = data?.questions ?? data?.results ?? [];
  const total = data?.paging?.total ?? items.length;
  // process items...
  offset += items.length;
  if (items.length === 0 || offset >= total) break;
  await new Promise(r => setTimeout(r, 200)); // rate limit
}
```

**config.toml** — pattern from existing cron EFs (`ml-oauth`, `mercado-libre-integration` which have `verify_jwt = false`):
```toml
[functions.sync-ml-questions]
verify_jwt = false

[functions.sync-ml-claims]
verify_jwt = false

[functions.reply-ml-question]
verify_jwt = true
```

---

### `supabase/functions/reply-ml-question/index.ts` (service, user-invoked)

**Analog:** `supabase/functions/ml-reputation/index.ts` — user JWT validation + ml_tokens lookup + ML API call.

**Auth + user validation** (lines 20–63 of analog):
```typescript
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getUser(token);
    if (claimsErr || !claimsData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = claimsData.user.id;

    // ... parse body (question_id, text, ml_user_id)

    // Get access token + validate org membership
    const { data: tokenRow } = await supabase
      .from("ml_tokens")
      .select("access_token, organization_id")
      .eq("ml_user_id", mlUserId)
      .not("access_token", "is", null)
      .limit(1)
      .maybeSingle();

    if (tokenRow?.organization_id) {
      const { data: isMember } = await supabase.rpc("is_org_member", {
        _user_id: userId,
        _org_id: tokenRow.organization_id,
      });
      if (!isMember) return jsonResponse({ error: "Forbidden" }, 403);
    }
    // ... POST to ML API /answers
  }
});
```

**Input validation** — use zod (already in ml-reputation):
```typescript
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const BodySchema = z.object({
  question_id: z.number().int().positive(),
  text: z.string().min(1).max(2000),
  ml_user_id: z.string().min(1),
});
```

**After POST /answers — update local cache:**
```typescript
await supabase
  .from("ml_questions")
  .update({ status: "ANSWERED", resposta: text, data_resposta: new Date().toISOString(), synced_at: new Date().toISOString() })
  .eq("question_id", question_id)
  .eq("ml_user_id", ml_user_id);
```

---

### `supabase/functions/ml-reputation/index.ts` (expand — add feedbacks)

**Analog:** self (lines 66–88) — extend the existing ML `/users/{id}` call with a second fetch to the feedback endpoint.

**Current pattern** (lines 66–88 of existing EF):
```typescript
const res = await fetch(`${ML_API}/users/${mlUserId}`, {
  headers: { Authorization: `Bearer ${tokenRow.access_token}`, Accept: "application/json" },
});
const userData = await res.json();
// Current return only returns seller_reputation + power_seller_status
return jsonResponse({
  seller_reputation: rep,
  power_seller_status: powerSeller,
  nickname: userData.nickname,
});
```

**Expand: add feedback fetch (Opção A from RESEARCH.md):**
```typescript
// Try feedback endpoints in sequence (all may be deprecated)
let feedbacks: any[] = [];
const fbUrls = [
  `${ML_API}/users/${mlUserId}/feedbacks/received`,
  `${ML_API}/users/${mlUserId}/feedbacks?as=seller`,
  `${ML_API}/users/${mlUserId}/feedback?as=seller`,
];
for (const fbUrl of fbUrls) {
  try {
    const fbRes = await fetch(fbUrl, {
      headers: { Authorization: `Bearer ${tokenRow.access_token}`, Accept: "application/json" },
    });
    if (fbRes.ok) {
      const fbData = await fbRes.json();
      feedbacks = fbData?.feedbacks ?? fbData?.results ?? [];
      break;
    }
  } catch { /* try next */ }
}
// Always return feedbacks ([] is valid — see RESEARCH.md Pitfall 7)
return jsonResponse({ seller_reputation: rep, power_seller_status: powerSeller, nickname: userData.nickname, feedbacks });
```

---

### `src/hooks/useMLQuestions.ts` + `src/hooks/useMLClaims.ts` (hook, CRUD)

**Analog:** `src/hooks/useMLBilling.ts` — `useMLBilling()` function (lines 149–205). Exact match: TanStack Query v5, reads from Supabase table, scoped by `organization_id` + `resolvedMLUserIds`, handles `enabled` guard.

**Imports + context pattern** (lines 1–6 of analog):
```typescript
import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
```

**useQuery structure** (lines 154–204 of analog):
```typescript
export function useMLQuestions(status?: "UNANSWERED" | "ANSWERED" | "CLOSED") {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: ["ml_questions", orgId, resolvedMLUserIds, status],
    enabled: !!orgId && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,  // 2min stale — cron runs every 15min
    queryFn: async () => {
      if (!orgId || resolvedMLUserIds.length === 0) return [];

      let q = supabase
        .from("ml_questions")
        .select("*")
        .eq("organization_id", orgId)
        .in("ml_user_id", resolvedMLUserIds)  // CR-01 multi-loja merge
        .order("data_pergunta", { ascending: false })
        .limit(200);

      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

**Multi-loja pattern (CR-01):** `resolvedMLUserIds` from `useMLStore()` already contains the correct IDs for the selected store or all stores. The `.in("ml_user_id", resolvedMLUserIds)` implements the merge. Do NOT implement separate merge logic.

**useMLClaims** follows identical structure with `ml_claims` table, `claim_id`/`tipo`/`status`/`data_abertura` columns.

---

### `src/pages/mercadolivre/MLPerguntas.tsx` (modify, component)

**Analog:** self — existing file (`src/pages/mercadolivre/MLPerguntas.tsx`).

**Remove (lines 22–25):**
```typescript
import {
  getMockPerguntasSummary,
  getMockPerguntasDailyStats,
  getMockPerguntaEntries,
} from "@/data/perguntasMockData";
```

**Remove (lines 47–49):** the three `useMemo(() => getMock*(...), [storeId])` calls.

**Remove:** "Dados simulados" Badge + tooltip (lines 76–82).

**Remove:** fake `setSyncing` timeout in onClick (lines 86–88) — replace with real refetch.

**Add — hook:**
```typescript
import { useMLQuestions } from "@/hooks/useMLQuestions";
const { data: questions = [], isLoading, refetch } = useMLQuestions();
```

**Add — derived summaries from real data:**
```typescript
const pending = useMemo(() => questions.filter(q => q.status === "UNANSWERED"), [questions]);
const answered = useMemo(() => questions.filter(q => q.status === "ANSWERED"), [questions]);
// Derive dailyStats by grouping questions by date for the chart
```

**Add — inline reply state (D-04):**
```typescript
const [answeringId, setAnsweringId] = useState<number | null>(null);
const [answerText, setAnswerText] = useState("");
const [confirmingId, setConfirmingId] = useState<number | null>(null);
```

**Add — confirmation before sending (D-05):** use existing `AlertDialog` from shadcn/ui (already in project — see `src/components/ui/alert-dialog.tsx`). Pattern:
```typescript
// Show AlertDialog when confirmingId !== null
<AlertDialog open={confirmingId !== null} onOpenChange={() => setConfirmingId(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Confirmar resposta</AlertDialogTitle>
      <AlertDialogDescription>Esta ação é irreversível. A resposta será enviada ao comprador.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction onClick={handleSendReply}>Enviar resposta</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**Add — char counter + submit (D-06):**
```typescript
// Below textarea:
<span className="text-xs text-muted-foreground">{answerText.length}/2000</span>
```

**Add — toast (D-06):** use existing `toast` from sonner:
```typescript
import { toast } from "sonner";
toast.success("Resposta enviada com sucesso");
```

**Add — EF invocation:**
```typescript
const { error } = await supabase.functions.invoke("reply-ml-question", {
  body: { question_id: answeringId, text: answerText, ml_user_id: storeId },
});
```

**Add — empty state for pre-cron (D-Claude's discretion):**
```typescript
{!isLoading && questions.length === 0 && (
  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
    <RefreshCw className="w-10 h-10 opacity-30" />
    <p className="text-sm font-medium">Sincronizando perguntas</p>
    <p className="text-xs">Volte em alguns minutos após a primeira sincronização</p>
  </div>
)}
```

---

### `src/pages/mercadolivre/MLDevolucoes.tsx` (modify, component)

**Analog:** self — existing file. Same removal pattern as MLPerguntas.

**Remove imports (lines 21–26):** `getMockDevolucoeSummary`, `getMockDevolucoesDailyStats`, `getMockClaimEntries`, `ClaimStatus` from `@/data/devolucoesMockData`.

**Add hook:**
```typescript
import { useMLClaims } from "@/hooks/useMLClaims";
const { data: claims = [], isLoading } = useMLClaims();
```

**Keep:** `STATUS_CONFIG` map (lines 29–33) — reuse for real data. The `tipo` column (`mediations` / `returns`) maps to a new column alongside status.

**Add tipo filter:** Tab or Select above the list:
```typescript
const [tipoFilter, setTipoFilter] = useState<"all" | "mediations" | "returns">("all");
const [statusFilter, setStatusFilter] = useState<"all" | "opened" | "closed">("all");
const filtered = useMemo(() => claims
  .filter(c => tipoFilter === "all" || c.tipo === tipoFilter)
  .filter(c => statusFilter === "all" || c.status === statusFilter),
  [claims, tipoFilter, statusFilter]);
```

---

### `src/pages/mercadolivre/MLReputacao.tsx` (modify, component)

**Analog:** `src/hooks/useMLReputation.ts` — the hook itself is the analog.

**In `useMLReputation.ts` — remove (lines 8–9, 32–34, 88–91):**
```typescript
// Remove this import:
import { getMockReputationSummary, ... } from "@/data/reputacaoMockData";

// Remove from interface UseMLReputationResult (line 33):
mockReputation: ReputationSummary;

// Remove from hook return (lines 88–91):
const mockReputation = useMemo(() => getMockReputationSummary(storeId ?? "default"), [storeId]);

// Remove from return statement:
mockReputation,
```

**In `useMLReputation.ts` — add to interface and return:**
```typescript
// Add to UseMLReputationResult:
feedbacks: FeedbackEntry[];

// Add to fetchReputation() — parse feedbacks from EF response:
if (data.feedbacks) {
  setFeedbacks(data.feedbacks.map((f: any) => ({
    id: f.id,
    order_id: f.order_id,
    rating: (f.fulfilled === "positive" || f.fulfilled === true) ? "positive" : "negative",
    message: f.message ?? "",
    date: f.date_created ?? "",
  })));
}
```

**In `MLReputacao.tsx` — remove:** any `mockReputation` usage, `getMockFeedbackDaily`, `getMockFeedbackEntries` calls.

**Add — derive daily chart** (from RESEARCH.md):
```typescript
function buildDailyFeedback(feedbacks: FeedbackEntry[]) {
  const byDay = new Map<string, { positive: number; negative: number }>();
  for (const f of feedbacks) {
    const day = f.date.substring(0, 10);
    const cur = byDay.get(day) ?? { positive: 0, negative: 0 };
    cur[f.rating]++;
    byDay.set(day, cur);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));
}
```

---

### `src/pages/TVModeVendas.tsx` (modify, component)

**Analog:** self — lines 111–128 (`fetchSellerData` already queries `ml_tokens` joined to sellers concept).

**Remove (lines 16–19):**
```typescript
const SELLERS = [
  { id: "8c57110c-77bc-4603-a959-01e965fbea3a", name: "Sandrini", ... },
  { id: "52a7ed04-0d06-4ef5-ae6c-4f3e08a12867", name: "Buy Clock", ... },
];
```

**Add context import:**
```typescript
import { useOrganization } from "@/contexts/OrganizationContext";
const { currentOrg } = useOrganization();
```

**Add sellers state + useEffect** (pattern from `fetchSellerData` lines 111–128 for the ml_tokens query style):
```typescript
interface SellerEntry { id: string; name: string; initials: string; logo: string | null; }
const [sellers, setSellers] = useState<SellerEntry[]>([]);

useEffect(() => {
  if (!currentOrg?.id) return;
  let cancelled = false;

  (async () => {
    // 1. Query sellers for org, sorted alphabetically
    const { data: sellerRows } = await supabase
      .from("sellers")
      .select("id, name, initials, logo_url")
      .eq("organization_id", currentOrg.id)
      .eq("is_active", true)
      .order("name");
    if (!sellerRows || cancelled) return;

    // 2. Query ml_tokens to find ML-connected sellers
    const sellerIds = sellerRows.map(s => s.id);
    const { data: tokenRows } = await supabase
      .from("ml_tokens")
      .select("seller_id")
      .eq("organization_id", currentOrg.id)
      .in("seller_id", sellerIds)
      .not("access_token", "is", null);
    if (cancelled) return;

    const connectedIds = new Set((tokenRows ?? []).map(t => t.seller_id));
    if (!cancelled) setSellers(
      sellerRows
        .filter(s => connectedIds.has(s.id))
        .map(s => ({
          id: s.id,
          name: s.name,
          initials: s.initials ?? generateInitials(s.name),
          logo: s.logo_url ?? null,
        }))
    );
  })();

  return () => { cancelled = true; };
}, [currentOrg?.id]);
```

**Update all `SELLERS` references:** Replace with `sellers` state. Critical dependency updates:
```typescript
// Line 83: seller = SELLERS[sellerIdx]  →  seller = sellers[sellerIdx]
// Line 97: % SELLERS.length  →  % Math.max(sellers.length, 1)
// Line 83: guard seller undefined: if (!seller) render loading spinner
```

**Re-initialize sellerIdx when list changes** (RESEARCH.md Pitfall 2):
```typescript
useEffect(() => {
  setSellerIdx(0);
}, [sellers.length]);
```

---

## Shared Patterns

### Auth Guard (cron-invoked EFs — verify_jwt=false)
**Source:** `supabase/functions/sync-ads/index.ts` lines 47–57
**Apply to:** `sync-ml-questions/index.ts`, `sync-ml-claims/index.ts`
```typescript
function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return null;
}
// In serve(): const guard = requireServiceRole(req); if (guard) return guard;
```

### Auth Guard (user-invoked EFs — verify_jwt=true)
**Source:** `supabase/functions/ml-reputation/index.ts` lines 26–35
**Apply to:** `reply-ml-question/index.ts`
```typescript
const authHeader = req.headers.get("authorization");
if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
const token = authHeader.replace("Bearer ", "");
const { data: claimsData, error: claimsErr } = await supabase.auth.getUser(token);
if (claimsErr || !claimsData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
```

### Org Membership Check in EF
**Source:** `supabase/functions/ml-reputation/index.ts` lines 57–63
**Apply to:** `reply-ml-question/index.ts`
```typescript
const { data: isMember } = await supabase.rpc("is_org_member", {
  _user_id: userId,
  _org_id: tokenRow.organization_id,
});
if (!isMember) return jsonResponse({ error: "Forbidden" }, 403);
```

### ML Token Lookup in EF
**Source:** `supabase/functions/ml-reputation/index.ts` lines 45–55
**Apply to:** `reply-ml-question/index.ts`
```typescript
const { data: tokenRow } = await supabase
  .from("ml_tokens")
  .select("access_token, organization_id")
  .eq("ml_user_id", mlUserId)
  .not("access_token", "is", null)
  .limit(1)
  .maybeSingle();
if (!tokenRow?.access_token) return jsonResponse({ error: "No ML token found" }, 404);
```

### Multi-loja Hook Scope (CR-01)
**Source:** `src/hooks/useMLBilling.ts` lines 150–152
**Apply to:** `useMLQuestions.ts`, `useMLClaims.ts`
```typescript
const { resolvedMLUserIds } = useMLStore();
const { currentOrg } = useOrganization();
// In queryFn: .eq("organization_id", orgId).in("ml_user_id", resolvedMLUserIds)
```

### Toast Notifications
**Source:** already used in existing pages
**Apply to:** `MLPerguntas.tsx` (reply success/error)
```typescript
import { toast } from "sonner";
toast.success("Resposta enviada com sucesso");
toast.error("Erro ao enviar resposta. Tente novamente.");
```

### RLS Policy (org-scoped tables)
**Source:** `supabase/migrations/20260612140000_ml_billing_monthly.sql` lines 14–19
**Apply to:** `ml_questions`, `ml_claims` migration
```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_member_<table>"
  ON public.<table> FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id));
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/data/perguntasMockData.ts` (delete) | data | — | Deletion; no pattern needed |
| `src/data/devolucoesMockData.ts` (delete) | data | — | Deletion; no pattern needed |

`src/data/reputacaoMockData.ts` — partial: keep TypeScript type exports (`ReputationSummary`, `ReputationLevel`, `FeedbackEntry`), remove all `getMock*` functions. No analog for the deletion itself.

---

## Key Pitfalls (from RESEARCH.md — load-bearing for planner)

1. **pg_cron auth:** `sb_secret_*` ≠ `SERVICE_ROLE_KEY`. Always read from `vault.decrypted_secrets WHERE name = 'service_role_key'`. Validate vault entry exists before running cron migration.
2. **Claims API dual URL:** Try `/v1/claims/search` first; fallback to `/post-purchase/v1/claims/search`. Mirror Nexo MCP pattern.
3. **feedback `fulfilled` normalization:** `(f.fulfilled === "positive" || f.fulfilled === true) ? "positive" : "negative"` — not just boolean.
4. **`sellers` has no `ml_user_id`:** Join via `ml_tokens.seller_id → sellers.id`. See TVModeVendas `fetchSellerData` lines 114–119.
5. **SELLERS cycle effects:** Add `sellers` to dependency arrays of all useEffects that reference `SELLERS.length` or `SELLERS[sellerIdx]`.
6. **Feedback endpoint may return 404/403:** Always return `feedbacks: []` on error, never throw — gráfico com série vazia é válido (D-07).

---

## Metadata

**Analog search scope:** `supabase/functions/`, `supabase/migrations/`, `src/hooks/`, `src/pages/mercadolivre/`, `src/pages/TVModeVendas.tsx`
**Files scanned:** 14
**Pattern extraction date:** 2026-06-13
