---
phase: 58-veracidade-completude-dados
plan: "03"
subsystem: nexo-chat
tags: [financeiro, dre, billing, cashflow, cron, veracidade, anti-idor, testes]
dependencies:
  requires: [58-01, 58-02]
  provides: [get_dre_monthly-ml_billing_daily, cron-resync-billing-daily, cashflow-saldo_hoje, descricoes-financeiras]
  affects:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
    - supabase/migrations/20260655000000_phase58_cron_billing_daily_resync.sql
tech_stack:
  added: []
  patterns: [pg-cron-pattern-b-vault, paginacao-range-ml_billing_daily, calendario-01-fim, cashflow-saldo-hoje-extractor]
key_files:
  created:
    - supabase/migrations/20260655000000_phase58_cron_billing_daily_resync.sql
  modified:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
decisions:
  - "get_dre_monthly agrega ml_billing_daily por mês-calendário (01–fim) — alinha ao card DRE do painel (useMLBillingDaily)"
  - "get_cashflow: {horizon_label, saldo_hoje, series} — rotula cobertura parcial de inflows ~+27d"
  - "get_costs_by_month description: saídas de caixa/categoria, NÃO é CMV nem fatura ML"
  - "Cron 06:40 UTC itera ml_tokens (refresh_token IS NOT NULL) — um net.http_post por loja (W-2)"
  - "Auth Pattern B: vault.decrypted_secrets name=service_role_key (sb_secret_*)"
  - "Migration escrita, NÃO aplicada — aplicação é checkpoint 58-06 (MCP)"
metrics:
  duration: ~4min
  completed: 2026-06-24
status: complete
---

# Phase 58 Plan 03: DRE mês-calendário (ml_billing_daily) + cron resync + cashflow saldo_hoje — Summary

**One-liner:** `get_dre_monthly` troca fonte para `ml_billing_daily` mês-calendário (alinha ao painel); `get_cashflow` expõe `saldo_hoje`; `get_costs_by_month` rotulada como fluxo de caixa; cron diário `billing-daily-resync` escrito (a aplicar no checkpoint 58-06).

## What Was Built

### Task 1: get_dre_monthly por mês-calendário + cashflow saldo_hoje + costs desc

**Achados corrigidos (FIN-1/3/4/5, D8/D10/D11):**

**FIN-1/FIN-5 — get_dre_monthly (D8/D11):**

Antes: lia `ml_billing_monthly` (ciclo de fatura 06→05). Resultado: Nexo dizia R$43.869 (jun), painel mostrava R$34.853 (mês-calendário) → divergência de ~R$9k.

Depois: agrega `ml_billing_daily` por mês-calendário (01–fim), com paginação `.range()` (multi-loja pode ter >1000 linhas). Anti-IDOR: `.eq(organization_id, orgId)` + `.in(ml_user_id, mlUserIds)` do servidor. Retorno:

```json
{
  "period_month": "2026-06",
  "label": "fatura/tarifas ML do mês-calendário (01–30), espelho do card DRE do painel — NÃO é DRE completo (sem CMV/impostos/lucro); para lucro use get_margin_summary",
  "by_type": { "CFFE": { "label": "Comissão", "amount": 23500 }, "CFONPN": {...}, ... },
  "total": 34853.00,
  "coverage_until": "2026-06-24",
  "freshness": "2026-06-24T06:00:00Z"
}
```

`coverage_until` permite ao Nexo detectar defasagem (VERAC-04). `freshness` = max(synced_at) das linhas lidas.

Description atualizada: `"Fatura/tarifas do ML por MÊS-CALENDÁRIO (espelha o card DRE do painel). NÃO é DRE completo: só tarifas ML (CFFE/CFONPN/PADS e outros), sem CMV/impostos/lucro. Para lucro e margem use get_margin_summary."` (FIN-5/D11)

**FIN-3 — get_cashflow (D10):**

Antes: retornava a série bruta da RPC. Modelo podia inferir saldo de -734k em 90d como real (era artefato de outflows até 2030 sem inflows correspondentes além de ~+27d).

Depois: retorna `{horizon_label, saldo_hoje, series}`:
- `saldo_hoje`: extrai `saldo_acumulado` da linha cuja `date == hoje` (ou primeiro ponto da série)
- `horizon_label`: explica horizonte + cobertura parcial + remete ao `get_treasury_panel` para visão 30d
- `series`: a série original (cap 50 linhas)

Description atualizada para citar `saldo_hoje`, cobertura parcial e remeter ao `get_treasury_panel`.

**FIN-4 — get_costs_by_month (D11):**

Antes: `"Custos/DRE por mês. Use para tendência de custos e fatura ML mês a mês."` — errada: misturava fluxo de caixa com DRE/fatura.

Depois: `"Saídas de caixa por categoria e por mês (Fornecedores, Salários, Empréstimo, etc., pagas + a pagar). NÃO é CMV nem a fatura do ML. Para fatura/tarifas ML use get_dre_monthly; para CMV/lucro use get_margin_summary."` (D11)

**Não alterado (correto por design):**

- A RPC `get_cashflow` compartilhada com Tesouraria não foi modificada — apenas o wrapper da tool enriquece o retorno.
- `get_costs_by_month` chama `get_cost_by_month` RPC inalterada (só a description foi corrigida).
- Contagem de tools permanece 23 (nenhuma tool nova neste plano).

### Task 2: Migration cron resync + testes

**Migration 20260655000000_phase58_cron_billing_daily_resync.sql (ESCRITA, NÃO APLICADA — FIN-2/D9):**

- Função `resync_billing_daily_current_month()`: PL/pgSQL SECURITY DEFINER; FOR loop sobre `SELECT DISTINCT ml_user_id FROM ml_tokens WHERE refresh_token IS NOT NULL`; por cada loja: `net.http_post` para `sync-ml-billing` com body `{ml_user_id, period_month: to_char(now(),'YYYY-MM'), mode:'daily'}` — uma chamada por loja (W-2).
- Auth Pattern B: `vault.decrypted_secrets WHERE name = 'service_role_key'` (sb_secret_*, não JWT legado).
- `cron.schedule('billing-daily-resync', '40 6 * * *', ...)` — 06:40 UTC, antes do report das 07:03.
- Idempotente: `cron.unschedule` guard + `CREATE OR REPLACE FUNCTION`.
- `REVOKE EXECUTE` de PUBLIC/anon/authenticated (T-58-03-CRON).
- Cabeçalho documenta explicitamente que a aplicação é checkpoint 58-06 (MCP).

**tools.test.ts — 40 testes (era 36):**

4 novos testes adicionados:
1. `get_dre_monthly`: anti-IDOR via `ml_billing_daily` (não `ml_billing_monthly`); retorna by_type/total/coverage_until/freshness/label; NÃO encontra `ml_billing_monthly`
2. `get_dre_monthly description`: menciona mês-calendário + nega DRE completo + espelha painel (FIN-1/FIN-5/D8/D11)
3. `get_costs_by_month description`: cita saídas de caixa + nega CMV/fatura ML (FIN-4/D11)
4. `get_cashflow description + dispatcher`: description cita saldo_hoje/cobertura/get_treasury_panel; retorno `{horizon_label, saldo_hoje, series}` com saldo_hoje extrayído da linha do dia atual (FIN-3/D10)

## Verification

- `deno check supabase/functions/nexo-chat/tools.ts` — PASS (verde, ambas as tasks)
- `npx vitest run supabase/functions/nexo-chat/tools.test.ts` — PASS: **40 testes, 1 arquivo, 0 falhas**
- Migration existe: `supabase/migrations/20260655000000_phase58_cron_billing_daily_resync.sql`
- `grep -q "cron.schedule"` — PASS
- `grep -qiE "LOOP|FOR .* IN"` — PASS (MIGRATION_OK)

## Deviations from Plan

None — plano executado exatamente como escrito. O stub do `makeStub` já suportava múltiplos `range()` calls (pagination loop de `get_dre_monthly` termina corretamente porque `rows.length < PAGE`).

## Known Stubs

None. `get_dre_monthly` lê `ml_billing_daily` real (igual ao `useMLBillingDaily` do painel). `get_cashflow` continua chamando a RPC real. A migration de cron apenas invoca a EF existente `sync-ml-billing`.

## Threat Flags

None. Nenhuma nova superfície de rede além da invocação do cron já existente para EFs.

## STRIDE Threat Register — Status

| Threat ID | Status |
|-----------|--------|
| T-58-03-IDOR | MITIGADO — `get_dre_monthly` usa `.eq(organization_id)+.in(ml_user_id)` do servidor; clampMonth valida period_month; teste anti-IDOR cobre |
| T-58-03-CRON | MITIGADO — auth via vault Pattern B (service_role_key sb_secret_*); REVOKE de PUBLIC/anon/authenticated |
| T-58-03-RO | MITIGADO — só select()/rpc() no dispatcher; única mutação de banco = migration de cron (a aplicar no checkpoint) |

## Self-Check: PASSED

- FOUND: supabase/functions/nexo-chat/tools.ts
- FOUND: supabase/functions/nexo-chat/tools.test.ts
- FOUND: supabase/migrations/20260655000000_phase58_cron_billing_daily_resync.sql
- FOUND commit 5a624edd (Task 1 — get_dre_monthly ml_billing_daily + cashflow saldo_hoje + costs desc)
- FOUND commit 9f7f9c5c (Task 2 — migration cron + testes 40 verdes)
