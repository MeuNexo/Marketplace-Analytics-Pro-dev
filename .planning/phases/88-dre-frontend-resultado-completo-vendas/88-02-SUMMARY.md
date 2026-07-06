---
phase: 88-dre-frontend-resultado-completo-vendas
plan: 02
subsystem: ui
tags: [react, tailwind, popover, dre, mlcostcard]

requires:
  - phase: 88-dre-frontend-resultado-completo-vendas
    plan: 01
    provides: "computeResultadoLiquido/DreOperationalBlocks (src/lib/dreOperational.ts) + useDreOperational(month) hook"
provides:
  - "/vendas 'DRE do Mês' card renders the full waterfall down to Resultado líquido"
  - "MercadoLivre.tsx wires useDreOperational(billingMonthFrom) into MLCostCard"
affects: []

tech-stack:
  added: []
  patterns:
    - "Popover+HelpCircle 'aproximado' info tooltip (copied from KPICard.tsx) reused for a financial line's data-quality caveat"

key-files:
  created: []
  modified:
    - src/pages/MercadoLivre.tsx
    - src/components/mercadolivre/MLCostCard.tsx

key-decisions:
  - "Resultado líquido reuses MLCostCard's existing internal `lucro` var (no second margin source, no re-derivation)"
  - "Operational section renders only when dreOperational or dreOperationalLoading is truthy — skeleton rows while loading, honest R$0 rows for zero-spend blocos (no special empty state, per CONTEXT scope)"
  - "Single responsive JSX tree — no mobile-only branch added (RESEARCH anti-pattern for MLCostCard)"

requirements-completed: [DRE-88-01, DRE-88-02, DRE-88-03]

duration: 15min
completed: 2026-07-06
status: complete
---

# Phase 88 Plan 02: DRE Resultado Líquido UI Wiring Summary

**`/vendas` "DRE do Mês" card now shows the full waterfall — (−) Pessoal/Estrutura/Serviços/Outros = Resultado operacional, (−) Financeiro [aproximado ⓘ] = Resultado líquido — driven by `useDreOperational(billingMonthFrom)` and the tested `computeResultadoLiquido` from Plan 01.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-06T22:31:30Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments
- `MercadoLivre.tsx` calls `useDreOperational(billingMonthFrom)` (the DRE card's own ‹ › month navigator — never `currentFrom`/`currentTo`, the page's separate date-range filter) and threads `dreOperational`/`dreOperationalLoading` into `MLCostCard`.
- `MLCostCard.tsx` extended with `dreOperational?: DreOperationalBlocks | null` / `dreOperationalLoading?: boolean` props, and a new section appended immediately after the existing "Lucro do mês" row: (−) Pessoal, (−) Estrutura, (−) Serviços, (−) Outros, "= Resultado operacional" subtotal, (−) Financeiro (with "aproximado" Popover+HelpCircle tooltip when `financeiro_is_approximate`), and "= Resultado líquido" total row (TrendingUp/TrendingDown + `text-kpi-positive`/`text-kpi-negative`, mirroring "Lucro do mês"'s exact structure).
- `computeResultadoLiquido(lucro, dreOperational)` is called with the component's pre-existing `lucro` variable — no second call to `useMLCostWaterfall`, confirmed by `git diff` showing zero new occurrences of that hook.
- Pulse-skeleton rows render for the new section while `dreOperationalLoading` is true and no data has arrived yet, avoiding a blank gap.
- Everything lives inside the single existing responsive JSX tree (no new mobile-only branch).

## Task Commits

1. **Task 1: Call useDreOperational in MercadoLivre.tsx and pass props to MLCostCard** - `f81cff9f` (feat)
2. **Task 2: Render the operational section + Resultado líquido + Financeiro badge in MLCostCard** - `51b61f08` (feat)

## Files Created/Modified
- `src/pages/MercadoLivre.tsx` - imports + calls `useDreOperational(billingMonthFrom)`, passes `dreOperational`/`dreOperationalLoading` to `MLCostCard`
- `src/components/mercadolivre/MLCostCard.tsx` - new props, `computeResultadoLiquido` call reusing existing `lucro`, new operational section JSX (Pessoal/Estrutura/Serviços/Outros → Resultado operacional → Financeiro [aproximado] → Resultado líquido)

## Decisions Made
- Kept the new section inline in `MLCostCard.tsx` rather than extracting a child component (per RESEARCH Open Question 1 recommendation — tightly coupled to the file's own `fmt`/`pct` helpers).
- "Aproximado" rendered as small italic text + a `Popover`/`HelpCircle` info trigger next to the Financeiro label (copies `KPICard.tsx` lines 96-119 exactly: hover+click toggle, `aria-label`, `onOpenAutoFocus` prevented).
- Gated the whole operational section's visibility on `dreOperational || dreOperationalLoading` rather than unifying it with the outer card's `loading` prop — lets the margin rows render immediately while the operational rows independently skeleton-load (RESEARCH Open Question 2, option (b)).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Verification Results

- `npx tsc --noEmit` — clean, no new errors.
- `npx vitest run` — full suite green: **29 test files, 418 tests passed** (including the 11 new tests from Plan 01).
- `grep -c "computeResultadoLiquido" src/components/mercadolivre/MLCostCard.tsx` → 2
- `grep -c "Resultado líquido" src/components/mercadolivre/MLCostCard.tsx` → 4
- `grep -c "text-kpi-negative" src/components/mercadolivre/MLCostCard.tsx` → 2
- `grep -c "useDreOperational(billingMonthFrom)" src/pages/MercadoLivre.tsx` → 1
- Confirmed via `git diff` that no new `useMLCostWaterfall` call was added (margin reused, not re-derived).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Wave 3 (orchestrator-driven: Vercel preview + Wesley's visual ok light/dark/mobile + merge) can proceed. No blockers from this wave; the /vendas DRE now visually completes the milestone's core requirement (resultado líquido shown), pending only human visual sign-off.

## Self-Check: PASSED

Both modified files verified present on disk; both task commits (f81cff9f, 51b61f08) verified in git log.

---
*Phase: 88-dre-frontend-resultado-completo-vendas*
*Completed: 2026-07-06*
