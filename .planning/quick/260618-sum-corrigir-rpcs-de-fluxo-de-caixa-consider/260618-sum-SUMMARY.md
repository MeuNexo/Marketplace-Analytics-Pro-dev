---
phase: 260618-sum
plan: "01"
subsystem: database/cashflow-rpcs
tags: [cashflow, rpc, migration, cash_outflows, status-filter]
dependency_graph:
  requires: [20260618140000_cash_flow_rpcs_future_only.sql]
  provides: [get_cashflow, get_daily_balance, get_projected_balance_summary sem filtro de status]
  affects: [/financeiro, fluxo de caixa, projeção]
tech_stack:
  added: []
  patterns: [SECURITY INVOKER, CREATE OR REPLACE migration, futuro-only via condições de data]
key_files:
  created:
    - supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql
  modified: []
decisions:
  - "Status das saídas (cash_outflows) removido como critério de filtragem: recorte futuro-only garantido exclusivamente por condições de data"
  - "Modelo futuro-only de Wesley (20260618140000) mantido integralmente, exceto os 5 filtros co.status='pending'"
metrics:
  duration: 110s
  completed_date: "2026-06-18"
---

# Quick Task 260618-sum: Corrigir RPCs de Fluxo de Caixa (status filter) — Summary

One-liner: Removidos 5 filtros `co.status='pending'` das 3 RPCs de fluxo de caixa (get_cashflow, get_daily_balance, get_projected_balance_summary) — saídas agendadas no Tiny com status 'paid' e data futura passam a aparecer na projeção.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Criar migration das 3 RPCs sem filtro de status | 5652ebfa | supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql |
| 2 | Validar e commitar a migration | 5652ebfa | (mesma migration, mesmo commit) |

## What Was Built

Uma migration `CREATE OR REPLACE` das 3 RPCs de fluxo de caixa da Phase 49, baseada na versão futuro-only (`20260618140000_cash_flow_rpcs_future_only.sql`) mas com os filtros de status removidos das queries de `cash_outflows`.

### Ocorrências removidas (5 total)

| Função | Localização | Linha original |
|--------|-------------|----------------|
| get_cashflow | UNION ALL saídas do período | `AND co.status = 'pending'` removido da cláusula WHERE |
| get_daily_balance | Saídas de hoje | `AND co.status = 'pending'` removido da cláusula WHERE |
| get_projected_balance_summary | Saldo atual (hoje) | `co.status='pending'` removido |
| get_projected_balance_summary | Total de saídas projetadas | `co.status='pending'` removido |
| get_projected_balance_summary | Loop dia a dia | `co.status='pending'` removido |

### O que foi preservado

- Assinaturas idênticas: `get_cashflow(UUID, DATE, DATE)`, `get_daily_balance(UUID, DATE)`, `get_projected_balance_summary(UUID, INT)`
- `RETURNS TABLE (...)` idêntico em cada função
- `LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'` nas 3
- Recorte futuro-only via condições de data: `GREATEST(p_start_date, CURRENT_DATE)`, `BETWEEN v_start AND p_end_date`, `> v_today`, `= v_day_date`
- Bloco REVOKE/GRANT: `REVOKE EXECUTE ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated` para as 3 funções
- `cash_inflows` sem alteração

## Deviations from Plan

None — plan executed exactly as written.

A única nota: a migration base referenciada no plano (`20260618120000_cash_flow_rpcs.sql`) NÃO continha o filtro de status — ele foi introduzido pela migration `20260618140000_cash_flow_rpcs_future_only.sql` (modelo futuro-only decidido por Wesley). A nova migration foi baseada no `20260618140000` (estado atual de produção), conforme a nota "CASHFLOW-FIX-01" do plano.

## Deployment

**APPLY_MIGRATION PENDENTE — responsabilidade do orquestrador.**

- Projeto Supabase alvo: `ckcdevcxgvueywivefgx`
- Migration a aplicar: `20260618210000_cash_flow_rpcs_all_statuses.sql`
- Método: `apply_migration` via MCP Supabase (NUNCA via SQL Editor — regra de domínio do projeto)

**Validação pós-deploy (manual pelo orquestrador):**
Chamar `get_projected_balance_summary` em produção deve refletir as 13 contas 'paid' futuras (R$44.064,95) no campo `total_expenses` e no saldo projetado. Antes do fix, esse valor sumia da projeção.

## Validation Results

```
CREATE OR REPLACE FUNCTION (não-comentário): 3 ✓
SECURITY INVOKER (não-comentário): 3 ✓
GRANT EXECUTE TO authenticated: 3 ✓
REVOKE EXECUTE FROM PUBLIC, anon: 3 ✓
co.status em linhas de código: 0 ✓
outflow_date occurrences: 6 (futuro-only via data) ✓
$$ balanced: 3 opens / 3 closes ✓
```

## Self-Check: PASSED

- [x] supabase/migrations/20260618210000_cash_flow_rpcs_all_statuses.sql — FOUND
- [x] Commit 5652ebfa — FOUND (branch preview/phase-49-fluxo-caixa)
- [x] Zero co.status em linhas de código
- [x] 3× SECURITY INVOKER, 3× GRANT authenticated, 3× REVOKE PUBLIC/anon
