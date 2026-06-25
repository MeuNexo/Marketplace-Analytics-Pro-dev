---
phase: 57-nexo-conversacional-chat-consultor
plan: 02
subsystem: edge-functions / consultor-llm / function-calling
tags: [nexo-chat, gemini-2.5-pro, function-calling, tools, anti-idor, loop-guardrails, vitest]
requires:
  - "EF nexo-chat skeleton (Plan 57-01: auth JWT → is_org_member → kill-switch → vault → Gemini)"
  - "RPCs reais em prod (ckcdevcxgvueywivefgx): get_margin_with_ads_by_product, get_margin_summary, get_cost_waterfall, get_consultor_coverage, get_consultor_paused_with_sales, get_consultor_no_cost_count, get_cashflow, get_treasury_panel"
  - "tabelas insights, ml_ads_products_cache, ml_billing_monthly, consultor_health_snapshots, ml_tokens"
  - "vitest include estendido p/ supabase/functions/** (Plan 57-01 Task 1)"
provides:
  - "tools.ts: TOOL_DECLARATIONS (12 tools Gemini, sem param de org/seller) + dispatchTool(sb, orgId, mlUserIds, name, args) escopado por org (anti-IDOR)"
  - "loop.ts: runChat() — loop server-side de function-calling com cap=5 + timeout 25s + append correto de contents"
  - "index.ts: resolve mlUserIds server-side (ml_tokens) e delega ao runChat(); resposta {reply, used_tools, fallback}"
affects:
  - supabase/functions/nexo-chat/index.ts (chamada Gemini única → loop runChat)
tech-stack:
  added: []
  patterns:
    - "Dispatcher de tools escopado: orgId (JWT) + mlUserIds (server-side) injetados; args.org_id/seller_id/ml_user_id do modelo IGNORADOS"
    - "Loop de tool-calling server-side com cap de iterações + timeout + cap de 50 linhas/tool (guardrails de custo/latência)"
    - "fetch/dispatch/now injetáveis → loop testável sem rede (vitest)"
    - "thinkingBudget=-1 (nunca 0 no 2.5-pro)"
key-files:
  created:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
    - supabase/functions/nexo-chat/loop.ts
    - supabase/functions/nexo-chat/loop.test.ts
  modified:
    - supabase/functions/nexo-chat/index.ts
decisions:
  - "dispatchTool e fetch são injetáveis em runChat (opts.dispatchImpl/fetchImpl/nowImpl) — único jeito de provar cap/timeout/append no vitest sem Deno nem rede; default usa o dispatchTool real e globalThis.fetch"
  - "get_sales_velocity NÃO virou tool dedicada (RESEARCH A1): cobertura/velocidade vêm de get_coverage(avg_daily)/get_paused_with_sales(vendas_30d) — evita RPC nova"
  - "get_dre_monthly aceita period_month opcional (YYYY-MM, default mês corrente) além de não ter org param — mantém a tool útil sem expor org"
metrics:
  duration_min: 6
  completed: 2026-06-24
  tasks: 3
  files: 5
  commits: 3
status: complete
---

# Phase 57 Plan 02: Function-calling read-only do Nexo (tools + loop, anti-IDOR + guardrails) Summary

A EF `nexo-chat` ganhou a camada de function-calling: 12 tools mapeadas a RPCs/tabelas reais, um dispatcher escopado por org (anti-IDOR de 1ª classe) e um loop server-side com cap de iterações + timeout. O Nexo agora consulta dados ao vivo da conta (margem/MCO/ads, estoque/cobertura, KPIs, insights, DRE, cashflow, tesouraria, health) sob demanda, sempre escopado ao org do JWT — orquestração, sem recomputo de métricas.

## What Was Built

- **supabase/functions/nexo-chat/tools.ts**
  - `TOOL_DECLARATIONS`: 12 function declarations Gemini (`get_margin_by_product`, `get_margin_summary`, `get_day_kpis`, `get_coverage`, `get_paused_with_sales`, `get_no_cost_count`, `get_active_insights`, `get_ads_by_product`, `get_dre_monthly`, `get_cashflow`, `get_treasury_panel`, `get_health_score`). **Nenhuma** declara `org_id`/`seller_id`/`ml_user_id` como parâmetro — só datas opcionais (`from`/`to` YYYY-MM-DD) / `period_month` / `horizon`.
  - `dispatchTool(sb, orgId, mlUserIds, name, args)`: switch por `name` mapeando à RPC/tabela real. SEMPRE injeta `p_org_id=orgId` (+ `p_user_ids=mlUserIds` nas INVOKER), e `.eq('organization_id', orgId)` (+ `.in('ml_user_id', mlUserIds)`) nos selects diretos. `args` só influenciam datas (clamp + default `to=hoje`/`from=30d`; data malformada → default). Cap de 50 linhas/tool. `ml_ads_products_cache` pagina `.range()` (evita truncamento PostgREST de 1000) e agrega por `item_id`. Tool desconhecida → `{error:"unknown_tool"}` (não lança). Helpers `clampDate`/`today`/`daysAgo`/`clampMonth`.
- **supabase/functions/nexo-chat/tools.test.ts** — 13 testes (vitest, `sb` stub encadeável): anti-IDOR (`args.org_id="ORG-ALHEIA"`/`seller_id="999"` ignorados; RPC recebe orgId do servidor), declarations sem param de org, `.eq(organization_id)`/`.in(ml_user_id)` nos selects, datas default/malformada, cap de 50 linhas, `unknown_tool`.
- **supabase/functions/nexo-chat/loop.ts** — `runChat(sb, gkey, orgId, mlUserIds, systemPrompt, clientMessages, opts?)`: loop Gemini → `functionCall` → `dispatchTool` → `functionResponse` até a resposta-texto. `MAX_TOOL_ITERS=5`, `TURN_DEADLINE_MS=25000` (checado no topo do loop). Append correto de `contents` (`model.functionCall` depois `user.functionResponse`). `toolConfig.functionCallingConfig.mode="AUTO"`, `generationConfig.thinkingConfig.thinkingBudget=-1` (nunca 0), `temperature 0.3`, `maxOutputTokens 1200`. `fetchImpl`/`dispatchImpl`/`nowImpl`/`model` injetáveis (default `globalThis.fetch` + `dispatchTool` real + `Date.now`). `!ok`/rede/cap/timeout → `fallback:true`.
- **supabase/functions/nexo-chat/loop.test.ts** — 6 testes (vitest, fetch/dispatch mockados): (a) só-texto → 1 chamada, sem dispatch; (b) `functionCall`→texto → dispatch 1x, `usedTools=[nome]`, append de 3 contents conferido; (c) sempre-`functionCall` → para em 5 chamadas com `fallback:true`; (d) deadline forçado via `nowImpl` → `fallback` sem fetch; (e) `thinkingBudget:-1` + `toolConfig AUTO` + tools no body + header `x-goog-api-key`; (f) `!ok`→`fallback`.
- **supabase/functions/nexo-chat/index.ts** — resolve `mlUserIds` server-side (`ml_tokens` `.eq(organization_id)` `.not(refresh_token,is,null)`); substitui a chamada Gemini única (57-01) por `runChat(...)`; retorna `{reply, used_tools, fallback}`; log só metadados (`tools=N fallback=B`), nunca conteúdo/segredo. Cadeia de segurança (auth → is_org_member → kill-switch → vault) intacta.

## Task → Commit

| Task | Nome | Tipo | Commit |
|------|------|------|--------|
| 1 | tools.ts — declarations + dispatchTool escopado (anti-IDOR) [RED+GREEN] | feat | `d4ba6456` |
| 2 | loop.ts — runChat() com cap + timeout (NEXO-07) [RED+GREEN] | feat | `2695b1d8` |
| 3 | index.ts — resolve mlUserIds server-side + delega ao runChat | feat | `6dfd66a6` |

> TDD: RED de cada tarefa foi confirmado (módulo inexistente → "no tests"/transform error) antes do GREEN; RED e GREEN foram commitados juntos por arquivo (test + impl nascem no mesmo commit feat).

## Verification Results

- `npx vitest run supabase/functions/nexo-chat/tools.test.ts` → **13 passed** (nunca "no test files found") — prova anti-IDOR + cap + unknown_tool.
- `npx vitest run supabase/functions/nexo-chat/loop.test.ts` → **6 passed** (nunca "no test files found") — prova cap=5, timeout, append correto, thinkingBudget -1.
- `npx vitest run` (suite completa) → **138 passed (14 files)**, incluindo as duas novas suites.
- `npm run build` (tsc + vite) → **verde** (~20s).
- `deno check supabase/functions/nexo-chat/index.ts` → **verde** (type-checa index + loop + tools por import; Deno disponível neste ambiente).
- Grep da Task 3 (`runChat(` + `ml_tokens` + `refresh_token`) → **PASS**.

## Threat Model Compliance

- **T-57-07 (IDOR via args do modelo):** `dispatchTool` ignora `args.org_id`/`seller_id`/`ml_user_id`; usa `orgId` (JWT) + `mlUserIds` (servidor). Declarations sem param de org. Provado por `tools.test` (RPC recebe orgId do servidor mesmo com `args.org_id="ORG-ALHEIA"`; nenhuma declaration cita org/seller). ✓
- **T-57-08 (cross-org leak via service_role):** `.eq('organization_id', orgId)` obrigatório em `insights`/`ml_ads_products_cache`/`ml_billing_monthly`/`consultor_health_snapshots`; `.in('ml_user_id', mlUserIds)` onde aplicável; RPCs com `p_org_id`/`p_user_ids`. Provado por `tools.test`. ✓
- **T-57-09 (DoS custo/latência):** `MAX_TOOL_ITERS=5` + `TURN_DEADLINE_MS=25000` + cap de 50 linhas/tool. Provado por `loop.test` (para em 5 chamadas; timeout sem fetch). ✓
- **T-57-10 (prompt injection via tool-result):** read-only; system prompt (57-01) trata dados como informação; `ml_ads_products_cache` retorna campos estruturados (sem ecoar HTML). ✓ (truncamento de título livre não foi necessário — colunas selecionadas são numéricas/curtas; ver Deferred.)
- **T-57-11 (número alucinado):** grounding — o modelo precisa chamar a tool (function-calling) p/ obter números; regra anti-invenção no prompt 57-01 (NEXO-05). ✓
- **T-57-12 (mutação ML):** tools 100% read-only (só `rpc`/`select`); nenhuma mutação possível. ✓
- **T-57-SC (installs):** zero pacotes novos. ✓

## Deviations from Plan

Nenhum bug (Rule 1), funcionalidade crítica faltante (Rule 2), bloqueio (Rule 3) ou mudança arquitetural (Rule 4) encontrados. O plano foi executado como escrito.

Nota de implementação (não-desvio): `runChat` ganhou `opts` injetáveis (`fetchImpl`/`dispatchImpl`/`nowImpl`/`model`) — explicitamente pedido pelo `<action>` da Task 2 ("aceitar um fetchImpl opcional default globalThis.fetch para o teste") e estendido a dispatch/now/model pela mesma razão de testabilidade. Defaults preservam o comportamento de produção (fetch real + dispatchTool real).

## Known Stubs

Nenhum. tools.ts e loop.ts são funcionais e mapeiam às RPCs/tabelas reais de produção. Não há valores hardcoded vazios fluindo para UI (esta fase é backend; UI é plano seguinte).

## Deferred Issues

- **Truncamento defensivo de texto livre no functionResponse (T-57-10 reforço):** as tools atuais não retornam títulos longos (colunas são numéricas ou títulos curtos de SKU). Se uma futura tool incluir `title`/`description` livre da conta, aplicar `slice(0,120)` no dispatcher por defesa-em-profundidade contra prompt injection. Registrado para avaliação na UI/iteração seguinte; não bloqueia esta wave.
- **Context caching dos playbooks (custo):** RESEARCH A2/Open Q2 — v1 sem caching (mais simples); medir custo real via `usageMetadata` após deploy. Fora de escopo desta fase.

## Not in Scope (por design)

- **Deploy da EF:** NÃO deployada (sem `SUPABASE_ACCESS_TOKEN`; deploy = checkpoint do orquestrador na Wave 3 / Plan 57-04).
- **UI (FAB + painel Sheet), hook `useNexoChat` efêmero:** planos seguintes da fase.
- **Smoke da EF real (1 pergunta/org):** pós-deploy (phase gate).

## Self-Check: PASSED

- FOUND: supabase/functions/nexo-chat/tools.ts
- FOUND: supabase/functions/nexo-chat/loop.ts
- FOUND: supabase/functions/nexo-chat/index.ts
- FOUND: supabase/functions/nexo-chat/tools.test.ts
- FOUND: supabase/functions/nexo-chat/loop.test.ts
- FOUND commit d4ba6456, 2695b1d8, 6dfd66a6
