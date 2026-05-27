-- ──────────────────────────────────────────────────────────────────────────────
-- RPC 1: totais do período (1 row)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_margin_summary(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  receita    NUMERIC,
  cmv        NUMERIC,
  comissao   NUMERIC,
  frete      NUMERIC,
  impostos   NUMERIC,
  lucro      NUMERIC,
  lucro_pct  NUMERIC,
  pedidos    BIGINT,
  unidades   BIGINT,
  ticket_medio NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(o.receita_bruta), 0)                             AS receita,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)                 AS cmv,
    COALESCE(SUM(o.comissao), 0)                                  AS comissao,
    COALESCE(SUM(o.frete), 0)                                     AS frete,
    COALESCE(SUM(o.tax_amount), 0)                                AS impostos,
    COALESCE(SUM(
      o.receita_bruta
      - COALESCE(o.custo_unit * o.quantidade, 0)
      - COALESCE(o.comissao, 0)
      - COALESCE(o.frete, 0)
      - COALESCE(o.tax_amount, 0)
    ), 0)                                                          AS lucro,
    CASE
      WHEN SUM(o.receita_bruta) > 0 THEN
        ROUND(SUM(
          o.receita_bruta
          - COALESCE(o.custo_unit * o.quantidade, 0)
          - COALESCE(o.comissao, 0)
          - COALESCE(o.frete, 0)
          - COALESCE(o.tax_amount, 0)
        ) / SUM(o.receita_bruta) * 100, 2)
      ELSE NULL
    END                                                            AS lucro_pct,
    COUNT(*)                                                       AS pedidos,
    COALESCE(SUM(o.quantidade), 0)                                AS unidades,
    CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(o.receita_bruta) / COUNT(*), 2) ELSE 0 END AS ticket_medio
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- RPC 2: agregado por dia
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_margin_by_day(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  date       DATE,
  receita    NUMERIC,
  cmv        NUMERIC,
  comissao   NUMERIC,
  frete      NUMERIC,
  impostos   NUMERIC,
  lucro      NUMERIC,
  lucro_pct  NUMERIC,
  pedidos    BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    o.data_pedido::date                                                   AS date,
    COALESCE(SUM(o.receita_bruta), 0)                                     AS receita,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)                         AS cmv,
    COALESCE(SUM(o.comissao), 0)                                          AS comissao,
    COALESCE(SUM(o.frete), 0)                                             AS frete,
    COALESCE(SUM(o.tax_amount), 0)                                        AS impostos,
    COALESCE(SUM(
      o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
      - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)
    ), 0)                                                                  AS lucro,
    CASE WHEN SUM(o.receita_bruta) > 0 THEN
      ROUND(SUM(
        o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
        - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)
      ) / SUM(o.receita_bruta) * 100, 2)
    ELSE NULL END                                                          AS lucro_pct,
    COUNT(*)                                                               AS pedidos
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to
  GROUP BY o.data_pedido::date
  ORDER BY o.data_pedido::date;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- RPC 3: agregado por produto (top 500)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_margin_by_product(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  item_id      TEXT,
  titulo       TEXT,
  sku          TEXT,
  listing_type TEXT,
  receita      NUMERIC,
  cmv          NUMERIC,
  comissao     NUMERIC,
  frete        NUMERIC,
  impostos     NUMERIC,
  lucro        NUMERIC,
  lucro_pct    NUMERIC,
  pedidos      BIGINT,
  unidades     BIGINT,
  has_cmv      BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    o.item_id,
    MAX(o.titulo)                                                          AS titulo,
    MAX(o.sku)                                                             AS sku,
    MAX(o.listing_type)                                                    AS listing_type,
    COALESCE(SUM(o.receita_bruta), 0)                                     AS receita,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)                         AS cmv,
    COALESCE(SUM(o.comissao), 0)                                          AS comissao,
    COALESCE(SUM(o.frete), 0)                                             AS frete,
    COALESCE(SUM(o.tax_amount), 0)                                        AS impostos,
    COALESCE(SUM(
      o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
      - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)
    ), 0)                                                                  AS lucro,
    CASE WHEN SUM(o.receita_bruta) > 0 THEN
      ROUND(SUM(
        o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
        - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)
      ) / SUM(o.receita_bruta) * 100, 2)
    ELSE NULL END                                                          AS lucro_pct,
    COUNT(*)                                                               AS pedidos,
    COALESCE(SUM(o.quantidade), 0)                                        AS unidades,
    BOOL_OR(o.custo_unit IS NOT NULL)                                     AS has_cmv
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to
    AND o.item_id IS NOT NULL
  GROUP BY o.item_id
  ORDER BY lucro DESC
  LIMIT 500;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- RPC 4: agregado por marca
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_margin_by_brand(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  marca     TEXT,
  receita   NUMERIC,
  cmv       NUMERIC,
  comissao  NUMERIC,
  frete     NUMERIC,
  impostos  NUMERIC,
  lucro     NUMERIC,
  lucro_pct NUMERIC,
  pedidos   BIGINT,
  has_cmv   BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(o.marca, 'Sem marca')                                        AS marca,
    COALESCE(SUM(o.receita_bruta), 0)                                     AS receita,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)                         AS cmv,
    COALESCE(SUM(o.comissao), 0)                                          AS comissao,
    COALESCE(SUM(o.frete), 0)                                             AS frete,
    COALESCE(SUM(o.tax_amount), 0)                                        AS impostos,
    COALESCE(SUM(
      o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
      - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)
    ), 0)                                                                  AS lucro,
    CASE WHEN SUM(o.receita_bruta) > 0 THEN
      ROUND(SUM(
        o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
        - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)
      ) / SUM(o.receita_bruta) * 100, 2)
    ELSE NULL END                                                          AS lucro_pct,
    COUNT(*)                                                               AS pedidos,
    BOOL_OR(o.custo_unit IS NOT NULL)                                     AS has_cmv
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to
  GROUP BY COALESCE(o.marca, 'Sem marca')
  ORDER BY lucro DESC;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- RPC 5: agregado por estado (top 30)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_margin_by_estado(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  estado    TEXT,
  receita   NUMERIC,
  lucro     NUMERIC,
  lucro_pct NUMERIC,
  pedidos   BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(o.estado, 'Desconhecido')                                    AS estado,
    COALESCE(SUM(o.receita_bruta), 0)                                     AS receita,
    COALESCE(SUM(
      o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
      - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)
    ), 0)                                                                  AS lucro,
    CASE WHEN SUM(o.receita_bruta) > 0 THEN
      ROUND(SUM(
        o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
        - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)
      ) / SUM(o.receita_bruta) * 100, 2)
    ELSE NULL END                                                          AS lucro_pct,
    COUNT(*)                                                               AS pedidos
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to
  GROUP BY COALESCE(o.estado, 'Desconhecido')
  ORDER BY lucro DESC
  LIMIT 30;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- RPC 6: waterfall de custos (substitui useMLCostWaterfall SELECT)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cost_waterfall(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  paid_revenue  NUMERIC,
  cmv           NUMERIC,
  total_comissao NUMERIC,
  total_frete   NUMERIC,
  total_tax     NUMERIC,
  orders_count  BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(CASE WHEN o.status IN ('paid','shipped','delivered') THEN o.receita_bruta ELSE 0 END), 0) AS paid_revenue,
    COALESCE(SUM(COALESCE(o.custo_unit, 0) * o.quantidade), 0)                                           AS cmv,
    COALESCE(SUM(o.comissao), 0)                                                                          AS total_comissao,
    COALESCE(SUM(o.frete), 0)                                                                             AS total_frete,
    COALESCE(SUM(o.tax_amount), 0)                                                                        AS total_tax,
    COUNT(CASE WHEN o.status IN ('paid','shipped','delivered') THEN 1 END)                                AS orders_count
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.data_pedido::date BETWEEN p_from AND p_to;
$$;

-- Grants para authenticated (hooks do browser chamam com JWT do usuário)
GRANT EXECUTE ON FUNCTION public.get_margin_summary(UUID, TEXT[], DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_margin_by_day(UUID, TEXT[], DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_margin_by_product(UUID, TEXT[], DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_margin_by_brand(UUID, TEXT[], DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_margin_by_estado(UUID, TEXT[], DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cost_waterfall(UUID, TEXT[], DATE, DATE) TO authenticated;
