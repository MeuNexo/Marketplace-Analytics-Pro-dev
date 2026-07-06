---
phase: 88-dre-frontend-resultado-completo-vendas
plan: 01
subsystem: financial
tags: [react-query, supabase-rpc, vitest, dre, tdd]

requires:
  - phase: 87-dre-competencia-operacional
    provides: "get_dre_operational_by_competence RPC (SECURITY INVOKER, RLS on cash_outflows), applied in prod"
provides:
  - "Pure aggregateOperationalBlocks + computeResultadoLiquido functions (src/lib/dreOperational.ts)"
  - "useDreOperational(month) react-query hook wrapping the RPC"
  - "Vitest proof that June/2026 reconciles to ≈ −R$29.094 and that impostos_venda/excluido never affect the sum"
affects: [88-02-dre-frontend-resultado-completo-vendas]

tech-stack:
  added: []
  patterns:
    - "Pure aggregation function + tested arithmetic, wrapped by a thin react-query hook (copy of useCostByMonth.ts shape)"
    - "Allow-list (not deny-list) filtering for RPC blocos to prevent double-counting"

key-files:
  created:
    - src/lib/dreOperational.ts
    - src/lib/dreOperational.test.ts
    - src/hooks/useDreOperational.ts
    - src/hooks/useDreOperational.test.ts
  modified: []

key-decisions:
  - "aggregateOperationalBlocks uses an allow-list of 5 blocos (pessoal/estrutura/servicos/outros_operacionais/financeiro) — impostos_venda and excluido are never referenced, guaranteeing they cannot re-enter via a future refactor"
  - "financeiro_is_approximate derived via rows.filter(bloco==='financeiro').some(...) — intent-based, not incidental row order (per RESEARCH Pitfall 4)"
  - "useDreOperational(month) takes only the month arg; orgId is derived internally from useOrganization() — never accepted as a caller argument (anti-IDOR, matches every other RPC hook in src/hooks/)"

requirements-completed: [DRE-88-01, DRE-88-03, DRE-88-04]

duration: 15min
completed: 2026-07-06
status: complete
---

# Phase 88 Plan 01: Pure DRE Operational Data Layer Summary

**Pure, unit-tested `aggregateOperationalBlocks`/`computeResultadoLiquido` module plus a `useDreOperational` react-query hook wrapping the already-deployed `get_dre_operational_by_competence` RPC, proving the June/2026 −R$29k reconciliation before any UI exists.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-06T22:31:30Z
- **Tasks:** 2/2
- **Files modified:** 4 (all new)

## Accomplishments
- `src/lib/dreOperational.ts` — pure module with `OPERATIONAL_BLOCOS` allow-list, `aggregateOperationalBlocks(rows)`, `computeResultadoLiquido(margem, blocks)`, and the `DreOperationalRow`/`DreOperationalBlocks` types. No React, no Supabase import.
- `src/lib/dreOperational.test.ts` — 7 tests: bloco summation with 0-default for missing blocos, exclusion proof (adding `impostos_venda`/`excluido` rows does not change the result), `.some()`-based `financeiro_is_approximate` derivation (including a per-bloco vs per-row edge case), and the June/2026 fixture reconciling to exactly −29094.
- `src/hooks/useDreOperational.ts` — react-query hook mirroring `useCostByMonth.ts` exactly: `useOrganization()` → `orgId`, `queryKey: ["dre","operational",orgId,month]`, `enabled: !!orgId && !!month`, `staleTime: 3*60*1000`, calls `supabase.rpc("get_dre_operational_by_competence", { p_org_id, p_month })`, maps rows with String/Number/Boolean coercion, reduces through `aggregateOperationalBlocks`.
- `src/hooks/useDreOperational.test.ts` — 4 tests: RPC called with session-derived `p_org_id` + passed `p_month`; disabled when `orgId` is null; disabled when `month` is null; mixed-row aggregation (pessoal + approximate financeiro + impostos_venda + excluido) returns the correctly filtered/aggregated object.

## Task Commits

1. **Task 1: Pure dreOperational module + unit tests (June −R$29k proof)** - `87f14d8d` (feat)
2. **Task 2: useDreOperational react-query hook + hook tests** - `21c7c250` (feat)

_Note: written test+implementation together per pure-function TDD style; both task commits include their respective test file, and all tests were green before committing._

## Files Created/Modified
- `src/lib/dreOperational.ts` - Pure aggregation + resultado-líquido arithmetic
- `src/lib/dreOperational.test.ts` - 7 vitest cases incl. June/2026 fixture + exclusion proof
- `src/hooks/useDreOperational.ts` - react-query hook wrapping the RPC
- `src/hooks/useDreOperational.test.ts` - 4 vitest cases incl. enabled-guards and RPC arg assertions

## Decisions Made
- Allow-list (not deny-list) chosen for bloco filtering so a future `cash_outflows` category addition can never silently re-introduce double-counting.
- `useDreOperational` signature is `(month: string | null)` only — orgId is never a caller argument, matching the anti-IDOR precedent of every other RPC hook in `src/hooks/` (and matching 88-02's call site `useDreOperational(billingMonthFrom)`).
- No cast added for `supabase.rpc("get_dre_operational_by_competence", ...)` — confirmed by grep that sibling RPCs (`get_cost_by_month`, `get_cost_waterfall`) are also absent from `src/integrations/supabase/types.ts` and compile cleanly without a cast; same precedent followed here (tsc confirmed clean).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. RPC already deployed in prod (Phase 87).

## Next Phase Readiness

Plan 02 (UI wiring) can proceed immediately: `computeResultadoLiquido` and `DreOperationalBlocks` are exported from `src/lib/dreOperational.ts`, and `useDreOperational(month)` is ready to be called with `billingMonthFrom` from `MercadoLivre.tsx`. No blockers.

## Self-Check: PASSED

All 4 created files verified present on disk; both task commits (87f14d8d, 21c7c250) verified in git log.

---
*Phase: 88-dre-frontend-resultado-completo-vendas*
*Completed: 2026-07-06*
