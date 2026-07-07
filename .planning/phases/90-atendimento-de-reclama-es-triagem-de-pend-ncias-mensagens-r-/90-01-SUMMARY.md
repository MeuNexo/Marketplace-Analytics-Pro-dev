---
phase: 90-atendimento-de-reclama-es-triagem-de-pend-ncias-mensagens-r-
plan: 01
subsystem: api
tags: [supabase, edge-functions, deno, mercadolivre, claims, triage, vitest]

# Dependency graph
requires:
  - phase: 89-atendimento (Webhook ML tempo real)
    provides: "ml-webhook EF (per-claim GET com players) + sync-ml-claims EF (search resumido) + tabela ml_claims"
provides:
  - "ml_claims.seller_action_required / pending_action_type / action_due_date / available_actions / stage (colunas de triagem 'de quem é a vez')"
  - "Índice parcial idx_ml_claims_seller_action (organization_id, ml_user_id) WHERE seller_action_required — sustenta contadores do sino/KPI"
  - "supabase/functions/_shared/claimActions.ts — deriveSellerAction (regra LOCKED 'Pende você') pura e testável"
  - "ml-webhook (v5) e sync-ml-claims (v6) gravando as colunas de triagem"
affects:
  - "90-03 (UI /devolucoes: abas Pende você / Aguardando / Resolvida lê estas colunas)"
  - "useMLClaims hook, claimStatus helpers, sino de pendências"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Helper puro compartilhado entre EFs Deno e vitest (sem Deno globals nem https:// imports) para regra de negócio testável em node"
    - "Enriquecimento cron: GET individual só das claims OPEN (fechadas mantêm defaults) para caber no wall-clock da EF"

key-files:
  created:
    - supabase/migrations/20260690000000_ml_claims_seller_action.sql
    - supabase/functions/_shared/claimActions.ts
    - supabase/functions/_shared/claimActions.test.ts
  modified:
    - supabase/functions/ml-webhook/index.ts
    - supabase/functions/sync-ml-claims/index.ts

key-decisions:
  - "Regra LOCKED 'Pende você': mensagem mandatory OU ação de decisão (refund/allow_return/open_dispute/allow_partial_refund); mensagem opcional isolada = Aguardando"
  - "Prioridade de pending_action_type: reply > return > refund > dispute; action_due_date segue a ação vencedora"
  - "sync-ml-claims faz GET individual apenas de claims OPEN; fechadas ficam seller_action_required=false sem GET (orçamento de wall-clock + design)"
  - "Sem backfill na migration — linhas existentes ficam false até o próximo webhook/sync re-derivar"

patterns-established:
  - "Módulo _shared puro reutilizável por várias EFs e por vitest"
  - "Colunas derivadas idempotentes via ADD COLUMN IF NOT EXISTS + índice parcial para contadores"

requirements-completed: [TRIAGE-01, TRIAGE-02]

# Metrics
duration: ~7min
completed: 2026-07-07
status: complete
---

# Phase 90 Plan 01: Triagem "de quem é a vez" (backend/dados) Summary

**Colunas derivadas em `ml_claims` + helper puro `deriveSellerAction` (regra LOCKED "Pende você") ligado nos dois caminhos de escrita — webhook (tempo real) e sync-ml-claims (cron, GET individual só das abertas).**

## Performance

- **Duration:** ~7 min (execução dos 3 tasks auto) + checkpoint humano (migration/deploy pelo orquestrador)
- **Started:** 2026-07-07T13:16:00Z (aprox.)
- **Completed:** 2026-07-07T13:21:22Z (último commit de task) — metadata a seguir
- **Tasks:** 4 (3 auto + 1 checkpoint:human-action resolvido pelo orquestrador)
- **Files modified:** 5 (3 criados, 2 modificados)

## Accomplishments
- Migration adiciona 5 colunas de triagem a `ml_claims` (`seller_action_required`, `pending_action_type`, `action_due_date`, `available_actions`, `stage`) + índice parcial `idx_ml_claims_seller_action`, tudo idempotente e sem backfill destrutivo.
- `deriveSellerAction` codifica a regra LOCKED "Pende você" numa única função pura, com 15 casos de teste vitest (todos verdes) cobrindo mandatory vs opcional, cada ação de decisão, prioridade combinada e guards defensivos.
- `ml-webhook` deriva as colunas a partir do `players` que já busca no GET individual (sem requisição extra); `sync-ml-claims` faz GET individual só das claims OPEN e enriquece as mesmas colunas, mantendo os sleeps 120-200ms e o MAX_PAGES.
- Orquestrador aplicou a migration e fez deploy das EFs (ml-webhook v5, sync-ml-claims v6) no projeto `ckcdevcxgvueywivefgx`; sync manual disparado para popular as colunas.

## Task Commits

1. **Task 1: Migration — ml_claims triage columns + partial index** — `21a09908` (feat)
2. **Task 2: Shared pure derivation helper + unit tests (claimActions.ts)** — `fbaab025` (feat)
3. **Task 3: Wire deriveSellerAction into ml-webhook and sync-ml-claims** — `87dcdb08` (feat)
4. **Task 4: checkpoint:human-action** — migration aplicada + EFs deployadas pelo orquestrador via Supabase MCP (fora do controle do executor)

**Plan metadata:** (este commit de docs)

## Files Created/Modified
- `supabase/migrations/20260690000000_ml_claims_seller_action.sql` — 5 colunas de triagem + índice parcial, idempotente, sem backfill.
- `supabase/functions/_shared/claimActions.ts` — `deriveSellerAction(players)` pura; regra LOCKED "Pende você" com consts auditáveis (prefixo de mensagem, set de decisão) e prioridade reply>return>refund>dispute.
- `supabase/functions/_shared/claimActions.test.ts` — 15 casos vitest provando cada bullet do behavior.
- `supabase/functions/ml-webhook/index.ts` — `claimRow` deriva e grava as 5 colunas a partir do `c.players` já buscado.
- `supabase/functions/sync-ml-claims/index.ts` — GET individual (dual-URL) só de claims OPEN + enriquecimento; fechadas mantêm defaults false/null.

## Decisions Made
- Regra LOCKED "Pende você" e prioridade implementadas conforme o design (`docs/superpowers/specs/2026-07-07-atendimento-reclamacoes-design.md`), sem desvio.
- `available_actions` armazenado como os objetos brutos do respondent (jsonb) para o sheet/auditoria.
- GET individual restrito a OPEN no cron (fechadas não precisam) — decisão de performance/design mantida.

## Deviations from Plan

None - plan executed exactly as written. (A regra, prioridade, wiring e guards foram implementados exatamente como especificados.)

## Issues Encountered
- `deno check supabase/functions/sync-ml-claims/index.ts` reporta 4 erros de tipo (TS2769/TS2322/TS2353/TS2345) que **predatam** este plano e são **independentes** da adição do `deriveSellerAction` (confirmado via `git stash`: erros idênticos na versão anterior). São causados por `createClient` sem generics e por uma anotação de retorno desatualizada em `syncUser`. A EF roda em produção apesar disso (bundler de deploy do Supabase é mais tolerante que o `deno check` local estrito). Registrado em `deferred-items.md` por estarem fora do escopo (SCOPE BOUNDARY). As minhas adições não introduzem nenhum erro novo de tipo. `deno check` do `ml-webhook` passa limpo; `tsc --noEmit` do projeto passa limpo; vitest 15/15.

## Requirements Note
O plano declara `requirements: [TRIAGE-01, TRIAGE-02]`, mas o `.planning/REQUIREMENTS.md` do milestone v8.0 rastreia apenas itens LLM/ACTION/UX — TRIAGE-01/02 são IDs locais da Phase 90 (não presentes no arquivo de requisitos do milestone), portanto `requirements mark-complete` é no-op para estes IDs.

## User Setup Required
None - no external service configuration required (migration + deploy foram feitos pelo orquestrador via Supabase MCP no checkpoint).

## Next Phase Readiness
- As 5 colunas de triagem existem em produção e estão sendo populadas (webhook em tempo real + sync-ml-claims cron/manual).
- Pronto para 90-03 (UI `/devolucoes`: abas "Pende você / Aguardando / Resolvida", selos de tipo, prazo, e o novo critério do sino) consumir `seller_action_required` / `pending_action_type` / `action_due_date`.
- Verificação read-only recomendada (pelo orquestrador): contar `seller_action_required = true` para org `7f615df7` após o ciclo de sync, confirmar que abertas com vez do vendedor ficam flagged e fechadas ficam false — SEM disparar ação destrutiva.

## Self-Check: PASSED

All 5 created/modified files present on disk; all 3 task commits (`21a09908`, `fbaab025`, `87dcdb08`) present in git history.

---
*Phase: 90-atendimento-de-reclama-es-triagem-de-pend-ncias-mensagens-r-*
*Completed: 2026-07-07*
