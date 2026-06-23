# Feature Research — Consultor v2 (Intelligence Layer)

**Domain:** LLM-advisor + action-approval + per-store insights in an ecommerce analytics SaaS for non-technical Brazilian merchants (lojista leigo)
**Researched:** 2026-06-23
**Confidence:** MEDIUM (cross-checked across multiple independent web sources; no single authoritative spec doc exists for this exact domain combination)

---

## Context: What v1 Already Provides

The v1 engine is the foundation all v2 features build on. Already in production:
- ~12 deterministic rules generating rows in `insights` table (severity, category, recommended_action, estimated R$ impact)
- Health score 0-100 across 5 pillars: Margin 30 / Ads 25 / Inventory 20 / Reputation 15 / Completeness 10
- "O que fazer agora" card (Top 3) on /vendas
- Insight panel with static why-it-matters / how-to-fix text
- Deep-links to relevant filtered pages
- Auto-resolve + dismiss states
- `consultor_config` per org (threshold values — SQL-only today)
- Cron daily + on-demand first-run

Every v2 feature assumes v1 is operational. There is no standalone v2.

---

## Feature Landscape

### Table Stakes (Merchants Expect These)

Features that define "a proper advisor." Missing any of these makes the product feel incomplete compared to reference products like Amplitude Spark AI, Mixpanel Ask, Linear, and Shopify multi-store reporting.

| Feature | Why Expected | Complexity | Dependency on v1 | Notes |
|---------|--------------|------------|-------------------|-------|
| LLM narrative — whole-panel cached summary | Analytics products like Amplitude, Mixpanel, and Microsoft Clarity all ship an "AI summary." Merchants opening an advisor panel expect a synthesizing paragraph, not just a rule list. | MEDIUM | HIGH — LLM receives the serialized v1 insight list as structured input; must NOT access raw data directly | Cache per-org per-day in `consultor_llm_cache` DB table. Stale if insight count delta > 2 or age > 24h. Use Claude Haiku for orgs with ≤ 6 insights; Sonnet for > 6 or CRITICAL present. |
| On-demand "Explicar" per insight | Users of tools like Linear and GitHub Copilot expect contextual explanation attached to the alert. A static template ("how to fix") is not enough once LLM capability exists. | LOW | HIGH — per-insight explain passes that one insight's data + org KPI context to LLM; result cached per-insight per-day | Streaming SSE output preferred (masks latency). 2-3 sentences max. Bold the key metric. Anti-hallucination: every sentence must cite a number from that insight's data. |
| Snooze / adiar insight | Linear, Jira, and every modern notification system have snooze. Without it, merchants either permanently dismiss alerts they want to revisit, or ignore the panel because it repeats. | LOW | MEDIUM — adds `snoozed_until` column to insights table; v1 cron must skip snoozed rows in auto-resolve | Snooze != dismiss. Snooze = relevant but not actionable right now. Named durations (Amanha / Proxima semana / Em 30 dias), not raw date picker. Persist server-side, not browser state. |
| Threshold config in UI (not SQL) | Any serious SaaS lets users configure alert thresholds from a settings screen. Requiring SQL disqualifies every non-technical merchant. | MEDIUM | HIGH — reads and writes existing `consultor_config` table; v1 consults config on every rule evaluation | Presets as default entry point; sliders with plain-language labels; guardrails (min/max bounds) per field. |
| Per-store score + insight drill-down | Shopify multi-store reporting (released 2025), Fullmetrix, and Metorik all default to consolidated-with-drill-through. Merchants with multiple ML stores cannot act on a consolidated alert that does not identify which store is affected. | MEDIUM | HIGH — v1 currently consolidates per-org; requires adding `ml_user_id` scope to insight generation + score calc | Store picker dropdown in advisor panel header. Consolidated = default. Per-store = filtered view of same template. |
| Action proposed from insight (one-click to queue) | Any advisor that tells you "do X" without a path to actually do X is a source of frustration. The propose-to-queue pattern (never auto-execute) satisfies the expectation while respecting the mandatory approval rule. | HIGH | HIGH — new `action_proposals` table; execution via existing ML API endpoints (price change, campaign pause) | Complexity is on the execution path, not the UI. The UI is a modal with a diff and a "Enviar para aprovacao" button. |
| Approval queue for proposed actions | Once an action is proposed, the owner must see it and act on it. Without a visible queue, proposals pile up invisibly and the feature is useless. | MEDIUM | LOW — new feature; reads `action_proposals`; no v1 dependency beyond org context | Tab or badge ("Aguardando aprovacao: 2") in /consultor. Per-proposal card shows diff, who proposed, estimated impact. |
| Audit log for executed actions | Every platform with an approval workflow ships an immutable audit trail. Without it: no accountability, no debugging, no compliance record. | LOW | LOW — append-only table `action_audit_log` | Schema: id, timestamp, actor_id, org_id, proposal_id, action (approved/rejected/executed/failed), changes_json, notes. Visible in /consultor "Historico de acoes" tab. |

---

### Differentiators (Competitive Advantage)

Features that set this product apart from a generic analytics dashboard. Not all need to ship in the first phase of v2.

| Feature | Value Proposition | Complexity | Dependency on v1 | Notes |
|---------|-------------------|------------|-------------------|-------|
| COO-style narrative paragraph | Amplitude Spark AI and Mixpanel Ask answer "why did X happen." This product's equivalent is a paragraph that synthesizes across pillars: "Sua margem caiu 3pp porque o TACoS subiu 6%. Os anuncios de calcado tem ACoS acima do limiar em 4 SKUs. Recomendo pausar as campanhas de menor ROAS." Higher quality than a bullet list because it draws causal connections. | MEDIUM | HIGH — needs v1 insight list + org KPI context (revenue, margin, TACoS week-over-week deltas) as LLM input | Claude Sonnet. Cache aggressively. Regenerate trigger: daily cron or on-demand "Atualizar analise" button. |
| Live impact preview when editing thresholds | When merchant drags "meta de margem" slider from 18% to 22%, show in real time how many insights that change would activate on their current data ("Com esta configuracao, 4 de seus 11 anuncios entrariam em alerta"). This is rare — most threshold UIs show only the new value. | MEDIUM | HIGH — requires re-running v1 rules against current org data with candidate config values | Fetch via lightweight RPC call on slider stop (debounced 500ms). This differentiates from generic config screens. |
| Per-store health score badge in store selector | When merchant sees their ML store list, each store shows a score badge (0-100 or traffic-light dot). Makes multi-store health visible at a glance before drilling down. | LOW | MEDIUM — per-store score is a new v1 computation scoped to one ml_user_id | Visual only; low implementation cost relative to value. |
| Proposal preview diff (current vs proposed) | Before approving a price change: "Atual: R$ 89,99 -> Proposto: R$ 79,99 (-11%) / Margem atual: 18% -> Margem estimada: 15%." Makes the approval decision informed, not blind. | MEDIUM | MEDIUM — requires reading current ML listing price from `ml_inventory_cache` + margin calculator | Canonical Jira bulk-change wizard pattern applied to ecommerce actions. |

---

### Anti-Features (Deliberately NOT Build)

Commonly requested or assumed but actively harmful for a lojista leigo audience.

| Anti-Feature | Why Requested | Why Problematic | What to Do Instead |
|--------------|---------------|-----------------|-------------------|
| Open-ended AI chat ("Pergunte qualquer coisa") | Feels powerful; demos well | For non-technical users, open-ended chat on business data produces hallucinated answers presented confidently. One wrong number destroys months of trust. | Keep LLM strictly scoped to interpreting existing v1 insights. Every LLM sentence must cite a data point from `insights`. No free-form Q&A panel. |
| Auto-execute actions without approval queue | "Saves time; AI can decide" | Auto-execution of price changes or ad pauses on wrong recommendations causes immediate revenue damage. Trust destroyed in a single incident. Wesley's own platform rule is correct here. | Propose -> approve -> execute. No exceptions for "low-risk" categories. |
| LLM-generated confidence score on LLM output | Sounds scientific; "87% confidence" | Non-technical users treat LLM confidence scores as near-certainty. Combining LLM narrative with LLM-generated confidence amplifies hallucination risk. | Use v1 deterministic severity (CRITICAL / WARNING / INFO) as the confidence signal. LLM adds narrative, not scores. |
| Raw number inputs as the default threshold UI | Power users want control | A field labeled "TACoS target: 12" with no context is meaningless to a lojista leigo. They enter a random number and wonder why everything turns red. | Named presets as the default. Sliders with plain Portuguese labels and guardrails. Raw number inputs in "modo avancado" only (collapsed by default). |
| Per-insight LLM explanation without caching | "Simple to implement" | Without caching, every advisor panel open triggers N fresh LLM calls (N = number of insights). At 12 insights x $0.001 x 50 daily users = unpredictable cost that spikes on active days. | Cache per-insight per-day in DB. Show "ultima analise: hoje as 09:12" timestamp. "Atualizar" button for forced refresh. |
| Approval queue via email notifications | Email is universal | Breaks the in-product flow; merchant approves without seeing full context; no immutable in-product audit record; email threading causes approval of stale proposals. | In-product queue only. Future: optional Telegram notification (already infrastructure exists) that links back to the in-product approval screen. |
| Multiple threshold profiles per org (A/B config) | Power users want experimentation | Adds significant complexity (which profile is active?; how to compare?); confuses leigo merchants; premature optimization at this stage. | One active profile per org. "Restaurar padrao" (reset to defaults) button is the safety net. |
| Separate /consultor route as primary entry point | Feature discovery concern | Creating a new top-level route isolates the advisor from the data. Non-technical users will not navigate to a "consulting" page proactively. | Advisor remains a panel/card on /vendas (established in v1). Drill-down per store opens in a modal or sub-section, not a new route. |

---

## Feature Dependencies

```
[v1 insight engine — in prod]
    required-by --> [LLM whole-panel summary]
    required-by --> [Per-insight LLM explain]
    required-by --> [Action proposal from insight]
    required-by --> [Snooze insight]            (adds snoozed_until field; v1 cron updated to skip)
    required-by --> [Per-store drill-down]       (adds ml_user_id scope to v1 insight evaluation)

[consultor_config table — exists today, SQL-only]
    required-by --> [Threshold config UI]
    enhances    --> [LLM summary]               (summary should reflect current thresholds in prompt)

[Threshold config UI]
    enhances    --> [Live impact preview]        (preview uses candidate config from UI state)

[action_proposals table — new]
    required-by --> [Approval queue UI]
    required-by --> [Audit log]
    required-by --> [Proposal preview diff]

[Approval queue UI]
    required-by --> [Audit log]                 (every approval/rejection creates audit entry)

[Per-store score/insights (v1 refactor)]
    enhances    --> [Per-insight LLM explain]   (explain can now scope narrative to one store)
    enhances    --> [Action proposals]           (proposals must carry ml_user_id to target correct store)
```

### Dependency Notes

- **LLM features require v1 insights as structured input:** The LLM never reads raw ML API data or Supabase tables directly. It receives serialized `insights` rows for the org + summary KPIs (margin, TACoS, score). This is non-negotiable: prevents hallucination on numbers and makes cost predictable.
- **Per-store scoring is a v1 refactor, not a new feature:** The v1 engine currently aggregates across all stores for one org. Adding `ml_user_id` scope to `insights` row generation and `consultor_scores` is a backend-only change that does not break existing UI — but it is a prerequisite for per-store UX in v2.
- **Action proposals require ML API write access:** Price changes and campaign pauses go through ML API endpoints using credentials stored in `ml_tokens`. The proposal execution path will reuse the same OAuth flow as existing Edge Functions (EF pattern already established in production).
- **Snooze is DB state, not browser state:** `snoozed_until` lives on the `insights` row. The v1 daily cron must be updated to skip snoozed rows when checking auto-resolve conditions. The cron must also handle resurface (clear snoozed_until when TTL expires and re-evaluate the rule).

---

## MVP Definition for v2

### Phase 1 — Highest value, lowest risk (ship first)

- [ ] **Snooze / adiar insight** — Pure DB + UI change; no new services; immediately removes a daily frustration; LOW complexity
- [ ] **Threshold config UI** — Removes SQL barrier that blocks all non-technical merchants; presets + sliders; depends only on existing `consultor_config`; MEDIUM complexity
- [ ] **Per-store score + insight drill-down** — Backend v1 refactor + store picker UI; prerequisite for per-store LLM explain in phase 2; MEDIUM complexity

### Phase 2 — Core differentiators (after phase 1 validated)

- [ ] **LLM whole-panel cached summary** — Needs `consultor_llm_cache` table + Claude API integration; high perceived value; MEDIUM complexity
- [ ] **Per-insight "Explicar" (streaming)** — Builds on LLM infra from summary; low incremental implementation cost; LOW complexity
- [ ] **Action proposal from insight** — New `action_proposals` table + ML API write path + proposal modal; HIGH complexity

### Phase 3 — Required for action execution to go live

- [ ] **Approval queue UI** — Depends on proposals table being populated (phase 2); MEDIUM complexity
- [ ] **Audit log** — Append-only; LOW complexity; required before any action touches ML data
- [ ] **Proposal preview diff** — Polish on approval queue; MEDIUM complexity

### Future consideration (v2.1+)

- [ ] **Live impact preview in threshold config** — Nice-to-have after threshold UI is validated in production
- [ ] **Smart snooze: resurface on metric change** — Requires insight state machine beyond current TTL-based approach; HIGH complexity; defer

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Snooze / adiar insight | HIGH | LOW | P1 |
| Threshold config UI (presets + sliders) | HIGH | MEDIUM | P1 |
| Per-store score + insight drill-down | HIGH | MEDIUM | P1 |
| LLM whole-panel summary (cached) | HIGH | MEDIUM | P2 |
| Per-insight LLM explain (streaming) | MEDIUM | LOW (after LLM infra) | P2 |
| Action proposal from insight | HIGH | HIGH | P2 |
| Approval queue UI | HIGH | MEDIUM | P3 |
| Audit log | MEDIUM | LOW | P3 |
| Proposal preview diff | MEDIUM | MEDIUM | P3 |
| Live impact preview in threshold UI | MEDIUM | MEDIUM | Future |
| Smart snooze resurface on metric change | LOW | HIGH | Future |

**Priority key:**
- P1: Must have for v2 to be meaningfully better than v1 for a non-technical merchant
- P2: Core differentiators; required before calling v2 feature-complete
- P3: Required for production-safe action execution (ship together with P2 action proposals)

---

## UX Patterns: Concrete Specifications per Feature

### A. LLM Explain — Presentation Pattern

**Whole-panel narrative (COO summary):**
- Placement: collapsible card at the top of the advisor panel, above the insight list
- Trigger: auto-generated once per day (morning cron); "Atualizar analise" button for on-demand refresh
- Rendering: streaming SSE — text appears word-by-word, masks latency, feels alive
- Length: 3-4 sentences. First = overall situation. Second = top problem. Third = recommended focus. Fourth = optional positive signal.
- Format: plain Portuguese prose. Bold the key metric that justifies each sentence. No bullet lists inside the narrative.
- Cache: `consultor_llm_cache` table (org_id + cache_date + context_hash). Show "Gerado hoje as 09:12" timestamp. Stale if > 24h OR insight count delta > 2.
- Model: Claude Haiku for orgs with <= 6 insights; Claude Sonnet for orgs with > 6 or CRITICAL severity present.

**Per-insight explain:**
- Placement: collapsible section within each insight card ("Ver analise" link / chevron)
- Trigger: lazy — LLM called only on first expand; result cached per-insight per-day
- Rendering: streaming preferred; 2-3 sentences max
- Anti-hallucination rule (non-negotiable): LLM prompt must include: "Use only the data provided below. Do not invent numbers or mention metrics not listed." Every sentence in output must reference a number from the insight's `data_json`.

### B. Approval Queue — UX Pattern

**Propose step (in insight card):**
- Actionable insights show a "Propor [action]" button (e.g., "Propor reducao de preco", "Propor pausa de campanha")
- Click opens a modal showing: proposed change as diff (Atual / Proposto), estimated margin/ROAS impact, "Enviar para aprovacao" CTA
- On submit: creates row in `action_proposals` with status = pending, proposed_by, proposed_at, insight_id, action_type, payload_json

**Approval queue (owner view):**
- Location: tab or badge in advisor panel labeled "Aguardando aprovacao (N)"
- Each proposal card shows: which insight triggered it, the diff (current vs proposed), who proposed, when, estimated impact
- Actions: "Aprovar e executar" / "Rejeitar" (optional rejection reason text)
- On approve: status = approved, executes via EF / ML API, on success status = executed; on failure status = failed + error message shown
- On reject: status = rejected; in-product notification to proposer

**Audit log:**
- Append-only table `action_audit_log`
- Visible to owner in advisor panel under "Historico de acoes"
- Columns: Data, Acao, Anuncio/Campanha, Anterior, Novo, Proposto por, Aprovado por, Status
- Filterable by date range; no edit or delete capability ever

### C. Threshold Config — UX Pattern

**Entry point:** /organizacao -> tab "Consultor" (owner only)

**Layout:**
1. Preset row at top: "Conservador | Moderado (padrao) | Agressivo" — clicking a preset fills all sliders
2. Below: one slider per threshold with:
   - Label in plain Portuguese (e.g., "Meta de margem liquida")
   - Current value displayed as percentage (e.g., "18%")
   - Plain-language description: "Alertas de margem aparecem quando sua margem cai abaixo deste valor"
   - Guardrails enforced by slider bounds (e.g., margin: 5%-60%; TACoS: 1%-50%)
3. "Modo avancado" toggle (hidden by default) reveals raw number inputs for each field
4. "Salvar" button — writes to `consultor_config`, triggers on-demand insight refresh for org

**Guardrail values (suggested, to define in requirements):**

| Threshold | Min | Max | Conservador | Moderado | Agressivo |
|-----------|-----|-----|-------------|----------|-----------|
| Margem liquida target (%) | 5 | 60 | 25 | 18 | 12 |
| TACoS target (%) | 1 | 50 | 8 | 12 | 18 |
| Cobertura de estoque (dias) | 3 | 90 | 45 | 30 | 15 |
| Reputacao minima (score) | 1 | 5 | 4.5 | 4.0 | 3.5 |

### D. Per-Store Toggle — UX Pattern

**Store picker:**
- Dropdown in advisor panel header: "Todas as lojas" with list of store names from `ml_tokens`
- Each store name in the dropdown shows health score badge (0-100 or colour dot — green/yellow/red)
- Consolidated view (default): score and insights aggregate all stores; each insight card shows a store name badge to identify which store it belongs to
- Per-store view: score recalculated for that store only; insight list filtered to that store's `ml_user_id`

**Score display:**
- Consolidated: weighted average across stores (or worst-store-dominant — define in requirements based on product philosophy)
- Per-store: same 5-pillar breakdown component, scoped to one `ml_user_id`

---

## Competitor / Reference Pattern Analysis

| Feature | Reference Product | Their Approach | Our Approach |
|---------|-------------------|----------------|--------------|
| LLM advisor narrative | Amplitude Spark AI / Mixpanel Ask | Natural-language query response, on-demand | Whole-panel cached summary (COO paragraph) + per-insight expand on demand |
| Multi-store consolidated | Shopify multi-store reporting (2025) | Toggle selector, same metrics template per store | Store picker dropdown, consolidated default, per-store drill-down |
| Approval workflow | Jira bulk-change wizard | Step-by-step: select -> configure -> review -> apply | Modal: diff preview -> "Enviar para aprovacao" -> owner approval queue |
| Snooze alerts | Linear inbox | Inline "Snooze / Done / Open" on each notification card | Inline snooze on each insight card, named durations in Portuguese |
| Threshold config presets | Analytics platforms broadly | Preset profiles (e.g., "Balanced", "Aggressive") | "Conservador / Moderado / Agressivo" + sliders with live preview |
| Audit log | All enterprise SaaS with approvals | Immutable log table, filterable by date / user / action | /consultor "Historico de acoes" tab, append-only |

---

## Sources

- [Amplitude vs Mixpanel AI features comparison](https://www.techno-pulse.com/2026/04/best-ai-customer-analytics-tools-in.html)
- [Shopify multi-store reporting changelog](https://changelog.shopify.com/posts/multi-store-reporting-is-now-available-in-analytics)
- [Fullmetrix multi-store analytics](https://fullmetrix.com/en/use-cases/multi-store-analytics)
- [Metorik combined sales for multiple stores](https://metorik.com/guides/viewing-combined-sales-for-multiple-stores)
- [Design guidelines for notifications UX — Smashing Magazine](https://www.smashingmagazine.com/2025/07/design-guidelines-better-notifications-ux/)
- [Notification UX best practices — Eleken](https://www.eleken.co/blog-posts/notification-ux)
- [Approval workflow design examples — Nicelydone](https://nicelydone.club/tags/approval-workflow)
- [Audit logging for SaaS — James Ross Jr](https://www.jamesrossjr.com/blog/saas-audit-logging)
- [Bulk action UX guidelines — Eleken](https://www.eleken.co/blog-posts/bulk-actions-ux)
- [AI Copilot UX best practices 2025-26](https://www.letsgroto.com/blog/mastering-ai-copilot-design)
- [Semantic caching for LLMs — Maxim](https://www.getmaxim.ai/articles/semantic-caching-for-llms-how-to-cut-token-spend-with-ai-gateways/)
- [LLM caching cost reduction 59% — ProjectDiscovery](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching)
- [Multi-tenant LLM serving SaaS architecture — Spheron](https://www.spheron.network/blog/multi-tenant-llm-serving-gpu-cloud/)
- [AI hallucinations UX — Nielsen Norman Group](https://www.nngroup.com/articles/ai-hallucinations/)
- [UX guardrails without sacrificing user freedom](https://medium.com/ux-io/two-ways-to-guardrail-ux-without-sacrificing-user-freedom-4dc8a46e99ab)
- [One-click approval workflow rationale — Order.co](https://www.order.co/blog/spend-efficiency/one-click-purchase-approval-workflow/)

---
*Feature research for: Consultor v2 — LLM advisor + action-approval + per-store insights (garment-glow-test)*
*Researched: 2026-06-23*
