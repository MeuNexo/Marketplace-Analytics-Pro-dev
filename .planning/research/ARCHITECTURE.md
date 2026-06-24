# Architecture Patterns: Consultor v2 (v8.0)

**Domain:** Intelligence layer + action pipeline on top of existing Supabase + React SPA
**Researched:** 2026-06-23
**Based on:** Direct codebase inspection — migrations, Edge Functions, hooks, components

---

## Overview: New vs Modified

| Component | Status | Details |
|-----------|--------|---------|
| `insights` table | **MODIFIED** | Add `snoozed_until timestamptz` + `snooze_count int` columns |
| `consultor_config` | **MODIFIED** | Add `llm_enabled bool`, `llm_model text`; UI becomes writable (currently SQL-only) |
| `consultor_health_snapshots` | **MODIFIED** | Add `ml_user_id_key text` helper column; update UNIQUE constraint to support per-store rows |
| `consultor-insights` EF | **MODIFIED** | Add per-store score loop; snooze logic in auto-resolver; write per-store snapshots |
| `useConsultorInsights` hook | **MODIFIED** | Add snooze mutation; expose per-store score data; storeFilter param |
| `MLConsultor.tsx` page | **MODIFIED** | Add store selector, action buttons, snooze controls, LLM analysis panel, threshold UI |
| `ConsultorCard.tsx` | **MODIFIED** | Minor: optional action button on top insight |
| `proposed_actions` table | **NEW** | State machine rows for approval pipeline |
| `action_audit_log` table | **NEW** | Immutable log of every state transition |
| `llm_analysis_cache` table | **NEW** | Per-org/day LLM output cache |
| `consultor-actions` EF | **NEW** | Executor: reads approved action, calls correct ML write API, logs result |
| `consultor-llm` EF | **NEW** | On-demand LLM call; reads insights, calls Claude API, writes to cache |
| `useConsultorActions` hook | **NEW** | TanStack Query over proposed_actions + approve/reject mutations |
| `useConsultorLLM` hook | **NEW** | Triggers EF, reads cache, exposes loading/result |
| `ActionQueue` component | **NEW** | Approval queue UI with approve/reject (owner-only) |
| `ThresholdEditor` component | **NEW** | Owner-only UI that writes directly to `consultor_config` |

---

## Recommended Architecture

```
Browser (React 18 SPA)
  MLConsultor page
    useConsultorInsights (MODIFIED)
      reads: insights + consultor_health_snapshots
      mutations: dismiss, snooze
    useConsultorLLM (NEW)
      invokes: consultor-llm EF on demand
      reads: llm_analysis_cache (TanStack Query, staleTime=12h)
    useConsultorActions (NEW)
      reads: proposed_actions WHERE status IN (proposed, approved)
      mutations: propose, approve, reject
    ThresholdEditor / StoreSelector / ActionQueue (NEW)

           |
           | supabase-js (RLS authenticated)
           v

Supabase Platform
  Tables (Postgres, RLS org-first)
    insights (MODIFIED)              engine writes, UI reads/updates
    consultor_config (MODIFIED)      owner writes via UI
    consultor_health_snapshots       engine writes, UI reads
      (MODIFIED: + ml_user_id_key)
    proposed_actions (NEW)           UI proposes, owner approves
    action_audit_log (NEW)           executor appends, immutable
    llm_analysis_cache (NEW)         LLM EF writes, UI reads

  Edge Functions (Deno)
    consultor-insights (MODIFIED)    cron daily + on-demand
    consultor-llm (NEW)              on-demand, user JWT
    consultor-actions (NEW)          on approval, user JWT
    reply-ml-question (existing)     model for new ML write EFs

  pg_cron
    consultor_insights daily (existing)  unchanged schedule
    action_timeout_sweep (NEW)           every hour, marks stale executing rows
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `consultor-insights` EF | Deterministic rules engine; scores; snapshot upsert | Postgres via service_role; ML API readonly |
| `consultor-llm` EF | Calls Anthropic API; reads live insights; writes cache | `llm_analysis_cache` (service_role write); `insights` (service_role read) |
| `consultor-actions` EF | Reads approved action; calls ML write API; updates state; appends audit | `proposed_actions` (service_role update); `action_audit_log` (service_role insert); ML API directly |
| `proposed_actions` table | Single source of truth for action state machine | Authenticated INSERT (propose); authenticated UPDATE owner-only (approve/reject); service_role UPDATE (executing→done/failed) |
| `action_audit_log` table | Immutable audit trail | service_role INSERT only; authenticated SELECT via RLS |
| `llm_analysis_cache` table | Cached LLM output per org/day | service_role INSERT/UPDATE; authenticated SELECT |
| `useConsultorInsights` | Reads insights + snapshots; dismiss/snooze | Supabase client (authenticated) |
| `useConsultorLLM` | Triggers LLM EF; reads cache | supabase.functions.invoke + supabase.from("llm_analysis_cache") |
| `useConsultorActions` | Reads action queue; propose/approve/reject | supabase.from("proposed_actions") |
| `ThresholdEditor` | Reads + writes consultor_config | supabase.from("consultor_config") — existing owner RLS covers writes |

---

## Data Model: New Tables

### Table: `proposed_actions`

```sql
CREATE TABLE public.proposed_actions (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id          text        NULL,           -- which store; NULL = org-level
  insight_id          uuid        NULL REFERENCES public.insights(id) ON DELETE SET NULL,
  rule_key            text        NOT NULL,       -- mirrors insights.rule_key
  action_type         text        NOT NULL,       -- 'update_price' | 'pause_ads_campaign' | etc.
  target_ref          text        NOT NULL,       -- ML item_id or campaign_id
  current_value       jsonb       NULL,           -- snapshot of current state at propose time
  proposed_value      jsonb       NOT NULL,       -- what to change to
  estimated_impact_brl numeric    NULL,
  status              text        NOT NULL DEFAULT 'proposed',
  proposed_by         uuid        NOT NULL,       -- auth.uid() at INSERT time
  approved_by         uuid        NULL,
  approved_at         timestamptz NULL,
  executed_at         timestamptz NULL,
  result_summary      text        NULL,
  dry_run_preview     jsonb       NULL,           -- populated before approval
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proposed_actions_status_check
    CHECK (status IN ('proposed', 'approved', 'rejected', 'executing', 'done', 'failed')),
  CONSTRAINT proposed_actions_type_check
    CHECK (action_type IN (
      'update_price', 'pause_ads_campaign',
      'update_ads_budget', 'activate_listing', 'pause_listing'
    ))
);

-- Dedup: one open action per (org, rule_key, target_ref)
CREATE UNIQUE INDEX proposed_actions_open_dedup
  ON public.proposed_actions (organization_id, rule_key, target_ref)
  WHERE status IN ('proposed', 'approved', 'executing');

-- Query index
CREATE INDEX proposed_actions_org_status_idx
  ON public.proposed_actions (organization_id, status, created_at DESC);
```

### Table: `action_audit_log`

```sql
CREATE TABLE public.action_audit_log (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action_id       uuid        NOT NULL REFERENCES public.proposed_actions(id) ON DELETE CASCADE,
  actor_id        uuid        NULL,     -- null for system/EF transitions
  from_status     text        NOT NULL,
  to_status       text        NOT NULL,
  detail          jsonb       NULL,     -- ML API response, error body, etc.
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_action_idx
  ON public.action_audit_log (action_id, created_at DESC);

CREATE INDEX audit_log_org_idx
  ON public.action_audit_log (organization_id, created_at DESC);
```

### Table: `llm_analysis_cache`

```sql
CREATE TABLE public.llm_analysis_cache (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  analysis_date     date        NOT NULL,
  model_used        text        NOT NULL,   -- e.g. 'claude-haiku-4-5'
  prompt_hash       text        NULL,       -- SHA-256 of sorted insight IDs; invalidation key
  analysis_text     text        NOT NULL,
  insight_count     int         NOT NULL DEFAULT 0,
  tokens_used       int         NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT llm_cache_org_date UNIQUE (organization_id, analysis_date)
);

CREATE INDEX llm_cache_org_date_idx
  ON public.llm_analysis_cache (organization_id, analysis_date DESC);
```

---

## Data Model: Modified Tables

### `insights` — add snooze columns

```sql
ALTER TABLE public.insights
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS snooze_count   int         NOT NULL DEFAULT 0;
```

No RLS change: existing `insights_dismiss` UPDATE policy (any org member may update) covers snooze writes. The auto-resolver in `consultor-insights` must skip rows where `snoozed_until > now()`.

### `consultor_health_snapshots` — per-store support

```sql
-- Add helper column (same dedup pattern as insights.ml_user_id_key)
ALTER TABLE public.consultor_health_snapshots
  ADD COLUMN IF NOT EXISTS ml_user_id_key text NOT NULL DEFAULT '';
-- ml_user_id_key = '' for org-level; = ml_user_id for per-store

-- Replace existing UNIQUE(organization_id, snapshot_month)
ALTER TABLE public.consultor_health_snapshots
  DROP CONSTRAINT IF EXISTS snapshots_org_month;

ALTER TABLE public.consultor_health_snapshots
  ADD CONSTRAINT snapshots_org_store_month
  UNIQUE (organization_id, ml_user_id_key, snapshot_month);
```

The existing hook reads `WHERE organization_id = orgId ORDER BY snapshot_month DESC LIMIT 2`. After this change, add `AND ml_user_id_key = ''` to continue returning org-level rows in the default view. A second query with `ml_user_id_key = storeFilter` loads per-store data when the store selector is active.

### `consultor_config` — LLM settings

```sql
ALTER TABLE public.consultor_config
  ADD COLUMN IF NOT EXISTS llm_enabled bool NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS llm_model   text NOT NULL DEFAULT 'claude-haiku-4-5';
```

The existing `consultor_config_write` policy (owner-only ALL) already covers these columns. No RLS change needed.

---

## RLS for New Tables

### `proposed_actions`

```sql
ALTER TABLE public.proposed_actions ENABLE ROW LEVEL SECURITY;

-- SELECT: any org member reads their org's actions
CREATE POLICY "proposed_actions_select"
  ON public.proposed_actions FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT: any member proposes; proposed_by enforced; only status='proposed' allowed
CREATE POLICY "proposed_actions_insert"
  ON public.proposed_actions FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(auth.uid(), organization_id)
    AND proposed_by = auth.uid()
    AND status = 'proposed'
  );

-- UPDATE: OWNER ONLY; can only move to 'approved' or 'rejected'
-- executing/done/failed transitions happen via service_role in the executor EF
CREATE POLICY "proposed_actions_update"
  ON public.proposed_actions FOR UPDATE TO authenticated
  USING  (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role)
  WITH CHECK (
    public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role
    AND status IN ('approved', 'rejected')
  );
```

### `action_audit_log`

```sql
ALTER TABLE public.action_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_select"
  ON public.action_audit_log FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT via service_role only (executor EF bypasses RLS)
```

### `llm_analysis_cache`

```sql
ALTER TABLE public.llm_analysis_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "llm_cache_select"
  ON public.llm_analysis_cache FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT/UPDATE via service_role only (consultor-llm EF bypasses RLS)
```

---

## Approval Pipeline State Machine

```
proposed  ---[owner approves]---> approved  ---[EF picks up]---> executing
    |                                  |                              |
    +---[owner rejects]---> rejected   +---[owner rejects]-> rejected |
                            (terminal)                    (terminal)  |
                                                                      |
                                              +-------------+---------+
                                              |             |
                                             done         failed
                                          (terminal)    (terminal)
                                                           |
                                                  re-propose to retry
```

**State transitions in detail:**

| Transition | Who | Mechanism | Constraints |
|------------|-----|-----------|-------------|
| → proposed | any member | authenticated INSERT | status='proposed' enforced by RLS WITH CHECK |
| proposed → approved | owner | authenticated UPDATE | sets `approved_by = auth.uid()`, `approved_at = now()` |
| proposed → rejected | owner | authenticated UPDATE | terminal |
| approved → rejected | owner | authenticated UPDATE | can un-approve before executor picks up |
| approved → executing | `consultor-actions` EF | service_role UPDATE atomic | `UPDATE ... WHERE id=$1 AND status='approved' RETURNING *` — 0 rows = already claimed |
| executing → done | `consultor-actions` EF | service_role UPDATE | sets `executed_at`, `result_summary` |
| executing → failed | `consultor-actions` EF | service_role UPDATE | sets `result_summary` with error |
| executing → failed | pg_cron sweep | service_role UPDATE | `WHERE status='executing' AND updated_at < now()-interval '1 hour'` |

**Idempotency on execution:**
Before calling the ML write API, the executor EF reads `current_value` from the row and compares to live ML state. If ML state already matches `proposed_value` (e.g. price already updated), mark `done` without re-calling the API. This makes retries safe and prevents double-application.

**Dry-run preview:**
Frontend calls `consultor-actions` with `{ action_id, dry_run: true }` before the owner approves. The EF computes the ML API payload without executing, stores it in `proposed_actions.dry_run_preview`. The UI displays this before the owner clicks approve.

---

## LLM Caching Strategy

**Where the LLM call lives:** `consultor-llm` Edge Function, triggered on-demand by the authenticated user (or automatically when the page loads and finds no valid cache). Never from pg_cron.

**Cache key:** `(organization_id, analysis_date)` — one entry per org per calendar day.

**Staleness check:** Compute `prompt_hash = SHA-256(sorted active insight IDs + their rule_keys)` at call time. Compare to stored `prompt_hash`. If different (org resolved issues and re-ran the engine), regenerate even within the same day. This prevents serving stale LLM text after significant state changes.

**Frontend cache flow (in `useConsultorLLM`):**
```
1. Query llm_analysis_cache WHERE org_id = orgId ORDER BY analysis_date DESC LIMIT 1
2. If no row OR analysis_date < today: call consultor-llm EF
3. If today's row exists BUT prompt_hash differs from current insights: call EF
4. If today's row exists AND hashes match: return cached text (no EF call)
```

**Cost control:** Claude Haiku at ~$0.25/million input tokens. Typical request: 2000 tokens of insight context + 500 prompt = 2500 tokens input + 500 output = ~$0.00075/call. At 100 orgs × 1 call/day = $0.075/day. The `llm_model` field in `consultor_config` lets an owner upgrade to Sonnet for deeper analysis at ~10x cost.

**Auth:** `consultor-llm` uses the same dual-auth as `consultor-insights` (verify_jwt=false, authenticate() inside). On-demand calls from frontend pass user JWT. Returns 403 if user is not in the org.

**Prompt structure:**
```
System: You are a business consultant for a Mercado Livre seller.
        Interpret the alerts below in plain Portuguese, explain root causes,
        and identify the 3 most important actions for this week.
        Keep response to 200-300 words. Use bullet points.

User:   Health score: {score} ({band})
        Active alerts ({count}):
        {severity} | {category} | {title} | impact R$ {impact_brl}
        [... one line per insight ...]

        What should this seller prioritize this week, and why?
```

---

## Per-Store Score and Consolidated View

**Schema extension:** `ml_user_id_key text NOT NULL DEFAULT ''` on `consultor_health_snapshots`. Org-level row: `ml_user_id_key = ''`. Per-store row: `ml_user_id_key = ml_user_id`.

**Engine modification in `consultor-insights`:** After the existing `runConsultorForOrg` (which remains unchanged), add a per-store loop when `multiStore = true`:

```typescript
if (multiStore) {
  for (const storeId of mlUserIds) {
    try {
      await runConsultorForStore(sb, orgId, storeId);
    } catch (e) {
      console.error(`per-store score org=${orgId} store=${storeId}:`, e);
    }
  }
}
```

`runConsultorForStore` is a lighter version of `runConsultorForOrg`: uses the same RPCs but passes `p_user_ids = [storeId]`, writes a snapshot row with `ml_user_id_key = storeId`. Does NOT generate store-level insights (insights remain org-scoped per v1 design); only score and pillar breakdown are per-store.

**Frontend — store selector in MLConsultor:**
```typescript
// In useConsultorInsights, add storeFilter parameter:
function useConsultorInsights(storeFilter?: string | null) {
  // existing org-level queries unchanged when storeFilter is null

  // Additional query when storeFilter is set:
  const storeSnapshotQuery = useQuery({
    queryKey: ["consultor_score_store", orgId, storeFilter],
    enabled: !!orgId && !!storeFilter,
    queryFn: async () => supabase
      .from("consultor_health_snapshots")
      .select("*")
      .eq("organization_id", orgId)
      .eq("ml_user_id_key", storeFilter!)
      .order("snapshot_month", { ascending: false })
      .limit(2)
  });
}
```

**Consolidated view (COO-level):** Existing behavior unchanged — `ConsultorCard` on the main `/` dashboard reads org-level snapshots (`ml_user_id_key = ''`). The per-store view is only available on the `/consultor` detail page.

**Performance:** N+1 serialized passes per daily cron. At N=5 stores: ~5 × 8s/pass = 40s additional on top of the org-level pass. Well within 150s EF timeout. If org has > 10 stores, consider splitting per-store scoring into a separate EF invocation queued via `sync_jobs`.

---

## Data Flow: Before and After

### v1 Data Flow (unchanged infrastructure)

```
pg_cron daily
  → consultor-insights EF
  → reads: orders, ml_ads_daily_cache, ml_inventory_cache, ml_claims, ml_questions, etc.
  → writes: insights (UPSERT), consultor_health_snapshots (UPSERT org-level)

Browser
  → useConsultorInsights
  → reads: insights (active), consultor_health_snapshots (2 most recent)
  → renders: score badge, pillar bars, insight cards, dismiss button
```

### v2 Data Flow (additions shown in brackets)

```
pg_cron daily
  → consultor-insights EF [MODIFIED]
  → same reads as v1
  → writes: insights (UPSERT, same) [SKIP snoozed rows in auto-resolver]
  → writes: consultor_health_snapshots (org-level, same)
  → writes: consultor_health_snapshots [per-store rows, NEW]

pg_cron hourly [NEW]
  → action_timeout_sweep: UPDATE proposed_actions SET status='failed'
    WHERE status='executing' AND updated_at < now() - interval '1 hour'

Browser
  → useConsultorInsights [MODIFIED]
  → reads: insights (same) + consultor_health_snapshots (org-level)
  → [reads: consultor_health_snapshots per-store when storeFilter set]
  → mutations: dismiss (same), [snooze NEW]

  → useConsultorLLM [NEW]
  → reads: llm_analysis_cache (TanStack, staleTime=12h)
  → if stale/absent:
      invoke consultor-llm EF [NEW]
        reads: insights (active, org-scoped)
        calls: Anthropic Claude API
        writes: llm_analysis_cache (UPSERT by org+date)
  → returns: { text, loading, model, regenerate() }

  → useConsultorActions [NEW]
  → reads: proposed_actions WHERE org_id = orgId AND status IN (proposed, approved)
  → INSERT (propose): creates row with status='proposed', proposed_by=auth.uid()
  → UPDATE (approve): status='approved', approved_by=auth.uid(), approved_at=now()
    → triggers: invoke consultor-actions EF
  → UPDATE (reject): status='rejected'

  → consultor-actions EF [NEW, invoked by approve]
  → SELECT FOR UPDATE SKIP LOCKED on approved action
  → UPDATE status='executing'
  → INSERT audit_log (approved → executing)
  → [dry_run=true] compute ML payload → store in dry_run_preview → return
  → [dry_run=false] call ML API (update price / pause campaign / etc.)
      → success: UPDATE status='done', INSERT audit_log
      → failure: UPDATE status='failed', INSERT audit_log
```

---

## Executor EF: Reusing Existing ML Write EFs

The canonical pattern for ML writes is `reply-ml-question` (the only production ML write EF today). It validates auth, looks up `ml_tokens`, checks org membership, calls ML API, updates local cache.

The `consultor-actions` EF does NOT invoke other EFs. It inlines the ML API call for each action type, exactly as `reply-ml-question` inlines its ML POST. This eliminates distributed failure surface (no EF-to-EF latency or silent partial failures).

**Shared token lookup pattern (copied from reply-ml-question):**

```typescript
async function getMLToken(
  sb: ReturnType<typeof createClient>,
  ml_user_id: string,
  requesting_user_id: string
): Promise<{ access_token: string; organization_id: string }> {
  const { data } = await sb
    .from("ml_tokens")
    .select("access_token, organization_id")
    .eq("ml_user_id", ml_user_id)
    .not("access_token", "is", null)
    .maybeSingle();
  if (!data?.access_token) throw new Error("No ML token for " + ml_user_id);

  // Cross-org guard: requesting user must be in the token's org
  const { data: isMember } = await sb.rpc("is_org_member", {
    _user_id: requesting_user_id,
    _org_id:  data.organization_id,
  });
  if (!isMember) throw new Error("Forbidden");

  return data;
}
```

**Action type dispatch:**

```typescript
switch (action.action_type) {
  case "update_price":
    // PATCH /items/{target_ref}   body: { price: proposed_value.price }
    // Idempotency: fetch /items/{id}?attributes=price — if already == proposed_value.price → done, skip
    break;

  case "pause_ads_campaign":
    // PATCH /pads/campaigns/{target_ref}   body: { status: "paused" }
    break;

  case "update_ads_budget":
    // PATCH /pads/campaigns/{target_ref}   body: { daily_budget: proposed_value.budget }
    break;

  case "activate_listing":
    // PUT /items/{target_ref}   body: { status: "active" }
    break;

  case "pause_listing":
    // PUT /items/{target_ref}   body: { status: "paused" }
    break;
}
```

**Token refresh:** Before each ML write call, check if `access_token` is still valid. If not, call `ml-token-refresh` logic inline (same as existing EFs do) before proceeding.

**Audit log on every state transition:** After each status change, INSERT into `action_audit_log` with `actor_id = null` (system) or `actor_id = requesting_user_id`. The `detail` jsonb includes the ML API response body (trimmed) or error.

---

## Patterns to Follow

### Pattern 1: Dual Auth in All Consultor EFs

All `consultor-*` EFs inherit the dual-auth from `consultor-insights`:
- `verify_jwt = false` in config.toml (required for pg_cron service_role calls)
- `authenticate()` function inside: rejects unless Bearer == service_role OR valid user JWT
- Fail-CLOSED on missing service_role key → 500, never grants cron mode

`consultor-actions` adds: after validating user JWT, verify the user is an org owner (`get_org_role` check) before allowing approve-triggered execution.

### Pattern 2: Atomic Status Transition with SELECT FOR UPDATE

```sql
-- In consultor-actions EF:
UPDATE public.proposed_actions
SET status = 'executing', updated_at = now()
WHERE id = $action_id
  AND status = 'approved'
RETURNING *;
-- 0 rows returned = already executing or rejected → return 409 Conflict
```

This prevents double-execution even if the owner double-clicks approve.

### Pattern 3: SECURITY INVOKER for User-Facing RPCs

Existing consultor RPCs (`get_consultor_margin_by_product`, etc.) are SECURITY DEFINER with service_role-only EXECUTE grant — correct for bulk engine queries that bypass RLS. New user-facing RPCs (e.g. `get_pending_actions_with_audit`) should be SECURITY INVOKER so RLS handles org scoping automatically.

### Pattern 4: Pagination via .range()

`proposed_actions` and `action_audit_log` must use `.range()` for any query that might exceed 1000 rows (the PostgREST default truncation limit). Even if today's volume is small, the pattern prevents silent truncation as action history grows.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: LLM Called from pg_cron

Calling the LLM from the daily cron burns tokens for every org regardless of whether owners ever open the Consultor. At 100 orgs, this adds ~$0.075/day in guaranteed cost. LLM must be on-demand with cache.

### Anti-Pattern 2: EF-to-EF Invocation for Execution

`consultor-actions` must NOT call other EFs. Each hop adds latency, a new failure point, and breaks the audit trail. The ML API calls are inlined exactly as `reply-ml-question` inlines them.

### Anti-Pattern 3: Owner Skipping to 'executing' via Direct DB Update

The RLS UPDATE policy for `authenticated` restricts `status IN ('approved', 'rejected')` only. The `executing → done | failed` transitions are exclusively in the EF via service_role. This prevents anyone from faking a "done" status without actual ML execution.

### Anti-Pattern 4: Breaking the Dismissed Insight Guard

v1 has: dismissed insights are never re-activated by the auto-resolver. v2 must preserve this. Snooze is separate: `snoozed_until` is a timestamptz that expires; after expiry, the insight CAN be re-evaluated (unlike dismissed which is permanent).

### Anti-Pattern 5: Per-Store Loop Without Error Isolation

Each per-store pass in the cron must be wrapped in its own try/catch. A single store failing (e.g. expired token) must not abort other stores or the org-level pass. Pattern exists in v1 for per-org isolation; extend it to per-store.

---

## Scalability Considerations

| Concern | Now (5-10 orgs) | 100 orgs | 1000 orgs |
|---------|----------------|----------|-----------|
| Daily cron | 10 passes × ~10s = 100s (within 150s EF limit) | Exceed timeout; split into queue via sync_jobs | Partition cron: queue-drain via process-sync-job |
| LLM cost | <$0.01/day | ~$0.075/day | ~$0.75/day (still manageable) |
| Action queue | <100 rows/org/month | Add TTL pg_cron monthly sweep of done/failed rows older than 90 days | Archive table or partition |
| Per-store scores | N+1 passes; fine for N<10 | Same timeout concern as cron | Separate per-store EF |
| Audit log | Grows unboundedly | Add monthly sweep to archive rows > 6 months | Partitioned table |

---

## Build Order

Dependencies: data model first, engine before UI, approval data model before executor EF.

**Phase A — Data Model (no functional changes, prerequisite for everything)**
- Migration: `proposed_actions` + `action_audit_log` + `llm_analysis_cache` (new tables)
- Migration: `insights` add snooze columns
- Migration: `consultor_health_snapshots` add `ml_user_id_key`, update UNIQUE constraint
- Migration: `consultor_config` add `llm_enabled`, `llm_model`
- Migration: RLS for all new tables
- Verifier: tables + columns + RLS policies confirmed via Supabase MCP

**Phase B — Engine Extension (consultor-insights MODIFIED)**
- Add per-store scoring loop (new `runConsultorForStore` function)
- Add snooze awareness to auto-resolver
- Write per-store snapshot rows
- Update `useConsultorInsights` for `ml_user_id_key=''` filter on org-level reads
- Verifier: engine run produces both org-level and per-store snapshot rows
- Depends on: Phase A

**Phase C — LLM Layer (new `consultor-llm` EF + hook)**
- New EF with dual-auth; reads insights; calls Anthropic Claude; writes cache
- `useConsultorLLM` hook
- LLM analysis panel in MLConsultor (collapsible)
- Verifier: EF call → cache row created; second page open → no EF call
- Depends on: Phase A (for `llm_analysis_cache` table); Phase B not required

**Phase D — Action Pipeline Data + Executor (new tables, EF, hook)**
- `consultor-actions` EF: dual-auth, SELECT FOR UPDATE, ML write dispatch, audit log
- `useConsultorActions` hook
- pg_cron: hourly `action_timeout_sweep`
- Verifier: insert test action → approve → EF runs → status=done + audit row
- Depends on: Phase A (for `proposed_actions`, `action_audit_log`)

**Phase E — Action Proposal from Insights (UI)**
- "1-click action" button on InsightCard for actionable rules (margin_critical, ads_no_sale, paused_with_sales)
- Proposal pre-fills from insight context; dry-run preview before approve
- `ActionQueue` component (owner-only, gated by `RoleRoute` or inline `get_org_role` check)
- Depends on: Phase D

**Phase F — Snooze, ThresholdEditor, Per-Store UI**
- Snooze button + mutation in `useConsultorInsights`
- `ThresholdEditor` component writing to `consultor_config`
- `StoreSelector` in MLConsultor header (shown only when org has > 1 `ml_tokens` row)
- Per-store score card alongside consolidated score
- Depends on: Phase A (snooze columns), Phase B (per-store snapshots)

---

## Integration Points Summary

| v1 Component | Change Type | Change Summary |
|---|---|---|
| `consultor-insights/index.ts` | MODIFIED | +per-store loop, +snooze skip, +per-store snapshots |
| `useConsultorInsights.ts` | MODIFIED | +snooze mutation, +storeFilter param, +org-level filter fix |
| `MLConsultor.tsx` | MODIFIED | +LLM panel, +ActionQueue, +StoreSelector, +ThresholdEditor |
| `ConsultorCard.tsx` | MODIFIED | +optional action button on top insight |
| Migration: `insights` | MODIFIED | +snoozed_until, snooze_count |
| Migration: `consultor_health_snapshots` | MODIFIED | +ml_user_id_key, constraint update |
| Migration: `consultor_config` | MODIFIED | +llm_enabled, llm_model |
| `proposed_actions` | NEW | Full state machine table + RLS |
| `action_audit_log` | NEW | Immutable audit trail + RLS |
| `llm_analysis_cache` | NEW | Cache table + RLS |
| `consultor-llm` EF | NEW | Anthropic API integration |
| `consultor-actions` EF | NEW | Approval executor |
| `useConsultorActions` hook | NEW | Action queue data layer |
| `useConsultorLLM` hook | NEW | LLM cache + trigger |
| `ActionQueue` component | NEW | UI for approval queue |
| `ThresholdEditor` component | NEW | UI for consultor_config writes |

---

## Sources

- `/root/garment-glow-test/supabase/migrations/20260645000000_consultor_tables.sql` (HIGH — direct schema)
- `/root/garment-glow-test/supabase/migrations/20260645010000_consultor_engine_rpcs.sql` (HIGH — RPCs)
- `/root/garment-glow-test/supabase/functions/consultor-insights/index.ts` (HIGH — engine)
- `/root/garment-glow-test/supabase/functions/reply-ml-question/index.ts` (HIGH — ML write EF model)
- `/root/garment-glow-test/src/hooks/useConsultorInsights.ts` (HIGH — frontend data layer)
- `/root/garment-glow-test/src/pages/mercadolivre/MLConsultor.tsx` (HIGH — UI surface)
- `/root/garment-glow-test/CLAUDE.md` (HIGH — stack, conventions, RLS patterns)
- `/root/garment-glow-test/.planning/PROJECT.md` (HIGH — v8.0 milestone decisions)
