---
phase: 58-veracidade-completude-dados
plan: "04"
subsystem: nexo-chat
tags: [reputacao, metas, anti-idor, jwt-threading, operacional, saude, veracidade, testes]
dependencies:
  requires: [58-01, 58-02, 58-03]
  provides: [get_reputation-ml-reputation-ef, get_goals-ml_targets-anti-idor, userJwt-threading, get_claims-sem-campos-mortos, get_health_score-snapshot_month, get_open_questions-unanswered]
  affects:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
    - supabase/functions/nexo-chat/loop.ts
    - supabase/functions/nexo-chat/index.ts
tech_stack:
  added: []
  patterns: [userJwt-threading-index-loop-tools, anti-idor-seller_id-in-mlUserIds, ef-cross-call-user-jwt, deno-env-shim-vitest]
key_files:
  created: []
  modified:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
    - supabase/functions/nexo-chat/loop.ts
    - supabase/functions/nexo-chat/index.ts
decisions:
  - "get_reputation invoca EF ml-reputation com ctx.userJwt (JWT real do usuário); service_role retornaria 401 pois a EF chama getUser(token)"
  - "get_goals filtra ml_targets SOMENTE por .in('seller_id',mlUserIds) — ml_targets não tem organization_id; seller do modelo 100% ignorado"
  - "userJwt threading: index.ts extrai JWT do header → runChat({model,userJwt}) → loop opts.userJwt → dispatch ctx.userJwt; ctx é 6º param com default {} (backward-compat)"
  - "get_claims: data_limite e solucao removidos (100% null); retorna {label,total,open,by_type,items}"
  - "get_health_score: ordena por snapshot_month DESC em vez de created_at (alinha com dashboard)"
  - "get_open_questions: description atualizada citando UNANSWERED; filtro resposta IS NULL mantido (equivalente nesta base)"
  - "Deno.env shim no teste de get_reputation para Node/Vitest (Deno.env não existe fora do runtime Deno)"
metrics:
  duration: ~6m
  completed: 2026-06-24
status: complete
---

# Phase 58 Plan 04: Reputação + Metas + Limpeza Operacional — Summary

**One-liner:** `get_reputation` (EF ml-reputation via JWT real) + `get_goals` (ml_targets anti-IDOR por seller_id) adicionadas; `get_claims`/`get_health_score`/`get_open_questions` limpos; userJwt threading index→loop→tools completo; 53 testes verdes.

## What Was Built

### Task 1: Novas tools get_reputation + get_goals + userJwt threading (index→loop→tools)

**Threading B-1 (3 elos obrigatórios — todos implementados):**

**index.ts:**
```typescript
const userJwt = auth.replace("Bearer ", "");
const { reply, usedTools, fallback } = await runChat(
  sb, gkey, orgId, mlUserIds, buildSystemPrompt(), messages,
  { model, userJwt },  // ← adicionado
);
```

**loop.ts:**
- `RunChatOpts` ganhou `userJwt?: string` com JSDoc explícito.
- `dispatchImpl` ampliado para aceitar `ctx?: { userJwt?: string }` como 6º param.
- Call-site: `dispatch(..., { userJwt: opts.userJwt })`.

**tools.ts:**
- `dispatchTool(sb, orgId, mlUserIds, name, args, ctx: { userJwt?: string } = {})` — ctx ÚLTIMO parâmetro COM DEFAULT `{}`. Todas as chamadas antigas (sem ctx) continuam compilando e funcionando.
- JSDoc atualizado: ctx.userJwt nunca logado, nunca exposto ao modelo.

**get_reputation (OPS-1/D12) — segurança em camadas:**

1. Sem `ctx.userJwt` → `{ error: "sem_jwt", label: "não foi possível consultar a reputação ao vivo agora" }` — declara limitação (VERAC-05), não inventa.
2. Com userJwt: para cada `ml_user_id ∈ mlUserIds` (servidor — nunca do modelo): `fetch(${SUPABASE_URL}/functions/v1/ml-reputation?ml_user_id=<id>, { Authorization: Bearer <ctx.userJwt> })`.
3. A EF `ml-reputation` valida `is_org_member` via o JWT do usuário → 2ª barreira anti-IDOR (serviço rejeita tokens de usuários de outras orgs).
4. Falha por loja → `{ ml_user_id, error: "ef_status_<code>" }` sem inventar.

**get_goals (OPS-2/D13) — anti-IDOR adaptado para ml_targets (sem organization_id):**

```typescript
const { data: targetRows } = await sb
  .from("ml_targets")
  .select("seller_id,target_value,kpi_targets")
  .in("seller_id", mlUserIds)  // ← SOMENTE mlUserIds do servidor; seller do modelo ignorado
  .eq("year", pmY)
  .eq("month", pmM);
```

Cruza meta × realizado via `get_kpi_summary(orgId, mlUserIds, monthFrom, monthTo)`. Retorna `{period_month, label, by_seller:[{seller_id, meta_receita, meta_lucro_pct, realizado_receita, pct_atingido}]}`. Sem metas → declara "sem meta cadastrada para `<mês>`" (VERAC-05).

**TOOL_DECLARATIONS: 23 → 25** (`get_reputation` + `get_goals`; nenhuma expõe org/seller como parâmetro).

**deno check verde:** tools.ts, loop.ts, index.ts.

### Task 2: Limpeza get_claims/get_health_score/get_open_questions + testes anti-IDOR

**get_claims (OPS-3/D14):**

Antes: `select("claim_id,tipo,status,motivo,data_abertura,data_limite,solucao")` — campos `data_limite` e `solucao` são 100% null, prometiam "prazos" inexistentes.

Depois: `select("claim_id,tipo,status,motivo,data_abertura")` + shape novo:
```json
{
  "label": "Reclamações: NÃO há prazo/solução nesta base (data_limite e solucao 100% nulos)",
  "total": 5,
  "open": 2,
  "by_type": { "mediations": 2, "returns": 3 },
  "items": [...]
}
```
Description atualizada: nega prazos, cita distribuição por tipo.

**get_health_score (OPS-4/D14):**

Antes: `.order("created_at", { ascending: false })` — divergia do dashboard que exibe por mês.

Depois: `.select("snapshot_month,score,...").order("snapshot_month", { ascending: false })` — alinha ao card do dashboard (mesma ordenação).

**get_open_questions (OPS-5/D14):**

Description atualizada: "perguntas sem resposta (status UNANSWERED) — filtra por resposta IS NULL (equivalente a status UNANSWERED nesta base)." Filtro mantido como estava (IS NULL bate com UNANSWERED nesta base — escolha documentada).

**tools.test.ts — 53 testes (era 40), todos verdes:**

| Grupo | Testes adicionados |
|-------|-------------------|
| TOOL_DECLARATIONS contagem | 23→25 com get_reputation+get_goals |
| OPS-1..5 descriptions | 6 novos testes de declarations (get_reputation/get_goals anti-IDOR, get_claims nega prazos, get_open_questions UNANSWERED) |
| anti-IDOR get_goals | filtra .in('seller_id',mlUserIds); sem metas→declara limitação |
| anti-IDOR get_reputation | sem userJwt→{error:sem_jwt}; com userJwt→mock fetch captura URL+Authorization:Bearer (shim Deno.env) |
| backward-compat B-1 | chamada sem ctx (6º arg) continua funcionando |
| get_claims dispatcher | shape {total,open,by_type,items}; sem data_limite/solucao |
| get_health_score | snapshot_month no select |

**Abordagem do teste de get_reputation (shim Deno.env):** O teste shimou `globalThis.Deno = { env: { get: ... } }` com URL fixa `https://ckcdevcxgvueywivefgx.supabase.co` antes de chamar o dispatcher. Isso permite verificar a URL completa (`/functions/v1/ml-reputation?ml_user_id=<id>`) e o header `Authorization: Bearer JWT-REAL-DO-USER`. O shim é removido no `finally`.

## Verification

- `deno check supabase/functions/nexo-chat/tools.ts` — PASS
- `deno check supabase/functions/nexo-chat/loop.ts` — PASS
- `deno check supabase/functions/nexo-chat/index.ts` — PASS
- `npx vitest run supabase/functions/nexo-chat/tools.test.ts` — PASS: **53 testes, 1 arquivo, 0 falhas**

## Deviations from Plan

None — plano executado exatamente como escrito. O shim do Deno.env no teste foi a abordagem documentada no próprio plano ("tolerar SUPABASE_URL undefined verificando só o sufixo da URL ou stubar Deno.env se já houver shim; documentar a abordagem") — implementamos o shim conforme previsto.

## Known Stubs

None. `get_reputation` invoca a EF `ml-reputation` real. `get_goals` lê `ml_targets` real via Supabase. `get_claims`/`get_health_score`/`get_open_questions` lêem tabelas reais. Nenhum valor hardcoded de negócio.

## Threat Flags

A única nova superfície é a chamada cross-EF de `get_reputation → ml-reputation` com o JWT do usuário. Essa superfície já estava prevista no threat model do plano (T-58-04-REP-IDOR) e está mitigada por duas camadas:
1. `ml_user_id` só de `mlUserIds` do servidor (nunca do modelo)
2. A EF `ml-reputation` revalida `is_org_member` via o JWT recebido

Nenhuma superfície nova além do planejado.

## STRIDE Threat Register — Status

| Threat ID | Status |
|-----------|--------|
| T-58-04-GOALS-IDOR | MITIGADO — `.in('seller_id', mlUserIds)` do servidor; seller do modelo ignorado; ml_targets não tem organization_id; teste anti-IDOR dedicado cobre |
| T-58-04-REP-IDOR | MITIGADO — ml_user_id só do servidor; ctx.userJwt do request real → EF revalida is_org_member (2ª barreira); ctx nunca logado; teste B-1 com mock fetch cobre |
| T-58-04-RO | MITIGADO — get_reputation invoca EF read-only; nenhuma mutação; tools.ts continua sendo só rpc()/select()/fetch GET |
| T-58-04-LIMIT | MITIGADO — sem userJwt→{error:sem_jwt}; sem metas→"sem meta cadastrada para <mês>"; sem dados EF por loja→{ml_user_id,error} — nunca inventa |

## Self-Check: PASSED

- FOUND: supabase/functions/nexo-chat/tools.ts
- FOUND: supabase/functions/nexo-chat/loop.ts
- FOUND: supabase/functions/nexo-chat/index.ts
- FOUND: supabase/functions/nexo-chat/tools.test.ts
- FOUND commit c3f761d1 (Task 1 — get_reputation + get_goals + userJwt threading)
- FOUND commit 9a21f369 (Task 2 — get_claims/health/questions limpos + 53 testes verdes)
