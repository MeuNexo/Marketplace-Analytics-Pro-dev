---
gsd_state_version: 1.0
milestone: v8.0
milestone_name: "**Goal**: O schema e as RPCs que sustentam as 4 trilhas existem em produção, com RLS org-first e a state-machine de ações atômica — pronto para LLM, ações, snooze, limiares e por-loja serem construídos por cima sem retrabalho de modelo."
current_phase: 59
current_phase_name: fluxo-caixa-correcoes
status: executing
stopped_at: "Phases 57+58 MERGEADAS pra prod (PR #9, merge 670ac8be; Vercel success). Pendente: E2E Wesley logado. Próximo: /gsd-plan-phase 54 (UI fila de ações) ou 55 (multi-loja)"
last_updated: "2026-06-25T12:43:16.396Z"
last_activity: 2026-06-25
last_activity_desc: Phase 59 execution started
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 19
  completed_plans: 13
  percent: 13
---

## ✅ Phase 59 EXECUTADA + PROVADA EM PROD (2026-06-25) — Fluxo de Caixa: Correções (Projeção 7d + Sync Contas a Pagar)

- **Status:** 2/2 plans executados, ambos provados em produção `ckcdevcxgvueywivefgx`. Branch `gsd/phase-59-fluxo-caixa-correcoes` (não mergeado). Pendente: aprovação visual final do Wesley em /caixa + merge PR.
- **CASHFIX-01 (projeção 7d):** migration `20260659000000` aplicada via MCP. Validado por SQL: dias 1-7 a linha âmbar = confirmado (previsão=0, sem inflar); 8º+ média só nos dias sem recebimento. `accumulated_balance` intocado. **Reconciliação DFC:** descoberto que `financial_settings.initial_balance` estava STALE (R$21.676,91 de 19/06) — corrigido p/ R$16.833,14 (abertura 25/06 da DFC do Wesley); resíduo = só a liberação intradiária do MP de hoje. Commits 3022829c (migration) + bf71486d (legenda).
- **CASHFIX-02 (sync payables):** EF `sync-tiny-payables` v5 deployada via **MCP deploy_edge_function** (não precisou do token CLI do Wesley!). **Causa-raiz REAL ≠ os 4 suspects:** a lógica sempre funcionou (debug-sync provou: 1991 itens, upsert OK); o congelamento era o **pg_net derrubando a execução síncrona de ~15s aos 5s antes do commit**. Fix = `EdgeRuntime.waitUntil` (202 em ~290ms, background persiste). Provado: congelamento 18/06→25/06, synced_at avançando, count(distinct synced_at::date) 1→2, 1991 contas gravadas via chamada cron-style. Commits 0f877492 + 02cc72cd. **Sem migration de cron** (202 rápido basta).
- ⚠️ **FOLLOW-UP:** `sync-mp-releases` tem o MESMO padrão (EF lenta ~118s, pg_net timeout) — não congelou mas está em risco; vale aplicar o mesmo `waitUntil`.
- ⚠️ **Lição reusável:** EFs lentas chamadas por pg_cron devem usar `EdgeRuntime.waitUntil` (202 imediato) — senão o worker é descartado quando o pg_net abandona aos 5s, antes do commit. Deploy de EF dá pra fazer via MCP `deploy_edge_function` (verify_jwt=false p/ esta).
- **Plans:** `59-01` (CASHFIX-01 projeção: migration CREATE OR REPLACE get_cashflow base `20260619020000` BRT, CASE em accumulated_balance_sma + daily_projection, accumulated_balance intocado, apply via MCP + validação como checkpoint) · `59-02` (CASHFIX-02 sync: EF sync-tiny-payables debug-first + EdgeRuntime.waitUntil 202, prova de causa-raiz nos logs entre 4 suspects, deploy + prova de persistência — checkpoints do orquestrador).
- **Origem:** Wesley usando o dashboard de Fluxo de Caixa (Phase 49) achou 2 inconsistências reais. Diagnóstico ao vivo em prod `ckcdevcxgvueywivefgx`.
- **Issue 1 (Projeção):** linha SMA aplica a média diária (~R$6.486) desde hoje → infla o curto prazo (venda de hoje só vira caixa ~14d depois; já está no confirmado). **Regra travada com Wesley:** primeiros 7 dias = só confirmado (sem previsão); do 8º dia em diante a média entra **só nos dias SEM recebimento confirmado** (dias com recebimento mantêm o real). Fix na RPC `get_cashflow` (CASE na coluna `accumulated_balance_sma`, usando data BRT). Pegar a migration MAIS recente (3 mexem em get_cashflow: 20260619000000/010000/020000). Frontend provavelmente intocado.
- **Issue 2 (Contas a pagar CONGELADO):** `cash_outflows` = 1.960 linhas, `synced_at` = `2026-06-18 19:29` em TODAS (1 dia distinto). Cron `sync-tiny-payables-6h` ATIVO e `succeeded`, mas `net._http_response` mostra **`Timeout of 5000 ms reached`** (timeout default do pg_net) enquanto a EF leva ~15,7s. Agravante: EF retorna **200 em 15,7s mas NÃO grava** (synced_at preso em 18/06) → debug obrigatório (token Tiny vazio? fetch vazio? upsert engolido?). Fix: timeout no `net.http_post` (≥60s) ou EF assíncrona (waitUntil) + provar/corrigir a não-persistência. Manter cadência (6h já basta o "≥1x/dia").
- **Artefatos:** `phases/59-fluxo-caixa-correcoes/59-CONTEXT.md` + entrada no ROADMAP (Phase 59, CASHFIX-01/02). **Próximo: `/gsd-plan-phase 59`.**
- Reconciliação ao centavo com a DFC do Wesley (Phase 49) NÃO pode quebrar — só a curva da projeção muda.

---

## ✅ Phase 58 EXECUTADA + DEPLOYADA (2026-06-25) — Veracidade & Completude do Nexo

- **6 planos, 6 waves sequenciais** (todos tocam `tools.ts`). 192 testes verdes, build ✓, deno check ✓. 25 tools, anti-IDOR mantido, userJwt propagado index→runChat→loop→dispatchTool (B-1).
- **Fixes por domínio:** Estoque (get_inventory active default + agregado + variações esgotadas + rótulo Full + synced_at); Ads (get_ads_campaigns neutralizada — cache 100% zerado; nova get_ads_account_summary real); Financeiro (get_dre_monthly via ml_billing_daily mês-calendário = R$34.852,90 ≡ painel; cashflow saldo_hoje; cron re-sync billing); Operacional (get_reputation + get_goals NOVAS; claims/health/questions limpos); prompt.ts bloco VERACIDADE/FRESCURA/SEMÂNTICA.
- **Re-auditoria VERAC-07 (SQL real Pé Vermeio): 4 domínios PASS** — ver `58-VERIFICATION.md`. Achado novo corrigido inline: `get_goals` lia `lucro_pct`, chave real é `gross_profit` (commit 939cee1d).
- **DEPLOY (decisão Wesley "deploya já, roto depois"):** EF `nexo-chat` **v5** deployada via CLI (script 127kB; smoke 401 sem auth / 200 OPTIONS). Migration cron `billing-daily-resync` aplicada via MCP — **ATIVA** (`40 6 * * *`, itera por loja, Pattern B vault service_role_key). Resync manual imediato pegou **429 do ML** (transitório — cron das 06:40 reidrata; tool já sinaliza defasagem via coverage_until).
- **MERGEADO PRA PRODUÇÃO (2026-06-25):** Phases **57 (chat Nexo) + 58 (veracidade)** via **PR #9 → merge `670ac8be`**. Vercel prod deploy = **success**. Chat no ar (gated por hasMLConnection + kill-switch `consultor_config.llm_enabled`). `main` em sync com `origin/main`.
- ⚠️ **PENDENTE Wesley:** validação E2E logado em prod (get_reputation ao vivo + perguntas reais). **Rotação de GEMINI_API_KEY + SUPABASE_ACCESS_TOKEN ADIADA por decisão do Wesley** — EF roda sobre o Gemini key atual.
- Milestone v8.0 "Consultor v2": 52✅ 53✅ 54-W1✅ **57✅ 58✅** | faltam 54 (UI ações)/55 (multi-loja)/56 (snooze/limiares).

---

## ✅ Phase 53 FECHADA (2026-06-24) — Camada LLM (Gemini) em produção

- **53-01 + 53-02 completos.** EF `consultor-llm` **v4** (Gemini 2.5 Flash, modos summary+explain, cache-check first, numericGuard, kill-switch). **Blindada para prod: `verify_jwt=true`, smoke_token REMOVIDO do código e do vault** (chamada com smoke_token agora 401). Frontend: `ConsultorLLMSummary` (resumo COO no topo de /vendas) + "Explicar" por insight (ConsultorCard + MLConsultor) + "Atualizar análise" + badge stale; respeita kill-switch/fallback→v1.
- **Validado em preview Vercel** (resumo real Gemini + Explicar + kill-switch demonstrado ligando/desligando `consultor_config.llm_enabled` na Pé Vermeio). Fix de checkpoint: "Explicar" agora some junto com o resumo quando LLM desligada.
- **MERGEADO PRA PRODUÇÃO** (ver tarefa de merge). Tudo o que entrou junto: Phases 52 (schema/types), 54 Wave 1 (EF/hook inertes — sem UI ainda), limpeza de planning. Único impacto visível = Phase 53.
- ⚠️ **Wesley: ROTACIONAR a GEMINI_API_KEY** (exposta no transcript) — me manda a nova que eu re-registro no vault via `get_app_secret`.
- **Próximo:** Phase 57 (Nexo Conversacional) — **PLANEJADA** (ver abaixo).

## 🔧 Phase 57 EM EXECUÇÃO (2026-06-24) — Waves 1-2 DONE, deploy pendente

- **Wave 1 (57-01) ✅** — `playbooks.ts` (bundle ~49KB versionado da skill Nexo) + `prompt.ts` (persona COO + buildSystemPrompt) + EF skeleton `index.ts` (auth→is_org_member→kill-switch→vault→Gemini 2.5 Pro) + `vitest.config.ts` inclui `supabase/functions/**`. thinkingBudget=-1.
- **Wave 2 (57-02 ∥ 57-03) ✅** — 57-02: `tools.ts` (12 declarations sem param de org + dispatchTool anti-IDOR mapeando RPCs reais) + `loop.ts` (runChat cap=5/timeout 25s). **anti-IDOR provado por teste** (org alheia ignorada). 57-03: `useNexoChat` (efêmero) + `NexoChatPanel` (anti-XSS) + `NexoChatFab` montado no LayoutShell (todas as telas), gated por hasMLConnection + kill-switch. **145 testes verdes, build verde, deno check verde.** 16 commits (ecdb5565..ee743ada).
- **Hardening (ee743ada):** EF só honra `llm_model` gemini* (default da coluna é 'claude-haiku-4-5' → 404 sem guard). consultor_config normalizado p/ gemini-2.5-pro.
- **Wave 3 (57-04) — EF DEPLOYADA ✅ (2026-06-24):** `nexo-chat` ACTIVE v1, verify_jwt=true em ckcdevcxgvueywivefgx (deploy via CLI com token do Wesley; script 111.8kB c/ playbooks). Smoke: 401 sem auth + 200 OPTIONS (bundle compilou). consultor_config normalizado p/ gemini-2.5-pro. **Preview Vercel:** branch `preview/phase57-nexo-chat`, alias `...-git-pr-3a15c0-...`. **PENDENTE: validação E2E Wesley logado (NEXO-01..07) — "200 com reply" real só autenticado.** Depois: merge→prod (igual à 53) + verifier + fechar fase.
- ⚠️ Wesley deu SUPABASE_ACCESS_TOKEN no chat (sbp_…) → **REVOGAR** após uso.
- **Iterações de checkpoint (2026-06-24, em preview):**
  1. UI: painel virou **popup flutuante** compacto+animado (era Sheet lateral) + **ChatMarkdown** (renderer seguro: negrito/itálico/listas, sem dangerouslySetInnerHTML) + prompt usa markdown leve. Commit 62ff9be0.
  2. Fix caixa: `get_cashflow` usava janela passada (-30d) → vazio → Nexo dizia "não configurado". Agora janela FUTURA (hoje→+90d) + prompt anti-"não configurado". Commit (tools/prompt).
  3. **+10 tools (12→22)** p/ "responder qualquer coisa da conta": sales_kpis, margin_by_brand/trend/state, costs_by_month, supplier_exposure, inventory(+search), open_questions, claims, ads_campaigns. Todas anti-IDOR. EF v… redeployada (114.9kB). 20 testes EF verdes.
- **Pendente:** reaprovação visual Wesley do Nexo turbinado (mesma preview, F5). Depois: merge→prod + verifier + fechar fase.
- ⚠️ **ROTACIONAR GEMINI_API_KEY** antes do go-live real (vazou no transcript).

## ✅ Phase 57 PLANEJADA (2026-06-24) — Nexo Conversacional (chat consultor)

- **GSD plan-phase completo:** CONTEXT (decisões travadas) + RESEARCH (HIGH) + 4 planos / 3 waves + plan-checker **PASS após 1 revisão**. Commits `0c788415` (context) → `ad0ed513`/`c1cef66e` (planos) → `d6de0929` (revisão do checker).
- **Waves:** W1 `57-01` (playbooks bundle no repo + EF skeleton: auth→is_org_member→kill-switch→vault→Gemini 2.5 Pro `thinkingBudget=-1` + system prompt persona+playbooks) → W2 `57-02` (function-calling tools + dispatcher anti-IDOR + loop cap=5/timeout) ∥ `57-03` (FAB+Sheet `useNexoChat` em LayoutShell, efêmero) → W3 `57-04` (checkpoint: deploy EF pelo orquestrador + validação E2E Wesley).
- **Decisões-chave:** Gemini **2.5 Pro** (NÃO aceita thinkingBudget=0 — usa -1); tools mapeiam RPCs REAIS (`get_margin_with_ads_by_product`, `get_consultor_coverage`, `get_cost_waterfall`, etc.); playbooks (~49KB) copiados pro repo (`supabase/functions/nexo-chat/playbooks.ts` — Deno não acessa /root/.claude); anti-IDOR (org do JWT, nunca de args do modelo) como threat model de 1ª classe; read-only (sugere → Phase 54); efêmero (sem tabela). Reusa auth/vault/kill-switch da `consultor-llm`.
- **Fix do checker:** `vitest.config.ts` precisa incluir `supabase/functions/**/*.test.ts` (senão testes anti-IDOR/loop não rodam) — virou Task 1 do 57-01. get_app_secret('GEMINI_API_KEY') = pré-condição BLOQUEANTE do deploy no 57-04.
- **Pré-requisito de execução:** EF deploy é checkpoint do orquestrador (gsd-executor sem SUPABASE_ACCESS_TOKEN). **GEMINI_API_KEY no vault precisa estar rotacionada** (a atual vazou).
- **Próximo:** `/gsd-execute-phase 57`.

## ✅ Milestone v7.0 FECHADO (2026-06-24) + Phase 46 concluída

- **Phase 46 (UX para Leigos) — COMPLETA.** Plano 46-04 (checkpoint): gate técnico OK (`tsc --noEmit` sem erros, `npm run build` limpo 15s); glossário central de **28 termos** (`src/lib/kpi-glossary.ts`) com redação leiga **aprovada por Wesley**; checkpoint visual (tooltips hover+tap, empty states, tabelas→cards mobile, dark mode nas 6 páginas) **confirmado por Wesley** (validado em sessões anteriores). Cobertura UX-01: 15 telas consomem KPICard.
- **Milestone v7.0 FECHADO sem Stripe** — Phase 44 (Monetização Stripe) **deferida** por decisão de Wesley (versão de teste não precisa de pagamento; planos 44-01/02/03 existem para reativação futura). Phases 41,42,43,45,46,48,49,50,51 completas; 47 go-live técnico (PR#6).
- **Limpeza de planning commitada** (decisão Wesley): 252 planos de phase (`.planning/phases/*`) removidos do working tree + `REQUIREMENTS.md` reescrito para o v8.0. Planos preservados no histórico git (até commit fc7fbad5).
- **Próximo:** Milestone v8.0 — Consultor v2 (Inteligência). Research concluído (commits 5cf049b6 + fc7fbad5, 2026-06-23). Falta: definir requisitos + roadmap das phases.

## Fechamento Phase 47 — QA / Go-Live (2026-06-20, escopo técnico sem Stripe)

Decisão Wesley: pular tudo de assinatura/Stripe ("esta versão é só testes"). Critérios cobertos:

- **Build/deploy:** tsc --noEmit + npm run build limpos; prod READY.
- **Segurança (críticos corrigidos em prod via MCP):** migration `20260650000400_phase47_security_hardening` →
  (1) RLS habilitado em `cat_backfill_queue` (era advisor ERROR rls_disabled_in_public);
  (2) REVOKE total (anon/PUBLIC) em `batch_upsert_orders` + `upsert_order_preserve_cost` (anon escrevia pedidos via REST). EFs de sync usam service_role, sem regressão.

- **EFs de debug neutralizadas** (deploy stub 410, sem token p/ delete): `temp-reset-password` (backdoor reset-senha sem auth) e `probe-tiny-map`. Remoção definitiva do endpoint: dashboard ou `supabase functions delete` (requer SUPABASE_ACCESS_TOKEN).
- **EFs de negócio:** verify_jwt=true confirmado (ml-ads/inventory/reputation/precos-custos/recalc-order-costs/org-*/admin-*).

**Backlog não-bloqueante (deferido p/ go-live real):** ~13 helper/cron SECURITY DEFINER chamáveis por anon (enumeração, não escrevem); 9 funções search_path mutável; leaked-password protection off (config Auth); validação E2E de tenant-novo (depende de Stripe/Phase 44).

**Restam no milestone v7.0:** Phase 44 (Stripe) — adiada por decisão (não será o Wesley a organizar assinatura).

# Project State

## Project Reference

See: .planning/PROJECT.md

**Milestone:** v8.0 — Consultor v2 (Inteligência)
**Core value:** Consultor que explica, prioriza e ajuda a agir — LLM sob demanda + ações com aprovação, sobre o motor determinístico do v1.
**Current focus:** Phase 59 — fluxo-caixa-correcoes

## Current Position

Phase: 59 (fluxo-caixa-correcoes) — EXECUTING
Plan: 1 of 2
Status: Executing Phase 59
Last activity: 2026-06-25 — Phase 59 execution started
Next: **Phase 54 Wave 2** (`54-03` UI fila/diff/aprovar/histórico) + checkpoint visual; depois adaptar/executar **Phase 53 com Gemini**.

### Phase 54 — Wave 1 EXECUTADA (2026-06-24), Wave 2 PENDENTE

- **Wave 1 (backend) DONE:** EF `consultor-actions` **deployada em prod** (ckcdevcxgvueywivefgx, ACTIVE v1, verify_jwt=true) — 5 mutações ML do Nexo MCP, gate atômico antes do ML, anti-IDOR, pre-flight+TTL 48h, audit ≤4KB. Hook `useConsultorActions` + `actionMapping` (14 testes verdes, tsc/build OK). Commit 0a6cdffe. **Nenhuma mutação real disparada** (EF só roda quando a UI da Wave 2 invocar com ação aprovada).
- **Wave 2 PENDENTE:** `54-03` — UI no /consultor (abas Insights|Fila|Histórico owner-only, ProposeActionDialog diff+impacto, ActionQueue aprovar-c/-confirmação, ActionHistory) + checkpoint visual. Pausado por limite de contexto.
- **DECISÕES ABERTAS p/ Wesley (54):** D-A4 mapa rule_key→action_type; D-A2 preço-alvo = input owner; D-A3 TTL 48h; D-A1 campo `budget` de ads (confirmar na 1ª execução real).

### Phase 53 — MUDANÇA DE PROVEDOR: Anthropic → **Gemini** (decisão Wesley 2026-06-24)

- A key será do **Gemini**, não Anthropic. Planos 53-01/53-RESEARCH/ROADMAP/REQUIREMENTS dizem "Claude Haiku 4.5 / api.anthropic.com / cache_control ephemeral". **ADAPTAR antes de executar a 53:** trocar para Gemini (`generativelanguage.googleapis.com/v1beta/models/gemini-2.x:generateContent`, header `x-goog-api-key`, context caching do Gemini ≠ Anthropic ephemeral), modelo `gemini-flash`, secret `GEMINI_API_KEY` no vault. A lógica (cache-check first, grounding, numericGuard, kill-switch) permanece — só muda a camada de chamada ao LLM.
- **GEMINI VALIDADO em prod (2026-06-24, curl direto):** key funciona, `gemini-2.5-flash` HTTP 200, resumo COO PT-BR limpo sem alucinar números. **CONFIG DE PRODUÇÃO TRAVADA:** endpoint `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, header `x-goog-api-key`, body `{system_instruction:{parts:[{text}]}, contents:[{role:'user',parts:[{text}]}], generationConfig:{maxOutputTokens, temperature:0.3, thinkingConfig:{thinkingBudget:0}}}`. **CRÍTICO: `thinkingConfig.thinkingBudget=0`** senão o thinking do 2.5 consome todo o maxOutputTokens (resposta truncada). Resposta em `candidates[0].content.parts[0].text`, `finishReason:'STOP'`.
- **EF `consultor-llm` DEPLOYADA + TESTADA (2026-06-24, ACTIVE v2):** Gemini funcionando em prod. GEMINI_API_KEY + SMOKE_TOKEN no vault; RPC `get_app_secret` (SECURITY DEFINER service_role-only) lê os secrets. Auth dual (user JWT is_org_member | smoke_token). Smoke-test org `e4150d57` (30 insights): HTTP 200, resumo COO PT-BR, **fallback=false** (numericGuard passou). Commit 2ba612fe.
- **numericGuard:** allowed inclui TODOS os números do grounding (scores+impact+títulos) — sem isso dá falso-positivo de fallback (descoberto no 1º smoke).
- **53-02 (UI) ENTREGUE (2026-06-24, commit 7e1ea5b1):** EF `consultor-llm` **v3** com modo `explain` (insight único, cache por insight/dia `prompt_version='explain:'+id`, numericGuard, fallback determinístico via `body`; helper `callGemini` reusado; summary cai pro fallback em erro de rede; aceita `force_refresh`). Smoke-test prod do explain: HTTP 200, fallback=false, 2ª chamada cached=true. Frontend: `useConsultorInsights` estendido (summary query + `refreshSummary()` + `explain()`, API antiga intacta); `ConsultorLLMSummary` (novo, prosa COO no topo de /vendas + "Atualizar análise" + badge stale, respeita kill-switch/fallback→v1); botão "Explicar" por insight em `ConsultorCard` + `MLConsultor`. tsc+build+112 testes verdes. **PENDENTE: checkpoint visual Wesley** (resumo/Explicar/stale/kill-switch via preview Vercel). Remover/blindar o smoke_token backdoor antes de produção real (hoje gated no vault SMOKE_TOKEN='pv-smoke-2026-53').
- ⚠️ **Wesley: ROTACIONAR a GEMINI_API_KEY** (exposta no transcript) — atualizar via `vault` ou pedir pra eu re-registrar.

### Phases 53 + 54 PLANEJADAS (2026-06-24, plan-checker PASS nas duas)

- **53 (Camada LLM):** 2 plans — 53-01 EF `consultor-llm` (Haiku 4.5, cache-check first, grounding anti-alucinação `numericGuard`, kill-switch) + `ANTHROPIC_API_KEY` vault [BLOCKING]; 53-02 UI resumo COO + Explicar + staleness. Commit 984e33fb.
- **54 (Pipeline Ações):** 3 plans — 54-01 EF `consultor-actions` (5 mutações ML do zero portadas do Nexo MCP: PUT /items, PUT /advertising/.../campaigns api-version:2; gate claim_approved_action; pre-flight+TTL 48h; token-por-org anti-IDOR; audit ≤4KB) + 54-02 hook+actionMapping + 54-03 UI fila/diff/histórico. Commits ea9ff2f4 + a5639028 (fix item_id).
- **DECISÕES ABERTAS p/ Wesley (sinalizadas nos planos):** D-A4 mapa rule_key→action_type; D-A2 preço-alvo = input do owner (insight só dá item+impacto); D-A3 TTL 48h; D-A1 campo budget de ads. Confirmar antes/durante execução da 54.
- **Pré-requisito de execução:** registrar `ANTHROPIC_API_KEY` no vault (53) — orquestrador via MCP. Ambas têm deploy de EF [BLOCKING] (gsd-executor sem Supabase MCP).

### Phase 52 (2026-06-24) — schema v8.0 em prod

- 3 tabelas novas: `proposed_actions` (state-machine 6 estados text+CHECK + dedup parcial), `action_audit_log` (append-only), `llm_analysis_cache` (org-first key).
- ALTERs: `insights.snoozed_until`/`snooze_count`, `consultor_config.llm_enabled`/`llm_model`, `consultor_health_snapshots.ml_user_id_key` (+ troca UNIQUE p/ por-loja).
- RPC `claim_approved_action` SECURITY INVOKER (anti-IDOR) + REVOKE de PUBLIC/anon/authenticated (anti default-EXECUTE).
- 4 migrations `20260652*` commitadas; aplicadas via MCP (CLI no projeto errado — nunca db push). types.ts manual.
- **WARNING aberto (não-bloqueante, p/ Phase 56):** mapeamento TUNE-01 → 14 limiares existentes é MEDIUM confidence; confirmar com Wesley se quer limiares-alvo NOVOS antes da 56.

### Pendências de validação visual (não bloqueiam novo milestone)

- Checkpoint visual do painel de Tesouraria (Phase 51) por Wesley.
- Card "Caixa Hoje": conferir saldo inicial (efeito do fix de fuso BRT pode estar 1 dia adiantado; ajustável pelo botão).

### Fechamento Phase 51 (2026-06-20) — EM PROD via PR#4 (merge 69883b00) + fix mobile PR#7 (101754ef)

### Fechamento Phase 51 (2026-06-20)

- **Verifier:** PASS 5/5 (TESO-01..05), build limpo (51-VERIFICATION.md).
- **Code review:** 1 Critical + 4 High (51-REVIEW.md). HG-02 e HG-04 = falsos positivos vs prod (já BRT / já bounded). Reais corrigidos + aplicados em prod via MCP (commit 1d1750c4):
  - CR-01: enrich_drain token Tiny hardcoded (1639558873) → token por org da fila + REVOKE de PUBLIC/anon/authenticated. (latente: só Pé Vermeio usa Tiny hoje)
  - HG-01: card "Saldo Mín" → horizonte 30d (decisão Wesley); RPC retorna min_balance (valor) + data do mesmo modelo. −719k/90d → −168k/30d.
  - HG-03: burn_rate só status='paid' (R$185.149) consistente c/ Saída Real (decisão Wesley). Antes R$189.316 (incluía 9 contas vencidas).
- Migrations prod: treasury_fix_cr01_enrich_drain_security, treasury_fix_hg01_hg03_panel. Arquivo repo: 20260650000200.
- **STATUS:** Ready to execute

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260613-2p6 | DRE mês-calendário exato (01–31) via ml_billing_daily | 2026-06-13 | feat(dre) | [260613-2p6](./quick/260613-2p6-dre-mes-calendario-exato-01-31-via-ml-bi/) |
| 260618-sum | Fluxo de caixa: RPCs consideram contas a pagar de QUALQUER status (paid+pending), futuro-only | 2026-06-18 | 5652ebfa | [260618-sum](./quick/260618-sum-corrigir-rpcs-de-fluxo-de-caixa-consider/) |
| 260618-sma | Fluxo de caixa: 2ª linha de projeção (média 15d via orders) — AGUARDA validação Wesley | 2026-06-18 | fe19611d | [260618-sma](./quick/260618-sma-segunda-linha-projecao-media-15d/) |
| 260619-02b | Fluxo de caixa: base da média 15d = bruta−comissão−frete (sem dupla imposto) + rótulo piso ~30d | 2026-06-19 | ddf946c8 | [260619-02b](./quick/260619-02b-trocar-base-da-linha-de-projecao-media-1/) |

### DRE mês-calendário (quick 260613-2p6, 2026-06-13)

- **Problema:** ciclo de fatura ML = dia 06→05 (não mês-calendário). Card do mês corrente mostrava ~7 dias de tarifa vs 30 de receita → lucro inflado (jun ~R$27k, real ~R$11k).
- **Solução:** tabela `ml_billing_daily` (agregado por dia+tipo, competência = data de lançamento), EF v8 modo `daily` (pagina /details ML+MP **sequencial** — offset é instável sob concorrência), cascata daily→fatura mensal→estimado no card, badge "mês 01–31".
- **Regra de reconciliação:** estornos B* só contam se a venda caiu na janela de consumo da fatura (ML exclui estornos de vendas antigas). Reconcilia 99,8%.
- **Backfill mar–jun** validado vs faturas (±0,2–2%). **2026-05/consumo-abril subcontado −1,7%** (paginação offset instável no backfill pg_net) — EF corrige ao re-sincronizar; mês corrente OK.
- **Pendente:** checkpoint visual Wesley (badge "mês 01–31", lucro junho ~R$11k).

### DATA-01 executado (2026-06-12, commit fc090c46)

- Migration `20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve` aplicada em produção (ckcdevcxgvueywivefgx)
- **ATENÇÃO:** migration local `20260601000000` foi REMOVIDA do repo — nunca aplicada e continha batch_upsert_orders sem cast ::uuid (reverteria fix da Phase 38)
- Validado via SQL: get_cost_waterfall jun/01-12 → paid_revenue R$115.195, CMV R$46.165, tax R$23.667 não-nulos (402 orders); fallback + COALESCE + cast ::uuid confirmados via pg_get_functiondef
- Pendente: confirmação visual de Wesley no card "Custos" em /vendas (CMV e Impostos aparecendo)
- Descoberta: produção tinha 0 orders com receita_bruta NULL (backfill virou no-op idempotente); o bug ativo era só a definição das funções
- Supabase CLI local linkado no projeto ERRADO (gionpsuunfkkzzjdubfy) — não usar `db push`; aplicar migrations via MCP apply_migration no ckcdevcxgvueywivefgx

## Performance Metrics

**Velocity:**

- Total plans completed: 4
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 41. Veracidade Total | TBD | — | — |
| 42. Zero Mock | TBD | — | — |
| 43. Multi-Tenant Hardening | TBD | — | — |
| 44. Monetizacao Stripe | TBD | — | — |
| 45. Consultor v1 | TBD | — | — |
| 46. UX para Leigos | TBD | — | — |
| 47. QA End-to-End + Go-Live | TBD | — | — |
| Phase 41-veracidade-total P03 | 15 | 3 tasks | 1 files |
| 41 | 4 | - | - |
| Phase 42-zero-mock P01 | 30min | 3 tasks | 4 files |
| Phase 42-zero-mock P04 | 3min | 1 tasks | 1 files |
| Phase 43-multi-tenant-hardening P01 | 205 | 3 tasks | 4 files |
| Phase 48-mco-com-ads P01 | 45min | 3 tasks | 3 files |
| Phase 48-mco-com-ads P02 | 30min | 3 tasks | 1 files |
| Phase 48-mco-com-ads P03 | ~3h | 2 tasks + 3 fixes + 1 checkpoint | 4 files |
| Phase 46-ux-para-leigos P01 | 4min | 3 tasks | 3 files |
| Phase 46 P02 | 213 | 3 tasks | 5 files |
| Phase 46 P03 | 90 | 2 tasks | 3 files |
| Phase 46-ux-para-leigos P05 | 8min | 2 tasks | 6 files |
| Phase 49-fluxo-de-caixa-caixa-real P01 | 45m | 3 tasks | 4 files |
| Phase 49-fluxo-de-caixa-caixa-real P03 | 15min | 2 tasks | 6 files |
| Phase 49 P04 | 20 | 2 tasks | 8 files |
| Phase 51-painel-de-tesouraria-fluxo-de-caixa P03 | 25min | 4 tasks | 4 files |
| Phase 58-veracidade-completude-dados P01 | 8min | 2 tasks | 2 files |
| Phase 58-veracidade-completude-dados P03 | 4min | 2 tasks | 3 files |
| Phase 58 P04 | 6min | 2 tasks | 4 files |
| Phase 58 P05 | 3min | 1 tasks | 2 files |

## Accumulated Context

### Decisions

- Phase 17-02: item_id placeholder "TINY_{sku}" used in ml_product_costs because sync-ml-orders keys costMap by item_id (not seller_sku) — follow-up needed to wire SKU-based cost lookup in sync-ml-orders
- Phase 18-02: Tiny OAuth state elevated to Integrations parent scope (same pattern as ML OAuth)
- Phase 18-02: sync-tiny-costs now uses stored tiny_access_token + refresh via tiny-oauth (no client_credentials)
- Phase 18-02: tiny token columns added to types.ts manually (not regenerated from Supabase schema)
- Fonte primária de comissão/frete: `ml_orders` (orders individuais via ML API)
- Fonte primária de CFFE/CFONPN: `ml_billing_monthly` (ML Billing API `/billing/periods`)
- Phase 14 e Phase 15 são independentes entre si (podem ser executadas em paralelo)
- Nexo MCP Supabase: `muesqdxnjlbaoiqylpjn` — estrutura de referência para schemas
- Scope garment-glow: sempre `organization_id` + `ml_user_id` (não apenas `seller_id`)
- Milestone anterior v6.0 completo — brand charts, sync de orders e ads spend reais funcionando
- **Supabase project correto: ckcdevcxgvueywivefgx** (CLAUDE.md menciona gionpsuunfkkzzjdubfy — desatualizado, sempre usar ckcdevcxgvueywivefgx)
- Gateway de pagamento: Stripe (checkout + webhook + customer portal)
- Entrada de clientes: convite controlado (self-service signup fica para v2)
- Consultor v1: motor de regras determinístico (~12 regras + score 0-100), sem LLM por usuário
- /perguntas e /devolucoes: integração real (ML Questions API + Claims API — portar padrão do Nexo MCP)
- [Phase ?]: DATA-05: guard columnView removido do commCache useEffect — comissao real populada para todos os itens filtrados
- [Phase ?]: DATA-06: /vendas e /financeiro confirmados usando useMLCostWaterfall como fonte unica — sem fix de codigo necessario
- [Phase ?]: vault.secrets service_role_key deferred to plan 42-02: Wesley must insert SERVICE_ROLE_KEY before pg_cron migration is applied
- [Phase ?]: 42-04: Sellers loaded from sellers table scoped to currentOrg.id filtered ML-connected via ml_tokens
- [Phase ?]: RLS org-first usa is_org_member/get_org_role em ml_product_costs; user_id mantido como auditoria (D-10/D-11)
- [Phase ?]: Backfill de orfaos via ml_tokens (nao organization_members) para evitar duplicacao multi-org (D-02)
- [Phase ?]: ml_billing_monthly trocado de FOR ALL para FOR SELECT — viewer nao escreve billing (ME-06/D-15)
- [Phase 43-04]: TENANT-05 confirmado — teste de isolamento 2-org (Pé Vermeio + Thales) via MCP: 0 vazamentos cross-org em 15 tabelas scope-org; ME-04/05/06 e quota PASS. Veredito PASS, sem FAIL
- [Phase 43-04]: Método de verificação de RLS = impersonação `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims',...,true)` em transação ROLLBACK (service_role bypassa RLS)
- [Phase 43-04]: RESSALVA `ml_targets` sem `organization_id` (scope user_id/seller_id) — fora do loop por-org; verificação dedicada recomendada na code-review/verify-phase
- [Phase ?]: SECURITY INVOKER (não DEFINER) para RPCs de margem: RLS org-first de orders/ml_ads_products_cache enforça isolamento de tenant; DEFINER era IDOR CRITICAL (bypass RLS com p_org_id alheio)
- [Phase ?]: PostgREST trunca em 1000 linhas apenas no endpoint REST; supabase.rpc() retorna set completo — sem LIMIT na RPC é suficiente para MCO-01
- [Phase ?]: ads_eating_margin é SEPARADO de margin_critical (D-07/MCO-04): produto com lucro operacional > 0 pode disparar ads_eating sem estar em margin_critical
- [Phase ?]: RULE ads_no_sale mantém rule_key='ads_no_sale' ao migrar org→item-level (D-09/D-10): índice único (org,rule_key,ml_user_id_key) diferencia '' de item_id; org-level antigo auto-resolvido
- [Phase ?]: Paginação .range() loop obrigatória em ml_ads_products_cache (~6000 linhas/30d): PostgREST trunca em 1000 linhas
- [Phase 48-03]: DRE não adiciona linha extra de Publicidade — groupBillingCharges já categoriza PADS em 'Campanhas de publicidade'; linha extra causaria dupla contagem (Pitfall 7 mais profundo que documentado)
- [Phase 48-03]: supabase.rpc() retorna set completo sem LIMIT; PostgREST select direto trunca em 1000 linhas — para conjuntos financeiros >1000 linhas/período, sempre usar RPC
- [Phase 48-03]: MCO-02 e MCO-03 satisfeitos e aprovados por Wesley no preview Vercel (dados reais ckcdevcxgvueywivefgx)
- [Phase 46]: Popover over Tooltip for KPICard: Radix Tooltip does not fire on touch; Popover with controlled open state is reliable on iOS/Android
- [Phase 46]: KPICard tooltip prop stays string (not GlossaryKey) — component stays generic; consumers do glossary lookup
- [Phase ?]: tip(key) helper defined in MLKPIGrid typed by keyof typeof KPI_GLOSSARY — tsc enforces valid glossary keys at compile time
- [Phase ?]: MLEstoque NotConnected CTA uses /integracoes (correct Portuguese route)
- [Phase ?]: Sub-tables kept overflow-x-auto scroll — secondary analytical views with column-comparison needs; primary CRUD tables upgraded to stacked cards
- [Phase ?]: Recharts SVG fill/stroke hex values preserved untouched — SVG attributes bypass Tailwind token system
- [Phase ?]: cash_outflows com schema Tiny criada no 49-01 compartilhada por 49-05
- [Phase ?]: release_date e outflow_date como DATE não timestamptz para cálculo de caixa por dia
- [Phase ?]: Mantido como média das saídas dos últimos 3 meses para diferenciar de Saída Real (30d)
- [Phase ?]: get_inventory: status allow-list (active/paused/all), valor fora do enum cai no default active
- [Phase ?]: summarizeVariations exportada como função pura para testabilidade e legibilidade
- [Phase ?]: get_reputation via EF ml-reputation com JWT real; get_goals via ml_targets anti-IDOR por seller_id; userJwt threading 3 elos (index→loop→tools)

### Nexo MCP Data Reference (análise 2026-05-21)

Abril/2026 — Pé Vermeio (seller_id=1639558873):

- Receita bruta orders: R$351.236
- Comissão real (sum orders.comissao): R$39.170 (11.15%)
- Frete real (sum orders.frete): R$37.555 — mas CFFE billing R$40.065 (inclui extras)
- CFONPN (parcelamento): R$15.902 — INVISÍVEL hoje
- PADS (publicidade): R$12.341
- Bonificações BVVML: −R$3.004

Dashboard atual mostra:

- Frete: ~R$17.561 (5% hardcoded) → erro de R$22.504
- CFONPN: R$0 → erro de R$15.902
- Total custos subestimados: ~R$38.406/mês

### Pending Todos

- Rodar `/gsd-plan-phase 41` — plans prontos para DATA-01 (32-01), DATA-02 (31-01), DATA-03 (21-01) devem ser referenciados e reaproveitados pelo planejador
- Testar sync Tiny ERP em /integracoes → clicar "Sincronizar Custos" → verificar `SELECT COUNT(*) FROM ml_product_costs WHERE cost > 0;`

### Blockers/Concerns

- A `mercado-libre-integration` usa Deno — cuidado com o tamanho da função ao adicionar upsert em `ml_orders`
- ML Billing API pode ter formato diferente de `/orders` — validar campos CFFE e CFONPN durante planejamento da Phase 41 (bloco DATA-04)
- ML Claims/Questions API: rate limits e formatos — mitigar portando lógica já validada do Nexo MCP (/root/nexo-mcp/)
- Stripe em 1 dia é apertado — escopo mínimo: checkout + webhook + portal (sem proration custom)
- Phases 28/29 (performance) ficam condicionais — só entram no dia 10 (Phase 47) se QA mostrar lentidão real

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v5.1 | Filtros por estado/cidade/SKU no dashboard | Deferred | Roadmap v5.0 |
| v5.1 | Billing para outras contas além da Pé Vermeio | Deferred | Roadmap v5.0 |
| v5.1 | DIFAL, CSHIA e outras cobranças menores do billing | Deferred | Roadmap v5.0 |
| v6.0 | Melhorias em outros menus (Publicidade, Estoque, Financeiro) | Deferred | Roadmap v5.0 |
| v8.0 | Self-service signup público | Deferred | Roadmap v7.0 |
| v8.0 | Consultor com análises geradas por LLM | Deferred | Roadmap v7.0 |
| v8.0 | Phase 23 dashboard granular (coluna Margem % em Top Anúncios, dual-axis) | Deferred | Roadmap v7.0 |
| v8.0 | Phases 28/29 performance — só entram se QA mostrar lentidão | Conditional | Roadmap v7.0 |
| v8.0 | Landing page pública de marketing/pricing | Deferred | Roadmap v7.0 |

## Session Continuity

Last session: 2026-06-24T21:30:22.878Z
Stopped at: Phase 51 planned + verified (3 plans, 3 waves)

### Sessão 2026-06-14 — Phase 43 fechada (43-04 isolamento)

- **43-04 (Wave 3) COMPLETO** — ISOLATION-TEST.md (roteiro reproduzível 2-org) escrito (commit b8656049) + executado via MCP no `ckcdevcxgvueywivefgx` com as 2 orgs reais (Pé Vermeio `7f615df7-...` MLUID 1639558873 / Thales `e4150d57-...` MLUID 427063369) (resultados commit f3b383bf).
- **Veredito PASS:** §2 RLS bidirecional 0 vazamentos em 15 tabelas scope-org; §4 ME-06 INSERT billing sob owner → ERROR 42501 (só FOR SELECT); §5 ME-05 guard is_org_member nas 3 EFs (código); §6 ME-04 ORDER BY updated_at nas 4 EFs (v20/v9/v10/v9); §7 TENANT-03 check_quota [t,t,t,f,f] limite=3 + enterprise sempre true.
- **Pendentes não-bloqueantes:** ME-05 comportamental ao vivo (JWT de sessão no browser, Wesley); confirmação visual frontend por org; ressalva `ml_targets` (sem organization_id) → verificação dedicada na code-review/verify-phase.
- **Aprendizado:** gsd-executor não tem MCP/deploy Supabase → Task 2 (checkpoint blocking) executada pelo orquestrador; executor só escreveu o roteiro (Task 1).

### Sessão 2026-06-13 — Fechamento Phase 41

**41-04 finalizado:**

- EF sync-ml-billing v4 deployada (bonuses B* nos charges) → depois v6 com fix HI-01 (404 ≠ 401/429/5xx); smoke 401 OK
- Re-sync mar–jun JÁ tinha sido feito no fim da sessão anterior (synced_at 18:54/19:50) — validado: cancelamentos jun -674,87 / mai -6.820,03 / abr -8.895,29 / mar -9.301,68; jun CFONPN 3.008,28 EXATO
- Frontend: linha "Cancelamentos de tarifas" (última, líquido = total_amount da fatura) + navegação ‹ Mês/Ano › no card (dreMonthOverride, reset ao mudar filtro, canGoNext≤mês corrente) + useMLBillingWithSync (sync on-demand via user JWT, 1 tentativa por escopo+período, falha libera retry)

**Fechamento:**

- gsd-verifier: PASSED 12/12 (VERIFICATION.md)
- Code review: 18 findings (1C/3H/6M/8L) em REVIEW.md — corrigidos na hora: CR-01 (merge multi-loja no useMLBilling), HI-01 (EF status branch), HI-02 (useMLSync re-sync mês anterior), HI-03 (MLAnuncios chunks de 5), ME-01 (loading DRE), ME-02/03 (attemptKey por escopo + retry), LO-07 (prop morta)
- **Deferidos → Phase 43 (Multi-Tenant Hardening): ME-04/05/06** (ml_tokens lookup não-determinístico, enumeração ml_user_id, RLS viewer com INSERT/UPDATE/DELETE em billing). Lows no REVIEW.md.
- REQUIREMENTS.md: DATA-01..06 marcados Complete; phase.complete OK
- Checkpoint visual de Wesley sobre cancelamentos + navegação de meses: **pendente** (verificar card Custos em /vendas)

**Pós-fechamento (mesma sessão, decisão Wesley — opção C):**

- **Ciclo REAL da fatura ML da conta: dia 06 → dia 05 do mês seguinte** (não mês-calendário). Confirmado via /billing/periods: key 2026-06 = 06/mai–05/jun. O DRE mantém o espelho da fatura e exibe a janela real no card ("Tarifas da fatura ML: 06/05 → 05/06"). EF v7 grava resumo.invoice_from/invoice_to; período OPEN tem date_from anômalo (placeholder) → derivado de date_to. Backfill mar–jun feito. Commit 86314ee7.
- ~~Observação não investigada~~ **RESOLVIDO (2026-06-13)**: a diferença de 2.241,18 na fatura key 2026-04 é o type **CSHIA = "Tarifa por disponibilidade antecipada de dinheiro em conta"** (antecipação de recebíveis MP): 2 lançamentos em março (08/03 R$1.097,11 + 16/03 R$1.144,07). CSHIA pertence ao **group MP**, não ML — o `amount` da listagem de periods (group=ML) o exclui; o `bill_includes.total_amount` do summary (nossa fonte) inclui a fatura completa (ML+MP). Nosso número (113.742,18) é o correto/oficial. CSHIA hoje cai no bucket "Outras tarifas" do DRE.

**Aprendizados de domínio (manter):**

- Fatura ML = mês de fechamento; consumo N → fatura N+1 (chave period 2026-07 existe em 12/jun = fatura corrente)
- Janela da fatura = ciclo da conta (06→05), varia por conta; receita do DRE é mês-calendário — descasamento de borda ~5 dias é explícito no card
- Cancelamentos/estornos em bill_includes.bonuses (types B*), negativos; total_amount = charges + bonuses
- Referência "abril" do Nexo na memória era fatura de abril = consumo de MARÇO (Nexo rotula por fatura)
- Invocar EF programaticamente: net.http_get/post com token de ml_tokens (ML API direto); key sb_secret do cron ≠ SERVICE_ROLE_KEY env → 401 esperado na EF
- Decisão Wesley: card Custos = DRE mensal (sempre mês), espelhando a fatura ML; demais cards seguem o filtro

---

## Sessão 2026-06-04 — Phases 36/37/38

**Phase 36 (concluída, deployada)** — brand charts via ml_product_daily_cache fallback

- Migration `marca` em ml_product_daily_cache + mercado-libre-integration busca BRAND
- useMLOrdersByBrand: fallback para cache quando orders vazio

**Phase 37 (deployada)** — markup por marca via seller_sku

- Root cause: ml_product_costs.item_id = `TINY_<sku>` mas cache.item_id = `MLB...` → join nunca casava
- Ponte correta: seller_sku (`seller_custom_field` no ML)
- Migration `seller_sku` em ml_product_daily_cache (20260604120000)
- mercado-libre-integration v12: popula seller_sku
- recalc-order-costs v13: usa orders.sku → costs.seller_sku (prioridade Tiny) + fallback item_id legado
- useMLOrdersByBrand: join por seller_sku
- PENDENTE: aguardar próximo sync para popular seller_sku no cache; validar markup carregando

**Phase 38 (concluída)** — validar 5 páginas do dashboard

- Causa raiz: orders congelou em 2026-05-27 — batch_upsert_orders falhava e o erro era mascarado
- Fixes: cast ::uuid + JSON.stringify fix + throw em erros + mercado-libre-integration v13 service-role
- Commits: 0f31e710, f69a8bc1

**Phase 39 (concluída)** — /anuncios custo + /publicidade produtos

- /anuncios: costFor() com fallback por seller_sku (useMLProductCosts expõe costsBySku)
- /publicidade: sync-ads v18 com metrics params + constraint única dropeada
- Backfill 30 dias: spend real populado
- Commits: 57bbb9aa, cb0ec5c9

**Phase 40 (concluída)** — fix charts overlap brand row

- min-w-0 overflow-hidden nos 3 Card raízes de BrandRevenueChart, BrandMarkupChart, CustoOperacionalChart
- Commits: confirmados e deployados via Vercel

**Deploys confirmados (project ckcdevcxgvueywivefgx):**

- mercado-libre-integration v13 ACTIVE
- recalc-order-costs v13 ACTIVE
- sync-ads v18 ACTIVE
