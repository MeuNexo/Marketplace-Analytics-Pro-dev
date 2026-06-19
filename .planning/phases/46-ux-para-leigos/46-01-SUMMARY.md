---
phase: 46-ux-para-leigos
plan: "01"
subsystem: frontend-ui
tags: [glossary, kpi, popover, empty-state, ux, primitives]
dependency_graph:
  requires: []
  provides:
    - src/lib/kpi-glossary.ts → GlossaryKey / GlossaryEntry / KPI_GLOSSARY
    - src/components/ui/empty-state.tsx → EmptyState
    - src/components/dashboard/KPICard.tsx → Popover hybrid hover+tap trigger
  affects:
    - Plans 02 and 03 consume KPI_GLOSSARY for wiring tooltips at ~16 KPI sites
    - Plans 02 and 03 consume EmptyState for replacing ~8 ad-hoc empty states
tech_stack:
  added: []
  patterns:
    - Radix Popover controlled via useState (hover+tap hybrid, replaces Tooltip)
    - Named-export-only TS module with union type + Record (glossary pattern)
    - shadcn/ui function component with interface props (EmptyState)
key_files:
  created:
    - src/lib/kpi-glossary.ts
    - src/components/ui/empty-state.tsx
  modified:
    - src/components/dashboard/KPICard.tsx
decisions:
  - "Popover over Tooltip: Radix Tooltip does not fire on touch (Pitfall 1); Popover with controlled open state is reliable on iOS/Android"
  - "tooltip prop remains string (not GlossaryKey) — KPICard stays generic; consumers do the lookup"
  - "EmptyState as function component (not forwardRef) because it has domain props (icon/title/description/actionLabel/actionHref/onAction/size)"
  - "Comment mentioning dangerouslySetInnerHTML removed from JSDoc to keep automated grep-verification clean (T-46-01)"
metrics:
  duration: "~4 minutes"
  completed: "2026-06-18"
  tasks_completed: 3
  files_changed: 3
---

# Phase 46 Plan 01: Primitivos Compartilhados Summary

**One-liner:** Glossário central de 27 KPIs tipados + Popover hover+tap no KPICard + componente EmptyState reutilizável, todos prontos para consumo pelos planos 02 e 03.

## What Was Built

### Task 1 — src/lib/kpi-glossary.ts (new)

Central glossary as single source of truth (D-01). Pure TypeScript module, no runtime dependencies, named exports only.

- `GlossaryKey` — union type of 27 keys (receita_total through margem_pos_ads)
- `GlossaryEntry` — interface `{ term, definition, example? }`
- `KPI_GLOSSARY: Record<GlossaryKey, GlossaryEntry>` — covers all 27 keys; TypeScript enforces exhaustiveness

All definitions written in plain lojista language (D-03), 1 sentence, with optional concrete example. Wesley reviews final wording at the Plan 04 checkpoint.

**Commit:** d860baa0

### Task 2 — src/components/dashboard/KPICard.tsx (modified)

Replaced `<TooltipProvider><Tooltip>` block (lines 94–106) with a `useState`-controlled `<Popover>` (D-02).

- Import of `@/components/ui/tooltip` removed; `Popover/PopoverContent/PopoverTrigger` added
- Trigger is a `<button>` with `HelpCircle` icon; opens on `onMouseEnter` (desktop hover) and toggles on `onClick` with `e.stopPropagation()` (mobile tap)
- `<PopoverContent>` overrides the default `w-72` with `className="w-auto max-w-[240px] px-3 py-2 text-xs"` (Pitfall 4 avoided) and sets `onOpenAutoFocus={(e) => e.preventDefault()}`
- Prop `tooltip?: string` unchanged — component remains generic

**Commit:** 16c6b0f3

### Task 3 — src/components/ui/empty-state.tsx (new)

Reusable EmptyState component following shadcn/ui project pattern (D-04). Named export, no default export.

- Props: `icon: LucideIcon`, `title`, `description`, `actionLabel?`, `actionHref?`, `onAction?`, `size?: "default" | "compact"`, `className?`
- CTA renders `<Button asChild><Link to={actionHref}>` when `actionHref` present, `<Button onClick={onAction}>` when `onAction` present, nothing when `actionLabel` absent
- All strings rendered as plain JSX text — no dynamic innerHTML (T-46-01 mitigated)
- `size="compact"` uses `py-10` + `w-8 h-8` icon; `size="default"` uses `py-16` + `w-12 h-12`

**Commit:** 52ddc64d

## Verification Results

- `npx tsc --noEmit` — PASS (exit 0, no errors)
- `npm run build` — PASS (clean build, pre-existing chunk size warning unrelated)
- `KPI_GLOSSARY` exported: OK
- KPICard uses Popover, no tooltip import: OK
- EmptyState named export, no dangerouslySetInnerHTML: OK

## Deviations from Plan

None — plan executed exactly as written.

**Minor note:** The JSDoc comment in EmptyState originally mentioned the forbidden pattern by name (in a comment documenting the prohibition). The automated grep verification `! grep -q "dangerouslySetInnerHTML"` would fail on comment text, so the comment was reworded to `"sem innerHTML dinâmico (T-46-01)"`. Behavior unchanged.

## Known Stubs

None. This plan produces static/presentational primitives — no data wiring deferred. The 27 glossary definitions are first-pass drafts pending Wesley's review at Plan 04 checkpoint (per D-03: "agentes redigem; Wesley revisa").

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. Components are purely presentational client-side; all content is static. T-46-01 (XSS via string render) mitigated by design.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/lib/kpi-glossary.ts | FOUND |
| src/components/ui/empty-state.tsx | FOUND |
| src/components/dashboard/KPICard.tsx | FOUND |
| commit d860baa0 (kpi-glossary) | FOUND |
| commit 16c6b0f3 (KPICard popover) | FOUND |
| commit 52ddc64d (EmptyState) | FOUND |
