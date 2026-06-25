---
phase: 62-reposicao-server-side
plan: 03
subsystem: frontend
tags: [react, typescript, react-query, shadcn, replenishment, estoque, reposicao, rpc]

# Dependency graph
requires:
  - phase: 62-reposicao-server-side
    plan: 01
    provides: "RPC get_replenishment viva + types.ts atualizado"
provides:
  - "Hook useReplenishment (React Query) consumindo RPC get_replenishment"
  - "Componente ReplenishmentPanel (read-only, aviso a chegar, flags, params com origem)"
  - "Aba 'Compra Recomendada' em /estoque (MLEstoque.tsx) montando ReplenishmentPanel"
affects: [MLEstoque, ReplenishmentPanel, useReplenishment, REPL-01, REPL-09, REPL-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hook React Query espelhando useMLMarginWithAds: useOrganization + supabase.rpc + interface tipada + staleTime 5min"
    - "p_org_id sempre de currentOrg.id (anti-IDOR T-62-07): nunca de input livre"
    - "Componente read-only: colunas da fonte, sem inputs editáveis"
    - "Aviso fixo Alert REPL-09: v1 não desconta compras a chegar / itens em trânsito"
    - "Toggle gatilho_ativo (default on) para filtrar por padrão só itens com sugestão > 0"
    - "Nova aba Tabs sem quebrar defaultValue='estoque'"

key-files:
  created:
    - src/hooks/useReplenishment.ts
    - src/components/mercadolivre/ReplenishmentPanel.tsx
  modified:
    - src/pages/mercadolivre/MLEstoque.tsx

key-decisions:
  - "p_org_id sempre de currentOrg.id — nunca de input do usuário (anti-IDOR T-62-07)"
  - "Toggle 'apenas gatilho ativo' ligado por padrão: evita overwhelming de SKUs sem sugestão"
  - "CompraRecomendadaPanel.tsx antigo em /precos-custos intocado — zero regressão confirmado (git diff vazio)"
  - "Formatadores definidos localmente no componente (currencyFmt/numFmt) — sem criar util compartilhada desnecessária"
  - "ShoppingCart icon adicionado ao import lucide existente em MLEstoque"

# Metrics
duration: ~10min
completed: 2026-06-25
status: complete
---

# Phase 62 Plan 03: ReplenishmentPanel + useReplenishment + Aba /estoque Summary

**Hook React Query, componente ReplenishmentPanel (read-only, aviso de limitação "a chegar", flags, params com origem) e nova aba "Compra Recomendada" em /estoque — tsc + build verdes, painel antigo de /precos-custos intocado.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-25T20:50:00Z
- **Completed:** 2026-06-25T21:00:51Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **Hook `useReplenishment`** criado espelhando `useMLMarginWithAds`: `useOrganization()` para `currentOrg`; queryKey com `["get_replenishment", currentOrg?.id, salesWindowDays, demandMultiplier]`; `supabase.rpc("get_replenishment", { p_org_id: currentOrg.id, ... })` — p_org_id sempre do contexto autenticado (anti-IDOR T-62-07); mapeamento de `Record<string, unknown>` para interface `ReplenishmentRow` (20 campos) com type-casting seguro; `enabled: !!currentOrg?.id`; `staleTime: 5 * 60 * 1000`. Interface `ReplenishmentRow` exportada.
- **Componente `ReplenishmentPanel`** criado com tabela shadcn read-only: 9 colunas (produto/marca, venda/dia, estoque atual, cobertura atual em dias ou "—" para sem_giro/null, ponto de reposição, sugestão de compra com MOQ+pack já aplicados pela RPC, valor estimado ou Badge "custo ausente", flags sem_giro/custo_ausente, parâmetros com badge de origem global/marca). Alerta fixo REPL-09 no topo explicando que v1 não desconta compras a chegar nem itens em trânsito. Toggle "apenas gatilho ativo" ativo por padrão. Loading skeleton (8 linhas). Empty state com link para ver todos.
- **Aba "Compra Recomendada"** em `MLEstoque.tsx`: `TabsTrigger value="compra"` com ícone `ShoppingCart` adicionado ao `TabsList`; `TabsContent value="compra"` montando `<ReplenishmentPanel />`; `defaultValue="estoque"` inalterado; `CompraRecomendadaPanel.tsx` antigo (em `/precos-custos`) confirmado intocado (git diff vazio).
- **tsc + npm run build** verdes sem erros.

## Task Commits

1. **Task 1: Hook useReplenishment** — `e34db511`
2. **Task 2: Componente ReplenishmentPanel** — `beeb87ce`
3. **Task 3: Aba Compra Recomendada em MLEstoque** — `8ca268c3`

## Files Created/Modified

- `src/hooks/useReplenishment.ts` — Hook React Query com interface ReplenishmentRow (20 campos), p_org_id de currentOrg.id, staleTime 5min
- `src/components/mercadolivre/ReplenishmentPanel.tsx` — Componente read-only: tabela shadcn, aviso REPL-09, toggle gatilho_ativo, loading/empty state, flags, params com origem
- `src/pages/mercadolivre/MLEstoque.tsx` — ShoppingCart importado; TabsTrigger + TabsContent value="compra" adicionados; import ReplenishmentPanel

## Deviations from Plan

None - plan executed exactly as written.

## Threat Surface Scan

Nenhuma nova superfície de rede, endpoint ou trust boundary introduzida. Toda comunicação usa o cliente Supabase existente com JWT do usuário logado. T-62-07 mitigado: p_org_id sempre de currentOrg.id (contexto autenticado). T-62-08 mitigado: aviso fixo "não desconta a chegar" (REPL-09) presente no componente.

## Self-Check: PASSED

- `src/hooks/useReplenishment.ts` — FOUND
- `src/components/mercadolivre/ReplenishmentPanel.tsx` — FOUND
- Commit e34db511 — FOUND
- Commit beeb87ce — FOUND
- Commit 8ca268c3 — FOUND
- `git diff HEAD -- src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx` — empty (PASSED)
- `tsc --noEmit` — clean (PASSED)
- `npm run build` — green (PASSED)

---
*Phase: 62-reposicao-server-side*
*Completed: 2026-06-25*
