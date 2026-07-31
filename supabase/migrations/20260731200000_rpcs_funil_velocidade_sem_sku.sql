-- CLEAN-02 (milestone Consolidação) — as 3 RPCs que soltam o MCP do próprio banco.
--
-- ⚠️ CORRIGIDO na mesma sessão pela migration 20260731201000: get_sales_velocity
-- e get_listings_without_sku perderam o parâmetro p_user_ids. Motivo: o gerador
-- do MCP só injeta p_user_ids em tools de PERÍODO; RPC sem período do garment
-- filtra só por p_org_id (ver get_replenishment). O erro apareceu como
-- PGRST202 no primeiro smoke E2E.
--
-- O MCP tinha 8 tools lendo o banco dele. Três delas — funil de conversão,
-- velocidade de vendas e anúncios sem SKU — não tinham equivalente no garment,
-- e por isso prendiam as Edge Functions de sync-visits, sync-tiny-stock e
-- sync-inventory-snapshots. Estas RPCs são o substituto.
--
-- Padrão obrigatório do projeto: LANGUAGE sql STABLE SECURITY INVOKER,
-- RLS org-first (p_org_id nunca vem do chamador no MCP — o garment_client
-- resolve pelo seller), GRANT explícito, sem subquery correlacionada.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_conversion_funnel — funil diário da conta
-- ─────────────────────────────────────────────────────────────────────────────
-- LIMITAÇÃO DECLARADA: o funil é por DIA e por CONTA, não por anúncio.
-- Visita por anúncio existe no garment apenas como snapshot acumulado
-- (ml_inventory_cache.visits = total desde que o anúncio nasceu), não como
-- série temporal. Dividir venda-do-período por visita-de-sempre não é taxa de
-- conversão — é número enganoso. Quem precisar de CVR por anúncio no período
-- continua usando get_visits do MCP, que consulta a API do ML ao vivo.

CREATE OR REPLACE FUNCTION public.get_conversion_funnel(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  dia            DATE,
  visitas        BIGINT,
  compradores    BIGINT,
  pedidos        BIGINT,
  unidades       BIGINT,
  receita        NUMERIC,
  cvr_pct        NUMERIC,
  ticket_medio   NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    d.date                                                        AS dia,
    COALESCE(SUM(d.unique_visits), 0)::BIGINT                     AS visitas,
    COALESCE(SUM(d.unique_buyers), 0)::BIGINT                     AS compradores,
    COALESCE(SUM(d.qty_orders), 0)::BIGINT                        AS pedidos,
    COALESCE(SUM(d.units_sold), 0)::BIGINT                        AS unidades,
    COALESCE(SUM(d.approved_revenue), 0)                          AS receita,
    CASE WHEN SUM(d.unique_visits) > 0
      THEN ROUND(SUM(d.qty_orders)::NUMERIC / SUM(d.unique_visits) * 100, 2)
    END                                                           AS cvr_pct,
    CASE WHEN SUM(d.qty_orders) > 0
      THEN ROUND(SUM(d.approved_revenue) / SUM(d.qty_orders), 2)
    END                                                           AS ticket_medio
  FROM public.ml_daily_cache d
  WHERE d.organization_id = p_org_id
    AND d.ml_user_id = ANY(p_user_ids)
    AND d.date BETWEEN p_from AND p_to
  GROUP BY d.date
  ORDER BY d.date;
$$;

COMMENT ON FUNCTION public.get_conversion_funnel(UUID, TEXT[], DATE, DATE) IS
  'Funil diário da conta: visitas, compradores, pedidos, unidades, receita e CVR. '
  'Por DIA e por CONTA — visita por anúncio no período não existe no garment '
  '(só snapshot acumulado). Para CVR por anúncio use get_visits do MCP (API ML ao vivo).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_sales_velocity — giro por SKU e cobertura de estoque
-- ─────────────────────────────────────────────────────────────────────────────
-- Junta venda do período (orders) com estoque atual (ml_inventory_cache).
-- O vínculo é orders.sku = ml_inventory_cache.seller_custom_field — o SKU, não
-- o variation_id: no catálogo do ML cada cor/tamanho é um MLB separado.

CREATE OR REPLACE FUNCTION public.get_sales_velocity(
  p_org_id     UUID,
  p_user_ids   TEXT[],
  p_days       INT DEFAULT 30,
  p_min_units  INT DEFAULT 1,
  p_limit      INT DEFAULT 60
)
RETURNS TABLE (
  sku              TEXT,
  titulo           TEXT,
  unidades         BIGINT,
  unidades_por_dia NUMERIC,
  receita          NUMERIC,
  estoque_atual    BIGINT,
  dias_cobertura   NUMERIC,
  alerta_ruptura   BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH vendas AS MATERIALIZED (
    SELECT
      o.sku,
      MAX(o.titulo)                     AS titulo,
      SUM(o.quantidade)::BIGINT         AS unidades,
      COALESCE(SUM(o.receita_bruta), 0) AS receita
    FROM public.orders o
    WHERE o.organization_id = p_org_id
      AND o.ml_user_id = ANY(p_user_ids)
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date >= CURRENT_DATE - p_days
      AND o.sku IS NOT NULL
      AND TRIM(o.sku) <> ''
    GROUP BY o.sku
    HAVING SUM(o.quantidade) >= p_min_units
  ),
  estoque AS MATERIALIZED (
    SELECT
      i.seller_custom_field                       AS sku,
      SUM(i.available_quantity)::BIGINT           AS estoque
    FROM public.ml_inventory_cache i
    WHERE i.organization_id = p_org_id
      AND i.ml_user_id = ANY(p_user_ids)
      AND i.seller_custom_field IS NOT NULL
      AND TRIM(i.seller_custom_field) <> ''
    GROUP BY i.seller_custom_field
  )
  SELECT
    v.sku,
    v.titulo,
    v.unidades,
    ROUND(v.unidades::NUMERIC / GREATEST(p_days, 1), 3)          AS unidades_por_dia,
    v.receita,
    COALESCE(e.estoque, 0)                                       AS estoque_atual,
    CASE WHEN v.unidades > 0
      THEN ROUND(COALESCE(e.estoque, 0)::NUMERIC
                 / (v.unidades::NUMERIC / GREATEST(p_days, 1)), 1)
    END                                                          AS dias_cobertura,
    (COALESCE(e.estoque, 0)::NUMERIC
       / NULLIF(v.unidades::NUMERIC / GREATEST(p_days, 1), 0)) < 15
                                                                 AS alerta_ruptura
  FROM vendas v
  LEFT JOIN estoque e ON e.sku = v.sku
  ORDER BY v.unidades DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_sales_velocity(UUID, TEXT[], INT, INT, INT) IS
  'Giro por SKU no período e cobertura de estoque em dias. alerta_ruptura=true '
  'quando a cobertura cai abaixo de 15 dias. Vínculo por SKU '
  '(orders.sku = ml_inventory_cache.seller_custom_field), nunca por variation_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_listings_without_sku — higiene de catálogo
-- ─────────────────────────────────────────────────────────────────────────────
-- Anúncio sem SKU não entra em reposição, não casa com custo e não aparece em
-- análise por SKU. Se ainda tem estoque, é ruptura invisível: vende e ninguém
-- repõe.

CREATE OR REPLACE FUNCTION public.get_listings_without_sku(
  p_org_id   UUID,
  p_user_ids TEXT[]
)
RETURNS TABLE (
  item_id            TEXT,
  titulo             TEXT,
  status             TEXT,
  estoque            BIGINT,
  preco              NUMERIC,
  valor_em_risco     NUMERIC,
  ruptura_invisivel  BOOLEAN,
  url_editar         TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    i.item_id,
    i.title                                              AS titulo,
    i.status,
    COALESCE(i.available_quantity, 0)::BIGINT            AS estoque,
    i.price                                              AS preco,
    ROUND(COALESCE(i.available_quantity, 0) * COALESCE(i.price, 0), 2)
                                                         AS valor_em_risco,
    (i.status = 'active' AND COALESCE(i.available_quantity, 0) > 0)
                                                         AS ruptura_invisivel,
    'https://www.mercadolivre.com.br/anuncios/' || i.item_id || '/modificar'
                                                         AS url_editar
  FROM public.ml_inventory_cache i
  WHERE i.organization_id = p_org_id
    AND i.ml_user_id = ANY(p_user_ids)
    AND (i.seller_custom_field IS NULL OR TRIM(i.seller_custom_field) = '')
  ORDER BY (COALESCE(i.available_quantity, 0) * COALESCE(i.price, 0)) DESC;
$$;

COMMENT ON FUNCTION public.get_listings_without_sku(UUID, TEXT[]) IS
  'Anúncios sem SKU cadastrado. ruptura_invisivel=true quando o anúncio está '
  'ativo COM estoque: vende, mas não entra em reposição nem casa com custo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — regra 2 do rpc_catalog.json: authenticated precisa de EXECUTE,
-- senão o usuário de serviço do MCP não roda.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.get_conversion_funnel(UUID, TEXT[], DATE, DATE)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_velocity(UUID, TEXT[], INT, INT, INT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_listings_without_sku(UUID, TEXT[])
  TO anon, authenticated, service_role;
