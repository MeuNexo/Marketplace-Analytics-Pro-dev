-- ============================================================
-- Reposição Server-Side por SKU — RPC get_replenishment_by_sku (SECURITY INVOKER)
-- ============================================================
-- Requisitos: CMP-02, CMP-03, CMP-04, CMP-05
-- Projeto: ckcdevcxgvueywivefgx
-- Phase: 63-compras-reposicao-por-sku (Plan 63-02)
--
-- SECURITY INVOKER (NUNCA DEFINER): a RLS de ml_inventory_cache,
-- ml_orders, ml_product_costs e replenishment_params usa
-- is_org_member(auth.uid(), organization_id), que enforça o
-- isolamento de tenant mesmo que p_org_id seja de outra org.
-- Passar p_org_id alheio retorna 0 linhas (anti-IDOR por construção).
-- Padrão Phase 43/48/62; D-06/D-07.
--
-- get_replenishment (Phase 62) permanece INTOCADA — coexiste em prod
-- até a nova RPC ser validada (D-06).
--
-- Parâmetros:
--   p_org_id            UUID     — organização do usuário autenticado
--   p_sales_window_days INTEGER  — janela de venda em dias (default 30)
--   p_demand_multiplier NUMERIC  — multiplicador de campanha 1.0/1.2/1.5/2.0 (default 1.0)
--
-- Granularidade: UMA linha por variação (Cor/Tamanho via jsonb_to_recordset LATERAL).
--               UMA linha por anúncio sem variação (tratado como SKU único).
--
-- CTE 1: inventory_by_sku — UNION ALL (ramo com variação + ramo sem variação)
--          Itens COM variações: jsonb_to_recordset LATERAL → uma linha por variação
--          Itens SEM variações: item-level → uma linha (SKU único)
--          Pitfall 1: has_variations=true mas variations vazio →
--            jsonb_array_length > 0 protege ramo A; (NOT has_var OR len=0) captura ramo B
-- CTE 2: sales_by_sku — velocidade por SKU via ml_orders (CMP-02, D-04)
--          Sem schema change em ml_product_daily_cache
--          Pitfall 2: variation_id NULL (sem variação) casa com o.variation_id = ''
-- CTE 3: params — COALESCE sku > marca > global > hardcoded (30/60/7/1/1) por campo
--          param_origem: 'sku' | 'marca' | 'global' via CASE EXISTS
-- CTE 4: base — fórmula EXATA da Phase 62 (ponto/alvo/gatilho/MOQ/pack/custo-nulo/sem-giro)
--          Custo via LATERAL: seller_sku = sku_code; fallback item_id quando sku_code NULL
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
  param_origem           TEXT
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
  -- --------------------------------------------------------
  -- CTE 1: estoque por SKU via unnest do jsonb variations (CMP-03, D-01)
  --   Ramo A: itens COM variações → uma linha por variação (jsonb_to_recordset LATERAL)
  --   Ramo B: itens SEM variações → uma linha (item = SKU único)
  -- --------------------------------------------------------
  inventory_by_sku AS (
    -- Ramo A: itens com variações (has_variations = TRUE e jsonb_array_length > 0)
    SELECT
      i.item_id,
      i.title,
      i.brand,
      i.logistic_type,
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

    -- Ramo B: itens sem variações (SKU único = item inteiro)
    SELECT
      i.item_id,
      i.title,
      i.brand,
      i.logistic_type,
      NULL::TEXT                  AS variation_id,
      NULL::JSONB                 AS attribute_combinations,
      i.available_quantity        AS sku_stock,
      i.seller_custom_field       AS sku_code
    FROM ml_inventory_cache i
    WHERE i.organization_id = p_org_id
      AND i.status = 'active'
      AND (i.has_variations = FALSE OR jsonb_array_length(i.variations) = 0)
  ),
  -- --------------------------------------------------------
  -- CTE 2: velocidade por SKU de ml_orders (CMP-02, D-04)
  --   ml_orders já tem variation_id → sem schema change em ml_product_daily_cache
  --   Pitfall 2: items sem variação gravam o.variation_id = '' no sync →
  --     casa via OR (inv.variation_id IS NULL AND o.variation_id = '')
  -- --------------------------------------------------------
  sales_by_sku AS (
    SELECT
      inv.item_id,
      inv.variation_id,
      COALESCE(SUM(o.quantidade), 0)::NUMERIC
        / NULLIF(p_sales_window_days, 0)                   AS avg_daily
    FROM inventory_by_sku inv
    LEFT JOIN ml_orders o
      ON  o.organization_id = p_org_id
      AND o.item_id = inv.item_id
      AND (
        o.variation_id = inv.variation_id
        OR (inv.variation_id IS NULL AND o.variation_id = '')
      )
      AND o.data_pedido >= v_cutoff
      AND o.status IN ('paid', 'confirmed')
    GROUP BY inv.item_id, inv.variation_id
  ),
  -- --------------------------------------------------------
  -- CTE 3: parâmetros por SKU (CMP-05, D-08)
  --   Precedência: sku > marca > global > hardcoded (30/60/7/1/1)
  --   scope='sku':   scope_value = sku_code da variação
  --   scope='marca': scope_value = brand do item
  --   param_origem:  'sku' | 'marca' | 'global' via CASE EXISTS
  -- --------------------------------------------------------
  params AS (
    SELECT
      inv.item_id,
      inv.variation_id,
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
          WHERE rp.organization_id = p_org_id
            AND rp.scope = 'sku'
            AND rp.scope_value = COALESCE(inv.sku_code, '')
        ) THEN 'sku'
        WHEN EXISTS (
          SELECT 1 FROM replenishment_params rp
          WHERE rp.organization_id = p_org_id
            AND rp.scope = 'marca'
            AND rp.scope_value = COALESCE(inv.brand, '')
        ) THEN 'marca'
        ELSE 'global'
      END AS param_origem
    FROM inventory_by_sku inv
  ),
  -- --------------------------------------------------------
  -- CTE 4: valores base por SKU (fórmula EXATA da Phase 62)
  --   REPL-04/06/07/08 portados para granularidade de variação/SKU
  --   Custo via LATERAL (CMP-04, D-03):
  --     seller_sku = sku_code (variação tem SKU Tiny cadastrado)
  --     fallback item_id quando sku_code NULL (item sem variação ou sem SKU)
  --   T-63-07: LATERAL filtra c.organization_id = p_org_id (INVOKER enforça via RLS)
  --   T-63-06: NULLIF(pack,0) guarda contra divisão por zero
  -- --------------------------------------------------------
  base AS (
    SELECT
      inv.item_id,
      inv.variation_id,
      inv.title,
      inv.brand,
      inv.sku_code,
      inv.attribute_combinations,
      inv.logistic_type,
      inv.sku_stock,
      -- venda_dia = avg_daily × multiplicador de campanha
      COALESCE(s.avg_daily, 0) * p_demand_multiplier                            AS venda_dia,
      -- cobertura_atual: NULL se sem giro (evita divisão por zero)
      CASE
        WHEN COALESCE(s.avg_daily, 0) * p_demand_multiplier > 0
          THEN inv.sku_stock::NUMERIC
               / (COALESCE(s.avg_daily, 0) * p_demand_multiplier)
        ELSE NULL
      END                                                                        AS cobertura_atual,
      -- ponto_reposicao = venda_dia × (lead_time + safety)
      COALESCE(s.avg_daily, 0) * p_demand_multiplier
        * (pr.lead_time_dias + pr.safety_days)::NUMERIC                         AS ponto_reposicao,
      -- alvo = venda_dia × (meta_cobertura + safety)
      COALESCE(s.avg_daily, 0) * p_demand_multiplier
        * (pr.meta_cobertura_dias + pr.safety_days)::NUMERIC                    AS alvo,
      -- compra_sugerida (espelha lógica Phase 62 REPL-04/REPL-06):
      --   0 se venda_dia = 0 (sem giro — REPL-08)
      --   0 se estoque > ponto_reposicao (gatilho não ativado)
      --   senão: GREATEST(CEIL(necessidade/pack)×pack, moq)
      CASE
        WHEN COALESCE(s.avg_daily, 0) = 0
          THEN 0
        WHEN inv.sku_stock::NUMERIC
               > COALESCE(s.avg_daily, 0) * p_demand_multiplier
                   * (pr.lead_time_dias + pr.safety_days)::NUMERIC
          THEN 0
        ELSE GREATEST(
          CEIL(
            GREATEST(
              0,
              COALESCE(s.avg_daily, 0) * p_demand_multiplier
                * (pr.meta_cobertura_dias + pr.safety_days)::NUMERIC
              - inv.sku_stock::NUMERIC
            ) / NULLIF(pr.pack_multiple, 0)
          ) * pr.pack_multiple,
          pr.moq
        )::INTEGER
      END                                                                        AS compra_sugerida,
      cl.cost                                                                    AS cost_val,
      pr.lead_time_dias,
      pr.meta_cobertura_dias,
      pr.safety_days,
      pr.moq,
      pr.pack_multiple,
      pr.param_origem
    FROM inventory_by_sku inv
    LEFT JOIN sales_by_sku  s
      ON  s.item_id      = inv.item_id
      AND s.variation_id IS NOT DISTINCT FROM inv.variation_id
    JOIN  params           pr
      ON  pr.item_id      = inv.item_id
      AND pr.variation_id IS NOT DISTINCT FROM inv.variation_id
    LEFT JOIN LATERAL (
      SELECT c.cost
      FROM ml_product_costs c
      WHERE c.organization_id = p_org_id
        AND (
          c.seller_sku = inv.sku_code                                    -- variação com SKU Tiny
          OR (inv.sku_code IS NULL AND c.item_id = inv.item_id)          -- fallback item_id
        )
      ORDER BY c.updated_at DESC NULLS LAST
      LIMIT 1
    ) cl ON TRUE
  )
  -- --------------------------------------------------------
  -- Resultado final: deriva valor_estimado, custo_ausente,
  -- sem_giro e gatilho_ativo a partir dos valores do base CTE
  -- --------------------------------------------------------
  SELECT
    b.item_id,
    b.variation_id,
    b.title,
    b.brand,
    b.sku_code,
    b.attribute_combinations,
    b.logistic_type,
    b.sku_stock,
    b.venda_dia,
    b.cobertura_atual,
    b.ponto_reposicao,
    b.alvo,
    b.compra_sugerida,
    -- valor_estimado: NULL se custo ausente (REPL-07)
    CASE
      WHEN b.cost_val IS NULL THEN NULL
      ELSE b.compra_sugerida::NUMERIC * b.cost_val
    END                                                           AS valor_estimado,
    -- custo_ausente: true quando não há custo casável (REPL-07)
    (b.cost_val IS NULL)                                          AS custo_ausente,
    -- sem_giro: venda_dia=0 com estoque > 0 (REPL-08)
    (b.venda_dia = 0 AND b.sku_stock > 0)                        AS sem_giro,
    -- gatilho_ativo: estoque ≤ ponto_reposicao (REPL-04)
    (b.sku_stock::NUMERIC <= b.ponto_reposicao)                   AS gatilho_ativo,
    b.lead_time_dias       AS param_lead_time,
    b.meta_cobertura_dias  AS param_cobertura,
    b.safety_days          AS param_safety,
    b.moq                  AS param_moq,
    b.pack_multiple        AS param_pack,
    b.param_origem
  FROM base b
  ORDER BY b.compra_sugerida DESC NULLS LAST, b.item_id, b.variation_id;
END;
$$;

-- --------------------------------------------------------
-- REVOKE/GRANT: Postgres concede EXECUTE a PUBLIC por default.
-- Sempre REVOKE explícito (padrão get_cashflow/get_replenishment).
-- T-63-05: nenhum GRANT a PUBLIC/anon.
-- --------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC) TO authenticated;
