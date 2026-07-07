---
phase: 90-atendimento-de-reclama-es-triagem-de-pend-ncias-mensagens-r-
plan: 02
subsystem: api
tags: [supabase, migrations, rls, edge-functions, deno, mercadolivre, claims, templates, vitest]

# Dependency graph
requires:
  - phase: 89-atendimento (Webhook ML tempo real)
    provides: "ml-claim-detail EF (gates JWT → token por ml_user_id → is_org_member) + tabela ml_claims"
  - phase: 90-01 (triagem backend)
    provides: "colunas de triagem + _shared/claimActions.ts (padrão de helper puro compartilhado EF/vitest)"
provides:
  - "Tabela public.ml_claim_templates (biblioteca 'Mensagens rápidas' compartilhada por org) com RLS org-first em SELECT/INSERT/UPDATE/DELETE (WITH CHECK nas escritas) — CRUD direto pelo cliente autenticado, sem EF"
  - "supabase/functions/_shared/capitalizeName.ts — normalizador puro e testável de buyer.first_name (Titlecase, fallback null)"
  - "ml-claim-detail (v3) retorna buyer_first_name capitalizado (null → 'cliente' no frontend) via GET /orders/{order_id}"
affects:
  - "90-03/90-04 (UI ClaimDetailSheet: seletor 'Usar modelo' + dialog 'Gerenciar modelos' leem/gravam ml_claim_templates; {{nome}} resolve por buyer_first_name)"
  - "src/hooks/useClaimTemplates.ts, src/lib/applyTemplate.ts (Bloco 2 frontend)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tabela org-scoped com CRUD direto pelo cliente autenticado (sem EF de escrita): RLS é o ÚNICO guard — 4 policies por verbo com is_org_member, WITH CHECK em INSERT/UPDATE contra organization_id forjado"
    - "Helper puro compartilhado (capitalizeName) entre EF Deno e vitest (sem Deno globals / https:// imports), mesmo padrão de claimActions.ts (90-01)"
    - "Enriquecimento de buyer name reusando o access_token já autorizado; 1 GET extra (/orders) só quando existe order_id; sem segundo GET de claim"

key-files:
  created:
    - supabase/migrations/20260690000100_ml_claim_templates.sql
    - supabase/functions/_shared/capitalizeName.ts
    - supabase/functions/_shared/capitalizeName.test.ts
  modified:
    - supabase/functions/ml-claim-detail/index.ts

key-decisions:
  - "RLS org-first por verbo (SELECT/INSERT/UPDATE/DELETE) via is_org_member(auth.uid(), organization_id), espelhando ml_tax_config; WITH CHECK em INSERT e UPDATE impede organization_id forjado / re-parenting (anti-IDOR T-90-05/T-90-08)"
  - "created_by uuid NULL sem FK — apenas informativo (auth.uid() do criador); autorização é 100% por is_org_member, nunca por created_by client-trusted"
  - "buyer_first_name derivado de detail.resource_id (claim já buscado) → GET /orders/{id} → buyer.first_name; capitalizado por palavra; ausência de order_id/buyer → null (frontend mapeia para 'cliente')"
  - "Nenhuma dependência nova, nenhuma EF nova — apenas 1 migration + 1 campo na resposta da EF"

metrics:
  duration_minutes: 3
  completed: 2026-07-07
  tasks_completed: 2
  files_changed: 4

status: complete
---

# Phase 90 Plan 02: ml_claim_templates + buyer_first_name Summary

Biblioteca compartilhada de "Mensagens rápidas" (`ml_claim_templates`, RLS org-first anti-IDOR em leitura e escrita) mais `buyer_first_name` capitalizado no `ml-claim-detail` para resolver a variável `{{nome}}` dos templates com o nome real do comprador — sem enfraquecer nenhum gate de segurança da Phase 89.

## What Was Built

### Task 1 — Migration `ml_claim_templates` (org-first RLS)
`supabase/migrations/20260690000100_ml_claim_templates.sql`: tabela `public.ml_claim_templates` (`id`, `organization_id` NOT NULL REFERENCES `organizations(id)` ON DELETE CASCADE, `title`, `body`, `created_by` uuid NULL, `created_at`, `updated_at`), índice em `(organization_id)`, `ENABLE ROW LEVEL SECURITY` e 4 policies por verbo gated por `is_org_member(auth.uid(), organization_id)` — `WITH CHECK` em INSERT e UPDATE. Como o CRUD é feito direto pelo cliente autenticado (sem EF service-role), a RLS é o único guard contra acesso cross-org.

### Task 2 — `ml-claim-detail` retorna `buyer_first_name`
- Novo helper puro `supabase/functions/_shared/capitalizeName.ts` (Titlecase por palavra; entrada vazia/whitespace/não-string/ausente → `null`), com 9 testes vitest (`capitalizeName.test.ts`), espelhando o padrão de `claimActions.test.ts`.
- `ml-claim-detail/index.ts`: após todos os gates existentes, deriva `order_id` de `detail.resource_id` (claim já buscado) e faz um único GET extra `${ML_API}/orders/${order_id}` via `mlGetJson`, lê `buyer.first_name`, capitaliza e adiciona `buyer_first_name` (null quando order_id/buyer ausente). Todas as chaves anteriores da resposta permanecem intactas.

## Deviations from Plan

None — plan executed exactly as written. A correção pedida pelo plan-checker (teste unitário dedicado da capitalização, lógica extraída para `_shared/`) foi implementada como parte do Task 2.

## Security / Threat Coverage

- **T-90-05 (IDOR templates):** RLS org-first nos 4 verbos via `is_org_member`, `WITH CHECK` nas escritas.
- **T-90-06 (nome do comprador vazado):** `buyer_first_name` só retornado dentro do `ml-claim-detail` após JWT + `is_org_member`; gates inalterados e verificados por grep.
- **T-90-07 (access_token logado):** reuso de `mlGetJson`; nenhum `console.*` imprime `access_token` (verificado).
- **T-90-08 (organization_id forjado no INSERT):** `WITH CHECK is_org_member`; `created_by` informativo, nunca fonte de authz.

## Verification

- `grep` gates da migration (tabela + `ENABLE ROW LEVEL SECURITY` + `is_org_member` x5 + `WITH CHECK`) → OK.
- `deno check supabase/functions/ml-claim-detail/index.ts` → limpo.
- `npx vitest run supabase/functions/` → 98/98 (inclui 9 novos de `capitalizeName` + 15 de `claimActions`).
- Gates preservados: grep confirma `supabase.auth.getUser`, `is_org_member`, lookup em `ml_tokens`, e as chaves `messages`/`reason`/`available_actions`/`stage`/`type`/`status` ainda presentes.

## Checkpoint Outcome (aplicado pelo orquestrador)

Projeto `ckcdevcxgvueywivefgx`:
1. Migration `ml_claim_templates` aplicada via Supabase MCP `apply_migration` — tabela + RLS org-first (SELECT/INSERT/UPDATE/DELETE com WITH CHECK).
2. Edge function `ml-claim-detail` (v3) deployada e ACTIVE, com `_shared/capitalizeName.ts` incluído no bundle, retornando `buyer_first_name`.

## Commits

- `9819ba7c` feat(90-02): add ml_claim_templates table with org-first RLS
- `2b1eae34` feat(90-02): ml-claim-detail returns capitalized buyer_first_name

## Self-Check: PASSED

All 4 artifacts exist on disk; both task commits present in git history.
