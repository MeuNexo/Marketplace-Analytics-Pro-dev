---
phase: 58-veracidade-completude-dados
plan: "02"
subsystem: nexo-chat
tags: [ads, vendas, margem, veracidade, anti-idor, testes, neutralização]
dependencies:
  requires: [58-01]
  provides: [get_ads_account_summary, get_ads_campaigns-neutralizada, descricoes-inequivocas-vma]
  affects:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
tech_stack:
  added: []
  patterns: [paginação-range-agregado, roas-guard-divisão-por-zero, neutralização-tool-zerada]
key_files:
  created: []
  modified:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
decisions:
  - "get_ads_campaigns neutralizada: retorna só name+status+performance_note (sem spend/roas/impressions zerados)"
  - "get_ads_account_summary: nova tool agrega ml_ads_daily_cache com paginação .range() — anti-IDOR"
  - "ROAS guard: spend=0 → roas=null (não divide por zero)"
  - "status partially_refunded/shipped/delivered: RPCs compartilhadas com dashboard NÃO alteradas — limitação documentada nas descrições (sem regressão no painel)"
  - "Decisão status (D7): investigated que RPCs servem o dashboard (status IN 'paid','shipped','delivered' em todas as migrations) — corrigir exigiria validar número do painel; documentado nas descrições das tools em vez de alterar a RPC neste plano"
metrics:
  duration: ~4min
  completed: 2026-06-24
status: complete
---

# Phase 58 Plan 02: Vendas/Ads Inequívoco + get_ads_account_summary — Summary

**One-liner:** `get_ads_campaigns` neutralizada (só nome+status+aviso, sem zero enganoso); nova `get_ads_account_summary` agrega `ml_ads_daily_cache` com anti-IDOR; descrições de vendas/ads inequívocas; 36 testes verdes.

## What Was Built

### Task 1: Neutralizar get_ads_campaigns + adicionar get_ads_account_summary (VMA-1 / D5)

**Achados corrigidos:**

- **VMA-1 (crítico):** `get_ads_campaigns` lia `ml_ads_campaigns_cache` que está 100% zerada (sem coluna `date`) → Nexo diria "todas campanhas ROAS 0" (dado falso). **Neutralizada**: seleciona apenas `name` e `status`; retorno embrulhado em `{performance_note, campaigns}`. O `performance_note` explica que "gasto/ROAS por CAMPANHA não está disponível" e remete às outras tools. Sem `spend`, `roas`, `impressions` no retorno — modelo não infere zero como verdade.

- **VMA-6 / D5 (nova tool):** `get_ads_account_summary` adicionada. Agrega `ml_ads_daily_cache` por período com paginação `.range()` (igual ao padrão de `get_ads_by_product`). Anti-IDOR: `.eq('organization_id', orgId)` + `.in('ml_user_id', mlUserIds)` — ambos do servidor; `args.org_id/seller_id/ml_user_id` ignorados. Retorna `{period, spend, attributed_revenue, roas, impressions, clicks, freshness, note}`. `roas = attributed_revenue/spend` com guard divisão por zero (→ `null` quando `spend=0`). Campo `note` documenta que `attributed_revenue` é subconjunto do faturamento.

**Total de tools: 22 → 23.**

**Estrutura de retorno de `get_ads_campaigns`:**
```json
{
  "performance_note": "Sem dados de performance por campanha nesta base...",
  "campaigns": [{"name": "Campanha A", "status": "enabled"}, ...]
}
```

**Estrutura de retorno de `get_ads_account_summary`:**
```json
{
  "period": {"from": "2026-06-01", "to": "2026-06-24"},
  "spend": 1500.00,
  "attributed_revenue": 4800.00,
  "roas": 3.2,
  "impressions": 120000,
  "clicks": 3200,
  "freshness": "2026-06-24T10:00:00Z",
  "note": "attributed_revenue é receita atribuída a ads, subconjunto do faturamento — não é o total vendido."
}
```

### Task 2: Descrições inequívocas + testes (VMA-2/3/4/7 / D4/D6/D7)

**Descrições atualizadas (sem trocar a fonte/RPC — evita regressão no painel):**

| Tool | Antes | Depois |
|------|-------|--------|
| `get_sales_kpis` | "KPIs de vendas do período" | "KPIs de receita de pedidos PAGOS; pode divergir do painel /vendas (ml_daily_cache ~R$296k vs ~R$286k)" |
| `get_ads_by_product` | "Gasto/ROAS/CTR/CPC por item" | "Top 50 produtos por gasto — NÃO é o total da conta; para total use get_ads_account_summary. attributed_revenue é subconjunto do faturamento" |
| `get_day_kpis` | "Waterfall de custo/receita" | "Waterfall de pedidos. NÃO inclui tarifas fixas do ML (CFFE/CFONPN/PADS) — para DRE use get_dre_monthly" |
| `get_margin_summary` | "DRE consolidado" | "DRE de pedidos PAGOS — pode divergir do painel; pedidos partially_refunded (~21) podem não estar incluídos" |

**Decisão sobre status (VMA-3 / D7):**

Investigado: todos as RPCs de margem/vendas/cashflow usam `status IN ('paid','shipped','delivered')`. Confirmado que essas RPCs **servem o dashboard atual** (mesmos filtros). `shipped`/`delivered` são estados mortos no ML (não geram resultados práticos). `partially_refunded` (~21 pedidos) é excluído da receita — limitação alinhada ao painel.

**Decisão (documentada):** NÃO alterar a RPC neste plano para evitar regressão no painel. Limitação documentada nas descrições de `get_margin_summary` e `get_sales_kpis`. Recomenda-se quick task separada para validar se `partially_refunded` deve ser incluído nos cálculos (com verificação de impacto no painel).

**tools.test.ts — 36 testes (eram 27):**

9 novos testes adicionados:
1. Contagem de tools = 23 (inclui `get_ads_account_summary`)
2. `get_ads_account_summary` anti-IDOR: `.eq(organization_id, orgId)` + `.in(ml_user_id, mlUserIds)` + ignora EVIL_ARGS
3. `get_ads_account_summary` retorna `spend/attributed_revenue/roas/impressions/clicks/period/freshness/note`
4. `get_ads_account_summary` roas=null quando spend=0 (guard divisão por zero)
5. `get_ads_campaigns` neutralizada: retorna `performance_note` sem `spend`/`roas`/`impressions`
6. `get_sales_kpis` description menciona "pagos" + divergência do painel (VMA-2/D4)
7. `get_ads_by_product` description cita "top 50" + remete `get_ads_account_summary` (VMA-4/D6)
8. `get_day_kpis` description alerta sobre tarifas fixas ML + remete `get_dre_monthly` (VMA-7/D6)
9. `get_margin_summary` description menciona "pagos" + `partially_refunded` (VMA-3/D7)
10. (bonus) `get_ads_campaigns` description alerta "sem dados de performance" (VMA-1/D5)

## Verification

- `deno check supabase/functions/nexo-chat/tools.ts` — PASS (verde)
- `npx vitest run supabase/functions/nexo-chat/tools.test.ts` — PASS: 36 testes, 1 arquivo, 0 falhas

## Deviations from Plan

None — plano executado exatamente como escrito.

## Known Stubs

None. Toda lógica é real (queries a `ml_ads_daily_cache`/`ml_ads_campaigns_cache` via `sb`).

## Threat Flags

None. Nenhuma nova superfície de rede ou mutação. Read-only por construção (T-58-02-RO).

## STRIDE Threat Register — Status

| Threat ID | Status |
|-----------|--------|
| T-58-02-IDOR | MITIGADO — `get_ads_account_summary` usa `.eq(organization_id)+.in(ml_user_id)` do servidor; test cobre |
| T-58-02-ZERO | MITIGADO — `get_ads_campaigns` não retorna métrica zerada; `performance_note` explícita |
| T-58-02-RO | MITIGADO — só `select()`; sem mutação |

## Self-Check: PASSED

- FOUND: supabase/functions/nexo-chat/tools.ts
- FOUND: supabase/functions/nexo-chat/tools.test.ts
- FOUND commit 604a0e50 (Task 1 — neutralizar + get_ads_account_summary)
- FOUND commit ddeb1b81 (Task 2 — descrições + testes)
