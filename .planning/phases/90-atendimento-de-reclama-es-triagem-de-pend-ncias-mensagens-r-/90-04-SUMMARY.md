---
phase: 90-atendimento-de-reclama-es-triagem-de-pend-ncias-mensagens-r-
plan: 04
subsystem: ui
tags: [react, typescript, tanstack-query, supabase, mercadolivre, claims, templates, vitest]

# Dependency graph
requires:
  - phase: 90-02 (ml_claim_templates + buyer_first_name)
    provides: "Tabela public.ml_claim_templates com RLS org-first (SELECT/INSERT/UPDATE/DELETE via is_org_member) + ml-claim-detail (v3) retornando buyer_first_name capitalizado"
provides:
  - "src/lib/applyTemplate.ts — substituição pura de variáveis {{nome}}/{{produto}}/{{pedido}}, tokens desconhecidos mantidos literais"
  - "src/hooks/useClaimTemplates.ts — query + CRUD (create/update/delete) org-scoped sobre ml_claim_templates"
  - "src/components/mercadolivre/ClaimTemplatesDialog.tsx — dialog CRUD com legenda de variáveis e prévia ao vivo"
  - "ClaimDetailSheet: seletor 'Usar modelo' (preenche o textarea editável) + botão 'Gerenciar modelos'"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "applyTemplate: regex única sobre tokens {{key}}; chave ausente/undefined em vars é mantida literal (nunca imprime 'undefined') — caller decide o fallback (ex.: nome: buyer_first_name ?? 'cliente')"
    - "Hook CRUD org-scoped sem tabela nos generated types.ts (ml_claims/ml_claim_templates): supabase.from('table_name') segue tipando OK porque o overload genérico do postgrest-js aceita string quando a tabela não está em Database — sem necessidade de regenerar types.ts nem usar 'as any' no .from()"
    - "organization_id sempre de useOrganization().currentOrg.id, created_by sempre de useAuth().user.id — nunca client args (mesmo padrão anti-IDOR de useConsultorActions.ts)"

key-files:
  created:
    - src/lib/applyTemplate.ts
    - src/lib/applyTemplate.test.ts
    - src/hooks/useClaimTemplates.ts
    - src/components/mercadolivre/ClaimTemplatesDialog.tsx
  modified:
    - src/hooks/useMLClaimMessages.ts
    - src/components/mercadolivre/ClaimDetailSheet.tsx

key-decisions:
  - "applyTemplate trata chave ausente (undefined) igual a chave desconhecida: token fica literal em ambos os casos — o caller (ClaimDetailSheet) já resolve nome: buyer_first_name ?? 'cliente' antes de chamar, então na prática 'undefined' nunca aparece na tela"
  - "useClaimTemplates filtra update/delete por id AND organization_id (defesa em profundidade além da RLS) — mesmo padrão de useConsultorActions"
  - "Não foi necessário editar src/integrations/supabase/types.ts: confirmado empiricamente que .from('ml_claims') (tabela já em uso desde Phase 90-01, também ausente do arquivo gerado) compila limpo; o mesmo vale para ml_claim_templates"
  - "Seletor 'Usar modelo' e botão 'Gerenciar modelos' só aparecem dentro do branch canMessage — reclamações encerradas continuam sem caixa de resposta, comportamento pré-existente preservado"

requirements-completed: [TPL-02, TPL-03]

# Metrics
duration: 12min
completed: 2026-07-07
status: complete
---

# Phase 90 Plan 04: Mensagens rápidas (templates) — frontend Summary

Seletor "Usar modelo" e dialog "Gerenciar modelos" dentro de `ClaimDetailSheet`, preenchendo a resposta ao comprador com o nome real, produto e pedido da reclamação atual — via uma função pura de substituição testada e um hook CRUD org-scoped sobre `ml_claim_templates` (tabela já em produção desde a Plan 90-02).

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-07T13:52:00Z
- **Completed:** 2026-07-07T13:59:00Z
- **Tasks:** 3/3 completed
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- `applyTemplate(body, vars)` — função pura, 7 testes vitest cobrindo substituição, variável desconhecida literal, variável conhecida ausente literal, ocorrências repetidas, corpo vazio, sem vars, e valor `""` explícito (que É substituído, diferente de `undefined`).
- `useClaimTemplates()` — query + create/update/delete sobre `ml_claim_templates`, sempre `organization_id` do contexto e `created_by` da sessão autenticada (nunca argumento do cliente); update/delete também filtram por `organization_id` como defesa em profundidade além da RLS.
- `ClaimTemplatesDialog` — CRUD completo (criar/editar/excluir com confirmação via AlertDialog), legenda das 3 variáveis disponíveis, prévia ao vivo do corpo com os dados da reclamação atual.
- `ClaimDetailSheet` ganhou o seletor "Usar modelo" (preenche o textarea, editável, sem auto-envio) e o botão "Gerenciar modelos" — sem tocar em `handleSend`, `handleAction` ou nos corpos de `reply-ml-claim`/`ml-claim-action` (confirmado via diff).
- `useMLClaimDetail` agora expõe `buyer_first_name: string | null`, consumido pelo seletor com fallback `"cliente"`.

## Task Commits

Each task was committed atomically:

1. **Task 1: applyTemplate pure fn + tests; useMLClaimMessages exposes buyer_first_name** - `1d478aec` (test)
2. **Task 2: useClaimTemplates hook (query + CRUD) + ClaimTemplatesDialog** - `fd4d48e9` (feat)
3. **Task 3: ClaimDetailSheet — "Usar modelo" selector + "Gerenciar modelos" button** - `ba94635e` (feat)

## Files Created/Modified
- `src/lib/applyTemplate.ts` - substituição pura de {{nome}}/{{produto}}/{{pedido}}, tokens desconhecidos literais
- `src/lib/applyTemplate.test.ts` - 7 casos vitest
- `src/hooks/useClaimTemplates.ts` - query + CRUD org-scoped sobre ml_claim_templates
- `src/components/mercadolivre/ClaimTemplatesDialog.tsx` - dialog CRUD com legenda + prévia
- `src/hooks/useMLClaimMessages.ts` - MLClaimDetail.buyer_first_name adicionado e mapeado
- `src/components/mercadolivre/ClaimDetailSheet.tsx` - seletor "Usar modelo" + botão "Gerenciar modelos"

## Deviations from Plan

None — plan executed exactly as written. No new dependencies added; no backend/EF files touched.

## Security / Threat Coverage

- **T-90-11 (Elevation of Privilege — templates de outra org):** `useClaimTemplates` sempre lê `organization_id` de `useOrganization().currentOrg.id` (nunca argumento), `created_by` sempre de `useAuth().user.id`; update/delete filtram por `id AND organization_id` além da RLS (Plan 90-02) já ativa em produção.
- **T-90-12 (Tampering — variável inesperada no corpo do modelo):** `applyTemplate` só substitui as chaves conhecidas passadas em `vars`; qualquer outro token `{{...}}` permanece literal (testado). O texto inserido no textarea continua totalmente editável e passa pelo dialog de confirmação de envio já existente antes de ir ao Mercado Livre.
- **T-90-13 (Repudiation — quem criou o modelo):** `created_by = auth.uid()` gravado no insert; metadado informativo de baixo risco, sem mudança de comportamento.

## Verification

- `npx tsc --noEmit` → limpo (3x, uma por task).
- `npx vitest run src` → 381/381 (inclui os 7 novos de `applyTemplate`).
- `npm run build` → build limpo (Task 2 e Task 3).
- Grep gates: `ml_claim_templates` + `organization_id` em `useClaimTemplates.ts`; `applyTemplate` em `ClaimTemplatesDialog.tsx` e `ClaimDetailSheet.tsx`; `useClaimTemplates`, `buyer_first_name`, `'Gerenciar modelos'` em `ClaimDetailSheet.tsx`.
- `git diff` em `ClaimDetailSheet.tsx` confirma que `reply-ml-claim`, `ml-claim-action`, `handleSend` e `handleAction` não foram alterados.

## Known Stubs

None — todos os dados vêm de `ml_claim_templates` (tabela real em produção) e `useMLClaimDetail` (EF `ml-claim-detail` v3 em produção).

## Self-Check: PASSED
