---
slug: incoming-by-sku-double-count
status: fixing
trigger: |
  Dupla-contagem do "a caminho" (qtd_a_caminho) na RPC get_replenishment_by_sku. O CTE
  incoming_by_sku agrega por SKU (GROUP BY po.sku) e o join com inventory_by_sku é por
  sku_code; quando o mesmo SKU está em 2+ anúncios (item_id distintos) cada anúncio recebe
  a quantidade a caminho INTEIRA — duplica no display e subtrai em dobro de
  compra_sugerida / gatilho_ativo. Corrigir a duplicação sem regressão no caso de SKU em
  um anúncio só.
created: 2026-06-26
updated: 2026-06-26
---

# Debug: incoming-by-sku-double-count

## Symptoms

- **Expected behavior:** A quantidade "a caminho" (purchase_orders em trânsito) de um SKU
  deve ser descontada do estoque efetivo UMA vez no total, não por anúncio. Quando o mesmo
  SKU aparece em 2 anúncios, a soma de qtd_a_caminho entre as linhas não pode exceder o
  total real de OCs daquele SKU.
- **Actual behavior:** Cada linha (item_id, variation_id) que compartilha o mesmo sku_code
  recebe a qtd_a_caminho INTEIRA do SKU. Ex.: SKU em 2 anúncios (MLB4587613312 +
  MLB4780141967), ambos com 10 OCs em trânsito → cada linha mostra 10 (display duplicado) e
  cada linha desconta 10 no compra_sugerida e no gatilho_ativo → subcompra.
- **Error messages:** Nenhum erro — resultado numérico incorreto (silencioso).
- **Timeline:** Introduzido na Phase 65 (estoque a chegar, migration 20260665000100).
  Persiste na RPC v7 atual (p_smart, migration 20260667000100). Identificado pós-deploy.
- **Reproduction:** Chamar get_replenishment_by_sku para a org e filtrar SKUs presentes em
  2+ anúncios; comparar SUM(qtd_a_caminho) das linhas do SKU vs total real de OCs em
  purchase_orders para o mesmo sku.

## Context

- Projeto: garment-glow-test. Supabase prod project: `ckcdevcxgvueywivefgx`.
- Branch: `gsd/phase-67-calculo-esperto`.
- RPC mais recente EM PROD = migration `20260667000100_get_replenishment_by_sku_smart.sql`
  (assinatura 4-arg com p_smart BOOLEAN; o 3-arg antigo foi DROPADO no checkpoint da Phase 67
  para evitar overload ambíguo). A migration 20260665 documenta o CTE original.
- CTE relevante (visto no código): `incoming_by_sku` faz `GROUP BY po.sku` →
  `LEFT JOIN incoming_by_sku inc ON inc.sku_code = inv.sku_code`. inventory_by_sku tem 1
  linha por (item_id, variation_id), então SKU repetido em N anúncios → N joins à mesma
  linha de a-caminho.
- Restrição: corrigir sem regressão no caso de SKU em 1 anúncio só (comportamento atual já
  correto nesse caso). Decisão Wesley (Phase 65): descontar TODA a qtd a caminho do SKU.

## Current Focus

- hypothesis: CONFIRMADA. LEFT JOIN incoming_by_sku em sku_code é N:1 quando
  inventory_by_sku tem múltiplas linhas para o mesmo sku_code. Cada linha
  (item_id, variation_id) recebe qtd_a_caminho INTEIRA — N vezes no display, N vezes
  na dedução de compra_sugerida.
- fix_applied: migration 20260668000100_get_replenishment_by_sku_fix_double_count.sql
  — adiciona CTEs sku_share + incoming_per_variation para distribuição proporcional
  por estoque; base CTE passa a JOIN em (item_id, variation_id) via 1:1.
- next_action: deploy da migration em prod (aguarda autorização Wesley) e verificação
  visual em /compras.

## Evidence

- timestamp: 2026-06-26 — Leitura do código (migration 20260665000100, linhas 112-123 e
  244-245): incoming_by_sku agrega por SKU; join base↔incoming é por sku_code, não por
  (item_id, variation_id). Confirma o mecanismo de duplicação no nível de leitura de código.
- timestamp: 2026-06-26 — Leitura da RPC v7 (20260667000100): mesmo padrão persiste na
  versão mais recente. Linha 253: LEFT JOIN incoming_by_sku inc ON inc.sku_code = inv.sku_code.
  incoming_by_sku (linhas 83-88) = GROUP BY po.sku. inventory_by_sku (linhas 53-72) = 1 row
  per (item_id, variation_id). Mecanismo de dupla-contagem idêntico.
- timestamp: 2026-06-26 — Leitura do frontend hook (useReplenishmentBySku.ts, linha 181):
  groupByItem acumula total_a_caminho += row.qtd_a_caminho para cada variação do anúncio.
  Se 2 item_ids diferentes compartilham o mesmo SKU, AMBOS mostram o total inteiro na UI.
  Se 2 variações do mesmo item compartilham SKU, o groupByItem soma duplo.
- timestamp: 2026-06-26 — Reasoning checkpoint registrado. Hipótese falsificável, evidências
  diretas (código), fix address root cause (join 1:1 via incoming_per_variation).

## Eliminated

(nenhuma)

## Resolution

root_cause: |
  base CTE da RPC get_replenishment_by_sku (v7, migration 20260667000100) faz
  LEFT JOIN incoming_by_sku inc ON inc.sku_code = inv.sku_code.
  incoming_by_sku tem 1 linha por sku_code (GROUP BY po.sku).
  inventory_by_sku tem 1 linha por (item_id, variation_id).
  Quando N variações/anúncios compartilham o mesmo sku_code, o join retorna N cópias
  da mesma linha de qtd_a_caminho → cada anúncio recebe o total inteiro do SKU.
  Impacto: display duplicado (N×qtd exibido total) + compra_sugerida e gatilho_ativo
  subtraem N× a qtd real → subcompra (compra_sugerida suprimida mais do que deveria).

fix: |
  Migration 20260668000100_get_replenishment_by_sku_fix_double_count.sql:
  1. incoming_by_sku: mantida como base (total por SKU), campo renomeado para
     qtd_a_caminho_total.
  2. sku_share (novo CTE): conta n_var e soma total_stock por sku_code a partir de
     inventory_by_sku (apenas sku_code não-nulo/não-vazio).
  3. incoming_per_variation (novo CTE): distribui qtd_a_caminho proporcional ao
     estoque de cada variação. Regras:
       - n_var = 1 → inteiro (sem rateio; sem regressão SKU em 1 anúncio)
       - total_stock = 0 → divisão igual (FLOOR para não exceder total)
       - total_stock > 0 → ROUND(total * sku_stock / total_stock)
       - sku_code NULL/vazio → 0
  4. base CTE: LEFT JOIN incoming_per_variation ipv ON ipv.item_id = inv.item_id
     AND ipv.variation_id IS NOT DISTINCT FROM inv.variation_id
     → join 1:1, sem duplicação. SECURITY INVOKER mantido.

verification: pendente (deploy em prod aguarda autorização Wesley)

files_changed:
  - supabase/migrations/20260668000100_get_replenishment_by_sku_fix_double_count.sql
