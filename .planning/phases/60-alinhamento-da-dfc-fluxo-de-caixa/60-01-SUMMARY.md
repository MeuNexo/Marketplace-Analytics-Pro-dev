---
phase: 60-alinhamento-da-dfc-fluxo-de-caixa
plan: 01
status: complete
completed: 2026-06-25
---

# 60-01 SUMMARY — Backend: get_cashflow 4-arg (entrada piso + filtro de previsões)

## O que foi feito
- Migration `supabase/migrations/20260660000000_cashflow_dfc_alignment.sql`: `DROP FUNCTION public.get_cashflow(UUID,DATE,DATE)` + `CREATE` da versão de 4 args (`p_include_purchase_forecasts BOOLEAN DEFAULT false`).
- **CASHFIX-05 (entrada piso):** dia 8+ usa `GREATEST(d.inc, v_sma)` em `accumulated_balance_sma` e `daily_projection = GREATEST(0, v_sma - d.inc)`. Dias 1-7 intactos (confirmado-only). `accumulated_balance` com expressão inalterada.
- **CASHFIX-06 (toggle previsões):** CTE `exp` ganhou `AND (p_include_purchase_forecasts OR COALESCE(co.category,'') <> 'Previsões de compra')` ao lado do `status='pending'`.
- Preservados: `SECURITY INVOKER`, `search_path='public'`, `REVOKE PUBLIC/anon`, `GRANT authenticated` na assinatura de 4 args.

## Aplicação em prod (orquestrador via MCP)
- Aplicada via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` (`{"success":true}`). NÃO via SQL Editor.

## Provas de reconciliação (Task 2 — todas PASS)
- Saídas em aberto 05-12/07, toggle **OFF** = **R$87.105,79** (= Tiny do Wesley) ✓
- Saídas em aberto 05-12/07, toggle **ON** = **R$99.495,58** (diff R$12.389,79 = previsões OC383+OC410) ✓
- Chamada de **3 args** resolve pro default `false` = R$87.105,79 (sem "function is not unique") ✓
- **OC 383 1x:** 09/07 com OFF = R$2.643,36 (só Zebu; a previsão R$10.390,28 sumiu); a conta real de 11/07 permanece ✓
- Curva projetada OFF: vira negativa ~15/07 (sma 11/07 = +R$3.756; 15/07 = −R$18.188).

## Requisitos
- CASHFIX-05 ✓ · CASHFIX-06 (backend) ✓

## Pendência
- Validação visual final do Wesley em /fluxo-de-caixa (cobre 60-02 Task 3).
