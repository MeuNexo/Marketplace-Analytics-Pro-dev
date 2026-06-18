---
phase: 49-fluxo-de-caixa-caixa-real
plan: "03"
subsystem: frontend/financial-hooks
tags: [cashflow, hooks, recharts, rpc, financial-health]
dependency_graph:
  requires: ["49-02"]
  provides:
    - useCashFlowData (src/hooks/useCashFlowData.ts)
    - useTodayBalance (src/hooks/useTodayBalance.ts)
    - useProjectedBalance (src/hooks/useProjectedBalance.ts)
    - useFinancialSettings (src/hooks/useFinancialSettings.ts)
    - useFinancialHealth (src/hooks/useFinancialHealth.ts)
    - CashFlowChart (src/components/financial/CashFlowChart.tsx)
  affects: ["49-04"]
tech_stack:
  added: []
  patterns:
    - TanStack Query v5 (useQuery) para todos os hooks RPC
    - supabase.rpc para get_cashflow / get_daily_balance / get_projected_balance_summary
    - select direto apenas para financial_settings (1 linha/org, seguro)
    - useMemo para derivação client-side em useFinancialHealth
    - Recharts ComposedChart + ReferenceLine para gráfico de fluxo
key_files:
  created:
    - src/hooks/useFinancialSettings.ts
    - src/hooks/useCashFlowData.ts
    - src/hooks/useTodayBalance.ts
    - src/hooks/useProjectedBalance.ts
    - src/hooks/useFinancialHealth.ts
    - src/components/financial/CashFlowChart.tsx
  modified: []
decisions:
  - "useFinancialHealth implementado como hook React (useMemo) em vez de useQuery — permite consumir hooks useProjectedBalance/useFinancialSettings diretamente sem violar regras de hooks do React (hooks não podem ser chamados dentro de queryFn)"
  - "useCashFlowData faz 2 chamadas RPC paralelas (get_cashflow + get_projected_balance_summary) na mesma queryFn — evita duplicação de lógica ao reusar o RPC dentro do hook em vez de chamar useProjectedBalance separado (que criaria problema de dependência de hook dentro de queryFn)"
  - "projected_balance nos primeiros 8 dias futuros interpolado linearmente via pessimistic_balance para suavizar a transição — comportamento análogo ao nexointeligence (isPastSevenDays)"
metrics:
  duration: "~15 minutos"
  completed: "2026-06-18T19:37:00Z"
  tasks_completed: 2
  files_created: 6
---

# Phase 49 Plan 03: Hooks de Fluxo de Caixa + CashFlowChart — Summary

**One-liner:** 5 hooks RPC (useFinancialSettings/useCashFlowData/useTodayBalance/useProjectedBalance/useFinancialHealth) + CashFlowChart ComposedChart com contrato explícito de série real+projetada derivada de SMA.

## O Que Foi Construído

### Task 1 — 4 hooks de leitura RPC (commit ac8e0a8e)

**`useFinancialSettings`** (`src/hooks/useFinancialSettings.ts`)
- Select direto em `financial_settings` (1 linha por org — seguro, sem truncamento PostgREST)
- Fallback `{ initial_balance:0, operational_cost_rate:0.22, safety_margin:10000 }` se null
- orgId via `useOrganization()`, `enabled: !!orgId`

**`useProjectedBalance`** (`src/hooks/useProjectedBalance.ts`)
- Chama `supabase.rpc("get_projected_balance_summary", { p_org_id, p_projection_days: 120 })`
- Mapeia todas as 7 colunas com `Number()`: `current_balance`, `pessimistic_balance`, `realistic_balance`, `critical_date`, `min_balance`, `confirmed_income`, `total_expenses`
- **Fonte única de `confirmed_income`/`total_expenses`** para `useFinancialHealth`

**`useTodayBalance`** (`src/hooks/useTodayBalance.ts`)
- Chama `supabase.rpc("get_daily_balance", { p_org_id, p_target_date: today })`
- Mapeia 4 colunas: `saldo_inicial`, `entradas_hoje`, `saidas_hoje`, `saldo_final_previsto`

**`useCashFlowData`** (`src/hooks/useCashFlowData.ts`)
- **Contrato explícito da série (ponto 1 do objetivo — fixo, documentado no código):**
  - Passo A: `supabase.rpc("get_cashflow", ...)` → série real com `accumulated_balance`
  - Passo B: `supabase.rpc("get_projected_balance_summary", ...)` → `realistic_balance` + `pessimistic_balance`
  - Passo C: derivação de `projected_balance` dia a dia:
    - `data <= hoje`: `projected_balance = accumulated_balance` (sobreposição real)
    - `data > hoje, dias 1-8`: interpolação linear via pessimistic (transição suave)
    - `data > hoje, dias 9+`: `lastRealAccumulated + pessimistic_interpolado + incremento_sma × smaDays`
    - `incremento_diario_sma = (realistic − pessimistic) / max(1, futureDays − 8)`
- Retorna `CashFlowDataPoint[]` com ambas as colunas (`accumulated_balance`, `projected_balance`) já calculadas

### Task 2 — useFinancialHealth + CashFlowChart (commit a611bb9f)

**`useFinancialHealth`** (`src/hooks/useFinancialHealth.ts`)
- Hook React puro (sem `useQuery`) — usa `useMemo` para derivar de `useProjectedBalance` + `useFinancialSettings`
- **PROIBIDO select direto em `cash_inflows`/`cash_outflows`** (segue feedback_postgrest_pagination)
- Fórmula: `capacidade = (current_balance + confirmed_income + sma_23d) − total_expenses − safety_margin`
- `sma_23d = max(0, realistic_balance − pessimistic_balance)` do RPC
- Retorna `{ capacidade, status: 'SAFE'|'DANGER', message, componentes, isLoading, isError }`

**`CashFlowChart`** (`src/components/financial/CashFlowChart.tsx`)
- Recebe `data: CashFlowDataPoint[]` via prop (série de `useCashFlowData`)
- `ComposedChart` com 2 linhas:
  - Linha 1: `accumulated_balance` — "Real (Pessimista)" — `stroke="var(--kpi-positive)"` — contínua
  - Linha 2: `projected_balance` — "Projetado (Realista)" — `stroke="var(--kpi-neutral)"` — tracejada (`5 5`)
- `ReferenceLine y=0` com `stroke="hsl(var(--destructive))"` — alerta visual de saldo zero
- Alerta badge com `<AlertTriangle>` quando `hasNegativeReal || hasNegativeProjected`
- `CustomTooltip` com breakdown (entradas/saídas do dia + ambos saldos)
- Tokens de cor via CSS custom properties (sem hex hardcoded)
- `ResponsiveContainer` + `tick={{ fontSize: 11 }}` para mobile

## Desvios do Plano

### Auto-fixado

**1. [Rule 2 - Arquitetura] useFinancialHealth como hook React (useMemo) em vez de useQuery**
- **Encontrado em:** Task 2
- **Questão:** O plano descreve `useFinancialHealth` como um hook que "deriva client-side consumindo `useProjectedBalance()`". Chamar um hook dentro de `queryFn` viola as regras de hooks do React (hooks só podem ser chamados no nível de componentes/hooks).
- **Fix:** Implementado como hook React usando `useMemo` sobre os dados de `useProjectedBalance()` e `useFinancialSettings()` — comportamento equivalente, React-valid, sem `useQuery` wrapper.
- **Arquivos:** `src/hooks/useFinancialHealth.ts`

Nenhum outro desvio — plano executado conforme especificado.

## Verificação Final

```
tsc --noEmit: Exit 0 (sem erros de tipo)

grep checks Task 1:
✓ supabase.rpc("get_cashflow") em useCashFlowData.ts
✓ projected_balance em useCashFlowData.ts
✓ supabase.rpc("get_daily_balance") em useTodayBalance.ts
✓ supabase.rpc("get_projected_balance_summary") em useProjectedBalance.ts
✓ confirmed_income / total_expenses em useProjectedBalance.ts
✓ useOrganization em useCashFlowData.ts
✓ financial_settings em useFinancialSettings.ts

grep checks Task 2:
✓ ComposedChart em CashFlowChart.tsx
✓ "Como meu dinheiro vai evoluir" em CashFlowChart.tsx
✓ var(--kpi-positive/neutral) em CashFlowChart.tsx
✓ useOrganization em useFinancialHealth.ts
✓ useProjectedBalance em useFinancialHealth.ts
✓ Sem select direto em cash_inflows/cash_outflows em useFinancialHealth.ts
✓ SAFE / DANGER em useFinancialHealth.ts
```

## Known Stubs

Nenhum — os hooks retornam dados reais dos RPCs ou null/0 quando não há dados. Nenhum placeholder hardcoded nos valores de saída.

## Threat Flags

Nenhum novo surface identificado. Os hooks consomem RPCs existentes validados na Wave 2 (SECURITY INVOKER + RLS org-first). useFinancialHealth usa useMemo (sem acesso direto ao Supabase).

## Self-Check: PASSED

```
src/hooks/useFinancialSettings.ts   — FOUND
src/hooks/useCashFlowData.ts        — FOUND
src/hooks/useTodayBalance.ts        — FOUND
src/hooks/useProjectedBalance.ts    — FOUND
src/hooks/useFinancialHealth.ts     — FOUND
src/components/financial/CashFlowChart.tsx — FOUND

Commit ac8e0a8e — FOUND (Task 1)
Commit a611bb9f — FOUND (Task 2)
```
