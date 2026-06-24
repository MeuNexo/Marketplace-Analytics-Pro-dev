# Phase 58 — Verificação (VERAC-07): re-auditoria por domínio

**Data:** 2026-06-24 · Org Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7` · seller `1639558873` · projeto `ckcdevcxgvueywivefgx`
**Método:** cada tool corrigida foi comparada contra a fonte-da-verdade do dashboard com SQL real (read-only). Repete o método da auditoria original (58-AUDIT.md).

> **Veredito geral: PASS.** Todos os domínios batem com a fonte-da-verdade. Os parciais (Full, mês-calendário, ads attributed) são rotulados, não afirmados como absolutos. 1 achado novo durante o re-teste (get_goals.gross_profit) foi corrigido inline.

---

## 1. ESTOQUE — PASS

| Achado original | Fix | Evidência (SQL real) |
|---|---|---|
| EST-1 get_inventory só pausados | default `status='active'` | 116 itens ativos / 1585 un. (não mais 50 pausados) |
| EST-2 ruptura por variação mascarada | `summarizeVariations` expõe qty=0 | Coturno `MLB4265421967`: item-level=33, 7 variações, **1 esgotada** (tamanho confirmado) — label via `attr.value` ("39 BR") |
| EST-3 só Full, sem rótulo | `label: "estoque Full (fulfillment) — não inclui CD/Tiny; não é total"` | 100% dos ativos com saldo = `fulfillment` |
| EST-6 sem agregado total | `summary{totalItems,totalUnits,active,paused,outOfStock,itemsWithSizeOutOfStock}` | **active_units = 1585** ≡ auditoria ("1.585 un.") |
| VERAC-04 frescura | `freshness = max(synced_at)` | `2026-06-24 07:00:04Z` |

## 2. VENDAS · MARGEM · ADS — PASS

| Achado | Fix | Evidência |
|---|---|---|
| VMA-1 get_ads_campaigns 100% zerado | neutralizada → só `{name,status}` + `performance_note` | `ml_ads_campaigns_cache` = 9 campanhas, **spend/roas/impr = 0** (confirma cache quebrado) |
| (gap) sem visão de ads confiável | nova `get_ads_account_summary` sobre `ml_ads_daily_cache` | 30d: spend **R$8.103,79**, attributed R$118.133, ROAS 14,58, freshness hoje 20:05 |
| VMA-2 faturamento 286k vs 296k | `get_sales_kpis` rotulado "receita de pedidos pagos" (fonte mantida p/ não regredir painel) | descrição inequívoca (teste) |
| VMA-3 partially_refunded excluído | nota explícita em `get_margin_summary` | teste |
| VMA-4/6/7 descrições ambíguas | "top 50 por gasto", "attributed = subconjunto", "waterfall sem tarifas ML" | testes |

## 3. FINANCEIRO — PASS (com defasagem sinalizada)

| Achado | Fix | Evidência |
|---|---|---|
| FIN-1/5 get_dre_monthly ciclo≠calendário | fonte trocada p/ `ml_billing_daily` agregado por mês-calendário | junho-calendário = **R$34.852,90** ≡ card DRE do painel (auditoria: R$34.853) |
| FIN-2 ml_billing_daily defasado | **migration de cron** de re-sync diário (escrita; apply = checkpoint) + tool expõe `coverage_until`/`freshness` | cobertura atual = 06-12 (defasado); a tool agora **sinaliza** isso em vez de afirmar junho como completo |
| FIN-3 cashflow horizonte | `saldo_hoje` nomeado + `horizon_label` | campos presentes (teste) |
| FIN-4 costs descrição errada | "saídas de caixa por categoria/mês — não é CMV nem fatura ML" | teste |

**Pré-requisitos do cron verificados:** vault tem `service_role_key` ✅; EF `sync-ml-billing` ACTIVE (v9) ✅; cron `billing-daily-resync` ainda não existe (sem conflito) ✅.

## 4. OPERACIONAL & SAÚDE — PASS

| Achado | Fix | Evidência |
|---|---|---|
| OPS-1 reputação sem tool | nova `get_reputation` (EF `ml-reputation` por ml_user_id, com userJwt) | EF `ml-reputation` ACTIVE (v10) ✅; path verificado por teste; **E2E só com Wesley logado** (service_role dá 401 por design) |
| OPS-2 metas sem tool | nova `get_goals` (ml_targets por `seller_id ∈ mlUserIds`) | meta junho **R$583.000** + lucro 9%; `ml_targets` SEM `organization_id` → anti-IDOR via seller_id é o único escopo seguro (confirmado) |
| OPS-3 get_claims campos mortos | remove `data_limite`/`solucao` + `{total,open,by_type}` | 60 claims, `data_limite`=0, `solucao`=0 (100% null confirmado) |
| OPS-4 get_health_score ordem errada | ordena por `snapshot_month DESC` | coluna `snapshot_month` existe ✅ |
| OPS-5 get_open_questions | descrição cita `UNANSWERED` | teste |

### Achado novo no re-teste (corrigido) — VERAC-07
- **get_goals.meta_lucro_pct retornava null:** lia `kpi_targets.lucro_pct`, mas a chave real em produção é `kpi_targets.gross_profit` (=9). Corrigido (commit `939cee1d`), `gross_profit` com `lucro_pct` como fallback. +1 teste (54 verdes).

---

## Estado técnico
- **192 testes verdes** na suíte (54 em `tools.ts`), **build TS ✓**, **deno check ✓** (index/loop/tools/prompt).
- **25 tools** declaradas; anti-IDOR mantido em todas (org/seller só do servidor); read-only.
- **userJwt** propagado `index → runChat → loop → dispatchTool` (B-1 do checker) — pré-requisito do `get_reputation`.

## Pendências do checkpoint (orquestrador/humano) — VERAC-07
1. **Deploy** da EF `nexo-chat` v5 (código Phase 58, 25 tools) — em prod está v4 (pré-58).
2. **Apply** da migration de cron `billing-daily-resync` (fecha FIN-2 de forma definitiva).
3. **Rotação obrigatória** de `GEMINI_API_KEY` e `SUPABASE_ACCESS_TOKEN` (expostos em chat).
4. **Validação E2E + aprovação do Wesley** (logado): `get_reputation` ao vivo + perguntas reais.

*Phase: 58-veracidade-completude-dados · VERAC-07 · 2026-06-24*
