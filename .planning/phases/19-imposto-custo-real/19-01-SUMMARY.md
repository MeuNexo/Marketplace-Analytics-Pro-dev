---
phase: 19-imposto-custo-real
plan: "01"
status: completed
completed_at: 2026-05-21
---

# 19-01 SUMMARY — Fórmula Wesley + Custo Histórico + Cron

## O que foi feito

### Task 1 & 2: Nova fórmula de imposto (TypeScript)
- `src/lib/tax/perOrder.ts` — `computeOrderTaxRate` para `lucro_real` usa fórmula Wesley:
  `rate = icmsAliq + (1 - icmsAliq/100) × (1.65 + 7.60)`
- `src/lib/tax/index.ts` — `calculateEffectiveRate` espelha a mesma fórmula
- Removidos campos `lr_pis_debito`, `lr_pis_credito`, `lr_cofins_debito`, `lr_cofins_credito`, `lr_icms_credito` das interfaces
- `src/hooks/useMLTaxConfig.ts` — atualizado para remover os campos obsoletos
- `src/lib/tax/index.test.ts` — testes reescritos para fórmula Wesley (24 testes ✅)

### Fórmula verificada
- ICMS = 12%: `12 + 0.88 × 9.25 = 20.14%` ✅
- ICMS = 7%: `7 + 0.93 × 9.25 = 15.60%` ✅
- ICMS = 0 (sem config): `0 + 1.0 × 9.25 = 9.25%` (só PIS+COFINS)

### Task 3: Migration SQL aplicada
- `supabase/migrations/20260521300000_recalc_tax_and_cron_custos.sql`
- **Função `upsert_order_preserve_cost`**: INSERT ... ON CONFLICT preserva `custo_unit` quando já preenchido (CASE WHEN orders.custo_unit IS NOT NULL)
- **Recálculo dos orders**: 327/327 orders recalculados com nova fórmula
  - avg_tax_rate = 9.25% (uf_origem = null → ICMS não determinado → só PIS+COFINS)
  - total_tax_amount = R$5.468,78
  - Quando Wesley configurar uf_origem = 'SC' e lr_icms_aliquota_intra, orders futuros receberão ~20.14%
- **pg_cron `sync-tiny-costs-daily`**: criado, roda às 03:00 UTC, sem auth header (verify_jwt: false)

### Task 4: Edge function sync-ml-orders v10
- Fórmula Wesley implementada na cópia inline da edge function
- Upsert substituído por chamada RPC `upsert_order_preserve_cost` (loop por order)
- Deployado como v10 ✅

## Estado do banco (pós-migration)
```
total_orders: 327
orders_com_tax: 327
avg_tax_rate: 9.25% (ICMS não configurado → só PIS+COFINS)
total_tax_amount: R$ 5.468,78
```

## Próximos passos
- Configurar `uf_origem = 'SC'` e `lr_icms_aliquota_intra` no MLFiscal para ativar ICMS correto
- Plano 19-02: frontend usa `kpiSummary.total_tax` para exibir imposto no menu Vendas
