---
phase: 49-fluxo-de-caixa-caixa-real
plan: "04"
subsystem: frontend/financial-ui
tags: [cashflow, cards, sidebar, routing, roleAccess, UX-leigos]
dependency_graph:
  requires: ["49-03"]
  provides:
    - TodayBalanceCard (src/components/financial/TodayBalanceCard.tsx)
    - ProjectedBalanceCard (src/components/financial/ProjectedBalanceCard.tsx)
    - CapacityCard (src/components/financial/CapacityCard.tsx)
    - MLFluxoCaixa (src/pages/mercadolivre/MLFluxoCaixa.tsx)
    - rota /fluxo-de-caixa (App.tsx + roleAccess OPERATIONAL)
    - item menu Operações > Fluxo de Caixa (ApiSidebar.tsx)
  affects: []
tech_stack:
  added: []
  patterns:
    - KPICard/Card pattern (cards financeiros com Skeleton + empty state)
    - RoleRoute + ErrorBoundary + React.lazy (padrão rota protegida)
    - roleAccess OPERATIONAL (owner/admin/member)
    - routeTitles (routeMeta.ts) para título/subtitle da página
key_files:
  created:
    - src/components/financial/TodayBalanceCard.tsx
    - src/components/financial/ProjectedBalanceCard.tsx
    - src/components/financial/CapacityCard.tsx
    - src/pages/mercadolivre/MLFluxoCaixa.tsx
  modified:
    - src/components/layout/ApiSidebar.tsx
    - src/App.tsx
    - src/config/roleAccess.ts
    - src/components/layout/routeMeta.ts
decisions:
  - "TodayBalanceCard implementado como Card shadcn (não KPICard) — layout de breakdown 3 colunas não cabe bem no KPICard; Card/CardContent oferece mais flexibilidade sem perder padrão do projeto"
  - "Período da página: 90d histórico + 120d projeção — garante contexto real antes de hoje e janela futura completa do hook"
  - "Empty state da página baseado em hasData (daily_income ou daily_expense > 0 em algum ponto) — evita mostrar gráfico vazio quando o RPC retorna série zerada por falta de dados sincronizados"
metrics:
  duration: "~20 minutos"
  completed: "2026-06-18T22:00:00Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 4
---

# Phase 49 Plan 04: Página /fluxo-de-caixa + 3 Cards + Navegação — Summary

**One-liner:** Página /fluxo-de-caixa com 3 cards (TodayBalanceCard/ProjectedBalanceCard/CapacityCard) consumindo hooks da Wave 3 + gráfico CashFlowChart + item "Fluxo de Caixa" em Operações + rota lazy/RoleRoute/OPERATIONAL.

## O Que Foi Construído

### Task 1 — 3 cards financeiros (commit e15cfeab)

**`TodayBalanceCard`** (`src/components/financial/TodayBalanceCard.tsx`)
- Consome `useTodayBalance()` — saldo do dia via RPC `get_daily_balance`
- Exibe `saldo_final_previsto` como número principal com cor dinâmica (`text-kpi-positive`/`text-kpi-negative`)
- Breakdown em grid de 3 colunas: Início / + Entradas / - Saídas
- Skeleton no isLoading; empty state com orientação MP+Tiny quando `data` é null
- Sem `BalanceAdjustmentModal` / `useSensitiveData` (deferidos)

**`ProjectedBalanceCard`** (`src/components/financial/ProjectedBalanceCard.tsx`)
- Consome `useProjectedBalance(120)` — projeção 120 dias via RPC `get_projected_balance_summary`
- Exibe pessimista vs realista lado a lado com borda visual distinta
- Alerta de data crítica (`critical_date`) quando presente: "Atenção: saldo fica negativo em DD de Mês (mín. R$X)"
- Sem `ScenarioSimulator` (deferido)

**`CapacityCard`** (`src/components/financial/CapacityCard.tsx`)
- Consome `useFinancialHealth()` — deriva `capacidade` e `status` via `useMemo` (SAFE/DANGER)
- Status badge + valor grande em destaque com cor `kpi-positive`/`kpi-negative`
- Mensagem leiga do hook: "Você pode investir até R$X" ou "Cuidado! Caixa projetado no limite."
- Breakdown 2×2: saldo atual / entradas 30d / projeção SMA / saídas 30d
- Margem de segurança exibida com ícone Shield

### Task 2 — Página MLFluxoCaixa + fiação de navegação (commit 82c3da12)

**`MLFluxoCaixa`** (`src/pages/mercadolivre/MLFluxoCaixa.tsx`)
- Default export (padrão lazy de App.tsx) com `useOrganization()` para isolamento por org
- Período calculado via `useMemo`: `startDate = hoje − 90d`, `endDate = hoje + 120d`
- Série do gráfico: `useCashFlowData(startDate, endDate)`
- Layout: header sticky MLPageHeader + grid 3 cards responsivo (1 col mobile, 3 col md+) + CashFlowChart
- Loading state de página (org ainda carregando): Skeleton grid completo
- Empty state acionável (`CashFlowEmptyState`): ativa quando série não tem `daily_income > 0 || daily_expense > 0` em nenhum ponto; orienta usuário a sincronizar MP + Tiny

**Wiring de navegação (4 arquivos)**

| Arquivo | Modificação |
|---------|-------------|
| `ApiSidebar.tsx` | Adicionado `{ icon: Banknote, label: "Fluxo de Caixa", path: "/fluxo-de-caixa" }` no grupo Operações (após Precificação); importado `Banknote` de lucide-react |
| `App.tsx` | `const MLFluxoCaixa = React.lazy(...)` + `<Route path="/fluxo-de-caixa" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro no Fluxo de Caixa"><MLFluxoCaixa /></ErrorBoundary></RoleRoute>} />` |
| `roleAccess.ts` | `"/fluxo-de-caixa": OPERATIONAL` (owner/admin/member; viewer default-deny — T-49-04-01 mitigado) |
| `routeMeta.ts` | `"/fluxo-de-caixa": { title: "Fluxo de Caixa", subtitle: "Como meu dinheiro vai evoluir?" }` |

## Desvios do Plano

Nenhum — plano executado exatamente conforme especificado.

## Verificação Final

```
tsc --noEmit: Exit 0 (sem erros de tipo)
npm run build: ✓ built in 18.56s (sem erros, MLFluxoCaixa-BF8w-KQE.js 20.75kB gerado)

grep checks Task 1:
✓ useTodayBalance em TodayBalanceCard.tsx
✓ useProjectedBalance em ProjectedBalanceCard.tsx
✓ useFinancialHealth em CapacityCard.tsx
✓ SAFE/DANGER/comprar em CapacityCard.tsx
✓ Sem BalanceAdjustmentModal/ScenarioSimulator/useSensitiveData nos 3 cards

grep checks Task 2:
✓ useCashFlowData em MLFluxoCaixa.tsx
✓ CashFlowChart em MLFluxoCaixa.tsx
✓ /fluxo-de-caixa em ApiSidebar.tsx
✓ MLFluxoCaixa em App.tsx
✓ "/fluxo-de-caixa": OPERATIONAL em roleAccess.ts
✓ /fluxo-de-caixa em routeMeta.ts
```

## Known Stubs

Nenhum — os 3 cards consomem hooks reais da Wave 3 (RPCs Supabase). A página exibe empty state quando não há dados sincronizados, mas não usa valores hardcoded. O gráfico CashFlowChart recebe série real de `useCashFlowData`.

## Threat Flags

Nenhum novo surface. Mitigações do threat_model aplicadas:
- T-49-04-01 (Elevation of Privilege): `"/fluxo-de-caixa": OPERATIONAL` em roleAccess + RoleRoute em App.tsx
- T-49-04-02 (Info Disclosure): hooks usam `orgId` de `useOrganization()`; RPCs SECURITY INVOKER + RLS (Wave 2)
- T-49-04-03 (Tampering): checkpoint visual blocking antes de qualquer merge para main

## Self-Check: PASSED

```
src/components/financial/TodayBalanceCard.tsx    — FOUND
src/components/financial/ProjectedBalanceCard.tsx — FOUND
src/components/financial/CapacityCard.tsx        — FOUND
src/pages/mercadolivre/MLFluxoCaixa.tsx          — FOUND
src/components/layout/ApiSidebar.tsx             — FOUND (modificado)
src/App.tsx                                      — FOUND (modificado)
src/config/roleAccess.ts                         — FOUND (modificado)
src/components/layout/routeMeta.ts               — FOUND (modificado)

Commit e15cfeab — FOUND (Task 1: 3 cards)
Commit 82c3da12 — FOUND (Task 2: página + navegação)
```
