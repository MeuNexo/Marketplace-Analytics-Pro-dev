-- Phase 96-07 (Trava C): batch_upsert_orders passa a aceitar custo_unit_cheio.
--
-- O PROBLEMA (medido em prod, 2026-07-15): cobertura de orders.custo_unit_cheio
-- despencou para 32,9% em julho, enquanto orders.custo_unit (medio) seguia em
-- 94,9%. A causa NAO era falta de codigo de escrita -- recalc-order-costs v14
-- ja rodava em prod com o costFullBySku. Eram tres travas:
--
--   Trava A (recalc-order-costs, corrigida no mesmo plano): o predicado de
--     only_missing nao incluia custo_unit_cheio.is.null, entao pedido com medio
--     preenchido e cheio NULL nunca entrava no SELECT.
--   Trava B (useAutoRecalc): o gatilho so olha has_cmv/has_tax_data. Documentada
--     como gap conhecido -- ver 96-07-SUMMARY.md.
--   Trava C (ESTA migration + sync-ml-orders): o caminho de INGESTAO.
--
-- POR QUE A TRAVA C E A QUE SUSTENTA A COBERTURA: sync-ml-orders grava
-- custo_unit em TODO pedido novo, na ingestao -- e por isso que o medio fica em
-- ~95% sem depender de ninguem abrir pagina. Nenhum cron chama
-- recalc-order-costs (so o frontend chama). O cheio nao tinha caminho de
-- ingestao NENHUM: os ~80% dos meses antigos eram residuo de um backfill que
-- rodou uma vez so. Com esta migration, a cobertura do cheio passa a rastrear a
-- do medio automaticamente.
--
-- A ARMADILHA QUE ESTA MIGRATION FECHA: batch_upsert_orders tem whitelist
-- EXPLICITA de colunas. Sem custo_unit_cheio no INSERT e no DO UPDATE SET, o
-- campo novo que sync-ml-orders passa no record seria DESCARTADO EM SILENCIO --
-- o fix do lado da EF seria puramente cosmetico. Os dois lados sao obrigatorios.
--
-- SEGURANCA E ACL:
--   - CREATE OR REPLACE, nunca DROP: a assinatura (jsonb -> integer) nao muda,
--     entao a ACL e preservada. DROP apagaria a ACL inteira e esta funcao e
--     chamada por service_role (sync-ml-orders) -- o GRANT da 20260612120000 e
--     o REVOKE de hardening da 20260650000400 (phase 47) seguem valendo.
--   - SECURITY DEFINER + SET search_path TO 'public' mantidos INTOCADOS: e a
--     funcao de escrita de todo pedido, o modelo de seguranca nao muda aqui.
--   - Corpo base = versao VIVA em prod, conferida contra 20260612120000 pelo
--     orquestrador via MCP: identicos, sem drift. A UNICA mudanca desta
--     migration e a coluna custo_unit_cheio nos 3 lugares.
--
-- PADRAO PRESERVE (o COALESCE no DO UPDATE SET): identico ao ja usado por
-- custo_unit/receita_bruta/receita_liquida. E o que impede um re-sync sem cheio
-- (produto ainda sem cost_full no Tiny) de APAGAR um cheio ja gravado pelo
-- backfill ou pelo recalc. Sem o COALESCE, o proximo sync zeraria o backfill.
--
-- custo_unit (medio) NAO e tocado por esta migration -- MCO, precificacao,
-- /analise-precos e /produtos-vendidos leem custo_unit direto e ficam intactos.

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
    synced_at, custo_unit, custo_unit_cheio, tax_rate, tax_amount,
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
    NULLIF(r->>'custo_unit_cheio', '')::numeric,
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
    custo_unit_cheio = COALESCE(EXCLUDED.custo_unit_cheio, orders.custo_unit_cheio),
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
