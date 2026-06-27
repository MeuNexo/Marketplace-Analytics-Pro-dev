---
phase: 54-pipeline-de-a-es-com-aprova-o
plan: "03"
subsystem: ui
tags: [react, shadcn, tanstack-query, mercadolivre, consultor, action-queue]

requires:
  - phase: 54-pipeline-de-a-es-com-aprova-o
    provides: "useConsultorActions hook (54-02) and consultor-actions EF (54-01)"
  - phase: 54-pipeline-de-a-es-com-aprova-o
    provides: "actionMapping.ts RULE_TO_ACTION + buildActionFromInsight (54-02)"

provides:
  - "ProposeActionDialog: modal with conditional numeric input for update_price/update_ads_budget; fixed summary for pause/activate actions; propose() + toast"
  - "ActionQueue: Card per queued action with diff preview, staleness badge (>24h), Approve inside AlertDialog (irreversible confirmation), Reject button"
  - "ActionHistory: Table of done/failed rows with result_summary badge (green/red) and executed_at"
  - "MLConsultor refactored into Tabs: Insights | Fila | Histórico — Fila and Histórico tabs + pendingCount badge are owner-only (orgRole==='owner')"

affects:
  - "54-03 checkpoint visual (Wesley)"
  - "Phase 55+ if more action types are added to RULE_TO_ACTION"

tech-stack:
  added: []
  patterns:
    - "Owner gate via useOrganization().orgRole: non-owner sees Insights-only, no queue leak (T-54-14)"
    - "AlertDialog wrapping irreversible approve action (T-54-15)"
    - "Staleness badge computed from created_at > 24h client-side (ACT-07 UI)"
    - "Conditional input: numeric for update_price/update_ads_budget; fixed summary for pause/activate"

key-files:
  created:
    - src/components/mercadolivre/ProposeActionDialog.tsx
    - src/components/mercadolivre/ActionQueue.tsx
    - src/components/mercadolivre/ActionHistory.tsx
  modified:
    - src/pages/mercadolivre/MLConsultor.tsx

key-decisions:
  - "Non-numeric actions (pause/activate) use fixed ProposedValue objects — no user input beyond confirmation"
  - "pendingCount fetched from useConsultorActions() in MLConsultor; TanStack Query deduplicates the network call shared with ActionQueue"
  - "Non-owner renders insightsList directly without Tabs component, never mounts ActionQueue/ActionHistory (zero queue leak)"
  - "Diff preview in ActionQueue: current_value shown as — when null (pre-dryRun); proposed_value always visible from INSERT"

patterns-established:
  - "Gate: orgRole==='owner' for any owner-only UI section; check at page level before mounting queue components"
  - "AlertDialog for irreversible ML-side actions (establishes pattern for future action types)"

requirements-completed: ["ACT-01", "ACT-02", "ACT-03", "ACT-07", "ACT-08"]

duration: 5min
completed: "2026-06-27"
status: checkpoint
---

# Phase 54 Plan 03: UI da Fila de Aprovação — Summary

**ProposeActionDialog + ActionQueue + ActionHistory plugados em MLConsultor como Tabs Insights|Fila|Histórico owner-only, com botão "Propor ação" nos insights acionáveis, AlertDialog na aprovação e badge de staleness >24h**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-27T19:25:48Z
- **Completed:** 2026-06-27T19:30:17Z
- **Tasks:** 2/3 (Task 3 = checkpoint:human-verify, paused awaiting Wesley)
- **Files modified:** 4

## Accomplishments

- `ProposeActionDialog`: modal owner-driven com input numérico condicional (update_price/update_ads_budget) e resumo fixo para pause/activate; valida valor>0; chama propose() do hook 54-02 com toast de sucesso
- `ActionQueue`: Card por ação pendente/aprovada com diff atual→proposto, impacto BRL, badge de staleness >24h (ACT-07), Aprovar dentro de AlertDialog (execução irreversível, T-54-15) e Rejeitar
- `ActionHistory`: Table com done/failed, result_summary Badge verde/vermelho e executed_at formatado (ACT-08)
- `MLConsultor` refatorado em Tabs: score header + insights preservados na aba Insights; Fila e Histórico owner-only; badge de pendingCount na aba Fila

## Task Commits

1. **Task 1: ProposeActionDialog + botão Propor ação nos insights** - `7f58da19` (feat)
2. **Task 2: ActionQueue + ActionHistory + abas owner-only** - `c49d3ec2` (feat)
3. **Task 3: Checkpoint visual** — aguardando verificação do Wesley no preview Vercel

## Files Created/Modified

- `src/components/mercadolivre/ProposeActionDialog.tsx` — modal com input condicional, impacto BRL do insight, validação e propose()
- `src/components/mercadolivre/ActionQueue.tsx` — fila de ações com diff, staleness badge, AlertDialog para aprovar, rejeitar
- `src/components/mercadolivre/ActionHistory.tsx` — tabela histórico done/failed com result_summary e executed_at
- `src/pages/mercadolivre/MLConsultor.tsx` — Tabs Insights|Fila|Histórico, gate orgRole==='owner', pendingCount badge, botão Propor ação em InsightCard

## Decisions Made

- Non-numeric actions (pause/activate) usam `ProposedValue` fixo (`{ status: "paused" }` / `{ status: "active" }`) — sem input extra do owner além da confirmação
- `pendingCount` é obtido via `useConsultorActions()` no próprio `MLConsultor` (TanStack Query deduplica a query com `ActionQueue`)
- Non-owner não monta os componentes de fila: renderiza `insightsList` diretamente sem `Tabs`, garantindo zero vazamento de dados (T-54-14)
- Diff na Fila: `current_value` exibido como "—" quando null (antes do dryRun); `proposed_value` sempre visível do INSERT

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None — todos os campos exibidos têm fonte real de dados (insight.impact_brl, proposed_actions.proposed_value, etc.).

## Threat Flags

No new security surface introduced. All T-54-14/T-54-15/T-54-16/T-54-17 mitigations applied:
- T-54-14: Fila/Histórico renderizados somente para owner (orgRole check client-side; RLS da Phase 52 é a barreira real)
- T-54-15: AlertDialog de confirmação antes de approve()
- T-54-16: Badge de staleness >24h presente em ActionQueue
- T-54-17: approve() chama hook que grava approved_by/approved_at

## Gate Checks

- `tsc --noEmit`: 0 errors
- `npm run build`: ok (built in ~17s)
- `npx vitest run`: 278/278 tests pass (17 files)

## Next Phase Readiness

- Task 3 (checkpoint:human-verify) aguarda ok visual do Wesley no preview Vercel
- Após aprovação: merge da branch `gsd/phase-54-pipeline-acoes-ui` e close das requirements ACT-01..ACT-08

---
*Phase: 54-pipeline-de-a-es-com-aprova-o*
*Completed: 2026-06-27*

---

## Task 3 — Checkpoint visual AGUARDANDO Wesley (preview PR #19)

UI construída e no preview Vercel (/consultor). **AGUARDANDO** Wesley ver a página e validar o fluxo propor → fila → aprovar → histórico + gate owner-only. (Registro anterior de "aprovado" foi prematuro — corrigido.)
