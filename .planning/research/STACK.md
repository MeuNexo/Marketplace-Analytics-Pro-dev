# Technology Stack — Consultor v2 (v8.0 LLM Intelligence Layer)

**Project:** garment-glow-test (Supabase ID: ckcdevcxgvueywivefgx)
**Milestone:** v8.0 — LLM analysis, action-to-approval queue, snooze, threshold UI, per-store drill-down
**Researched:** 2026-06-23
**Confidence:** MEDIUM (sources: official Anthropic docs + Supabase docs — cross-checked)

> SCOPE NOTE: This file covers ADDITIONS to the fixed stack only.
> The base stack (React 18.3, Vite, shadcn/ui, TanStack Query 5, Supabase, react-hook-form, zod) is validated and must not change.

---

## 1. LLM Integration — Calling Anthropic Claude from a Deno Edge Function

### Decision: Raw fetch over SDK

**Use raw fetch (native Deno `fetch`) rather than importing `npm:@anthropic-ai/sdk`.** Rationale:

- The existing codebase pattern for all 20+ edge functions is minimal imports: only `@supabase/supabase-js@2` via `esm.sh` and `zod` via `deno.land/x`. Adding an npm package with 100+ transitive dependencies for a handful of API calls adds cold-start latency and potential ESM-compatibility surface.
- The Anthropic Messages API is a single HTTP endpoint (`POST https://api.anthropic.com/v1/messages`) with a stable JSON schema. A raw fetch implementation is ~30 lines and is fully type-safe with local interfaces.
- The SDK IS available via `npm:@anthropic-ai/sdk@0.105.0` (verified on npmjs.com, June 2026) and works in Deno v1.28+, but it adds unnecessary complexity for this single-endpoint use case.
- The SDK is worth using only if you need streaming SSE (token-by-token). For cached-summary use case (on-demand, returns complete text), non-streaming is preferable and raw fetch is simpler.

**SDK alternative (when to use it):** If v8.x adds streaming analysis (typing animation as Claude generates), switch to `npm:@anthropic-ai/sdk@0.105.0` with `stream: true`. The SDK handles SSE parsing correctly in Deno.

### Raw Fetch Pattern for Edge Function

```typescript
// supabase/functions/consultor-llm-analysis/index.ts
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_VERSION = "2023-06-01";

async function callClaude(model: string, system: string, userContent: string, maxTokens = 1024) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text as string;
}
```

**Secret setup:** Add `ANTHROPIC_API_KEY` to Supabase vault (same Pattern B used for `SUPABASE_SERVICE_ROLE_KEY`). Access via `Deno.env.get("ANTHROPIC_API_KEY")`.

---

## 2. Model Selection

### Decision matrix

| Use case | Model | Model ID (API) | Why |
|----------|-------|----------------|-----|
| Cheap panel summary — short narrative over the Top-3 insights, called on-demand per org/day | **Claude Haiku 4.5** | `claude-haiku-4-5` | $1/$5 per MTok; fastest latency; 200k context window is more than enough for ~12 insight bodies + scores; Feb 2025 knowledge cutoff irrelevant (domain knowledge not needed — it synthesizes the merchant's own data) |
| Deep per-insight explanation — "why this matters for your business" with specific numbers | **Claude Haiku 4.5** | `claude-haiku-4-5` | Same model; separate call, smaller prompt. The intelligence comes from the structured data fed in, not the model tier. Haiku is sufficient when the prompt is well-structured. |
| Future: action reasoning — "should I lower the price of SKU X given competitor context?" | **Claude Sonnet 4.6** | `claude-sonnet-4-6` | $3/$15 per MTok; 1M context; Aug 2025 cutoff; reserved for v8.x phases that require multi-step reasoning, not needed in v8.0 |

**Verdict:** Use `claude-haiku-4-5` for all v8.0 LLM calls. Do not use Sonnet 4.6 or Opus 4.8 in v8.0 — the cost difference is 3x–5x with no quality benefit when the prompt provides all necessary context.

### Why not Sonnet 4.6 for v8.0?

The LLM's job is to turn structured JSON (insights array + scores) into a coherent Portuguese paragraph. This is a formatting/synthesis task, not a reasoning task. Haiku 4.5 handles this class of task at production quality. Sonnet adds depth for tasks like "predict what the merchant should do given macroeconomic context" — not in v8.0 scope.

---

## 3. Pricing & Cost Model

### Verified pricing (Anthropic docs, June 2026)

| Model | Input | Output | Cache write (5m) | Cache write (1h) | Cache hit |
|-------|-------|--------|-----------------|-----------------|-----------|
| Haiku 4.5 | $1/MTok | $5/MTok | $1.25/MTok | $2/MTok | $0.10/MTok |
| Sonnet 4.6 | $3/MTok | $15/MTok | $3.75/MTok | $6/MTok | $0.30/MTok |
| Opus 4.8 | $5/MTok | $25/MTok | $6.25/MTok | $10/MTok | $0.50/MTok |

### Cost estimate for v8.0 (on-demand + daily cache)

Assumptions: 50 orgs, 1 analysis/org/day, prompt ≈ 3,000 tokens input (insights JSON + system), output ≈ 500 tokens.

- Without caching: 50 × (3,000 + 500) tokens × $1/MTok input + $5/MTok output = ~$0.02/day = **~$0.60/month**
- With prompt caching on the static system prompt (~1,500 tokens): first call pays 1.25x write, subsequent hits pay 0.1x. Break-even on 5-min cache = 1 hit (pays off immediately within the first request of the day).
- With 1-hour cache TTL on system prompt: write costs $0.003 once, each re-read costs $0.00015. For 50 orgs in 1 hour, the system prompt is written once and read 49 times → net savings vs uncached.

**Conclusion:** Cost is negligible at current org count. The caching controls are worth implementing as guardrails for scale, not for current savings.

---

## 4. Prompt Caching

### Decision: Use 1-hour cache TTL on the system prompt block

The consultor system prompt (role, rules, output format, language instructions) is identical across all org calls within a given edge function invocation. Cache it for 1 hour.

**Minimum cacheable tokens per model:**
- Haiku 4.5: **4,096 tokens minimum** — the system prompt must be at least 4,096 tokens to be cacheable.
- Sonnet 4.6: 1,024 tokens minimum.

**Implication:** For Haiku 4.5, the static system prompt alone (role + format instructions) is likely under 4,096 tokens. To hit the minimum, include the static domain context (the 12 rule definitions, scoring weights, output format examples) in the cached block. This makes the cache worthwhile and reduces per-call token cost.

**Cache TTL choice:** Use `{"type": "ephemeral", "ttl": "1h"}` not the 5-minute default. The cron runs daily and processes all orgs serially. A 1-hour window ensures all orgs share the same cached system prompt within a single batch run.

**Implementation pattern:**
```typescript
body: JSON.stringify({
  model: "claude-haiku-4-5",
  max_tokens: 800,
  system: [
    {
      type: "text",
      text: STATIC_SYSTEM_PROMPT, // role + rules + format (~4,500 tokens)
      cache_control: { type: "ephemeral", ttl: "1h" }
    }
  ],
  messages: [{ role: "user", content: orgSpecificInsightsJson }],
})
```

---

## 5. LLM Output Cache in Postgres

### Decision: New table `consultor_llm_cache`

Do NOT use an in-memory cache, Redis, or pgmcache (not in the stack). Use a simple Postgres table, consistent with the existing pattern (all other caches in this project are Postgres tables: `ml_daily_cache`, `ml_ads_daily_cache`, etc.).

### Schema

```sql
CREATE TABLE public.consultor_llm_cache (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cache_date       date        NOT NULL,                -- YYYY-MM-DD (UTC)
  prompt_version   int         NOT NULL DEFAULT 1,      -- bump to invalidate on prompt change
  model_used       text        NOT NULL,                -- 'claude-haiku-4-5'
  analysis_text    text        NOT NULL,
  input_tokens     int         NULL,
  output_tokens    int         NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, cache_date, prompt_version)
);
```

### Cache logic in the Edge Function

```typescript
// Read
const cached = await sb
  .from("consultor_llm_cache")
  .select("analysis_text")
  .eq("organization_id", orgId)
  .eq("cache_date", today)
  .eq("prompt_version", PROMPT_VERSION)
  .maybeSingle();
if (cached.data) return cached.data.analysis_text;

// Generate + Write
const text = await callClaude(...);
await sb.from("consultor_llm_cache").upsert({
  organization_id: orgId, cache_date: today,
  prompt_version: PROMPT_VERSION, model_used: "claude-haiku-4-5",
  analysis_text: text
}, { onConflict: "organization_id,cache_date,prompt_version" });
return text;
```

### Cache invalidation strategy

- **Daily TTL via `cache_date`:** Cache is naturally stale the next day (cache_date !== today). No explicit TTL column needed — the SELECT filters on today's date. Old rows are never read.
- **Prompt change invalidation:** Increment `PROMPT_VERSION` constant in the edge function. Old rows with previous version are ignored (different version key). Optionally run a cleanup migration to DELETE WHERE prompt_version < current.
- **Manual refresh:** Frontend "regenerate analysis" button calls the EF with `force_refresh: true` in the body, which skips the cache read and overwrites.
- **Cleanup:** pg_cron DELETE WHERE cache_date < now() - interval '7 days' — runs weekly. 7 days of history is enough for debugging; no value in keeping older LLM outputs.

### RLS

Same pattern as `insights` table: SELECT for org members (via `is_org_member`), INSERT/UPDATE for service role only. The EF authenticates with service role key (Pattern B).

---

## 6. Action-to-Approval Queue

### Decision: New table `consultor_actions` + existing shadcn/ui components

No new UI library needed. The approval queue UI uses existing primitives:

- **Table display:** shadcn/ui `Table` (already in stack) — list pending actions
- **Dialog for approve/reject:** shadcn/ui `AlertDialog` (already in Radix suite) — confirm approval
- **Status badges:** shadcn/ui `Badge` — `pending | approved | rejected | executed | failed`
- **Toast feedback:** `sonner` (already in stack) — "Action approved and queued for execution"

### Schema

```sql
CREATE TABLE public.consultor_actions (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  insight_id       uuid        NULL REFERENCES public.insights(id) ON DELETE SET NULL,
  ml_user_id       text        NULL,        -- which store the action targets
  action_type      text        NOT NULL,    -- 'price_change' | 'ads_pause' | 'ads_budget_change' | etc.
  action_payload   jsonb       NOT NULL,    -- { item_id, current_price, proposed_price, reason }
  status           text        NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|executed|failed
  proposed_by      text        NOT NULL DEFAULT 'consultor', -- 'consultor' | user_id (future)
  approved_by      uuid        NULL REFERENCES auth.users(id),
  approved_at      timestamptz NULL,
  executed_at      timestamptz NULL,
  execution_result jsonb       NULL,        -- MCP/EF response on execution
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

### Execution

On approval, the frontend calls a new Edge Function `consultor-execute-action` with the `action_id`. The EF:
1. Validates the action exists, is `pending`, and user is an org owner/admin.
2. Marks `status = 'approved'`, records `approved_by` + `approved_at`.
3. Executes the action via existing ML endpoint (e.g., ML price update API) or calls the existing `ml-precos-custos` EF.
4. Updates `status = 'executed'` or `'failed'` with `execution_result`.

**This follows the platform rule: actions that mutate ML require explicit approval before execution.** The queue is the audit trail.

---

## 7. Snooze/Dismiss State

### Decision: Add columns to existing `insights` table — no new table

The `insights` table already has `status` ('active' | 'resolved' | 'dismissed'). Snooze is a new state distinct from dismiss:

- **Dismiss:** Permanent. The engine never re-activates a dismissed insight (`T-45-08` invariant in the existing EF).
- **Snooze:** Temporary. The insight returns to `active` after the snooze period.

### Schema addition (migration)

```sql
ALTER TABLE public.insights ADD COLUMN IF NOT EXISTS snoozed_until timestamptz NULL;
```

### Logic

The consultor engine already filters `dismissed` when writing. Add: if `snoozed_until IS NOT NULL AND snoozed_until > now()`, skip the insight in the UI (frontend filter, not engine filter — the engine still sees it as active). After `snoozed_until` passes, the UI shows it again automatically (no engine change needed).

Frontend snooze options: 1 day, 3 days, 7 days, 30 days. Stored as `now() + interval`.

**No new columns on `consultor_actions` or separate table needed.**

---

## 8. Threshold Editing UI

### Decision: Use existing react-hook-form 7.61.1 + zod 3.25.76 — no new libraries

The `consultor_config` table already exists with 14 threshold fields. The editing UI is a standard form:

- **Form library:** `react-hook-form` (7.61.1, already installed) with `@hookform/resolvers` (3.10.0, already installed) and `zod` validation. The zod schema already exists in the EF (`ConsultorConfig` interface) — replicate as a Zod schema on the frontend.
- **UI components:** shadcn/ui `Input`, `Label`, `Slider` (for visual threshold editing), `Card`, `Button` — all already in stack.
- **Save mechanism:** Direct Supabase client update to `consultor_config` (SELECT/UPDATE, owner-only via RLS). No new Edge Function needed.

**The only pattern question is UX:** Show raw number inputs with sensible defaults and units (%, days, multiplier). Add a real-time preview showing "At this threshold, X of your current products would trigger this alert." This requires a client-side computation using cached data, not a new API call.

### Form structure

```typescript
const consultorConfigSchema = z.object({
  margin_critical_pct: z.number().min(-100).max(100),
  margin_alert_pct: z.number().min(0).max(100),
  tacos_alert_pct: z.number().min(0).max(100),
  acos_alert_pct: z.number().min(0).max(100),
  roas_min: z.number().min(0).max(50),
  ads_no_sale_days: z.number().int().min(1).max(90),
  stock_critical_days: z.number().int().min(1).max(30),
  stock_alert_days: z.number().int().min(1).max(90),
  ticket_drop_pct: z.number().min(0).max(100),
  claims_spike_pct: z.number().min(0).max(500),
  goal_risk_pct: z.number().min(0).max(50),
  paused_ads_lookback_days: z.number().int().min(1).max(90),
  ads_eating_critical_pct: z.number().min(-100).max(100),
  ads_eating_alert_pct: z.number().min(0).max(100),
});
```

**No new npm packages needed.** The stack already has everything required.

---

## 9. Per-Store Drill-Down

### Decision: Client-side filter on existing `insights` data — no new Edge Function

The `insights` table already has `ml_user_id` and `ml_user_id_key`. The v1 frontend consolidates all insights across stores. The v2 drill-down is:

1. Read all insights for the org (existing query).
2. Add a store-selector UI (shadcn/ui `Select` or `Tabs`) — one option per `ml_user_id` from `ml_tokens`.
3. Filter insights client-side by `ml_user_id` (or show all if "consolidated" is selected).
4. The score per store requires a new RPC: `get_consultor_score_by_store(org_id, ml_user_id)`. This is a SQL-level aggregation, not an LLM call.

**No new tables needed.** The existing `insights.ml_user_id` field supports this. The `consultor_health_snapshots` table stores org-level score; add a new RPC or a new column group to support per-store scores, OR compute scores on-demand in the frontend from insights (simpler for v8.0, revisit for v8.x).

---

## 10. New Dependencies Summary

### Backend (Edge Functions / Postgres)

| Addition | Type | Purpose | Notes |
|----------|------|---------|-------|
| Raw fetch to `api.anthropic.com` | Pattern | LLM calls from Deno EF | No new import; native Deno fetch |
| `ANTHROPIC_API_KEY` env var | Secret | Anthropic auth | Add to Supabase vault |
| `consultor_llm_cache` table | Schema | Per-org/day LLM output cache | New migration |
| `consultor_actions` table | Schema | Action approval queue | New migration |
| `insights.snoozed_until` column | Schema | Snooze state | ALTER TABLE migration |
| `consultor-llm-analysis` EF | Code | On-demand LLM call + cache | New edge function |
| `consultor-execute-action` EF | Code | Execute approved actions | New edge function |
| pg_cron cleanup job | Cron | Delete LLM cache rows > 7 days | Add to existing pg_cron migration |

### Frontend (React / npm)

**Zero new npm packages.** All UI for v8.0 uses existing stack:

| Feature | Libraries Used | Already in stack? |
|---------|---------------|-------------------|
| Threshold editing form | react-hook-form + zod + shadcn/ui Input/Slider | Yes |
| Approval queue list | shadcn/ui Table + Badge + AlertDialog | Yes |
| Snooze UI | shadcn/ui DropdownMenu + date-fns | Yes |
| Per-store selector | shadcn/ui Tabs or Select | Yes |
| LLM analysis display | Markdown rendering via plain `<p>` tags or simple split | Yes — Haiku output is structured prose, not complex markdown |
| Toast on approve/reject | sonner | Yes |
| Loading states | TanStack Query isPending + shadcn/ui Skeleton | Yes |

---

## 11. What NOT to Add

| Do NOT add | Reason |
|-----------|--------|
| `@ai-sdk/anthropic` (Vercel AI SDK) | Not in Deno EF pattern; adds abstraction over a 30-line raw-fetch call; streaming not needed in v8.0 |
| `langchain` or any LLM orchestration library | Overkill for single-prompt synthesis; adds >100 deps; conflicts with Deno ESM |
| `marked` or `react-markdown` | Haiku output will be plain prose paragraphs in Portuguese, not markdown. Do not add a markdown renderer. |
| Redis / external KV cache | Postgres table is sufficient and consistent with existing caching pattern |
| pgvector / semantic cache | Not needed — cache key is deterministic (org_id + date + prompt_version), not similarity-based |
| Server-Sent Events / streaming | Response is < 500 tokens. Full-response wait (1–2s) is acceptable UX for an on-demand analysis. |
| `@tanstack/react-table` | shadcn/ui Table is sufficient for the action queue (< 20 rows typical) |
| Any charting library addition | No new charts in v8.0 scope |
| OpenAI or other LLM providers | Decision is Claude API (Anthropic). Single provider keeps the secret surface minimal. |
| Stripe or billing changes | Phase 44 is explicitly deferred; do not introduce |

---

## 12. Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| LLM for analysis | Anthropic Claude API (raw fetch) | Vercel AI SDK (`@ai-sdk/anthropic`) | Vercel AI SDK adds React streaming hooks suited for Next.js, not needed in a Deno EF + React SPA pattern |
| Model tier | Haiku 4.5 | Sonnet 4.6 | Sonnet is 3x the cost with no quality gain for synthesis tasks with structured input |
| LLM output cache storage | Postgres table | Redis / Upstash | Redis is not in the stack; Postgres table is consistent with every other cache in the project |
| Snooze state storage | Column on `insights` | Separate `insight_snoozes` table | Column is simpler; snooze is a per-insight property, not a separate entity |
| Threshold editing persistence | Direct Supabase update | Edge Function | `consultor_config` RLS is owner-only; direct client update with service key is safe; no need for EF indirection |
| Action execution | Dedicated EF `consultor-execute-action` | Frontend calling ML API directly | Security: the ML auth token must stay server-side; the EF owns the ML API credential |

---

## Sources

- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) — HIGH confidence (official docs, verified June 2026)
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing) — HIGH confidence (official docs, verified June 2026)
- [Anthropic Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — HIGH confidence (official docs, verified June 2026)
- [Supabase Edge Functions Dependencies](https://supabase.com/docs/guides/functions/dependencies) — MEDIUM confidence (official docs)
- [@anthropic-ai/sdk on npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — MEDIUM confidence (npm registry, v0.105.0 as of June 2026)
- Existing codebase patterns (`consultor-insights/index.ts`, migration files) — HIGH confidence (ground truth)
