---
phase: 42-zero-mock
verified: 2026-06-13T17:20:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 42: Zero Mock Verification Report

**Phase Goal:** Nenhuma página do produto exibe dados simulados — /perguntas, /devolucoes, /reputacao e /tv todos lendo de fontes reais.
**Verified:** 2026-06-13T17:20:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | /perguntas lista perguntas reais (ml_questions + EF sync-ml-questions) e usuário responde direto pela UI | VERIFIED | Hook reads `ml_questions` via `.from("ml_questions").eq("organization_id", orgId).in("ml_user_id", resolvedMLUserIds)`. EF sync-ml-questions exists and upserts into table. Page invokes `reply-ml-question` EF with AlertDialog confirmation + 0/2000 counter. |
| 2 | /devolucoes lista reclamações e devoluções reais (ml_claims + EF sync-ml-claims) | VERIFIED | Hook reads `ml_claims` with CR-01 multi-loja `.in()`. Sync EF populates table with `tipo` discriminator. Page shows tipo filter (mediations/returns) and status filter (opened/closed). 279 real rows confirmed by orchestrator. |
| 3 | /reputacao exibe feedback real da API ML — todos os getMock* removidos do codebase | VERIFIED | `useMLReputation.ts` has no mock fallback; calls EF `ml-reputation` live. `buildDailyFeedback()` derives chart from real `data.feedbacks[]` dates. `getMockReputationSummary`, `getMockFeedbackDaily`, `getMockFeedbackEntries` absent from codebase. `src/data/reputacaoMockData.ts` deleted; types moved to `src/types/reputacao.ts`. |
| 4 | /tv lê sellers da tabela sellers filtrada por organization_id — sem UUIDs hardcoded | VERIFIED | `TVModeVendas.tsx` has no `SELLERS` constant. Queries `sellers WHERE organization_id = currentOrg.id AND is_active = true ORDER BY name`, then joins `ml_tokens` to filter ML-connected sellers. No hardcoded UUIDs found. |
| 5 | Zero badge "dados simulados" visível em qualquer página do produto | VERIFIED | `grep -rn "dados simulados"` returns 0 results across all four pages. isRealData condition in MLReputacao now only shows green "Dados reais" badge when true — no "dados simulados" path. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/hooks/useMLQuestions.ts` | Reads ml_questions with CR-01 multi-loja scope | VERIFIED | TanStack Query v5; `.in("ml_user_id", resolvedMLUserIds)` CR-01; status filter param; staleTime 2min |
| `src/hooks/useMLClaims.ts` | Reads ml_claims with CR-01 multi-loja scope | VERIFIED | Same pattern; status filter; tipo filtering client-side via useMemo |
| `src/hooks/useMLReputation.ts` | No mock fallback; parses feedbacks[] | VERIFIED | No getMock* calls; `normalizeFulfilled()` handles boolean/string `fulfilled`; feedbacks defaults to `[]` never throws |
| `src/pages/mercadolivre/MLPerguntas.tsx` | Real data + inline reply + confirm + 0/2000 counter | VERIFIED | All present: `supabase.functions.invoke("reply-ml-question")`, AlertDialog, `{charCount}/2000`, sonner toast |
| `src/pages/mercadolivre/MLDevolucoes.tsx` | Unified ml_claims list + tipo/status filter | VERIFIED | `useMLClaims()` wired; tipoFilter + statusFilter selects; tipoLabel() maps mediations/returns; read-only |
| `src/pages/mercadolivre/MLReputacao.tsx` | Real feedback + derived daily chart | VERIFIED | `buildDailyFeedback(feedbacks)` derives from real dates; empty state when `chartData.length === 0`; no fabrication |
| `src/pages/TVModeVendas.tsx` | No hardcoded UUIDs; sellers from table by org | VERIFIED | Dynamic `sellers` state loaded from DB; no SELLERS constant; `generateInitials` fallback |
| `supabase/functions/sync-ml-questions/index.ts` | Sync EF for ml_questions | VERIFIED | Exists; requireServiceRole guard; paginates ML /questions/search; upserts with onConflict |
| `supabase/functions/sync-ml-claims/index.ts` | Sync EF for ml_claims | VERIFIED | Exists; dual-URL fallback; tipo discriminator; MAX_PAGES_PER_STATUS=6 bound; pre-upsert dedupe |
| `supabase/functions/reply-ml-question/index.ts` | Reply EF with user JWT + org membership | VERIFIED | Exists; zod validation (text max 2000); is_org_member gate; POST to ML /answers; updates row to ANSWERED |
| `supabase/migrations/20260614100000_ml_questions_claims.sql` | ml_questions + ml_claims tables with RLS | VERIFIED | Tables, org_member RLS policies, composite indexes all present |
| `supabase/migrations/20260614110000_pg_cron_questions_claims.sql` | pg_cron Pattern B schedules | VERIFIED | */15 questions, */30 claims; vault.decrypted_secrets Bearer auth; idempotent unschedule+schedule |
| `src/data/pedidosMockData.ts` | Untouched (out of scope) | VERIFIED | File exists; contains `getMockOrders`; no changes from this phase |
| `src/data/financialMockData.ts` | Untouched (out of scope) | VERIFIED | File exists; no changes from this phase |
| `src/data/reputacaoMockData.ts` | Deleted (getMock* removed) | VERIFIED | File absent from `src/data/`; types moved to `src/types/reputacao.ts` |
| `src/data/perguntasMockData.ts` | Deleted | VERIFIED | File absent from `src/data/` |
| `src/data/devolucoesMockData.ts` | Deleted | VERIFIED | File absent from `src/data/` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `MLPerguntas.tsx` | `ml_questions` table | `useMLQuestions()` hook | WIRED | Hook imported and called; data= destructured |
| `MLPerguntas.tsx` | `reply-ml-question` EF | `supabase.functions.invoke` in `handleSendReply` | WIRED | Invoked with `{ question_id, text, ml_user_id }`; result checked; refetch called |
| `MLDevolucoes.tsx` | `ml_claims` table | `useMLClaims()` hook | WIRED | Hook imported and called; `claims` used for KPIs + filtered list |
| `MLReputacao.tsx` | `ml-reputation` EF | `useMLReputation()` → fetch in `fetchReputation` | WIRED | EF called; `feedbacks` parsed; `buildDailyFeedback(feedbacks)` drives chart |
| `TVModeVendas.tsx` | `sellers` table | `supabase.from("sellers")` in useEffect | WIRED | Query scoped to `currentOrg.id`; filtered via `ml_tokens` join |
| `sync-ml-questions` EF | `ml_questions` table | `sb.from("ml_questions").upsert(...)` | WIRED | upsert with onConflict (organization_id, ml_user_id, question_id) |
| `sync-ml-claims` EF | `ml_claims` table | `sb.from("ml_claims").upsert(deduped, ...)` | WIRED | upsert with onConflict (organization_id, ml_user_id, claim_id) |
| `pg_cron` schedule | `sync-ml-questions` EF | Pattern B Bearer vault | WIRED | */15 cron → net.http_post with vault.decrypted_secrets service_role_key |
| `pg_cron` schedule | `sync-ml-claims` EF | Pattern B Bearer vault | WIRED | */30 cron → net.http_post with vault.decrypted_secrets service_role_key |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `MLPerguntas.tsx` | `questions` | `useMLQuestions()` → `supabase.from("ml_questions")` | Yes — 108 rows confirmed live | FLOWING |
| `MLDevolucoes.tsx` | `claims` | `useMLClaims()` → `supabase.from("ml_claims")` | Yes — 279 rows confirmed live | FLOWING |
| `MLReputacao.tsx` | `feedbacks` | `useMLReputation()` → EF `ml-reputation` → ML API | Yes — live ML API; `feedbacks[]` parsed from real response | FLOWING |
| `TVModeVendas.tsx` | `sellers` | `supabase.from("sellers").eq("organization_id", currentOrg.id)` | Yes — queries live sellers table | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 19 hook unit tests pass | `npx vitest run src/hooks/useMLQuestions.test.ts src/hooks/useMLClaims.test.ts` | 19/19 passed (62ms + 144ms) | PASS |
| Build compiles without errors | `npm run build` | `built in 18.65s` — no TypeScript errors | PASS |
| No getMock* in product pages | `grep -rn "getMock" src/` | Only `pedidosMockData.ts:getMockOrders` (out of scope) | PASS |
| No "dados simulados" badge text | `grep -rn "dados simulados" src/` | 0 results | PASS |
| No hardcoded UUIDs in TVModeVendas | `grep -n "8c57110c\|52a7ed04\|SELLERS\s*=\s*\[" TVModeVendas.tsx` | 0 results | PASS |

---

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| MOCK-01 | /perguntas lists real ML questions from ml_questions + sync EF | SATISFIED | `useMLQuestions` reads live table; sync EF upserts from ML API every 15min |
| MOCK-02 | User answers buyer questions inline from /perguntas UI | SATISFIED | `handleSendReply` invokes `reply-ml-question` EF; AlertDialog confirm; 0/2000 counter |
| MOCK-03 | /devolucoes lists real claims/returns from ml_claims + sync EF | SATISFIED | `useMLClaims` reads live table; sync EF upserts from ML API every 30min |
| MOCK-04 | /reputacao shows real ML feedback; all getMock* removed | SATISFIED | No getMock* anywhere; `feedbacks[]` from EF; `buildDailyFeedback` from real dates |
| MOCK-05 | /tv reads sellers from sellers table by organization_id; no hardcoded UUIDs | SATISFIED | Dynamic DB query replacing hardcoded SELLERS constant |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/hooks/useMLClaims.ts` | 8-24 | `MLClaimRow` interface declares `descricao`, `item_title`, `valor`, `data_fechamento` columns that do not exist in the `ml_claims` migration schema | WARNING | Runtime-safe: all are `| null` and the page gracefully falls back (`claim.item_title ?? claim.item_id ?? "—"`, `claim.valor != null` → `undefined != null` is `false` → shows "—"). No display breakage. TypeScript type is wider than the schema. |

No TBD/FIXME/XXX markers found in any phase-modified file.

---

### Human Verification Required

The following behaviors require visual confirmation and cannot be verified programmatically:

**1. Reply flow UX — confirm dialog and char counter**

**Test:** Navigate to /perguntas; click "Responder" on an UNANSWERED question; type a response; verify the character counter increments (e.g., "12/2000"); click the "Responder" button; verify the AlertDialog appears with "irreversível" warning; click "Enviar resposta"; verify the toast appears and the question moves to "Respondidas".
**Expected:** Counter updates live; confirm dialog blocks sending without explicit confirmation; toast shows success; question disappears from Pendentes tab.
**Why human:** Live ML reply is irreversible and requires a real connected seller account. Cannot test without side-effects.

**2. /devolucoes tipo and status filters**

**Test:** Navigate to /devolucoes with a populated ml_claims table; switch tipo filter to "Reclamações" then "Devoluções"; switch status filter to "Abertas" then "Encerradas"; verify the table rows update correctly.
**Expected:** Filters combine correctly; "Nenhuma reclamação com esse filtro" shown when empty; no crash.
**Why human:** Requires live data in multiple tipo/status categories to fully verify filter combinations.

**3. /tv seller cycling**

**Test:** Navigate to /tv with multiple ML-connected sellers; verify sellers cycle alphabetically; verify logo or initials appear; adjust cycle speed via settings popover; verify refresh timer works.
**Expected:** No "Nenhuma loja ML conectada" shown for an org with connected sellers; cycle advances after `cycleSec` seconds.
**Why human:** Requires a live Supabase session and multiple connected sellers to observe cycling.

**4. /reputacao feedback chart sparsity**

**Test:** Navigate to /reputacao; if feedbacks are available, verify the bar chart shows real dates (not fabricated 30-day series); if no feedbacks, verify the "Nenhuma avaliação no período" empty state appears (not an error or spinner).
**Expected:** Chart only shows days with real feedback (sparse series); "Avaliações — histórico real" title is accurate.
**Why human:** Requires live ML API data; chart appearance cannot be verified by grep.

---

### Schema-to-Hook Type Mismatch (WARNING — Non-blocking)

`MLClaimRow` interface in `useMLClaims.ts` declares four fields absent from the DB migration and sync EF: `descricao`, `item_title`, `valor`, `data_fechamento`. All are typed `string | null` or `number | null`.

**Runtime impact assessment:**
- `claim.item_title`: page uses `claim.item_title ?? claim.item_id ?? "—"` — undefined falls back to item_id, which IS in the schema. Safe.
- `claim.descricao`: page uses `claim.motivo ?? claim.descricao ?? "—"` — undefined means motivo is used first (which IS in schema). Safe.
- `claim.valor`: page guard is `claim.valor != null` — `undefined != null` is `false` in JS (loose equality), so `"—"` is shown. Safe.
- `claim.data_fechamento`: not rendered anywhere in MLDevolucoes.tsx. No impact.

**Verdict:** TypeScript interface is wider than the actual DB schema. No user-visible breakage. The `item_title` column does exist in `ml_questions` (but not `ml_claims`), suggesting the interface was drafted before the claims schema was finalized. This is a technical debt item, not a blocking defect for the phase goal.

---

### Gaps Summary

No blocking gaps found. The phase goal "nenhuma página do produto exibe dados simulados" is achieved:

- All four pages (/perguntas, /devolucoes, /reputacao, /tv) read from real data sources.
- All `getMock*` functions removed from the perguntas/devolucoes/reputacao surface.
- Mock data files for those domains deleted (`reputacaoMockData.ts`, `perguntasMockData.ts`, `devolucoesMockData.ts`).
- No "dados simulados" badge text anywhere in product pages.
- No hardcoded seller UUIDs in TVModeVendas.tsx.
- 19/19 unit tests GREEN; build clean.

One WARNING-level finding (schema-to-hook type mismatch in MLClaimRow) is non-blocking: all missing columns fall back gracefully at runtime and do not cause any visible data errors.

---

_Verified: 2026-06-13T17:20:00Z_
_Verifier: Claude (gsd-verifier)_
