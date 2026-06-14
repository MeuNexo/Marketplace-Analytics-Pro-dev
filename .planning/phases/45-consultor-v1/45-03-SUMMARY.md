---
phase: 45-consultor-v1
plan: "03"
subsystem: consultor-ui
tags: [react, tanstack-query, shadcn-ui, hook, component, routing, sidebar]
dependency_graph:
  requires: [45-01 (insights/snapshots tables + types), 45-02 (consultor-insights EF deployed, 8 active insights, score 83)]
  provides: [useConsultorInsights hook, ConsultorCard component (top of /vendas), MLConsultor page (/consultor), sidebar + route + routeMeta]
  affects: [visual checkpoint Task 4 — Wesley approval]
tech_stack:
  added: []
  patterns: [useQuery org-scoped staleTime 4h, on-demand EF invoke with per-org guard, useMutation dismiss with invalidateQueries, React.lazy route + RoleRoute/ErrorBoundary, sidebar item via lucide Lightbulb]
key_files:
  created:
    - src/hooks/useConsultorInsights.ts
    - src/components/mercadolivre/ConsultorCard.tsx
    - src/pages/mercadolivre/MLConsultor.tsx
  modified:
    - src/pages/MercadoLivre.tsx
    - src/App.tsx
    - src/components/layout/ApiSidebar.tsx
    - src/components/layout/routeMeta.ts
decisions:
  - "ConsultorCard placed after OnboardingBanner, before content widgets, conditioned on onboardingComplete (per plan critical_constraint)"
  - "scoreBandClasses use CSS var() references (hsl(var(--success)/var(--warning)/--destructive)) for full dark-mode compatibility without new tokens"
  - "Dismiss uses org-scoped .eq(organization_id) on client in addition to RLS server guard (T-45-12 defense-in-depth)"
  - "PillarRow progress bars in MLConsultor show 0-100 score visually, capped with Math.min/Math.max for safety"
  - "on-demand invoke guard uses useRef<Set<string>> keyed by orgId — consistent with useMLBillingWithSync pattern (45-PATTERNS.md)"
metrics:
  duration: "~4 min"
  completed: "2026-06-14"
  tasks_completed: 3
  tasks_total: 4
  files_created: 3
  files_modified: 4
status: checkpoint-pending (Task 4 = visual verification by Wesley)
---

# Phase 45 Plan 03: Consultor v1 UI Summary

**One-liner:** Hook `useConsultorInsights` + card "O que fazer agora" no topo de /vendas + painel `/consultor` com insights em linguagem leiga, score de saúde 0-100 com tendência, dismiss, e deep-links para as páginas certas.

---

## Status: TASKS 1-3 COMPLETE — awaiting visual checkpoint (Task 4)

Tasks 1-3 executed and committed. `npx tsc --noEmit` and `npm run build` both clean. Task 4 is `type="checkpoint:human-verify"` — requires visual confirmation by Wesley before marking complete.

---

## Tasks Completed

### Task 1: Hook useConsultorInsights (commit 6c283fb0)

File: `src/hooks/useConsultorInsights.ts` (203 lines)

- `useQuery ["consultor_insights", orgId]`: reads `insights` WHERE status IN ('active') AND org-scoped. staleTime 4h.
- `useMemo` sorts by severity rank (critical=0/high=1/medium=2) then impact_brl desc nulls last (D-17).
- `useQuery ["consultor_score", orgId]`: reads 2 latest `consultor_health_snapshots` → score + delta (D-12) + scoreBand (D-10) + 5 pillars.
- on-demand invoke: `useRef<Set<string>>` guard per orgId; calls `consultor-insights` EF with `{mode:"org_only"}` when data=[] and !loading; releases guard on network error for retry (D-20).
- `dismiss` mutation: UPDATE status='dismissed' dismissed_at=now() org-scoped, invalidates `["consultor_insights", orgId]` (D-18).
- Exports: `useConsultorInsights`, `InsightRow`, `ScoreBand`.

### Task 2: ConsultorCard + wiring in MercadoLivre.tsx (commit 9e2722b5)

Files: `src/components/mercadolivre/ConsultorCard.tsx` + `src/pages/MercadoLivre.tsx`

- Score badge: band-colored (healthy=success/attention=warning/critical=destructive), label Saudável/Atenção/Crítico (D-10). Trend arrow ▲/▼ with delta points (D-12).
- Top 3 insights (D-16): SeverityIcon (XCircle/AlertTriangle/Info), title as clickable Link (D-19), "Você está perdendo ~R$ X/mês" framing (D-14), dismiss X button.
- Empty state: "Tudo certo por aqui." keeps score visible without noisy empty list.
- Syncing state: Loader2 spinner on score line; "Analisando sua operação..." text when syncing+no insights.
- "Ver todos" Button links to `/consultor`.
- MercadoLivre.tsx: imports `ConsultorCard` + `useConsultorInsights`; renders `{onboardingComplete && <ConsultorCard .../>}` after `<OnboardingBanner>` and before content widgets.

### Task 3: MLConsultor page + route + sidebar + routeMeta (commit 500f5656)

Files: `src/pages/mercadolivre/MLConsultor.tsx` + `src/App.tsx` + `src/components/layout/ApiSidebar.tsx` + `src/components/layout/routeMeta.ts`

- MLConsultor: score header with score badge (big, D-10), trend delta (D-12), pillars breakdown with progress bars (Margem 30%/Ads 25%/Estoque 20%/Reputação 15%/Completude 10%).
- Full insights list with InsightCard: severity badge + category, title, `body` (por que importa — CONSUL-03), impact R$/mês (D-14), "como resolver" Button linking to `action_href` (D-19), dismiss button.
- Loading: 3 skeleton cards with Loader2. Empty: actionable message.
- App.tsx: `const MLConsultor = React.lazy(...)` + `<Route path="/consultor" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro no Consultor"><MLConsultor /></ErrorBoundary></RoleRoute>} />` inside the existing ApiLayout tree (ALL roles, same as /reputacao).
- ApiSidebar.tsx: added `Lightbulb` import from lucide-react; new item `{ icon: Lightbulb, label: "Consultor", path: "/consultor" }` after "Vendas" in Dashboard section.
- routeMeta.ts: `"/consultor": { title: "Consultor", subtitle: "O que fazer agora — alertas e saúde do negócio" }`.

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Known Stubs

None — all data comes from real Supabase queries (`insights` and `consultor_health_snapshots` tables, populated by the EF in Plan 02). If a user's org has no active insights, the hook triggers an on-demand EF call.

---

## Threat Flags

None — no new security-relevant surface introduced. All reads use `organization_id` filter on client + RLS `is_org_member` on server (T-45-11). Dismiss uses `organization_id` filter + RLS UPDATE policy (T-45-12). Deep-links are internal routes already protected by RoleRoute (T-45-13 accepted).

---

## Self-Check: PASSED

- FOUND: src/hooks/useConsultorInsights.ts (203 lines, exports useConsultorInsights, InsightRow, ScoreBand)
- FOUND: src/components/mercadolivre/ConsultorCard.tsx
- FOUND: src/pages/mercadolivre/MLConsultor.tsx
- FOUND: /consultor route in src/App.tsx with MLConsultor lazy import
- FOUND: /consultor item in src/components/layout/ApiSidebar.tsx (Lightbulb icon)
- FOUND: /consultor in src/components/layout/routeMeta.ts
- VERIFIED: onboardingComplete guard in MercadoLivre.tsx before ConsultorCard
- VERIFIED: npx tsc --noEmit clean (no output = no errors)
- VERIFIED: npm run build clean (built in 18.54s, only pre-existing chunk size warning)
- COMMITS: 6c283fb0 (hook), 9e2722b5 (card + wiring), 500f5656 (page + route + sidebar + routeMeta)
