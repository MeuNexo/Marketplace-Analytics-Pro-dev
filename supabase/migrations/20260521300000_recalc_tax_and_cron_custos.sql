-- Phase 19: Imposto Real + Custo Histórico + Cron Custos
-- 1. Função upsert_order_preserve_cost — preserva custo_unit existente no ON CONFLICT
-- 2. Recálculo de tax_amount/tax_rate para orders existentes (nova fórmula Wesley)
-- 3. pg_cron sync-tiny-costs-daily às 03:00 UTC

-- ── 1. Função DB para upsert preservando custo_unit ──────────────────────────
-- Chamada por sync-ml-orders v10 em vez de .upsert() direto.
-- ON CONFLICT: preserva custo_unit se já tem valor; só preenche quando NULL.

CREATE OR REPLACE FUNCTION public.upsert_order_preserve_cost(
  p_ml_order_id     TEXT,
  p_ml_user_id      TEXT,
  p_item_id         TEXT,
  p_variation_id    TEXT,
  p_seller_id       TEXT,
  p_user_id         TEXT,
  p_organization_id UUID,
  p_sku             TEXT,
  p_titulo          TEXT,
  p_listing_type    TEXT,
  p_quantidade      INTEGER,
  p_preco_unit      NUMERIC,
  p_comissao        NUMERIC,
  p_frete           NUMERIC,
  p_status          TEXT,
  p_data_pedido     TEXT,
  p_data_pagamento  TEXT,
  p_estado          TEXT,
  p_cidade          TEXT,
  p_comprador       TEXT,
  p_synced_at       TIMESTAMPTZ,
  p_custo_unit      NUMERIC,
  p_tax_rate        NUMERIC,
  p_tax_amount      NUMERIC,
  p_uf_origem       TEXT,
  p_receita_bruta   NUMERIC,
  p_receita_liquida NUMERIC,
  p_marca           TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.orders (
    ml_order_id, ml_user_id, item_id, variation_id,
    seller_id, user_id, organization_id, sku, titulo, listing_type,
    quantidade, preco_unit, comissao, frete, status,
    data_pedido, data_pagamento, estado, cidade, comprador,
    synced_at, custo_unit, tax_rate, tax_amount, uf_origem,
    receita_bruta, receita_liquida, marca
  ) VALUES (
    p_ml_order_id, p_ml_user_id, p_item_id, p_variation_id,
    p_seller_id::uuid, p_user_id::uuid, p_organization_id, p_sku, p_titulo, p_listing_type,
    p_quantidade, p_preco_unit, p_comissao, p_frete, p_status,
    p_data_pedido, p_data_pagamento, p_estado, p_cidade, p_comprador,
    p_synced_at, p_custo_unit, p_tax_rate, p_tax_amount, p_uf_origem,
    p_receita_bruta, p_receita_liquida, p_marca
  )
  ON CONFLICT (ml_order_id, ml_user_id, item_id, variation_id)
  DO UPDATE SET
    seller_id       = EXCLUDED.seller_id,
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
    -- custo_unit: preserva se já tem valor; preenche apenas quando NULL
    custo_unit      = CASE
                        WHEN orders.custo_unit IS NOT NULL THEN orders.custo_unit
                        ELSE EXCLUDED.custo_unit
                      END,
    tax_rate        = EXCLUDED.tax_rate,
    tax_amount      = EXCLUDED.tax_amount,
    uf_origem       = EXCLUDED.uf_origem,
    receita_bruta   = EXCLUDED.receita_bruta,
    receita_liquida = EXCLUDED.receita_liquida,
    marca           = EXCLUDED.marca;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_order_preserve_cost TO service_role;


-- ── 2. Recálculo tax_amount/tax_rate para orders existentes ──────────────────
-- Fórmula Wesley: ICMS + PIS×(1-ICMS%) + COFINS×(1-ICMS%)
-- Determina alíquota ICMS por UF destino (estado) usando ml_tax_config
-- UFs de destino reduzido (N/NE/CO/ES): lr_icms_aliquota_inter_norte_nordeste
-- Demais (Sul/Sudeste): lr_icms_aliquota_inter_sul_sudeste

DO $$
DECLARE
  cfg      RECORD;
  cnt      BIGINT;
BEGIN
  FOR cfg IN
    SELECT * FROM public.ml_tax_config WHERE regime = 'lucro_real'
  LOOP
    WITH computed AS (
      SELECT
        o.ml_order_id,
        o.ml_user_id,
        o.item_id,
        o.variation_id,
        -- Determinar alíquota ICMS efetiva
        CASE
          -- Sem UF origem: usa intraestadual (ou 0 se não configurado)
          WHEN cfg.uf_origem IS NULL THEN
            COALESCE(cfg.lr_icms_aliquota_intra, 0)
          -- Mesma UF ou destino desconhecido: intraestadual
          WHEN o.estado IS NULL OR UPPER(o.estado) = UPPER(cfg.uf_origem) THEN
            COALESCE(cfg.lr_icms_aliquota_intra, 0)
          -- Destino Norte/Nordeste/CO/ES: alíquota reduzida
          WHEN UPPER(o.estado) IN (
            'ES','AC','AP','AM','PA','RO','RR','TO',
            'AL','BA','CE','MA','PB','PE','PI','RN','SE',
            'DF','GO','MT','MS'
          ) THEN
            COALESCE(cfg.lr_icms_aliquota_inter_norte_nordeste, 7)
          -- Destino Sul/Sudeste: alíquota padrão
          ELSE
            COALESCE(cfg.lr_icms_aliquota_inter_sul_sudeste, 12)
        END AS icms_aliq,
        o.receita_bruta
      FROM public.orders o
      WHERE o.organization_id = cfg.organization_id
    )
    UPDATE public.orders o
    SET
      tax_rate   = ROUND((c.icms_aliq + (1 - c.icms_aliq / 100.0) * 9.25)::NUMERIC, 6),
      tax_amount = CASE
                     WHEN c.receita_bruta IS NULL THEN NULL
                     ELSE ROUND(
                       c.receita_bruta * (c.icms_aliq + (1 - c.icms_aliq / 100.0) * 9.25) / 100.0,
                       2
                     )
                   END
    FROM computed c
    WHERE o.ml_order_id   = c.ml_order_id
      AND o.ml_user_id    = c.ml_user_id
      AND o.item_id       = c.item_id
      AND o.variation_id  = c.variation_id;

    GET DIAGNOSTICS cnt = ROW_COUNT;
    RAISE NOTICE 'Org %: recalculated % orders (lucro_real)', cfg.organization_id, cnt;
  END LOOP;
END $$;


-- ── 3. pg_cron sync-tiny-costs-daily ─────────────────────────────────────────
-- Roda às 03:00 UTC (00:00 BRT) todos os dias
-- ml_user_id 1639558873 = conta principal Pé Vermeio
-- Usa vault para não expor service_role_key no SQL commitado

DO $$
BEGIN
  PERFORM cron.schedule(
    'sync-tiny-costs-daily',
    '0 3 * * *',
    $cmd$
      SELECT net.http_post(
        url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-tiny-costs',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'service_role_key' LIMIT 1
          )
        ),
        body    := '{"ml_user_id": "1639558873"}'::jsonb
      ) AS request_id;
    $cmd$
  );
  -- Se já existe, atualiza schedule + reativa
  UPDATE cron.job
  SET schedule = '0 3 * * *', active = true
  WHERE jobname = 'sync-tiny-costs-daily';
EXCEPTION WHEN others THEN
  RAISE WARNING 'sync-tiny-costs-daily cron not created: %', SQLERRM;
END $$;
