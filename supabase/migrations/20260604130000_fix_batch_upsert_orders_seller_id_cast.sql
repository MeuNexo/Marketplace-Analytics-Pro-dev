-- FIX CRÍTICO: batch_upsert_orders falhava em TODA chamada com
--   "column seller_id is of type uuid but expression is of type text"
-- porque (r->>'seller_id') era inserido como text sem cast ::uuid.
-- Consequência: sync-ml-orders engolia o erro e retornava orders_synced=0,
-- congelando a tabela orders (parou em 2026-05-27).
-- Fix: cast NULLIF(...)::uuid em seller_id (e blindar user_id/organization_id
-- contra string vazia com NULLIF).
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
$function$;
