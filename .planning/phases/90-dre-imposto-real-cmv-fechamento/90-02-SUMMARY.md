---
phase: 90-dre-imposto-real-cmv-fechamento
plan: 02
status: complete
completed: 2026-07-07
commits:
  - aac25a32  # migration schema (cost_full, custo_unit_cheio, get_cost_waterfall + cmv_cheio)
  - a436273e  # EFs sync-tiny-costs + recalc-order-costs
  - e9b37f0e  # migration backfill custo_unit_cheio
  - (fix)     # correção cmv_cheio fallback custo médio (commit no docs)
---

# 90-02 SUMMARY — Contrato de dados do CMV a preço de custo cheio

**Status:** ✅ COMPLETE — 2026-07-07. Schema + EFs + backfill em prod, provados.

## O que foi feito (Tasks 1-3 pelo executor, Task 4 deploy pelo orquestrador via MCP)
- **Migration `20260690000100_cmv_cheio_schema.sql`** (aac25a32) — colunas `ml_product_costs.cost_full` + `orders.custo_unit_cheio`; `get_cost_waterfall` recriada via DROP+CREATE (assinatura/filtros/fallback de paid_revenue idênticos) + coluna nova `cmv_cheio`. Confirmado em prod que a versão anterior era `SECURITY INVOKER` (default) e o corpo batia exatamente → zero regressão de comportamento.
- **EFs** (a436273e): `sync-tiny-costs` v15 (grava `cost` E `cost_full` sem colapsar; `cost` intocado) + `recalc-order-costs` v14 (carrega `cost_full` por SKU, escreve `custo_unit_cheio`). `verify_jwt` preservado (false / true respectivamente).
- **Migration backfill `20260690000200`** (e9b37f0e) — popula `orders.custo_unit_cheio` de `ml_product_costs.cost_full` por SKU, idempotente, respeitando org.

## Deploy (orquestrador, MCP, projeto ckcdevcxgvueywivefgx, ordem correta)
1. `apply_migration` schema ✅
2. `deploy_edge_function` sync-tiny-costs (v15) + recalc-order-costs (v14) ✅
3. Re-sync via `net.http_post` (Pattern B, vault `service_role_key`) → **`cost_full` populado em 510/634 SKUs (80%)**. 124 sem preço de custo no Tiny (revenda/incompleto → fallback). (1º disparo foi cold start sem gravar; 2º gravou.)
4. `apply_migration` backfill (após re-sync) ✅
5. **Prova cmv_cheio abril:** receita **309.475,91** · cmv (médio) **140.607,33** · **cmv_cheio 168.486,68** · 1141 pedidos. delta cheio−médio = **+27.879,35**.
6. **Anti-IDOR** `get_cost_waterfall`: org Thales + user_ids da Pé Vermeio → 0 (filtro por organization_id). ✅
7. `get_advisors` security+performance: nenhum issue novo referente a `cost_full`/`custo_unit_cheio`/`get_cost_waterfall` (todos os lints são pré-existentes). ✅

## ⚠️ DESVIO do plano (corrigido — corretude de dinheiro)
O plano especificava `cmv_cheio = COALESCE(SUM(o.custo_unit_cheio * o.quantidade), 0)` **cru**. Mas 124/634 SKUs não têm `cost_full` → suas linhas somariam **0** em `cmv_cheio` → **subestimaria o CMV → superestimaria o lucro** (direção errada p/ número que o Wesley concilia). Corrigido para **`COALESCE(SUM(COALESCE(o.custo_unit_cheio, o.custo_unit) * o.quantidade), 0)`** — fallback por linha para custo médio quando falta preço de custo cheio. Sem o fix, abril daria cmv_cheio 156.926; com o fix, 168.486 (completo). Aplicado em prod via migration follow-up `cmv_cheio_fallback_medio` (CREATE OR REPLACE, mesma assinatura); arquivo `20260690000100` no repo já reflete a versão final (fallback inline).

## Must-haves
- ✅ `cost_full` separado do custo médio; `orders.custo_unit_cheio` por linha.
- ✅ `get_cost_waterfall.cmv_cheio` disponível (com fallback médio); demais colunas/filtros/paid_revenue intocados; batch_upsert_orders intocado.
- ✅ Abril com `cmv_cheio > 0` (168.486,68) para a reconciliação do 90-04.
- ✅ SC2 (CMV cheio disponível) + SC4 (mapeado custo médio→cost, novo caminho cost_full→custo_unit_cheio→cmv_cheio).

## Notas p/ 90-03/90-04
- Reconciliação abril: receita 309.475,91 − imposto real (guia competência **maio** = 16.015,06, via `get_imposto_guia_by_competence('...','2026-05-01')`) − cmv_cheio 168.486,68 − comissão/frete/ads. Fechar contra a planilha do Wesley.
- Cobertura cost_full = 80%; selo de UI pode indicar "CMV a preço de custo cheio (fallback custo médio em ~20% dos SKUs sem preço cadastrado)".
