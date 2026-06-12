# Phase 27 — Fix: spend de ads por produto com dados corretos

## Diagnóstico (evidência colhida em 2026-05-22)

O endpoint novo do PADS (`/marketplace/advertising/MLB/advertisers/{id}/product_ads/ads/search`) **não filtra métricas por data**:

- 4 backfill jobs para Apr 23–26 completaram em ~1,5s e gravaram **zero** linhas de produto — API retorna vazio para datas históricas
- A data de hoje (2026-05-22) tem 261 itens com spend total **R$6.374,31** — incompatível com o gasto real do dia (~R$800 estimado)
- O endpoint antigo (`/advertising/advertisers/{id}/product_ads/items`) retornava R$41,23 para o Bangora às 14h; o novo endpoint retornou R$309,35 para o mesmo dia — diferença 7,5× que sugere acumulado de ~7 dias

**Raiz do problema:** o `date_from`/`date_to` no novo endpoint filtra quais anúncios retornar (ativos naquele intervalo), não o janela das métricas. As métricas retornadas são acumuladas (lifetime ou período da campanha).

## Goal

`ml_ads_products_cache` deve conter spend **correto e confiável** por produto — suficiente para o cálculo de Margem Líquida ser preciso.

## Success Criteria

- Bangora spend em 2026-05-22 bate com o painel ML Ads (tolerância ±5%)
- `useMLProductMargins` mostra margem realista (sem número -20% injustificado)
- Dados históricos de backfill marcados como inválidos / removidos
- Pipeline diário estável: sem acumulação de spend de dias anteriores

---

## Task 27-01 — Reverter sync-ads para endpoint antigo (produto-level)

**File:** `supabase/functions/sync-ads/index.ts`

**Problema:** A função usa o novo endpoint para buscar métricas por produto, mas ele não suporta filtro de data nas métricas.

**Fix:** Para a parte de `ml_ads_products_cache`, usar o endpoint antigo:
```
/advertising/advertisers/{advertiserId}/product_ads/items?limit=50&offset={offset}
```
com `api-version: 2`, sem parâmetros de data.

O endpoint antigo retorna a lista de todos os itens patrocinados com métricas do período atual (dia corrente acumulado até o momento do sync). Gravar tudo com `date = dateFrom` (o dia do job, normalmente hoje).

**O que manter do novo endpoint:** usar apenas para `ml_ads_daily_cache` (totais diários do advertiser) — verificar se o endpoint `/advertising/advertisers/{id}/product_ads/stats` suporta date_from/date_to para totais (alternativa mais confiável).

**Estrutura após fix:**
```typescript
// DAILY totals: manter como está (endpoint antigo também tem /stats com date filter)
// PRODUCT-level: reverter para /product_ads/items sem date filter
// Gravar com date = dateFrom (hoje)
```

**Importante:** remover o loop `for (const day of days)` para o produto-level — a chamada é única (sem filtro de data). O loop fica apenas se o daily também precisar.

---

## Task 27-02 — Limpar dados inválidos do backfill

**Supabase SQL:**

```sql
-- Remove todos os dados gravados pelo novo endpoint (spend inflado)
-- Mantém apenas dados gravados pelo endpoint antigo (ml-ads legado)
-- Na prática: limpar tudo, deixar o sync diário reescrever com dados corretos
DELETE FROM ml_ads_products_cache
WHERE synced_at > '2026-05-22 17:30:00+00';  -- após o início do backfill com endpoint novo
```

Verificar antes de executar: quantas linhas afeta e se a data/hora bate com o início do backfill.

---

## Task 27-03 — Cancelar jobs de backfill pendentes

**Supabase SQL:**

```sql
UPDATE sync_jobs
SET status = 'cancelled', error_msg = 'backfill com endpoint PADS incorreto — dados históricos indisponíveis', finished_at = NOW()
WHERE job_type = 'ads' AND status = 'pending';
```

Os backfills para datas históricas são inúteis — o endpoint novo retorna vazio para datas passadas. Cancelar para evitar que sobrescrevam dados corretos futuros.

---

## Task 27-04 — Deploy + validação

1. Deploy sync-ads v11
2. Invocar manualmente com `date_from = hoje, date_to = hoje` via Supabase Dashboard
3. Verificar:
   - Bangora spend bate com painel ML (tolerância ±5%)
   - spend total < R$2.000 (realista para conta de ~R$800/dia estimado)
   - `useMLProductMargins` mostra margem positiva para produtos lucrativos

---

## Execution Order

```
Wave 1 (independente):
  27-02: limpar dados inválidos
  27-03: cancelar backfills pendentes

Wave 2 (após limpeza):
  27-01: fix sync-ads endpoint

Wave 3 (após deploy):
  27-04: validação
```

## Nota sobre dados históricos

O ML PADS API **não expõe spend diário histórico por produto** através dos endpoints atuais documentados. Para ter série histórica real seria necessário:
- Usar o endpoint `/advertising/advertisers/{id}/product_ads/metrics` com `date_from`/`date_to` (se existir)
- Ou acumular snapshot diário (o sync diário às 00:00 UTC grava o spend do dia anterior completo)

Por ora, a meta é ter o **dia corrente correto**. Série histórica fica para fase futura quando o endpoint correto for identificado.
