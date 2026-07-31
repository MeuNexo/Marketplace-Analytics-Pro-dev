-- Correção da 20260731200000, na mesma sessão.
--
-- O QUE ESTAVA ERRADO
-- `get_sales_velocity` e `get_listings_without_sku` nasceram com `p_user_ids`.
-- O gerador de tools do MCP só injeta `p_user_ids` em tools de PERÍODO; para
-- RPC sem período a convenção do garment é filtrar só por `p_org_id` — é o que
-- `get_replenishment` já fazia. O erro apareceu no primeiro smoke E2E como
-- PGRST202: PostgREST procurou a função com os parâmetros que o MCP mandou e
-- não achou assinatura compatível.
--
-- Isso não é perda de precisão: `p_org_id` já isola a organização, e o RLS
-- org-first continua valendo. Para a Pé Vermeio, org e seller são 1:1.
--
-- SOBRE O DROP
-- Mudar assinatura exige DROP, e **DROP FUNCTION apaga a ACL** — foi assim que
-- em 2026-07-15 a EF nexo-chat quase caiu. Aqui é seguro: estas funções nasceram
-- minutos antes, na migration anterior desta mesma sessão, e os GRANTs são
-- recriados explicitamente ao final. Não havia ACL histórica a preservar.

DROP FUNCTION IF EXISTS public.get_sales_velocity(UUID, TEXT[], INT, INT, INT);
DROP FUNCTION IF EXISTS public.get_listings_without_sku(UUID, TEXT[]);

CREATE OR REPLACE FUNCTION public.get_sales_velocity(
  p_org_id     UUID,
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
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH vendas AS MATERIALIZED (
    SELECT o.sku, MAX(o.titulo) AS titulo, SUM(o.quantidade)::BIGINT AS unidades,
           COALESCE(SUM(o.receita_bruta), 0) AS receita
    FROM public.orders o
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date >= CURRENT_DATE - p_days
      AND o.sku IS NOT NULL AND TRIM(o.sku) <> ''
    GROUP BY o.sku
    HAVING SUM(o.quantidade) >= p_min_units
  ), estoque AS MATERIALIZED (
    SELECT i.seller_custom_field AS sku, SUM(i.available_quantity)::BIGINT AS estoque
    FROM public.ml_inventory_cache i
    WHERE i.organization_id = p_org_id
      AND i.seller_custom_field IS NOT NULL AND TRIM(i.seller_custom_field) <> ''
    GROUP BY i.seller_custom_field
  )
  SELECT v.sku, v.titulo, v.unidades,
    ROUND(v.unidades::NUMERIC / GREATEST(p_days, 1), 3),
    v.receita, COALESCE(e.estoque, 0),
    CASE WHEN v.unidades > 0
      THEN ROUND(COALESCE(e.estoque,0)::NUMERIC / (v.unidades::NUMERIC / GREATEST(p_days,1)), 1) END,
    (COALESCE(e.estoque,0)::NUMERIC / NULLIF(v.unidades::NUMERIC / GREATEST(p_days,1), 0)) < 15
  FROM vendas v LEFT JOIN estoque e ON e.sku = v.sku
  ORDER BY v.unidades DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.get_listings_without_sku(p_org_id UUID)
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
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT i.item_id, i.title, i.status,
    COALESCE(i.available_quantity, 0)::BIGINT, i.price,
    ROUND(COALESCE(i.available_quantity,0) * COALESCE(i.price,0), 2),
    (i.status = 'active' AND COALESCE(i.available_quantity,0) > 0),
    'https://www.mercadolivre.com.br/anuncios/' || i.item_id || '/modificar'
  FROM public.ml_inventory_cache i
  WHERE i.organization_id = p_org_id
    AND (i.seller_custom_field IS NULL OR TRIM(i.seller_custom_field) = '')
  ORDER BY (COALESCE(i.available_quantity,0) * COALESCE(i.price,0)) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_velocity(UUID, INT, INT, INT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_listings_without_sku(UUID)
  TO anon, authenticated, service_role;
