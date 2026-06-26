-- ============================================================
-- Phase 65 — Estoque a Chegar: get_replenishment_by_sku ganha o "a caminho"
-- ============================================================
-- Evolui a RPC da Phase 63 (CREATE OR REPLACE — mesma assinatura).
-- Mudanças:
--   • CTE incoming_by_sku: soma das OCs em aberto (purchase_orders) por SKU
--     + data da próxima chegada (menor data_entrega futura).
--   • Estoque efetivo = sku_stock + qtd_a_caminho. Por decisão do Wesley
--     (2026-06-26), descontamos TODA a qtd a caminho da sugestão, independente
--     da data. Aplicado no gatilho E na necessidade — fórmula Phase 63 intacta
--     quando qtd_a_caminho = 0 (sem regressão).
--   • Novas colunas de saída: qtd_a_caminho (INTEGER), data_proxima_chegada (DATE).
-- SECURITY INVOKER mantido (anti-IDOR). purchase_orders filtra organization_id
-- = p_org_id (RLS is_org_member reforça).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_replenishment_by_sku(
  p_org_id            UUID,
  p_sales_window_days INTEGER DEFAULT 30,
  p_demand_multiplier NUMERIC  DEFAULT 1.0
)
RETURNS TABLE (
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
  data_proxima_chegada   DATE
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_cutoff DATE := CURRENT_DATE - p_sales_window_days;
BEGIN
  RETURN QUERY
  WITH
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
  -- CTE NOVA (Phase 65): a chegar por SKU (purchase_orders em aberto)
  --   qtd_a_caminho = SUM(quantidade); data_proxima_chegada = menor data
  --   futura (fallback: menor data overall se todas atrasadas).
  --   Match por SKU exato com sku_code da variação.
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
  params AS (
    SELECT
      inv.item_id, inv.variation_id,
      COALESCE(
        (SELECT rp.lead_time_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
           AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
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
        WHEN EXISTS (
          SELECT 1 FROM replenishment_params rp
          WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
            AND rp.scope_value = COALESCE(inv.brand, '')
        ) THEN 'marca'
        ELSE 'global'
      END AS param_origem
    FROM inventory_by_sku inv
  ),
  base AS (
    SELECT
      inv.item_id, inv.variation_id, inv.title, inv.brand, inv.sku_code,
      inv.attribute_combinations, inv.logistic_type, inv.sku_stock,
      COALESCE(inc.qtd_a_caminho, 0)::INTEGER                                   AS qtd_a_caminho,
      inc.data_proxima_chegada                                                  AS data_proxima_chegada,
      COALESCE(s.avg_daily, 0) * p_demand_multiplier                            AS venda_dia,
      CASE
        WHEN COALESCE(s.avg_daily, 0) * p_demand_multiplier > 0
          THEN inv.sku_stock::NUMERIC / (COALESCE(s.avg_daily, 0) * p_demand_multiplier)
        ELSE NULL
      END                                                                        AS cobertura_atual,
      COALESCE(s.avg_daily, 0) * p_demand_multiplier
        * (pr.lead_time_dias + pr.safety_days)::NUMERIC                         AS ponto_reposicao,
      COALESCE(s.avg_daily, 0) * p_demand_multiplier
        * (pr.meta_cobertura_dias + pr.safety_days)::NUMERIC                    AS alvo,
      -- compra_sugerida — estoque efetivo = estoque + a caminho (Phase 65 D-05):
      --   0 se sem giro; 0 se (estoque + a_caminho) > ponto; senão GREATEST(CEIL(necessidade/pack)×pack, moq)
      CASE
        WHEN COALESCE(s.avg_daily, 0) = 0
          THEN 0
        WHEN (inv.sku_stock + COALESCE(inc.qtd_a_caminho, 0))::NUMERIC
               > COALESCE(s.avg_daily, 0) * p_demand_multiplier
                   * (pr.lead_time_dias + pr.safety_days)::NUMERIC
          THEN 0
        ELSE GREATEST(
          CEIL(
            GREATEST(
              0,
              COALESCE(s.avg_daily, 0) * p_demand_multiplier
                * (pr.meta_cobertura_dias + pr.safety_days)::NUMERIC
              - (inv.sku_stock + COALESCE(inc.qtd_a_caminho, 0))::NUMERIC
            ) / NULLIF(pr.pack_multiple, 0)
          ) * pr.pack_multiple,
          pr.moq
        )::INTEGER
      END                                                                        AS compra_sugerida,
      cl.cost                                                                    AS cost_val,
      pr.lead_time_dias, pr.meta_cobertura_dias, pr.safety_days, pr.moq,
      pr.pack_multiple, pr.param_origem
    FROM inventory_by_sku inv
    LEFT JOIN sales_by_sku  s
      ON  s.item_id      = inv.item_id
      AND s.variation_id IS NOT DISTINCT FROM inv.variation_id
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
  SELECT
    b.item_id, b.variation_id, b.title, b.brand, b.sku_code,
    b.attribute_combinations, b.logistic_type, b.sku_stock,
    b.venda_dia, b.cobertura_atual, b.ponto_reposicao, b.alvo, b.compra_sugerida,
    CASE WHEN b.cost_val IS NULL THEN NULL ELSE b.compra_sugerida::NUMERIC * b.cost_val END AS valor_estimado,
    (b.cost_val IS NULL)                                          AS custo_ausente,
    (b.venda_dia = 0 AND b.sku_stock > 0)                        AS sem_giro,
    -- gatilho_ativo: estoque efetivo (estoque + a caminho) ≤ ponto_reposicao
    ((b.sku_stock + b.qtd_a_caminho)::NUMERIC <= b.ponto_reposicao) AS gatilho_ativo,
    b.lead_time_dias       AS param_lead_time,
    b.meta_cobertura_dias  AS param_cobertura,
    b.safety_days          AS param_safety,
    b.moq                  AS param_moq,
    b.pack_multiple        AS param_pack,
    b.param_origem,
    b.qtd_a_caminho,
    b.data_proxima_chegada
  FROM base b
  ORDER BY b.compra_sugerida DESC NULLS LAST, b.item_id, b.variation_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC) TO authenticated;
