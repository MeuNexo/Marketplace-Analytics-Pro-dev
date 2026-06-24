---
phase: 54-pipeline-de-a-es-com-aprova-o
plan: 02
subsystem: consultor-actions
tags: [frontend, hooks, consultor, proposed_actions, tanstack-query]
requires:
  - public.proposed_actions (RLS Phase 52)
  - supabase/functions/consultor-actions (plano 54-01)
  - src/hooks/useConsultorInsights.ts (InsightRow)
provides:
  - useConsultorActions (queue/badge/propose/dryRun/approve/reject/history)
  - actionMapping (RULE_TO_ACTION, targetRefFromInsight, buildActionFromInsight)
affects:
  - 54-03 (UI da fila consome este hook)
tech-stack:
  added: []
  patterns:
    - TanStack Query v5 org-scoped (espelha useConsultorInsights)
    - módulo puro em src/lib/ para teste unit sem mock de Supabase
key-files:
  created:
    - src/lib/consultor/actionMapping.ts
    - src/lib/consultor/actionMapping.test.ts
    - src/hooks/useConsultorActions.ts
    - src/hooks/useConsultorActions.test.ts
  modified: []
decisions:
  - "D-A4: RULE_TO_ACTION centralizado e testado (rule_key→action_type), aberto a revisão do Wesley"
  - "D-A2: proposedValue é parâmetro de entrada do propose(); estimated_impact_brl = insight.impact_brl (não recalculado)"
  - "target_ref vem APENAS do action_href ?items= (insights NÃO tem coluna item_id)"
metrics:
  duration: ~7min
  completed: 2026-06-24
  tasks: 2
  files: 4
status: complete
---

# Phase 54 Plan 02: Camada de dados da fila de ações (useConsultorActions + actionMapping) Summary

Hook `useConsultorActions` (TanStack Query v5, org-scoped) + módulo puro `actionMapping` que converte um insight do Consultor numa row de `proposed_actions` — mapa `rule_key`→`action_type` (D-A4), `target_ref` extraído do `action_href ?items=`, e `estimated_impact_brl` = `insight.impact_brl` (sem recálculo). Sem UI (54-03 consome). Zero dependências novas.

## O que foi construído

### Task 1 — `src/lib/consultor/actionMapping.ts` (+ teste)
- `ActionType` espelhando o CHECK do schema (5 valores).
- `RULE_TO_ACTION: Record<string, ActionType>` (D-A4): `margin_critical`/`margin_alert`→`update_price`; `ads_eating_margin`/`tacos_high`/`ads_no_sale`→`pause_ads_campaign`; `listing_inactive`→`activate_listing`; `listing_no_movement`→`pause_listing`. Documentado como decisão de produto aberta a revisão.
- `targetRefFromInsight(insight)` — extrai via `new URLSearchParams((action_href??'').split('?')[1]??'').get('items')`; `null` sem `?items=`. **Nunca referencia `insight.item_id`** (a tabela `insights` não tem essa coluna — confirmado em `types.ts:296-316`).
- `buildActionFromInsight(insight, orgId, userId, proposedValue)` — monta o `proposed_actions` Insert. `action_type = RULE_TO_ACTION[rule_key]` (lança erro se ausente); `target_ref` lança erro se nulo; `status='proposed'`; `current_value=null` (preenchido pelo dry_run/executor); `estimated_impact_brl = insight.impact_brl` (igualdade testada).
- 11 testes vitest: mapa, extração de target_ref (com e sem `?items=`), build com proposed_value, impact não recalculado, erro em rule_key desconhecida, erro sem target_ref.

### Task 2 — `src/hooks/useConsultorActions.ts` (+ teste)
- Espelha `useConsultorInsights`: `useOrganization().currentOrg.id`, `useQuery`/`useMutation`/`useQueryClient`, `enabled: !!orgId`, `queryKey` org-scoped, `onSuccess → invalidateQueries`.
- `queueQuery` — `proposed_actions` WHERE org AND `status IN ('proposed','approved')` ORDER BY `created_at` desc → `pendingCount` (ACT-02).
- `propose(insight, proposedValue)` — usa `buildActionFromInsight` e faz INSERT (ACT-01); `userId` via `supabase.auth.getUser()` (RLS valida `auth.uid()` de qualquer forma).
- `dryRun(actionId)` — `invoke("consultor-actions", { action_id, dry_run: true })` (ACT-01).
- `approve(actionId)` — UPDATE `status='approved'`+`approved_by`+`approved_at` (org-scoped) E DEPOIS `invoke("consultor-actions", { action_id, dry_run: false })` (ACT-03).
- `reject(actionId)` — UPDATE `status='rejected'` (ACT-03).
- `historyQuery` — `status IN ('done','failed')` ORDER BY `executed_at` desc nulls-last `.range(0, 49)` (ACT-08, paginação PostgREST).
- 3 testes vitest (`renderHook` + mock de `@/integrations/supabase/client` e `useOrganization`): `pendingCount === 3` (2 proposed + 1 approved; exclui done), query org-scoped via `from('proposed_actions')`, e estado vazio quando `orgId` é null.

## Decisões / Notas de domínio
- **target_ref**: a única fonte é `action_href ?items=` — a tabela `insights` não tem `item_id`. Referenciar `insight.item_id` quebraria o `tsc`.
- **impact não recalculado**: `estimated_impact_brl` herda direto de `insight.impact_brl` (REQUIREMENTS:19 / D-A2).
- **proposedValue parametrizado**: para `pause_*`/`activate_*` é objeto de status fixo; para `update_price`/`update_ads_budget` é o número do owner (vem do modal em 54-03).

## Deviations from Plan
None — plano executado exatamente como escrito. Único ajuste mecânico: o parser SWC do Vite recusava reticências `...` dentro de um exemplo em JSDoc no `actionMapping.ts`; reescrevi o comentário (sem efeito em código/comportamento).

## Verificação
- `npm run test -- src/lib/consultor/actionMapping.test.ts src/hooks/useConsultorActions.test.ts` → **14 passed (11 + 3)**.
- `npx tsc --noEmit` → **exit 0** (clean).
- `npm run build` → **exit 0** (warning de chunk-size pré-existente, não relacionado).
- Greps de aceitação: `invoke("consultor-actions"` com `dry_run: true` e `dry_run: false`; `.range(` na history; 4× `.eq("organization_id", orgId)`; `buildActionFromInsight` consumido pelo `propose`.

## Out of scope (conforme prompt)
Sem git commit, sem deploy, sem mudança de DB. UI (54-03) e EF `consultor-actions` (54-01) fora deste plano.

## Self-Check: PASSED
- src/lib/consultor/actionMapping.ts — FOUND
- src/lib/consultor/actionMapping.test.ts — FOUND
- src/hooks/useConsultorActions.ts — FOUND
- src/hooks/useConsultorActions.test.ts — FOUND
- Tests: 14 passed | tsc: clean | build: passed
