---
phase: 49-fluxo-de-caixa-caixa-real
plan: "02"
subsystem: backend/rpcs
tags: [sql, rpc, security-invoker, cash-flow, sma, supabase]
dependency_graph:
  requires: ["49-01"]   # tabelas cash_inflows, cash_outflows, financial_settings
  provides: ["get_cashflow", "get_daily_balance", "get_projected_balance_summary"]
  affects:  ["49-03", "49-04"]   # hooks e página frontend consomem estas RPCs
tech_stack:
  added: []
  patterns:
    - "SECURITY INVOKER RPC com RLS como guard de tenant (não DEFINER)"
    - "Window function SUM OVER ORDER BY para saldo acumulado diário"
    - "SMA via orders por organization_id (não ml_daily_cache user_id-scoped)"
    - "REVOKE EXECUTE FROM PUBLIC + GRANT authenticated"
    - "Boundary timestamptz: < (hoje + 1 dia) para coluna TIMESTAMPTZ orders.data_pedido"
key_files:
  created:
    - supabase/migrations/20260618120000_cash_flow_rpcs.sql
  modified: []
decisions:
  - "SMA usa orders.receita_bruta por organization_id (não ml_daily_cache) — evita mismatch user_id×org"
  - "SMA ativa após dia 8 de projeção via CASE WHEN v_day_num > 8 THEN 1 ELSE 0 END — 1 dia de SMA por dia"
  - "REVOKE PUBLIC + GRANT authenticated (não service_role) — RPCs são chamadas pelo frontend autenticado"
  - "outflow_date usada em todas as saídas (coluna renomeada no 49-01)"
metrics:
  duration_minutes: 15
  completed_date: "2026-06-18"
  tasks_completed: 2
  tasks_total: 3
  files_created: 1
  files_modified: 0
---

# Phase 49 Plan 02: RPCs de Fluxo de Caixa — Summary

**One-liner:** 3 RPCs SECURITY INVOKER para saldo acumulado (window SUM OVER) + projeção SMA 15d de orders por org com detecção de data crítica de saldo negativo.

## O que foi feito

Criada a migration `supabase/migrations/20260618120000_cash_flow_rpcs.sql` com as 3 RPCs SQL que formam o backbone do módulo de Fluxo de Caixa (CASH-03). **Nada foi aplicado em produção** — o orquestrador aplica via MCP após aprovação do Wesley (Task 3 = checkpoint blocking-human).

## RPCs Criadas

### `public.get_cashflow(p_org_id UUID, p_start_date DATE, p_end_date DATE)`

Retorna série diária com saldo acumulado real. Lógica:

1. Busca `initial_balance` de `financial_settings` da org.
2. Calcula `v_previous_balance` = Σ entradas antes de `p_start_date` (via `cash_inflows.release_date`) menos Σ saídas antes (via `cash_outflows.outflow_date`).
3. CTE `daily_data`: UNION ALL de entradas (release_date) e saídas (outflow_date), agrupado por dia. `d_balance = d_income - d_expense` EXPLÍCITO (tabelas separadas, não signed amount).
4. Window function: `accumulated_balance = (v_initial + v_previous + SUM(d_balance) OVER (ORDER BY d_date ASC))`.

### `public.get_daily_balance(p_org_id UUID, p_target_date DATE)`

Retorna 1 linha: `saldo_inicial`, `entradas_hoje`, `saidas_hoje`, `saldo_final_previsto`. Saldo inicial = initial_balance + entradas acumuladas antes do dia alvo - saídas acumuladas antes do dia alvo.

### `public.get_projected_balance_summary(p_org_id UUID, p_projection_days INT)`

Projeção de caixa com detecção de data crítica:

- Saldo atual via `get_daily_balance(p_org_id, CURRENT_DATE)`.
- SMA = `Σ orders.receita_bruta (últimos 15d, organization_id) / 15.0 × (1 - operational_cost_rate)`.
- SMA ativa somente após dia 8 da projeção (`CASE WHEN v_day_num > 8 THEN 1 ELSE 0 END`).
- Loop `FOR v_day_num IN 1..p_projection_days` acumulando `pessimistic` (sem receita) e `realistic` (com SMA).
- `critical_date`: primeiro dia com `v_realistic < 0`. `min_balance`: menor saldo realístico.
- Retorna: `current_balance`, `pessimistic_balance`, `realistic_balance`, `critical_date`, `min_balance`, `confirmed_income` (entradas 30d), `total_expenses` (saídas 30d).

## Decisões Técnicas Críticas

### Fonte da SMA: orders por organization_id

O RESEARCH original (A3) sugeria `ml_daily_cache.approved_revenue`. Corrigido: `ml_daily_cache` é scoped por `user_id`, não `organization_id` — causaria mismatch de dados entre lojas/contas. A mesma correção foi feita no consultor RPC (20260645010000). A SMA usa `orders.receita_bruta WHERE organization_id = p_org_id`.

### Boundary timestamptz

`orders.data_pedido` é `TIMESTAMPTZ`. A query usa:
```sql
AND o.data_pedido >= (v_today - INTERVAL '15 days')
AND o.data_pedido <  (v_today::TIMESTAMPTZ + INTERVAL '1 day')
```
Nunca `<= string só-data` (Armadilha 3 do RESEARCH).

### SECURITY INVOKER obrigatório

Todas as 3 funções usam `SECURITY INVOKER`. `DEFINER + p_org_id por parâmetro = IDOR`: caller poderia passar qualquer `org_id` e ver dados de outra organização. `INVOKER` preserva o contexto do caller e o RLS de `cash_inflows`/`cash_outflows`/`orders` (`is_org_member`) age como guard real.

### REVOKE/GRANT

PostgreSQL concede `EXECUTE a PUBLIC` por padrão. Revogado de `PUBLIC, anon` e concedido apenas a `authenticated` (não `service_role` — essas RPCs são chamadas pelo frontend via `supabase.rpc()`).

## Desvios do Plano

Nenhum — o plano foi executado exatamente como especificado. A lógica do RESEARCH foi portada com todas as adaptações documentadas (outflow_date, SMA via orders, boundary timestamptz, d_balance explícito).

## Stubs Conhecidos

Nenhum — a migration não contém dados de placeholder nem hardcoded values. As RPCs leem dados reais das tabelas da org.

## Threat Surface

Nenhuma superfície nova além do que está no `<threat_model>` do plano:

| Flag | Arquivo | Descrição |
|------|---------|-----------|
| Mitigado T-49-02-01 | 20260618120000_cash_flow_rpcs.sql | SECURITY INVOKER em todas as 3 RPCs — RLS é o guard |
| Mitigado T-49-02-02 | 20260618120000_cash_flow_rpcs.sql | REVOKE PUBLIC + GRANT authenticated |
| Mitigado T-49-02-03 | 20260618120000_cash_flow_rpcs.sql | SMA via orders por organization_id |

## Commits

| Task | Nome | Commit | Arquivos |
|------|------|--------|---------|
| 1+2 | get_cashflow + get_daily_balance + get_projected_balance_summary + REVOKE/GRANT | bca1c8a3 | supabase/migrations/20260618120000_cash_flow_rpcs.sql |

## Parado em: Task 3 (checkpoint blocking-human)

Task 3 é um checkpoint `human-action` com `gate="blocking-human"`. A migration foi escrita mas **NÃO aplicada em produção**. O orquestrador deve aplicar via MCP após aprovação do Wesley.

## Self-Check: PASSED

- `supabase/migrations/20260618120000_cash_flow_rpcs.sql` — ENCONTRADO
- commit `bca1c8a3` — ENCONTRADO
