---
phase: 103-consultor-cco-ferramentas-de-compra-vs-venda-adicionar-tools
plan: 01
subsystem: api
tags: [nexo-chat, edge-function, gemini-function-calling, supabase-rpc, deno, anti-idor, replenishment]

# Dependency graph
requires:
  - phase: 57-nexo-conversacional-chat-consultor
    provides: dispatchTool/TOOL_DECLARATIONS anti-IDOR pattern (org-only + INVOKER-completo), buildSystemPrompt(), playbooks.ts bundle
  - phase: 62-69-reposicao-compras
    provides: RPC get_replenishment_by_sku (usada por /compras) e get_purchase_order_suppliers (usada pelo dialog de OC)
provides:
  - tool get_replenishment (RPC get_replenishment_by_sku, p_smart=true) com retorno {label, summary, sample} estratificado
  - tool get_purchase_suppliers (RPC get_purchase_order_suppliers)
  - helper puro exportado buildReplenishmentResult(rows)
  - playbook Estela ampliado (mix de compra, MOQ×giro, ponto de pedido sazonal, ABC de compra, OC em trânsito, compra×venda)
  - PERSONA ampliada com raciocínio compra × venda e rótulos de veracidade (compra sugerida=projeção, custo_ausente, sem_giro≠esgotado)
affects: [104-dre-caixa, 105-precos-competitivo, consultor-cco-rag-fase2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "summary+sample estratificado (não cap() cru) para RPCs cuja ordenação natural afunda o sinal relevante — molde get_inventory, aplicado a get_replenishment"
    - "molde org-only (RPC só p_org_id, SEM p_user_ids) confirmado para get_replenishment_by_sku e get_purchase_order_suppliers"

key-files:
  created: []
  modified:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
    - supabase/functions/nexo-chat/playbooks.ts
    - supabase/functions/nexo-chat/prompt.ts
    - supabase/functions/nexo-chat/prompt.test.ts

key-decisions:
  - "get_replenishment usa o padrão summary+sample estratificado (gatilho_ativo até 25, sem_giro até 15, preenchimento por compra_sugerida DESC até 50) em vez de cap() genérico, para preservar micos (sem_giro) apesar do ORDER BY compra DESC NULLS LAST da RPC"
  - "p_smart:true passado explicitamente no case get_replenishment — o default SQL é FALSE, mas o hook do painel /compras usa true; sem isso o Consultor divergiria dos números do painel"
  - "Nenhum parâmetro exposto ao modelo nas 2 tools novas (properties: {}) — reduz superfície de ataque e de teste, conforme discretion do research"

requirements-completed: [CCO-REPL, CCO-SUPPLIERS, CCO-PLAYBOOK, CCO-PERSONA, CCO-TESTS, REPL-01]

# Metrics
duration: ~35min
completed: 2026-07-28
status: complete
---

# Phase 103 Plan 01: Consultor CCO — Ferramentas de Compra vs Venda Summary

**Duas tools read-only novas no Consultor (get_replenishment/get_purchase_suppliers) sobre RPCs já existentes de /compras, com sample estratificado que preserva micos apesar da ordenação natural da RPC, além de playbook e persona ensinando raciocínio compra × venda.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-28T16:xx (leitura de contexto/research)
- **Completed:** 2026-07-28T16:41Z
- **Tasks:** 3/3 completas
- **Files modified:** 5

## Accomplishments
- `get_replenishment` chama `get_replenishment_by_sku` com `p_smart:true` explícito (paridade com o painel `/compras`) e retorna `{label, summary, sample}` — summary sobre TODAS as linhas, sample estratificado (gatilho_ativo até 25, sem_giro até 15, preenchimento até 50) que prova preservar micos mesmo quando a RPC ordena `compra DESC NULLS LAST` (Pitfall 1 do research).
- `get_purchase_suppliers` chama `get_purchase_order_suppliers(p_org_id)` — único parâmetro, mapeia para `string[]` de fornecedores.
- Anti-IDOR provado por teste dedicado para as duas tools (args de org/seller do modelo ignorados, `p_org_id` sempre do servidor, sem `p_user_ids` na RPC de reposição).
- Playbook Estela (`3.1 Reposição & Cobertura`) ganhou 6 novos blocos `#### DADO:` (mix de compra, MOQ×giro, ponto de pedido sazonal, ABC de COMPRA vs ABC de urgência, OC em trânsito, raciocínio compra×venda) sem remover conteúdo existente.
- PERSONA ensina raciocínio compra × venda e rotula corretamente `sem_giro` (capital parado) vs `status_esgotado` (SKU zerado) e `compra_sugerida` como projeção, não pedido feito — sem quebrar nenhum grep/ordem já testados em `prompt.test.ts`.
- Suíte inteira do `nexo-chat` verde: **86/86 testes passando** (`tools.test.ts` 62, `prompt.test.ts` 18, `loop.test.ts` 6).

## Task Commits

Cada task foi commitada atomicamente:

1. **Task 1: Implementar get_replenishment + get_purchase_suppliers em tools.ts** - `e9d716dd` (feat)
2. **Task 2: Testes das 2 tools em tools.test.ts (anti-IDOR, p_smart, preservação de micos, contagem)** - `9dd442c2` (test)
3. **Task 3: Ampliar playbook Estela + persona compra × venda + greps** - `8f54a94d` (feat)

_Sem tasks TDD — plano `type: execute` padrão._

## Files Created/Modified
- `supabase/functions/nexo-chat/tools.ts` - 2 `FnDecl` novas em `TOOL_DECLARATIONS` (após `get_goals`), helper puro exportado `buildReplenishmentResult`, 2 `case` novos em `dispatchTool` (org-only, sem `p_user_ids`), comentário de mapeamento atualizado no cabeçalho.
- `supabase/functions/nexo-chat/tools.test.ts` - contagem de tools 25→27; 4 testes anti-IDOR/paridade (`get_replenishment` org-only+p_smart, `get_purchase_suppliers` org-only+único param); 4 testes dedicados de `buildReplenishmentResult` (preservação de micos com >50 linhas simuladas, rótulo, dedupe, integração via `dispatchTool`).
- `supabase/functions/nexo-chat/playbooks.ts` - bloco "Estoque parado" estendido para citar `sem_giro`/`status_esgotado`; 6 novos `#### DADO:` no bloco `3.1 Reposição & Cobertura`.
- `supabase/functions/nexo-chat/prompt.ts` - `COMO VOCÊ RACIOCINA` ganhou frase sobre compra×venda; `FONTE CERTA POR PERGUNTA` cita as 2 tools novas; `PARCIAL É ROTULADO, NUNCA ABSOLUTO` ganhou 3 novos pares antes da frase fixa final; `USO DAS FERRAMENTAS` lista reposição/compra e fornecedores de OC.
- `supabase/functions/nexo-chat/prompt.test.ts` - 4 novos testes provando os literais/regex acima na `PERSONA` real (espelhando estilo VERAC-06).

## Decisions Made
- Estratégia de amostragem de `get_replenishment` (Open Question #1 do research): bucket gatilho (até 25, por `compra_sugerida` DESC) → bucket micos (até 15, por `sku_stock` DESC) → preenchimento (até completar 50, por `compra_sugerida` DESC), com dedupe por `${item_id}|${variation_id}`. Determinístico e testado diretamente.
- Nenhum parâmetro exposto ao modelo nas 2 tools novas (Open Question #2 do research): `properties: {}` em ambas, confiando no `summary` agregado para o modelo decidir o que destacar — decisão do research aplicada como estava recomendada.

## Deviations from Plan
None - plan executado exatamente como escrito. Todas as assinaturas de RPC, moldes de código e pontos de inserção em `prompt.ts`/`playbooks.ts` seguiram o que o research já havia confirmado por grep direto no repositório.

## Issues Encountered
None - único ajuste foi de ordem de palavras na frase nova de `prompt.ts` ("velocidade de venda × estoque × cobertura × caixa") para casar com o regex do teste novo adicionado na mesma task; não é um desvio de plano, apenas alinhamento interno entre a redação da PERSONA e seu próprio teste, ambos escritos nesta execução.

## Verification — resultado REAL do vitest

Comando executado (verification da fase inteira, conforme `<verification>` do PLAN.md):

```
cd /root/garment-glow-test && npx vitest run supabase/functions/nexo-chat
```

Resultado real:

```
 RUN  v3.2.4 /root/garment-glow-test

 ✓ supabase/functions/nexo-chat/loop.test.ts (6 tests) 43ms
 ✓ supabase/functions/nexo-chat/tools.test.ts (62 tests) 46ms
 ✓ supabase/functions/nexo-chat/prompt.test.ts (18 tests) 17ms

 Test Files  3 passed (3)
      Tests  86 passed (86)
```

Checagem de contrato (sanidade de assinatura de RPC, conforme `<verification>` do plano):

```
$ grep -rl "get_replenishment_by_sku(" supabase/migrations/ | sort | tail -1
supabase/migrations/20260669000000_get_replenishment_by_sku_esgotados.sql

$ grep -rl "get_purchase_order_suppliers(" supabase/migrations/ | sort | tail -1
supabase/migrations/20260666000200_get_purchase_order_suppliers_rpc.sql
```

Ambos batem exatamente com o que o research documentou como versão vigente — nenhuma migration mais recente redefiniu as RPCs entre o research (2026-07-28) e esta execução.

## User Setup Required
None - no external service configuration required.

## PENDENTE para o orquestrador (NÃO executável pelo gsd-executor)

Conforme `<output>` do PLAN.md, este passo fica registrado como pendente, fora do escopo do executor:

**Deploy da EF `nexo-chat`** no projeto Supabase `ckcdevcxgvueywivefgx`, via:
- MCP `deploy_edge_function` (preservando `verify_jwt=true`, confirmado em `supabase/config.toml` linhas 124-127, inalterado nesta fase), OU
- CLI `supabase functions deploy nexo-chat --project-ref ckcdevcxgvueywivefgx` (requer login/token do Wesley).

Nenhuma migration nova é necessária — as duas RPCs (`get_replenishment_by_sku`, `get_purchase_order_suppliers`) já existem em produção e não foram alteradas por esta fase.

## Next Phase Readiness
- Código pronto para deploy: as 2 tools novas, o playbook ampliado e a persona ampliada estão commitados no branch `gsd/phase-99-dre-caixa-mp` (nenhum branch/commit criado por este executor — permanecemos na árvore de trabalho principal conforme instruído).
- Bloqueador único: deploy da EF (ação do orquestrador, não deste plano) — sem ele, o Consultor em produção ainda não enxerga `get_replenishment`/`get_purchase_suppliers`.
- Fora de escopo desta fase, conforme `103-CONTEXT.md`: DRE/caixa (Phase 104), preços/competitivo/completude (Phase 105), RAG (Fase 2) — nenhum desses foi tocado.

## Self-Check: PASSED

- FOUND: supabase/functions/nexo-chat/tools.ts
- FOUND: 103-01-SUMMARY.md (este arquivo)
- FOUND commit e9d716dd (Task 1)
- FOUND commit 9dd442c2 (Task 2)
- FOUND commit 8f54a94d (Task 3)

## EXECUTION COMPLETE
