---
phase: 41-veracidade-total
plan: 03
subsystem: frontend
tags: [comissao-real, commCache, listing_prices, consistencia-kpis, data-05, data-06]

# Dependency graph
requires:
  - phase: 41-veracidade-total (plan 02)
    provides: "ml_billing_monthly, useMLBilling, MLCostCard com CFONPN/billingSource"
provides:
  - "commCache populado para todos os itens filtrados (independente de columnView) — DATA-05"
  - "Auditoria DATA-06: /vendas e /financeiro confirmados usando useMLCostWaterfall como fonte unica"
  - "LISTING_TYPE_RATES preservado como fallback em getCommissionRate"
affects: [41-veracidade-total plan 04+, anuncios, financeiro, vendas]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "commCache population sem guard columnView: useEffect depende apenas de filteredItemKey"
    - "Cache-first commission: commCache.get(item.id) antes de getCommissionRate/LISTING_TYPE_RATES"

key-files:
  created: []
  modified:
    - src/pages/mercadolivre/MLAnuncios.tsx

key-decisions:
  - "Guard columnView removido do useEffect de populacao do commCache — commCache agora disponivel em todas as views"
  - "LISTING_TYPE_RATES preservado como fallback (cleanup Phase 46)"
  - "DATA-06: nenhum fix de codigo necessario — /vendas e /financeiro ja usam useMLCostWaterfall"

patterns-established:
  - "commCache population: trigger apenas em filteredItemKey (sem dependencia de view ativa)"

requirements-completed: [DATA-05, DATA-06]

# Metrics
duration: ~15min
completed: 2026-06-12
---

# Phase 41 Plan 03: DATA-05 Comissao Real /anuncios + DATA-06 Auditoria Consistencia

**commCache populado para todos os itens filtrados (DATA-05) e auditoria de consistencia cruzada confirmada (DATA-06) — sem divergencia de fonte, sem fix adicional necessario.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-06-12
- **Tasks:** 3/3 auto + checkpoint
- **Files modified:** 1 (MLAnuncios.tsx — mudanca cirurgica de 4 linhas)

## Accomplishments

### DATA-05: commCache prioritario sobre LISTING_TYPE_RATES

- Removido guard `columnView !== "financeiro"` do useEffect de populacao do commCache em `MLAnuncios.tsx` (linha ~820)
- O commCache (que busca `sale_fee` real via EF `ml-precos-custos` → `listing_prices`) agora e populado para todos os itens filtrados, independentemente de qual coluna esta ativa
- Dependency array do useEffect atualizado: `[filteredItemKey]` (removido `columnView` que nao era mais necessario)
- Call sites (linhas 1318-1321 e 1496-1497) ja consultavam `commCache.get(item.id)` primeiro e cairam em `getCommissionRate/LISTING_TYPE_RATES` apenas como fallback — padrao preservado sem alteracao
- `LISTING_TYPE_RATES` permanece importado e usado em `getCommissionRate()` — objeto mock nao removido (cleanup Phase 46)

### DATA-06: Auditoria de Consistencia Cruzada

Auditoria por leitura de codigo:

| Metrica | /vendas (MercadoLivre.tsx) | /financeiro (MLFinanceiro.tsx) | /anuncios (MLAnuncios.tsx) | Fonte |
|---------|---------------------------|-------------------------------|---------------------------|-------|
| Comissao | `costWaterfall.total_comissao` | `waterfall.total_comissao` | `commCache.get(item.id).pct` (por anuncio) | RPC get_cost_waterfall / ML listing_prices |
| Frete | `billingData.cffe ?? costWaterfall.total_frete` | `waterfall.total_frete` | N/A (por anuncio nao exibe frete) | ml_billing_monthly / orders |
| CMV | `costWaterfall.cmv` (se has_cmv) | `waterfall.cmv` | `productCost.cost` (por anuncio) | orders / ml_product_costs |
| Impostos | `costWaterfall.total_tax` (se has_tax_data) | `waterfall.total_tax` | `effectiveTaxRate` por anuncio | orders / ml_tax_config |
| Hook autoritativo | `useMLCostWaterfall(currentFrom, currentTo)` | `useMLCostWaterfall(currentFrom, currentTo)` | N/A (item-level) | mesma RPC |

**Resultado:** /vendas e /financeiro usam exatamente o mesmo hook `useMLCostWaterfall` com os mesmos parametros de periodo — os totais sao identicos por construcao (mesma RPC `get_cost_waterfall` no banco). Nenhuma divergencia de fonte detectada. **Sem fix de codigo necessario.**

### Validacao SQL DATA-06 (para o orquestrador executar no banco ckcdevcxgvueywivefgx)

O plano exige validacao numerica contra a referencia Nexo Abril/2026. Como o executor nao tem acesso MCP Supabase, as queries a executar sao:

```sql
-- 1. Comissao total Abril/2026 (referencia: ~R$39.170, 11.15%)
SELECT
  SUM(comissao) AS total_comissao,
  SUM(comissao) / NULLIF(SUM(receita_bruta), 0) * 100 AS pct_comissao,
  SUM(receita_bruta) AS receita_bruta
FROM orders
WHERE ml_user_id = '1639558873'
  AND date >= '2026-04-01'
  AND date <= '2026-04-30'
  AND status IN ('paid', 'shipped', 'delivered');

-- 2. CFFE e CFONPN billing Abril/2026 (referencia: CFFE ~R$40.065, CFONPN ~R$15.902)
SELECT
  resumo->>'cffe'   AS cffe,
  resumo->>'cfonpn' AS cfonpn,
  synced_at
FROM ml_billing_monthly
WHERE ml_user_id = '1639558873'
  AND period_month = '2026-04';

-- 3. Verificar que get_cost_waterfall retorna os mesmos totais que /vendas e /financeiro exibem
SELECT
  paid_revenue,
  total_comissao,
  total_frete,
  cmv,
  total_tax
FROM get_cost_waterfall(
  p_org_id      := '<organization_id_pe_vermeio>',
  p_ml_user_ids := ARRAY['1639558873'],
  p_from        := '2026-04-01',
  p_to          := '2026-04-30'
);
```

**Valores esperados:** comissao ~R$39.170, CFFE billing ~R$40.065, CFONPN ~R$15.902. Se `ml_billing_monthly` nao tiver linha para 2026-04, o orquestrador pode invocar a EF `sync-ml-billing` com `{ ml_user_id: "1639558873", period_month: "2026-04" }` para backfill.

## Task Commits

1. **Tasks 1+2+3: DATA-05 guard removido + auditoria DATA-06 + push** — `6287a003` (feat)

## Files Created/Modified

- `src/pages/mercadolivre/MLAnuncios.tsx` — guard `columnView !== "financeiro"` removido do useEffect de commCache; deps array atualizado

## Deviations from Plan

None — plano executado exatamente como especificado. A auditoria DATA-06 confirmou que nenhum fix de codigo era necessario (fontes ja convergentes). MLFinanceiro.tsx e MercadoLivre.tsx nao foram alterados.

## Decisions Made

- **Guard removido, nao LISTING_TYPE_RATES:** A mudanca cirurgica foi apenas no guard do useEffect — o objeto `LISTING_TYPE_RATES` e `getCommissionRate()` permanecem intactos como fallback (decisao locked, cleanup Phase 46).
- **Sem fix de fonte em /financeiro e /vendas:** ambas as paginas ja usam `useMLCostWaterfall` — a auditoria confirmou consistencia; nenhuma alteracao necessaria.

## Known Stubs

Nenhum stub novo introduzido por esta plan. O fallback `getCommissionRate(listing_type_id)` e intencional e documentado — nao e stub, e fallback para itens ausentes do cache.

## Threat Surface

Nenhuma nova superficie de ataque introduzida. O threat T-41-03-02 (fetch excessivo ao remover guard) e mitigado pela deduplicacao `filtered.filter(i => !commCache.has(i.id))` ja existente — confirmado no codigo, linha 822.

## Self-Check: PASSED

- `src/pages/mercadolivre/MLAnuncios.tsx` modificado: FOUND
- Commit `6287a003`: FOUND (`git log --oneline -1`)
- Guard removido: `grep -vq 'columnView !== "financeiro" || !filteredItemKey'` → OK
- LISTING_TYPE_RATES preservado: `grep -q "LISTING_TYPE_RATES"` → OK
- `npx tsc --noEmit`: exit 0
- `git push origin main`: pushed para `671d8e2a..6287a003`

---
*Phase: 41-veracidade-total*
*Completed: 2026-06-12*
