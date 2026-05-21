# Phase 12 — Plan 02 Summary

**Status:** COMPLETED
**Date:** 2026-05-21

## Resultado

Sync de vendas funcionando com dados reais da Pé Vermeio.

## Dados confirmados

- **Nickname ML:** OPEVERMEIO
- **Anúncios ativos:** 81
- **ml_user_cache:** populado ✓
- **ml_daily_cache:** populado com dados reais ✓
- **Dashboard:** exibindo faturamento real ✓

## Requirements satisfeitos

- **SYNC-01** ✓ — `mercado-libre-integration` populou `ml_daily_cache`, `ml_user_cache`
- **SYNC-02** ✓ — Dashboard exibe faturamento real da Pé Vermeio (não zeros)
- **SYNC-03** ✓ — Sync completou sem erro
- **SYNC-04** ✓ — `ml_user_cache` tem nickname OPEVERMEIO

## Bug corrigido nesta fase

Schema desatualizado: `ml_daily_cache`, `ml_hourly_cache`, `ml_product_daily_cache`, `ml_user_cache`
não tinham colunas `units_sold` e `seller_id` — migration aplicada antes do sync.

## Nota sobre receita

- `total_revenue` = todos os pedidos (incluindo cancelados)
- `approved_revenue` = apenas paid/confirmed (exclui cancelados)
- Dashboard usa `approved_revenue` como KPI principal
