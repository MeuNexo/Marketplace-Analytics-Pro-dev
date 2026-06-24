# Project Research Summary

**Project:** garment-glow-test — Consultor v2 (Inteligência), Milestone v8.0
**Domain:** LLM intelligence layer + action-approval pipeline on top of a deterministic rules engine, multi-tenant Brazilian ML seller SaaS
**Researched:** 2026-06-23
**Confidence:** HIGH (architecture from direct codebase inspection; stack from official Anthropic + Supabase docs; pitfalls from codebase patterns + known LLM/approval-queue failure modes)

---

## Executive Summary

Consultor v2 is an additive intelligence layer on top of the production deterministic rules engine (v1: ~12 rules, 5-pillar health score 0-100, `insights` table, daily cron + on-demand). Three capability tracks are added: (1) LLM-generated narrative analysis of the existing v1 insight output, (2) an action-proposal-to-approval pipeline that lets the engine suggest ML account changes that the owner explicitly approves before execution, and (3) UX improvements — snooze, threshold editing in the UI, and per-store drill-down. None of these replace the deterministic engine; they are additive layers built on top of it. The defining architectural constraint: the LLM must receive only structured v1 output (serialized insight rows, scores), never raw DB data it must re-derive.

The recommended build order is data model first, then parallel tracks for the LLM layer and the approval-pipeline engine, then UI surface. Two hard dependencies constrain sequencing: (a) `proposed_actions` + `action_audit_log` tables with correct RLS and the atomic state-machine must land before the executor Edge Function is written, and (b) the LLM cache table and the `consultor-llm` EF's prompt grounding contract must be locked before the LLM panel UI is built — changing the prompt post-UI invalidates the `prompt_version` cache key across all orgs simultaneously. Snooze, threshold editor, and per-store UI can all run in Phase 3 after both backend tracks complete.

The key risks are: (1) LLM hallucinating numbers that contradict the deterministic engine — mitigated by feeding only serialized `insights` rows, never raw DB data, plus post-generation numeric validation; (2) double-execution of an approved action due to a TOCTOU race — mitigated by the `UPDATE WHERE status='approved' RETURNING *` atomic gate; (3) cross-tenant LLM cache leakage — mitigated by `organization_id` as the leading PK column on `llm_analysis_cache` with RLS. Cost is negligible at current scale (Haiku 4.5 at ~$0.60/month for 50 orgs) but a server-side cache check must be the first operation in the LLM EF to prevent blowup from frontend retry loops.

---

## Key Findings

### Recommended Stack

The base stack (React 18.3, Vite/SWC, shadcn/ui, TanStack Query 5, Supabase, react-hook-form + zod, sonner, date-fns) is fixed and must not change. **Zero new npm packages are required for v8.0.** All UI for the approval queue, threshold editor, snooze controls, and store selector uses existing shadcn/ui primitives.

For LLM integration, use raw `fetch` to `https://api.anthropic.com/v1/messages` from Deno Edge Functions — not the npm SDK. This matches the existing EF pattern (minimal imports, `esm.sh` only). The Anthropic SDK adds 100+ transitive dependencies for a 30-line raw fetch call. Non-streaming is correct for this use case (cached responses, < 800 tokens output, 1-2s latency acceptable for on-demand analysis).

**Core technology decisions:**
- **Claude Haiku 4.5** (`claude-haiku-4-5`) — all v8.0 LLM calls. $1/$5 per MTok input/output. The LLM's job is narrative synthesis over structured input, not reasoning; Haiku is sufficient. Sonnet 4.6 ($3/$15) reserved for v8.x if multi-step reasoning is added.
- **Prompt caching, 1-hour TTL** — static system prompt must reach the 4,096-token minimum for Haiku caching. Include full rule definitions + output format in the cached block. Use `{"type": "ephemeral", "ttl": "1h"}` so all orgs in a batch share the same cached system prompt.
- **`llm_analysis_cache` Postgres table** — one row per org per day. Cache key: `(organization_id, analysis_date, prompt_version)` — `organization_id` must be the leading column. Same pattern as every other cache in the project. No Redis, no in-memory cache.
- **`proposed_actions` table + 6-state machine** — proposed → approved → executing → done/failed; rejected from proposed or approved. Atomic transition via `UPDATE WHERE status='approved' RETURNING *`. Dedup index on `(organization_id, rule_key, target_ref) WHERE status IN ('proposed', 'approved', 'executing')`.
- **`action_audit_log` table** — immutable, append-only. Every state transition writes a row with `actor_id`, `from_status`, `to_status`, `detail` jsonb (ML API response trimmed to 4KB).
- **`ANTHROPIC_API_KEY`** in Supabase vault via Pattern B (same as `sb_secret_` established in Phase 42). Access via `Deno.env.get("ANTHROPIC_API_KEY")`.

### Expected Features

**Must have (table stakes — missing any makes v2 feel incomplete):**
- LLM whole-panel cached summary (COO-style narrative in Portuguese BR) — analytics products like Amplitude Spark AI and Mixpanel Ask all ship an "AI summary"; merchants expect synthesizing prose, not just a rule list
- On-demand per-insight "Explicar" — static how-to-fix template is insufficient once LLM capability exists; result cached per-insight per-day
- Snooze / adiar insight — named durations (Amanhã / Próxima semana / Em 30 dias); persisted server-side on `insights.snoozed_until`; not browser state
- Threshold config in UI (presets + sliders, not SQL) — removes the barrier that blocks every non-technical merchant
- Per-store score + insight drill-down — merchants with multiple ML stores cannot act on a consolidated alert that does not identify which store is affected
- Action proposed from insight (propose → approve → execute, never auto-execute) — advisor that says "do X" without a path to do X is a frustration source
- Approval queue for proposed actions — without a visible queue, proposals pile up invisibly and the feature is useless
- Audit log for executed actions — immutable trail required before any action touches ML data

**Should have (competitive differentiators, not all needed in first v2 phase):**
- COO-style causal narrative paragraph connecting pillars ("TACoS subiu 6%, causando queda de 3pp na margem")
- Proposal preview diff (current vs proposed: R$ price, estimated margin impact)
- Per-store health score badge in store selector dropdown
- Live impact preview when editing thresholds (count of products that would trigger at new threshold value, debounced 500ms)

**Defer to v2.1+:**
- Open-ended AI chat ("Pergunte qualquer coisa") — hallucination risk destroys trust for lojista leigo; never build for this audience
- Auto-execute actions without approval queue — Wesley's platform rule is correct; no exceptions
- LLM confidence scores on LLM output — non-technical users treat them as certainty; amplifies hallucination perception
- Multiple threshold profiles per org — premature; confuses leigo merchants; "Restaurar padrão" is the safety net
- Smart snooze resurface on metric change — state machine beyond TTL-based; HIGH complexity

### Architecture Approach

Three new Postgres tables (`proposed_actions`, `action_audit_log`, `llm_analysis_cache`), three column additions to existing tables (`insights.snoozed_until`, `consultor_health_snapshots.ml_user_id_key`, `consultor_config.llm_enabled/llm_model`), two new Deno EFs (`consultor-llm`, `consultor-actions`), one modified EF (`consultor-insights` gains per-store scoring loop + snooze awareness), two new React hooks (`useConsultorLLM`, `useConsultorActions`), and several new UI components on `MLConsultor.tsx`. The executor EF inlines ML API calls (not EF-to-EF chaining) following the `reply-ml-question` model. All new tables use `is_org_member(auth.uid(), organization_id)` RLS for SELECT and service_role-only writes.

**Major components:**
1. **`consultor-llm` EF (NEW)** — on-demand; dual-auth; reads active `insights` rows; calls Haiku 4.5 with grounded prompt (only serialized v1 insight data, never raw DB numbers); writes `llm_analysis_cache`; returns cached text on re-call within same day; `prompt_hash` staleness check
2. **`consultor-actions` EF (NEW)** — on approval; dual-auth + owner-role verification; `UPDATE WHERE status='approved' RETURNING *` atomic gate; pre-flight ML state check via `ml_inventory_cache`; inlines ML write API calls for 5 action types; appends to `action_audit_log` on every state transition; handles `dry_run=true` for proposal preview
3. **`consultor-insights` EF (MODIFIED)** — adds per-store scoring loop (isolated try/catch per store); snooze skip in auto-resolver; per-store `consultor_health_snapshots` rows with `ml_user_id_key`; invalidates `llm_analysis_cache` when critical insight count changes on resolution
4. **`proposed_actions` table (NEW)** — single source of truth for state machine; RLS restricts authenticated INSERT to `status='proposed'` only; authenticated UPDATE restricted to owner + `status IN ('approved', 'rejected')` only; executing/done/failed transitions via service_role in executor EF
5. **`ThresholdEditor` component (NEW)** — reads/writes `consultor_config` via authenticated client (existing owner-only RLS covers writes); preset row fills all sliders; live count-of-affected-products preview via lightweight DB RPC; hard validation bounds in zod + server-side
6. **`StoreSelector` + per-store score (NEW)** — client-side filter on existing `insights.ml_user_id`; `consultor_health_snapshots.ml_user_id_key` column supports per-store rows alongside org-level (empty string = org-level)

### Critical Pitfalls

1. **LLM hallucinating numbers that contradict the deterministic engine** — Feed only serialized v1 output (rule_key, title, impact_brl, severity, score per pillar). Add post-generation validation: any numeric value in the LLM response not traceable to structured input triggers fallback to deterministic text. Prompt must state: "Use only the data provided. Do not invent numbers."

2. **Double-execution of an approved action (TOCTOU race)** — Use `UPDATE proposed_actions SET status='executing' WHERE id=$1 AND status='approved' RETURNING *` as the atomic gate. Zero rows returned = abort before calling the ML API. Do not SELECT-then-UPDATE. The dedup index prevents re-proposal of in-flight actions.

3. **Cross-tenant LLM cache leakage** — `llm_analysis_cache` PK must be `(organization_id, analysis_date)` with `organization_id` leading. Never use module-level or in-memory caching in the LLM EF (Deno warm containers share memory across concurrent requests). RLS with `is_org_member` for SELECT; service_role only for writes.

4. **IDOR on the approval queue** — Executor EF must fetch with `WHERE id=$1 AND organization_id=$caller_org_id`. ML token lookup must use `WHERE ml_user_id=$action.ml_user_id AND organization_id=$caller_org_id` (two-column scope). Org B calling with Org A's `action_id` must receive 403, not 200.

5. **Stale LLM cache showing wrong advice after insight resolution** — When `consultor-insights` EF resolves insights, DELETE the `llm_analysis_cache` row for that org if critical count changes. Frontend compares `prompt_hash` against current insight state; on mismatch show "Análise desatualizada — clique para atualizar" rather than auto-regenerating.

6. **LLM cost blowup without server-side cache** — Server-side cache check must be the first operation in the LLM EF. Frontend React Query `staleTime` alone is insufficient (multiple tabs, multiple users in same org bypass it). Per-org daily call count cap (max 3 regenerations/org/day) enforced in the EF. `llm_enabled` column in `consultor_config` is the kill-switch.

---

## Implications for Roadmap

Research resolves into 4 phases with clear dependency ordering. The data model is the absolute prerequisite. LLM layer and approval pipeline engine can be built in parallel after the data model. UI surface ships last because it depends on both backend tracks.

### Phase 1: Data Model Foundation

**Rationale:** Every downstream component depends on stable schema. Building tables and RLS first lets Phase 2A and 2B develop in parallel without schema drift. This also validates all critical design decisions (state machine constraints, RLS policies, dedup indexes) before any code depends on them.

**Delivers:**
- New tables: `proposed_actions` (full state machine + RLS), `action_audit_log` (immutable + RLS), `llm_analysis_cache` (org-scoped cache + RLS)
- Altered tables: `insights` (+snoozed_until, snooze_count), `consultor_health_snapshots` (+ml_user_id_key, updated UNIQUE constraint), `consultor_config` (+llm_enabled, llm_model)
- pg_cron: `action_timeout_sweep` hourly (marks stale `executing` rows as `failed` after 1 hour)

**Avoids:** Pitfalls 2 (cross-tenant cache — org_id leading PK), 3 (double-execute — dedup index), 5 (IDOR — org scoping from schema up), 11 (snooze not per-store — column lives on `insights` row, not separate table)

**Research flag:** Standard patterns. All migration SQL specified in ARCHITECTURE.md from direct codebase inspection. No additional research needed.

---

### Phase 2A: LLM Intelligence Layer (parallel with 2B)

**Rationale:** Depends only on Phase 1 (`llm_analysis_cache` table). Can be built independently of the approval pipeline. Must complete before Phase 3 UI, because the prompt grounding contract and cache invalidation strategy must be locked before the frontend hook is built.

**Delivers:**
- `consultor-llm` EF: dual-auth, cache-first logic (cache check is first operation), Anthropic Haiku 4.5 raw fetch with grounded prompt, `prompt_hash` staleness, cache write + invalidation hook in `consultor-insights`
- `useConsultorLLM` hook: TanStack Query over `llm_analysis_cache`, invokes EF on cache miss, exposes `{ text, loading, model, regenerate() }`
- `ANTHROPIC_API_KEY` added to Supabase vault (Pattern B)
- pg_cron cleanup: DELETE `llm_analysis_cache WHERE analysis_date < now() - interval '7 days'`

**Avoids:** Pitfalls 1 (hallucination — grounded prompt, post-generation number validation), 2 (cross-tenant — org-scoped cache), 7 (cost blowup — server-side cache + call count cap), 8 (stale cache — invalidation on insight resolution), 9 (prompt injection — structured data in XML-bounded block, no free-text merchant content)

**Research flag:** Standard patterns (mirrors `consultor-insights` EF structure). The exact prompt field list is a product decision to finalize in phase planning — treat it as a typed interface, not a freeform string template.

---

### Phase 2B: Approval Pipeline Engine (parallel with 2A)

**Rationale:** Depends only on Phase 1 (`proposed_actions`, `action_audit_log` tables). The executor EF must exist before any UI can propose or approve actions. Backend-only phase; the UI that triggers proposals comes in Phase 3.

**Delivers:**
- `consultor-actions` EF: dual-auth + owner-role verification; `UPDATE WHERE status='approved' RETURNING *` atomic gate; pre-flight ML state check via `ml_inventory_cache`; ML write dispatch for 5 action types (update_price, pause_ads_campaign, update_ads_budget, activate_listing, pause_listing); `action_audit_log` INSERT on every transition; `dry_run=true` path for proposal preview; token refresh before each ML write
- `useConsultorActions` hook: reads `proposed_actions WHERE status IN ('proposed', 'approved')`; propose/approve/reject mutations
- Verifier: insert test action → approve → EF runs → status=done + audit row + `approved_by` + `executed_at` + `state_before` + `ml_api_response` all populated

**Avoids:** Pitfalls 3 (double-execute — atomic gate), 4 (stale proposal — pre-flight state check + 48h staleness TTL), 5 (IDOR — two-column org+ml_user_id token lookup), 6 (missing audit trail — all audit columns in migration from the start)

**Research flag:** ML API write endpoints (PATCH /items/{id} for price, PATCH /pads/campaigns/{id} for campaign pause) need verification against live ML API docs during phase planning. Existing EF pattern (`reply-ml-question`) covers auth but not write payloads.

---

### Phase 3: Per-Store Engine Extension + Full UI Surface

**Rationale:** Depends on Phase 1 (snooze columns, `ml_user_id_key` schema), Phase 2A (LLM hook for analysis panel), and Phase 2B (action hooks for approval queue). Bundles all end-user facing features together because they all touch `MLConsultor.tsx` and `useConsultorInsights` — separate phases would create repeated merge conflicts on the same files.

**Delivers:**
- `consultor-insights` EF modified: per-store scoring loop (`runConsultorForStore`, isolated try/catch per store), snooze awareness in auto-resolver, per-store snapshot writes with `ml_user_id_key`
- `useConsultorInsights` modified: snooze mutation, `storeFilter` param, org-level query fixed to `ml_user_id_key = ''`
- `StoreSelector` component: shown only when org has > 1 `ml_tokens` row; each option shows per-store health badge
- LLM analysis panel in `MLConsultor`: collapsible card above insight list; renders `useConsultorLLM` text; "Atualizar análise" button; staleness indicator
- `ActionQueue` component: owner-only; shows pending/approved proposals with diff preview and staleness badge; approve/reject controls; "Ver histórico" tab
- Snooze controls in insight cards: shadcn/ui DropdownMenu with 4 named durations; mutation writes `snoozed_until` to `insights` row
- `ThresholdEditor` component: preset row (Conservador/Moderado/Agressivo); sliders with Portuguese labels, guardrails, live affected-products count preview; writes to `consultor_config` via authenticated client
- "Propor [ação]" button on actionable insight cards: proposal modal with diff preview via `dry_run=true` path; "Enviar para aprovação" creates `proposed_actions` row

**Avoids:** Pitfall 10 (threshold breaking score — hard bounds in zod + server-side; count preview before confirm), Pitfall 11 (snooze per-store — `snoozed_until` is on the `insights` row; per-store isolation test in verifier)

**Research flag:** Per-store cron performance: verify the N×~10s/pass timing against real execution before writing the loop. If org has > 5 stores, add `sync_jobs` queue fallback in this same phase. Do not defer the fallback.

---

### Phase Ordering Rationale

- **Data model first (Phase 1) is non-negotiable.** The `proposed_actions` state machine constraints, `llm_analysis_cache` cache key design, and `ml_user_id_key` UNIQUE constraint are architectural decisions that are expensive to change once code depends on them.
- **LLM layer (2A) and approval engine (2B) are parallel** because they share no dependency on each other — only on Phase 1. This halves the calendar time for the two hardest backend components.
- **UI surface last (Phase 3)** because the LLM panel depends on `useConsultorLLM` (Phase 2A), the action queue depends on `useConsultorActions` (Phase 2B), and per-store UI depends on the modified `consultor-insights` EF. Bundling all UI in Phase 3 avoids repeated churn on `MLConsultor.tsx`.
- **Prompt contract locked in Phase 2A before Phase 3 UI.** A `prompt_version` bump post-Phase 3 invalidates all existing cache rows and triggers API calls for all orgs simultaneously — unacceptable at scale.

### Research Flags

**Needs deeper research during planning:**
- **Phase 2B — ML API write payloads:** Verify exact request/response schema for each of the 5 action types against live ML API docs. The `reply-ml-question` pattern covers auth; write payloads are not documented in the codebase.
- **Phase 3 — per-store cron performance budget:** Verify N×~10s/pass estimate against real execution timing before writing the per-store loop.

**Standard patterns (skip research, proceed to planning):**
- **Phase 1:** All migration SQL specified in ARCHITECTURE.md from direct codebase inspection.
- **Phase 2A:** Anthropic raw fetch fully specified in STACK.md; dual-auth mirrors `consultor-insights`.
- **Phase 3 UI:** All UI uses existing shadcn/ui primitives; ThresholdEditor and ActionQueue are standard form + table patterns.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies; LLM integration via raw fetch is ~30 lines; pricing/caching verified from official Anthropic docs June 2026; existing Deno EF patterns all confirmed |
| Features | MEDIUM | Feature list derived from competitor analysis + Wesley's product decisions (PROJECT.md). Scope is clear; exact UX copy and preset threshold values need validation with Wesley during planning |
| Architecture | HIGH | Derived from direct codebase inspection of production EFs, migrations, and hooks. All patterns (dual-auth, service_role writes, RLS, atomic state transition) are proven in the existing codebase |
| Pitfalls | HIGH | 11 pitfalls documented; 9 of 11 have direct precedents in the existing codebase (IDOR = feedback_supabase_security_invoker.md; PostgREST truncation = feedback_postgrest_pagination.md; fail-open auth = session_20260614.md) |

**Overall confidence:** HIGH

### Gaps to Address

- **Prompt contract definition:** The exact structured format fed to the LLM (which `insights` fields, which aggregate KPIs, maximum insight count before context cost exceeds Haiku's optimal zone) must be finalized in Phase 2A planning before implementation — it is a typed interface decision, not a string template.
- **ML API write payloads:** Phase 2B planning must verify the exact request/response schema for each of the 5 action types. Not documented in the codebase.
- **Threshold preset values:** FEATURES.md suggests Conservador (margin 25%, TACoS 8%, stock 45d) / Moderado (18%, 12%, 30d) / Agressivo (12%, 18%, 15d). Validate against Wesley's actual business thresholds before shipping ThresholdEditor.
- **Consolidated score formula:** Whether consolidated score = weighted average or worst-store-dominant across stores is a product decision not made in research. Default to weighted average (simpler) unless Wesley specifies otherwise in requirements.

---

## Sources

### Primary (HIGH confidence — official docs + direct codebase)
- `/root/garment-glow-test/supabase/functions/consultor-insights/index.ts` — dual-auth pattern, dismissed-set logic, SECURITY DEFINER RPCs, PostgREST pagination, EF structure
- `/root/garment-glow-test/supabase/migrations/20260645000000_consultor_tables.sql` — RLS policies, unique dedup index design, consultor_config write = owner only
- `/root/garment-glow-test/supabase/functions/reply-ml-question/index.ts` — ML write EF model (token lookup, inline ML call, no EF-to-EF chaining)
- `/root/garment-glow-test/src/hooks/useConsultorInsights.ts` — frontend data layer patterns
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) — model IDs, context windows; verified June 2026
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing) — Haiku 4.5 $1/$5 per MTok, cache pricing; verified June 2026
- [Anthropic Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — 4,096-token minimum for Haiku, TTL options; verified June 2026

### Secondary (MEDIUM confidence — cross-checked web sources)
- [Amplitude Spark AI / Mixpanel Ask](https://www.techno-pulse.com/2026/04/best-ai-customer-analytics-tools-in.html) — LLM advisor narrative reference patterns
- [Shopify multi-store reporting changelog](https://changelog.shopify.com/posts/multi-store-reporting-is-now-available-in-analytics) — consolidated-with-drill-through UX pattern
- [Smashing Magazine — Notifications UX](https://www.smashingmagazine.com/2025/07/design-guidelines-better-notifications-ux/) — snooze patterns
- [Nicelydone — Approval workflow design](https://nicelydone.club/tags/approval-workflow) — propose/approve/audit patterns
- [Nielsen Norman Group — AI hallucinations](https://www.nngroup.com/articles/ai-hallucinations/) — UX guardrails for LLM-generated content

### Tertiary (project memory — HIGH confidence for this codebase)
- `feedback_supabase_security_invoker.md` — IDOR via DEFINER + org_id param (Pitfall 5 direct precedent)
- `feedback_postgrest_pagination.md` — 1000-row truncation, must use `.range()` (applies to action_audit_log queries)
- `project_garment_session_20260613b.md` — Vault Pattern B for `sb_secret_` keys (applies to `ANTHROPIC_API_KEY`)
- `project_garment_session_20260614.md` — CR-01 fail-open auth bug (same class as Pitfall 5)

---
*Research completed: 2026-06-23*
*Ready for roadmap: yes*
