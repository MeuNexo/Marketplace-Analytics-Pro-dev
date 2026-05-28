-- Fix migration drift: batch_upsert_orders tinha ::uuid cast em ml_user_id (coluna TEXT)
-- e get_cost_waterfall sem filtro de status. Ambas falhavam silenciosamente desde 2026-05-27.

-- ──────────────────────────────────────────────────────────────────────────────
-- FIX 1: batch_upsert_orders — remover ::uuid cast de ml_user_id (é TEXT)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.batch_upsert_orders(p_records JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO public.orders (
    ml_order_id, ml_user_id, item_id, variation_id, seller_id,
    user_id, organization_id, sku, titulo, listing_type,
    quantidade, preco_unit, comissao, frete, status,
    data_pedido, data_pagamento, estado, cidade, comprador,
    synced_at, custo_unit, tax_rate, tax_amount,
    uf_origem, receita_bruta, receita_liquida, marca
  )
  SELECT
    (r->>'ml_order_id'),
    (r->>'ml_user_id'),
    (r->>'item_id'),
    (r->>'variation_id'),
    (r->>'seller_id'),
    (r->>'user_id')::uuid,
    (r->>'organization_id')::uuid,
    (r->>'sku'),
    (r->>'titulo'),
    (r->>'listing_type'),
    (r->>'quantidade')::integer,
    (r->>'preco_unit')::numeric,
    (r->>'comissao')::numeric,
    (r->>'frete')::numeric,
    (r->>'status'),
    (r->>'data_pedido')::timestamptz,
    (r->>'data_pagamento')::timestamptz,
    (r->>'estado'),
    (r->>'cidade'),
    (r->>'comprador'),
    (r->>'synced_at')::timestamptz,
    NULLIF(r->>'custo_unit', '')::numeric,
    NULLIF(r->>'tax_rate', '')::numeric,
    NULLIF(r->>'tax_amount', '')::numeric,
    (r->>'uf_origem'),
    (r->>'receita_bruta')::numeric,
    (r->>'receita_liquida')::numeric,
    (r->>'marca')
  FROM jsonb_array_elements(p_records) AS r
  ON CONFLICT (ml_order_id, ml_user_id, item_id, variation_id)
  DO UPDATE SET
    seller_id       = EXCLUDED.seller_id,
    user_id         = EXCLUDED.user_id,
    organization_id = EXCLUDED.organization_id,
    sku             = EXCLUDED.sku,
    titulo          = EXCLUDED.titulo,
    listing_type    = EXCLUDED.listing_type,
    quantidade      = EXCLUDED.quantidade,
    preco_unit      = EXCLUDED.preco_unit,
    comissao        = EXCLUDED.comissao,
    frete           = EXCLUDED.frete,
    status          = EXCLUDED.status,
    data_pedido     = EXCLUDED.data_pedido,
    data_pagamento  = EXCLUDED.data_pagamento,
    estado          = EXCLUDED.estado,
    cidade          = EXCLUDED.cidade,
    comprador       = EXCLUDED.comprador,
    synced_at       = EXCLUDED.synced_at,
    custo_unit      = COALESCE(EXCLUDED.custo_unit, orders.custo_unit),
    tax_rate        = EXCLUDED.tax_rate,
    tax_amount      = EXCLUDED.tax_amount,
    uf_origem       = EXCLUDED.uf_origem,
    receita_bruta   = EXCLUDED.receita_bruta,
    receita_liquida = EXCLUDED.receita_liquida,
    marca           = EXCLUDED.marca;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.batch_upsert_orders(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.batch_upsert_orders(JSONB) TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- FIX 2: get_cost_waterfall — adicionar filtro de status + CMV correto
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cost_waterfall(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  paid_revenue   NUMERIC,
  cmv            NUMERIC,
  total_comissao NUMERIC,
  total_frete    NUMERIC,
  total_tax      NUMERIC,
  orders_count   BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(o.receita_bruta), 0)             AS paid_revenue,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0) AS cmv,
    COALESCE(SUM(o.comissao), 0)                  AS total_comissao,
    COALESCE(SUM(o.frete), 0)                     AS total_frete,
    COALESCE(SUM(o.tax_amount), 0)                AS total_tax,
    COUNT(*)                                       AS orders_count
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to;
$$;

GRANT EXECUTE ON FUNCTION public.get_cost_waterfall(UUID, TEXT[], DATE, DATE) TO authenticated;
