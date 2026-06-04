# Phase 39 — SUMMARY: /anuncios custo + /publicidade produtos patrocinados

**Status:** ✅ Concluído (2026-06-04)
**Mode:** bugfix
**Reportado por:** Wesley — "pagina publicidade em produtos patrocinados está zerado.
pagina anuncios, o custo nao carregou, margem bruta e margem liquida..."

## Problema 1 — /anuncios: custo, margem bruta e margem líquida zerados

### Causa raiz
`MLAnuncios.tsx` buscava o custo com `costs.get(item.id)` — onde `item.id` é o
MLB item_id (ex: `MLB4265421967`). Mas `ml_product_costs` é populado pelo sync do
Tiny e keyado por `seller_sku` (com `item_id = TINY_<sku>`). O lookup por MLB
item_id nunca casava → `cost = null` → margem bruta/líquida = null.
(Mesma classe de bug da Phase 37.)

### Fix (frontend)
- `useMLProductCosts`: expõe um segundo índice `costsBySku` (Map por seller_sku).
- `MLAnuncios`: helper `costFor(itemId, sku)` = `costs.get(itemId) ?? costsBySku.get(sku)`.
  Aplicado no produto principal (`sku = item.seller_custom_field`) e nas variações
  (`v.seller_custom_field`). onSave de custo manual continua keyado por item.id (MLB).
- Commit `57bbb9aa`.

## Problema 2 — /publicidade: "produtos patrocinados" zerado e parado em 05-23

### Investigação
- `ml_ads_daily_cache`: fresco (06-04) com spend real (vem de `ml-ads`, que passa metrics).
- `ml_ads_products_cache`: spend/revenue = 0 em TODAS as linhas, parado em 05-23/05-27.
- Frontend (`useMLAds`) lê `products` da resposta de `ml-ads`, que lê de
  `ml_ads_products_cache` (zerado). Gate de freshness do ml-ads é baseado no DAILY
  cache (fresco) → ml-ads não re-sincroniza produtos.

### Causa raiz (DUAS)
1. **`sync-ads` buscava `/advertising/advertisers/{id}/product_ads/items` SEM os
   parâmetros `metrics`/`metrics_summary`/`date`** → itens sem métricas → spend=0.
   (A constante METRICS existia no arquivo mas não era usada na URL.)
2. **Constraint única obsoleta** `ml_ads_products_cache_unique (user_id, ml_user_id,
   item_id)` — SEM a coluna `date`. O modelo é série-por-dia; o upsert usa
   `onConflict (organization_id, ml_user_id, item_id, date)`, mas a constraint antiga
   sem date bloqueava o mesmo item em datas diferentes → upsert violava a constraint
   não-árbitro → falha (logada via console, NÃO lançada) → 0 produtos gravados.
   Travou na 1ª data de cada item (05-23).

### Fix
- `sync-ads`: items query passa `date_from=date_to=today` + `metrics=METRICS` +
  `metrics_summary=true`. Deploy v18.
- Migration `20260604140000_drop_obsolete_ads_products_unique.sql`: dropa a constraint
  obsoleta; mantém `ml_ads_products_org_user_item_date_key`.
- Commit `cb0ec5c9`.

### Validação + backfill
- Teste 1 dia (06-03, conta principal): 263 produtos, spend R$296,14, rev R$6.345, item exemplo MLB5331572490. ✓
- Backfill 30 dias (1 job de ads por data — o handler sincroniza TODAS as contas por data):
  - 1639558873: 29 dias, spend R$6.112,14, rev R$77.390,59
  - 427063369: 29 dias, spend R$188.487,69, rev R$2.136.099,80

## Método de backfill (reutilizável)
Inserir `sync_jobs` (job_type='ads', 1 por data) e disparar `process-sync-job` via
`net.http_post` com o anon JWT (process-sync-job usa a service key interna). A
`sync-ads` sincroniza todas as contas por data, então 1 job/dia basta.

## Commits
- `57bbb9aa` — fix /anuncios custo por seller_sku + sync-ads metrics params
- `cb0ec5c9` — drop constraint obsoleta + reverte debug
- `ef5f0e5b` — docs

## Aprendizado
Falha silenciosa (upsert que loga erro sem lançar) escondeu o bug. E um índice
único legado SEM a coluna de partição (date) quebra modelos série-por-dia. Sempre
revisar TODAS as constraints únicas de uma tabela ao migrar para série temporal.
