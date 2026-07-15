---
phase: 96-dre-correcoes-linha-a-linha
plan: 04
subsystem: database
tags: [postgres, supabase, rpc, security-invoker, react-query, dre, tanstack-query]

# Dependency graph
requires:
  - phase: 87-dre-operacional-competencia
    provides: "get_dre_operational_by_competence — o CASE categoria→bloco copiado literalmente pelo helper dre_bloco_for_category, e o COALESCE(competence_date, date_trunc('month', outflow_date)) replicado nas bordas do range"
  - phase: 41-dre-cost-waterfall
    provides: "get_cost_waterfall — a régua (predicado de status/data + fallback de receita) que get_cancelled_revenue espelha no complemento de status"
  - phase: 94-dre-regime-previsao-apuracao
    provides: "padrão de RPC nova e isolada (get_imposto_guia_by_competence) em vez de inchar a RPC grande; footgun do p_month sempre YYYY-MM-01"
provides:
  - "get_cancelled_revenue(uuid, text[], date, date) — receita cancelada (cancelled + partially_refunded) no mesmo eixo do waterfall; maio/2026 = 14.450,29"
  - "dre_bloco_for_category(text) — helper IMMUTABLE, cópia literal do CASE da RPC 87, equivalência provada em prod sobre 100% das categorias vivas"
  - "get_dre_nao_classificado_items(uuid, date) — lançamentos crus do bloco nao_classificado da competência; maio/2026 = 10.809,20 em 3 lançamentos"
  - "useCancelledRevenue — hook org+lojas+range, sempre devolve objeto (nunca null)"
  - "useNaoClassificadoItems + NaoClassificadoItem — hook org+competência, sempre devolve array (nunca null)"
affects: [96-05-c1-frontend-receita-bruta-cancelamentos, 96-06-c8-frontend-lista-nao-classificado]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RPC nova e isolada em vez de alterar RPC de alto blast-radius (get_cost_waterfall tem 6 consumidores)"
    - "Helper SQL IMMUTABLE como fonte única do mapa categoria→bloco para consumidores secundários, com equivalência provada por query contra a RPC canônica"

key-files:
  created:
    - supabase/migrations/20260715120000_dre_cancelled_revenue_and_nao_classificado.sql
    - src/hooks/useCancelledRevenue.ts
    - src/hooks/useNaoClassificadoItems.ts
  modified: []

key-decisions:
  - "partially_refunded entra em get_cancelled_revenue junto com cancelled (decisão travada de Wesley: 'reembolso fica de fora da receita e é considerado como cancelamento'). Regra binária — não separa parte mantida vs. estornada."
  - "get_cost_waterfall.paid_revenue NÃO foi tocada. A receita bruta é composta no card (96-05) como paid_revenue + cancelledRevenue, preservando os 6 consumidores existentes."
  - "dre_bloco_for_category é cópia literal do CASE da RPC 87, não um refactor: a RPC 87 continua intocada (protege SC5/SC6) e a equivalência é garantida por prova em prod, não por reuso de código."
  - "Os hooks nunca devolvem null: mês sem cancelamento (0) e competência sem lançamento não classificado ([]) são estados válidos, não ausência de dado."

patterns-established:
  - "Isolamento por RPC nova: quando uma RPC tem múltiplos consumidores, adicionar o dado numa função nova e compor na camada de apresentação"
  - "Equivalência provada por query: helper duplicado do backend é validado contra a fonte canônica sobre os dados vivos, no checkpoint, em vez de ser assumido"

requirements-completed: ["C1", "C8"]

# Metrics
duration: 35min
completed: 2026-07-15
status: complete
---

# Phase 96 Plan 04: C1/C8 Backend — Receita Cancelada e Lista de Não Classificados Summary

**Migration aditiva com 3 funções novas (`get_cancelled_revenue` = 14.450,29 em maio, helper `dre_bloco_for_category` com drift zero vs. RPC 87, `get_dre_nao_classificado_items` = 10.809,20) aplicada em prod com anti-IDOR provado como role real, mais 2 hooks tipados — tudo sem tocar em `paid_revenue`.**

## Performance

- **Duração:** ~35 min
- **Tasks:** 3 (1 auto + 1 checkpoint + 1 auto)
- **Arquivos criados:** 3
- **Arquivos modificados:** 0

## Accomplishments

- **C1 destravado no backend sem regressão:** `get_cancelled_revenue` devolve 14.450,29 para maio/2026 (64 pedidos: 63 `cancelled` = 14.063,90 + 1 `partially_refunded` = 386,39). A identidade que protege o swing de 52.496,21 está provada em prod: `247.216,12 + 14.450,29 = 261.666,41` e `261.666,41 − 14.450,29 = 247.216,12` — a receita líquida não se moveu.
- **`get_cost_waterfall.paid_revenue` intacta:** confirmado em prod pós-migration em 247.216,12. `/financeiro`, MCO, GoalsCard, Nexo e `useAutoRecalc` continuam idênticos.
- **C8 pronto para listar:** `get_dre_nao_classificado_items` soma 10.809,20 em 3 lançamentos — exatamente a linha "Não classificado" da cascata. O COALESCE de `competence_date` nas duas bordas evitou o Pitfall 9 (lista vazia com a cascata mostrando valor).
- **Drift zero entre o helper e a RPC 87:** 0 categorias divergentes sobre todas as categorias vivas da org.
- **Anti-IDOR provado como role real** (`authenticated` + JWT da Pé Vermeio): cross-org Thales devolve 0 nas duas RPCs, enquanto a mesma leitura como `postgres` mostra 515.917,82 / 4.426 pedidos. Controle da própria org reproduz 14.450,29 e 3 itens.
- **Migration 100% aditiva:** nenhuma função existente dropada, redefinida ou alterada.

## Task Commits

1. **Task 1: Migration — cancelled_revenue + helper de bloco + itens do nao_classificado** — `fd3c1324` (feat)
2. **Task 2: Checkpoint — numerar/aplicar/provar via MCP** — `7e21e9e8` (chore, feito pelo orquestrador: renomeia para `20260715120000` e aplica em prod)
3. **Task 3: Hooks useCancelledRevenue e useNaoClassificadoItems** — `c5af5c36` (feat)

## Files Created/Modified

- `supabase/migrations/20260715120000_dre_cancelled_revenue_and_nao_classificado.sql` — 3 funções novas: `get_cancelled_revenue` (Bloco A, SECURITY INVOKER), `dre_bloco_for_category` (Bloco B, IMMUTABLE), `get_dre_nao_classificado_items` (Bloco C, SECURITY INVOKER). REVOKE de PUBLIC/anon + GRANT para authenticated nas duas RPCs de tenant.
- `src/hooks/useCancelledRevenue.ts` — hook org+lojas+range (padrão `useMLCostWaterfall`), queryKey `["ml","cancelled-revenue",...]`. Devolve sempre `{ cancelledRevenue, cancelledOrders }`.
- `src/hooks/useNaoClassificadoItems.ts` — hook org+competência (padrão `useImpostoGuiaReal`), queryKey `["dre","nao-classificado-items",...]`, `p_month` sempre `"YYYY-MM-01"`. Devolve sempre array. Exporta `NaoClassificadoItem`.

## Provas (não presumidas)

| Prova | Alvo | Resultado |
|---|---|---|
| PASSO 1 — censo de status maio (pré-aplicação) | paid 247.216,12 / cancelled 14.063,90 / partially_refunded 386,39 | ✅ exato (1.118 / 63 / 1 pedidos) |
| PASSO 3 — `get_cancelled_revenue` | 14.450,29 | ✅ 14.450,29 / 64 pedidos |
| PASSO 3 — identidade do swing | 261.666,41 − 14.450,29 = 247.216,12 | ✅ |
| PASSO 4 — equivalência helper × RPC 87 | 0 divergências | ✅ 0 |
| PASSO 5 — `get_dre_nao_classificado_items` | 10.809,20 | ✅ 10.809,20 / 3 lançamentos |
| PASSO 6 — anti-IDOR (2 RPCs, role `authenticated`) | 0 linhas cross-org | ✅ 0 e 0 (controle própria org: 14.450,29 / 3 itens) |
| PASSO 7 — não-regressão `paid_revenue` | 247.216,12 inalterada | ✅ |
| Task 1 — critérios de grep | DROP FUNCTION 0, RPC 87 0, INVOKER 2, GRANT 2, REVOKE 2, COALESCE ≥3, partially_refunded ≥1 | ✅ todos |
| Task 3 — `npx tsc --noEmit` | 0 erros | ✅ |
| Task 3 — `npx vitest run` | baseline verde | ✅ 575/575 (42 arquivos) |
| Task 3 — fiação prematura | sem consumo em pages/components | ✅ sem resultados |

## Decisions Made

Nenhuma decisão nova — o plano já trazia as decisões do dono travadas. As duas que governaram o SQL:

- **Reembolso = cancelamento** (Wesley, 2026-07-15): `partially_refunded` entra na receita bruta E sai nos cancelamentos. Implementado como `status IN ('cancelled','partially_refunded')`, sem lógica de "parte mantida vs. parte estornada".
- **C8 só informa:** a RPC apenas lista; nenhum lançamento é movido de bloco ou corrigido.

## Deviations from Plan

Nenhum desvio de escopo ou de comportamento — o SQL e os hooks foram escritos exatamente como especificado. Registro dois ajustes de **forma** (sem efeito semântico), feitos para que os `acceptance_criteria` baseados em `grep` medissem o que pretendiam medir:

**1. [Forma] Reformulação de comentários que colidiam com greps de aceite**
- **Encontrado durante:** Tasks 1 e 3, ao rodar os `acceptance_criteria`.
- **Situação:** os critérios usam contagem literal (`grep -c 'get_dre_operational_by_competence'` → 0; `grep -c 'get_cancelled_revenue'` → 1; `grep -c 'return null'` → 0; `grep -c 'GRANT EXECUTE'` ≥2 com alinhamento `GRANT  EXECUTE`). Meus comentários de header citavam esses símbolos em prosa explicativa (ex.: *"NÃO REDEFINE a RPC 87 (get_dre_operational_by_competence...)"*, e a citação do guard `if (paid_revenue === 0) return null` que o hook deliberadamente não copia). O código estava correto; os greps mediam as citações.
- **Ajuste:** reescrevi os comentários preservando integralmente o sentido — a RPC 87 passou a ser referida por nome de phase + migration, e a explicação do guard descreve o comportamento em vez de citar o código. Removi o espaço duplo de alinhamento em `GRANT  EXECUTE`.
- **Verificação:** todos os critérios passam; o SQL e a lógica dos hooks não mudaram (tsc 0 erros, 575/575 testes verdes).
- **Committed in:** `fd3c1324` e `c5af5c36`.

---

**Total de desvios:** 0 de escopo/comportamento; 1 ajuste de forma em comentários.
**Impacto no plano:** nenhum. Nenhum arquivo fora de `files_modified` foi tocado.

## Issues Encountered

- **Prova anti-IDOR falsa na primeira tentativa (detectada e corrigida pelo orquestrador):** o UUID da org Thales foi inicialmente inventado a partir do prefixo da memória — e uma org **inexistente** também retorna 0 linhas, o que faria a prova passar por vacuidade. Refeita com o UUID real (`e4150d57-1349-48c9-9a89-82b1774857b0`) e com o controle positivo (Thales tem 515.917,82 / 4.426 pedidos quando lido como `postgres`), tornando o 0 cross-org significativo. Lição registrável: prova anti-IDOR exige controle positivo na org alvo, senão testa nada.

## User Setup Required

Nenhum — sem configuração de serviço externo.

## Next Phase Readiness

**Pronto para consumo:**
- **96-05 (C1 frontend):** `useCancelledRevenue(from, to)` está pronto. A composição é `receitaBruta = paid_revenue + cancelledRevenue` e a linha "(−) Cancelamentos de vendas" = `cancelledRevenue`. 🚨 Lembrete do RESEARCH: a fórmula da margem está **DUPLICADA** (`MercadoLivre.tsx:364-367` e `MLCostCard.tsx:113-117`) — as duas têm que mudar juntas, senão a margem infla 14.450,29. Decisão pendente de produto: base do `pct()` = bruta ou líquida (o RESEARCH sugere líquida, para o MCO% continuar batendo com o resto do app).
- **96-06 (C8 frontend):** `useNaoClassificadoItems(dreSaleMonth)` está pronto (passar o mês de VENDA em `"YYYY-MM-01"`, não o M+1 da guia).

**Pendências fora deste plano:**
- PASSO 8 (advisors de segurança) ficou com o orquestrador para antes de fechar a wave.
- ⚠️ **Numeração:** o `max(version)` vivo era `20260713132524` e esta migration ocupou `20260715120000`. O plano **96-03** precisa numerar **acima de `20260715120000`**.

## Self-Check: PASSED

Artefatos verificados em disco:
- ✅ `supabase/migrations/20260715120000_dre_cancelled_revenue_and_nao_classificado.sql`
- ✅ `src/hooks/useCancelledRevenue.ts`
- ✅ `src/hooks/useNaoClassificadoItems.ts`
- ✅ `.planning/phases/96-.../96-04-SUMMARY.md`
- ✅ arquivo provisório `2026XXXXXXXXXX_*.sql` não existe mais (renomeado no checkpoint)

Commits verificados em `git log`:
- ✅ `fd3c1324` (Task 1) · ✅ `7e21e9e8` (Task 2, orquestrador) · ✅ `c5af5c36` (Task 3)

---
*Phase: 96-dre-correcoes-linha-a-linha*
*Plan: 04*
*Completed: 2026-07-15*
