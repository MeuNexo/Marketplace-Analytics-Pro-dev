---
phase: 51-painel-de-tesouraria-fluxo-de-caixa
plan: "02"
subsystem: hooks/treasury
tags: [tanstack-query, hooks, treasury, cashflow, supabase-rpc]
dependency_graph:
  requires: ["51-01"]
  provides: ["useTreasuryPanel", "useCostByMonth", "useSupplierExposure", "FinancialSettings.alert_threshold"]
  affects: ["src/hooks/useFinancialSettings.ts", "Wave 3 components (TreasuryPanel, CostCompositionChart, SupplierExposureChart)"]
tech_stack:
  added: []
  patterns: ["TanStack Query v5 useQuery", "queryKey [cashflow,...]", "staleTime 3min", "Number() coercion for PostgREST numeric strings", "SECURITY INVOKER RPC via supabase.rpc()"]
key_files:
  created:
    - src/hooks/useTreasuryPanel.ts
    - src/hooks/useCostByMonth.ts
    - src/hooks/useSupplierExposure.ts
  modified:
    - src/hooks/useFinancialSettings.ts
decisions:
  - "queryKey namespace cashflow (mirrors useProjectedBalance) — all 3 new hooks use [cashflow, <key>, orgId] for cache isolation"
  - "Number() coercion applied to all numeric fields (PostgREST returns numeric as string)"
  - "alert_threshold default 30000 in both DEFAULTS constant and Number() fallback"
  - "min_balance_date included in TreasuryPanelData interface (returned by Wave 1 RPC)"
  - "data?.[0] pattern for 1-row RPC results (mirrors useProjectedBalance.ts)"
metrics:
  duration: "~2min"
  completed: "2026-06-19"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 51 Plan 02: Treasury Hooks Summary

**One-liner:** TanStack Query v5 hooks for 3 treasury RPCs + useFinancialSettings extended with alert_threshold (default R$30k).

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create 3 treasury hooks | bf5332e0 | src/hooks/useTreasuryPanel.ts, src/hooks/useCostByMonth.ts, src/hooks/useSupplierExposure.ts |
| 2 | Extend useFinancialSettings with alert_threshold (D-10) | ef4f4b6b | src/hooks/useFinancialSettings.ts |

## What Was Built

### Task 1 — 3 New Hooks

**`useTreasuryPanel()`** — Wraps `get_treasury_panel` RPC (1-row result). Returns `TreasuryPanelData | null` with all 10 scalars: `burn_rate`, `alert_threshold`, `alert_date` (string|null), `min_balance_date` (string|null), `entrada_real_30d`, `saida_real_30d`, `fornec_30d`, `fornec_60d`, `fornec_90d`, `total_exposicao`. QueryKey: `["cashflow","treasury_panel",orgId]`.

**`useCostByMonth(months=9)`** — Wraps `get_cost_by_month` RPC (multi-row). Returns `CostByMonthRaw[]` mapped as `{month:string, category:string, total:number}`. QueryKey: `["cashflow","cost_by_month",orgId,months]`.

**`useSupplierExposure(topN=10)`** — Wraps `get_supplier_exposure` RPC (multi-row). Returns `SupplierExposureRow[]` mapped as `{supplier:string, amount_30d, amount_60d, amount_90d}`. QueryKey: `["cashflow","supplier_exposure",orgId,topN]`.

All 3 hooks follow the exact pattern of `useProjectedBalance.ts`: same imports, `enabled: !!orgId`, `staleTime: 3 * 60 * 1000`, `Number(... ?? 0)` coercion, named exports for hook + interface.

### Task 2 — useFinancialSettings Extended

4 surgical edits to `useFinancialSettings.ts`:
1. `FinancialSettings` interface: added `alert_threshold: number`
2. `DEFAULTS` constant: added `alert_threshold: 30000`
3. `.select()` string: appended `alert_threshold` column
4. Return mapping: added `alert_threshold: Number(data.alert_threshold ?? 30000)`

No changes to staleTime, queryKey, enabled, or any other logic.

## Verification Results

```
3 hooks existence: PASS (all 3 files exist)
queryKey namespace "cashflow": PASS (all 3 hooks)
min_balance_date in useTreasuryPanel: PASS
alert_threshold count in useFinancialSettings: 4 (interface + DEFAULTS + select + mapping)
select string "safety_margin, alert_threshold": PASS
tsc --noEmit: CLEAN (zero errors)
```

## Deviations from Plan

None — plan executed exactly as written. All 4 files match the patterns verbatim from 51-PATTERNS.md and useProjectedBalance.ts.

## Known Stubs

None. Hooks return real data from live RPCs. No hardcoded values flow to UI rendering (Number() defaults are fallbacks for null DB values, not display stubs).

## Threat Flags

None. All hooks call RPCs via authenticated supabase client — RLS is enforced server-side (SECURITY INVOKER). No direct select on cash_inflows/cash_outflows tables (T-51-05 mitigated). No new network surface introduced.

## Self-Check: PASSED

- src/hooks/useTreasuryPanel.ts: FOUND
- src/hooks/useCostByMonth.ts: FOUND
- src/hooks/useSupplierExposure.ts: FOUND
- src/hooks/useFinancialSettings.ts: FOUND (modified)
- Commit bf5332e0: FOUND
- Commit ef4f4b6b: FOUND
- tsc --noEmit: CLEAN
