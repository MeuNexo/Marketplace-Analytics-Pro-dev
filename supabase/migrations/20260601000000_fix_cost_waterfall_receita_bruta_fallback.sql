-- Fix: get_cost_waterfall retornava paid_revenue=0 quando receita_bruta é NULL em orders
-- antigos (sincronizados antes da Phase 19). COALESCE(NULL, 0) = 0 ativava o guard
-- `if (paid_revenue === 0) return null` no hook, zerando CMV e Impostos no card Custos.
--
-- Fix 1: get_cost_waterfall — usa COALESCE(receita_bruta, preco_unit * quantidade, 0)
--         para que orders com receita_bruta=NULL ainda contribuam para paid_revenue.
--
-- Fix 2: batch_upsert_orders ON CONFLICT — preserva receita_bruta existente quando
--         o novo valor é NULL (mesmo padrão já aplicado para custo_unit).

-- ──────────────────────────────────────────────────────────────────────────────
-- FIX 1: get_cost_waterfall — fallback receita_bruta → preco_unit * quantidade
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
    COALESCE(SUM(
      COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)
    ), 0)                                                          AS paid_revenue,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)                 AS cmv,
    COALESCE(SUM(o.comissao), 0)                                  AS total_comissao,
    COALESCE(SUM(o.frete), 0)                                     AS total_frete,
    COALESCE(SUM(o.tax_amount), 0)                                AS total_tax,
    COUNT(*)                                                      AS orders_count
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to;
$$;

GRANT EXECUTE ON FUNCTION public.get_cost_waterfall(UUID, TEXT[], DATE, DATE) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- FIX 2: batch_upsert_orders — preservar receita_bruta e receita_liquida
--         existentes quando o novo valor é NULL (evita regressão em re-sync)
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
    NULLIF(r->>'receita_bruta', '')::numeric,
    NULLIF(r->>'receita_liquida', '')::numeric,
    (r->>'marca')
  FROM jsonb_array_elements(p_records) AS r
  ON CONFLICT (ml_order_id, ml_user_id, item_id, variation_id)
  DO UPDATE SET
    seller_id        = EXCLUDED.seller_id,
    user_id          = EXCLUDED.user_id,
    organization_id  = EXCLUDED.organization_id,
    sku              = EXCLUDED.sku,
    titulo           = EXCLUDED.titulo,
    listing_type     = EXCLUDED.listing_type,
    quantidade       = EXCLUDED.quantidade,
    preco_unit       = EXCLUDED.preco_unit,
    comissao         = EXCLUDED.comissao,
    frete            = EXCLUDED.frete,
    status           = EXCLUDED.status,
    data_pedido      = EXCLUDED.data_pedido,
    data_pagamento   = EXCLUDED.data_pagamento,
    estado           = EXCLUDED.estado,
    cidade           = EXCLUDED.cidade,
    comprador        = EXCLUDED.comprador,
    synced_at        = EXCLUDED.synced_at,
    -- Preserva custo_unit histórico se o novo for nulo
    custo_unit       = COALESCE(EXCLUDED.custo_unit, orders.custo_unit),
    tax_rate         = EXCLUDED.tax_rate,
    tax_amount       = EXCLUDED.tax_amount,
    uf_origem        = EXCLUDED.uf_origem,
    -- Preserva receita_bruta existente se o novo valor for nulo (orders legados)
    receita_bruta    = COALESCE(EXCLUDED.receita_bruta, orders.receita_bruta),
    -- Preserva receita_liquida existente se o novo valor for nulo
    receita_liquida  = COALESCE(EXCLUDED.receita_liquida, orders.receita_liquida),
    marca            = EXCLUDED.marca;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.batch_upsert_orders(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.batch_upsert_orders(JSONB) TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- FIX 3: backfill receita_bruta para orders onde é NULL mas preco_unit existe
-- Garante que os orders históricos tenham receita_bruta preenchido,
-- evitando dependência do fallback na RPC a longo prazo.
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE public.orders
SET receita_bruta = preco_unit * quantidade
WHERE receita_bruta IS NULL
  AND preco_unit IS NOT NULL
  AND quantidade IS NOT NULL;
