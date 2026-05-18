# Phase 6: Recomendações de Compra & FULL — Research

**Researched:** 2026-05-18
**Domain:** React frontend — pure-math recommendation UI wired to existing snapshot data
**Confidence:** HIGH

---

## Summary

Phase 6 adds a purchase-recommendation panel to the existing Análise Dashboard. All four requirements (COMP-01 through COMP-04) are pure frontend calculations: no new Supabase tables, no edge functions, and no new npm packages are needed. The `dailyAvg` needed for every formula already lives on `PriceBucket` inside `AnalysisSnapshot.priceCurve`, and the `strategy` already lives on the snapshot itself.

The key architectural decision is **where the panel lives**. `AnaliseDashboard.tsx` already has the full snapshot list and strategy state in scope. Placing the purchase panel as a section below the existing table (inside the same component tree, after `AnalisePrecosTable`) avoids prop-drilling and requires no routing changes. This is the most cohesive option and matches the REQUIREMENTS.md note "Multi-produto no módulo de compras — usuário analisa um produto por vez nesta versão" — the panel is naturally per-snapshot, with the most recent snapshot pre-selected.

The multiplier selector (COMP-02) applies to all recommendations simultaneously; it belongs in the panel's own local state, not lifted to the dashboard. Per-product stock inputs (COMP-01) belong in local state inside the recommendation component, keyed by `snapshot.id`.

**Primary recommendation:** Build a single `CompraRecomendadaPanel` component rendered below `AnalisePrecosTable` inside `AnaliseDashboard`. Use `useState<Record<snapshotId, StockInputs>>` for stock inputs, and a single shared `useState<Multiplicador>` for the demand multiplier. All output values are derived purely via `useMemo`.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COMP-01 | Usuário informa por produto: dias de cobertura desejada, estoque total atual, estoque FULL atual, estoque casa/CD | Inline inputs in CompraRecomendadaPanel row per snapshot; Input component available at src/components/ui/input.tsx |
| COMP-02 | Usuário seleciona multiplicador de demanda (Normal ×1,0 / Campanha leve ×1,2 / Data forte ×1,5 / Live–oferta ×2,0); cálculo atualiza em tempo real | Select component + single shared multiplier state; real-time via useMemo — no async needed |
| COMP-03 | Sistema calcula compra recomendada = (venda_diária_estratégia × multiplicador × dias_cobertura) − estoque_total_atual | Pure derivation from snapshot.priceCurve + user inputs; venda_diária_estratégia lookup is a 1-pass find() on priceCurve |
| COMP-04 | Sistema sugere volume a enviar para FULL: GMV → 70–90% (use 80%), Neutro → 50–70% (use 60%), Margem → 40–60% (use 50%) da cobertura | Same useMemo, capped by estoque_total |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

- **Stack:** React 18 + TypeScript + shadcn/ui + Supabase — no new calculation dependencies.
- **Components:** shadcn/ui primitives only (`Input`, `Select`, `Card`, `Badge`). Do not add Radix primitives not already imported.
- **Naming:** Components `PascalCase.tsx` in `src/components/mercadolivre/analise/`. Hooks `use<PascalCase>.ts`.
- **Props:** Interfaces defined inline above the component in the same file.
- **Exports:** Named exports only (no default exports from components).
- **Routing:** No new route — the panel lives inside the existing `Análise` tab under `/precos-custos`.
- **GSD Workflow:** All edits via `/gsd-execute-phase` workflow; no direct edits outside GSD.
- **nyquist_validation:** `false` — no test files required for this phase.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stock input collection (COMP-01) | Browser/Client | — | Pure user input; no server round-trip |
| Multiplier selection (COMP-02) | Browser/Client | — | UI-only select; shared state across products |
| Purchase recommendation calc (COMP-03) | Browser/Client | — | Pure math from snapshot data + user input |
| FULL suggestion calc (COMP-04) | Browser/Client | — | Same derivation, strategy already on snapshot |
| Snapshot data (priceCurve, strategy) | Already fetched | — | Phase 5 provided via useAnalysisSnapshots; no new fetch needed |

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.3.1 | UI rendering + hooks | Project standard |
| TypeScript | 5.8.3 | Type safety | Project standard |
| shadcn/ui Input | — | Number inputs for stock/coverage | Matches existing form pattern in AnaliseDashboard |
| shadcn/ui Select | — | Multiplier dropdown | Already used in AnalisePrecosTable for strategy |
| shadcn/ui Card | — | Panel container | Used throughout analise/ components |
| shadcn/ui Badge | — | Display computed results inline | Already used in AnalysisProductCard |

No new packages to install. [VERIFIED: codebase grep of src/components/ui/]

---

## Architecture Patterns

### System Architecture Diagram

```
AnaliseDashboard (snapshots[], handleStrategyChange)
│
├── [controls card]
├── AnalysisProductCard (snapshots[0])
├── AnalisePrecosTable (snapshots, onStrategyChange)
│
└── CompraRecomendadaPanel  ← NEW (Phase 6)
    │  props: snapshots, (reads strategy from each snapshot)
    │  local state: stockInputs: Record<id, StockInputs>
    │              multiplicador: Multiplicador (shared)
    │
    ├── MultiplierSelector  ← sub-component or inline Select
    │   (Normal/Campanha leve/Data forte/Live–oferta)
    │
    └── [per snapshot row]
        ├── StockInputRow  ← inputs for dias_cobertura, estoque_total,
        │                    estoque_full, estoque_casa
        └── RecomendacaoOutput  ← derived: compra_recomendada, full_sugerido
            (useMemo, updates on every input change)
```

### Recommended Project Structure

```
src/components/mercadolivre/analise/
├── AnaliseDashboard.tsx          — add CompraRecomendadaPanel below table (MODIFY)
├── AnalisePrecosTable.tsx        — unchanged
├── AnalysisProductCard.tsx       — unchanged
├── CompraRecomendadaPanel.tsx    — NEW: main panel component
└── compraUtils.ts                — NEW: pure calculation functions (testable in isolation)
```

`compraUtils.ts` extracts the three formulas into named functions so they can be reasoned about independently and easily unit-tested if desired later:

```typescript
// Source: REQUIREMENTS.md + prompt business logic spec [VERIFIED: prompt]

export type Multiplicador = 1.0 | 1.2 | 1.5 | 2.0;

export interface StockInputs {
  diasCobertura: number;   // >= 1
  estoqueTotal: number;    // >= 0
  estoqueFull: number;     // >= 0
  estoqueCasa: number;     // >= 0
}

export function getDailyAvg(
  priceCurve: PriceBucket[],
  strategy: 'gmv' | 'neutral' | 'margin' | null,
  priceGmv: number,
  priceNeutral: number,
  priceMargin: number,
): number {
  const targetPrice =
    strategy === 'neutral' ? priceNeutral :
    strategy === 'margin'  ? priceMargin  :
    priceGmv; // 'gmv' or null → default GMV
  const bucket = priceCurve.find((b) => b.price === targetPrice);
  return bucket?.dailyAvg ?? 0;
}

export function calcCompraRecomendada(
  vendaDiaria: number,
  multiplicador: Multiplicador,
  diasCobertura: number,
  estoqueTotal: number,
): number {
  return Math.max(0, Math.ceil(vendaDiaria * multiplicador * diasCobertura) - estoqueTotal);
}

export function calcFullSugerido(
  coberturaAlvo: number,
  strategy: 'gmv' | 'neutral' | 'margin' | null,
  estoqueTotal: number,
): number {
  const pct =
    strategy === 'margin'  ? 0.50 :
    strategy === 'neutral' ? 0.60 :
    0.80; // 'gmv' or null → 80%
  return Math.min(estoqueTotal, Math.ceil(coberturaAlvo * pct));
}
```

### Anti-Patterns to Avoid

- **Lifting stock inputs to AnaliseDashboard:** The dashboard already owns snapshot data and strategy. Adding per-product stock fields there creates a bloated state shape. Keep stock inputs local to `CompraRecomendadaPanel`.
- **New Supabase table for stock inputs:** COMP-01–04 are advisory recommendations, not persisted data. No migration needed. Stock values are session-local.
- **Calling useAnalysisSnapshots again inside the panel:** Snapshots are already fetched by the dashboard and passed as props.
- **Separate tab for the panel:** MLPrecificacao already has "Simulador" and "Análise" tabs. Adding a third "Compras" tab creates navigation friction for a feature that is contextually coupled to the analysis results.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Number input with min/max | Custom numeric stepper | `<Input type="number" min={0} />` | shadcn/ui Input handles all HTML5 numeric validation |
| Dropdown for multiplier | Custom radio-button group | `<Select>` (already in codebase) | Matches strategy dropdown pattern in AnalisePrecosTable |
| Real-time calc | debounce + useEffect | `useMemo` on derived values | No async; synchronous math; useMemo is correct tool |

---

## Q&A: Specific Research Questions

### 1. Where does the purchase panel live?

**Answer: Section below the table inside `AnaliseDashboard`, NOT a new tab.**

Evidence from codebase:
- `MLPrecificacao.tsx` currently has two tabs: "Simulador" and "Análise". Adding a third "Compras" tab would fragment the workflow. [VERIFIED: src/pages/mercadolivre/MLPrecificacao.tsx]
- `AnaliseDashboard.tsx` renders cards then `AnalisePrecosTable` wrapped in a `<Card>`. The natural extension is a sibling `<Card>` below, rendered when `snapshots.length > 0`. [VERIFIED: src/components/mercadolivre/analise/AnaliseDashboard.tsx lines 280–295]
- The REQUIREMENTS.md "Out of Scope" entry confirms single-product-at-a-time usage in v2.0, which fits the inline panel model perfectly. [VERIFIED: .planning/REQUIREMENTS.md]

Implementation: Add `<CompraRecomendadaPanel snapshots={snapshots} />` inside the `snapshots.length > 0` branch, after the existing `<Card>` that wraps `AnalisePrecosTable`.

### 2. Input form pattern?

**Answer: Separate panel card with one row per snapshot — NOT inline table row expansion.**

Rationale:
- `AnalisePrecosTable` rows are already dense (7 columns). Adding 4 numeric inputs + 2 output fields inline would overflow horizontally on any screen size. [VERIFIED: src/components/mercadolivre/analise/AnalisePrecosTable.tsx]
- The shadcn/ui `Input` component renders at `h-10` by default — too tall for a table row at the current cell scale of `h-8` selects. Mixing them would break visual rhythm. [VERIFIED: src/components/ui/input.tsx]
- A dedicated card panel (similar to the controls card at the top of the dashboard) gives room for labeled inputs and formatted output badges without crowding.
- Layout within the panel: a grid/table with one row per snapshot, columns: Produto | Dias | Estoque Total | Estoque FULL | Estoque Casa | Compra Rec. | FULL Sugerido. The multiplier selector sits in the panel's card header, shared across all products.

### 3. Is real-time calculation purely frontend? Any new hooks/tables?

**Answer: Yes — 100% frontend. No new hooks, no new DB tables.**

- All inputs needed for COMP-03/04 (priceCurve, priceGmv, priceNeutral, priceMargin, strategy) already exist on `AnalysisSnapshot` as delivered by Phase 5. [VERIFIED: src/hooks/useAnalysisSnapshots.ts]
- `PriceBucket.dailyAvg` is already the correct metric (units / periodDays). [VERIFIED: src/lib/analysis/types.ts]
- Stock inputs are ephemeral user inputs. Persisting them is out of scope for v2.0.
- A `compraUtils.ts` module with pure functions is the only new file beyond the UI components.

### 4. State management recommendation?

**Two-level local state inside `CompraRecomendadaPanel`:**

```
// shared across all product rows
const [multiplicador, setMultiplicador] = useState<Multiplicador>(1.0);

// per-product, keyed by snapshot.id
const [stockInputs, setStockInputs] = useState<Record<string, StockInputs>>(
  () => Object.fromEntries(snapshots.map((s) => [s.id, defaultInputs()]))
);
```

Rationale:
- Multiplier is a single session preference that applies to all products simultaneously — shared state is correct.
- Stock inputs are product-specific — keyed map is cleaner than an array index.
- Derived outputs (compra, full) are computed via `useMemo` from the two state slices + snapshots prop, no separate state needed.
- No lifting to `AnaliseDashboard` — the panel is entirely self-contained.

When `snapshots` prop changes (new analysis run), the panel can reset `stockInputs` via a `useEffect([snapshots])` that re-initializes the map with `defaultInputs()` for any new snapshot IDs while preserving existing entries.

### 5. Recommended component breakdown?

```
CompraRecomendadaPanel
  props: { snapshots: AnalysisSnapshot[] }
  state: multiplicador, stockInputs
  renders:
    - Card header with title + MultiplierSelector (inline Select)
    - Table-like structure (or grid) with one CompraRow per snapshot
    - CompraRow is NOT a separate component file — keep inline as a
      mapped element to avoid prop-drilling overhead for this scale

compraUtils.ts (no React, pure TS)
  exports: getDailyAvg, calcCompraRecomendada, calcFullSugerido, Multiplicador, StockInputs
```

Keeping `CompraRow` as an inline mapping inside `CompraRecomendadaPanel` (rather than a separate file) is appropriate at this scale (one panel, ~10 rows max). Extract to a file only if it grows beyond ~80 lines.

### 6. Edge cases in the business logic?

| Edge Case | What Happens | Handling |
|-----------|-------------|----------|
| `strategy === null` | No strategy selected yet | `getDailyAvg` falls back to `priceGmv` bucket — show output with visual note "(estratégia não definida, usando GMV)" |
| `strategy` set but target price not in `priceCurve` | `priceCurve.find()` returns `undefined` | `bucket?.dailyAvg ?? 0` returns 0; show "—" in output fields to signal missing data |
| `diasCobertura = 0` | User clears the field | Input `min={1}`; derived value uses `Math.max(1, diasCobertura)` as guard |
| `estoqueTotal > coberturaAlvo` | Compra recomendada is negative | `Math.max(0, ...)` clamps to 0; display "0 — estoque suficiente" |
| `estoqueFull > estoqueTotal` | Data entry error | Add soft validation: show warning badge if `estoqueFull + estoqueCasa > estoqueTotal`; do not block calculation |
| `dailyAvg = 0` | Product had no sales at the strategy price point | Output 0 for both fields; add note "sem vendas neste preço" |
| Snapshot with no `priceCurve` entries | Empty array | `getDailyAvg` returns 0; handled by same `?? 0` guard |
| Multiplicador × diasCobertura overflow | Large numbers | `Math.ceil` is safe for JS number range; no special handling needed for realistic inputs |

---

## Common Pitfalls

### Pitfall 1: Price lookup by value equality on floats
**What goes wrong:** `priceCurve.find((b) => b.price === priceGmv)` can fail if floating-point representation differs (e.g., 29.99 stored as 29.990000000000001).
**Why it happens:** `priceGmv` is stored as NUMERIC in Supabase, serialized to JS number. The priceCurve buckets are generated from the same source, so precision should match — but it is an assumption.
**How to avoid:** Use `Math.round(b.price * 100) === Math.round(targetPrice * 100)` (compare in integer cents) as a more robust equality. Document this in `compraUtils.ts`.
**Confidence:** MEDIUM [ASSUMED: based on JS float behavior; price provenance from same computed analysis reduces risk but does not eliminate it]

### Pitfall 2: `stockInputs` state not re-initialized when new snapshot arrives
**What goes wrong:** User runs a new analysis; `snapshots` prop updates; old stock inputs from a previous analysis remain for matching snapshot IDs.
**How to avoid:** The `useEffect` reset should check for new IDs only, not blindly reset all entries. Pattern: add any `snapshot.id` not yet in `stockInputs` with `defaultInputs()`, preserving existing entries.

### Pitfall 3: Multiplier Select value type mismatch
**What goes wrong:** shadcn/ui `Select` `onValueChange` returns `string`. Casting directly to `Multiplicador` (a numeric union) will give you the string "1.2", not the number 1.2.
**How to avoid:** Parse via `parseFloat(v) as Multiplicador` in the `onValueChange` handler. Add a `MULTIPLICADORES` const array to avoid magic values.

### Pitfall 4: `Math.ceil` on already-integer `dailyAvg`
**What goes wrong:** Not a bug, but `Math.ceil(3.0 * 1.0 * 30) - 90` correctly yields 0. The formula is sound; just ensure `estoque_total` input is parsed as a number, not left as string from input value.
**How to avoid:** `parseInt(e.target.value, 10) || 0` or `Number(e.target.value)` on input onChange.

---

## Code Examples

### getDailyAvg — strategy-to-bucket lookup

```typescript
// Source: prompt business logic spec + types.ts inspection [VERIFIED]
export function getDailyAvg(
  priceCurve: PriceBucket[],
  strategy: 'gmv' | 'neutral' | 'margin' | null,
  priceGmv: number,
  priceNeutral: number,
  priceMargin: number,
): number {
  const targetPrice =
    strategy === 'neutral' ? priceNeutral :
    strategy === 'margin'  ? priceMargin  :
    priceGmv;
  // Use integer-cent comparison to avoid float equality issues
  const targetCents = Math.round(targetPrice * 100);
  const bucket = priceCurve.find((b) => Math.round(b.price * 100) === targetCents);
  return bucket?.dailyAvg ?? 0;
}
```

### Multiplier selector pattern (matches existing AnalisePrecosTable Select style)

```typescript
// Source: AnalisePrecosTable.tsx Select pattern [VERIFIED: codebase]
const MULTIPLICADORES = [
  { value: 1.0, label: 'Normal ×1,0' },
  { value: 1.2, label: 'Campanha leve ×1,2' },
  { value: 1.5, label: 'Data forte ×1,5' },
  { value: 2.0, label: 'Live–oferta ×2,0' },
] as const;

<Select
  value={String(multiplicador)}
  onValueChange={(v) => setMultiplicador(parseFloat(v) as Multiplicador)}
>
  <SelectTrigger className="h-8 w-[160px] text-xs">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {MULTIPLICADORES.map((m) => (
      <SelectItem key={m.value} value={String(m.value)}>
        {m.label}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

### Number input pattern (matches AnaliseDashboard date inputs)

```typescript
// Source: AnaliseDashboard.tsx Input usage [VERIFIED: codebase]
<Input
  type="number"
  min={0}
  value={inputs.estoqueTotal}
  onChange={(e) => updateInput(snapshotId, 'estoqueTotal', Number(e.target.value))}
  className="h-8 w-[90px] text-xs tabular-nums"
/>
```

### useMemo for derived outputs

```typescript
// Source: React docs [ASSUMED — standard pattern]
const recommendations = useMemo(() => {
  return snapshots.map((s) => {
    const inputs = stockInputs[s.id] ?? defaultInputs();
    const vendaDiaria = getDailyAvg(s.priceCurve, s.strategy, s.priceGmv, s.priceNeutral, s.priceMargin);
    const coberturaAlvo = vendaDiaria * multiplicador * inputs.diasCobertura;
    const compra = calcCompraRecomendada(vendaDiaria, multiplicador, inputs.diasCobertura, inputs.estoqueTotal);
    const full = calcFullSugerido(coberturaAlvo, s.strategy, inputs.estoqueTotal);
    return { id: s.id, vendaDiaria, coberturaAlvo, compra, full };
  });
}, [snapshots, stockInputs, multiplicador]);
```

---

## Environment Availability

Step 2.6: SKIPPED — This phase is purely frontend code changes with no external dependencies beyond the already-running project stack.

---

## Validation Architecture

`nyquist_validation: false` in `.planning/config.json` — this section is omitted per config.

---

## Security Domain

No new authentication surfaces, no new data persistence, no user-supplied data reaching the backend. ASVS input validation (V5) applies only to client-side numeric inputs, which are guarded by `type="number"` + `min` attributes and `Number()/parseInt()` parsing before being used in arithmetic. No security review needed beyond that.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Float equality for price lookup is safe because priceCurve is generated from the same computation that produces priceGmv/priceNeutral/priceMargin | Code Examples / Pitfall 1 | getDailyAvg returns 0 (wrong dailyAvg used); mitigation is integer-cent comparison |
| A2 | No persistence of stock inputs is desired (session-only) | Q&A #3 | If user wants saved inputs, a new DB table would be needed in a future phase |
| A3 | FULL percentage central values (80%/60%/50%) are the correct midpoints | Q&A #6 / compraUtils | Business rule may prefer different values; easily changed as named constants |

---

## Open Questions

1. **What if the most recent snapshot has no strategy set (strategy === null)?**
   - What we know: `getDailyAvg` falls back to GMV bucket; output is still produced.
   - What's unclear: Should the panel show a warning nudging the user to set a strategy first, or silently use the GMV default?
   - Recommendation: Show a subtle `Badge variant="outline"` note "(usando GMV como padrão)" beside the output when strategy is null — non-blocking, informative.

2. **Should the panel be visible before any analysis is run (snapshots.length === 0)?**
   - Recommendation: No — render `CompraRecomendadaPanel` only inside the `snapshots.length > 0` branch, same as `AnalisePrecosTable`. No empty-state needed for the panel itself.

3. **Should `estoqueFull + estoqueCasa` be validated to equal `estoqueTotal`?**
   - The formula for COMP-03 only uses `estoqueTotal`; `estoqueFull` and `estoqueCasa` are informational for COMP-04 (current FULL exposure).
   - Recommendation: Show a soft warning badge if `estoqueFull + estoqueCasa > estoqueTotal` but do not block calculation.

---

## Sources

### Primary (HIGH confidence)
- `src/components/mercadolivre/analise/AnaliseDashboard.tsx` — snapshot state, component structure, render tree
- `src/components/mercadolivre/analise/AnalisePrecosTable.tsx` — existing table pattern and Select usage
- `src/components/mercadolivre/analise/AnalysisProductCard.tsx` — card + badge rendering patterns
- `src/hooks/useAnalysisSnapshots.ts` — AnalysisSnapshot interface, strategy field
- `src/lib/analysis/types.ts` — PriceBucket.dailyAvg definition
- `src/components/ui/input.tsx` — Input component API
- `src/components/ui/select.tsx` — Select component API
- `src/pages/mercadolivre/MLPrecificacao.tsx` — tab structure, confirms no new tab needed
- `.planning/REQUIREMENTS.md` — COMP-01..04 requirements, out-of-scope constraints
- `CLAUDE.md` — stack constraints, naming conventions

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — confirms Phase 5 is complete and snapshots are live
- `.planning/PROJECT.md` — confirms "módulo de compras: usuário analisa um produto por vez"

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all UI primitives verified in codebase
- Architecture: HIGH — component tree and data flow verified by reading all upstream source files
- Business logic: HIGH — formulas taken verbatim from requirements; edge cases derived from formula analysis
- Pitfalls: MEDIUM — float equality pitfall is known JS behavior; others derived from component inspection

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (stable stack — no external dependencies to go stale)
