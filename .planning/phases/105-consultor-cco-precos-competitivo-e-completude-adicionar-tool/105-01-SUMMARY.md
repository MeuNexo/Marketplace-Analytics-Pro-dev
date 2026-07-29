---
phase: 105-consultor-cco-precos-competitivo-e-completude-adicionar-tool
plan: 01
subsystem: api
tags: [supabase-edge-function, deno, nexo-chat, function-calling, ml-precos-custos, anti-idor]

# Dependency graph
requires:
  - phase: 103-consultor-cco-ferramentas-de-compra-vs-venda-adicionar-tools
    provides: molde de tool org-only + helper puro exportado (buildReplenishmentResult)
  - phase: 104-consultor-cco-dre-real-e-caixa-adicionar-tools-read-only-get
    provides: molde de tool org+mlUserIds (get_dre_result/get_dre_cash) + estilo de label de veracidade
provides:
  - "4 tools read-only novas em nexo-chat/tools.ts: get_price_practiced, get_competitive_price, get_cost_gaps, get_cancelled_revenue"
  - "3 padrões anti-IDOR distintos provados por teste (só-mlUserIds+select org-scoped; EF-via-ctx.userJwt; org+mlUserIds)"
  - "helper puro exportado buildPricePracticed (guarda div/0, filtro sku='')"
  - "playbook Rafael ampliado (4.3 Sinal Competitivo Real)"
  - "persona FINAL da milestone (cita as 8 tools novas de 103/104/105)"
affects: [milestone-close, consultor-cco, nexo-chat-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "molde EF-via-ctx.userJwt (get_reputation) reaplicado para get_competitive_price sobre ml-precos-custos ?type=references"
    - "molde só-mlUserIds+select org-scoped (get_goals) reaplicado para get_price_practiced sobre orders_sold_products_agg (RPC sem p_org_id) + ml_mco_targets"

key-files:
  created: []
  modified:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
    - supabase/functions/nexo-chat/playbooks.ts
    - supabase/functions/nexo-chat/prompt.ts
    - supabase/functions/nexo-chat/prompt.test.ts

key-decisions:
  - "get_price_practiced NÃO passa p_org_id à RPC orders_sold_products_agg (a assinatura não tem esse param) — anti-IDOR 100% via _ml_user_ids do servidor, mesmo modelo de get_goals"
  - "join com ml_mco_targets filtra .eq('sku','') no select E de novo no helper puro (defesa em profundidade) para nunca casar meta de variação com o agregado por item_id"
  - "get_competitive_price usa type=references (não mode) e exige ctx.userJwt real — sem JWT retorna {error:'sem_jwt'} em vez de inventar dado"
  - "item_id do modelo sanitizado como allow-list alfanumérico + slice(30) antes de ir para a URL da EF"

patterns-established: []

requirements-completed:
  - CCO-PRICE
  - CCO-COMPETITIVE
  - CCO-GAPS
  - CCO-CANCELLED
  - CCO-PLAYBOOK-R
  - CCO-PERSONA-FINAL
  - CCO-TESTS-105

# Metrics
duration: ~15min
completed: 2026-07-28
status: complete
---

# Phase 105 Plan 01: Consultor CCO — Preços, competitivo e completude Summary

**4 tools read-only novas no Consultor (nexo-chat): preço praticado × meta MCO (derivado, div/0-safe), sinal competitivo real via EF ml-precos-custos (type=references, JWT do usuário), SKUs sem custo cheio e receita cancelada — fecha a milestone "Consultor CCO Completo" com 35 tools e persona citando todas.**

## Performance

- **Duration:** ~15 min (leitura de research/código + implementação + testes)
- **Tasks:** 3/3 completos
- **Files modified:** 5 (tools.ts, tools.test.ts, playbooks.ts, prompt.ts, prompt.test.ts)

## Accomplishments
- `get_price_practiced`: RPC `orders_sold_products_agg(_ml_user_ids, _from, _to)` (SEM `p_org_id` — a RPC não tem esse param) + select `ml_mco_targets` (`.eq(organization_id, orgId).eq(sku, '')`); helper puro `buildPricePracticed` deriva `preco_medio_praticado = receita_bruta/quantidade` com guarda de divisão por zero (`quantidade=0 → null`, nunca NaN/Infinity) e filtra a meta só no sentinela `sku=''`.
- `get_competitive_price`: primeiro dado competitivo REAL do Consultor — wrap da EF `ml-precos-custos?type=references` (confirmado `type`, não `mode`), exigindo `ctx.userJwt` real do usuário (molde `get_reputation` exato); guarda `!ctx.userJwt → {error:'sem_jwt'}`; loop sobre `mlUserIds` do servidor; `item_id` opcional sanitizado (allow-list alfanumérico + slice 30); JWT nunca logado nem exposto no retorno.
- `get_cost_gaps` / `get_cancelled_revenue`: RPCs org+mlUserIds (`get_cmv_cheio_gaps`, `get_cancelled_revenue`), molde `get_margin_by_product`; rótulos explícitos (custo ausente pode ser legítimo em revenda; cancelado ≠ faturamento).
- Playbook Rafael (`playbooks.ts`) ganhou a subseção `### 4.3 Sinal Competitivo Real` (DADO→Diagnóstico→Ação→Métrica): preço total (preço+frete), quando reagir vs manter margem, sugestão do ML como sinal não ordem — 4.1/4.2 preservadas.
- `PERSONA` (`prompt.ts`) finalizada: `FONTE CERTA POR PERGUNTA` e `PARCIAL É ROTULADO` citam as 4 tools novas com os rótulos de veracidade; `USO DAS FERRAMENTAS` agora cobre o domínio inteiro (103+104+105) sem quebrar nenhuma ordem/grep testado.
- Contagem de tools: **31 → 35**. Suíte `supabase/functions/nexo-chat` inteira verde.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implementar as 4 tools em tools.ts (3 padrões anti-IDOR)** - `bf503403` (feat)
2. **Task 2: Testes das 4 tools em tools.test.ts** - `111599df` (test)
3. **Task 3: Playbook Rafael + persona FINAL + greps** - `b45540f4` (docs)

_Nenhuma task era TDD — código + label no mesmo commit por task, seguindo o padrão de 103/104._

## Files Created/Modified
- `supabase/functions/nexo-chat/tools.ts` - 4 declarações novas, helper `buildPricePracticed` exportado, 4 cases no `dispatchTool`, comentário de mapeamento atualizado
- `supabase/functions/nexo-chat/tools.test.ts` - contagem 31→35, testes dos 3 padrões anti-IDOR, testes diretos de `buildPricePracticed` (div/0, filtro sku=''), EF-mock de `get_competitive_price` (type=references, Bearer, JWT não vaza), guarda sem-JWT
- `supabase/functions/nexo-chat/playbooks.ts` - subseção `4.3 Sinal Competitivo Real` no bloco RAFAEL
- `supabase/functions/nexo-chat/prompt.ts` - PERSONA final citando as 4 tools de 105 + rótulos + lista USO DAS FERRAMENTAS completa
- `supabase/functions/nexo-chat/prompt.test.ts` - greps novos das 4 tools/rótulos + teste "cobertura da milestone" (8 tools de 103/104/105)

## Decisions Made
- `orders_sold_products_agg` NUNCA recebe `p_org_id` (a assinatura da RPC não o tem — passar causaria erro Postgres "function does not exist"); anti-IDOR é 100% via `_ml_user_ids` do servidor, mesmo trust model de `get_goals`.
- `ml_mco_targets` filtrado por `sku=''` tanto no `.eq()` do select quanto de novo dentro do helper puro `buildPricePracticed` (defesa em profundidade — Pitfall 4 do research: um item pode ter várias rows de meta diferindo só por sku).
- `get_competitive_price` usa `type=references` (não `mode`) — confirmado por leitura direta de `ml-precos-custos/index.ts` linha 337; usar `mode` cairia silenciosamente no handler default `prices` e retornaria o payload ERRADO sem erro.
- `item_id` do modelo é input não-sensível mas sanitizado (allow-list alfanumérico + `slice(30)`) antes de compor a query string da EF.

## Deviations from Plan

None - plan executado exatamente como escrito. Os 3 padrões anti-IDOR, os rótulos de veracidade, a subseção 4.3 do playbook e a finalização da persona seguiram literalmente o `105-01-PLAN.md` e os exemplos de código do `105-RESEARCH.md`.

## Verification Results (REAL)

```
$ npx vitest run supabase/functions/nexo-chat
 RUN  v3.2.4 /root/garment-glow-test

 ✓ supabase/functions/nexo-chat/prompt.test.ts (30 tests) 19ms
stderr | supabase/functions/nexo-chat/loop.test.ts > runChat — config Gemini > gemini !ok → fallback:true
nexo-chat: gemini status=500

 ✓ supabase/functions/nexo-chat/loop.test.ts (6 tests) 140ms
 ✓ supabase/functions/nexo-chat/tools.test.ts (84 tests) 282ms

 Test Files  3 passed (3)
      Tests  120 passed (120)
```

(O `stderr` em `loop.test.ts` é o log esperado do teste de fallback do Gemini — não é uma falha.)

Checagem de contrato (sanidade — fontes não mudaram desde o research):
```
$ grep -rl "orders_sold_products_agg(\|get_cmv_cheio_gaps(\|get_cancelled_revenue(\|CREATE TABLE.*ml_mco_targets\|ml_mco_targets" supabase/migrations/ | sort
supabase/migrations/20260677000001_orders_sold_products_agg.sql
supabase/migrations/20260680000001_orders_sold_products_agg_perf.sql
supabase/migrations/20260715221559_dre_cancelled_revenue_and_nao_classificado.sql
supabase/migrations/20260715223024_cmv_cheio_puro_and_gaps.sql
supabase/migrations/20260719000000_ml_mco_targets.sql

$ grep -n "type === \"references\"\|auth.getUser\|ml_user_id required" supabase/functions/ml-precos-custos/index.ts
28:  const { data: claimsData, error: claimsErr } = await supabase.auth.getUser(token);
326:    if (!mlUserIdParsed.success) return jsonResponse({ error: "ml_user_id required" }, 400);
337:    if (type === "references") {
```

Nenhuma divergência encontrada — as 5 migrations citadas no research existem, e o contrato da EF (`type`, `auth.getUser`, `ml_user_id` obrigatório) está confirmado ao vivo no código.

## Issues Encountered
None.

## PENDENTE para o orquestrador (NÃO executável pelo gsd-executor)

1. **Deploy da EF `nexo-chat`** no projeto `ckcdevcxgvueywivefgx` via MCP `deploy_edge_function` (preservando `verify_jwt=true`) ou CLI `supabase functions deploy nexo-chat`. Nenhuma migration nova é necessária — todas as RPCs/tabela/EF consumidas já existem em produção.
2. **Confirmar ao vivo, antes do deploy** (via Supabase MCP): (a) `verify_jwt` de `ml-precos-custos` (Assumption A1 do research — o requisito prático de JWT real é HIGH confidence por leitura de código; só o gateway é inferido); (b) que as assinaturas de `orders_sold_products_agg`, `ml_mco_targets`, `get_cmv_cheio_gaps` e `get_cancelled_revenue` não sofreram drift desde o research (o repo tem histórico de divergência entre migrations locais e o DB vivo). Se divergir, reportar — não corrigir silenciosamente.
3. **Esta é a ÚLTIMA fase da milestone "Consultor CCO Completo"** — após o merge+deploy, o Consultor tem as 35 tools e a persona FINAL cobrindo todas elas (103: replenishment/suppliers; 104: DRE real/caixa/saldo/impostos; 105: preço praticado/competitivo/cost_gaps/cancelada). Considerar `/gsd-complete-milestone`.
4. A EF `ml-precos-custos` **NÃO foi tocada** neste plano — já está deployada e em uso pelo frontend (`/precos-custos`); `get_competitive_price` apenas a consome.

## User Setup Required

None - nenhuma configuração externa manual necessária.

## Next Phase Readiness
- 35 tools declaradas e testadas; código pronto para deploy (passo do orquestrador, não deste executor).
- Nenhum blocker técnico. Único gate real é o deploy da EF + confirmação de drift ao vivo (itens 1-2 acima).

---
*Phase: 105-consultor-cco-precos-competitivo-e-completude-adicionar-tool*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: supabase/functions/nexo-chat/tools.ts
- FOUND: supabase/functions/nexo-chat/tools.test.ts
- FOUND: supabase/functions/nexo-chat/playbooks.ts
- FOUND: supabase/functions/nexo-chat/prompt.ts
- FOUND: supabase/functions/nexo-chat/prompt.test.ts
- FOUND: commit bf503403 (Task 1: feat)
- FOUND: commit 111599df (Task 2: test)
- FOUND: commit b45540f4 (Task 3: docs)
- Final `npx vitest run supabase/functions/nexo-chat`: 3 test files passed, 120/120 tests passed.
