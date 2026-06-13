---
phase: 42-zero-mock
plan: "03"
subsystem: frontend-hooks-pages
tags: [real-data, ml-questions, ml-claims, ml-reputation, hooks, zero-mock]
dependency_graph:
  requires: ["42-01", "42-02"]
  provides: [useMLQuestions, useMLClaims, MLPerguntas, MLDevolucoes, MLReputacao]
  affects: ["/perguntas", "/devolucoes", "/reputacao"]
tech_stack:
  added: []
  patterns:
    - TanStack Query v5 hooks for ml_questions + ml_claims (useMLBilling analog)
    - CR-01 multi-loja: .in("ml_user_id", resolvedMLUserIds) in both hooks
    - shadcn AlertDialog for irreversible reply confirmation (D-05)
    - supabase.functions.invoke("reply-ml-question") from browser (D-04/06)
    - sonner toast for reply success/error
    - buildDailyFeedback() derives chart from real feedback dates (D-07)
    - fulfilled normalization: "positive"|true → "positive", else "negative" (Pitfall 3)
key_files:
  created:
    - src/hooks/useMLQuestions.ts
    - src/hooks/useMLClaims.ts
  modified:
    - src/hooks/useMLReputation.ts
    - src/pages/mercadolivre/MLPerguntas.tsx
    - src/pages/mercadolivre/MLDevolucoes.tsx
    - src/pages/mercadolivre/MLReputacao.tsx
    - src/data/reputacaoMockData.ts
    - src/data/perguntasMockData.ts
    - src/data/devolucoesMockData.ts
    - src/hooks/useMLQuestions.test.ts
    - src/hooks/useMLClaims.test.ts
decisions:
  - "useQuery queryFn returns [] when disabled (never throws), consistent with TQ v5 patterns"
  - "buildDailyFeedback groups by date.substring(0,10) ascending — sparse series is valid (D-07)"
  - "ClaimStatus redefined inline in MLDevolucoes.tsx — no longer imported from devolucoesMockData"
  - "MLReputacao no longer shows 'dados simulados' badge when isRealData=false — just no badge (clean)"
  - "Test scaffolds fixed: vi.spyOn replaced with mock.calls pattern; beforeEach resets context implementations"
metrics:
  duration: "14 minutes"
  completed: "2026-06-13"
  tasks: 3
  files: 11
---

# Phase 42 Plan 03: Real Data for Perguntas, Devolucoes, Reputacao — Summary

**One-liner:** Hooks useMLQuestions + useMLClaims built on useMLBilling analog (CR-01); three pages rewired to real data; all getMock* functions removed; inline reply with AlertDialog confirm + 0/2000 char counter wired through reply-ml-question EF.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Build useMLQuestions + useMLClaims hooks | acc55ff7 | src/hooks/useMLQuestions.ts, src/hooks/useMLClaims.ts |
| 2 | Rewrite MLPerguntas + MLDevolucoes | ac831fef | src/pages/mercadolivre/MLPerguntas.tsx, MLDevolucoes.tsx |
| 3 | Real reputation feedback + remove all mocks | 90976698 | src/hooks/useMLReputation.ts, MLReputacao.tsx, 3 mock data files |

## What Was Built

### Task 1 — Hooks (useMLQuestions + useMLClaims)

Both hooks follow the `useMLBilling` analog exactly:
- `resolvedMLUserIds` from `useMLStore()`, `currentOrg` from `useOrganization()`
- `queryKey` includes `[orgId, resolvedMLUserIds, status]` — CR-01 multi-loja scope
- `enabled: !!orgId && resolvedMLUserIds.length > 0`
- `staleTime: 2 * 60 * 1000` (cron runs every 15/30 min)
- `.eq("organization_id", orgId).in("ml_user_id", resolvedMLUserIds)` — the `.in()` IS the CR-01 merge
- `queryFn` returns `[]` when disabled (never throws)
- Explicit `MLQuestionRow` / `MLClaimRow` interfaces matching table columns

### Task 2 — MLPerguntas (inline reply) + MLDevolucoes (filters)

**MLPerguntas:**
- Removed 3 `getMock*` imports, their `useMemo` calls, "Dados simulados" badge, fake `setSyncing` timeout
- Added `useMLQuestions()` hook; derived KPIs (pending/answered/answer_rate) from real `questions[]`
- Daily chart via `buildDailyQuestions()` — groups last 30 days from real `data_pergunta` dates
- Inline reply flow (D-04): `answeringId` state expands textarea below each UNANSWERED row
- Char counter 0/2000 (D-06): submit disabled when length === 0 or > 2000
- AlertDialog confirm (D-05): fires when "Responder" clicked, copy says "irreversível"
- `handleSendReply`: `supabase.functions.invoke("reply-ml-question", { body: { question_id, text, ml_user_id } })` → sonner toast success/error → refetch
- Empty state for pre-cron: "Sincronizando perguntas — volte em alguns minutos"
- No `dangerouslySetInnerHTML` on any buyer text (T-42-08 mitigated)

**MLDevolucoes:**
- Removed all `getMock*` imports and "dados simulados" badge
- Added `useMLClaims()` hook; derived KPIs from real claims
- `tipoFilter` ("all"|"mediations"|"returns") + `statusFilter` ("all"|"opened"|"closed") via Select dropdowns (D-09)
- `filtered = useMemo(...)` applying both filters client-side
- `tipoLabel()` maps "mediations"→"Reclamação", "returns"→"Devolução"
- Read-only table with tipo column (D-09); shows up to 50 rows
- Empty state for pre-cron and for "no results with filter"
- No `dangerouslySetInnerHTML` (T-42-08)

### Task 3 — useMLReputation + MLReputacao + mock cleanup

**useMLReputation.ts:**
- Removed `getMockReputationSummary` import and `mockReputation` field from interface + return
- Added `feedbacks: FeedbackEntry[]` to `UseMLReputationResult` interface
- `fetchReputation` parses `data.feedbacks` with `fulfilled` normalization (Pitfall 3): `(f.fulfilled === "positive" || f.fulfilled === true) ? "positive" : "negative"`
- Missing/empty `data.feedbacks` treated as `[]` (Pitfall 7 — never throw)

**MLReputacao.tsx:**
- Removed `getMockFeedbackDaily`, `getMockFeedbackEntries`, `mockReputation` usage
- Added `buildDailyFeedback(feedbacks)` — groups by `date.substring(0, 10)` ascending, returns `{date, Positivo, Negativo}` (D-07)
- Chart renders empty state when `chartData.length === 0` (sparse series is valid — no fabrication)
- Removed "dados simulados" badge; isRealData still shows "Dados reais" green badge when true
- Feedback list renders real entries; empty state when feedbacks.length === 0
- No `dangerouslySetInnerHTML` (T-42-08)

**Mock data files:**
- `reputacaoMockData.ts`: removed `getMockReputationSummary`, `getMockFeedbackDaily`, `getMockFeedbackEntries`; kept `ReputationSummary`, `ReputationLevel`, `FeedbackEntry`, `FeedbackDailyStat` type exports
- `perguntasMockData.ts`: removed `getMockPerguntasSummary`, `getMockPerguntasDailyStats`, `getMockPerguntaEntries`; kept type exports
- `devolucoesMockData.ts`: removed `getMockDevolucoeSummary`, `getMockDevolucoesDailyStats`, `getMockClaimEntries`; kept type exports
- `pedidosMockData.ts` and `financialMockData.ts` — untouched (out of scope)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed RED scaffold test infrastructure (useMLQuestions.test.ts, useMLClaims.test.ts)**
- **Found during:** Task 1 — tests failed with "No QueryClient set, use QueryClientProvider"
- **Issue 1:** `renderHook` calls lacked `QueryClientProvider` wrapper (scaffold used TanStack Query v5 hooks but no wrapper)
- **Issue 2:** Tests used `vi.spyOn` which caused spy layer accumulation across tests; subsequent tests failed because `vi.clearAllMocks()` didn't reset `mockReturnValue` implementations set by previous tests
- **Fix:** Added `createWrapper()` with fresh `QueryClient` per test; replaced `vi.spyOn` with direct `.mock.calls` checks on the already-mocked `vi.fn()` functions; added `beforeEach` resets for context mocks in each `describe` block
- **Files modified:** src/hooks/useMLQuestions.test.ts, src/hooks/useMLClaims.test.ts
- **Commit:** acc55ff7
- **Result:** 19/19 tests GREEN

## Known Stubs

None. All three pages read real data. The only "empty state" paths are:
- Pre-cron (first sync hasn't run yet) — intentional, documented in context
- `feedbacks: []` in useMLReputation when EF doesn't return feedbacks — intentional (D-07: sparse series valid)

## Threat Flags

No new threat surface introduced. All threats from plan threat model are mitigated:
- T-42-08: No `dangerouslySetInnerHTML` on buyer text in any page — verified by grep
- T-42-09: reply-ml-question EF (plan-02) re-validates org membership server-side
- T-42-10: Both hooks scope every query by `organization_id` + `.in("ml_user_id", resolvedMLUserIds)`

## Self-Check: PASSED

- [x] useMLQuestions.ts exists: `/root/garment-glow-test/src/hooks/useMLQuestions.ts`
- [x] useMLClaims.ts exists: `/root/garment-glow-test/src/hooks/useMLClaims.ts`
- [x] All 19 tests GREEN: `npm test -- --run src/hooks/useMLQuestions.test.ts src/hooks/useMLClaims.test.ts`
- [x] Build clean: `npm run build` — `✓ built in 18.15s`
- [x] No `getMock*` in any page/hook/mock-data file
- [x] No "dados simulados" in any page
- [x] No `dangerouslySetInnerHTML` (only in comments documenting the mitigation)
- [x] pedidosMockData.ts + financialMockData.ts: 0 lines changed
- [x] Commits: acc55ff7, ac831fef, 90976698
