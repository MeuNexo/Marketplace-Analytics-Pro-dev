-- ============================================================
-- Reposição Server-Side — RPC get_replenishment (SECURITY INVOKER)
-- ============================================================
-- Requisitos: REPL-01..REPL-08
-- Projeto: ckcdevcxgvueywivefgx
-- Phase: 62-reposicao-server-side (Plan 62-01)
--
-- SECURITY INVOKER (NUNCA DEFINER): a RLS de ml_inventory_cache,
-- ml_product_daily_cache, ml_product_costs e replenishment_params
-- usa is_org_member(auth.uid(), organization_id), que enforça o
-- isolamento de tenant mesmo que p_org_id seja de outra org.
-- Passar p_org_id alheio retorna 0 linhas (anti-IDOR por construção).
-- Padrão Phase 43/48; cf. get_cashflow (20260659000000).
--
-- Parâmetros:
--   p_org_id            UUID     — organização do usuário autenticado
--   p_sales_window_days INTEGER  — janela de venda em dias (default 30)
--   p_demand_multiplier NUMERIC  — multiplicador de campanha 1.0/1.2/1.5/2.0 (default 1.0)
--
-- Paginação: sem LIMIT — usar supabase.rpc().range() no frontend (REPL-01)
-- Estoque: SUM(available_quantity) cross-store, sem filtro logistic_type (REPL-02, corrige VERAC-01)
-- Custo: JOIN via item_id OU seller_sku (Pitfall 1 — Tiny keya por TINY_{sku})
-- Params: precedência marca > global > hardcoded (30/60/7/1/1) por COALESCE (REPL-05)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_replenishment(
  p_org_id            UUID,
  p_sales_window_days INTEGER DEFAULT 30,
  p_demand_multiplier NUMERIC  DEFAULT 1.0
)
RETURNS TABLE (
  item_id           TEXT,
  title             TEXT,
  brand             TEXT,
  logistic_type     TEXT,
  estoque_atual     INTEGER,
  venda_dia         NUMERIC,
  cobertura_atual   NUMERIC,
  ponto_reposicao   NUMERIC,
  alvo              NUMERIC,
  compra_sugerida   INTEGER,
  valor_estimado    NUMERIC,
  custo_ausente     BOOLEAN,
  sem_giro          BOOLEAN,
  gatilho_ativo     BOOLEAN,
  param_lead_time   INTEGER,
  param_cobertura   INTEGER,
  param_safety      INTEGER,
  param_moq         INTEGER,
  param_pack        INTEGER,
  param_origem      TEXT
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
  -- CTE 1: vendas por item na janela (multi-store: soma por org)
  -- REPL-03: média de vendas reais em ml_product_daily_cache
  -- --------------------------------------------------------
  sales AS (
    SELECT
      s.item_id,
      COALESCE(SUM(s.qty_sold), 0)::NUMERIC
        / NULLIF(p_sales_window_days, 0)         AS avg_daily
    FROM ml_product_daily_cache s
    WHERE s.organization_id = p_org_id
      AND s.date >= v_cutoff
    GROUP BY s.item_id
  ),
  -- --------------------------------------------------------
  -- CTE 2: estoque ativo por item (SUM cross-store; MAX para metadados)
  -- REPL-02: sem filtro logistic_type = Full + anúncios (corrige VERAC-01)
  -- SUM(available_quantity) agrega estoque de múltiplas lojas (Pitfall 2)
  -- --------------------------------------------------------
  inventory AS (
    SELECT
      i.item_id,
      MAX(i.title)               AS title,
      MAX(i.brand)               AS brand,
      MAX(i.logistic_type)       AS logistic_type,
      MAX(i.seller_custom_field) AS seller_custom_field,
      SUM(i.available_quantity)  AS available_quantity
    FROM ml_inventory_cache i
    WHERE i.organization_id = p_org_id
      AND i.status = 'active'
    GROUP BY i.item_id
  ),
  -- --------------------------------------------------------
  -- CTE 3: parâmetros de reposição por item (REPL-05)
  -- Precedência: marca > global > hardcoded (30/60/7/1/1)
  -- scope_value comparado com inv.brand (case-sensitive)
  -- --------------------------------------------------------
  params AS (
    SELECT
      inv.item_id,
      COALESCE(
        (SELECT rp.lead_time_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
           AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.lead_time_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        30
      ) AS lead_time_dias,
      COALESCE(
        (SELECT rp.meta_cobertura_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
           AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.meta_cobertura_dias FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        60
      ) AS meta_cobertura_dias,
      COALESCE(
        (SELECT rp.safety_days FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
           AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.safety_days FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        7
      ) AS safety_days,
      COALESCE(
        (SELECT rp.moq FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
           AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
        (SELECT rp.moq FROM replenishment_params rp
         WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
        1
      ) AS moq,
      COALESCE(
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
            AND rp.scope = 'marca'
            AND rp.scope_value = COALESCE(inv.brand, '')
        )
        THEN 'marca'
        ELSE 'global'
      END AS param_origem
    FROM inventory inv
  ),
  -- --------------------------------------------------------
  -- CTE 4: valores base por item (fórmula de ponto de reposição)
  -- REPL-04/06/07/08: gatilho, MOQ+pack, custo via LATERAL, sem giro
  -- --------------------------------------------------------
  base AS (
    SELECT
      inv.item_id,
      inv.title,
      inv.brand,
      inv.logistic_type,
      inv.available_quantity::INTEGER                                        AS estoque_atual,
      -- venda_dia = avg_daily × multiplicador de campanha
      COALESCE(s.avg_daily, 0) * p_demand_multiplier                        AS venda_dia,
      -- cobertura_atual: NULL se sem giro (Pitfall 4 — evita divisão por zero)
      CASE
        WHEN COALESCE(s.avg_daily, 0) * p_demand_multiplier > 0
          THEN inv.available_quantity::NUMERIC
               / (COALESCE(s.avg_daily, 0) * p_demand_multiplier)
        ELSE NULL
      END                                                                    AS cobertura_atual,
      -- ponto_reposicao = venda_dia × (lead_time + safety)
      COALESCE(s.avg_daily, 0) * p_demand_multiplier
        * (p.lead_time_dias + p.safety_days)::NUMERIC                       AS ponto_reposicao,
      -- alvo = venda_dia × (meta_cobertura + safety)
      COALESCE(s.avg_daily, 0) * p_demand_multiplier
        * (p.meta_cobertura_dias + p.safety_days)::NUMERIC                  AS alvo,
      -- compra_sugerida (REPL-04/REPL-06):
      --   0 se venda_dia = 0 (sem giro — REPL-08)
      --   0 se estoque > ponto_reposicao (gatilho não ativado)
      --   senão: GREATEST(CEIL(necessidade/pack)×pack, moq)
      --   NULLIF(pack,0) guarda contra divisão por zero (Pitfall 5; também CHECK na tabela)
      CASE
        WHEN COALESCE(s.avg_daily, 0) = 0
          THEN 0
        WHEN inv.available_quantity::NUMERIC
               > COALESCE(s.avg_daily, 0) * p_demand_multiplier
                   * (p.lead_time_dias + p.safety_days)::NUMERIC
          THEN 0
        ELSE GREATEST(
          CEIL(
            GREATEST(
              0,
              COALESCE(s.avg_daily, 0) * p_demand_multiplier
                * (p.meta_cobertura_dias + p.safety_days)::NUMERIC
              - inv.available_quantity::NUMERIC
            ) / NULLIF(p.pack_multiple, 0)
          ) * p.pack_multiple,
          p.moq
        )::INTEGER
      END                                                                    AS compra_sugerida,
      -- custo via LATERAL (Pitfall 1: ponte seller_sku para custos Tiny)
      -- c.item_id = inv.item_id → custos inseridos manualmente (MLB...)
      -- c.seller_sku = inv.seller_custom_field → custos do Tiny (TINY_{sku})
      cl.cost                                                                AS cost_val,
      p.lead_time_dias,
      p.meta_cobertura_dias,
      p.safety_days,
      p.moq,
      p.pack_multiple,
      p.param_origem
    FROM inventory inv
    LEFT JOIN sales        s ON s.item_id = inv.item_id
    JOIN       params      p ON p.item_id = inv.item_id
    LEFT JOIN LATERAL (
      SELECT c.cost
      FROM ml_product_costs c
      WHERE c.organization_id = p_org_id
        AND (
          c.item_id = inv.item_id
          OR (c.seller_sku IS NOT NULL AND c.seller_sku = inv.seller_custom_field)
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
    b.title,
    b.brand,
    b.logistic_type,
    b.estoque_atual,
    b.venda_dia,
    b.cobertura_atual,
    b.ponto_reposicao,
    b.alvo,
    b.compra_sugerida,
    -- valor_estimado: NULL se custo ausente (REPL-07)
    CASE
      WHEN b.cost_val IS NULL THEN NULL
      ELSE b.compra_sugerida::NUMERIC * b.cost_val
    END                                                       AS valor_estimado,
    -- custo_ausente: true quando não há custo casável (REPL-07)
    (b.cost_val IS NULL)                                      AS custo_ausente,
    -- sem_giro: venda_dia=0 com estoque > 0 (REPL-08)
    (b.venda_dia = 0 AND b.estoque_atual > 0)                 AS sem_giro,
    -- gatilho_ativo: estoque ≤ ponto_reposicao (REPL-04)
    (b.estoque_atual::NUMERIC <= b.ponto_reposicao)           AS gatilho_ativo,
    b.lead_time_dias   AS param_lead_time,
    b.meta_cobertura_dias AS param_cobertura,
    b.safety_days      AS param_safety,
    b.moq              AS param_moq,
    b.pack_multiple    AS param_pack,
    b.param_origem
  FROM base b
  ORDER BY b.compra_sugerida DESC NULLS LAST, b.item_id;
END;
$$;

-- --------------------------------------------------------
-- REVOKE/GRANT: Postgres concede EXECUTE a PUBLIC por default.
-- Sempre REVOKE explícito (padrão get_cashflow — 20260659000000).
-- --------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_replenishment(UUID, INTEGER, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_replenishment(UUID, INTEGER, NUMERIC) TO authenticated;
