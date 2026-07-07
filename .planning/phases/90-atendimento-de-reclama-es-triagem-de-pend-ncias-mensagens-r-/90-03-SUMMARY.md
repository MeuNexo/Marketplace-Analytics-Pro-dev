---
phase: 90-atendimento-de-reclama-es-triagem-de-pend-ncias-mensagens-r-
plan: 03
subsystem: ui
tags: [react, typescript, vitest, tanstack-query, radix-tabs, supabase]

requires:
  - phase: 90-01
    provides: "ml_claims columns seller_action_required, pending_action_type, action_due_date, available_actions, stage populated in prod by ml-webhook + sync-ml-claims"
provides:
  - "claimBucket/pendingActionLabel/dueDateLabel pure helpers in src/lib/claimStatus.ts (unit tested)"
  - "/devolucoes 3-bucket triage UI (Pende você default / Aguardando / Resolvida) with per-row pendency badge + due-date label, deadline-first ordering, 'Pendem você' KPI"
  - "Navbar pendências bell counting claims by seller_action_required (parity with the Pende você bucket)"
affects: [90-04, atendimento-reclamacoes, ml-devolucoes]

tech-stack:
  added: []
  patterns:
    - "Pure bucket/label/date-wording helpers kept in src/lib and unit-tested with an injected `now` for determinism"
    - "Radix Tabs (controlled value/onValueChange) reused from MLPerguntas.tsx for segmented triage views"

key-files:
  created:
    - src/lib/claimStatus.test.ts
  modified:
    - src/hooks/useMLClaims.ts
    - src/lib/claimStatus.ts
    - src/pages/mercadolivre/MLDevolucoes.tsx
    - src/hooks/useAtendimentoPendencias.ts

key-decisions:
  - "claimBucket/pendingActionLabel/dueDateLabel counts are computed over the full claims list (unaffected by the Tipo filter) so the KPI, tab counts, and navbar bell all agree — matching the success criteria 'counters and bell agree'"
  - "dueDateLabel compares calendar days (local midnight to local midnight) rather than raw millisecond deltas, so 'vence hoje'/'atrasada'/'vence em N dias' are stable across time-of-day and match the wording exactly (server runs UTC, matching the design)"
  - "Bell claim titulo: 'Responder' pendency is combined with the claim type ('Responder reclamação'/'Responder devolução'); the other three pendency labels (Decidir devolução/reembolso, Falar com o ML) are used as-is since they're already self-explanatory, avoiding awkward duplicate wording"

requirements-completed: [TRIAGE-03, TRIAGE-04]

duration: 5min
completed: 2026-07-07
status: complete
---

# Phase 90 Plan 03: Triagem "de quem é a vez" (frontend) Summary

**Replaced the /devolucoes open/closed status filter with three deadline-aware triage buckets (Pende você / Aguardando / Resolvida) driven by the `seller_action_required` columns from Plan 90-01, and made the navbar bell count by the same criterion.**

## Performance

- **Duration:** ~5 min (execution only; plan authored earlier)
- **Started:** 2026-07-07T13:41:00Z
- **Completed:** 2026-07-07T13:46:52Z
- **Tasks:** 3/3 completed
- **Files modified:** 4 modified, 1 created

## Accomplishments
- `MLClaimRow` now exposes `seller_action_required`, `pending_action_type`, `action_due_date`, `stage`
- Three pure, unit-tested helpers (`claimBucket`, `pendingActionLabel`, `dueDateLabel`) classify and label claims deterministically
- `/devolucoes` shows the three buckets as tabs (default "Pende você"), each pending row carries a pendency-type badge + due-date label, sorted deadline-first with nulls last
- KPI renamed "Abertas" → "Pendem você", now counting `seller_action_required`
- Navbar pendências bell now counts claims via `.eq("seller_action_required", true)` instead of the old open/under_review status filter, keeping questions unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend MLClaimRow + claimStatus helpers (buckets, badge, due date) + tests** - `2f523262` (feat)
2. **Task 2: MLDevolucoes — 3 buckets, per-row pendency badge + due date, "Pendem você" KPI** - `a7ca125e` (feat)
3. **Task 3: Navbar bell counts pendências by seller_action_required** - `cfdd85ae` (feat)

_No plan-metadata commit yet — created below by execute-plan protocol._

## Files Created/Modified
- `src/hooks/useMLClaims.ts` - `MLClaimRow` interface gains the 4 triage columns (type-only change, query already `select("*")`)
- `src/lib/claimStatus.ts` - adds `claimBucket`, `pendingActionLabel`, `dueDateLabel` (existing exports untouched)
- `src/lib/claimStatus.test.ts` - 22 new vitest cases covering all bucket/badge/due-date branches
- `src/pages/mercadolivre/MLDevolucoes.tsx` - replaces the status `Select` with a controlled `Tabs` (Pende você / Aguardando / Resolvida), renders `pendencyBadge()` for pending rows, sorts pending rows by `action_due_date` ascending (nulls last), renames the first KPI to "Pendem você"
- `src/hooks/useAtendimentoPendencias.ts` - claims query filters by `seller_action_required = true` instead of `status IN (opened, under_review)`; claim `titulo` uses `pendingActionLabel` when available

## Decisions Made
See `key-decisions` in frontmatter above.

## Deviations from Plan

None - plan executed exactly as written. All three tasks matched their `<action>`/`<acceptance_criteria>` blocks; no architectural changes, no missing dependencies, no auth gates.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. No backend/EF changes were made (constraint honored); `reply-ml-claim` / `ml-claim-action` invoke bodies untouched.

## Verification

- `npx tsc --noEmit` — clean after every task
- `npm test -- --run` — 472/472 tests pass (33 files), including the new 22 `claimStatus.test.ts` cases
- `npm run build` — succeeds (`MLDevolucoes` chunk built at 21.56 kB / 7.05 kB gzip)
- Grep gates: `Pendem você`, `claimBucket`, `pendingActionLabel`, `action_due_date` all present in `MLDevolucoes.tsx`; `seller_action_required` present in `useAtendimentoPendencias.ts`

## Next Phase Readiness
- `/devolucoes` and the navbar bell now share the exact same "pende você" criterion (`seller_action_required`), satisfying the plan's success criteria that counters and bell agree.
- Plan 90-04 (if it builds on the templates/quick-messages block or further triage work) can rely on `claimBucket`/`pendingActionLabel`/`dueDateLabel` as the canonical triage vocabulary.
- No blockers. Recommend a quick visual check on `/devolucoes` (light + dark) once deployed, since this plan is frontend-only and `autonomous: true` (no deploy checkpoint was required).

---
*Phase: 90-atendimento-de-reclama-es-triagem-de-pend-ncias-mensagens-r-*
*Completed: 2026-07-07*

## Self-Check: PASSED
