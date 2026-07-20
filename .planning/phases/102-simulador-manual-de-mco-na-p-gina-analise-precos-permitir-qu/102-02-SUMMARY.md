---
phase: 102-simulador-manual-de-mco-na-p-gina-analise-precos-permitir-qu
plan: 02
subsystem: ui
tags: [react, typescript, vitest, mco, waterfall, what-if-simulator]

# Dependency graph
requires:
  - phase: 102-01
    provides: "computeSimulatedWaterfall pure function + SimulatedInputs/SimulatedWaterfall types — the recompute engine this plan wires into the UI"
provides:
  - "Toggle 'Simular' inside the existing Phase 101 'Detalhamento de MCO' card — turns the 6 waterfall rows into live-editable SimFields"
  - "SimField component: live recompute per keystroke + commit-time (blur/Enter) validation with toast.error + revert-to-last-valid"
  - "Dynamic semáforo (activeMcoPct/mcoHealthValue/mcoRole) that follows simCard while simulating, real waterfallCard otherwise"
  - "D-04 invariant preserved: computeMcoRecommendation(waterfallCard, targetMcoPct) call site untouched — recommendation never reacts to simulation"
  - "Reset lifecycle: 'Resetar' button + automatic reset on item/variação change (useEffect([selectedId, selectedSku]))"
affects: [102-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SimField: local draft-string state + seedKey prop (increments only on real external reseed — toggle ON / Resetar) to distinguish 'value changed because I typed it' from 'value changed because the parent re-seeded the whole draft' — this is the mechanism that makes commit-time revert (D-05) actually restore the computed value, not just the visible text"
    - "Tinted panel (bg-accent/5 border-accent/20) wraps the whole editable waterfall block while simulating=true, matching the 102-UI-SPEC.md non-collision rule between the 'simulation' accent chrome and the health-role semáforo colors"

key-files:
  created: []
  modified:
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.test.tsx

key-decisions:
  - "SimField tracks its own last-known-valid value via a ref, separate from the live `value` prop fed by simDraft — the plan's own draft text assumed onLiveChange 'never gets called with the invalid value at commit time,' which is false under live (ungated) recompute; fixed with an explicit lastValidRef + seedKey design (see Deviations)"
  - "onReject signature changed from `() => void` to `(lastValid: number) => void` so the parent can restore the exact simDraft field to the pre-invalid-edit number, not just cosmetically reset the input text"
  - "Comissão/Impostos edited as % (never R$), guarded by precoUnit > 0, mirroring mcoRecommendation.ts's existing derivation — prevents a stale flat R$ commission from surviving a simulated price change (Pitfall 2)"
  - "Ads SimField gated behind the same `incluirAds` condition as the real Ads Row, and seedFromReal forces adsUnit=0 when incluirAds is off (Pitfall 4)"

patterns-established:
  - "seedKey counter pattern for distinguishing self-triggered vs externally-triggered prop changes in a live-recompute + commit-validate input — reusable if a future phase needs the same live/validate synthesis on another multi-field editable panel"

requirements-completed: [D-01, D-02, D-03, D-04, D-05]

# Metrics
duration: 8min
completed: 2026-07-20
status: complete
---

# Phase 102 Plan 02: Simulador Manual de MCO — Wiring na UI Summary

**Toggle "Simular" inside the existing MCO waterfall card turns 6 fixed rows into live-editable SimFields with per-keystroke recompute of MC/MCO/semáforo, while the price-minimum/ACOS-alvo recommendation stays byte-identical to the real data (D-04 anchor invariant), and invalid input reverts via toast+ref-tracked last-valid-value (fixing a latent revert bug the plan's own draft text would have shipped).**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-20T00:25:32Z
- **Completed:** 2026-07-20T00:32:55Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- `SimField` component (module scope, sibling to `Row`): raw `<input>`, live `onLiveChange` per keystroke (D-04), commit-time (blur/Enter) validation with `sonner` `toast.error` + revert (D-05)
- `simulating`/`simDraft`/`simSeedKey` state + `seedFromReal`/`handleToggleSimular`/`handleResetar` handlers, always re-seeding from the *current* real `waterfallCard` (never a stale snapshot)
- `useEffect([selectedId, selectedSku])` resets `simulating`/`simDraft` on item/variação change (D-03)
- Header: `Switch`+`Label` "Simular" toggle, conditional "Simulando" `Badge` (accent-tinted) + "Resetar" `Button` (`RotateCcw`), `flex-wrap` for mobile parity
- Waterfall block wrapped in a tinted panel (`bg-accent/5 border-accent/20`) when simulating; all 6 fields (Receita/un, CMV, Comissão%, Frete, Impostos%, Ads — Ads gated by `incluirAds`) become `SimField`s; MC/un and MCO/un subtotal rows source from `simCard` when simulating
- `activeMcoPct`/`mcoHealthValue`/`mcoRole` now derive from `simCard.mcoPct` while simulating, real `waterfallCard.mcoPct` otherwise — dynamic semáforo (D-04)
- `computeMcoRecommendation(waterfallCard, targetMcoPct)` call site **unchanged** — verified by grep in acceptance criteria and by a dedicated D-04 regression test (recommendation text byte-identical before/after simulating with an edited price)
- New "Preço mínimo e ACOS-alvo continuam calculados..." caption shown only while simulating, making the anchor invariant visually legible
- 5 new tests in a `describe("modo Simular", ...)` block covering D-02/D-03/D-04(×2)/D-05; 2 Phase 101 tests unaffected (7/7 green)
- `tsc --noEmit` and `npm run build` clean throughout

## Task Commits

Each task was committed atomically:

1. **Task 1: SimField + estado de simulação + ciclo reset** - `d0c1106d` (feat)
2. **Task 2: Wire do waterfall editável, header, semáforo dinâmico e âncora D-04** - `eba1399c` (feat)
3. **Task 3: Estender PrecoPraticadoReport.test.tsx com o bloco "modo Simular"** - `33500d06` (test) — includes the Rule 1 bugfix below, since the bug was discovered by writing the D-05 test

## Files Created/Modified
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` - `SimField` component + simulation state/handlers/effect (Task 1); toggle/badge/Resetar header, editable waterfall panel, dynamic semáforo, D-04 anchor caption (Task 2); `seedKey` prop + `lastValidRef`-based revert fix on `SimField`, `simSeedKey` state (Task 3 bugfix)
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.test.tsx` - new `describe("modo Simular", ...)` with 5 tests; `vi.mock("sonner", ...)` added to assert `toast.error` calls

## Decisions Made
- Kept the % (not R$) editing convention for comissão/impostos exactly as D-01/RESEARCH.md Pattern 1 locked, deriving R$ display the same way `mcoRecommendation.ts` already does (`precoUnit > 0 ? ... : 0` guard)
- Chose a `seedKey` counter (incremented only inside `handleToggleSimular(true)`/`handleResetar`) over the plan's originally-sketched `useEffect([value])` resync, because the latter cannot distinguish "value changed because I just typed it" from "value changed because the whole draft was externally re-seeded" — see Deviations for the concrete bug this caused

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SimField's `onReject` no-op did not actually revert the computed value on invalid commit**
- **Found during:** Task 3, writing the D-05 test ("valor inválido (comissão > 100%) dispara toast.error e reverte o campo")
- **Issue:** The plan's Task 2 `<action>` text specified `onReject={() => {}}` with the rationale that "since `onLiveChange` was never called with the invalid value at commit time, `simDraft` already holds the last valid value." That rationale is false under D-04's *live, ungated* recompute: `onLiveChange` fires on every keystroke including the one that produces the eventually-invalid string (e.g. typing "150" into a comissão field capped at 100), so by blur time `simDraft.comissaoPct` was already `150`, not the pre-edit `10`. The original `useEffect([value])` resync (meant only for external reseeds — Resetar/toggle-ON/item-change) then compounded the bug: it fired on *every* keystroke-triggered `value` prop change too (since typing echoes back through `simDraft` → `value`), silently overwriting the field's own "last valid" tracking with the in-progress invalid number. First test run failed with `expected '150' to be '10'`.
- **Fix:** (1) `SimField` now tracks its own `lastValidRef` (last committed-valid value), updated only on a successful blur commit or on a real external reseed. (2) Replaced the `[value]`-keyed resync effect with a `seedKey: number` prop that increments *only* inside `handleToggleSimular(true)` and `handleResetar` (never per-keystroke) — this is the signal that distinguishes "the whole draft was re-seeded externally" from "I am the one who changed `value` by typing." (3) `onReject` signature changed from `() => void` to `(lastValid: number) => void`, and all 6 call sites now restore the exact field in `simDraft` to that last-valid number, so the computed waterfall/badge/MC-MCO rows revert correctly, not just the input's visible text.
- **Files modified:** `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx`
- **Verification:** New D-05 test passes (`toast.error` called with the exact copy + input value reverts to `"10"`); all other 6 tests in the file still green; `tsc --noEmit` and `npm run build` clean.
- **Committed in:** `33500d06` (Task 3 commit — the fix and the test that caught it were committed together, since the fix has no independent value without the regression test)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug)
**Impact on plan:** Required for D-05 correctness (the invariant the phase explicitly requires: invalid input must revert both the visible text AND the value feeding the calculation). No scope creep — same file, same feature, no new dependencies.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Simulator is fully wired and tested: toggle → editable panel → live recompute → commit validation → reset (Resetar + auto on item/variação change).
- `computeMcoRecommendation(waterfallCard, targetMcoPct)` call site is provably unchanged (grep + byte-identical regression test) — D-04 invariant safe for 102-03 or any future plan to build on top of.
- No blockers for 102-03.

---
*Phase: 102-simulador-manual-de-mco-na-p-gina-analise-precos-permitir-qu*
*Completed: 2026-07-20*
