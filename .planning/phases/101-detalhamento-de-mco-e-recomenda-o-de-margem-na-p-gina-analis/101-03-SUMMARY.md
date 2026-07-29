---
phase: 101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis
plan: 03
subsystem: frontend-mco-detail-card
tags: [mco, pricing, useMcoTargets, PrecoPraticadoReport, analise-precos, checkpoint]
status: complete
dependency-graph:
  requires:
    - src/lib/precoMcoSeries.ts (computeWaterfallCard — Plan 02)
    - src/lib/pricing/mcoRecommendation.ts (computeMcoRecommendation — Plan 02)
    - src/lib/mcoHealth.ts (classifyMcoHealth, mcoHealthRole, MCO_SAUDAVEL_PCT — Phase 83)
    - src/hooks/useMLProductCosts.ts (structural analog)
  provides:
    - src/hooks/useMcoTargets.ts (useMcoTargets — org-scoped fetch + optimistic upsert of ml_mco_targets)
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx (fixed MCO detail + recommendation card)
  affects:
    - /analise-precos page (new card below the price×break-even chart)
tech-stack:
  added: []
  patterns:
    - "useMcoTargets mirrors useMLProductCosts 1:1: org-scoped fetch on mount, optimistic Map upsert, onConflict upsert to Supabase"
    - "sku sentinel normalized to \"\" (never null) on both read and write for the composite key item_id::sku"
    - "Row (ChartTooltip's row formatter) promoted to module scope so both the Phase 79 tooltip and the new card reuse identical row rendering"
    - "Card is pure presentation over Plan 02's computeWaterfallCard/computeMcoRecommendation — no new calculation logic in the component"
key-files:
  created:
    - src/hooks/useMcoTargets.ts
  modified:
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
    - src/components/mercadolivre/anuncios/PrecoPraticadoReport.test.tsx
decisions:
  - "No delete path for custom targets (out of scope per plan) — clearing a target back to the semáforo default is deferred"
  - "supabase.from(\"ml_mco_targets\") left untyped in types.ts, consistent with Phase 90-04 precedent (ml_claims, ml_claim_templates)"
metrics:
  duration: ~25min
  completed: 2026-07-19
---

# Phase 101 Plan 03: MCO Detail + Recommendation Card Summary

Wired the persistence hook (`useMcoTargets`) and rendered the fixed "Detalhamento de MCO" card in `PrecoPraticadoReport.tsx` on `/analise-precos`: the per-unit MCO waterfall, a semáforo badge reusing the Phase 83 `mcoHealth` band, an editable per-item "Meta MCO%" that persists across reloads, and both always-visible recommendation levers (preço mínimo, ACOS-alvo). Wesley reviewed the deployed card in production and approved it ("Ficou bom, gostei") — no fixes requested.

## What Was Built

### Task 1 — `useMcoTargets` hook (`src/hooks/useMcoTargets.ts`)

- Mirrors `useMLProductCosts` structure: fetches all `ml_mco_targets` rows for `currentOrg.id` on mount, builds a `Map<string, number>` keyed by `keyOf(itemId, sku) = itemId + "::" + (sku ?? "")`.
- `upsert(itemId, sku, pct)` optimistically updates the Map, then upserts to Supabase with `onConflict: "organization_id,item_id,sku"`.
- `sku` normalized to `""` (never `null`) on both read and write — avoids the composite-key sentinel mismatch pitfall documented in RESEARCH/PATTERNS.
- Returns `{ targets, keyOf, upsert, refetch }`. No delete path; no RPC; `ml_mco_targets` left out of `types.ts` per the Phase 90-04 precedent.
- Guards on missing `currentOrg`/`currentOrg.id` (no-op + `console.warn`).

### Task 2 — MCO detail + recommendation card (`PrecoPraticadoReport.tsx`)

- Promoted the local `Row` component (previously nested inside `ChartTooltip`) to module scope so both the existing Phase 79 tooltip and the new card render rows identically — tooltip output byte-for-byte unchanged (D-03).
- New fixed `Card` below the price×break-even chart, driven by `computeWaterfallCard(rows, opts)` for the selected item/sku/period + `incluirAds` toggle, and `computeMcoRecommendation(card, targetPct)` for the two levers — both pure utils from Plan 02, no re-derived math.
- Waterfall rows render in the fixed order (Receita/un → CMV → Comissão → Frete → Impostos → = Margem de Contribuição/un → Ads (only when `incluirAds` ON) → = MCO/un), each with R$ and % side by side.
- Semáforo badge shows `pctFmt(mcoPct)` colored via `mcoHealthRole(classifyMcoHealth(mcoPct))` — same 5/9 band as Phase 83, value always shown alongside color.
- "Meta MCO%" inline-edit input (InlineEditCell-style, onBlur/Enter): pre-fills the custom target from `useMcoTargets` if set, else shows the semáforo-default helper copy; client validation rejects 0/negative/>100 with a sonner toast and skips the upsert.
- Both recommendation levers (preço mínimo, ACOS-alvo) always render, including impossible-state copy ("Meta impraticável...", "Meta inatingível mesmo sem gastar em ads") — never hidden when MCO is healthy.
- `custoAusente`/`impostoAusente` reuse the existing warning footer copy verbatim; zero-sales periods show the UI-SPEC empty-state copy; no invented numbers.
- Component test extended: asserts the card renders the waterfall rows and both recommendation labels for a sales fixture, and shows empty-state copy for a zero-sales period.

### Task 3 — Visual approval checkpoint (Wesley)

Wesley reviewed the card at `https://marketplace-analytics-pro-dev.vercel.app/analise-precos` after merging PR #32 to `main` and deploying to production. Verdict: **"Ficou bom, gostei."** No visual or interaction issues reported — checkpoint closed as approved.

## Deviations from Plan

None — plan executed exactly as written across all three tasks.

## Verification

```
npx tsc --noEmit        → clean (Task 1 + Task 2)
npx vitest run src/components/mercadolivre/anuncios  → 61 passing
npm run build            → clean
```

Task 2 commit message confirms: "tsc clean, 61 vitest passing (anuncios dir), build clean."

## Known Stubs

None. Both the hook and the card are fully wired to real data (`ml_mco_targets` via Supabase, `computeWaterfallCard`/`computeMcoRecommendation` from Plan 02) — no placeholder values, no hardcoded empty defaults reaching the UI.

## Threat Flags

None new. `T-101-05` (out-of-range Meta MCO%) mitigated via client-side validation + toast before upsert (DB CHECK from Plan 01 is the backstop). `T-101-01` (IDOR on targets) mitigated — the hook always scopes by `currentOrg.id` from session context, never a client-typed org. `T-101-04` (invented numbers) mitigated — custoAusente/impostoAusente warnings reused verbatim, no NaN/Infinity paths (guarded upstream in Plan 02's utils).

## Self-Check: PASSED

- FOUND: src/hooks/useMcoTargets.ts
- FOUND: src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx (computeWaterfallCard/computeMcoRecommendation/useMcoTargets wired)
- FOUND: src/components/mercadolivre/anuncios/PrecoPraticadoReport.test.tsx
- FOUND commit 7a76b3d2
- FOUND commit b0b22772
