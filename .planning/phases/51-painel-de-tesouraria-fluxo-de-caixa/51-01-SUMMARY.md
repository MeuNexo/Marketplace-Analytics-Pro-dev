# 51-01 — Backend de Tesouraria — SUMMARY

**Status:** Complete
**Plan:** 51-01-PLAN.md
**Date:** 2026-06-19

## O que foi entregue

1. **Coluna `alert_threshold`** (numeric, default 30000) em `financial_settings` (D-10, TESO-03).
2. **3 RPCs** em `ckcdevcxgvueywivefgx`, todas **SECURITY INVOKER** (prosecdef=false confirmado), BRT, REVOKE PUBLIC/anon + GRANT authenticated:
   - `get_treasury_panel(uuid)` — 10 campos: burn_rate, alert_threshold, alert_date, min_balance_date, entrada_real_30d, saida_real_30d, fornec_30d/60d/90d, total_exposicao (D-02..D-09b, TESO-04).
   - `get_cost_by_month(uuid, int)` — composição por mês+categoria, janela limitada (D-12).
   - `get_supplier_exposure(uuid, int)` — top-N fornecedores 30/60/90d (D-13).

## Commits
- `9aa378dd` — Task 1: migration `20260650000000_treasury_panel.sql` (coluna + 3 RPCs).
- Migration `20260650000100_treasury_category_backfill.sql` (backfill infra — ver desvio).

## Apply (Task 2 — [BLOCKING] human-action)
Aplicada ao vivo pelo **orquestrador** via MCP `apply_migration` (gsd-executor não tem Supabase MCP).
Verificação: coluna existe (1); 3 RPCs `prosecdef=false`; smoke `get_treasury_panel` retorna os 10 campos.

## Smoke (org Pé Vermeio 7f615df7)
burn_rate≈191k, alert_date=2026-06-20, min_balance_date=2026-09-15, entrada_30d≈185k,
saida_30d(paid)≈211k, fornec 30/60/90 ≈ 251k/535k/798k, total_exposicao≈2,12M.
**Nota:** valores acima da imagem de referência do Wesley — a imagem era snapshot antigo;
fórmulas corretas e internamente consistentes. Validar no checkpoint visual.

## DESVIO relevante (premissa do roadmap incorreta)
O roadmap assumia `cash_outflows.category` preenchido. Na realidade estava **100% NULL** (1960 contas).
Investigação na API Tiny: a categoria real (`categoria.descricao` — Empréstimo, Fornecedores, Salários…,
batendo com a imagem) só vem no **detalhe** `/contas-pagar/{id}`, não na listagem que o EF usa.
- Decisão Wesley: popular a categoria de verdade, escopo "últimos 12 meses + pendentes" (1067 contas).
- Construído backfill resiliente (fila `cat_backfill_queue` + `enrich_drain`/`enrich_harvest` via pg_net,
  throttle ~1/seg + retry 429), agendado em **pg_cron** (`treasury_cat_drain`/`treasury_cat_harvest`,
  a cada 1 min) drenando em background. Categorias reais já confirmadas no banco.
- `get_cost_by_month` recebeu **bound de janela** (evita meses-outlier de contas com vencimento em 2030).

## Pendência going-forward (follow-up, não bloqueia a fase)
O EF `sync-tiny-payables` continua mapeando category de `item.tipo` (vazio). Para novas contas a pagar
manterem categoria, ou (a) o cron de enrich permanece e re-enfileira nulls, ou (b) alterar o EF para
buscar o detalhe por conta. Recomendado tratar como tarefa separada após validação do Wesley.

## Requirements: TESO-03, TESO-04
