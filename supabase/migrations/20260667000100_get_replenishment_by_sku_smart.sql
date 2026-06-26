-- ============================================================
-- Phase 67 — Reposição Esperta: get_replenishment_by_sku v7
-- Adiciona p_smart BOOLEAN (4º parâmetro) que liga:
--   1. EWMA semanal (POWER(0.7, week_offset), lookback 84d) vs média plana
--   2. Índice sazonal por marca/mês (ratio-to-average, lookback 2 anos, >=12 meses)
--   3. Lead time real por fornecedor (mediana percentile_cont(0.5))
-- Cada camada tem fallback por dimensão; p_smart=FALSE reproduz EXATAMENTE
-- o cálculo da Phase 66 (sem regressão). 5 colunas de transparência ao final.
--
-- CORREÇÕES vs 1ª escrita (capturadas no checkpoint de validação via MCP):
--   (a) DROP do overload antigo de 3 args (Phase 66): com o novo 4-arg (default),
--       a chamada de 3 args ficava AMBÍGUA ("function is not unique"). Mantém só o 4-arg.
--   (b) p_smart DEFAULT FALSE: o frontend legado (3 args via PostgREST) resolve
--       p/ p_smart=FALSE = comportamento Phase 66 até o toggle (67-03) entrar; a UI
--       controla o "ON por padrão" passando p_smart=true explicitamente (D-10).
--   (c) #variable_conflict use_column: as colunas de saída do RETURNS TABLE
--       (item_id/brand/...) viram variáveis PL/pgSQL e colidiam com refs não
--       qualificadas dentro de seasonal_index ("column reference is ambiguous").
-- SECURITY INVOKER mantido; toda CTE nova filtra organization_id = p_org_id.
-- Implementa SMART-01 (EWMA+sazonal), SMART-02 (lead time real),
-- SMART-03 (fallback por dimensão), SMART-04 (toggle + anti-IDOR).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC);

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
  inventory_by_sku AS (
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
  sales_by_sku AS (
    SELECT inv.item_id, inv.variation_id,
      COALESCE(SUM(o.quantidade), 0)::NUMERIC / NULLIF(p_sales_window_days, 0) AS avg_daily
    FROM inventory_by_sku inv
    LEFT JOIN orders o
      ON o.organization_id = p_org_id AND o.item_id = inv.item_id
      AND (o.variation_id = inv.variation_id OR (inv.variation_id IS NULL AND o.variation_id = ''))
      AND o.data_pedido::timestamptz::date >= v_cutoff AND o.status = 'paid'
    GROUP BY inv.item_id, inv.variation_id
  ),
  incoming_by_sku AS (
    SELECT po.sku AS sku_code, SUM(po.quantidade)::NUMERIC AS qtd_a_caminho,
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
  -- Phase 67 — EWMA semanal por SKU (alpha=0.3 via POWER(0.7,week_offset), lookback 84d)
  --   FIX: agrega quantidade POR SEMANA antes de ponderar (subquery com GROUP BY
  --   item/variation/week_offset → week_qty). Sem isso, SUM(qty*w)/SUM(w) virava
  --   média de qty POR PEDIDO (≈1) e ewma_daily colapsava em ~1/7≈0,14 p/ todos,
  --   ignorando o volume real. Agora: SUM(week_qty*w)/SUM(w)/7 = taxa diária real.
  ewma_sales AS (
    SELECT inv.item_id, inv.variation_id,
      SUM(o.week_qty * POWER(0.7, o.week_offset)) / NULLIF(SUM(POWER(0.7, o.week_offset)), 0) / 7.0 AS ewma_daily,
      COUNT(*) AS weeks_with_sales,
      SUM(o.week_qty * POWER(0.7, o.week_offset)) FILTER (WHERE o.week_offset < 4)
        / NULLIF(SUM(POWER(0.7, o.week_offset)) FILTER (WHERE o.week_offset < 4), 0) / 7.0 AS ewma_recent_daily,
      SUM(o.week_qty * POWER(0.7, o.week_offset)) FILTER (WHERE o.week_offset BETWEEN 4 AND 11)
        / NULLIF(SUM(POWER(0.7, o.week_offset)) FILTER (WHERE o.week_offset BETWEEN 4 AND 11), 0) / 7.0 AS ewma_older_daily
    FROM inventory_by_sku inv
    LEFT JOIN (
      SELECT o2.item_id, o2.variation_id,
        FLOOR(EXTRACT(EPOCH FROM (DATE_TRUNC('week', CURRENT_DATE::date) - DATE_TRUNC('week', o2.data_pedido::date))) / (7 * 86400))::INTEGER AS week_offset,
        SUM(o2.quantidade) AS week_qty
      FROM orders o2
      WHERE o2.organization_id = p_org_id AND v_smart
        AND o2.data_pedido::date >= CURRENT_DATE - 84 AND o2.status = 'paid'
      GROUP BY o2.item_id, o2.variation_id,
        FLOOR(EXTRACT(EPOCH FROM (DATE_TRUNC('week', CURRENT_DATE::date) - DATE_TRUNC('week', o2.data_pedido::date))) / (7 * 86400))::INTEGER
    ) o ON o.item_id = inv.item_id
       AND (o.variation_id = inv.variation_id OR (inv.variation_id IS NULL AND o.variation_id = ''))
    GROUP BY inv.item_id, inv.variation_id
  ),
  -- Phase 67 — índice sazonal por marca/mês (ratio-to-average, >=12 meses, clamp [0.5,2.5])
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
  -- Phase 67 — lead time real por fornecedor (mediana, guard data_entrega>=data_pedido)
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
  -- Phase 67 — composição de venda efetiva: EWMA×sazonal -> EWMA -> média plana (fallback)
  sales_smart AS (
    SELECT s.item_id, s.variation_id,
      CASE
        WHEN v_smart AND es.ewma_daily IS NOT NULL AND es.weeks_with_sales >= 2 AND si.sazonal_ativa THEN es.ewma_daily * si.fator_sazonal
        WHEN v_smart AND es.ewma_daily IS NOT NULL AND es.weeks_with_sales >= 2 THEN es.ewma_daily
        ELSE COALESCE(s.avg_daily, 0)
      END AS avg_daily,
      CASE
        WHEN v_smart AND es.weeks_with_sales >= 2 AND si.sazonal_ativa THEN 'ewma_sazonal'
        WHEN v_smart AND es.weeks_with_sales >= 2 THEN 'ewma'
        ELSE 'simples'
      END AS venda_dia_origem,
      es.ewma_recent_daily, es.ewma_older_daily,
      si.fator_sazonal AS si_fator_sazonal, si.sazonal_ativa AS si_sazonal_ativa
    FROM sales_by_sku s
    LEFT JOIN inventory_by_sku inv ON inv.item_id = s.item_id AND inv.variation_id IS NOT DISTINCT FROM s.variation_id
    LEFT JOIN ewma_sales es ON es.item_id = s.item_id AND es.variation_id IS NOT DISTINCT FROM s.variation_id
    LEFT JOIN seasonal_index si ON si.brand = inv.brand
  ),
  params AS (
    SELECT inv.item_id, inv.variation_id,
      COALESCE(
        CASE WHEN v_smart AND lf.median_lead_days IS NOT NULL AND lf.oc_count >= 2 THEN lf.median_lead_days ELSE NULL END,
        (SELECT rp.lead_time_dias FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'sku' AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        (SELECT rp.lead_time_dias FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor' AND rp.scope_value = forn.fornecedor LIMIT 1),
        (SELECT rp.lead_time_dias FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'marca' AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.lead_time_dias FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        30
      ) AS lead_time_dias,
      COALESCE(
        (SELECT rp.meta_cobertura_dias FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'sku' AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        (SELECT rp.meta_cobertura_dias FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor' AND rp.scope_value = forn.fornecedor LIMIT 1),
        (SELECT rp.meta_cobertura_dias FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'marca' AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.meta_cobertura_dias FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        60
      ) AS meta_cobertura_dias,
      COALESCE(
        (SELECT rp.safety_days FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'sku' AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        (SELECT rp.safety_days FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor' AND rp.scope_value = forn.fornecedor LIMIT 1),
        (SELECT rp.safety_days FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'marca' AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.safety_days FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        7
      ) AS safety_days,
      COALESCE(
        (SELECT rp.moq FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'sku' AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        (SELECT rp.moq FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor' AND rp.scope_value = forn.fornecedor LIMIT 1),
        (SELECT rp.moq FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'marca' AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.moq FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        1
      ) AS moq,
      COALESCE(
        (SELECT rp.pack_multiple FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'sku' AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        (SELECT rp.pack_multiple FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor' AND rp.scope_value = forn.fornecedor LIMIT 1),
        (SELECT rp.pack_multiple FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'marca' AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.pack_multiple FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        1
      ) AS pack_multiple,
      CASE
        WHEN EXISTS (SELECT 1 FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'sku' AND rp.scope_value = COALESCE(inv.sku_code, '')) THEN 'sku'
        WHEN forn.fornecedor IS NOT NULL AND EXISTS (SELECT 1 FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor' AND rp.scope_value = forn.fornecedor) THEN 'fornecedor'
        WHEN EXISTS (SELECT 1 FROM replenishment_params rp WHERE rp.organization_id = p_org_id AND rp.scope = 'marca' AND rp.scope_value = COALESCE(inv.brand, '')) THEN 'marca'
        ELSE 'global'
      END AS param_origem,
      lf.median_lead_days AS lead_time_real, lf.oc_count AS lead_time_oc_count
    FROM inventory_by_sku inv
    LEFT JOIN fornecedor_by_sku forn ON forn.sku_code = inv.sku_code
    LEFT JOIN lead_time_by_fornecedor lf ON lf.fornecedor = forn.fornecedor
  ),
  base AS (
    SELECT
      inv.item_id, inv.variation_id, inv.title, inv.brand, inv.sku_code,
      inv.attribute_combinations, inv.logistic_type, inv.sku_stock,
      COALESCE(inc.qtd_a_caminho, 0)::INTEGER AS qtd_a_caminho,
      inc.data_proxima_chegada,
      ss.avg_daily * p_demand_multiplier AS venda_dia,
      CASE WHEN ss.avg_daily * p_demand_multiplier > 0 THEN inv.sku_stock::NUMERIC / (ss.avg_daily * p_demand_multiplier) ELSE NULL END AS cobertura_atual,
      ss.avg_daily * p_demand_multiplier * (pr.lead_time_dias + pr.safety_days)::NUMERIC AS ponto_reposicao,
      ss.avg_daily * p_demand_multiplier * (pr.meta_cobertura_dias + pr.safety_days)::NUMERIC AS alvo,
      CASE
        WHEN ss.avg_daily = 0 THEN 0
        WHEN (inv.sku_stock + COALESCE(inc.qtd_a_caminho, 0))::NUMERIC > ss.avg_daily * p_demand_multiplier * (pr.lead_time_dias + pr.safety_days)::NUMERIC THEN 0
        ELSE GREATEST(CEIL(GREATEST(0, ss.avg_daily * p_demand_multiplier * (pr.meta_cobertura_dias + pr.safety_days)::NUMERIC - (inv.sku_stock + COALESCE(inc.qtd_a_caminho, 0))::NUMERIC) / NULLIF(pr.pack_multiple, 0)) * pr.pack_multiple, pr.moq)::INTEGER
      END AS compra_sugerida,
      cl.cost AS cost_val,
      pr.lead_time_dias, pr.meta_cobertura_dias, pr.safety_days, pr.moq, pr.pack_multiple, pr.param_origem,
      ss.venda_dia_origem, ss.ewma_recent_daily, ss.ewma_older_daily, ss.si_fator_sazonal, ss.si_sazonal_ativa,
      pr.lead_time_real, pr.lead_time_oc_count
    FROM inventory_by_sku inv
    LEFT JOIN sales_smart ss ON ss.item_id = inv.item_id AND ss.variation_id IS NOT DISTINCT FROM inv.variation_id
    JOIN params pr ON pr.item_id = inv.item_id AND pr.variation_id IS NOT DISTINCT FROM inv.variation_id
    LEFT JOIN incoming_by_sku inc ON inc.sku_code = inv.sku_code
    LEFT JOIN LATERAL (
      SELECT c.cost FROM ml_product_costs c
      WHERE c.organization_id = p_org_id AND (c.seller_sku = inv.sku_code OR (inv.sku_code IS NULL AND c.item_id = inv.item_id))
      ORDER BY c.updated_at DESC NULLS LAST LIMIT 1
    ) cl ON TRUE
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
