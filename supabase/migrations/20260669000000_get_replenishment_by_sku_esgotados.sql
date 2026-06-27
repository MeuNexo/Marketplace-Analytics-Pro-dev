-- ============================================================
-- Phase 69 — Reposição de esgotados (demanda censurada)
--
-- Herdado da 20260668000300 (alvo order-up-to, GREATEST(meta_cobertura, lead+7)).
-- Mudanças sobre a base 300:
--
--   1. Classificação por recência (status_esgotado) — aplica SOMENTE quando
--      sku_stock=0 E venda da janela 30d=0 (demanda censurada):
--        'repor_esgotado'   : última venda ≤ 90d  → estima venda_dia, sugere compra.
--        'revisar_esgotado' : última venda 91–365d → sinaliza, compra_sugerida=0.
--        'descontinuar'     : última venda >365d ou nunca vendido → compra=0.
--        'com_giro'         : venda 30d>0 → caminho atual intocado.
--
--   2. Estimativa "melhor ritmo" (apenas repor_esgotado):
--        - Maior soma de vendas em qualquer janela de 30d consecutivos nos últimos
--          180d ÷ 30  (reflete demand de quando havia estoque).
--        - Proteção anti-pico: exige ≥2 dias distintos com venda no período 180d;
--          senão cai na média conservadora (soma_90d / 90).
--        - Abordagem SET-BASED (self-join de daily_qty_180d) — NUNCA subquery
--          correlacionada por linha, que estouraria o statement_timeout de 8s do
--          role authenticated (lição de timeout RLS, registrada na memória do projeto).
--
--   3. Transparência: venda_dia_origem='historico_esgotado' para as linhas estimadas.
--
--   4. Nova coluna de retorno: status_esgotado TEXT (36ª coluna, após venda_inteligente).
--
-- Constantes calibráveis no DECLARE (mudar aqui = redeployar):
--   v_recency_repor_days   = 90
--   v_recency_revisar_days = 365
--   v_best_window_days     = 30
--   v_best_lookback_days   = 180
--   v_min_distinct_days    = 2
--   v_conservative_days    = 90
--
-- SECURITY INVOKER, assinatura 4-arg. RETURNS TABLE agora com 36 colunas.
-- NÃO toca na RPC get_replenishment (Phase 62 — outra função).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN);

CREATE OR REPLACE FUNCTION public.get_replenishment_by_sku(
  p_org_id            UUID,
  p_sales_window_days INTEGER DEFAULT 30,
  p_demand_multiplier NUMERIC  DEFAULT 1.0,
  p_smart             BOOLEAN  DEFAULT FALSE
)
RETURNS TABLE (
  item_id TEXT, variation_id TEXT, title TEXT, brand TEXT, sku_code TEXT,
  attribute_combinations JSONB, logistic_type TEXT, sku_stock INTEGER,
  venda_dia NUMERIC, cobertura_atual NUMERIC, ponto_reposicao NUMERIC, alvo NUMERIC,
  compra_sugerida INTEGER, valor_estimado NUMERIC, custo_ausente BOOLEAN, sem_giro BOOLEAN,
  gatilho_ativo BOOLEAN, param_lead_time INTEGER, param_cobertura INTEGER, param_safety INTEGER,
  param_moq INTEGER, param_pack INTEGER, param_origem TEXT, qtd_a_caminho INTEGER,
  data_proxima_chegada DATE, venda_dia_origem TEXT, lead_time_origem TEXT, tendencia TEXT,
  fator_sazonal NUMERIC, lead_time_real INTEGER,
  venda_simples NUMERIC, venda_inteligente NUMERIC,
  status_esgotado TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_cutoff DATE    := CURRENT_DATE - p_sales_window_days;
  v_smart  BOOLEAN := COALESCE(p_smart, FALSE);
  -- Constantes nomeadas para classificação de esgotados (calibráveis sem mudar lógica)
  v_recency_repor_days   INTEGER := 90;   -- corte para 'repor_esgotado'
  v_recency_revisar_days INTEGER := 365;  -- corte para 'revisar_esgotado'
  v_best_window_days     INTEGER := 30;   -- tamanho da janela "melhor ritmo" em dias
  v_best_lookback_days   INTEGER := 180;  -- lookback do melhor ritmo
  v_min_distinct_days    INTEGER := 2;    -- mínimo de dias distintos com venda (anti-pico)
  v_conservative_days    INTEGER := 90;   -- janela da estimativa conservadora
BEGIN
  RETURN QUERY
  WITH
  -- ──────────────────────────────────────────────────────────
  -- CTEs EXISTENTES (inalteradas desde 20260668000300)
  -- ──────────────────────────────────────────────────────────
  inventory_by_sku AS MATERIALIZED (
    SELECT i.item_id, i.title, i.brand, i.logistic_type, v.variation_id, v.attribute_combinations,
      v.available_quantity AS sku_stock, v.seller_custom_field AS sku_code
    FROM ml_inventory_cache i CROSS JOIN LATERAL jsonb_to_recordset(i.variations) AS v(
      variation_id TEXT, attribute_combinations JSONB, available_quantity INTEGER, sold_quantity INTEGER, seller_custom_field TEXT)
    WHERE i.organization_id = p_org_id AND i.status = 'active' AND i.has_variations = TRUE AND jsonb_array_length(i.variations) > 0
    UNION ALL
    SELECT i.item_id, i.title, i.brand, i.logistic_type, NULL::TEXT, NULL::JSONB, i.available_quantity, i.seller_custom_field
    FROM ml_inventory_cache i WHERE i.organization_id = p_org_id AND i.status = 'active' AND (i.has_variations = FALSE OR jsonb_array_length(i.variations) = 0)
  ),
  params_lookup AS MATERIALIZED (
    SELECT rp.scope, rp.scope_value, rp.lead_time_dias, rp.meta_cobertura_dias, rp.safety_days, rp.moq, rp.pack_multiple
    FROM replenishment_params rp WHERE rp.organization_id = p_org_id
  ),
  costs_by_sku AS MATERIALIZED (
    SELECT DISTINCT ON (c.seller_sku) c.seller_sku, c.cost FROM ml_product_costs c
    WHERE c.organization_id = p_org_id AND c.seller_sku IS NOT NULL AND c.seller_sku <> '' ORDER BY c.seller_sku, c.updated_at DESC NULLS LAST
  ),
  costs_by_item AS MATERIALIZED (
    SELECT DISTINCT ON (c.item_id) c.item_id, c.cost FROM ml_product_costs c
    WHERE c.organization_id = p_org_id ORDER BY c.item_id, c.updated_at DESC NULLS LAST
  ),
  row_sales AS (
    SELECT inv.item_id, inv.variation_id, inv.title, inv.brand, inv.logistic_type, inv.attribute_combinations, inv.sku_code, inv.sku_stock,
      COALESCE(SUM(o.quantidade), 0)::NUMERIC AS total_qty
    FROM inventory_by_sku inv LEFT JOIN orders o ON o.organization_id = p_org_id AND o.item_id = inv.item_id
      AND (o.variation_id = inv.variation_id OR (inv.variation_id IS NULL AND o.variation_id = '')) AND o.data_pedido::timestamptz::date >= v_cutoff AND o.status = 'paid'
    GROUP BY inv.item_id, inv.variation_id, inv.title, inv.brand, inv.logistic_type, inv.attribute_combinations, inv.sku_code, inv.sku_stock
  ),
  canon AS (
    SELECT rs.item_id, rs.variation_id, rs.title, rs.brand, rs.logistic_type, rs.attribute_combinations, rs.sku_code, rs.sku_stock
    FROM (SELECT rs2.*, ROW_NUMBER() OVER (PARTITION BY CASE WHEN rs2.sku_code IS NOT NULL AND rs2.sku_code <> '' THEN rs2.sku_code ELSE rs2.item_id || '::' || COALESCE(rs2.variation_id, '') END
            ORDER BY rs2.total_qty DESC NULLS LAST, rs2.sku_stock DESC, rs2.item_id) AS rn FROM row_sales rs2) rs WHERE rs.rn = 1
  ),
  sales_by_sku AS (
    SELECT rs.sku_code, SUM(rs.total_qty) / NULLIF(p_sales_window_days::NUMERIC, 0) AS avg_daily
    FROM row_sales rs WHERE rs.sku_code IS NOT NULL AND rs.sku_code <> '' GROUP BY rs.sku_code
  ),
  incoming_by_sku AS (
    SELECT po.sku AS sku_code, SUM(po.quantidade)::INTEGER AS qtd_a_caminho,
      COALESCE(MIN(po.data_entrega) FILTER (WHERE po.data_entrega >= CURRENT_DATE), MIN(po.data_entrega)) AS data_proxima_chegada
    FROM purchase_orders po WHERE po.organization_id = p_org_id GROUP BY po.sku
  ),
  fornecedor_by_sku AS (
    SELECT DISTINCT ON (sub.sku_code) sub.sku_code, sub.fornecedor FROM (
      SELECT po.sku AS sku_code, po.fornecedor, SUM(po.quantidade) AS total_qty, MAX(COALESCE(po.data_entrega, po.data_pedido)) AS ultima_data
      FROM public.purchase_orders po WHERE po.organization_id = p_org_id AND po.fornecedor IS NOT NULL GROUP BY po.sku, po.fornecedor) sub
    ORDER BY sub.sku_code, sub.total_qty DESC, sub.ultima_data DESC NULLS LAST
  ),
  ewma_sales AS (
    SELECT sku_week.sku_code,
      SUM(sku_week.week_qty * POWER(0.7, sku_week.week_offset)) / NULLIF(SUM(POWER(0.7, sku_week.week_offset)), 0) / 7.0 AS ewma_daily,
      COUNT(*) AS weeks_with_sales,
      SUM(sku_week.week_qty * POWER(0.7, sku_week.week_offset)) FILTER (WHERE sku_week.week_offset < 4) / NULLIF(SUM(POWER(0.7, sku_week.week_offset)) FILTER (WHERE sku_week.week_offset < 4), 0) / 7.0 AS ewma_recent_daily,
      SUM(sku_week.week_qty * POWER(0.7, sku_week.week_offset)) FILTER (WHERE sku_week.week_offset BETWEEN 4 AND 11) / NULLIF(SUM(POWER(0.7, sku_week.week_offset)) FILTER (WHERE sku_week.week_offset BETWEEN 4 AND 11), 0) / 7.0 AS ewma_older_daily
    FROM (SELECT inv.sku_code, var_wk.week_offset, SUM(var_wk.week_qty) AS week_qty FROM inventory_by_sku inv JOIN (
        SELECT o2.item_id, o2.variation_id, FLOOR(EXTRACT(EPOCH FROM (DATE_TRUNC('week', CURRENT_DATE::date) - DATE_TRUNC('week', o2.data_pedido::date))) / (7 * 86400))::INTEGER AS week_offset, SUM(o2.quantidade) AS week_qty
        FROM orders o2 WHERE o2.organization_id = p_org_id AND v_smart AND o2.data_pedido::date >= CURRENT_DATE - 84 AND o2.status = 'paid'
        GROUP BY o2.item_id, o2.variation_id, FLOOR(EXTRACT(EPOCH FROM (DATE_TRUNC('week', CURRENT_DATE::date) - DATE_TRUNC('week', o2.data_pedido::date))) / (7 * 86400))::INTEGER) var_wk
      ON var_wk.item_id = inv.item_id AND (var_wk.variation_id = inv.variation_id OR (inv.variation_id IS NULL AND var_wk.variation_id = '')) WHERE inv.sku_code IS NOT NULL AND inv.sku_code <> '' GROUP BY inv.sku_code, var_wk.week_offset) sku_week
    GROUP BY sku_week.sku_code
  ),
  seasonal_index AS (
    WITH brand_by_item AS (SELECT DISTINCT mic.item_id, mic.brand FROM ml_inventory_cache mic WHERE mic.organization_id = p_org_id AND mic.brand IS NOT NULL AND mic.brand <> '' AND v_smart),
    monthly_raw AS (SELECT b.brand AS brand, EXTRACT(MONTH FROM o.data_pedido::date)::INTEGER AS mes, SUM(o.quantidade) / NULLIF(COUNT(DISTINCT EXTRACT(YEAR FROM o.data_pedido::date)::INTEGER), 0) AS avg_qty_month
      FROM orders o INNER JOIN brand_by_item b ON b.item_id = o.item_id WHERE o.organization_id = p_org_id AND o.status = 'paid' AND o.data_pedido::date >= CURRENT_DATE - 730 GROUP BY b.brand, EXTRACT(MONTH FROM o.data_pedido::date)::INTEGER),
    stats AS (SELECT mr.brand AS brand, mr.mes AS mes, mr.avg_qty_month AS avg_qty_month, AVG(mr.avg_qty_month) OVER (PARTITION BY mr.brand) AS brand_global_avg, COUNT(*) OVER (PARTITION BY mr.brand) AS months_covered FROM monthly_raw mr)
    SELECT st.brand AS brand, CASE WHEN st.months_covered >= 12 THEN GREATEST(0.5, LEAST(2.5, st.avg_qty_month / NULLIF(st.brand_global_avg, 0))) ELSE 1.0 END AS fator_sazonal, (st.months_covered >= 12) AS sazonal_ativa
    FROM stats st WHERE st.mes = EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER
  ),
  lead_time_by_fornecedor AS (
    SELECT po.fornecedor, ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY (po.data_entrega - po.data_pedido)))::INTEGER AS median_lead_days, COUNT(*) AS oc_count
    FROM purchase_orders po WHERE po.organization_id = p_org_id AND v_smart AND po.fornecedor IS NOT NULL AND po.fornecedor <> '' AND po.data_entrega IS NOT NULL AND po.data_pedido IS NOT NULL AND po.data_entrega >= po.data_pedido GROUP BY po.fornecedor
  ),

  -- ──────────────────────────────────────────────────────────
  -- NOVAS CTEs — demanda censurada (Phase 69)
  -- ──────────────────────────────────────────────────────────

  -- Histórico por chave canônica: última venda, soma 90d (conservadora),
  -- contagem de dias distintos em 180d (teste anti-pico).
  -- Chave canônica = sku_code quando não-nulo/não-vazio,
  --                  senão item_id || '::' || COALESCE(variation_id,'')
  -- (idêntica à expressão PARTITION BY do CTE canon acima).
  -- Anti-IDOR: filtra organization_id = p_org_id em TODOS os joins com orders.
  sales_history_by_sku AS MATERIALIZED (
    SELECT
      CASE
        WHEN inv.sku_code IS NOT NULL AND inv.sku_code <> ''
        THEN inv.sku_code
        ELSE inv.item_id || '::' || COALESCE(inv.variation_id, '')
      END                                                         AS canon_key,
      MAX(o.data_pedido::timestamptz::date)                       AS ultima_venda,
      (CURRENT_DATE - MAX(o.data_pedido::timestamptz::date))      AS dias_desde_ultima_venda,
      COALESCE(
        SUM(o.quantidade) FILTER (
          WHERE o.data_pedido::timestamptz::date >= CURRENT_DATE - v_conservative_days
        ), 0
      )::NUMERIC                                                  AS soma_90d,
      COUNT(DISTINCT o.data_pedido::timestamptz::date) FILTER (
        WHERE o.data_pedido::timestamptz::date >= CURRENT_DATE - v_best_lookback_days
      )                                                           AS dias_distintos_180d
    FROM inventory_by_sku inv
    LEFT JOIN orders o
      ON  o.organization_id = p_org_id
      AND o.item_id          = inv.item_id
      AND (o.variation_id = inv.variation_id OR (inv.variation_id IS NULL AND o.variation_id = ''))
      AND o.status           = 'paid'
    GROUP BY 1
  ),

  -- Quantidades diárias por chave canônica nos últimos 180d.
  -- Usada no self-join seguinte para calcular o melhor ritmo de 30d.
  -- SET-BASED: sem subquery correlacionada (anti-timeout).
  daily_qty_180d AS MATERIALIZED (
    SELECT
      CASE
        WHEN inv.sku_code IS NOT NULL AND inv.sku_code <> ''
        THEN inv.sku_code
        ELSE inv.item_id || '::' || COALESCE(inv.variation_id, '')
      END                                  AS canon_key,
      o.data_pedido::timestamptz::date     AS sale_date,
      SUM(o.quantidade)                    AS day_qty
    FROM inventory_by_sku inv
    JOIN orders o
      ON  o.organization_id = p_org_id
      AND o.item_id          = inv.item_id
      AND (o.variation_id = inv.variation_id OR (inv.variation_id IS NULL AND o.variation_id = ''))
      AND o.status           = 'paid'
      AND o.data_pedido::timestamptz::date >= CURRENT_DATE - v_best_lookback_days
    GROUP BY 1, 2
  ),

  -- Para cada dia âncora d1 com vendas, soma todas as vendas no intervalo
  -- [d1, d1 + v_best_window_days).  É equivalente a varrer todas as janelas de 30d
  -- e manter a que maximiza a soma — abordagem set-based (self-join).
  window_sums_30d AS (
    SELECT
      d1.canon_key,
      d1.sale_date          AS anchor,
      SUM(d2.day_qty)       AS window_sum
    FROM daily_qty_180d d1
    JOIN daily_qty_180d d2
      ON  d2.canon_key  = d1.canon_key
      AND d2.sale_date >= d1.sale_date
      AND d2.sale_date <  d1.sale_date + v_best_window_days
    GROUP BY d1.canon_key, d1.sale_date
  ),

  -- Melhor ritmo diário: maior soma de 30d ÷ 30.
  best_rate_by_sku AS MATERIALIZED (
    SELECT
      canon_key,
      MAX(window_sum) / v_best_window_days::NUMERIC AS best_rate
    FROM window_sums_30d
    GROUP BY canon_key
  ),

  -- ──────────────────────────────────────────────────────────
  -- CTEs EXISTENTES CONTINUADAS (inalteradas)
  -- ──────────────────────────────────────────────────────────

  -- Motor: simples (espinha) + inteligente (EWMA × sazonal-boost-only) + flags de confiança
  sales_smart AS (
    SELECT c.sku_code, c.item_id, c.variation_id, c.brand,
      COALESCE(sbs.avg_daily, 0) AS avg_simples,
      CASE WHEN v_smart AND es.ewma_daily IS NOT NULL AND es.weeks_with_sales >= 2 THEN es.ewma_daily * GREATEST(1.0, COALESCE(si.fator_sazonal, 1.0)) ELSE NULL END AS avg_inteligente,
      COALESCE(es.weeks_with_sales, 0) AS weeks_with_sales,
      (es.ewma_recent_daily IS NOT NULL AND es.ewma_older_daily IS NOT NULL AND es.ewma_recent_daily > es.ewma_older_daily * 1.20) AS trend_up,
      es.ewma_recent_daily, es.ewma_older_daily, si.fator_sazonal AS si_fator_sazonal, si.sazonal_ativa AS si_sazonal_ativa,
      (v_smart AND si.sazonal_ativa AND COALESCE(si.fator_sazonal, 1.0) > 1.0) AS seasonal_boosted
    FROM canon c LEFT JOIN sales_by_sku sbs ON sbs.sku_code = c.sku_code LEFT JOIN ewma_sales es ON es.sku_code = c.sku_code LEFT JOIN seasonal_index si ON si.brand = c.brand
  ),
  params AS (
    SELECT c.sku_code, c.item_id, c.variation_id,
      COALESCE(CASE WHEN v_smart AND lf.median_lead_days IS NOT NULL AND lf.oc_count >= 2 THEN lf.median_lead_days ELSE NULL END, p_sku.lead_time_dias, p_forn.lead_time_dias, p_marca.lead_time_dias, p_global.lead_time_dias, 30) AS lead_time_dias,
      COALESCE(p_sku.meta_cobertura_dias, p_forn.meta_cobertura_dias, p_marca.meta_cobertura_dias, p_global.meta_cobertura_dias, 60) AS meta_cobertura_dias,
      COALESCE(p_sku.safety_days, p_forn.safety_days, p_marca.safety_days, p_global.safety_days, 7) AS safety_days,
      COALESCE(p_sku.moq, p_forn.moq, p_marca.moq, p_global.moq, 1) AS moq,
      COALESCE(p_sku.pack_multiple, p_forn.pack_multiple, p_marca.pack_multiple, p_global.pack_multiple, 1) AS pack_multiple,
      CASE WHEN p_sku.scope IS NOT NULL THEN 'sku' WHEN forn.fornecedor IS NOT NULL AND p_forn.scope IS NOT NULL THEN 'fornecedor' WHEN p_marca.scope IS NOT NULL THEN 'marca' ELSE 'global' END AS param_origem,
      lf.median_lead_days AS lead_time_real, lf.oc_count AS lead_time_oc_count
    FROM canon c LEFT JOIN fornecedor_by_sku forn ON forn.sku_code = c.sku_code LEFT JOIN lead_time_by_fornecedor lf ON lf.fornecedor = forn.fornecedor
      LEFT JOIN params_lookup p_sku ON p_sku.scope = 'sku' AND p_sku.scope_value = COALESCE(c.sku_code, '')
      LEFT JOIN params_lookup p_forn ON p_forn.scope = 'fornecedor' AND p_forn.scope_value = forn.fornecedor
      LEFT JOIN params_lookup p_marca ON p_marca.scope = 'marca' AND p_marca.scope_value = COALESCE(c.brand, '')
      LEFT JOIN params_lookup p_global ON p_global.scope = 'global'
  ),

  -- ──────────────────────────────────────────────────────────
  -- base — MODIFICADO: junta sales_history + best_rate e injeta
  --         venda_base estimada para o balde repor_esgotado.
  -- ──────────────────────────────────────────────────────────
  base AS (
    SELECT c.item_id, c.variation_id, c.title, c.brand, c.sku_code, c.attribute_combinations, c.logistic_type, c.sku_stock,
      COALESCE(inc.qtd_a_caminho, 0)::INTEGER AS qtd_a_caminho, inc.data_proxima_chegada,
      ss.avg_simples, ss.avg_inteligente, ss.seasonal_boosted, ss.ewma_recent_daily, ss.ewma_older_daily, ss.si_fator_sazonal, ss.si_sazonal_ativa,
      g.aplica_inteligente,
      -- venda_base efetiva: estimada para repor_esgotado, original para os demais
      vbeff.venda_base_eff                    AS venda_base,
      cl.cost                                 AS cost_val,
      pr.lead_time_dias, pr.meta_cobertura_dias, pr.safety_days, pr.moq, pr.pack_multiple, pr.param_origem, pr.lead_time_real, pr.lead_time_oc_count,
      -- Nova coluna de classificação (Phase 69)
      esg.status_esgotado_val                 AS status_esgotado
    FROM canon c
    LEFT JOIN sales_smart ss ON ss.item_id = c.item_id AND ss.variation_id IS NOT DISTINCT FROM c.variation_id
    JOIN params pr ON pr.item_id = c.item_id AND pr.variation_id IS NOT DISTINCT FROM c.variation_id
    LEFT JOIN incoming_by_sku inc ON inc.sku_code = c.sku_code
    LEFT JOIN costs_by_sku clk ON clk.seller_sku = c.sku_code
    LEFT JOIN costs_by_item cli2 ON c.sku_code IS NULL AND cli2.item_id = c.item_id
    LEFT JOIN LATERAL (SELECT COALESCE(clk.cost, cli2.cost) AS cost) cl ON TRUE
    LEFT JOIN LATERAL (SELECT (ss.avg_inteligente IS NOT NULL AND ss.avg_inteligente > ss.avg_simples AND ss.trend_up AND ss.weeks_with_sales >= 3 AND pr.lead_time_dias <= 60) AS aplica_inteligente) g ON TRUE
    -- Junta histórico de vendas por chave canônica (anti-IDOR garantido pela CTE origem)
    LEFT JOIN sales_history_by_sku sh ON sh.canon_key =
      CASE WHEN c.sku_code IS NOT NULL AND c.sku_code <> ''
           THEN c.sku_code
           ELSE c.item_id || '::' || COALESCE(c.variation_id, '')
      END
    LEFT JOIN best_rate_by_sku br ON br.canon_key =
      CASE WHEN c.sku_code IS NOT NULL AND c.sku_code <> ''
           THEN c.sku_code
           ELSE c.item_id || '::' || COALESCE(c.variation_id, '')
      END
    -- LATERAL 1: classifica o balde de esgotado
    LEFT JOIN LATERAL (
      SELECT
        CASE
          -- Com giro: tem estoque ou teve venda na janela 30d → caminho atual intocado
          WHEN NOT (c.sku_stock = 0 AND COALESCE(ss.avg_simples, 0) = 0) THEN 'com_giro'::TEXT
          -- Sem nenhuma venda histórica ou última venda muito antiga → descontinuar
          WHEN sh.ultima_venda IS NULL
            OR sh.dias_desde_ultima_venda > v_recency_revisar_days THEN 'descontinuar'::TEXT
          -- Última venda 91–365d → sinalizar para revisão
          WHEN sh.dias_desde_ultima_venda > v_recency_repor_days   THEN 'revisar_esgotado'::TEXT
          -- Última venda ≤90d → repor (demanda censura, estima venda_dia)
          ELSE 'repor_esgotado'::TEXT
        END AS status_esgotado_val
    ) esg ON TRUE
    -- LATERAL 2: injeta venda_base estimada somente no balde repor_esgotado
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN esg.status_esgotado_val = 'repor_esgotado' THEN
            -- Melhor ritmo: se ≥2 dias distintos e best_rate positivo, usa-o;
            -- senão cai na média conservadora 90d (proteção anti-pico)
            CASE
              WHEN COALESCE(sh.dias_distintos_180d, 0) >= v_min_distinct_days
                AND br.best_rate IS NOT NULL AND br.best_rate > 0
              THEN br.best_rate
              ELSE COALESCE(sh.soma_90d, 0) / v_conservative_days::NUMERIC
            END
          ELSE
            -- Todos os outros baldes: lógica existente inalterada
            CASE WHEN g.aplica_inteligente THEN ss.avg_inteligente ELSE ss.avg_simples END
        END AS venda_base_eff
    ) vbeff ON TRUE
  ),

  -- ──────────────────────────────────────────────────────────
  -- calc — INALTERADO: usa b.venda_base (agora pode ser estimada)
  -- ──────────────────────────────────────────────────────────
  calc AS (
    SELECT b.*,
      (b.venda_base * p_demand_multiplier) AS vd,
      (b.venda_base * p_demand_multiplier * (b.lead_time_dias + b.safety_days)::NUMERIC) AS ponto,
      (b.venda_base * p_demand_multiplier * (GREATEST(b.meta_cobertura_dias, b.lead_time_dias + 7) + b.safety_days)::NUMERIC) AS alvo_v,
      (CASE
        WHEN b.venda_base = 0 THEN 0
        WHEN (b.sku_stock + b.qtd_a_caminho)::NUMERIC > b.venda_base * p_demand_multiplier * (b.lead_time_dias + b.safety_days)::NUMERIC THEN 0
        ELSE GREATEST(CEIL(GREATEST(0, b.venda_base * p_demand_multiplier * (GREATEST(b.meta_cobertura_dias, b.lead_time_dias + 7) + b.safety_days)::NUMERIC - (b.sku_stock + b.qtd_a_caminho)::NUMERIC) / NULLIF(b.pack_multiple, 0)) * b.pack_multiple, b.moq)::INTEGER
      END) AS compra
    FROM base b
  )
  -- ──────────────────────────────────────────────────────────
  -- SELECT FINAL — acrescenta status_esgotado (36ª coluna) e
  --                atualiza venda_dia_origem para historico_esgotado
  -- ──────────────────────────────────────────────────────────
  SELECT
    c.item_id, c.variation_id, c.title, c.brand, c.sku_code, c.attribute_combinations, c.logistic_type, c.sku_stock,
    c.vd AS venda_dia,
    CASE WHEN c.vd > 0 THEN c.sku_stock::NUMERIC / c.vd ELSE NULL END AS cobertura_atual,
    c.ponto AS ponto_reposicao, c.alvo_v AS alvo, c.compra AS compra_sugerida,
    CASE WHEN c.cost_val IS NULL THEN NULL ELSE c.compra::NUMERIC * c.cost_val END AS valor_estimado,
    (c.cost_val IS NULL) AS custo_ausente,
    (c.venda_base = 0 AND c.sku_stock > 0) AS sem_giro,
    ((c.sku_stock + c.qtd_a_caminho)::NUMERIC <= c.ponto) AS gatilho_ativo,
    c.lead_time_dias AS param_lead_time, c.meta_cobertura_dias AS param_cobertura, c.safety_days AS param_safety,
    c.moq AS param_moq, c.pack_multiple AS param_pack, c.param_origem, c.qtd_a_caminho, c.data_proxima_chegada,
    -- venda_dia_origem: indica demanda estimada para esgotados resgatados
    CASE
      WHEN c.status_esgotado = 'repor_esgotado' THEN 'historico_esgotado'
      WHEN c.aplica_inteligente THEN (CASE WHEN c.seasonal_boosted THEN 'ewma_sazonal' ELSE 'ewma' END)
      ELSE 'simples'
    END AS venda_dia_origem,
    CASE WHEN v_smart AND c.lead_time_real IS NOT NULL AND c.lead_time_oc_count >= 2 THEN 'fornecedor_real' ELSE 'param' END AS lead_time_origem,
    CASE WHEN NOT v_smart OR c.ewma_recent_daily IS NULL THEN '~' WHEN c.ewma_recent_daily > c.ewma_older_daily * 1.20 THEN '↑' WHEN c.ewma_recent_daily < c.ewma_older_daily * 0.80 THEN '↓' ELSE '~' END AS tendencia,
    CASE WHEN v_smart AND c.si_sazonal_ativa THEN GREATEST(1.0, c.si_fator_sazonal) ELSE NULL END AS fator_sazonal,
    CASE WHEN v_smart AND c.lead_time_oc_count >= 2 THEN c.lead_time_real ELSE NULL END AS lead_time_real,
    (c.avg_simples * p_demand_multiplier) AS venda_simples,
    (c.avg_inteligente * p_demand_multiplier) AS venda_inteligente,
    -- 36ª coluna: balde de classificação (Phase 69)
    c.status_esgotado
  FROM calc c
  ORDER BY c.compra DESC NULLS LAST, c.item_id, c.variation_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_replenishment_by_sku(UUID, INTEGER, NUMERIC, BOOLEAN) TO authenticated;
