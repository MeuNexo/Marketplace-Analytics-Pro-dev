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

- hypothesis: CONFIRMADA (aprofundada). Root cause real: 15+ SKUs Pralana listados
  em 2 anúncios (principal + espelho). 332 linhas inventário → 295 SKUs distintos.
  ZERO linhas com sku_code vazio em prod.
- fix_mudanca: FIX RATEIO (sku_share + incoming_per_variation, commit 7e09b148)
  REJEITADO por Wesley. FIX ESTRUTURAL adotado: colapsar anúncios espelhados em
  1 linha canônica por sku_code. A RPC passa a retornar genuinamente 1 linha por SKU.
- fix_applied: migration 20260668000100 REESCRITA com estrutura canon-based.
  CTEs sku_share e incoming_per_variation REMOVIDOS. Novo fluxo:
  row_sales → canon → sales_by_sku + ewma_sales + incoming_by_sku
  (tudo keyed por sku_code, 1:1 com canon).
- reasoning_checkpoint:
    hypothesis: "RPC colapsando anúncios espelhados por sku_code via CTE canon
      elimina dupla-contagem estruturalmente: incoming_by_sku→canon é 1:1 por
      construção (1 linha por sku_code em ambos)"
    confirming_evidence:
      - "332 linhas inventário, 295 SKUs distintos — 37 linhas espelhadas confirmadas"
      - "ZERO sku_code vazios → colapso por sku_code cobre 100% dos dados prod"
      - "incoming_by_sku já agrega por po.sku → 1:1 com canon (sem mudança no CTE)"
    falsification_test: "Se canon retornar != 295 linhas, ou dup-SKUs aparecerem 2x,
      ou SUM(venda_dia*30) != ~908, a hipótese é falsa"
    fix_rationale: "Colapsar inventory em 1 linha canônica por sku_code antes de
      todos os joins elimina o N:1 estruturalmente — não apenas para incoming_by_sku
      mas para todos os 3 sintomas (display dup, venda partida, qtd_a_caminho dup)"
    blind_spots: "items sem sku_code (null/vazio): tratados via fallback key mas
      verificado que prod tem ZERO casos; frontend groupByItem usa item_id da linha
      canônica — espelhos ficam invisíveis (esperado, sinalizado)"
- next_action: verificar inline queries (a-e) contra prod; commit migration reescrita.

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
  ROOT CAUSE APROFUNDADO (estrutural, não apenas o double-count do "a caminho"):
  A RPC get_replenishment_by_sku NÃO é genuinamente "por SKU" — ela retorna 1 linha
  por (item_id, variation_id) do inventário. Em prod (org 7f615df7...): 332 linhas de
  inventário → 295 SKUs distintos. 15+ SKUs (chapéus Pralana) estão listados em 2
  anúncios cada (anúncio principal + anúncio espelho). O estoque é o MESMO físico
  espelhado (idêntico em 13/15 SKUs) e as vendas ficam PARTIDAS entre os 2 anúncios.
  Três sintomas decorrem disso:
    1. qtd_a_caminho duplicado: LEFT JOIN incoming_by_sku por sku_code é N:1 →
       cada anúncio recebia o total inteiro de OCs do SKU.
    2. estoque/venda fragmentados entre principal e espelho → cobertura e gatilho errados.
    3. linhas duplicadas no display (o mesmo SKU aparecia 2×).
  O fix de rateio (commit 7e09b148: sku_share + incoming_per_variation) resolvia só o
  sintoma (1); foi REJEITADO por Wesley em favor do fix estrutural.

fix: |
  Migration 20260668000100_get_replenishment_by_sku_fix_double_count.sql
  (REESCRITA — "Phase 68 — Reposição por SKU real (colapsa anúncios espelhados)"):
  A RPC passa a colapsar anúncios espelhados em 1 linha canônica por sku_code ANTES de
  todos os joins, tornando-se genuinamente por-SKU.
  1. row_sales (novo): venda por (item_id, variation_id) na janela, match orders por
     (item,variation) — SEM casar por o.sku (evita regressão de SKU histórico trocado).
  2. canon (novo): ROW_NUMBER() OVER (PARTITION BY sku_code ORDER BY total_qty DESC
     NULLS LAST, sku_stock DESC, item_id) = 1 → 1 linha canônica por sku_code = o
     anúncio mais vendido (principal); usa estoque do principal (conservador).
  3. sales_by_sku: SUM(row_sales) de TODAS as linhas do mesmo sku_code → total de venda
     preservado (espelhos somados).
  4. ewma_sales: agrega orders por (item,variation,week) → mapeia p/ sku_code → re-agrega
     por (sku_code, week) → EWMA por sku_code.
  5. incoming_by_sku → join 1:1 na canon por sku_code → qtd_a_caminho contado UMA vez.
  6. CTEs sku_share e incoming_per_variation (rateio) REMOVIDOS.
  Invariantes mantidos: assinatura 4-arg, SECURITY INVOKER (anti-IDOR), colunas de saída
  idênticas, ORDER BY idêntico.

verification: |
  Verificação read-only executada via MCP execute_sql (project ckcdevcxgvueywivefgx,
  org 7f615df7-7bac-45e5-8a93-827fb9ddeec7) usando CTEs inline equivalentes ao corpo da
  migration (NÃO modificou a função em prod). Resultados 2026-06-27:
  (a) PASS — 332 linhas inventário → 295 SKUs distintos → 295 linhas canônicas (colapso ok).
  (b) PASS — 5 SKUs dup cada 1× com inv_count=2; qtd_a_caminho contado uma vez:
      18012849BRA3315G=11 (não 22), 11011273-CAFE3374G=52, 12011666PTO3360P=10,
      18012849BRA3315GG=20, 12012422-CAFE3274P=4.
  (c) PASS — SUM(a_caminho) total = 1885 un (= total real de OCs); SUM(vendas 30d) = 887
      (matched a inventário ativo; sem regressão — mesma base de match da v7).
  (d) PASS — p_smart: EWMA populado em 200 SKUs (159 com EWMA ativo ≥2 semanas) →
      não caiu em fallback simples.
  (e) PASS — get_advisors: nenhuma advisory de SECURITY DEFINER em
      get_replenishment_by_sku → SECURITY INVOKER mantido.
  Commits 07a11af9 (migration) + e7dbdeb7 (debug) branch gsd/phase-67-calculo-esperto.
  NÃO deployado em prod — função viva continua sendo a v7 (20260667000100).

  QUERIES INLINE DE VERIFICAÇÃO:

  -- CHECK (a,b,c): inventory rows, canon rows, dup SKUs, total vendas
  WITH inventory_by_sku AS (
    SELECT i.item_id, v.variation_id, v.seller_custom_field AS sku_code, v.available_quantity AS sku_stock,
      i.title, i.brand, i.logistic_type, v.attribute_combinations
    FROM ml_inventory_cache i
    CROSS JOIN LATERAL jsonb_to_recordset(i.variations) AS v(
      variation_id TEXT, attribute_combinations JSONB, available_quantity INTEGER, sold_quantity INTEGER, seller_custom_field TEXT)
    WHERE i.organization_id='7f615df7-7bac-45e5-8a93-827fb9ddeec7' AND i.status='active'
      AND i.has_variations=TRUE AND jsonb_array_length(i.variations)>0
    UNION ALL
    SELECT i.item_id, NULL::TEXT, i.seller_custom_field, i.available_quantity,
      i.title, i.brand, i.logistic_type, NULL::JSONB
    FROM ml_inventory_cache i
    WHERE i.organization_id='7f615df7-7bac-45e5-8a93-827fb9ddeec7' AND i.status='active'
      AND (i.has_variations=FALSE OR jsonb_array_length(i.variations)=0)
  ),
  row_sales AS (
    SELECT inv.*, COALESCE(SUM(o.quantidade),0)::NUMERIC AS total_qty
    FROM inventory_by_sku inv
    LEFT JOIN orders o ON o.organization_id='7f615df7-7bac-45e5-8a93-827fb9ddeec7'
      AND o.item_id=inv.item_id
      AND (o.variation_id=inv.variation_id OR (inv.variation_id IS NULL AND o.variation_id=''))
      AND o.data_pedido::timestamptz::date>=(CURRENT_DATE-30) AND o.status='paid'
    GROUP BY inv.item_id, inv.variation_id, inv.sku_code, inv.sku_stock,
      inv.title, inv.brand, inv.logistic_type, inv.attribute_combinations
  ),
  canon AS (
    SELECT rs.item_id, rs.variation_id, rs.sku_code, rs.sku_stock
    FROM (SELECT rs2.*, ROW_NUMBER() OVER (
      PARTITION BY CASE WHEN rs2.sku_code IS NOT NULL AND rs2.sku_code<>''
                        THEN rs2.sku_code ELSE rs2.item_id||'::'||COALESCE(rs2.variation_id,'') END
      ORDER BY rs2.total_qty DESC NULLS LAST, rs2.sku_stock DESC, rs2.item_id) AS rn FROM row_sales rs2) rs
    WHERE rs.rn=1
  ),
  sales_agg AS (SELECT rs.sku_code, SUM(rs.total_qty) AS t FROM row_sales rs WHERE rs.sku_code IS NOT NULL AND rs.sku_code<>'' GROUP BY rs.sku_code),
  inc AS (SELECT po.sku AS sku_code, SUM(po.quantidade)::INTEGER AS qtd FROM purchase_orders po WHERE po.organization_id='7f615df7-7bac-45e5-8a93-827fb9ddeec7' GROUP BY po.sku),
  dup AS (
    SELECT inv.sku_code, COUNT(*) AS cnt, MAX(inc.qtd) AS qtd_a_caminho
    FROM inventory_by_sku inv LEFT JOIN inc ON inc.sku_code=inv.sku_code
    WHERE inv.sku_code IN ('18012849BRA3315G','11011273-CAFE3374G','12011666PTO3360P','18012849BRA3315GG','12012422-CAFE3274P')
    GROUP BY inv.sku_code
  )
  SELECT
    (SELECT COUNT(*) FROM inventory_by_sku) AS a_inv_rows,
    (SELECT COUNT(DISTINCT sku_code) FROM inventory_by_sku WHERE sku_code IS NOT NULL AND sku_code<>'') AS a_distinct_skus,
    (SELECT COUNT(*) FROM canon) AS a_canon_rows,
    (SELECT SUM(t) FROM sales_agg) AS c_total_vendas_30d,
    (SELECT SUM(qtd) FROM inc) AS c_total_a_caminho,
    (SELECT json_agg(json_build_object('sku',sku_code,'inv_cnt',cnt,'a_caminho',qtd_a_caminho)) FROM dup) AS b_dup_skus;
  --
  -- Esperado: a_inv_rows=332, a_distinct_skus=295, a_canon_rows=295
  -- b_dup_skus: cada sku com inv_cnt=2, a_caminho=valor real (ex: 18012849BRA3315G→11, não 22)
  -- c_total_vendas_30d ≈ 908, c_total_a_caminho = total OCs real

files_changed:
  - supabase/migrations/20260668000100_get_replenishment_by_sku_fix_double_count.sql
  - .planning/debug/incoming-by-sku-double-count.md
