---
phase: 94-dre-regime-previsao-apuracao-imposto-real-cmv-cheio-no-fecha
plan: 03
subsystem: fiscal / DRE regime switch (frontend UI wiring)
tags: [react, dre, cmv-cheio, imposto-real, mlcostcard, ui]

# Dependency graph
requires:
  - phase: 94-02
    provides: "src/lib/dreRegime.ts (resolveDreRegime/shouldNudgeClose/monthPlusOne), useDreMonthClose, useImpostoGuiaReal/useImpostoGuiaNudge, useMLCostWaterfall.cmv_cheio"
provides:
  - "Regime-aware DRE card on /vendas: cmvMes/impostosMes derived from resolveDreRegime at the MercadoLivre.tsx injection point"
  - "MLCostCard regime pill (Previsão amber / Apurado emerald) + owner-only close/reopen button + empurrãozinho hint"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Regime wiring composed at the same seam Phase 88 already used (cmvMes/impostosMes), no new composition layer introduced"
    - "Owner-only mutation button clones the ReplenishmentParamsDialog/ml_tax_config convention: frontend gate is UX-only, RLS (94-01) is the real authority"
    - "New MLCostCard props are all optional with safe defaults — every other caller of MLCostCard is unaffected"

key-files:
  created: []
  modified:
    - src/pages/MercadoLivre.tsx
    - src/components/mercadolivre/MLCostCard.tsx

key-decisions:
  - "closeBusy wired to monthClose.isMutating (the hook's actual single busy flag) instead of the plan's literal isClosing/isReopening — useDreMonthClose (94-02) only exposes isMutating; same semantics, no behavior change"
  - "Added toast.error (sonner) around close()/reopen() mutateAsync calls — not explicitly in the plan's action text, but MercadoLivre.tsx has no other error surface for a failed owner mutation; follows the ReplenishmentParamsDialog/ml_tax_config toast convention already established elsewhere in this repo (Rule 2 — missing critical error handling on a write path)"
  - "Owner button additionally disabled when the corresponding handler (onClose/onReopen) is undefined, defense-in-depth against a future caller passing canClose=true without wiring both handlers"
  - "Regime pill placed inline next to the existing fonte pill in the header; owner button + empurrãozinho hint placed in a new row below the header (same slot pattern as the existing fonte=billing invoice-window row), avoiding header overcrowding"

requirements-completed: [SC4]

# Metrics
duration: ~15min
completed: 2026-07-11
status: complete
---

# Phase 94 Plan 03: DRE Regime UI Wiring (regime pill + owner close/reopen + empurrãozinho) Summary

Wired the 94-02 regime resolver into `MercadoLivre.tsx`'s existing `cmvMes`/`impostosMes` injection point (provably byte-identical while the month is open) and extended `MLCostCard` with a regime pill, an owner-only "marcar mês como apurado"/"reabrir mês" button, and the green empurrãozinho hint — all cloning the card's existing badge/Tooltip/button idiom, zero new components or colors.

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-11T13:03:53Z (session start, includes reading Wave 1/2 context)
- **Completed:** 2026-07-11T13:18:16Z
- **Tasks:** 2 auto tasks (Task 3 is the phase-level human-verify checkpoint, not executed by this agent)
- **Files modified:** 2

## Accomplishments

- **`src/pages/MercadoLivre.tsx`:**
  - `orgRole` added to the `useOrganization()` destructure; `canClose = orgRole === "owner"`.
  - `dreSaleMonth` computed on the exact same axis `dreWaterfall` already uses (`billingMonthIsCurrentMonth ? monthlyFrom : billingMonthFrom`).
  - `useDreMonthClose(dreSaleMonth)`, `useImpostoGuiaReal(dreSaleMonth)`, `useImpostoGuiaNudge(dreSaleMonth)` instantiated.
  - Legacy `cmvMes`/`impostosMes` assignment replaced by a single `resolveDreRegime({...})` call feeding both — while the month is open (`monthClose.isClosed === false`) the resolver's previsão branch reproduces the prior expression exactly (proven in 94-02's tests: same `hasCmv ? cmvMedio : null ?? null` / `hasTaxData ? totalTaxEstimado : null ?? null` shape), so `margemContribuicao`/`buildDreCascade` downstream are untouched.
  - `nudgeClose` (via `shouldNudgeClose`), `guiaCompetenceLabel` (MM/YYYY of `monthPlusOne(dreSaleMonth)`), and `handleCloseDreMonth`/`handleReopenDreMonth` (owner mutations with `sonner` toast on error) computed and passed to `MLCostCard` as new props — no existing prop removed.
- **`src/components/mercadolivre/MLCostCard.tsx`:**
  - 8 new optional props (`regime`, `mesClosed`, `guiaCompetenceLabel`, `canClose`, `nudgeClose`, `onClose`, `onReopen`, `closeBusy`), all defaulted so every other caller renders unchanged.
  - Regime pill added inline next to the existing `fonte` pill in the card header: amber "Previsão" / emerald "Apurado — guias de MM/YYYY", same badge-span classes as the `fonte` pill.
  - New conditional row below the header (visible only when `canClose` or the nudge is showing): empurrãozinho hint (🟢 + Tooltip explainer, clones the `doubleCountRisk` Tooltip/HelpCircle idiom) and the owner-only close/reopen `<button>` (clones the header's prev/next-month native-button styling, `Loader2` spinner clones the existing `syncing` indicator).

## Task Commits

1. **Task 1: Regime wiring in MercadoLivre.tsx (no-op when open)** — `fab5b9d6` (feat)
2. **Task 2: Regime pill + owner button + empurrãozinho in MLCostCard** — `a8242d14` (feat)

**Plan metadata:** (this commit, following this Summary)

## Files Created/Modified

- `src/pages/MercadoLivre.tsx` — regime wiring at the `cmvMes`/`impostosMes` injection point; owner handlers
- `src/components/mercadolivre/MLCostCard.tsx` — regime pill, owner-only close/reopen button, empurrãozinho hint

## Decisions Made

- `closeBusy` wired to `monthClose.isMutating` (the actual single busy flag `useDreMonthClose` exposes) rather than the plan text's literal `isClosing || isReopening`, which don't exist on the 94-02 hook. Same UX outcome (button disabled + spinner during either mutation).
- Added `toast.error` (sonner) around both `close()`/`reopen()` calls — the plan's action text didn't specify error UX, but a silent failure on an owner-only financial-state mutation would leave the button appearing to do nothing; this matches the `ReplenishmentParamsDialog`/`ml_tax_config` convention already established in this repo for owner mutations (Rule 2 — auto-add missing critical error handling).
- Owner button `disabled` also guards against a missing handler (`mesClosed ? !onReopen : !onClose`) as defense-in-depth, since both handlers are optional props.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `closeBusy` prop source didn't exist on the 94-02 hook**
- **Found during:** Task 1
- **Issue:** Plan's action text specified `closeBusy={monthClose.isClosing || monthClose.isReopening}`, but `useDreMonthClose` (94-02) only exposes a single `isMutating` flag, not separate `isClosing`/`isReopening`.
- **Fix:** Used `monthClose.isMutating` — identical UX (button disabled + spinner while either mutation is in flight), no behavior change intended by the plan.
- **Files modified:** `src/pages/MercadoLivre.tsx`
- **Commit:** `fab5b9d6`

**2. [Rule 2 - Missing critical functionality] No error handling on owner close/reopen mutations**
- **Found during:** Task 1
- **Issue:** `monthClose.close()`/`monthClose.reopen()` are `mutateAsync` calls; calling them bare would silently swallow a rejected promise (e.g. RLS denial, network error) with no user feedback — the owner would click the button and see nothing happen.
- **Fix:** Wrapped both in `handleCloseDreMonth`/`handleReopenDreMonth` with try/catch → `toast.error(...)`, matching the existing `toast.error("Permissão negada"...)` / `toast.error("Erro ao salvar"...)` convention in `ReplenishmentParamsDialog.tsx`.
- **Files modified:** `src/pages/MercadoLivre.tsx`
- **Commit:** `fab5b9d6`

## Auth Gates

None encountered — no external service configuration required for this plan (no EF deploy, no new secrets).

## Issues Encountered

None beyond the two Rule 2/3 auto-fixes documented above.

## Verification

- `npx tsc --noEmit` → clean (0 errors), after both Task 1 and Task 2.
- `npx vitest run` (full suite) → **555/555 green**, including `dreCascade.test.ts`'s junho/2026 fixture and `dreRegime.test.ts`'s 18 previsão/apuração/never-mix/nudge tests — unchanged, proving the UI wiring introduced no regression in the pure math layer (SC6).
- `npm run build` → clean production build (16.69s), no new warnings.
- Regime pill (`regime`), owner gate (`canClose`), and nudge (`nudgeClose`) all present in `MLCostCard.tsx` (plan's grep checks); `resolveDreRegime(`, `useDreMonthClose(`, `useImpostoGuiaNudge(` all present in `MercadoLivre.tsx`.

## Human-Verify Checkpoint (Task 3) — NOT YET PERFORMED

Task 3 in the plan is `type="checkpoint:human-verify"` gated on Wesley confirming the junho/2026 reconciliation live on `/vendas` (previsão unchanged, apuração reconciles CMV cheio + guia de julho, owner-only button, non-owner sees no button, empurrãozinho is a hint only). Per this plan's `autonomous: false` framing, this checkpoint is a phase-level human-verify step, not something this execution agent can complete without Wesley's live confirmation — it is intentionally left **pending** and should be surfaced to Wesley by the orchestrator/phase-completion step, not silently marked done.

**How to verify (from the plan):**
1. Open `/vendas` as owner of Pé Vermeio, navigate the DRE card to Junho/2026.
2. Confirm Previsão (amber) unchanged from the 2026-07-10 validated numbers.
3. Click "Marcar mês como apurado" → confirm emerald "Apurado — guias de 07/2026", CMV switches to cheio (~R$133.264,87), imposto switches to the real M+1 guia (ICMS de julho R$5.151,56 + PIS/COFINS), not the June guia.
4. Click "Reabrir mês" → confirm return to Previsão.
5. Confirm a non-owner session sees the pill but no close/reopen button.
6. If the 3 guias for the displayed month left the placeholder, confirm the green empurrãozinho hint shows and does not auto-close.

## Known Stubs

None. All wired data flows from live hooks (94-01 table, 94-02 hooks/RPC) — no hardcoded/placeholder values introduced.

## Threat Flags

None beyond what the plan's own `<threat_model>` already covers (T-94-06 elevation-of-privilege via the hidden button, mitigated by RLS from 94-01; T-94-07 nudge-auto-close, mitigated by the nudge being strictly display-only — verified in this implementation: `onClose`/`onReopen` are only ever invoked by the button's `onClick`, never from the nudge-hint render branch).

## User Setup Required

None — no new npm packages, no new external service configuration.

## Next Phase Readiness

- All implementation tasks for Phase 94 are complete across 94-01 (schema+RLS), 94-02 (data layer), 94-03 (UI wiring).
- **Pending:** Wesley's live human-verify checkpoint (Task 3 of this plan) on `/vendas` for junho/2026 — this is the phase's closing gate, not a blocker for any further plan.
- No blockers for closing the phase once Wesley confirms.

---
*Phase: 94-dre-regime-previsao-apuracao-imposto-real-cmv-cheio-no-fecha*
*Completed: 2026-07-11*

## Self-Check: PASSED

- Files exist: `src/pages/MercadoLivre.tsx`, `src/components/mercadolivre/MLCostCard.tsx`, this SUMMARY.md — all FOUND.
- Commits exist: `fab5b9d6`, `a8242d14` — all FOUND in git log.
