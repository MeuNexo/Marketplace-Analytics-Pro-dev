-- ============================================================
-- Phase 67 — Reposição Esperta: get_replenishment_by_sku v7
-- Adiciona p_smart BOOLEAN (4º parâmetro, default TRUE) que liga:
--   1. EWMA semanal (alpha=0.3, lookback 84d) substituindo média plana
--   2. Índice sazonal por marca/mês (ratio-to-average, lookback 2 anos)
--   3. Lead time real por fornecedor (mediana percentile_cont(0.5))
-- Cada camada esperta tem fallback por dimensão (EWMA>=2 semanas,
-- sazonal>=12 meses no bucket, lead time real>=2 OCs).
-- p_smart=FALSE reproduz EXATAMENTE o cálculo da Phase 66 (sem regressão).
-- SECURITY INVOKER mantido; toda CTE nova filtra organization_id = p_org_id.
-- Acrescenta 5 colunas de transparência ao final do RETURNS TABLE.
-- Implementa SMART-01 (EWMA+sazonal), SMART-02 (lead time real),
-- SMART-03 (fallback por dimensão), SMART-04 (toggle + anti-IDOR).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_replenishment_by_sku(
  p_org_id            UUID,
  p_sales_window_days INTEGER DEFAULT 30,
  p_demand_multiplier NUMERIC  DEFAULT 1.0,
  p_smart             BOOLEAN  DEFAULT TRUE   -- NOVO Phase 67: toggle cálculo esperto
)
RETURNS TABLE (
  -- === colunas existentes (ordem intocada) ===
  item_id                TEXT,
  variation_id           TEXT,
  title                  TEXT,
  brand                  TEXT,
  sku_code               TEXT,
  attribute_combinations JSONB,
  logistic_type          TEXT,
  sku_stock              INTEGER,
  venda_dia              NUMERIC,
  cobertura_atual        NUMERIC,
  ponto_reposicao        NUMERIC,
  alvo                   NUMERIC,
  compra_sugerida        INTEGER,
  valor_estimado         NUMERIC,
  custo_ausente          BOOLEAN,
  sem_giro               BOOLEAN,
  gatilho_ativo          BOOLEAN,
  param_lead_time        INTEGER,
  param_cobertura        INTEGER,
  param_safety           INTEGER,
  param_moq              INTEGER,
  param_pack             INTEGER,
  param_origem           TEXT,
  qtd_a_caminho          INTEGER,
  data_proxima_chegada   DATE,
  -- === 5 colunas NOVAS ao final (Phase 67 — transparência) ===
  venda_dia_origem       TEXT,     -- 'ewma_sazonal' | 'ewma' | 'simples'
  lead_time_origem       TEXT,     -- 'fornecedor_real' | 'param'
  tendencia              TEXT,     -- '↑' | '↓' | '~'
  fator_sazonal          NUMERIC,  -- fator aplicado (NULL se não aplicado)
  lead_time_real         INTEGER   -- mediana real calculada (NULL se oc_count<2)
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_cutoff DATE    := CURRENT_DATE - p_sales_window_days;
  v_smart  BOOLEAN := COALESCE(p_smart, TRUE);  -- Pitfall 1: protege contra NULL
BEGIN
  RETURN QUERY
  WITH
  -- --------------------------------------------------------
  -- CTEs INTOCADAS (Phases 62-66)
  -- --------------------------------------------------------
  inventory_by_sku AS (
    SELECT
      i.item_id, i.title, i.brand, i.logistic_type,
      v.variation_id              AS variation_id,
      v.attribute_combinations    AS attribute_combinations,
      v.available_quantity        AS sku_stock,
      v.seller_custom_field       AS sku_code
    FROM ml_inventory_cache i
    CROSS JOIN LATERAL jsonb_to_recordset(i.variations) AS v(
      variation_id           TEXT,
      attribute_combinations JSONB,
      available_quantity     INTEGER,
      sold_quantity          INTEGER,
      seller_custom_field    TEXT
    )
    WHERE i.organization_id = p_org_id
      AND i.status = 'active'
      AND i.has_variations = TRUE
      AND jsonb_array_length(i.variations) > 0
    UNION ALL
    SELECT
      i.item_id, i.title, i.brand, i.logistic_type,
      NULL::TEXT                  AS variation_id,
      NULL::JSONB                 AS attribute_combinations,
      i.available_quantity        AS sku_stock,
      i.seller_custom_field       AS sku_code
    FROM ml_inventory_cache i
    WHERE i.organization_id = p_org_id
      AND i.status = 'active'
      AND (i.has_variations = FALSE OR jsonb_array_length(i.variations) = 0)
  ),
  sales_by_sku AS (
    SELECT
      inv.item_id, inv.variation_id,
      COALESCE(SUM(o.quantidade), 0)::NUMERIC
        / NULLIF(p_sales_window_days, 0)                   AS avg_daily
    FROM inventory_by_sku inv
    LEFT JOIN orders o
      ON  o.organization_id = p_org_id
      AND o.item_id = inv.item_id
      AND (
        o.variation_id = inv.variation_id
        OR (inv.variation_id IS NULL AND o.variation_id = '')
      )
      AND o.data_pedido::timestamptz::date >= v_cutoff
      AND o.status = 'paid'
    GROUP BY inv.item_id, inv.variation_id
  ),
  -- --------------------------------------------------------
  -- CTE (Phase 65): a chegar por SKU (purchase_orders em aberto)
  -- --------------------------------------------------------
  incoming_by_sku AS (
    SELECT
      po.sku                                                   AS sku_code,
      SUM(po.quantidade)::NUMERIC                              AS qtd_a_caminho,
      COALESCE(
        MIN(po.data_entrega) FILTER (WHERE po.data_entrega >= CURRENT_DATE),
        MIN(po.data_entrega)
      )                                                        AS data_proxima_chegada
    FROM purchase_orders po
    WHERE po.organization_id = p_org_id
    GROUP BY po.sku
  ),
  -- --------------------------------------------------------
  -- CTE NOVA (Phase 66): fornecedor predominante por SKU
  -- --------------------------------------------------------
  fornecedor_by_sku AS (
    SELECT DISTINCT ON (sub.sku_code) sub.sku_code, sub.fornecedor
    FROM (
      SELECT
        po.sku                                         AS sku_code,
        po.fornecedor,
        SUM(po.quantidade)                             AS total_qty,
        MAX(COALESCE(po.data_entrega, po.data_pedido)) AS ultima_data
      FROM public.purchase_orders po
      WHERE po.organization_id = p_org_id
        AND po.fornecedor IS NOT NULL
      GROUP BY po.sku, po.fornecedor
    ) sub
    ORDER BY sub.sku_code, sub.total_qty DESC, sub.ultima_data DESC NULLS LAST
  ),
  -- --------------------------------------------------------
  -- CTE NOVA (Phase 67 — SMART-01): EWMA semanal por SKU
  --   alpha=0.3 (half-life ~2 semanas), lookback 84 dias (12 semanas)
  --   Filtro v_smart no subquery → 0 linhas se OFF (short-circuit, Pitfall 4)
  -- --------------------------------------------------------
  ewma_sales AS (
    SELECT
      inv.item_id, inv.variation_id,
      SUM(o.quantidade * POWER(0.7, o.week_offset))
        / NULLIF(SUM(POWER(0.7, o.week_offset)), 0)
        / 7.0                                                     AS ewma_daily,
      COUNT(*)                                                     AS weeks_with_sales,
      SUM(o.quantidade * POWER(0.7, o.week_offset))
        FILTER (WHERE o.week_offset < 4)
        / NULLIF(SUM(POWER(0.7, o.week_offset)) FILTER (WHERE o.week_offset < 4), 0)
        / 7.0                                                     AS ewma_recent_daily,
      SUM(o.quantidade * POWER(0.7, o.week_offset))
        FILTER (WHERE o.week_offset BETWEEN 4 AND 11)
        / NULLIF(SUM(POWER(0.7, o.week_offset)) FILTER (WHERE o.week_offset BETWEEN 4 AND 11), 0)
        / 7.0                                                     AS ewma_older_daily
    FROM inventory_by_sku inv
    LEFT JOIN (
      SELECT
        o2.item_id, o2.variation_id, o2.quantidade,
        FLOOR(
          EXTRACT(EPOCH FROM (
            DATE_TRUNC('week', CURRENT_DATE::date)
            - DATE_TRUNC('week', o2.data_pedido::date)
          )) / (7 * 86400)
        )::INTEGER AS week_offset
      FROM orders o2
      WHERE o2.organization_id = p_org_id
        AND v_smart                               -- short-circuit: 0 linhas se OFF
        AND o2.data_pedido::date >= CURRENT_DATE - 84
        AND o2.status = 'paid'
    ) o ON o.item_id = inv.item_id
         AND (
           o.variation_id = inv.variation_id
           OR (inv.variation_id IS NULL AND o.variation_id = '')
         )
    GROUP BY inv.item_id, inv.variation_id
  ),
  -- --------------------------------------------------------
  -- CTE NOVA (Phase 67 — SMART-01): índice sazonal por marca/mês
  --   Ratio-to-average, mês corrente, lookback 2 anos.
  --   Limiar: months_covered >= 12; clamp [0.5, 2.5].
  --   Filtro v_smart em brand_by_item → INNER JOIN vazio se OFF.
  -- --------------------------------------------------------
  seasonal_index AS (
    WITH brand_by_item AS (
      SELECT DISTINCT item_id, brand
      FROM ml_inventory_cache
      WHERE organization_id = p_org_id
        AND brand IS NOT NULL AND brand <> ''
        AND v_smart                               -- short-circuit: 0 linhas se OFF
    ),
    monthly_raw AS (
      SELECT
        b.brand,
        EXTRACT(MONTH FROM o.data_pedido::date)::INTEGER  AS mes,
        SUM(o.quantidade) / NULLIF(
          COUNT(DISTINCT EXTRACT(YEAR FROM o.data_pedido::date)::INTEGER), 0
        )                                                  AS avg_qty_month
      FROM orders o
      INNER JOIN brand_by_item b ON b.item_id = o.item_id
      WHERE o.organization_id = p_org_id
        AND o.status = 'paid'
        AND o.data_pedido::date >= CURRENT_DATE - 730
      GROUP BY b.brand, EXTRACT(MONTH FROM o.data_pedido::date)::INTEGER
    ),
    stats AS (
      SELECT
        brand, mes, avg_qty_month,
        AVG(avg_qty_month) OVER (PARTITION BY brand) AS brand_global_avg,
        COUNT(*)           OVER (PARTITION BY brand) AS months_covered
      FROM monthly_raw
    )
    SELECT
      brand,
      CASE WHEN months_covered >= 12
        THEN GREATEST(0.5, LEAST(2.5, avg_qty_month / NULLIF(brand_global_avg, 0)))
        ELSE 1.0
      END                         AS fator_sazonal,
      (months_covered >= 12)      AS sazonal_ativa
    FROM stats
    WHERE mes = EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER
  ),
  -- --------------------------------------------------------
  -- CTE NOVA (Phase 67 — SMART-02): lead time real por fornecedor
  --   Mediana percentile_cont(0.5) de (data_entrega - data_pedido) dias.
  --   Guard data_entrega >= data_pedido (Pitfall 3).
  --   Filtro v_smart → 0 linhas se OFF.
  -- --------------------------------------------------------
  lead_time_by_fornecedor AS (
    SELECT
      po.fornecedor,
      ROUND(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY (po.data_entrega - po.data_pedido)
        )
      )::INTEGER  AS median_lead_days,
      COUNT(*)    AS oc_count
    FROM purchase_orders po
    WHERE po.organization_id = p_org_id
      AND v_smart                               -- short-circuit: 0 linhas se OFF
      AND po.fornecedor IS NOT NULL AND po.fornecedor <> ''
      AND po.data_entrega IS NOT NULL AND po.data_pedido IS NOT NULL
      AND po.data_entrega >= po.data_pedido     -- Pitfall 3: descarta lead time inválido
    GROUP BY po.fornecedor
  ),
  -- --------------------------------------------------------
  -- CTE Phase 67 — composição de venda efetiva por SKU
  --   Prioridade: EWMA×sazonal → só EWMA → média plana (fallback).
  --   Também propaga campos de badge para o SELECT final.
  -- --------------------------------------------------------
  sales_smart AS (
    SELECT
      s.item_id,
      s.variation_id,
      -- venda_dia efetiva (sem p_demand_multiplier; aplicado em base)
      CASE
        WHEN v_smart
             AND es.ewma_daily IS NOT NULL AND es.weeks_with_sales >= 2
             AND si.sazonal_ativa
          THEN es.ewma_daily * si.fator_sazonal
        WHEN v_smart
             AND es.ewma_daily IS NOT NULL AND es.weeks_with_sales >= 2
          THEN es.ewma_daily
        ELSE
          COALESCE(s.avg_daily, 0)
      END                          AS avg_daily,
      -- badge: origem do cálculo de velocidade
      CASE
        WHEN v_smart AND es.weeks_with_sales >= 2 AND si.sazonal_ativa THEN 'ewma_sazonal'
        WHEN v_smart AND es.weeks_with_sales >= 2                       THEN 'ewma'
        ELSE                                                                 'simples'
      END                          AS venda_dia_origem,
      -- badge: sub-componentes de tendência
      es.ewma_recent_daily,
      es.ewma_older_daily,
      -- badge: sazonalidade
      si.fator_sazonal             AS si_fator_sazonal,
      si.sazonal_ativa             AS si_sazonal_ativa
    FROM sales_by_sku s
    LEFT JOIN inventory_by_sku inv
      ON  inv.item_id     = s.item_id
      AND inv.variation_id IS NOT DISTINCT FROM s.variation_id
    LEFT JOIN ewma_sales es
      ON  es.item_id      = s.item_id
      AND es.variation_id IS NOT DISTINCT FROM s.variation_id
    LEFT JOIN seasonal_index si ON si.brand = inv.brand
  ),
  -- --------------------------------------------------------
  -- CTE params: estendida para incluir lead time real (Phase 67)
  --   + LEFT JOIN lead_time_by_fornecedor via fornecedor_by_sku
  --   + lead_time_real/oc_count passados ao base para badge
  --   Todos os demais COALESCEs (meta_cobertura, safety, moq, pack,
  --   param_origem) ficam INTOCADOS da Phase 66.
  -- --------------------------------------------------------
  params AS (
    SELECT
      inv.item_id, inv.variation_id,
      COALESCE(
        -- NOVO Phase 67: lead time real por fornecedor (só v_smart e K>=2)
        CASE WHEN v_smart AND lf.median_lead_days IS NOT NULL AND lf.oc_count >= 2
          THEN lf.median_lead_days ELSE NULL END,
        -- precedência existente da Phase 66 (intocada):
        (SELECT rp.lead_time_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
           AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        (SELECT rp.lead_time_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor'
           AND rp.scope_value = forn.fornecedor LIMIT 1),
        (SELECT rp.lead_time_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
           AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.lead_time_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        30
      ) AS lead_time_dias,
      COALESCE(
        (SELECT rp.meta_cobertura_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
           AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        (SELECT rp.meta_cobertura_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor'
           AND rp.scope_value = forn.fornecedor LIMIT 1),
        (SELECT rp.meta_cobertura_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
           AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.meta_cobertura_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        60
      ) AS meta_cobertura_dias,
      COALESCE(
        (SELECT rp.safety_days FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
           AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        (SELECT rp.safety_days FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor'
           AND rp.scope_value = forn.fornecedor LIMIT 1),
        (SELECT rp.safety_days FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
           AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.safety_days FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        7
      ) AS safety_days,
      COALESCE(
        (SELECT rp.moq FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
           AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        (SELECT rp.moq FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor'
           AND rp.scope_value = forn.fornecedor LIMIT 1),
        (SELECT rp.moq FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
           AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.moq FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        1
      ) AS moq,
      COALESCE(
        (SELECT rp.pack_multiple FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
           AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
        (SELECT rp.pack_multiple FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor'
           AND rp.scope_value = forn.fornecedor LIMIT 1),
        (SELECT rp.pack_multiple FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
           AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.pack_multiple FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        1
      ) AS pack_multiple,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM replenishment_params rp
          WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
            AND rp.scope_value = COALESCE(inv.sku_code, '')
        ) THEN 'sku'
        WHEN forn.fornecedor IS NOT NULL AND EXISTS (
          SELECT 1 FROM replenishment_params rp
          WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor'
            AND rp.scope_value = forn.fornecedor
        ) THEN 'fornecedor'
        WHEN EXISTS (
          SELECT 1 FROM replenishment_params rp
          WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
            AND rp.scope_value = COALESCE(inv.brand, '')
        ) THEN 'marca'
        ELSE 'global'
      END AS param_origem,
      -- NOVO Phase 67: badge lead time real (passado ao base → SELECT final)
      lf.median_lead_days   AS lead_time_real,
      lf.oc_count           AS lead_time_oc_count
    FROM inventory_by_sku inv
    LEFT JOIN fornecedor_by_sku  forn ON forn.sku_code = inv.sku_code
    LEFT JOIN lead_time_by_fornecedor lf ON lf.fornecedor = forn.fornecedor
  ),
  -- --------------------------------------------------------
  -- CTE base: alimentada por sales_smart (EWMA/sazonal) em vez de
  -- sales_by_sku diretamente. Fórmula ponto/alvo/compra/gatilho
  -- INTOCADA — só o insumo venda_dia muda.
  -- Badge fields de sales_smart e params propagados ao SELECT final.
  -- --------------------------------------------------------
  base AS (
    SELECT
      inv.item_id, inv.variation_id, inv.title, inv.brand, inv.sku_code,
      inv.attribute_combinations, inv.logistic_type, inv.sku_stock,
      COALESCE(inc.qtd_a_caminho, 0)::INTEGER                                    AS qtd_a_caminho,
      inc.data_proxima_chegada                                                   AS data_proxima_chegada,
      -- venda_dia: usa avg_daily de sales_smart (que já incorporou EWMA/sazonal)
      ss.avg_daily * p_demand_multiplier                                         AS venda_dia,
      CASE
        WHEN ss.avg_daily * p_demand_multiplier > 0
          THEN inv.sku_stock::NUMERIC / (ss.avg_daily * p_demand_multiplier)
        ELSE NULL
      END                                                                         AS cobertura_atual,
      ss.avg_daily * p_demand_multiplier
        * (pr.lead_time_dias + pr.safety_days)::NUMERIC                          AS ponto_reposicao,
      ss.avg_daily * p_demand_multiplier
        * (pr.meta_cobertura_dias + pr.safety_days)::NUMERIC                     AS alvo,
      -- compra_sugerida: fórmula idêntica à Phase 66, alimentada pelo novo avg_daily
      CASE
        WHEN ss.avg_daily = 0
          THEN 0
        WHEN (inv.sku_stock + COALESCE(inc.qtd_a_caminho, 0))::NUMERIC
               > ss.avg_daily * p_demand_multiplier
                   * (pr.lead_time_dias + pr.safety_days)::NUMERIC
          THEN 0
        ELSE GREATEST(
          CEIL(
            GREATEST(
              0,
              ss.avg_daily * p_demand_multiplier
                * (pr.meta_cobertura_dias + pr.safety_days)::NUMERIC
              - (inv.sku_stock + COALESCE(inc.qtd_a_caminho, 0))::NUMERIC
            ) / NULLIF(pr.pack_multiple, 0)
          ) * pr.pack_multiple,
          pr.moq
        )::INTEGER
      END                                                                         AS compra_sugerida,
      cl.cost                                                                     AS cost_val,
      pr.lead_time_dias, pr.meta_cobertura_dias, pr.safety_days, pr.moq,
      pr.pack_multiple, pr.param_origem,
      -- Phase 67: campos de badge propagados (via sales_smart e params)
      ss.venda_dia_origem,
      ss.ewma_recent_daily,
      ss.ewma_older_daily,
      ss.si_fator_sazonal,
      ss.si_sazonal_ativa,
      pr.lead_time_real,
      pr.lead_time_oc_count
    FROM inventory_by_sku inv
    LEFT JOIN sales_smart ss
      ON  ss.item_id      = inv.item_id
      AND ss.variation_id IS NOT DISTINCT FROM inv.variation_id
    JOIN  params           pr
      ON  pr.item_id      = inv.item_id
      AND pr.variation_id IS NOT DISTINCT FROM inv.variation_id
    LEFT JOIN incoming_by_sku inc
      ON  inc.sku_code    = inv.sku_code
    LEFT JOIN LATERAL (
      SELECT c.cost
      FROM ml_product_costs c
      WHERE c.organization_id = p_org_id
        AND (
          c.seller_sku = inv.sku_code
          OR (inv.sku_code IS NULL AND c.item_id = inv.item_id)
        )
      ORDER BY c.updated_at DESC NULLS LAST
      LIMIT 1
    ) cl ON TRUE
  )
  -- --------------------------------------------------------
  -- SELECT final: colunas existentes (ordem intocada) + 5 novas ao final
  -- --------------------------------------------------------
  SELECT
    b.item_id, b.variation_id, b.title, b.brand, b.sku_code,
    b.attribute_combinations, b.logistic_type, b.sku_stock,
    b.venda_dia, b.cobertura_atual, b.ponto_reposicao, b.alvo, b.compra_sugerida,
    CASE WHEN b.cost_val IS NULL THEN NULL ELSE b.compra_sugerida::NUMERIC * b.cost_val END AS valor_estimado,
    (b.cost_val IS NULL)                                           AS custo_ausente,
    (b.venda_dia = 0 AND b.sku_stock > 0)                         AS sem_giro,
    -- gatilho_ativo: estoque efetivo (estoque + a caminho) <= ponto_reposicao
    ((b.sku_stock + b.qtd_a_caminho)::NUMERIC <= b.ponto_reposicao) AS gatilho_ativo,
    b.lead_time_dias       AS param_lead_time,
    b.meta_cobertura_dias  AS param_cobertura,
    b.safety_days          AS param_safety,
    b.moq                  AS param_moq,
    b.pack_multiple        AS param_pack,
    b.param_origem,
    b.qtd_a_caminho,
    b.data_proxima_chegada,
    -- === 5 colunas NOVAS (Phase 67) ao final ===
    b.venda_dia_origem,
    CASE
      WHEN v_smart AND b.lead_time_real IS NOT NULL AND b.lead_time_oc_count >= 2
        THEN 'fornecedor_real'
      ELSE 'param'
    END                                                            AS lead_time_origem,
    CASE
      WHEN NOT v_smart OR b.ewma_recent_daily IS NULL              THEN '~'
      WHEN b.ewma_recent_daily > b.ewma_older_daily * 1.20        THEN '↑'
      WHEN b.ewma_recent_daily < b.ewma_older_daily * 0.80        THEN '↓'
      ELSE                                                              '~'
    END                                                            AS tendencia,
    CASE WHEN v_smart AND b.si_sazonal_ativa
      THEN b.si_fator_sazonal ELSE NULL
    END                                                            AS fator_sazonal,
    CASE WHEN v_smart AND b.lead_time_oc_count >= 2
      THEN b.lead_time_real ELSE NULL
    END                                                            AS lead_time_real
  FROM base b
  ORDER BY b.compra_sugerida DESC NULLS LAST, b.item_id, b.variation_id;
END;
$$;

-- Pitfall 2: REVOKE assinatura antiga (3 args) E nova (4 args); GRANT só a nova
REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN) TO authenticated;
