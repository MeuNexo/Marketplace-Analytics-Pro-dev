-- ============================================================
-- Phase 68 — Reposição por SKU real (colapsa anúncios espelhados) + PERF sob RLS
--
-- ROOT CAUSE 1 (estrutural): a RPC não era genuinamente por-SKU — 1 linha por
--   (item_id,variation_id). 15+ SKUs Pralana em 2 anúncios (principal+espelho) com
--   estoque espelhado e vendas partidas → a-caminho dobrado + estoque dobrado +
--   linha duplicada. Fix: colapsa em 1 linha canônica por sku_code (CTEs row_sales +
--   canon via ROW_NUMBER por mais-vendido; sales/ewma/incoming re-keyed em canon).
--
-- ROOT CAUSE 2 (performance sob RLS): a versão estrutural ainda usava ~7.4k subqueries
--   correlacionadas no CTE params (295 linhas × ~25) + LATERAL de custo por linha (295).
--   Como postgres (RLS off) rodava em ~0,9s, mas sob o role `authenticated` cada subquery
--   re-executa com a policy is_org_member → smart=true ESTOURAVA o statement_timeout de 8s
--   → /compras não carregava. Fix: pré-carregar replenishment_params e ml_product_costs
--   UMA vez (CTEs params_lookup / costs_by_sku / costs_by_item MATERIALIZED) e resolver a
--   precedência (sku>fornecedor>marca>global) via LEFT JOINs. Resultado: smart=true sob
--   RLS caiu de >8s (timeout) para ~2,5s.
--
-- INVARIANTES: SECURITY INVOKER (anti-IDOR), assinatura 4-arg, colunas de saída e ORDER BY
--   idênticos, #variable_conflict use_column. Precedência de params e fallback de custo
--   preservados (mesma semântica das subqueries, agora via join+COALESCE).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN);

CREATE OR REPLACE FUNCTION public.get_replenishment_by_sku(
  p_org_id            UUID,
  p_sales_window_days INTEGER DEFAULT 30,
  p_demand_multiplier NUMERIC  DEFAULT 1.0,
  p_smart             BOOLEAN  DEFAULT FALSE
)
RETURNS TABLE (
  item_id TEXT, variation_id TEXT, title TEXT, brand TEXT, sku_code TEXT,
  attribute_combinations JSONB, logistic_type TEXT, sku_stock INTEGER,
  venda_dia NUMERIC, cobertura_atual NUMERIC, ponto_reposicao NUMERIC, alvo NUMERIC,
  compra_sugerida INTEGER, valor_estimado NUMERIC, custo_ausente BOOLEAN, sem_giro BOOLEAN,
  gatilho_ativo BOOLEAN, param_lead_time INTEGER, param_cobertura INTEGER, param_safety INTEGER,
  param_moq INTEGER, param_pack INTEGER, param_origem TEXT, qtd_a_caminho INTEGER,
  data_proxima_chegada DATE, venda_dia_origem TEXT, lead_time_origem TEXT, tendencia TEXT,
  fator_sazonal NUMERIC, lead_time_real INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_cutoff DATE    := CURRENT_DATE - p_sales_window_days;
  v_smart  BOOLEAN := COALESCE(p_smart, FALSE);
BEGIN
  RETURN QUERY
  WITH
  inventory_by_sku AS MATERIALIZED (
    SELECT
      i.item_id, i.title, i.brand, i.logistic_type,
      v.variation_id, v.attribute_combinations,
      v.available_quantity AS sku_stock, v.seller_custom_field AS sku_code
    FROM ml_inventory_cache i
    CROSS JOIN LATERAL jsonb_to_recordset(i.variations) AS v(
      variation_id TEXT, attribute_combinations JSONB,
      available_quantity INTEGER, sold_quantity INTEGER, seller_custom_field TEXT
    )
    WHERE i.organization_id = p_org_id AND i.status = 'active'
      AND i.has_variations = TRUE AND jsonb_array_length(i.variations) > 0
    UNION ALL
    SELECT
      i.item_id, i.title, i.brand, i.logistic_type,
      NULL::TEXT, NULL::JSONB, i.available_quantity, i.seller_custom_field
    FROM ml_inventory_cache i
    WHERE i.organization_id = p_org_id AND i.status = 'active'
      AND (i.has_variations = FALSE OR jsonb_array_length(i.variations) = 0)
  ),
  -- Pré-carga ÚNICA dos parâmetros (elimina ~7.4k subqueries correlacionadas sob RLS)
  params_lookup AS MATERIALIZED (
    SELECT rp.scope, rp.scope_value, rp.lead_time_dias, rp.meta_cobertura_dias,
           rp.safety_days, rp.moq, rp.pack_multiple
    FROM replenishment_params rp WHERE rp.organization_id = p_org_id
  ),
  -- Pré-carga ÚNICA dos custos (elimina LATERAL por linha sob RLS)
  costs_by_sku AS MATERIALIZED (
    SELECT DISTINCT ON (c.seller_sku) c.seller_sku, c.cost
    FROM ml_product_costs c
    WHERE c.organization_id = p_org_id AND c.seller_sku IS NOT NULL AND c.seller_sku <> ''
    ORDER BY c.seller_sku, c.updated_at DESC NULLS LAST
  ),
  costs_by_item AS MATERIALIZED (
    SELECT DISTINCT ON (c.item_id) c.item_id, c.cost
    FROM ml_product_costs c
    WHERE c.organization_id = p_org_id
    ORDER BY c.item_id, c.updated_at DESC NULLS LAST
  ),
  row_sales AS (
    SELECT
      inv.item_id, inv.variation_id, inv.title, inv.brand, inv.logistic_type,
      inv.attribute_combinations, inv.sku_code, inv.sku_stock,
      COALESCE(SUM(o.quantidade), 0)::NUMERIC AS total_qty
    FROM inventory_by_sku inv
    LEFT JOIN orders o
      ON o.organization_id = p_org_id AND o.item_id = inv.item_id
      AND (o.variation_id = inv.variation_id OR (inv.variation_id IS NULL AND o.variation_id = ''))
      AND o.data_pedido::timestamptz::date >= v_cutoff AND o.status = 'paid'
    GROUP BY inv.item_id, inv.variation_id, inv.title, inv.brand, inv.logistic_type,
      inv.attribute_combinations, inv.sku_code, inv.sku_stock
  ),
  canon AS (
    SELECT
      rs.item_id, rs.variation_id, rs.title, rs.brand, rs.logistic_type,
      rs.attribute_combinations, rs.sku_code, rs.sku_stock
    FROM (
      SELECT rs2.*,
        ROW_NUMBER() OVER (
          PARTITION BY
            CASE WHEN rs2.sku_code IS NOT NULL AND rs2.sku_code <> ''
                 THEN rs2.sku_code
                 ELSE rs2.item_id || '::' || COALESCE(rs2.variation_id, '')
            END
          ORDER BY rs2.total_qty DESC NULLS LAST, rs2.sku_stock DESC, rs2.item_id
        ) AS rn
      FROM row_sales rs2
    ) rs
    WHERE rs.rn = 1
  ),
  sales_by_sku AS (
    SELECT rs.sku_code,
      SUM(rs.total_qty) / NULLIF(p_sales_window_days::NUMERIC, 0) AS avg_daily
    FROM row_sales rs
    WHERE rs.sku_code IS NOT NULL AND rs.sku_code <> ''
    GROUP BY rs.sku_code
  ),
  incoming_by_sku AS (
    SELECT po.sku AS sku_code, SUM(po.quantidade)::INTEGER AS qtd_a_caminho,
      COALESCE(MIN(po.data_entrega) FILTER (WHERE po.data_entrega >= CURRENT_DATE),
        MIN(po.data_entrega)) AS data_proxima_chegada
    FROM purchase_orders po WHERE po.organization_id = p_org_id GROUP BY po.sku
  ),
  fornecedor_by_sku AS (
    SELECT DISTINCT ON (sub.sku_code) sub.sku_code, sub.fornecedor
    FROM (
      SELECT po.sku AS sku_code, po.fornecedor, SUM(po.quantidade) AS total_qty,
        MAX(COALESCE(po.data_entrega, po.data_pedido)) AS ultima_data
      FROM public.purchase_orders po
      WHERE po.organization_id = p_org_id AND po.fornecedor IS NOT NULL
      GROUP BY po.sku, po.fornecedor
    ) sub ORDER BY sub.sku_code, sub.total_qty DESC, sub.ultima_data DESC NULLS LAST
  ),
  ewma_sales AS (
    SELECT sku_week.sku_code,
      SUM(sku_week.week_qty * POWER(0.7, sku_week.week_offset)) / NULLIF(SUM(POWER(0.7, sku_week.week_offset)), 0) / 7.0 AS ewma_daily,
      COUNT(*) AS weeks_with_sales,
      SUM(sku_week.week_qty * POWER(0.7, sku_week.week_offset)) FILTER (WHERE sku_week.week_offset < 4)
        / NULLIF(SUM(POWER(0.7, sku_week.week_offset)) FILTER (WHERE sku_week.week_offset < 4), 0) / 7.0 AS ewma_recent_daily,
      SUM(sku_week.week_qty * POWER(0.7, sku_week.week_offset)) FILTER (WHERE sku_week.week_offset BETWEEN 4 AND 11)
        / NULLIF(SUM(POWER(0.7, sku_week.week_offset)) FILTER (WHERE sku_week.week_offset BETWEEN 4 AND 11), 0) / 7.0 AS ewma_older_daily
    FROM (
      SELECT inv.sku_code, var_wk.week_offset, SUM(var_wk.week_qty) AS week_qty
      FROM inventory_by_sku inv
      JOIN (
        SELECT o2.item_id, o2.variation_id,
          FLOOR(EXTRACT(EPOCH FROM (DATE_TRUNC('week', CURRENT_DATE::date) - DATE_TRUNC('week', o2.data_pedido::date))) / (7 * 86400))::INTEGER AS week_offset,
          SUM(o2.quantidade) AS week_qty
        FROM orders o2
        WHERE o2.organization_id = p_org_id AND v_smart
          AND o2.data_pedido::date >= CURRENT_DATE - 84 AND o2.status = 'paid'
        GROUP BY o2.item_id, o2.variation_id,
          FLOOR(EXTRACT(EPOCH FROM (DATE_TRUNC('week', CURRENT_DATE::date) - DATE_TRUNC('week', o2.data_pedido::date))) / (7 * 86400))::INTEGER
      ) var_wk ON var_wk.item_id = inv.item_id
             AND (var_wk.variation_id = inv.variation_id OR (inv.variation_id IS NULL AND var_wk.variation_id = ''))
      WHERE inv.sku_code IS NOT NULL AND inv.sku_code <> ''
      GROUP BY inv.sku_code, var_wk.week_offset
    ) sku_week
    GROUP BY sku_week.sku_code
  ),
  seasonal_index AS (
    WITH brand_by_item AS (
      SELECT DISTINCT mic.item_id, mic.brand FROM ml_inventory_cache mic
      WHERE mic.organization_id = p_org_id AND mic.brand IS NOT NULL AND mic.brand <> '' AND v_smart
    ),
    monthly_raw AS (
      SELECT b.brand AS brand, EXTRACT(MONTH FROM o.data_pedido::date)::INTEGER AS mes,
        SUM(o.quantidade) / NULLIF(COUNT(DISTINCT EXTRACT(YEAR FROM o.data_pedido::date)::INTEGER), 0) AS avg_qty_month
      FROM orders o INNER JOIN brand_by_item b ON b.item_id = o.item_id
      WHERE o.organization_id = p_org_id AND o.status = 'paid' AND o.data_pedido::date >= CURRENT_DATE - 730
      GROUP BY b.brand, EXTRACT(MONTH FROM o.data_pedido::date)::INTEGER
    ),
    stats AS (
      SELECT mr.brand AS brand, mr.mes AS mes, mr.avg_qty_month AS avg_qty_month,
        AVG(mr.avg_qty_month) OVER (PARTITION BY mr.brand) AS brand_global_avg,
        COUNT(*) OVER (PARTITION BY mr.brand) AS months_covered
      FROM monthly_raw mr
    )
    SELECT st.brand AS brand,
      CASE WHEN st.months_covered >= 12 THEN GREATEST(0.5, LEAST(2.5, st.avg_qty_month / NULLIF(st.brand_global_avg, 0))) ELSE 1.0 END AS fator_sazonal,
      (st.months_covered >= 12) AS sazonal_ativa
    FROM stats st WHERE st.mes = EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER
  ),
  lead_time_by_fornecedor AS (
    SELECT po.fornecedor,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY (po.data_entrega - po.data_pedido)))::INTEGER AS median_lead_days,
      COUNT(*) AS oc_count
    FROM purchase_orders po
    WHERE po.organization_id = p_org_id AND v_smart
      AND po.fornecedor IS NOT NULL AND po.fornecedor <> ''
      AND po.data_entrega IS NOT NULL AND po.data_pedido IS NOT NULL
      AND po.data_entrega >= po.data_pedido
    GROUP BY po.fornecedor
  ),
  sales_smart AS (
    SELECT c.sku_code, c.item_id, c.variation_id, c.brand,
      CASE
        WHEN v_smart AND es.ewma_daily IS NOT NULL AND es.weeks_with_sales >= 2 AND si.sazonal_ativa THEN es.ewma_daily * si.fator_sazonal
        WHEN v_smart AND es.ewma_daily IS NOT NULL AND es.weeks_with_sales >= 2 THEN es.ewma_daily
        ELSE COALESCE(sbs.avg_daily, 0)
      END AS avg_daily,
      CASE
        WHEN v_smart AND es.weeks_with_sales >= 2 AND si.sazonal_ativa THEN 'ewma_sazonal'
        WHEN v_smart AND es.weeks_with_sales >= 2 THEN 'ewma'
        ELSE 'simples'
      END AS venda_dia_origem,
      es.ewma_recent_daily, es.ewma_older_daily,
      si.fator_sazonal AS si_fator_sazonal, si.sazonal_ativa AS si_sazonal_ativa
    FROM canon c
    LEFT JOIN sales_by_sku sbs ON sbs.sku_code = c.sku_code
    LEFT JOIN ewma_sales es ON es.sku_code = c.sku_code
    LEFT JOIN seasonal_index si ON si.brand = c.brand
  ),
  params AS (
    SELECT c.sku_code, c.item_id, c.variation_id,
      COALESCE(
        CASE WHEN v_smart AND lf.median_lead_days IS NOT NULL AND lf.oc_count >= 2 THEN lf.median_lead_days ELSE NULL END,
        p_sku.lead_time_dias, p_forn.lead_time_dias, p_marca.lead_time_dias, p_global.lead_time_dias, 30
      ) AS lead_time_dias,
      COALESCE(p_sku.meta_cobertura_dias, p_forn.meta_cobertura_dias, p_marca.meta_cobertura_dias, p_global.meta_cobertura_dias, 60) AS meta_cobertura_dias,
      COALESCE(p_sku.safety_days, p_forn.safety_days, p_marca.safety_days, p_global.safety_days, 7) AS safety_days,
      COALESCE(p_sku.moq, p_forn.moq, p_marca.moq, p_global.moq, 1) AS moq,
      COALESCE(p_sku.pack_multiple, p_forn.pack_multiple, p_marca.pack_multiple, p_global.pack_multiple, 1) AS pack_multiple,
      CASE
        WHEN p_sku.scope IS NOT NULL THEN 'sku'
        WHEN forn.fornecedor IS NOT NULL AND p_forn.scope IS NOT NULL THEN 'fornecedor'
        WHEN p_marca.scope IS NOT NULL THEN 'marca'
        ELSE 'global'
      END AS param_origem,
      lf.median_lead_days AS lead_time_real, lf.oc_count AS lead_time_oc_count
    FROM canon c
    LEFT JOIN fornecedor_by_sku forn ON forn.sku_code = c.sku_code
    LEFT JOIN lead_time_by_fornecedor lf ON lf.fornecedor = forn.fornecedor
    LEFT JOIN params_lookup p_sku    ON p_sku.scope = 'sku'        AND p_sku.scope_value = COALESCE(c.sku_code, '')
    LEFT JOIN params_lookup p_forn   ON p_forn.scope = 'fornecedor' AND p_forn.scope_value = forn.fornecedor
    LEFT JOIN params_lookup p_marca  ON p_marca.scope = 'marca'    AND p_marca.scope_value = COALESCE(c.brand, '')
    LEFT JOIN params_lookup p_global ON p_global.scope = 'global'
  ),
  base AS (
    SELECT
      c.item_id, c.variation_id, c.title, c.brand, c.sku_code,
      c.attribute_combinations, c.logistic_type, c.sku_stock,
      COALESCE(inc.qtd_a_caminho, 0)::INTEGER AS qtd_a_caminho,
      inc.data_proxima_chegada,
      ss.avg_daily * p_demand_multiplier AS venda_dia,
      CASE WHEN ss.avg_daily * p_demand_multiplier > 0 THEN c.sku_stock::NUMERIC / (ss.avg_daily * p_demand_multiplier) ELSE NULL END AS cobertura_atual,
      ss.avg_daily * p_demand_multiplier * (pr.lead_time_dias + pr.safety_days)::NUMERIC AS ponto_reposicao,
      ss.avg_daily * p_demand_multiplier * (pr.meta_cobertura_dias + pr.safety_days)::NUMERIC AS alvo,
      CASE
        WHEN ss.avg_daily = 0 THEN 0
        WHEN (c.sku_stock + COALESCE(inc.qtd_a_caminho, 0))::NUMERIC > ss.avg_daily * p_demand_multiplier * (pr.lead_time_dias + pr.safety_days)::NUMERIC THEN 0
        ELSE GREATEST(CEIL(GREATEST(0, ss.avg_daily * p_demand_multiplier * (pr.meta_cobertura_dias + pr.safety_days)::NUMERIC - (c.sku_stock + COALESCE(inc.qtd_a_caminho, 0))::NUMERIC) / NULLIF(pr.pack_multiple, 0)) * pr.pack_multiple, pr.moq)::INTEGER
      END AS compra_sugerida,
      COALESCE(clk.cost, cli.cost) AS cost_val,
      pr.lead_time_dias, pr.meta_cobertura_dias, pr.safety_days, pr.moq, pr.pack_multiple, pr.param_origem,
      ss.venda_dia_origem, ss.ewma_recent_daily, ss.ewma_older_daily, ss.si_fator_sazonal, ss.si_sazonal_ativa,
      pr.lead_time_real, pr.lead_time_oc_count
    FROM canon c
    LEFT JOIN sales_smart ss ON ss.item_id = c.item_id AND ss.variation_id IS NOT DISTINCT FROM c.variation_id
    JOIN params pr ON pr.item_id = c.item_id AND pr.variation_id IS NOT DISTINCT FROM c.variation_id
    LEFT JOIN incoming_by_sku inc ON inc.sku_code = c.sku_code
    LEFT JOIN costs_by_sku  clk ON clk.seller_sku = c.sku_code
    LEFT JOIN costs_by_item cli ON c.sku_code IS NULL AND cli.item_id = c.item_id
  )
  SELECT
    b.item_id, b.variation_id, b.title, b.brand, b.sku_code,
    b.attribute_combinations, b.logistic_type, b.sku_stock,
    b.venda_dia, b.cobertura_atual, b.ponto_reposicao, b.alvo, b.compra_sugerida,
    CASE WHEN b.cost_val IS NULL THEN NULL ELSE b.compra_sugerida::NUMERIC * b.cost_val END AS valor_estimado,
    (b.cost_val IS NULL) AS custo_ausente,
    (b.venda_dia = 0 AND b.sku_stock > 0) AS sem_giro,
    ((b.sku_stock + b.qtd_a_caminho)::NUMERIC <= b.ponto_reposicao) AS gatilho_ativo,
    b.lead_time_dias AS param_lead_time, b.meta_cobertura_dias AS param_cobertura, b.safety_days AS param_safety,
    b.moq AS param_moq, b.pack_multiple AS param_pack, b.param_origem, b.qtd_a_caminho, b.data_proxima_chegada,
    b.venda_dia_origem,
    CASE WHEN v_smart AND b.lead_time_real IS NOT NULL AND b.lead_time_oc_count >= 2 THEN 'fornecedor_real' ELSE 'param' END AS lead_time_origem,
    CASE
      WHEN NOT v_smart OR b.ewma_recent_daily IS NULL THEN '~'
      WHEN b.ewma_recent_daily > b.ewma_older_daily * 1.20 THEN '↑'
      WHEN b.ewma_recent_daily < b.ewma_older_daily * 0.80 THEN '↓'
      ELSE '~'
    END AS tendencia,
    CASE WHEN v_smart AND b.si_sazonal_ativa THEN b.si_fator_sazonal ELSE NULL END AS fator_sazonal,
    CASE WHEN v_smart AND b.lead_time_oc_count >= 2 THEN b.lead_time_real ELSE NULL END AS lead_time_real
  FROM base b
  ORDER BY b.compra_sugerida DESC NULLS LAST, b.item_id, b.variation_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN) TO authenticated;
