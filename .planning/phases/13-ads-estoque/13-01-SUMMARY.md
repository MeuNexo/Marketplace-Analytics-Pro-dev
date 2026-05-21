# Phase 13 — Plan 01 Summary

**Status:** COMPLETED
**Date:** 2026-05-21

## O que foi feito

Corrigido bug no `ml-ads` edge function: a função lia `ml_user_id` apenas de URL
params, mas o frontend (`useMLAds.syncNow`) envia via POST body com
`supabase.functions.invoke`. O botão "Sincronizar ML" retornava 400.

## Bug corrigido

`supabase/functions/ml-ads/index.ts` — leitura de parâmetros:
- **Antes:** `url.searchParams.get("ml_user_id")` only
- **Depois:** fallback para `body.ml_user_id` quando URL param ausente
- Mesmo fix aplicado para `date_from`, `date_to`, `force`

## Deploy

`ml-ads` v4 deployado no projeto dev `ckcdevcxgvueywivefgx`.

## Dados confirmados

- **ml_ads_daily_cache:** 30 linhas para ml_user_id=1639558873
- **ml_ads_campaigns_cache:** 11 campanhas
- **ml_ads_products_cache:** 100 produtos patrocinados

## Requirements

- **ADS-01** ✓ — ml-ads processou POST body corretamente, sync completou
- **ADS-02** ✓ — /publicidade exibe dados reais (30 dias, 11 campanhas, 100 produtos)
