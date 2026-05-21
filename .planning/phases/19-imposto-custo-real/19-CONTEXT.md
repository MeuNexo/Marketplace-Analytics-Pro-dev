# Phase 19: Imposto Real + Custo Histórico + Cron Custos — Context

**Created:** 2026-05-21
**Milestone:** v7.0
**Status:** Planning

---

## Goal

Três problemas críticos de integridade de dados e exibição:

1. **Imposto zerado no dashboard** — O cálculo atual (Lucro Real com PIS/COFINS crédito = débito) resulta em effective_rate = 0%. A fórmula correta é: `ICMS + PIS×base + COFINS×base` onde base = Receita × (1 - aliq_ICMS).
2. **Custo histórico apagado** — Re-sync de um pedido sobrescreve `custo_unit` com o custo atual do Tiny, corrompendo o histórico de margem.
3. **Sync de custos manual** — Não existe cron automático para atualizar `ml_product_costs` a partir do Tiny ERP.

## Fórmula de Imposto (Wesley)

```
aliq_ICMS_UF = alíquota ICMS da UF destino (inter ou intra, de ml_tax_config)
Débito ICMS     = Receita × aliq_ICMS_UF
Base PIS/COFINS = Receita × (1 - aliq_ICMS_UF)
Débito PIS      = Base × 1,65%
Débito COFINS   = Base × 7,6%
Total Impostos  = ICMS + PIS + COFINS
```

**Exemplo** com ICMS = 12% (inter Sul/Sudeste):
- ICMS = R$100 × 12% = R$12
- Base = R$100 × 88% = R$88
- PIS = R$88 × 1.65% = R$1.45
- COFINS = R$88 × 7.60% = R$6.69
- **Total = R$20.14 (20.14% efetivo)** ✓

## Config Atual em Produção (ml_tax_config)

- Regime: `lucro_real`
- uf_origem: `null` (precisa ser configurado → ex: SC)
- lr_icms_aliquota_intra: `null` (precisa ser configurado)
- lr_icms_aliquota_inter_sul_sudeste: `12`
- lr_icms_aliquota_inter_norte_nordeste: `7`
- effective_rate: `0.0000` (errado — PIS/COFINS crédito = débito → zero)

## Tabelas Relevantes

```sql
-- orders: campo estado (UF destino) disponível; tax_rate e tax_amount já existem
-- ml_tax_config: uf_origem, lr_icms_aliquota_intra, lr_icms_aliquota_inter_*
-- ml_product_costs: custo por SKU (Tiny ERP), sem cron automático
```

## Arquivos-Chave

```
src/lib/tax/perOrder.ts       ← computeOrderTaxRate — PRECISA SER ATUALIZADO com nova fórmula
src/lib/tax/index.ts          ← calculateEffectiveRate (DB trigger mirror — atualizar)
supabase/functions/sync-ml-orders/index.ts  ← cópia inline de computeOrderTaxRate — ATUALIZAR
src/hooks/useMLKPISummary.ts  ← adicionar total_tax: SUM(tax_amount)
src/pages/MercadoLivre.tsx    ← impostosTotal: trocar de effective_rate*receita para kpiSummary.total_tax
supabase/migrations/          ← recálculo SQL + pg_cron sync-tiny-costs
```

## Estado dos Crons (Supabase pg_cron)

| Job | Schedule | Função |
|-----|----------|--------|
| ml-token-refresh-every-20min | */20 * * * * | Renova tokens ML |
| sync-dispatch-every-30min | */30 * * * * | Despacha jobs de sync |
| sync-orders-daily | 0 9 * * * | Sync de orders diário |
| tiny-token-refresh-every-90min | */90 * * * * | Renova token Tiny |
| **sync-tiny-costs-daily** | **0 3 * * *** | **A CRIAR** |

## Success Criteria

1. `computeOrderTaxRate` retorna ~20.14% para Lucro Real com ICMS 12%
2. `orders.tax_amount` para período maio/2026 mostra imposto correto (não zero)
3. Re-sync de um pedido já existente NÃO sobrescreve `custo_unit`
4. pg_cron `sync-tiny-costs-daily` existe e está ativo
5. Menu Vendas mostra imposto = SUM(orders.tax_amount) do período
6. Menu Pedidos: coluna imposto mostra valores reais (não "—")
