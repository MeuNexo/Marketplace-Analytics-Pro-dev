---
phase: 102
slug: simulador-manual-de-mco-na-p-gina-analise-precos-permitir-qu
status: draft
shadcn_initialized: true
preset: default (shadcn "default" style, baseColor slate, cssVariables true — components.json, pre-existing, unchanged since Phase 101)
created: 2026-07-19
---

# Phase 102 — UI Design Contract

> Visual and interaction contract for the manual "what-if" MCO simulator added **inside** the "Detalhamento de MCO" card (`PrecoPraticadoReport.tsx`) built in Phase 101. 100% additive to an already-specified card — this contract only locks down what CHANGES/ADDS on top of `101-UI-SPEC.md`; everything not mentioned here (header badge, waterfall row order/labels when NOT simulating, Meta MCO% field, recommendation block copy, warning footer) stays exactly as Phase 101 shipped it.

**Scope reminder (from 102-CONTEXT.md/102-RESEARCH.md):** Pure client-side, ephemeral toggle. No new page, no new modal, no new backend. Toggle "Simular" turns waterfall Row values into editable fields; MC/un + MCO/un + semáforo recompute live (D-04); the two recommendation levers (preço mínimo, ACOS-alvo) stay anchored to REAL data and never visually or functionally react to the simulated inputs — this contract must make that anchoring visually legible, not just functionally true.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn (already initialized — `components.json` present, style "default", baseColor slate, cssVariables true). No re-init, no new preset. |
| Preset | not applicable (pre-existing project) |
| Component library | Radix UI primitives via shadcn/ui — reuses `Switch`, `Badge`, `Button` (all already imported in `PrecoPraticadoReport.tsx`). **No shadcn `Input` component** — per the established codebase convention (Meta MCO% field, `SimuladorPrecificacao.tsx`), numeric edit fields are raw `<input>` elements with Tailwind classes, not the shadcn `Input` wrapper. New `SimField` inputs follow this same raw-`<input>` convention. |
| Icon library | lucide-react 1.7.0 (already a project dependency). **One new import for this phase:** `RotateCcw` for the "Resetar" button (semantically distinct from `RefreshCw`, already used elsewhere in this file for loading spinners — reusing it for Resetar would blur "loading" vs. "reset" meaning). No icon added to the "Simular" toggle itself (mirrors the existing icon-less "Incluir publicidade" `Switch`+`Label` pair, lines 713-722). |
| Font | Plus Jakarta Sans (project-wide, unchanged) |

---

## Spacing Scale

No new tokens. Reuses the exact scale locked in `101-UI-SPEC.md`:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Gap between a `SimField` input and its unit suffix label (`R$`/`%`) |
| sm | 8px | Vertical rhythm between waterfall rows (`space-y-2`, unchanged from 101); horizontal gap between header controls (toggle, badges, Resetar button) |
| md | 16px | Card internal padding (unchanged) |
| lg | 24px | Card-to-card spacing above (unchanged) |

Exceptions: none — no new spacing value introduced. The simulated-mode "tinted panel" wrapping the waterfall block (see Color/Layout below) uses the existing `p-2`/`-mx-2` padding-offset idiom already used elsewhere in this file (e.g. verdict card, line 793), not a new token.

---

## Typography

No new sizes or weights. Reuses the exact 3-size/2-weight scale locked in `101-UI-SPEC.md` (12px / 14px / 20px; 400 regular / 600 semibold).

| Role | Size | Weight | Line Height | Notes for this phase |
|------|------|--------|-------------|----------------------|
| Body (row label, unit suffix) | 12px (`text-xs`) | 400 regular | 1.5 | Unit suffix (`R$`/`%`) next to each `SimField`, same size/weight as the row label it replaces nothing of — label stays untouched, only the value slot becomes editable |
| Label (SimField input value, badges) | 12px (`text-xs`) with `font-semibold tabular-nums` | 600 semibold | 1.5 | Identical typographic treatment to the existing Meta MCO% input (`text-xs`, `tabular-nums`) — a simulated field must never look "bigger" or "louder" than the real-data fields around it |
| Heading (card title, unchanged) | 14px | 600 | 1.2 | No change |
| Display (recommendation numbers, unchanged) | 20px | 600 | 1.2 | No change — reinforces that recommendation stays visually the same weight/size regardless of simulating state (it is NOT reacting) |

`tabular-nums` mandatory on every `SimField` input and every recomputed value (MC/un, MCO/un, semáforo %) — same rule as 101, critical here because values change on every keystroke and must not cause column/row width jitter.

---

## Color

No new color tokens. Reuses the existing 60/30/10 system + the semáforo tokens from `101-UI-SPEC.md` verbatim. This phase adds exactly one new semantic role: **"simulation mode" indicator**, built entirely from tokens already declared in `src/index.css`.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `hsl(var(--background))` / `hsl(var(--card))` | Unchanged |
| Secondary (30%) | `hsl(var(--muted))` / `hsl(var(--border))` | Unchanged |
| Accent (10%) | `hsl(var(--accent))` | Reserved for (Phase 101 list, UNCHANGED) card title icon / Meta MCO% focus ring / `Target` icon — **PLUS, new in this phase:** the "Simular" `Switch` checked state (shadcn default, no override needed), every `SimField` input border/focus ring (`border-accent/40` + `ring-1 ring-accent/30` — literally the same classes already used by the Meta MCO% input, lines 988), the "Simulando" `Badge`, and the tinted background wash behind the waterfall block while simulating (`bg-accent/5`) |
| Destructive | `hsl(var(--destructive))` | Unchanged — reserved for "meta impraticável"/"inatingível" states and the 🔴 semáforo `critical` role only. **Never used for the simulation indicator** — a simulation is not an error/danger state, it's an accent/informational one, even if the simulated MCO happens to be in the red zone (the semáforo, not the simulation chrome, carries that signal) |

Semáforo (3-state, reused verbatim from Phase 101 / `mcoHealth.ts`) — **now dynamic during simulation (D-04):**

| McoColorRole | Token | Meaning | Behavior when `simulating=true` |
|---|---|---|---|
| `critical` | `text-destructive` / `bg-destructive/15` | MCO% ≤ 5 | Badge/value recolors live as the user types, using `simCard.mcoPct` instead of `waterfallCard.mcoPct` |
| `warning` | `text-warning` / `bg-warning/15` | 5 < MCO% < 9 | idem |
| `good` | `text-success` / `bg-success/15` | MCO% ≥ 9 | idem |
| `neutral` | `text-muted-foreground` | precoUnit ≤ 0 (new edge case only the simulator can produce, Pitfall 5) | idem — `pctFmt(null)` renders "—", never `NaN`/`Infinity` |

**Explicit non-collision rule:** the "is this a simulation" signal (accent blue: badge, border, background wash) and the "is this MCO healthy" signal (success/warning/destructive semáforo) are two DIFFERENT colors families that never overlap on the same element. A simulated-and-critical state shows an accent-tinted panel containing a destructive-red MCO value/badge — never a red panel. This keeps "you are simulating" (accent) and "the result is bad" (destructive) independently legible, matching the codebase-wide rule that color is never the only signal and is never overloaded with two meanings.

Accent reserved for (full list, 101 + 102 combined): card title icon, Meta MCO% input focus ring, `Target` icon on the 2 recommendation lines, "Simular" `Switch` active state, every `SimField` border/ring, "Simulando" `Badge`, tinted background wash on the waterfall block while simulating. Nothing else in this card uses accent.

---

## Simulator Layout & Interaction (Claude's Discretion, resolved)

Extends the Phase 101 card structure — **only the header row and the waterfall block change shape**; Meta MCO% row, recommendation block, and warning footer keep their exact 101 layout/copy (recommendation block gets one new caption line, see Copywriting Contract).

### 1. Header row (extended)
Existing 101 header (`Target` icon + "Detalhamento de MCO" + semáforo `Badge` + period label) gains, right of the semáforo badge and before the period label:
- **"Simular" toggle:** `Switch` + `Label` pair, same visual pattern as the existing "Incluir publicidade" toggle (`h-[switch-default] w-auto`, `Label` `text-xs text-muted-foreground cursor-pointer`), text "Simular".
- **When `simulating === true`, two more elements appear inline, in this order:**
  1. `Badge` variant `outline`, accent-tinted (`border-transparent bg-accent/15 text-accent`, mirroring the shape of `MCO_ROLE_BADGE_CLASS` but with the accent token, never a health-role token), text "Simulando".
  2. `Button` variant `ghost` size `sm`, `RotateCcw` icon (12px) + text "Resetar", `text-xs`.
- Header wraps responsively (`flex-wrap`, same rule as the page-level controls row, line 627) — on narrow width, the toggle/badge/Resetar group wraps to its own line below the title, period label stays right-aligned on desktop and moves below on mobile (matches the existing dual-layout mobile lesson already applied elsewhere in this file).

### 2. Waterfall block (extended)
When `simulating === true`, the entire waterfall `<div className="space-y-2">` block (101's structure) is wrapped in a tinted panel:
```
rounded-lg bg-accent/5 border border-accent/20 p-2 -mx-2
```
This is the primary "you are looking at hypothetical numbers" cue — it contains ALL 6 editable rows plus the MC/un and MCO/un subtotal rows (which stay read-only but recompute live), so the entire cascade the user is manipulating is visually boxed together, distinct from the Meta MCO%/recommendation/warning sections below it which are NOT part of the tinted zone (they read as "anchored/real" by contrast).

Each editable row (Receita/un, CMV, Comissão, Frete, Impostos, and — only when `incluirAds` — Ads) swaps its value slot from the plain `Row` `<span>` to a `SimField` input, keeping the row label (`k` prop) untouched:

| Field (D-01 order) | Unit | Input width | Min | Max |
|---|---|---|---|---|
| Receita/un (preço) | R$ | `w-20` (80px, same as Meta MCO% input) | ≥ 0 | — |
| CMV/un | R$ | `w-20` | ≥ 0 | — |
| Comissão | % | `w-20` | 0 | 100 |
| Frete/un | R$ | `w-20` | ≥ 0 | — |
| Impostos | % | `w-20` | 0 | 100 |
| Ads/un (only if `incluirAds`) | R$ | `w-20` | ≥ 0 | — |

Each `SimField` renders as: `<input>` (`w-20 rounded border border-accent/40 bg-background px-1.5 py-0.5 text-right text-xs outline-none ring-1 ring-accent/30 tabular-nums`, `type="text" inputMode="decimal"`) immediately followed by a static unit suffix (`R$` prefix rendered inside the row's value cell before the input, or `%` suffix rendered after it — 4px gap, `text-[10px] text-muted-foreground`), mirroring how the real Row already prints `brl()`/`pctFmt()` values with their unit baked in.

MC/un and MCO/un subtotal rows keep the exact 101 `Row` component (border-top divider, `font-semibold`), but their `v` prop is sourced from `simCard` (not `waterfallCard`) while `simulating === true`, and their `accent`/`danger` props follow `simCard`'s `mcoHealthRole`, not the real one. Visually identical chrome to 101 — only the data source changes.

### 3. Meta MCO% row — unchanged
Exactly as 101. Not inside the tinted panel. Not affected by `simulating`.

### 4. Recommendation block — unchanged, +1 caption
Exactly as 101's two lines (preço mínimo, ACOS-alvo), same 20px display numbers, same icons. **New, only when `simulating === true`:** a single caption line directly below the two recommendation rows, `text-[10px] text-muted-foreground` (same style as the existing helper text under Meta MCO%), making the "this doesn't move" invariant explicit to the user (see Copywriting Contract). This caption is the ONLY new element in this block — the numbers/icons/layout are pixel-identical to 101 whether simulating or not.

### 5. Warning footer — unchanged, unconditional
Exactly as 101, rendered based on `waterfallCard.custoAusente`/`impostoAusente` (real data quality) regardless of `simulating` — per Research's Open Question recommendation, these describe the real data behind the simulation, not the simulation itself, so they stay visible unconditionally.

No new modal/dialog, no new page route, no new Card. Single `Card`/`CardContent` block, same as 101.

---

## Interaction Contract (input format, validation, keyboard)

**Input format:** `type="text" inputMode="decimal"` (NOT native `type="number"`) — parsed with the existing `parseNumber()` from `src/lib/pricing/calculator.ts` (pt-BR aware: `"1.234,56"` → `1234.56`, degrades invalid input to `0` on live parse, never throws). This diverges intentionally from the Meta MCO% field's native `type="number"` because `parseNumber` is the established pattern for pt-BR decimal-comma input in this exact codebase (`SimuladorPrecificacao.tsx`) and the simulator needs comma-decimal support across 6 fields, not just one.

**Live recompute (D-04):** every keystroke that changes the draft string calls `onLiveChange(parseNumber(raw))` — the waterfall/semáforo update on every keystroke, no debounce, no blur-gate. This is a deliberate UX property: the user sees the semáforo/MC/MCO move as they type.

**Commit-time validation (D-05):** only on `blur` (or `Enter`, which triggers blur): parse the final draft, and if invalid (empty, or out of the field's min/max per the table above), show a `sonner` `toast.error(...)` and revert BOTH the visible input text and the value feeding the calculation to the last valid committed value — exact same UX contract as the existing Meta MCO% field (`commitMcoTargetEdit`, no silent clamping, no silent acceptance).

**Toast copy (D-05, mirrors Meta MCO%'s existing toast exactly in tone/length):**
- Currency fields (preço, CMV, frete, ads) rejected for < 0: `"Valor precisa ser maior ou igual a zero"`
- Percent fields (comissão, impostos) rejected for < 0 or > 100: `"Valor precisa estar entre 0% e 100%"`

**Keyboard:** `Tab` moves between `SimField`s in natural DOM/row order (top → bottom, matching the visual waterfall order) — no custom `tabIndex`. `Enter` blurs the current field (triggering commit-time validation), same behavior as Meta MCO%'s Enter handler. `Escape` is NOT specially handled in this phase (unlike Meta MCO%'s Escape-cancels-edit-mode, which doesn't apply here — there's no separate "enter edit mode" step per field; all 6 fields are simultaneously editable once `simulating=true`).

**Toggle ON / Resetar behavior:** both always re-seed the 6 `SimField` drafts from the LATEST real `waterfallCard` at the moment of the action (never a stale snapshot) — this is a functional requirement (Pitfall 3) with a direct visual consequence: turning "Simular" ON or clicking "Resetar" makes every `SimField` briefly flash back to showing the current real values before the user's next keystroke, which is expected and correct (not a bug to hide).

**Toggle OFF:** waterfall block returns to the plain 101 `Row` rendering (real `waterfallCard` values), tinted panel disappears, "Simulando" badge and "Resetar" button disappear. The 6 drafted values are NOT cleared from state (only their rendering stops) — re-toggling ON without an intervening item/variação change re-seeds from real data per the rule above anyway, so this has no visible effect on the user.

**Reset on item/variação change (D-03):** `simulating` snaps to `false` and the tinted panel/badge/Resetar button disappear instantly (no transition/animation) the moment `selectedId`/`selectedSku` changes — matches the instant re-render behavior already used for every other item-dependent state in this component.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Toggle label | "Simular" |
| "Simulando" badge (header, visible only while `simulating`) | "Simulando" |
| Resetar button | "Resetar" |
| Row labels (editable, same text as 101 — only editability changes, not wording) | "Receita/un" · "(−) CMV" · "(−) Comissão" · "(−) Frete" · "(−) Impostos" · "(−) Ads" (only when `incluirAds`) |
| Currency field validation error (toast) | "Valor precisa ser maior ou igual a zero" |
| Percent field validation error (toast) | "Valor precisa estar entre 0% e 100%" |
| Recommendation anchor caption (new, only while `simulating`) | "Preço mínimo e ACOS-alvo continuam calculados com os custos e preço reais — não mudam com a simulação" |
| Destructive action | None. "Resetar" is non-destructive and reversible (nothing is persisted — see 102-CONTEXT.md scope boundary); it needs no confirmation dialog, matching the phase's explicit "no backend, no persistence" constraint. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | `Switch`, `Badge`, `Button` (all already installed/imported from Phase 101/earlier — no new install this phase) | not required |
| lucide-react (not a shadcn registry, plain npm dependency already installed) | New icon import: `RotateCcw` | not applicable — icon import from an already-installed package, not a registry block |
| third-party | none declared | not applicable |

No third-party registry blocks requested or used. No new shadcn component installed — every primitive needed (`Switch`, `Badge`, `Button`, raw `<input>`) is already present in `src/components/ui/` or already used as a raw HTML element elsewhere in this exact file.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
