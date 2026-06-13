# Phase 42: Zero Mock — Artifacts This Phase Produces

Every new symbol this phase creates, for downstream verification and graph indexing.

## New database tables (project ckcdevcxgvueywivefgx)

- `public.ml_questions` — RLS org_member; UNIQUE (organization_id, ml_user_id, question_id); indexes idx_ml_questions_scope / _status / _data
- `public.ml_claims` — RLS org_member; UNIQUE (organization_id, ml_user_id, claim_id); indexes idx_ml_claims_scope / _status / _data

## New Edge Functions

- `sync-ml-questions` (verify_jwt=false, cron-invoked) — fetches ML Questions API, upserts ml_questions
- `sync-ml-claims` (verify_jwt=false, cron-invoked) — fetches ML Claims API (dual-URL), upserts ml_claims
- `reply-ml-question` (verify_jwt=true, user-invoked) — POST /answers, org-membership gated

## Modified Edge Functions

- `ml-reputation` — expanded to also return `feedbacks[]` (empty allowed)

## New pg_cron jobs

- `sync-ml-questions-every-15min` — */15 * * * *, Pattern B (Bearer service_role_key from vault)
- `sync-ml-claims-every-30min` — */30 * * * *, Pattern B

## New migrations

- `supabase/migrations/20260614100000_ml_questions_claims.sql` — tables + RLS + indexes
- `supabase/migrations/20260614110000_pg_cron_questions_claims.sql` — cron schedules

## New hooks

- `src/hooks/useMLQuestions.ts` — exports `useMLQuestions` + `MLQuestionRow`
- `src/hooks/useMLClaims.ts` — exports `useMLClaims` + `MLClaimRow`

## New test files

- `src/hooks/useMLQuestions.test.ts`
- `src/hooks/useMLClaims.test.ts`

## Modified hooks

- `src/hooks/useMLReputation.ts` — adds `feedbacks: FeedbackEntry[]`; removes `mockReputation` + getMock* import

## Modified components / pages

- `src/pages/mercadolivre/MLPerguntas.tsx` — real list + inline reply + confirm + char counter
- `src/pages/mercadolivre/MLDevolucoes.tsx` — real list + tipo/status filters (read-only)
- `src/pages/mercadolivre/MLReputacao.tsx` — real reputation + derived daily feedback chart
- `src/pages/TVModeVendas.tsx` — dynamic org-scoped seller list (SELLERS constant removed)

## Modified config

- `supabase/config.toml` — adds [functions.sync-ml-questions]/[functions.sync-ml-claims]/[functions.reply-ml-question]

## Mock removals (no longer in product surface)

- `src/data/reputacaoMockData.ts` — getMock* removed (types kept)
- `src/data/perguntasMockData.ts` — getMock* removed
- `src/data/devolucoesMockData.ts` — getMock* removed
- OUT OF SCOPE (untouched): src/data/pedidosMockData.ts (unused), src/data/financialMockData.ts (MLAnuncios, Phase 41)

---

## Multi-Source Coverage Audit

| Source | Item | Covered by |
|--------|------|-----------|
| GOAL | /perguntas, /devolucoes, /reputacao, /tv read real ML sources | Plans 02+03 (perguntas/devolucoes/reputacao), Plan 04 (tv) |
| REQ MOCK-01 | /perguntas lists real questions (ml_questions + sync EF) | Plan 01 (table), Plan 02 (sync EF), Plan 03 (hook + page) |
| REQ MOCK-02 | User replies via UI (POST answer ML) | Plan 02 (reply EF), Plan 03 (inline reply UI) |
| REQ MOCK-03 | /devolucoes lists real claims (ml_claims + sync EF) | Plan 01 (table), Plan 02 (sync EF), Plan 03 (hook + page) |
| REQ MOCK-04 | /reputacao real feedback, getMock* removed | Plan 02 (ml-reputation feedbacks), Plan 03 (hook + page + mock removal) |
| REQ MOCK-05 | /tv reads sellers by organization_id, no hardcoded UUIDs | Plan 04 |
| RESEARCH | pg_cron Pattern B auth (D-02 pitfall) | Plan 02 Task 3+4 |
| RESEARCH | vault service_role_key prerequisite (A1) | Plan 01 Task 3 |
| RESEARCH | Claims dual-URL fallback (Pitfall 5) | Plan 02 Task 1 |
| RESEARCH | feedback [] valid / fulfilled normalization (Pitfalls 3,7) | Plan 02 Task 2, Plan 03 Task 3 |
| RESEARCH | SELLERS cycle effect deps (Pitfall 2) | Plan 04 Task 1 |
| CONTEXT D-01..D-12 | All locked decisions | D-01/02/03 Plan 02; D-04/05/06 Plan 03 T2; D-07/08 Plan 03 T3; D-09 Plan 03 T2; D-10 Plan 03 (hooks); D-11/12 Plan 04 |

**Result: COVERED — every GOAL/REQ/RESEARCH/CONTEXT item maps to a plan.**

Exclusions (not gaps): CONTEXT Deferred Ideas (reply_to_claim, sidebar badges, push notifications) — out of scope; visual redesign of pages — out of scope per CONTEXT §domain.
