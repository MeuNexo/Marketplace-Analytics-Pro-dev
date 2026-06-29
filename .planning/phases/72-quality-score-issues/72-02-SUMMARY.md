---
phase: 72-quality-score-issues
plan: "02"
subsystem: anuncios-modal
tags: [react, hooks, edge-function, tdd, listing-health, issues]
status: complete

dependency_graph:
  requires: ["72-01"]
  provides: ["ListingIssues", "useMLListingHealth"]
  affects: ["ListingIndicatorsTab"]

tech_stack:
  added: []
  patterns:
    - "useState+useEffect hook on-demand (sem TanStack Query) para fetch efêmero"
    - "TDD: RED commit separado antes da implementação"
    - "aria-label no container de loading para acessibilidade e testabilidade"
    - "Agrupamento de issues por categoria via Map (ordem de inserção preservada)"

key_files:
  created:
    - src/components/mercadolivre/anuncios/useMLListingHealth.ts
    - src/components/mercadolivre/anuncios/ListingIssues.tsx
    - src/components/mercadolivre/anuncios/ListingIssues.test.tsx
  modified:
    - src/components/mercadolivre/anuncios/ListingIndicatorsTab.tsx

decisions:
  - "Score ao vivo NÃO substitui item.health no ListingQualityScore (decisão RESEARCH Q.A. 1 — manter escopo simples; Phase 73+ se Wesley pedir)"
  - "aria-label no container de loading em vez de role=status para compatibilidade com jsdom/getByLabelText"
  - "IssueList como subcomponente interno (não exportado) — consumido só por ListingIssues"

metrics:
  duration_minutes: 6
  completed_date: "2026-06-29"
  tasks_completed: 2
  files_changed: 4
---

# Phase 72 Plan 02: ListingIssues + hook useMLListingHealth — Resumo

**Uma linha:** Hook `useMLListingHealth` on-demand (lazy, guard `_ml_user_id`, cleanup `cancelled`) + componente `ListingIssues` (6 estados PT-BR) integrado à aba Indicadores logo após o quality score existente.

## O que foi construído

### Task 1 — Hook `useMLListingHealth` (feat, 83 linhas)

Localizado em `src/components/mercadolivre/anuncios/useMLListingHealth.ts`.

- Exporta tipos `Issue`, `HealthResult`, `HealthStatus` que casam exatamente com o contrato da EF `ml-listing-health` (72-01).
- Guard T-72-05: `!item?.id || !item?._ml_user_id` → `status='idle'`, nada é invocado.
- `useEffect` com `deps=[item?.id, item?._ml_user_id]` e flag `cancelled` para evitar `setState` após desmontagem do modal (cleanup correto).
- `source='unavailable'` mapeia para `status='unavailable'` (não para `error`).

### Task 2 — `ListingIssues.tsx` + wiring (TDD, 103 linhas)

**RED** (`dcd7ef8f`): Teste escrito com 6 casos antes da implementação; falhou com "module not found" confirmando RED.

**GREEN** (`45bb8e55`): Implementação + wiring; todos os 6 testes passaram.

**Componente `ListingIssues`** (`src/components/mercadolivre/anuncios/ListingIssues.tsx`):

| Status | Renderização |
|--------|-------------|
| `idle` | `null` (sem renderização) |
| `loading` | `<Skeleton>` dentro de `div[aria-label="Carregando problemas do anúncio"]` |
| `success` + issues > 0 | Lista agrupada por `category` com `title` + `action_label` |
| `success` + issues = 0 | "Nenhum problema encontrado" + `CheckCircle2` |
| `unavailable` | "Dados de saúde indisponíveis no momento" + `AlertCircle` |
| `error` | "Não foi possível carregar os problemas" + `AlertCircle` |

**Wiring em `ListingIndicatorsTab.tsx`:**
- Importa `useMLListingHealth` e `ListingIssues`
- Chama `const { status: healthStatus, data: healthData } = useMLListingHealth(item)` no corpo do componente
- Insere `<ListingIssues status={healthStatus} issues={healthData?.issues ?? []} />` APÓS `<ListingQualityScore health={item.health} />` (sem alterar o quality score — zero regressão Phase 71)

## Verificação (Critérios de Aceite)

- [x] `npx vitest run ListingIssues.test.tsx` — 6/6 testes passando
- [x] `npx tsc --noEmit` — 0 erros
- [x] `npm run build` — build ok (✓ built in 16.17s)
- [x] `useMLListingHealth` chama a EF lazy (só quando `item._ml_user_id` está definido)
- [x] Guard: `_ml_user_id` undefined → `status='idle'` (não `'error'`)
- [x] `ListingQualityScore` continua recebendo `item.health` inalterado

## Desvios do Plano

Nenhum — plano executado exatamente como escrito.

## Known Stubs

Nenhum — o componente renderiza dados reais vindos da EF; quando `_ml_user_id` é undefined exibe silêncio (idle), não placeholder.

## Threat Flags

Nenhum — sem nova superfície de rede além da já mapeada no plano (T-72-05/T-72-06).

## Self-Check: PASSED

- FOUND: `src/components/mercadolivre/anuncios/useMLListingHealth.ts`
- FOUND: `src/components/mercadolivre/anuncios/ListingIssues.tsx`
- FOUND: `src/components/mercadolivre/anuncios/ListingIssues.test.tsx`
- FOUND: commit `0cf612f9` (hook)
- FOUND: commit `dcd7ef8f` (test RED)
- FOUND: commit `45bb8e55` (GREEN + wiring)
