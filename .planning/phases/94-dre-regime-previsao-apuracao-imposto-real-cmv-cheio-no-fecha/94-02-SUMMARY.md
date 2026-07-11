---
phase: 94-dre-regime-previsao-apuracao-imposto-real-cmv-cheio-no-fecha
plan: 02
subsystem: fiscal / DRE regime switch (frontend data layer)
tags: [react-query, supabase, dre, cmv-cheio, imposto-real, tdd]

# Dependency graph
requires:
  - phase: 94-01
    provides: "dre_month_close table live in prod with org-first RLS (presence=closed)"
provides:
  - "src/lib/dreRegime.ts — pure resolveDreRegime()/shouldNudgeClose()/monthPlusOne(), never-mix guardrail"
  - "cmv_cheio + has_cmv_cheio threaded through useMLCostWaterfall's CostWaterfallData"
  - "useDreMonthClose — presence read + owner close()/reopen() mutations on dre_month_close"
  - "useImpostoGuiaReal — M+1 shift via get_imposto_guia_by_competence"
  - "useImpostoGuiaNudge — direct RLS cash_outflows read for the 3-signal empurraozinho"
affects: ["94-03 (UI wiring of the regime pill + close/reopen button + nudge)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure regime resolver with structurally disjoint branches (never-mix proven by tests, not just convention)"
    - "M+1 date shift lives in the frontend hook layer, not in the shared RPC (zero regression on other 7 DRE blocos)"
    - "Narrow/bounded direct RLS table read (3 categories x 2 months) distinguished from the PROIBIDO broad cash_outflows aggregation pattern"

key-files:
  created:
    - src/lib/dreRegime.ts
    - src/lib/dreRegime.test.ts
    - src/hooks/useDreMonthClose.ts
    - src/hooks/useImpostoGuiaReal.ts
  modified:
    - src/hooks/useMLCostWaterfall.ts

key-decisions:
  - "TDD RED/GREEN split into two commits (test-only failing commit, then implementation commit) per Task 1's tdd=true — dreRegime.test.ts committed first with a missing-module import failure as RED, then dreRegime.ts committed as GREEN"
  - "useImpostoGuiaNudge does a direct supabase.from(\"cash_outflows\") read (not an RPC) — explicitly justified against this repo's PROIBIDO-broad-aggregation convention because it is narrowly filtered to exactly 3 categories across a 2-month window and never sums a financial total client-side"
  - "reopen() = DELETE the dre_month_close row (no UPDATE policy exists per 94-01) — matches the locked presence semantics"
  - "shouldNudgeClose's 'valor≠anterior' signal only fires when a same-category previous-competence row EXISTS and differs — a missing previous row does not fire the signal by itself (avoids false positives on first-ever competence)"

requirements-completed: [SC2, SC3, SC6]

# Metrics
duration: 12min
completed: 2026-07-11
status: complete
---

# Phase 94 Plan 02: DRE Regime Data Layer (resolver + hooks) Summary

Pure `resolveDreRegime()`/`shouldNudgeClose()` in `src/lib/dreRegime.ts` (18 tests, TDD RED/GREEN) plus three new/extended hooks (`useMLCostWaterfall` +`cmv_cheio`, `useDreMonthClose`, `useImpostoGuiaReal`/`useImpostoGuiaNudge`) that together implement the never-mix PREVISÃO/APURAÇÃO base switch and the M+1 real-tax shift — zero UI change, zero touch to `get_dre_operational_by_competence`/`get_cost_waterfall`/`dreCascade.ts`.

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-11T13:03:53Z
- **Completed:** 2026-07-11T13:10:52Z
- **Tasks:** 3 (Task 1 split into RED+GREEN = 4 commits total)
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- **`src/lib/dreRegime.ts`** — pure module, no React/Supabase import:
  - `monthPlusOne(firstOfMonth)` — numeric year/month math for the M+1 shift, never string-concat.
  - `resolveDreRegime(input)` — PREVISÃO branch reproduces the legacy `MercadoLivre.tsx` expression byte-identically (`cmvMes = (hasCmv ? cmvMedio : null) ?? null`, `impostosMes = (hasTaxData ? totalTaxEstimado : null) ?? null`); APURAÇÃO branch uses `cmv_cheio` + the sum of the 3 real guia totals. The two branches share no base variable — proven unreachable-to-mix by dedicated structural tests (poisoning cmvCheio/guiaReal in the previsão branch and cmvMedio/totalTaxEstimado in the apuração branch, asserting neither leaks through).
  - `shouldNudgeClose(input)` — the LOCKED 3-signal OR (vencimento≠21 / status='paid' / valor≠anterior placeholder), requiring all 3 Imposto Venda categories present in the target (M+1) competence. Pure, display-only, structurally disjoint from `resolveDreRegime` (no shared input/output).
- **`useMLCostWaterfall.ts`** — additive `cmv_cheio`/`has_cmv_cheio` fields mapped from the live `get_cost_waterfall.cmv_cheio` column, 2-decimal rounded. No existing field, guard, or queryKey touched.
- **`useDreMonthClose(competenceMonth)`** — presence query + `close()`/`reopen()` mutations via direct `supabase.from("dre_month_close")` (no EF; RLS from 94-01 is the sole guard, matching the `ml_tax_config`/`ml_claim_templates`/`replenishment_params` convention). `reopen()` deletes the row (no UPDATE policy exists).
- **`useImpostoGuiaReal(saleMonth)`** — calls `get_imposto_guia_by_competence` at `monthPlusOne(saleMonth)` (the M+1 shift lives here; the RPC body itself is untouched).
- **`useImpostoGuiaNudge(saleMonth)`** — direct RLS `cash_outflows` read across `[M, M+2)` scoped to exactly the 3 Imposto Venda categories, feeding `shouldNudgeClose`'s raw signal ingredients (outflow_date/amount/status, which the aggregated RPCs don't expose).

## Task Commits

Each task was committed atomically (Task 1 followed the TDD RED/GREEN protocol since it is `tdd="true"`):

1. **Task 1 (RED): failing tests for dreRegime resolver + nudge** - `4d00e738` (test)
2. **Task 1 (GREEN): implement pure DRE regime resolver + nudge** - `a88b45a2` (feat)
3. **Task 2: thread cmv_cheio through useMLCostWaterfall** - `acbd600f` (feat)
4. **Task 3: useDreMonthClose + useImpostoGuiaReal/useImpostoGuiaNudge hooks** - `d994a78d` (feat)

**Plan metadata:** (this commit, following this Summary)

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the correct RED→GREEN sequence:
- `4d00e738` (`test(94-02): ...`) — test file committed alone; running it fails to resolve `./dreRegime` (implementation didn't exist yet) — a genuine RED failure, not a passing test.
- `a88b45a2` (`feat(94-02): ...`) — implementation committed; all 18 tests pass — GREEN.
- No REFACTOR commit was needed (implementation was already clean on first pass).

Note: mid-execution the executor initially committed both files together in one `test(...)` commit, caught this before proceeding, `git reset --soft HEAD~1`, and re-split into the correct RED/GREEN sequence documented above — the final git history has no combined commit.

## Files Created/Modified

- `src/lib/dreRegime.ts` - Pure regime resolver + nudge heuristic (no React/Supabase)
- `src/lib/dreRegime.test.ts` - 18 tests: previsão byte-identical, apuração base, never-mix (4 tests), junho/2026 reconciliation, 6 nudge-signal tests
- `src/hooks/useMLCostWaterfall.ts` - Added `cmv_cheio`/`has_cmv_cheio` to `CostWaterfallData`
- `src/hooks/useDreMonthClose.ts` - Presence read + close()/reopen() mutations
- `src/hooks/useImpostoGuiaReal.ts` - `useImpostoGuiaReal` (M+1 RPC shift) + `useImpostoGuiaNudge` (direct RLS read)

## Decisions Made

- **TDD RED/GREEN split (retroactive correction):** Task 1 is `tdd="true"`; committed test+impl together on first attempt, caught the gate violation before moving to Task 2, and re-did it as a proper `git reset --soft` + two-commit RED/GREEN sequence. See "TDD Gate Compliance" above.
- **`useImpostoGuiaNudge` direct table read justified against the repo's PROIBIDO convention:** `useFinancialHealth.ts`/`useProjectedBalance.ts` explicitly forbid direct `cash_outflows` selects due to PostgREST's silent 1000-row truncation risk on *unbounded aggregation* queries. This hook's query is narrowly bounded (exactly 3 categories × a 2-month `competence_date` window, `.limit(100)` added defensively) and is never summed into a financial total client-side (only used for day-of-month/status/amount-diff comparisons) — a structurally different risk profile. Documented inline in the hook's header comment.
- **`shouldNudgeClose`'s valor≠anterior signal requires an existing previous-competence row to fire** — if there's no M-competence placeholder row for a category yet, the signal doesn't fire on its own (avoids a false-positive nudge on a brand-new category with no history).

## Deviations from Plan

None beyond the TDD-gate self-correction documented above (which is process compliance, not a deviation from the plan's design). Plan executed exactly as written: `dreRegime.ts`/`dreRegime.test.ts` cover behaviors A-E exactly as specified, `useMLCostWaterfall.ts` is purely additive, and both new hooks match the exact signatures/query-key shapes/RLS-reliance the plan specified.

## Issues Encountered

None beyond the TDD sequencing self-correction (caught and fixed before proceeding to Task 2 — no wasted downstream work).

## Verification

- `npx vitest run src/lib/dreRegime.test.ts` → **18/18 green** (behaviors A-E, including all 3 nudge signals firing independently + none-firing → false + missing-category → false).
- `npx tsc --noEmit` → **clean** (0 errors).
- `npx vitest run` (full suite) → **555/555 green**, including `dreCascade.test.ts`'s junho/2026 fixture (`totalOperacionalDeducoes=53030`, `resultadoLiquido=126943`) unchanged — proves SC6 (no regression on `get_dre_operational_by_competence`/`get_cashflow`/DFC, since neither this plan nor 94-01 touched them).

## Reconciliation Numbers (junho/2026, per Test D)

- CMV cheio: `133264.87` (`get_cost_waterfall.cmv_cheio`, threaded through Task 2).
- Guia real fixture used in the test: ICMS `5151.56` + PIS `716.19` + COFINS `3298.87` = `9166.62` (`toBeCloseTo(9166.62, 2)` — float-precision safe per Pitfall 5).
- Never-mix proof: same fixture asserted to NEVER equal `cmvMedio=110613.42` or `totalTaxEstimado=53327.05` when regime=apuracao, and NEVER equal `cmvCheio`/guia-sum when regime=previsao.

## User Setup Required

None - no external service configuration required. No new npm packages (matches the plan's `<threat_model>` T-94-SC disposition).

## Next Phase Readiness

- `dreRegime.ts`/`useDreMonthClose`/`useImpostoGuiaReal`/`useImpostoGuiaNudge`/`useMLCostWaterfall.cmv_cheio` are all ready to be wired into `MercadoLivre.tsx`/`MLCostCard.tsx` in Plan 94-03 (the regime pill, close/reopen button, and the empurrãozinho hint) — zero UI change shipped in this plan, exactly as scoped.
- No blockers. `useImpostoGuiaReal`/`useImpostoGuiaNudge` assume `get_imposto_guia_by_competence` and `cash_outflows.competence_date` are live/populated in prod (confirmed live per 94-CONTEXT.md `<db_reality>` — not re-verified by this plan since it makes no DB calls in its own tests).

---
*Phase: 94-dre-regime-previsao-apuracao-imposto-real-cmv-cheio-no-fecha*
*Completed: 2026-07-11*
