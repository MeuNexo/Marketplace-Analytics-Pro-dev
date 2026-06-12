-- Phase 41 / DATA-01 (ex-Phase 32): CMV e Impostos zerados no card Custos.
--
-- Substitui a migration local 20260601000000 (nunca aplicada em produção), que
-- continha uma versão de batch_upsert_orders SEM o cast ::uuid de seller_id —
-- aplicá-la reverteria o fix da Phase 38 (20260604130000) e recongelaria o sync.
-- Esta migration mescla os dois fixes sobre a versão vigente em produção.
--
-- Fix 1: get_cost_waterfall — orders com receita_bruta NULL ainda contribuem
--         para paid_revenue via fallback preco_unit * quantidade. Evita que o
--         guard `paid_revenue === 0` do hook anule CMV/Impostos no card.
--
-- Fix 2: batch_upsert_orders — preserva receita_bruta/receita_liquida
--         existentes quando o novo valor é NULL (mesmo padrão de custo_unit),
--         mantendo os casts NULLIF(...)::uuid do fix da Phase 38.
--
-- Fix 3: backfill idempotente de receita_bruta (hoje 0 linhas — proteção).

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
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(
      COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)
    ), 0)                                                        AS paid_revenue,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)                AS cmv,
    COALESCE(SUM(o.comissao), 0)                                 AS total_comissao,
    COALESCE(SUM(o.frete), 0)                                    AS total_frete,
    COALESCE(SUM(o.tax_amount), 0)                               AS total_tax,
    COUNT(*)                                                     AS orders_count
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to;
$$;

GRANT EXECUTE ON FUNCTION public.get_cost_waterfall(UUID, TEXT[], DATE, DATE) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- FIX 2: batch_upsert_orders — preserva receita_bruta/receita_liquida em
--         re-sync, mantendo casts ::uuid da Phase 38
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.batch_upsert_orders(p_records jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    NULLIF(r->>'seller_id', '')::uuid,
    NULLIF(r->>'user_id', '')::uuid,
    NULLIF(r->>'organization_id', '')::uuid,
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
    receita_bruta   = COALESCE(EXCLUDED.receita_bruta, orders.receita_bruta),
    receita_liquida = COALESCE(EXCLUDED.receita_liquida, orders.receita_liquida),
    marca           = EXCLUDED.marca;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.batch_upsert_orders(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.batch_upsert_orders(JSONB) TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- FIX 3: backfill idempotente de receita_bruta
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE public.orders
SET receita_bruta = preco_unit * quantidade
WHERE receita_bruta IS NULL
  AND preco_unit IS NOT NULL
  AND quantidade IS NOT NULL;
