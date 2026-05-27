---
phase: 29-vendas-publicidade-perf
type: context
---

# Phase 29 — Vendas + Publicidade: Performance Final

## Problema

Após Phase 28, o sync e os hooks de /financeiro estão rápidos.
Mas a página **Vendas (/)** e **Publicidade (/publicidade)** ainda carregam devagar para a conta Sandrini (alto volume).

### Gargalo 1 — useMLKPISummary (Vendas)

`useMLKPISummary` faz SELECT de TODAS as colunas de TODAS as orders do período no browser:

```typescript
const { data } = await supabase
  .from("orders")
  .select("receita_bruta, custo_unit, quantidade, frete, comissao, tax_amount")
  .eq("organization_id", orgId)
  .in("ml_user_id", resolvedMLUserIds)
  .gte("data_pedido", from)
  .lte("data_pedido", to);
  // Sem .limit()
  // Sem filtro de status — inclui cancelados/devolvidos
```

Para Sandrini com 1000+ orders/mês → 6000+ rows transferidos para o browser → JS itera 2x para calcular markup + taxas.

**Fix:** Criar RPC `get_kpi_summary` que agrega no Postgres → browser recebe 1 row.

### Gargalo 2 — ml-ads produtos (Publicidade)

Na leitura da cache de produtos, a edge function busca TODAS as linhas do período de `ml_ads_products_cache` para o ml_user_id, sem LIMIT:

```typescript
admin
  .from("ml_ads_products_cache")
  .select("item_id,title,thumbnail,impressions,clicks,spend,...")
  .eq("ml_user_id", mlUserId)
  .gte("date", dateFrom)
  .lte("date", dateTo)
  // sem LIMIT — 30 dias × N produtos = muitas rows
```

Depois faz aggregation em memória na edge function e faz `.slice(0, 50)`.

Para 30 dias × 500 produtos → 15.000 rows carregadas → aggregadas → apenas 50 usadas.

**Fix:** Adicionar `ORDER BY spend DESC` + `LIMIT 500` na query do DB. Edge function ainda pode agregar por item_id, mas trabalha com volume muito menor.

## Solução

### Plan 29-01 — get_kpi_summary RPC + hook refactor
- Migration: RPC `get_kpi_summary(p_org_id, p_user_ids, p_from, p_to)` — agrega no Postgres
- Refactor `useMLKPISummary.ts` — usa RPC, remove SELECT *

### Plan 29-02 — ml-ads products query fix
- Fix read path em `ml-ads/index.ts` — adiciona LIMIT 500 na query de produtos do cache

## Deploy

- Apply migration Supabase Dev (`ckcdevcxgvueywivefgx`)
- Deploy edge function `ml-ads` para Dev
- Commit + push (Vercel auto-deploy)
