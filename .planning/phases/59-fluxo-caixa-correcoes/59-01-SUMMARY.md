---
phase: 59-fluxo-caixa-correcoes
plan: "01"
subsystem: financial
tags: [cashflow, projection, rpc, get_cashflow, sma, frontend]
dependency_graph:
  requires:
    - Phase 49 (financial_settings.initial_balance)
    - Phase 50 (get_cashflow RPC v5 — versão base 20260619020000)
  provides:
    - get_cashflow com regra de projeção 7d (CASHFIX-01) em produção
    - acumulated_balance_sma sem inflação nos primeiros 7 dias
  affects:
    - src/components/financial/CashFlowChart.tsx (legenda/tooltip strings)
    - src/hooks/useCashFlowData.ts (JSDoc accumulated_balance_sma)
    - supabase project ckcdevcxgvueywivefgx (migration aplicada via MCP)
tech_stack:
  added: []
  patterns:
    - "CASE WHEN d.d_date <= v_today + 7 THEN d.inc WHEN d.inc > 0 THEN d.inc ELSE v_sma END — projeção combinada sem dupla-contagem"
    - "SECURITY INVOKER + org param isolamento (feedback_supabase_security_invoker)"
key_files:
  created:
    - supabase/migrations/20260659000000_cashflow_projection_7d_rule.sql
  modified:
    - src/components/financial/CashFlowChart.tsx
    - src/hooks/useCashFlowData.ts
decisions:
  - "Dias 1-7 usam só d.inc (confirmado) — zero média no curto prazo para evitar dupla-contagem da venda de hoje que já consta nos recebimentos MP (~14d lag)"
  - "Dia 8+ com d.inc>0 usa o confirmado; dia 8+ com d.inc=0 usa v_sma — preenche buracos futuros sem sobrepor dias com recebimento real"
  - "daily_projection retorna 0 nos dias 1-7 e nos dias com recebimento (tooltip + Previsão consistente com a linha âmbar)"
  - "accumulated_balance (linha verde) intocada — reconciliação ao centavo com DFC do Wesley preservada"
  - "financial_settings.initial_balance corrigido pelo orquestrador de R$21.676,91 (19/06, stale) para R$16.833,14 (fecho DFC 24/06 do Wesley)"
metrics:
  duration: "~45 min (Tasks 1+2 em sessão anterior; Task 3 + SUMMARY nesta sessão)"
  completed: "2026-06-25"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 3
status: complete
requirements:
  - CASHFIX-01
---

# Phase 59 Plan 01: Correção Projeção Fluxo de Caixa (CASHFIX-01) Summary

**One-liner:** Regra de projeção do gráfico de Fluxo de Caixa corrigida — linha âmbar usa só o confirmado nos primeiros 7 dias e a média 15d apenas nos buracos futuros a partir do 8º dia, sem dupla-contagem.

## What Was Built

### Task 1 — Migration get_cashflow com regra de projeção 7d
**Commit:** `3022829c`

Nova migration `supabase/migrations/20260659000000_cashflow_projection_7d_rule.sql` com `CREATE OR REPLACE FUNCTION public.get_cashflow(...)`.

Duas alterações cirúrgicas no SELECT final sobre a versão base `20260619020000_cashflow_brt_timezone.sql`:

1. **`accumulated_balance_sma`** — substituído de `SUM(v_sma - d.exp) OVER (...)` por:
   ```sql
   SUM(
     CASE
       WHEN d.d_date <= v_today + 7 THEN d.inc
       WHEN d.inc > 0               THEN d.inc
       ELSE                              v_sma
     END - d.exp
   ) OVER (ORDER BY d.d_date ASC)::NUMERIC
   ```

2. **`daily_projection`** — substituído de `v_sma` por:
   ```sql
   CASE
     WHEN d.d_date <= v_today + 7 THEN 0::NUMERIC
     WHEN d.inc > 0               THEN 0::NUMERIC
     ELSE v_sma
   END
   ```

`accumulated_balance` (`SUM(d.inc - d.exp) OVER (...)`) permaneceu intocada — 1 ocorrência exata preservada.

### Task 2 — Aplicação via MCP + validação SQL (orquestrador)
**Status:** Aplicada pelo orquestrador via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`.

**Validação SQL confirmada (org `7f615df7-7bac-45e5-8a93-827fb9ddeec7`):**
- `daily_projection = 0` em todos os dias 1-7 (PASS)
- `accumulated_balance_sma = accumulated_balance` nos dias 1-7 sem entradas/saídas díspares (PASS — sem inflação)
- Média aplicada apenas a partir do dia 8 em dias sem recebimento (PASS)
- `accumulated_balance` intocado vs baseline (PASS)

**Aprovação visual Wesley:** confirmada — primeiros 7 dias da linha âmbar não inflados.

**Nota reconciliação:** o orquestrador identificou que `financial_settings.initial_balance` estava stale (R$21.676,91 de 19/06) e o corrigiu para R$16.833,14 (fecho DFC 24/06 do Wesley). Eventuais divergências residuais entre a projeção e a DFC dia a dia refletem contas a pagar ainda não sincronizadas — tratadas em Phase 59-02 (CASHFIX-02).

### Task 3 — Atualizar legenda/tooltip/JSDoc do frontend
**Commit:** `bf71486d`

Três atualizações de strings/documentação, sem nenhuma mudança de lógica de render:

1. **`CashFlowChart.tsx` linha 190 (header):** Texto descritivo atualizado de "projeção pela média de vendas dos últimos 15 dias" para "projeção: confirmado nos primeiros 7 dias; média 15d só nos dias sem recebimento a partir do 8º dia".

2. **`CashFlowChart.tsx` linha 238 (Legend formatter):** Label de `accumulated_balance_sma` atualizado de `"Projeção média de vendas 15d"` para `"Projeção (confirmado 7d + média 15d nos buracos)"`.

3. **`useCashFlowData.ts` JSDoc de `accumulated_balance_sma`:** Comentário reescrito documentando o CASE completo (CASHFIX-01): dias 1-7 = confirmado; 8+ com recebimento = confirmado; 8+ sem recebimento = média 15d (v_sma).

`dataKey`, `name`, `Number(r.accumulated_balance_sma ?? 0)` e toda lógica de render permanecem intocados. `tsc --noEmit` limpo.

## Deviations from Plan

**1. [Rule 2 — Reconciliação] Correção de financial_settings.initial_balance**
- **Found during:** Task 2 (validação SQL no checkpoint do orquestrador)
- **Issue:** `financial_settings.initial_balance` estava em R$21.676,91 (salvo em 19/06, stale 5 dias). A DFC do Wesley no fecho de 24/06 registrou R$16.833,14.
- **Fix:** Orquestrador atualizou o registro via SQL antes de apresentar o gráfico ao Wesley.
- **Impact:** Linha confirmada (verde) agora alinha com o piso real da DFC. Divergências residuais restantes (contas a pagar) são tratadas em 59-02.
- **Files modified:** `financial_settings` (produção — sem arquivo local)
- **Commit:** n/a (prod-side via orquestrador)

## Remaining Divergences (not deviations — escopo de 59-02)

As divergências dia a dia entre `accumulated_balance` e a DFC do Wesley refletem contas a pagar do Tiny ainda não sincronizadas com `cash_outflows`. Estas são o escopo exato de CASHFIX-02 (Phase 59-02) e não são bugs desta fase.

## Verification Results

| Check | Result |
|-------|--------|
| Migration contém `CREATE OR REPLACE FUNCTION public.get_cashflow` | PASS |
| `now() AT TIME ZONE 'America/Sao_Paulo'` presente | PASS |
| `v_today + 7` presente no CASE | PASS |
| `SUM(d.inc - d.exp) OVER` aparece exatamente 1 vez | PASS |
| REVOKE/GRANT presentes; SECURITY INVOKER mantido | PASS |
| `daily_projection = 0` nos dias 1-7 (SQL prod) | PASS |
| `accumulated_balance_sma` sem inflação no curto prazo (SQL prod) | PASS |
| Aprovação visual Wesley (gráfico /caixa) | PASS |
| `tsc --noEmit` limpo | PASS |
| `accumulated_balance_sma` dataKey/name intactos | PASS |

## Self-Check

All claimed files verified:
- `supabase/migrations/20260659000000_cashflow_projection_7d_rule.sql` — exists in repo
- `src/components/financial/CashFlowChart.tsx` — modified, committed `bf71486d`
- `src/hooks/useCashFlowData.ts` — modified, committed `bf71486d`

Commits verified:
- `3022829c` — Task 1 migration
- `bf71486d` — Task 3 frontend strings

## Self-Check: PASSED
