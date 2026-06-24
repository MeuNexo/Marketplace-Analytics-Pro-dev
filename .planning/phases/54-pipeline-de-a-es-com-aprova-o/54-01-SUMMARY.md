---
phase: 54-pipeline-de-a-es-com-aprova-o
plan: 01
subsystem: edge-functions
status: complete
tags: [edge-function, ml-api, action-executor, security, idor, audit, dry-run]
requires:
  - "public.proposed_actions (Phase 52)"
  - "public.action_audit_log (Phase 52)"
  - "public.claim_approved_action RPC (Phase 52)"
  - "public.get_org_role RPC"
  - "public.ml_tokens"
provides:
  - "supabase/functions/consultor-actions/index.ts — executor das 5 mutações ML + gate + pre-flight + audit + dry_run"
  - "[functions.consultor-actions] verify_jwt=true em config.toml"
affects:
  - "54-02 / 54-03 (UI/hook que invoca consultor-actions)"
tech-stack:
  added: []
  patterns:
    - "Molde de segurança reply-ml-question (JWT → owner-check → inline ML call → fail-closed → token nunca logado)"
    - "Endpoints ML verificados em produção do Nexo MCP (PUT /items, PUT /advertising/product_ads/campaigns + api-version:2)"
    - "Gate atômico TOCTOU-safe via claim_approved_action antes de qualquer write"
key-files:
  created:
    - "supabase/functions/consultor-actions/index.ts"
  modified:
    - "supabase/config.toml"
decisions:
  - "D-A1: PUT da campanha usa campo `budget` no body (Nexo MCP update_campaign_ml); flag p/ Wesley confirmar budget vs daily_budget na 1ª execução real de ads"
  - "D-A3: TTL 48h sobre approved_at — approved não-executado >48h → failed/expired/409"
  - "D-A4: no_op é resultado, não estado — pre-flight no alvo → status=done, result_summary=no_op, sem write"
  - "Owner-check via get_org_role (não is_org_member): aprovar/executar é owner-only (RLS Phase 52)"
metrics:
  duration: "~1 sessão (write-only, sem deploy)"
  completed: "2026-06-24"
  tasks: "2/3 (Task 3 = deploy pelo orquestrador)"
status: complete
---

# Phase 54 Plan 01: Executor consultor-actions Summary

EF Deno `consultor-actions` escrita do zero — o executor que aplica no Mercado Livre as 5 mutações da fila de aprovação (preço, pausar/ativar anúncio, pausar/ajustar orçamento de ads) com gate atômico anti-duplicação, pre-flight anti-obsolescência, token-por-org anti-IDOR, audit imutável trimado ≤4KB e modo dry_run que computa o diff sem tocar o ML. **Escrita, NÃO deployada — deploy é checkpoint [BLOCKING] do orquestrador via MCP.**

## O que foi construído

**`supabase/functions/consultor-actions/index.ts`** (~560 linhas) — pipeline `dry_run=false` na ordem exigida:

1. **JWT** → `supabase.auth.getUser` → 401 (molde reply-ml-question)
2. **Fetch da ação** por `id` (service_role) → 404 se inexistente
3. **Owner-check** via `get_org_role(_user_id, action.organization_id)` ≠ `'owner'` → 403 (anti-IDOR T-54-02)
4. **dry_run=true** → computa payload (`buildPayload`) sem chamar o ML, grava `proposed_actions.dry_run_preview`, retorna; **sem** gate/pre-flight/audit
5. **TTL** (D-A3): `approved` com `approved_at` > 48h → `failed`/`expired` + audit → 409
6. **Gate atômico** (ACT-06): `claim_approved_action(p_action_id)`; 0 linhas → audit `gate_not_approved` + **409 ANTES de qualquer write ML** (linha 364 vs write na 501)
7. **Token da org** — lookup de **2 colunas** `.eq("ml_user_id").eq("organization_id")` (anti-IDOR Pitfall 2); sem token → `failed`/`no_token`/409; **refresh inline** se `expires_at` < 5min (payload de ml-token-refresh)
8. **Pre-flight** (ACT-07): `readCurrentMlState` re-lê o ML; já no alvo → `no_op`/done (D-A4); divergiu (≠ current_value) → `conflict`/failed/409
9. **Write ML inline** via `mlPut` — retry 3× (429 respeita `Retry-After`, 5xx backoff [2s,8s]), PUT idempotente
10. **Audit + estado final**: sucesso → `done`/`applied` + audit `to_status=done`; erro ML → `failed`/`ml_error` + audit `to_status=failed`; `detail.ml_body` cortado a ≤4096 por `trimDetail`

**Endpoints (Nexo MCP `ml_client.py`, verificados em produção — PATCH do ARCHITECTURE.md ignorado):**
- `update_price`: `PUT /items/{ref}` `{price}` (ou `/items/{ref}/variations/{vid}` se `variation_id`)
- `pause_listing` / `activate_listing`: `PUT /items/{ref}` `{status:"paused"|"active"}`
- `pause_ads_campaign` / `update_ads_budget`: `resolveAdvertiser` (GET /advertising/advertisers?product_id=PADS) → `PUT /advertising/product_ads/campaigns/{ref}?advertiser_id={adv}` header `api-version:2`, body `{status:"paused"}` / `{budget}`

**`supabase/config.toml`** — bloco `[functions.consultor-actions]` com `verify_jwt = true` (igual reply-ml-question, user-invoked).

## Decisões / Notas

- `claim_approved_action` é `SECURITY INVOKER`, mas a EF roda como `service_role` (bypassa RLS) → o anti-IDOR do gate é garantido pelo **owner-check explícito** (passo 3) ANTES do claim, não pela RLS da RPC.
- Pre-flight de ads usa o GET por advertiser (`/advertising/advertisers/{adv}/product_ads/campaigns`) filtrando por `target_ref` — espelha `fetch_campaigns` do Nexo MCP.
- `update_ads_budget` lê `budget ?? daily_budget` na comparação para tolerar variação de nome de campo no GET (sem inventar campo no write — D-A1).

## Deviations from Plan

None — plano executado conforme escrito. Único ajuste de interpretação: o owner-check usa `get_org_role` (e não `is_org_member` do reply-ml-question), pois o plano (passo 2/4) e a RLS da Phase 52 exigem `owner` para executar.

## Verification

Rodado localmente (write-only; sem deploy):

- `deno check supabase/functions/consultor-actions/index.ts` → **Check OK** (sem erros de tipo)
- `grep -v '^\s*//' ... | grep -c "claim_approved_action"` → **2** (≥1, gate presente)
- `grep -v '^\s*//' ... | grep -c "api-version"` → **4** (≥1, ads novo padrão)
- Gate (linha 364) **antes** do write `mlPut` (linha 501) ✓
- Token lookup com **ambas** colunas `ml_user_id` + `organization_id` (dry_run 317-318 e exec 384-385) ✓
- `trimDetail` + slice 4096 aplicado antes do INSERT de audit ✓
- Nenhum `console.*` com token; nenhum `PATCH`; nenhum `functions.invoke` (sem EF-to-EF) ✓
- 5 `action_type` no switch de `buildPayload` e no pre-flight `readCurrentMlState` ✓

## Self-Check: PASSED

- `supabase/functions/consultor-actions/index.ts` — FOUND
- `supabase/config.toml` com `[functions.consultor-actions]` — FOUND
- Sem commit (escopo do executor não inclui git commit nem deploy — por design)

## Deploy: PENDING (orquestrador)

Task 3 [BLOCKING] — o **orquestrador** deploya via MCP em **ckcdevcxgvueywivefgx**:
1. Confirmar `[functions.consultor-actions] verify_jwt=true` em config.toml
2. `deploy_edge_function` de `consultor-actions`
3. `get_advisors` (security) — sem erro crítico novo
4. Smokes: gate 409 (claim 2×), IDOR 403 (Org B × action Org A), pre-flight conflict, audit ≥1/transição com detail ≤4KB, dry_run popula `dry_run_preview` sem tocar o ML

gsd-executor não tem Supabase MCP/deploy → NÃO rodou `supabase functions deploy` (CLI local linkado no projeto errado gionpsuunfkkzzjdubfy).
