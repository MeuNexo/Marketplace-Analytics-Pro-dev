# Phase 102: Simulador Manual de MCO — Pattern Map

**Mapped:** 2026-07-19
**Files analyzed:** 4 (1 new pure lib, 1 new test, 1 extended component, 1 extended component test)
**Analogs found:** 4 / 4

This phase is a pure frontend extension with zero new backend surface. RESEARCH.md and 102-UI-SPEC.md already did deep line-level analysis of the exact analogs — this file consolidates that into planner-ready pattern assignments with verified excerpts (re-verified directly against the repo, not just quoted from research).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/pricing/mcoSimulation.ts` (NEW) | utility (pure calc) | transform | `src/lib/pricing/mcoRecommendation.ts` | exact (same directory, same "pure lever function wrapping computeMco" shape) |
| `src/lib/pricing/mcoSimulation.test.ts` (NEW) | test | transform | `src/lib/mco.test.ts` / `src/lib/pricing/mcoRecommendation.test.ts` | exact |
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` (EXTENDED) | component | request-response (client-side recompute, no I/O) | itself (Phase 101 Meta MCO% inline-edit block, lines 604-622) + `SimuladorPrecificacao.tsx` (live recompute) | exact — this phase extends its own file's existing pattern |
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.test.tsx` (EXTENDED) | test | request-response | itself (existing 2-test file, Phase 101) | exact |

## Pattern Assignments

### `src/lib/pricing/mcoSimulation.ts` (utility, transform)

**Analog:** `src/lib/pricing/mcoRecommendation.ts` (verified read, lines 1-24) + `src/lib/mco.ts` (verified read, lines 1-19)

**Imports pattern** (mirror `mcoRecommendation.ts` lines 1-11):
```typescript
/**
 * [Docblock: purpose, zero-I/O guarantee, "reuses X, never reimplements Y" — same tone
 *  as mcoRecommendation.ts's docblock]
 */
import { computeMco } from "@/lib/mco";
```

**Core pure-function pattern** — mirror the shape of `computeMco` itself (`src/lib/mco.ts`):
```typescript
export interface McoInput {
  grossRevenue: number;
  cmv: number;
  platformCost: number; // frete + comissão — exclui ads
  ads: number;
  tax: number;
}
```
`computeMco` takes flat per-unit-agnostic numbers and returns `{ mco, pct }` with `pct: null` when `grossRevenue <= 0` — this null-guard convention MUST be preserved by the new `computeSimulatedWaterfall`.

**Percent-of-price derivation pattern** — copy verbatim from `mcoRecommendation.ts`'s R$→% derivation logic (same file, referenced at lines 43-44 per RESEARCH.md): guard every `x / precoUnit` with `precoUnit > 0 ? ... : 0` before dividing, mirroring the existing commissionPct derivation. Apply this same guard-then-derive pattern in reverse (%→R$) for `comissaoUnit`/`impostoUnit` in the new file.

**Full recommended implementation** — already fully drafted and verified in RESEARCH.md Pattern 1 (`src/lib/pricing/mcoSimulation.ts`, `SimulatedInputs`/`SimulatedWaterfall` interfaces + `computeSimulatedWaterfall` function, ~30 lines). Use it as-is; it correctly reuses `computeMco` as sole source of truth and never duplicates the MCO formula.

---

### `src/lib/pricing/mcoSimulation.test.ts` (test, transform)

**Analog:** `src/lib/mco.test.ts` (confirms `pct: null` zero-revenue guard test style) and `src/lib/pricing/mcoRecommendation.test.ts` (confirms lever-function test style)

**Test structure pattern:** plain `describe`/`it`, inline comments showing the underlying arithmetic, `toBeCloseTo` for floating-point assertions, explicit test cases for: normal simulation, `precoUnit = 0` (must return `mcoPct: null`, never `NaN`), negative-input passthrough (validation is the caller's job, not this pure function's — confirm the function itself does NOT reject negative numbers, only the UI layer does per D-05), comissão/imposto % boundary values (0 and 100).

---

### `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` (component, extended)

**Analog A — Meta MCO% inline-edit (same file, lines 604-622, verified):**
```typescript
const [editingMcoTarget, setEditingMcoTarget] = useState(false);
const [mcoTargetDraft, setMcoTargetDraft] = useState("");
const mcoTargetInputRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  if (editingMcoTarget) mcoTargetInputRef.current?.focus();
}, [editingMcoTarget]);

const commitMcoTargetEdit = async () => {
  const raw = mcoTargetDraft.trim().replace(",", ".");
  const parsed = Number(raw);
  if (raw === "" || isNaN(parsed) || parsed <= 0 || parsed > 100) {
    toast.error("Meta precisa ser maior que 0% e até 100%");
    setEditingMcoTarget(false);
    return;
  }
  setEditingMcoTarget(false);
  if (selectedId) await upsertMcoTarget(selectedId, selectedSku, parsed);
};
```
This is the **commit-time validation + `sonner` toast + revert** half of the required D-05 pattern. Copy the reject/toast/revert shape; but for the simulator, revert means "restore draft string AND restore the value feeding the live calc" (no async `upsertMcoTarget` call — everything stays local state, no backend).

**Analog B — "Incluir publicidade" Switch+Label pair (same file, lines 712-721, verified):**
```typescript
<div className="flex items-center gap-2 ml-auto">
  <Switch
    id="incluir-ads"
    checked={incluirAds}
    onCheckedChange={setIncluirAds}
  />
  <Label htmlFor="incluir-ads" className="text-xs text-muted-foreground cursor-pointer">
    Incluir publicidade
  </Label>
</div>
```
Copy this exact shape for the new "Simular" toggle (per 102-UI-SPEC.md section "Header row (extended)") — same `Switch`+`Label` pairing, same `text-xs text-muted-foreground cursor-pointer` classes on the label.

**Analog C — existing computed values wiring (same file, lines 590-599, verified):**
```typescript
const waterfallCard = useMemo(
  () => computeWaterfallCard(rows ?? [], { adsDaily, incluirAds, granularity }),
  [rows, adsDaily, incluirAds, granularity],
);
const mcoRecommendation = useMemo(
  () => computeMcoRecommendation(waterfallCard, targetMcoPct),
  [waterfallCard, targetMcoPct],
);
const mcoHealthValue = classifyMcoHealth(waterfallCard.mcoPct);
const mcoRole = mcoHealthRole(mcoHealthValue);
```
**Critical invariant (D-04):** `mcoRecommendation`'s `useMemo` deps and call MUST remain unchanged — always fed `waterfallCard` (real), never a simulated card. New code adds a **parallel, structurally separate** `simCard = useMemo(() => simDraft ? computeSimulatedWaterfall(simDraft) : null, [simDraft])` and a parallel `activeMcoPct = simulating && simCard ? simCard.mcoPct : waterfallCard.mcoPct` feeding `classifyMcoHealth`/`mcoHealthRole` for display — this is the only place real vs. simulated values are allowed to swap.

**Analog D — live recompute mechanics (`src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx`, Phase 50, in prod at `/precos-custos`):** free-form string state per field, `parseNumber()` from `src/lib/pricing/calculator.ts` parses pt-BR decimal-comma on every `onChange`, pure calc invoked directly in render — no validation/toast (that half comes from Analog A instead). Import `parseNumber` from `@/lib/pricing/calculator` (already an existing export, no new file).

**Full synthesized field component** (combining Analog A's commit-validation with Analog D's live-recompute) — already fully drafted and verified in RESEARCH.md Pattern 2 (`SimField` component) and locked exactly by 102-UI-SPEC.md's "Interaction Contract" section (input classes, toast copy, keyboard behavior). Use that draft as the implementation baseline; it is the authoritative synthesis, not a generic suggestion.

**Reset/lifecycle pattern** — mirror the existing `selectedSku` reset effect already in this file (referenced in RESEARCH.md as lines 290-292) for the new `useEffect([selectedId, selectedSku]) => { setSimulating(false); setSimDraft(null); }` (D-03 auto-reset).

**Error handling:** No try/catch needed — this is pure synchronous client-side arithmetic, no I/O. The only "error" path is D-05 validation rejection, handled via `toast.error(...)` + revert (Analog A shape), not exceptions.

---

### `src/components/mercadolivre/anuncios/PrecoPraticadoReport.test.tsx` (test, extended)

**Analog:** itself (existing 2-test file, Phase 101, mocks `@/integrations/supabase/client`, `@/contexts/MLInventoryContext`, `@/hooks/useMcoTargets`)

**Pattern:** Add a new `describe("modo Simular", ...)` block reusing the exact same fixture/mock setup already in the file. Drive the toggle and inputs via `@testing-library/react` `fireEvent`/`userEvent`; assert: (1) waterfall rows swap to editable inputs when toggle is ON, (2) semáforo `Badge` text/class changes as simulated inputs change, (3) recommendation numbers (preço mínimo, ACOS-alvo) remain **byte-identical** before/after simulating (this is the D-04 regression test that matters most), (4) toast fires and value reverts on invalid input (D-05), (5) switching `selectedId`/`selectedSku` resets `simulating` to `false` (D-03).

---

## Shared Patterns

### MCO formula — single source of truth
**Source:** `src/lib/mco.ts` (`computeMco`, `McoInput`/`McoResult`, verified lines 1-19)
**Apply to:** `mcoSimulation.ts` only — call `computeMco` directly, never reimplement `mco = grossRevenue - cmv - platformCost - ads - tax`.

### Semáforo classification — single source of truth
**Source:** `src/lib/mcoHealth.ts` (`MCO_SAUDAVEL_PCT`, `classifyMcoHealth`, `mcoHealthRole`, verified lines 1-19: red ≤5, green ≥9, yellow between, null/undefined → neutral, never invented)
**Apply to:** `PrecoPraticadoReport.tsx` — reuse unchanged for both real and simulated `mcoPct`, never a second copy of the thresholds.

### pt-BR numeric parsing
**Source:** `parseNumber` in `src/lib/pricing/calculator.ts` (already used by `SimuladorPrecificacao.tsx`)
**Apply to:** every `SimField` in `PrecoPraticadoReport.tsx` — handles `"1.234,56"` → `1234.56`, degrades invalid input to `0` on live parse (never throws), reused unchanged, no new parser.

### Toast validation pattern (sonner)
**Source:** `commitMcoTargetEdit` in `PrecoPraticadoReport.tsx` (verified lines 612-622)
**Apply to:** each `SimField`'s `onBlur` handler — same shape (parse → validate range → `toast.error(...)` + revert draft string on invalid, else commit).

### R$↔% derivation guard
**Source:** `src/lib/pricing/mcoRecommendation.ts` (commissionPct derivation, R$→%, referenced lines 43-44)
**Apply to:** `mcoSimulation.ts` (%→R$ direction, `comissaoPct`/`impostoPct` → `comissaoUnit`/`impostoUnit`) — always guard with `precoUnit > 0 ? ... : 0` to avoid `NaN`/`Infinity` (Pitfall 5 in RESEARCH.md).

## No Analog Found

None — every file in scope has a strong, directly-verified analog already in the same directory or same file. No backend files are in scope (explicitly forbidden by CONTEXT.md/RESEARCH.md).

## Metadata

**Analog search scope:** `src/lib/`, `src/lib/pricing/`, `src/components/mercadolivre/anuncios/`, `src/components/mercadolivre/precificacao/`
**Files scanned/verified directly:** `src/lib/mco.ts`, `src/lib/mcoHealth.ts`, `src/lib/pricing/mcoRecommendation.ts`, `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` (targeted line ranges: 1-25, 590-625, 705-725)
**Pattern extraction date:** 2026-07-19
**Note:** RESEARCH.md for this phase already performed exhaustive line-cited codebase analysis (function signatures, existing tests, pitfalls) — this PATTERNS.md cross-verifies the highest-leverage excerpts directly against the repo and reformats them for planner consumption; it does not duplicate RESEARCH.md's full narrative.
