---
phase: 54-pipeline-de-a-es-com-aprova-o
verified: 2026-06-27T19:41:09Z
status: gaps_found
score: 5/7
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "'Propor ação' mostra preview de diff (atual → proposto + impacto estimado em R$/margem) antes de enviar"
    status: failed
    reason: |
      ProposeActionDialog mostra apenas o impacto BRL (insight.impact_brl) e o tipo da ação/valor proposto —
      mas NÃO exibe o valor ATUAL do ML ("atual") antes de enviar. O diff atual→proposto com o valor real do
      ML só aparece na Fila/ActionQueue APÓS a proposta ser criada (post-proposal), onde current_value
      é mostrado como "—" até que um dryRun popule o campo. Isso diverge do SC que exige "antes de enviar."
      NOTA: Esta é uma decisão de design explícita do PLAN-03 (linha 99): "o diff completo aparece na Fila
      quando o owner abre a ação (dryRun lazy)." Wesley aprovou este UX no checkpoint visual (PR #19).
    artifacts:
      - path: "src/components/mercadolivre/ProposeActionDialog.tsx"
        issue: "Linhas 66-75 mostram impact_brl; linhas 127-158 mostram input/resumo da ação — sem current_value do ML"
      - path: "src/components/mercadolivre/ActionQueue.tsx"
        issue: "Diff atual→proposto está aqui (linhas 160-164), não no modal. current_value='—' até dryRun"
    missing:
      - "Exibir o valor atual (ex: preço atual, status atual) no ProposeActionDialog antes do submit — OU adicionar override documentando a decisão de fluxo"
human_verification:
  - test: "Confirmar deploy da EF consultor-actions em ckcdevcxgvueywivefgx"
    expected: "supabase.functions.invoke('consultor-actions', { body: { action_id: 'uuid', dry_run: true } }) responde 200 ou 403/404 (não 404 de rota inexistente)"
    why_human: "A EF foi escrita e commitada no main (commit 0a6cdffe, 2026-06-24) mas o deploy via MCP é um passo do orquestrador não verificável via grep/arquivo. Precisa de confirmação via Supabase MCP ou smoke test com token válido."
  - test: "Merge do PR #19 (branch gsd/phase-54-pipeline-acoes-ui) para main/prod"
    expected: "ProposeActionDialog, ActionQueue, ActionHistory e abas Insights|Fila|Histórico em /consultor estão disponíveis para o owner em produção"
    why_human: "Wave 2 UI está na branch gsd/phase-54-pipeline-acoes-ui. 5 commits estão à frente do main. PR #19 foi aprovado visualmente por Wesley mas não foi mergeado. Verificar via git log ou Vercel deploy."
---

# Phase 54: Pipeline de Ações com Aprovação — Verification Report

**Phase Goal:** A partir de um insight acionável, o lojista propõe uma mudança no ML (preço/anúncio/ads), o owner aprova numa fila, e só então o executor aplica — à prova de duplicação, de IDOR e de proposta obsoleta, com auditoria completa.
**Verified:** 2026-06-27T19:41:09Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | "Propor ação" mostra preview de diff (atual → proposto + impacto estimado em R$/margem) antes de enviar | FAILED | Modal mostra impact_brl + tipo/valor proposto mas SEM o valor atual do ML. Diff (atual→proposto) está em ActionQueue/Fila pós-proposta (current_value="—" até dryRun). Desvio intencional do PLAN-03. |
| 2 | Ação proposta entra em fila com badge de contagem de pendentes; owner aprova ou rejeita | VERIFIED | ActionQueue renderiza queue, pendingCount badge na aba "Fila", approve dentro de AlertDialog (T-54-15), rejeitar button; gate orgRole==='owner' em MLConsultor.tsx linha 338 |
| 3 | Ação aprovada executa no ML via executor — nunca sem aprovação | UNCERTAIN | EF code completo e correto (gate claim_approved_action, 5 action_types, owner-check); deploy a ckcdevcxgvueywivefgx não verificável via codebase — ver Human Verification |
| 4 | Execução à prova de duplicação (gate atômico) e de IDOR (ação+token escopados a org+ml_user_id) | VERIFIED | claim_approved_action linha 365 ANTES de mlPut linha 501; token lookup com .eq("ml_user_id") + .eq("organization_id") linhas 382-386; owner-check via get_org_role linhas 303-308 |
| 5 | Proposta obsoleta bloqueada/sinalizada (pre-flight + TTL); staleness badge >24h | VERIFIED | TTL 48h linhas 349-358; readCurrentMlState no_op+conflict linhas 439-486; isStale(>24h) em ActionQueue.tsx linha 64; badge "impacto pode ter mudado" linhas 133-140 |
| 6 | Toda transição registrada em action_audit_log imutável (ator, de→para, ts, resposta ML trimada) | VERIFIED | insertAudit() chamada em cada path: TTL, gate_not_approved, preflight_error, no_op, conflict, no_token, ml_error, applied; trimDetail() corta ml_body a 4096 bytes (linha 62-70) |
| 7 | Owner vê histórico de ações executadas com o resultado de cada uma | VERIFIED | ActionHistory: tabela com status badge (done=verde/failed=vermelho), result_summary (linha 106-108), executed_at formatado (linha 116); historyQuery filtra status IN ('done','failed') |

**Score:** 5/7 truths verified (1 FAILED, 1 UNCERTAIN)

### Gap: SC1 — Desvio Intencional (Sugestão de Override)

SC1 falhou no teste literal ("antes de enviar"), mas é **desvio documentado e aprovado**. O PLAN-03 (linha 99) explicita:

> "Decisão de fluxo: o modal cria a proposta (INSERT) e fecha; o diff completo (atual→proposto via ML) aparece na Fila quando o owner abre a ação (dryRun lazy). Mostrar no modal o impacto R$ do insight (impact_brl, já disponível, sem custo de rede) e o resumo da mudança."

Wesley aprovou este UX no checkpoint visual (PR #19, 2026-06-27). Para fechar este gap formalmente, adicionar ao frontmatter deste VERIFICATION.md:

```yaml
overrides:
  - must_have: "'Propor ação' mostra preview de diff (atual → proposto + impacto estimado em R$/margem) antes de enviar"
    reason: "Design decision PLAN-03: impact BRL + resumo da ação mostrados no modal antes de enviar; diff atual→proposto (com valor real do ML) deferido para ActionQueue/Fila pós-proposta via dryRun lazy. Wesley aprovou este UX no checkpoint visual PR #19 em 2026-06-27."
    accepted_by: "wesleysantos"
    accepted_at: "2026-06-27T19:41:09Z"
```

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `supabase/functions/consultor-actions/index.ts` | Executor 5 mutações ML + gate + pre-flight + audit + dry_run | VERIFIED | 547 linhas; pipeline completo em ambos os modos |
| `supabase/config.toml` | `[functions.consultor-actions] verify_jwt=true` | VERIFIED | Bloco presente; verify_jwt=true confirmado |
| `src/lib/consultor/actionMapping.ts` | RULE_TO_ACTION + targetRefFromInsight + buildActionFromInsight | VERIFIED | 7 rule_keys mapeados; extração de target_ref de action_href |
| `src/hooks/useConsultorActions.ts` | queue/pendingCount/propose/dryRun/approve/reject/history | VERIFIED | TanStack Query v5 org-scoped; approve() = UPDATE 'approved' + invoke EF |
| `src/components/mercadolivre/ProposeActionDialog.tsx` | Modal com impact + input condicional + propose() | VERIFIED | Conditional input (numeric vs fixed); isValid guard; propose() + toast |
| `src/components/mercadolivre/ActionQueue.tsx` | Fila com diff + staleness badge + AlertDialog approve | VERIFIED | isStale(>24h); AlertDialog wrapping approve; diff current→proposed |
| `src/components/mercadolivre/ActionHistory.tsx` | Tabela done/failed com result_summary + executed_at | VERIFIED | Badge done=verde/failed=vermelho; result_summary; formatDate(executed_at) |
| `src/pages/mercadolivre/MLConsultor.tsx` | Tabs Insights|Fila|Histórico owner-only; pendingCount badge | VERIFIED | orgRole==='owner' gate linha 338; non-owner: insightsList direto sem Tabs |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `ActionQueue.tsx` | `useConsultorActions.ts` | `approve(action.id)` → UPDATE 'approved' + invoke EF | VERIFIED | Linhas 87-97 + hook linhas 132-154 |
| `useConsultorActions.ts` | `consultor-actions EF` | `supabase.functions.invoke("consultor-actions", { dry_run: false })` | VERIFIED | Linhas 147-150; invokeError propagado |
| `EF` | `claim_approved_action RPC (Phase 52)` | `supabase.rpc("claim_approved_action", { p_action_id })` | VERIFIED | Linha 365; 0 linhas = 409 antes do ML |
| `EF` | `ml_tokens` | `.eq("ml_user_id").eq("organization_id")` (2 colunas, anti-IDOR) | VERIFIED | Linhas 382-386 (exec) e 315-318 (dry_run) |
| `EF` | `action_audit_log` | `supabase.from("action_audit_log").insert(...)` | VERIFIED | insertAudit() chamada em todos os paths de transição; trimDetail limita detail ≤4KB |
| `MLConsultor.tsx` | `ProposeActionDialog.tsx` | `setProposingInsight(insight)` → `<ProposeActionDialog insight={...} />` | VERIFIED | Linha 327 (isActionable && onPropose); linha 392 (owner) + 343 (non-owner) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `ActionQueue.tsx` | `queue` | `useConsultorActions().queue` → `proposed_actions` WHERE org AND status IN ('proposed','approved') | Supabase real query | VERIFIED (quando EF deployada) |
| `ActionHistory.tsx` | `history` | `useConsultorActions().history` → `proposed_actions` WHERE org AND status IN ('done','failed') .range(0,49) | Supabase real query + paginação | VERIFIED |
| `ProposeActionDialog.tsx` | `impactFormatted` | `insight.impact_brl` (prop vindo de useConsultorInsights) | Vem do insight real (Phase 53/consultor-insights EF) | VERIFIED |
| `MLConsultor.tsx` | `pendingCount` | `useConsultorActions().pendingCount` = `queue.length` | Mesmo query da ActionQueue; TanStack deduplica | VERIFIED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Testes unitários passam | `npx vitest run` (executado) | 278/278 (17 files) | PASS |
| actionMapping.test.ts | Enumeração via vitest list | 11 testes (7 rule_keys, target_ref, build, erro) | PASS |
| useConsultorActions.test.ts | Enumeração via vitest list | 3 testes (pendingCount, org-scoped, null orgId) | PASS |
| gate antes do ML | `grep -n "claim_approved_action" index.ts` vs `grep -n "await mlPut"` | linha 365 < linha 501 | PASS |
| token lookup 2 colunas | grep em consultor-actions/index.ts | `.eq("ml_user_id")` + `.eq("organization_id")` presentes nas linhas 382-386 | PASS |
| Smoke de EF em prod | Requer invoke via Supabase MCP em ckcdevcxgvueywivefgx | Não verificável via codebase | SKIP — ver Human Verification |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| ACT-01 | 54-03 | Propor ação com diff + impacto antes de enviar | PARTIAL — ver SC1 gap | Modal: impact + proposed. "Atual" não mostrado no modal. Diff em ActionQueue pós-proposta. |
| ACT-02 | 54-03 | Fila de aprovação com badge de pendentes | VERIFIED | pendingCount badge; ActionQueue; orgRole gate |
| ACT-03 | 54-03 | Owner aprova ou rejeita | VERIFIED | AlertDialog approve; reject button; hook update+invoke |
| ACT-04 | 54-01 | Executa no ML nunca sem aprovação | VERIFIED (code) / UNCERTAIN (deploy) | Gate claim_approved_action exige status='approved'; EF owner-check |
| ACT-05 | 54-01 | Audit log imutável por transição | VERIFIED | insertAudit() em todos os paths; trimDetail ≤4KB |
| ACT-06 | 54-01 | Anti-duplicação (gate) + anti-IDOR | VERIFIED | claim_approved_action atômico; token lookup 2 colunas; owner-check |
| ACT-07 | 54-01/03 | Pre-flight + TTL (bloqueio) + staleness badge (UI) | VERIFIED | TTL 48h; conflict/no_op; isStale badge >24h |
| ACT-08 | 54-03 | Histórico com resultado | VERIFIED | ActionHistory com result_summary badge + executed_at |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| (nenhum) | — | Sem TBD/FIXME/XXX nos arquivos da fase | — | — |
| `ActionQueue.tsx` | — | `current_value` exibido como "—" quando null (pré-dryRun) | Info | Comportamento intencional/documentado no PLAN-03; não é stub |

Sem debt markers (TBD/FIXME/XXX) nos 7 arquivos da fase. O `current_value="—"` na Fila é comportamento documentado, não stub: o PLAN-03 explicitamente decidiu "dryRun lazy" — o valor é nulo até que um dryRun seja disparado (o executor popula `dry_run_preview` + `current_value` na EF).

### Human Verification Required

#### 1. Deploy da EF consultor-actions em ckcdevcxgvueywivefgx

**Test:** Via Supabase MCP `execute_sql` ou invoke: confirmar que a EF responde a uma chamada de smoke (ex: invoke sem token → 401 esperado, não 404-de-rota-não-encontrada).
**Expected:** EF deployada retorna 401 ou 403/404 de lógica (não "function not found"). Smoke de gate 409: seed 1 ação 'approved', claim 2× (1ª retorna linha, 2ª retorna 0).
**Why human:** EF foi escrita e commitada no main (commit 0a6cdffe, 2026-06-24). O deploy via MCP ao project ckcdevcxgvueywivefgx é um step do orquestrador não registrado no codebase. Task context afirma "Wave 1 JÁ EM PROD desde 2026-06-24" mas isso não é verificável via grep/arquivo.

#### 2. Merge do PR #19 para main/prod (Wave 2 UI)

**Test:** Verificar se a branch `gsd/phase-54-pipeline-acoes-ui` foi mergeada para main.
**Expected:** `git log main -- src/components/mercadolivre/ActionQueue.tsx` mostra commit de merge; `/consultor` em produção exibe abas Insights|Fila|Histórico para owners.
**Why human:** 5 commits estão à frente do main (feat(54-03) Task 1/2 + 3× docs). PR #19 teve checkpoint visual aprovado por Wesley mas merge não ocorreu nesta sessão. Precisar de `git merge` ou merge via GitHub.

### Gaps Summary

**Gap real (SC1):** O ProposeActionDialog não exibe o valor atual do ML ("atual") antes de enviar a proposta — apenas o impacto estimado e o tipo de ação. O diff completo (atual→proposto com o real do ML) está na ActionQueue pós-proposta, com `current_value="—"` até dryRun.

Este gap é um **desvio intencional e documentado** (PLAN-03 linha 99, decisão de fluxo) aprovado por Wesley no checkpoint visual (PR #19). A solução recomendada é adicionar um override (ver seção acima) em vez de reimplementar o modal. Isso fecharia o gap formal e moveria o status para `human_needed` para a verificação dos 2 itens operacionais (deploy EF + merge PR).

**Itens operacionais (não code-gaps):**
- EF em prod: code está correto e completo; deploy é step MCP do orquestrador
- Wave 2 UI: código completo, tsc 0, build ok, vitest 278/278, visual aprovado; merge do PR #19 é o próximo passo

---

_Verified: 2026-06-27T19:41:09Z_
_Verifier: Claude (gsd-verifier)_
