---
phase: 88-dre-frontend-resultado-completo-vendas
plan: 01
subsystem: ui
tags: [react, tanstack-query, supabase-rpc, dre, vitest, tdd]

# Dependency graph
requires:
  - phase: 87-dre-agrega-o-de-resultado-por-compet-ncia
    provides: "RPC get_dre_operational_by_competence (bloco/category/total/n/double_count_risk), reconciliada a R$0,00 em junho/2026"
provides:
  - "Cascata completa 'DRE do Mês' em /vendas: Margem de contribuição → Resultado operacional → Resultado líquido"
  - "src/lib/dreCascade.ts — helper puro que agrupa linhas da RPC 87 por bloco e deriva os subtotais (guardrail anti dupla-contagem)"
  - "src/hooks/useDreOperational.ts — 1º consumidor frontend da RPC 87; estabelece o padrão de mock supabase.rpc no repo"
affects: [dre, vendas, mlcostcard, previsao-apuracao-toggle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Helper puro em src/lib/*.ts com teste isolado (padrão precoFaixas/soldProductsMcoAgg)"
    - "Mock de supabase.rpc (não from/select) em testes de hook — novo padrão no repo (Pitfall 4)"
    - "Tipos de domínio (DreBloco/DreOperationalRow) definidos no helper e re-exportados pelo hook (evita dependência circular)"

key-files:
  created:
    - src/lib/dreCascade.ts
    - src/lib/dreCascade.test.ts
    - src/hooks/useDreOperational.ts
    - src/hooks/useDreOperational.test.ts
  modified:
    - src/components/mercadolivre/MLCostCard.tsx
    - src/pages/MercadoLivre.tsx

key-decisions:
  - "Toggle previsão×apuração NÃO implementado (hand-off ao Wesley) — card mantém as fontes atuais (modo previsão)"
  - "Guardrail SC-3: impostos_venda e excluido filtrados na entrada de buildDreCascade, antes de qualquer soma"
  - "bloco consumido direto da RPC — nunca re-derivado de category no frontend"
  - "Tipos DreBloco/DreOperationalRow vivem em dreCascade.ts e são re-exportados pelo hook (mantém tsc limpo por tarefa, sem ciclo)"
  - "Task 3 (UI wiring) sem teste unitário de componente — zero precedente de teste em MLCostCard; gate = tsc + suíte completa + build"

patterns-established:
  - "Mock supabase.rpc em teste de hook TanStack Query (renderHook + waitFor + assert args exatos)"
  - "Cascata de DRE derivada de subtotal já calculado no card (margemContribuicao) + linhas agregadas por bloco da RPC"

requirements-completed: [SC-1, SC-2, SC-3]

# Metrics
duration: 8 min
completed: 2026-07-10
status: complete
---

# Phase 88 Plan 01: DRE Frontend Resultado Completo (/vendas) Summary

**Card "DRE do Mês" estendido em /vendas para a cascata completa — Margem de contribuição → linhas operacionais (Pessoal/Estrutura/Serviços/Operacional/Não classificado) → Resultado operacional → Financeiro (Empréstimo) → Resultado líquido — consumindo a RPC 87 via novo hook `useDreOperational` e helper puro `buildDreCascade`, com guardrail anti dupla-contagem de imposto.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-10T14:12:33Z
- **Completed:** 2026-07-10T14:19:53Z
- **Tasks:** 3 (todas TDD)
- **Files modified:** 6 (4 criados, 2 modificados)

## Accomplishments
- `src/lib/dreCascade.ts` — função pura `buildDreCascade(rows, margem)` que agrupa as linhas da RPC 87 por bloco na ordem fixa, filtra `impostos_venda`/`excluido` antes de qualquer soma (SC-3), e deriva Resultado operacional e Resultado líquido; propaga `double_count_risk` por bloco.
- `src/hooks/useDreOperational.ts` — hook TanStack Query escopado por org que chama `get_dre_operational_by_competence`; 1º consumidor frontend da RPC 87. Estabelece o padrão de mock `supabase.rpc` no repo.
- `MLCostCard.tsx` estendido — "Lucro do mês" renomeado para "Margem de contribuição"; novas linhas operacionais + subtotais com hierarquia visual; tooltip discreto em linhas com `double_count_risk`; degradação graciosa quando a RPC vem vazia.
- `MercadoLivre.tsx` religado — `useDreOperational` no MESMO eixo de mês do `useMLCostWaterfall` (paridade de mês-calendário; `p_month` sempre primeiro-dia-do-mês, Pitfall 3 evitado) + `buildDreCascade` alimentando o card.

## Task Commits

1. **Task 1: dreCascade (helper puro + guardrail)** — `2f59d585` (test RED) → `7c44bb22` (feat GREEN)
2. **Task 2: useDreOperational (hook RPC 87)** — `03bcd404` (test RED) → `54f51825` (feat GREEN)
3. **Task 3: MLCostCard estendido + MercadoLivre religado** — `5652e364` (feat)

_TDD: Tasks 1 e 2 seguiram RED→GREEN; Task 3 (UI wiring) verificada por tsc + suíte completa + build._

## Files Created/Modified
- `src/lib/dreCascade.ts` - Helper puro: agrupamento por bloco, guardrail SC-3, derivação dos 3 subtotais; define/exporta DreBloco, DreOperationalRow, OPERACIONAL_BLOCOS.
- `src/lib/dreCascade.test.ts` - 6 testes (5 casos do behavior): exclusão impostos_venda/excluido, matemática, double_count_risk, nao_classificado visível, fixture jun/2026.
- `src/hooks/useDreOperational.ts` - Hook RPC 87 org-scoped; JSDoc alerta p_month=YYYY-MM-01; re-exporta os tipos do helper.
- `src/hooks/useDreOperational.test.ts` - 5 testes: args exatos {p_org_id,p_month}, mapeamento/coerção, error path, disabled sem org/sem mês. Estabelece mock supabase.rpc.
- `src/components/mercadolivre/MLCostCard.tsx` - Novas props da cascata + linhas/subtotais + tooltip; label renomeado.
- `src/pages/MercadoLivre.tsx` - Import do hook/helper, chamada no eixo do waterfall, useMemo de margemContribuicao + dreCascade, novas props ao card.

## Decisions Made
- **Toggle previsão×apuração diferido** (SC-7): não implementado — o card mantém as fontes atuais (modo previsão: CMV médio + imposto estimado). Hand-off explícito ao Wesley, conforme objetivo do plano e CONTEXT ("surface como pergunta, não decidir sozinho"). Construí-lo exigiria religar `orders.custo_unit_cheio` e uma fonte de guia real, fora do escopo da RPC 87.
- **Tipos no helper, re-exportados pelo hook:** para manter o tsc limpo por tarefa (Task 1 antes da Task 2) sem dependência circular, `DreBloco`/`DreOperationalRow` foram definidos em `dreCascade.ts` e re-exportados por `useDreOperational.ts`. O plano permitia explicitamente essa alternativa.
- **bloco `excluido` colapsado (opcional):** NÃO incluído em v1, conforme discricionariedade do plano (não é requisito de SC-1/2/3).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Baseline de testes confirmado (526/37) e mantido verde; suíte final 537 testes / 39 arquivos (+11 testes, +2 arquivos novos).

## User Setup Required
None - no external service configuration required. Deploy é frontend puro via Vercel a partir de `main` (sem MCP, migration ou edge function).

## Next Phase Readiness
- Cascata completa pronta em `/vendas`; pendente **validação visual do Wesley em produção** (light + dark, mês de junho/2026, conferir bater com a Phase 87 delta R$0,00).
- Follow-up em aberto (hand-off): **toggle previsão×apuração** — decisão do Wesley; não trivial (exige CMV cheio + guia real).

## Self-Check: PASSED
- Arquivos criados existem em disco: dreCascade.ts, dreCascade.test.ts, useDreOperational.ts, useDreOperational.test.ts — todos FOUND.
- Commits presentes: 2f59d585, 7c44bb22, 03bcd404, 54f51825, 5652e364.
- Gates: `npx tsc --noEmit` limpo; `npx vitest run` 537/537 verde (39 arquivos); `npx vite build` ✓ built.

---
*Phase: 88-dre-frontend-resultado-completo-vendas*
*Completed: 2026-07-10*
