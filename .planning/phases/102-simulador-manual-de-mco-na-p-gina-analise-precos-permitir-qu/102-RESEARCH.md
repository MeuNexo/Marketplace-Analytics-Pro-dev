# Phase 102: Simulador manual de MCO na página /analise-precos - Research

**Researched:** 2026-07-19
**Domain:** Client-side "what-if" recompute over an existing pure-calculation library (React/TypeScript, zero backend)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Campos editáveis**
- **D-01:** Todos os campos do waterfall são editáveis durante a simulação: preço/un, CMV/un, comissão%, frete/un, impostos%, ads/un (ads só aparece se o toggle "incluir ads" da Phase 79 estiver ligado, mesma regra já usada no card real).

**Onde e como ativar**
- **D-02:** O simulador vive **dentro do mesmo card fixo** da Phase 101 (não é uma seção nova nem uma página separada). Um toggle "Simular" liga o modo edição diretamente nos campos do waterfall existente. Desligado = mostra os valores reais (comportamento atual da Phase 101, intocado). Ligado = cada linha do waterfall vira um campo editável.

**Reset**
- **D-03:** Existe um botão "Resetar" explícito que volta todos os campos aos valores reais correntes. Além disso, **trocar de item/variação no seletor sempre reseta a simulação automaticamente** (evita o usuário confundir simulação de um anúncio com os valores exibidos de outro).

**Recálculo em cascata**
- **D-04:** Com o modo Simular ligado, o **semáforo de saúde e o MC/MCO recalculam com os valores simulados** (o usuário vê o impacto completo, inclusive o semáforo mudando de cor). As **duas linhas de recomendação (preço mínimo e ACOS-alvo) continuam calculadas sobre a Meta MCO% e os custos/preço REAIS** — não fazem sentido recalculadas sobre um preço que já está sendo simulado (seria circular). Ou seja: waterfall + semáforo = dinâmico com a simulação; recomendação = âncora fixa de referência.

**Validação**
- **D-05:** Os campos simulados seguem o **mesmo padrão de validação já usado no campo Meta MCO%** da Phase 101 (toast de erro via `sonner`, rejeita valor inválido e mantém o anterior): preço/CMV/frete/ads ≥ 0; comissão%/impostos% entre 0 e 100.

### Claude's Discretion
- Layout exato dos inputs (inline no lugar do valor atual da linha, vs. campo ao lado) — seguir o padrão de edição inline já usado no card (Meta MCO%) e em `MLAnuncios.tsx` (`InlineEditCell`).
- Texto/copy exato do toggle, botão Resetar e labels de campo editável.
- Formato de input (texto formatado em R$/% vs. número puro com máscara) — usar o padrão já validado no campo Meta MCO% da Phase 101.
- Comportamento de foco/teclado (Tab entre campos, Enter confirma) — seguir convenção de formulários já usada no projeto (react-hook-form onde aplicável).
- Indicação visual de "isto é uma simulação" (badge, cor de fundo diferente, ícone) para não confundir com os dados reais — importante para não o usuário achar que gravou algo.

### Deferred Ideas (OUT OF SCOPE)
- Salvar/nomear cenários de simulação (ex: "Cenário A", "Cenário B") para comparar depois — fora de escopo, simulação é sempre efêmera e single-slot nesta phase.
- Comparação lado a lado entre múltiplos itens simulados simultaneamente — mantido fora de escopo (mesma decisão da Phase 101 de página single-item).
- Recalcular a recomendação (preço mínimo/ACOS-alvo) em cima dos valores simulados — decidido explicitamente como fora de escopo (D-04): geraria referência circular/confusa.

**No backend.** CONTEXT.md is explicit: "Nenhum backend novo... Se o planner identificar necessidade de gravar algo, isso quebra D-01-a-D-05 e deve ser sinalizado para revisão de escopo, não implementado silenciosamente." Do not add a migration, RPC, or table for this phase.
</user_constraints>

## Summary

This phase is a pure frontend addition with **zero new dependencies, zero new backend surface, and zero changes to the canonical MCO formula**. It extends the Phase 101 "Detalhamento de MCO" card (already live inside `PrecoPraticadoReport.tsx`) with a component-local "what-if" mode.

**The hard technical question is answered by reading `computeMco`'s actual signature:** `computeMco(input: McoInput): McoResult` is a five-term linear formula (`mco = grossRevenue − cmv − platformCost − ads − tax`, `pct = mco/grossRevenue×100`) with **no internal aggregation, no `rows`/`qtd` dependency, and no unit assumption** — it works identically whether you feed it period totals (as `computeWaterfallCard` does today) or single-unit values (as the simulator needs). This means **`computeWaterfallCard` in `src/lib/precoMcoSeries.ts` needs zero changes and no "overrides" parameter.** The simulator is pure component-local state that calls `computeMco` directly (or, better, a small new pure wrapper function — see Pattern 1) with the user's edited per-unit numbers. `computeMcoRecommendation` also needs zero changes — it already takes a `WaterfallCard` argument from the caller, and the existing call site (`PrecoPraticadoReport.tsx` line 595-598) already always passes the real `waterfallCard`; the plan simply must **not** rewire that call to a simulated card.

**A second, non-obvious finding materially changes the input UX design:** the codebase already has TWO different established patterns for "type a number, see it recompute," and they are NOT the same pattern D-05 asks for:
1. **`SimuladorPrecificacao.tsx` + `parseNumber()`** (`src/lib/pricing/calculator.ts`, Phase 50, live in prod at `/precos-custos`) — free-form string state per field, `parseNumber()` parses on *every keystroke* (pt-BR decimal comma, degrades invalid input to `0`, never rejects, never shows a toast), and the pure calc (`computePricing`) is called directly in the render body. This is the actual precedent for "recalcula a cada digitação" (its own copy, verbatim).
2. **Meta MCO% field / `InlineEditCell`** (`PrecoPraticadoReport.tsx` lines 604-622, `MLAnuncios.tsx` lines 156-203) — draft-string state, commits **only on blur/Enter**, and on commit does hard validation with a `sonner` toast + revert-to-previous-value on invalid input. This is the pattern the phase's D-05 explicitly locks.

These two patterns are *individually* insufficient for this phase: (1) alone would violate D-05 (no validation/toast/revert-on-invalid); (2) alone would violate D-04 ("recalculam em tempo real" — real-time, not on-blur). **The plan needs a synthesis**: parse and recompute live on every keystroke (borrowing mechanics from pattern 1), but perform the D-05 hard-validation-with-toast-and-revert only at the commit point (blur/Enter, borrowing pattern 2) — see Pattern 2 below for the exact shape.

**Primary recommendation:** No `precoMcoSeries.ts` changes. Add one new pure function `computeSimulatedWaterfall` (in a new small file, e.g. `src/lib/pricing/mcoSimulation.ts`, mirroring the existing `mcoRecommendation.ts` sibling) that takes per-unit inputs (comissão/imposto as %, everything else as R$) and calls `computeMco` directly — table-driven-testable exactly like every other pure function in this codebase. Wire it into `PrecoPraticadoReport.tsx` as local `useState` + a `useMemo`-derived simulated card, gated by a `simulating` boolean, reset by a `useEffect` keyed on `[selectedId, selectedSku]` (same lifecycle the file already uses for `selectedSku`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Toggle "Simular" on/off | Browser/Client | — | Pure UI state (`useState`), no data dependency |
| Editable waterfall inputs (preço, CMV, comissão%, frete, impostos%, ads) | Browser/Client | — | Ephemeral form state; CONTEXT.md explicitly forbids any backend surface for this |
| Simulated MC/MCO recompute | Browser/Client | — | Pure arithmetic (`computeMco`), zero I/O, exists entirely in the already-loaded `WaterfallCard`-shaped local state |
| Semáforo recoloring (simulated) | Browser/Client | — | `classifyMcoHealth`/`mcoHealthRole` are pure functions already imported by the component; reused unchanged with the simulated `mcoPct` |
| Recommendation (preço mínimo / ACOS-alvo) | Browser/Client | — | Stays anchored to `computeMcoRecommendation(waterfallCard /* REAL */, targetMcoPct)` — untouched call site, no new tier involvement |
| Reset on item/variação change | Browser/Client | — | `useEffect([selectedId, selectedSku])`, same pattern already used to reset `selectedSku` on `selectedId` change |
| Meta MCO% persistence (existing, Phase 101) | Browser/Client | API/Backend (`ml_mco_targets` via `useMcoTargets`) | Unaffected by this phase — the simulator never touches this table |

There is **no API/Backend tier involvement anywhere in this phase's new code.** If a plan introduces one (table, RPC, EF), that is an out-of-scope violation per CONTEXT.md and must be flagged, not built.

## Standard Stack

### Core
No new libraries. The phase reuses exactly what's already imported in `PrecoPraticadoReport.tsx` and its sibling `src/lib/` files.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | 18.3.1 (existing) | `useState`/`useMemo`/`useEffect` for local sim state | Already the component's state model |
| sonner | 1.7.4 (existing) | `toast.error(...)` on invalid simulated input | Same import already used for Meta MCO% validation (line 4, 616) |
| lucide-react | existing | Icon for "simulando" badge/indicator (discretion) | Already imported (`Target`, `AlertTriangle`, etc.) |

### Supporting
None needed — `@/components/ui/switch`, `@/components/ui/badge`, `@/components/ui/card` are already imported in the file.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain `useState` per field | `react-hook-form` (`useForm`) | CONTEXT.md discretion mentions RHF "onde aplicável," but the two closest analogs in this exact codebase (Meta MCO% inline-edit, `SimuladorPrecificacao`) **both** use plain `useState`, not RHF. RHF's page-level `useReducer`+form-submit model doesn't match a card-local ephemeral toggle with live per-keystroke recompute and a synchronous "revert on invalid" requirement — using it here would be inconsistent with the two nearest precedents and adds ceremony with no payoff (no real form submission, no multi-field cross-validation, no persistence). **Recommendation: do NOT use react-hook-form for this phase; use `useState`, matching both closest analogs.** |
| New pure function in `precoMcoSeries.ts` | New pure function in a new file `src/lib/pricing/mcoSimulation.ts` | `precoMcoSeries.ts` operates on `PrecoSeriesRow[]` + aggregation; the simulator has no rows to aggregate — it's a single already-per-unit input. Putting it in `precoMcoSeries.ts` would be a false analogy (see Pitfall 1 below). `src/lib/pricing/` already holds `calculator.ts` (whole-pricing-form pure calc) and `mcoRecommendation.ts` (recommendation-lever pure calc) — a third small sibling file for the simulation-lever pure calc matches the existing directory's granularity exactly. |

**Installation:** none — no `npm install` needed for this phase.

**Version verification:** N/A — no new packages.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero external packages. No `npm view`/`pip index`/`cargo search` verification was needed; the Package Legitimacy Gate is skipped per its own trigger condition ("Every phase that installs external packages").

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
PrecoPraticadoReport.tsx (component, unchanged data-fetch layer)
│
├─ rows (PrecoSeriesRow[]) ──► computeWaterfallCard(rows, opts) ──► waterfallCard (REAL, unchanged)
│                                                                          │
│                                                                          ├──► computeMcoRecommendation(waterfallCard, targetMcoPct)
│                                                                          │      = precoMinimo / acosMeta   (ALWAYS real — D-04 anchor)
│                                                                          │
│                                                                          └──► seeds initial sim draft when
│                                                                               "Simular" toggles ON / on Resetar
│
├─ [NEW] simulating: boolean (useState) ─────────────► gates: waterfall Row vs. <SimInput> render
│
├─ [NEW] simDraft: SimulatedInputs (useState)          per-unit user-entered values:
│         { precoUnit, cmvUnit, comissaoPct,             precoUnit/cmvUnit/freteUnit/adsUnit in R$,
│           freteUnit, impostoPct, adsUnit }              comissaoPct/impostoPct in %
│
├─ [NEW] simCard = useMemo(() =>                      pure fn, zero I/O — recomputed on EVERY
│         computeSimulatedWaterfall(simDraft),          keystroke that produces a parseable number
│         [simDraft])
│                    │
│                    ├──► classifyMcoHealth(simCard.mcoPct) ──► mcoHealthRole(...)  (simulated semáforo, D-04)
│                    │
│                    └──► rendered waterfall Rows (MC/un, MCO/un) when simulating=true
│
└─ [NEW] useEffect([selectedId, selectedSku]) → setSimulating(false) + reset simDraft
         (auto-reset on item/variação change, D-03)
```

The recommendation branch (top-right) and the simulation branch (bottom) are **structurally parallel and never cross** — this is the core invariant D-04 requires. A plan that makes `computeMcoRecommendation` read from `simCard` instead of `waterfallCard` breaks D-04.

### Recommended Project Structure
```
src/
├── lib/
│   ├── mco.ts                          # UNCHANGED — canonical formula, reused as-is
│   ├── mcoHealth.ts                    # UNCHANGED — reused as-is for simulated semáforo
│   ├── precoMcoSeries.ts               # UNCHANGED — computeWaterfallCard needs no overrides param
│   └── pricing/
│       ├── calculator.ts               # UNCHANGED — parseNumber() reused for input parsing
│       ├── mcoRecommendation.ts        # UNCHANGED — still called with the REAL card only
│       ├── mcoSimulation.ts            # NEW — computeSimulatedWaterfall(), pure, ~30 lines
│       └── mcoSimulation.test.ts       # NEW — TDD RED/GREEN, mirrors mco.test.ts style
└── components/mercadolivre/anuncios/
    ├── PrecoPraticadoReport.tsx        # EXTENDED — toggle + sim state + SimInput rows in the existing card
    └── PrecoPraticadoReport.test.tsx   # EXTENDED — new describe block for simulate-mode behavior
```

### Pattern 1: `computeSimulatedWaterfall` — the missing pure function
**What:** A tiny, zero-I/O pure function that takes already-per-unit simulated inputs (comissão/imposto as %, everything else as R$) and reuses `computeMco` to produce the same shape of derived numbers (`mcUnit`, `mcoUnit`, `mcoPct`) that `WaterfallCard` already exposes for the real data — so the rendering code (Row components, semáforo) can treat "real" and "simulated" cards almost identically.
**When to use:** Whenever `simulating === true`; feeds the waterfall Rows and the semáforo badge.
**Why comissão/imposto are % here but R$ elsewhere in the real card:** `WaterfallCard.comissaoUnit`/`impostoUnit` are R$ amounts because they're derived by dividing period totals (`comissao`, `impostos` columns from the RPC) by `qtd` — real historical R$, already fixed. But D-01 explicitly asks the user to edit **comissão% and impostos%**, not R$ amounts, because both scale with the price being simulated (if the user changes `precoUnit`, a flat R$ commission wouldn't track reality — a %, exactly like `computeMcoRecommendation` already derives internally via `commissionPct = comissaoUnit/precoUnit*100`, does). This mirrors the exact percent-derivation already used one file away, in `mcoRecommendation.ts` lines 43-44.

**Example:**
```typescript
// Source: derived from src/lib/mco.ts (computeMco) + src/lib/pricing/mcoRecommendation.ts
// (percent-of-price derivation pattern, lines 43-44) — new file src/lib/pricing/mcoSimulation.ts
import { computeMco } from "@/lib/mco";

/** Inputs the user edits during simulation — per unit, comissão/imposto as % of precoUnit. */
export interface SimulatedInputs {
  precoUnit: number;
  cmvUnit: number;
  /** % of precoUnit (0-100) — NOT R$, mirrors mcoRecommendation's commissionPct derivation */
  comissaoPct: number;
  freteUnit: number;
  /** % of precoUnit (0-100) — NOT R$ */
  impostoPct: number;
  adsUnit: number;
}

/** Same field names/shape as WaterfallCard's derived fields, so the component can
 *  reuse the exact same Row-rendering code for real vs. simulated. */
export interface SimulatedWaterfall {
  precoUnit: number;
  cmvUnit: number;
  comissaoUnit: number; // derived R$, for display parity with the real Row
  freteUnit: number;
  impostoUnit: number;  // derived R$, for display parity with the real Row
  adsUnit: number;
  mcUnit: number;        // margem de contribuição/un ANTES de ads (same semantics as WaterfallCard.mcUnit)
  mcoUnit: number;
  mcoPct: number | null;
}

/**
 * Computes the simulated waterfall from user-edited per-unit values.
 * Zero I/O, reuses computeMco (never reimplements the formula) — per-unit values are
 * fed as if they were "period totals of 1 unit", which is valid because computeMco's
 * formula is linear/scale-invariant (mco = revenue - cmv - platformCost - ads - tax;
 * pct = mco/revenue×100 — the ratio holds regardless of what "1 unit" means).
 */
export function computeSimulatedWaterfall(input: SimulatedInputs): SimulatedWaterfall {
  const { precoUnit, cmvUnit, comissaoPct, freteUnit, impostoPct, adsUnit } = input;

  const comissaoUnit = precoUnit > 0 ? (precoUnit * comissaoPct) / 100 : 0;
  const impostoUnit = precoUnit > 0 ? (precoUnit * impostoPct) / 100 : 0;

  const { mco, pct } = computeMco({
    grossRevenue: precoUnit,
    cmv: cmvUnit,
    platformCost: comissaoUnit + freteUnit,
    ads: adsUnit,
    tax: impostoUnit,
  });

  return {
    precoUnit,
    cmvUnit,
    comissaoUnit,
    freteUnit,
    impostoUnit,
    adsUnit,
    mcUnit: precoUnit - cmvUnit - comissaoUnit - freteUnit - impostoUnit,
    mcoUnit: mco,
    mcoPct: pct,
  };
}
```

### Pattern 2: Live recompute + commit-time validation (the D-04/D-05 synthesis)
**What:** Two established codebase patterns for numeric inputs must be combined, not chosen between.
- `SimuladorPrecificacao.tsx` (Phase 50) proves the "recalcula a cada digitação" (D-04) mechanics: plain string state per field, parsed with `parseNumber()` on every `onChange`, pure calc called directly — **no validation, no toast, no reject** anywhere in that component.
- Meta MCO% (`PrecoPraticadoReport.tsx` lines 604-622) proves the D-05 mechanics: draft string state, commit only on blur/Enter, and on commit: parse → if invalid/out-of-range → `toast.error(...)` + **do not apply** (keep previous value) → else apply.

Neither alone satisfies this phase: D-04 needs live recompute (not gated to blur), D-05 explicitly needs the toast+reject+revert behavior (which `SimuladorPrecificacao` doesn't have at all).

**When to use:** Every one of the 6 simulated fields (D-01).

**Example:**
```typescript
// Source: synthesis of src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx
// (live onChange + parseNumber, lines 384-427/660-668) and PrecoPraticadoReport.tsx
// Meta MCO% inline-edit (commitMcoTargetEdit, lines 612-622) — no direct source, this is
// the required combination per D-04 (live) + D-05 (validate-on-commit, toast, revert)
import { parseNumber } from "@/lib/pricing/calculator"; // pt-BR aware: "1.234,56" → 1234.56, invalid → 0
import { toast } from "sonner";

function SimField({
  value, min, max, onLiveChange, onReject, unit,
}: {
  value: number;
  min: number;
  max?: number; // only for comissaoPct/impostoPct (0-100)
  onLiveChange: (v: number) => void; // fires on every keystroke that yields a finite number
  onReject: () => void;              // reverts the draft string to the last committed value
  unit: "currency" | "percent";
}) {
  const [draft, setDraft] = useState(String(value));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDraft(raw);
    // Live recompute (D-04): parseNumber never throws, degrades gracefully — safe to
    // call on every keystroke, matches SimuladorPrecificacao's live-calc precedent.
    onLiveChange(parseNumber(raw));
  };

  const handleBlur = () => {
    const parsed = parseNumber(draft);
    const invalid = draft.trim() === "" || parsed < min || (max != null && parsed > max);
    if (invalid) {
      // D-05: same toast + revert pattern as commitMcoTargetEdit
      toast.error(
        unit === "percent"
          ? "Valor precisa estar entre 0% e 100%"
          : "Valor precisa ser maior ou igual a zero",
      );
      setDraft(String(value)); // revert visible text
      onReject();              // revert the live-recomputed value too
      return;
    }
    setDraft(String(parsed)); // normalize display (e.g. "12," -> "12")
  };

  return (
    <input
      value={draft}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      type="text" inputMode="decimal"
      className="w-20 rounded border border-accent/40 bg-background px-1.5 py-0.5 text-right text-xs outline-none ring-1 ring-accent/30"
    />
  );
}
```
**Key detail:** `onLiveChange` fires eagerly (drives the always-current `simCard` recompute so the semáforo/MC/MCO move as the user types); `onReject` is only invoked at blur-time when the FINAL typed value fails validation, restoring both the visible text and the value feeding `computeSimulatedWaterfall`. This means the semáforo may transiently reflect an "in-progress" number while typing (e.g., typing "1" then "12" then "120" for a %-field capped at 100) — that's expected and matches D-04's "tempo real" intent; only the *committed* value is validated, exactly like the Meta MCO% field already behaves for its own single field today.

### Pattern 3: Toggle + reset lifecycle
**What:** `simulating` boolean gates Row vs. `SimField` rendering for the whole waterfall block at once (not per-field click-to-edit like Meta MCO%). Reset happens two ways per D-03.
**When to use:** Card-level toggle "Simular" (next to "Detalhamento de MCO" title, mirrors the "Incluir publicidade" `Switch`+`Label` pair already at lines 713-722) + explicit "Resetar" button + automatic reset effect.
**Example:**
```typescript
// Source: pattern combines the existing "incluir ads" Switch (lines 713-722) with the
// existing selectedSku-reset effect (lines 290-292) — both already in PrecoPraticadoReport.tsx
const [simulating, setSimulating] = useState(false);
const [simDraft, setSimDraft] = useState<SimulatedInputs | null>(null);

const seedFromReal = useCallback((card: WaterfallCard): SimulatedInputs => ({
  precoUnit: card.precoUnit,
  cmvUnit: card.cmvUnit,
  comissaoPct: card.precoUnit > 0 ? (card.comissaoUnit / card.precoUnit) * 100 : 0,
  freteUnit: card.freteUnit,
  impostoPct: card.precoUnit > 0 ? (card.impostoUnit / card.precoUnit) * 100 : 0,
  adsUnit: card.adsUnit,
}), []);

// Toggling ON (or "Resetar" while ON) always reseeds from the LATEST real card —
// never a frozen snapshot from when the toggle was first flipped.
const handleToggleSimular = (checked: boolean) => {
  setSimulating(checked);
  if (checked) setSimDraft(seedFromReal(waterfallCard));
};
const handleResetar = () => setSimDraft(seedFromReal(waterfallCard));

// D-03: item/variação change → always exits simulate mode and clears the draft.
useEffect(() => {
  setSimulating(false);
  setSimDraft(null);
}, [selectedId, selectedSku]);

const simCard = useMemo(
  () => (simDraft ? computeSimulatedWaterfall(simDraft) : null),
  [simDraft],
);
```

### Anti-Patterns to Avoid
- **Passing `simCard` into `computeMcoRecommendation`:** breaks D-04 explicitly ("seria circular"). The existing call `computeMcoRecommendation(waterfallCard, targetMcoPct)` (line 595-598) must keep receiving the real `waterfallCard`, unconditionally, regardless of `simulating`.
- **Adding an "overrides" parameter to `computeWaterfallCard`:** unnecessary — that function aggregates `PrecoSeriesRow[]`, and there is no "simulated rows" concept (per the phase description itself: "sem 'rows simuladas', apenas números por unidade simulados"). Touching `precoMcoSeries.ts` at all is not required for this phase.
- **Editing comissão/impostos as R$ instead of %:** would silently decouple them from the simulated `precoUnit` the user is also editing, producing a waterfall that doesn't reconcile with any real percentage-based commission/tax model — D-01 asks for comissão%/impostos%, not R$, specifically to avoid this.
- **Validating on every keystroke (reject mid-typing):** breaks D-04's live-recompute UX — a user can never type a negative sign or a partial decimal if the reject-and-revert logic runs on `onChange`. Validation must be commit-time only (Pattern 2).
- **Persisting simulated values anywhere (localStorage, DB, URL params):** explicitly out of scope — CONTEXT.md: "sem nenhuma persistência em banco... efêmero." Component `useState` only.
- **Using `react-hook-form` for this card:** neither of the two closest in-codebase analogs (Meta MCO% inline-edit, `SimuladorPrecificacao`) uses it; introducing it here for one card would be inconsistent and add unnecessary indirection for what is 6 independently-live-recomputed number fields.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCO formula (mco = revenue − cmv − platformCost − ads − tax) | A new inline calculation in the component or in the new sim file | `computeMco` from `src/lib/mco.ts`, called directly | Canonical single source of truth (CONTEXT.md explicit rule); already proven scale-invariant for per-unit inputs |
| Semáforo color/threshold logic | New color-classification logic for "simulated" state | `classifyMcoHealth` + `mcoHealthRole` from `src/lib/mcoHealth.ts` | Same thresholds (🔴≤5% 🟡6-8% 🟢≥9%) must apply to simulated MCO% exactly as they do to real MCO% — divergent logic would silently create a different "simulated semáforo" scale |
| pt-BR decimal number parsing ("1.234,56") | A new regex/parse helper in the component | `parseNumber` from `src/lib/pricing/calculator.ts` | Already handles thousands-dot + decimal-comma + graceful degrade-to-0 on invalid input; reused by `SimuladorPrecificacao` today |
| Row label/value layout (label left, value right, accent/danger coloring) | New JSX per waterfall line | The existing module-scope `Row` component (`PrecoPraticadoReport.tsx` lines 129-148) | Already extracted to module scope specifically so both `ChartTooltip` and the Phase 101 card reuse it — the sim card's real-mode Rows should reuse it unchanged; only sim-mode swaps `Row` for the new `SimField` per line |

**Key insight:** every piece this phase needs already exists in the codebase as a pure, tested, reusable unit (`computeMco`, `classifyMcoHealth`, `parseNumber`, `Row`). The only genuinely new code is the ~15-line glue function `computeSimulatedWaterfall` and the component wiring — there is no calculation logic left to invent.

## Common Pitfalls

### Pitfall 1: Mistaking `computeWaterfallCard` for the extension point
**What goes wrong:** A planner sees `computeWaterfallCard(rows, opts)` is the function that produces today's card and assumes the simulator must call it with modified `rows`, leading to inventing fake "1-row" `PrecoSeriesRow` objects with `qtd: 1` and manufactured `total`/`cmv`/`comissao`/etc. to force the aggregation path to produce the right per-unit numbers.
**Why it happens:** `computeWaterfallCard` is the only function in the codebase that currently produces a `WaterfallCard`-shaped object, so it looks like the natural single extension point.
**How to avoid:** Recognize that `computeWaterfallCard`'s job is *aggregation* (rows → totals → per-unit), and the simulator's input is *already per-unit* — there's nothing to aggregate. Skip straight to `computeMco`, which both functions ultimately call. Confirmed by reading `computeMco`'s actual signature: it takes `{ grossRevenue, cmv, platformCost, ads, tax }` with no `qtd` field and no aggregation — it is unit-agnostic by construction.
**Warning signs:** A plan that proposes constructing fake `PrecoSeriesRow[]` arrays, or that adds a new optional parameter to `computeWaterfallCard`'s signature.

### Pitfall 2: Commission/tax edited as R$ instead of %, breaking as `precoUnit` changes
**What goes wrong:** If `comissaoUnit`/`impostoUnit` are exposed as directly-editable R$ fields (matching how the REAL card displays them today — `brl(waterfallCard.comissaoUnit)`), then editing `precoUnit` in the same simulation leaves commission/tax as stale flat R$ amounts that no longer correspond to any real commission/tax percentage — the simulated MCO becomes internally inconsistent (e.g., a R$0 commission on a R$1000 simulated price).
**Why it happens:** The real (non-simulated) waterfall Row for "Comissão"/"Impostos" already displays R$ — copy-pasting that Row's display format into edit-mode is the path of least resistance.
**How to avoid:** D-01 locks comissão%/impostos% as the edited unit specifically for this reason. Derive the R$ display from `comissaoPct × precoUnit / 100` (Pattern 1) — same derivation `mcoRecommendation.ts` already uses in the opposite direction (R$ → %, lines 43-44).
**Warning signs:** A `SimField` for comissão/impostos with `unit: "currency"` or a `brl()` formatter instead of `pctFmt()`/`%` suffix.

### Pitfall 3: Reseeding the sim draft from a stale card
**What goes wrong:** If `simDraft` is initialized once (e.g., via `useState(() => seedFromReal(waterfallCard))`) rather than re-seeded every time the toggle flips ON or "Resetar" is clicked, then switching granularity/period/incluirAds while simulating is OFF, then turning simulating back ON, shows outdated real values as the starting point — confusing the user about what "real" currently means.
**Why it happens:** `useState`'s lazy initializer only runs once per mount; it's an easy default to reach for.
**How to avoid:** Always derive the seed inside the `onCheckedChange`/`onClick` handler at the moment of toggling ON / clicking "Resetar" (Pattern 3), reading the current `waterfallCard` from closure — never a `useState` lazy initializer.
**Warning signs:** `useState(() => seedFromReal(waterfallCard))` instead of `setSimDraft(seedFromReal(waterfallCard))` inside an event handler.

### Pitfall 4: Ads field visible/counted when "incluir ads" is OFF
**What goes wrong:** The real waterfall already conditionally renders the Ads row only `{incluirAds && <Row .../>}` (line 963) and `computeWaterfallCard` itself zeroes `ads` when `opts.incluirAds` is false (via `computePrecoMcoSeries`, line 124: `opts.incluirAds ? ... : 0`). If the simulated waterfall always shows/edits an Ads field regardless of the toggle, the simulated MCO and the real MCO become non-comparable (D-04's whole point is a like-for-like comparison against the anchored recommendation).
**Why it happens:** Easy to forget a second conditional when porting one Row into a `SimField`.
**How to avoid:** Gate the Ads `SimField` behind the same `incluirAds` state the component already tracks, and when `incluirAds` is false, force `simDraft.adsUnit = 0` (don't just hide the input while leaving a stale nonzero value silently included in the calc).
**Warning signs:** `computeSimulatedWaterfall` called with `adsUnit` sourced from a `SimField` that's still mounted (or its last value retained) after `incluirAds` toggles off.

### Pitfall 5: Forgetting the empty-card / zero-price guard
**What goes wrong:** `computeMco` returns `pct: null` when `grossRevenue <= 0` (verified in `mco.test.ts`, "retorna pct = null (sem NaN) quando grossRevenue = 0"), but nothing stops the user from typing `0` or clearing the "Receita/un" field during simulation. If the semáforo/formatter code isn't defensive, a `null` `mcoPct` reaching `pctFmt` (already handles `null` → `"—"`, confirmed) is fine, but a naive percent computation elsewhere (e.g., manually recomputing `commissaoUnit/precoUnit*100` for display) will produce `NaN`/`Infinity` if not guarded the same way `mcoRecommendation.ts` guards it (`card.precoUnit > 0 ? ... : 0`, lines 43-44).
**Why it happens:** The real waterfall never has `precoUnit === 0` in practice (it's an average over actual sales, `qtd > 0` guaranteed by the `hasData` gate at line 922) — this is a genuinely new edge case only the simulator introduces, since the user can type anything.
**How to avoid:** Every derived-from-`precoUnit` percentage calculation (in `SimField` display, in `computeSimulatedWaterfall`) needs the `precoUnit > 0 ? ... : 0` guard, matching Pattern 1's example exactly.
**Warning signs:** Any `x / simDraft.precoUnit` without a zero-guard.

## Code Examples

### Reusing `pctFmt`/`brl` formatters for the simulated card (no new formatters needed)
```typescript
// Source: src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx, lines 80-90
// (already defined in the file, reused unchanged for the simulated card's Row display)
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const pctFmt = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
```

### Semáforo reuse for the simulated card (identical to real, different input)
```typescript
// Source: src/lib/mcoHealth.ts (classifyMcoHealth, mcoHealthRole) — already imported at
// line 56 of PrecoPraticadoReport.tsx, no new import needed
const activeMcoPct = simulating && simCard ? simCard.mcoPct : waterfallCard.mcoPct;
const mcoHealthValue = classifyMcoHealth(activeMcoPct);
const mcoRole = mcoHealthRole(mcoHealthValue);
// Badge className lookup (MCO_ROLE_BADGE_CLASS, already defined lines 119-124) unchanged.
```

### Recommendation call site — must stay unchanged
```typescript
// Source: src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx, lines 595-598
// DO NOT modify this call to read from simCard — D-04 requires it stays anchored to REAL.
const mcoRecommendation = useMemo(
  () => computeMcoRecommendation(waterfallCard, targetMcoPct),
  [waterfallCard, targetMcoPct],
);
```

## State of the Art

Not applicable — this is a same-session extension of a phase (101) that was itself just built with current codebase conventions. There is no "old approach" being replaced; `computeMco`/`mcoHealth.ts`/`WaterfallCard` are all current (2026-07-19) and unchanged by this research.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Toggling "Simular" OFF should NOT clear `simDraft` (only stop rendering it / stop feeding it into the semáforo), so re-toggling ON without an intervening item/variação change could restore the last simulated numbers rather than reseed from real. This was left ambiguous by CONTEXT.md (only D-03 locks item/variação-change reset and an explicit "Resetar" button; toggle-OFF behavior is Claude's Discretion). **Research recommends AGAINST this** — always reseed from the real card whenever the toggle flips back ON (Pattern 3), to avoid a stale-simulation bug class, but this is a discretionary UX call, not a locked decision, and the planner/user should confirm. | Pattern 3 / Pitfall 3 | Low — either choice is internally consistent and reversible; wrong choice only causes minor UX confusion ("why did my old simulated numbers come back?"), never a data-integrity or security issue |

**If this table is empty:** N/A — one low-risk discretionary UX assumption is logged above; all technical/architectural claims (function signatures, existing patterns, formula behavior) were verified by direct inspection of the current repository source, not assumed.

## Open Questions

1. **Should the "custo ausente"/"imposto ausente" warning footer (D-01 real-card feature) still render while `simulating === true`?**
   - What we know: The warnings are about *real* underlying data quality (`waterfallCard.custoAusente`/`impostoAusente`), which doesn't change just because the user is now typing hypothetical numbers on top of it.
   - What's unclear: Whether showing them during simulation is helpful context ("heads up, the real CMV behind this simulation had gaps") or confusing (implies the *simulated* numbers have gaps, which they don't — user typed them).
   - Recommendation: Keep the warnings visible unconditionally (they reference real, not simulated, data quality) — cheapest, most consistent option, and avoids a conditional that could hide relevant context. Low risk either way; Claude's Discretion per CONTEXT.md's layout-discretion clause.

2. **Exact visual treatment of the "this is a simulation" indicator (badge/background/icon)** — explicitly left to Claude's Discretion by CONTEXT.md. No further research needed; the codebase's existing `Badge` variants (`MCO_ROLE_BADGE_CLASS`) and `text-warning`/`border-accent` tokens (already used throughout `PrecoPraticadoReport.tsx`) are sufficient building blocks — no new design token needed.

## Environment Availability

Skipped — this phase has no external dependencies (no new CLI tools, runtimes, services, or databases). Pure frontend code change on top of an already-running Vite/React/vitest toolchain.

## Validation Architecture

Skipped — `.planning/config.json` has `workflow.nyquist_validation: false` (explicit).

For the planner's own reference (outside the skipped section's formal requirements), the relevant test file already exists and its harness is directly extensible:
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.test.tsx` (128 lines, 2 tests, both passing as of Phase 101) mocks `@/integrations/supabase/client` (RPC returns a controllable `rpcRows` array), `@/contexts/MLInventoryContext`, and `@/hooks/useMcoTargets` — a new `describe` block for "modo Simular" can render the same component with the same fixture and drive the toggle/inputs via `@testing-library/react` `fireEvent`/`userEvent`, asserting the waterfall Rows switch to editable inputs and the semáforo Badge text changes on edit.
- `src/lib/pricing/mcoRecommendation.test.ts` and `src/lib/mco.test.ts` are the direct style precedents for a new `src/lib/pricing/mcoSimulation.test.ts` (plain `describe`/`it`, inline comments showing the arithmetic, `toBeCloseTo` for floats, explicit zero/negative/edge-case tests).
- Test command: `npm run test` (`vitest run`); watch mode `npm run test:watch`.

## Security Domain

`security_enforcement` is absent from `.planning/config.json` → treated as enabled per protocol.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | No auth surface touched — feature lives entirely inside an already-authenticated page |
| V3 Session Management | No | No session/token handling introduced |
| V4 Access Control | No | No new route, no new RLS-scoped data — the simulator reads only already-fetched, already-org-scoped `rows`/`waterfallCard` in memory; it writes nothing anywhere |
| V5 Input Validation | Yes | Client-side numeric bounds validation (preço/CMV/frete/ads ≥ 0; comissão%/impostos% 0-100) per D-05, mirroring the existing Meta MCO% `CHECK`-equivalent client guard (`parsed <= 0 || parsed > 100` at line 615) and `parseNumber`'s defensive parse-or-0 behavior (`src/lib/pricing/calculator.ts`) — no `eval`, no dynamic code execution, plain `Number`/regex-based parsing only |
| V6 Cryptography | No | No secrets, tokens, or crypto operations involved |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Injection via numeric input rendered back into the DOM | Tampering | N/A — all values are rendered through React's default text-node escaping (`{value}` / template-string-formatted numbers via `brl()`/`pctFmt()`), never `dangerouslySetInnerHTML`; no risk introduced by this phase |
| NaN/Infinity propagating into displayed percentages, silently misleading the user about their simulated margin | Tampering (data integrity, not a security boundary) | Zero-guard every `x / precoUnit` (Pitfall 5); `computeMco` itself already guards `grossRevenue <= 0 → pct: null`, and `pctFmt`/`brl` handle `null`/finite numbers only — no new guard code needed beyond what Pattern 1 already includes |

This phase has an unusually small security surface: it is pure client-side arithmetic over data the user already had read access to, with no new network calls, no new persisted state, and no new access-control boundary.

## Sources

### Primary (HIGH confidence)
- `src/lib/mco.ts` — `computeMco` full signature and formula, read directly
- `src/lib/mcoHealth.ts` — `MCO_SAUDAVEL_PCT`, `classifyMcoHealth`, `mcoHealthRole`, read directly
- `src/lib/precoMcoSeries.ts` — `computeWaterfallCard`, `WaterfallCard`, `computePrecoMcoSeries`, read directly (confirms `computeMco` call sites and per-unit derivation pattern)
- `src/lib/pricing/mcoRecommendation.ts` — `computeMcoRecommendation`, confirms the recommendation call is decoupled from any specific card source and confirms the R$→% derivation pattern (lines 43-44) reused in Pattern 1
- `src/lib/pricing/calculator.ts` — `computePricing`, `reversePrice`, `parseNumber` — confirms the "recalcula a cada digitação" precedent and the existing pt-BR number-parsing utility
- `src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx` — full file read; direct precedent for a live what-if recompute UI already in production (Phase 50, `/precos-custos`)
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — full file read (1207 lines); exact current implementation of the card this phase extends, including the Meta MCO% inline-edit pattern (lines 604-622) and the `incluirAds` toggle pattern (lines 713-722) reused in Pattern 3
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.test.tsx` — full file read; existing test harness/mocks for the exact component this phase extends
- `src/pages/mercadolivre/MLAnuncios.tsx` — `InlineEditCell` (lines 156-220+), confirms it is not exported (must be locally reimplemented/adapted, not imported)
- `src/lib/mco.test.ts`, `src/lib/precoMcoSeries.test.ts` — confirm existing TDD style/conventions and the `pct: null` zero-revenue guard behavior
- `.planning/phases/101-.../101-CONTEXT.md`, `101-PATTERNS.md` — prior-phase decisions and pattern map for the exact same component/card
- `.planning/config.json` — `nyquist_validation: false`, `security_enforcement` absent
- `vitest.config.ts`, `package.json` — test runner/scripts confirmation

### Secondary (MEDIUM confidence)
None — no web/external documentation was needed for this phase; every claim above was verified by direct inspection of the current repository.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; every reused piece verified by direct file read
- Architecture: HIGH — the hard technical question (computeMco unit-agnosticism) is verified by reading the actual function body and its existing test suite (`mco.test.ts`), not inferred
- Pitfalls: HIGH — all five pitfalls are grounded in specific, cited lines of existing code (real behavior the simulator must not diverge from), not speculative

**Research date:** 2026-07-19
**Valid until:** Effectively indefinite for this internal-code research (no external dependency to go stale); revalidate only if `src/lib/mco.ts`, `precoMcoSeries.ts`, or `mcoRecommendation.ts` change before this phase is planned/executed.
