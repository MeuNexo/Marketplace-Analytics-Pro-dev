-- ──────────────────────────────────────────────────────────────────────────────
-- RPC: get_margin_with_ads_by_product — adiciona coluna `marca`
--
-- Phase 83 (Produtos Vendidos — MCO redesign, plano 83-01): a página
-- /produtos-vendidos agrupa anúncios por marca, mas `get_margin_with_ads_by_product`
-- (20260615120000_margin_with_ads_rpc.sql) não devolve `marca`. Esta migration
-- adiciona `marca` como ÚLTIMA coluna da RETURNS TABLE — o consumidor existente
-- `useMLMarginWithAds.ts` mapeia por NOME de coluna (r.marca), então adicionar no
-- fim é retrocompatível com ele e com qualquer outro consumidor.
--
-- Por que DROP + CREATE (não CREATE OR REPLACE): a RETURNS TABLE muda (ganha uma
-- coluna), e o Postgres recusa CREATE OR REPLACE nesse caso ("cannot change return
-- type of existing function"). A assinatura de argumentos NÃO muda.
--
-- DEPLOY: só via MCP `apply_migration` no projeto Supabase `ckcdevcxgvueywivefgx`
-- (NUNCA SQL Editor, NUNCA `supabase db push` local — este projeto não é o
-- `gionpsuunfkkzzjdubfy` do CLAUDE.md). A aplicação real em prod + smoke test
-- acontecem no plano 83-02 (checkpoint do orquestrador) — este plano (83-01) SÓ
-- escreve o arquivo, não aplica.
--
-- Smoke test (rodar no 83-02 antes de fechar o checkpoint):
--   1. Retrocompatibilidade: chamar a RPC pelo useMLMarginWithAds.ts existente
--      (mapeamento por nome de coluna) e confirmar que nenhum campo antigo quebrou.
--   2. Reconciliação de receita: comparar Σreceita da RPC com Análise de Preços /
--      telas de margem (mesmo período) — devem bater ao centavo.
--   3. Anti-IDOR: SECURITY INVOKER + RLS org-first de orders/ml_ads_products_cache
--      seguem intactos; `marca` é só mais uma coluna projetada do mesmo `orders`
--      já visível ao chamador (nenhuma superfície nova de vazamento entre orgs).
--
-- Sem LIMIT: evita truncamento PostgREST de 1000 linhas (MCO-01).
-- SECURITY INVOKER (igual à RPC base): a RLS org-first de orders e
-- ml_ads_products_cache (is_org_member, Phase 43) enforça o isolamento de tenant.
-- Threat: T-83-01 (IDOR) — mitigado por SECURITY INVOKER + RLS; T-83-02
-- (RETURNS TABLE muda) — mitigado por DROP explícito + retrocompat por nome.
-- ──────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_margin_with_ads_by_product(UUID, TEXT[], DATE, DATE);

CREATE FUNCTION public.get_margin_with_ads_by_product(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  item_id               TEXT,
  titulo                TEXT,
  sku                   TEXT,
  listing_type          TEXT,
  receita               NUMERIC,
  cmv                   NUMERIC,
  comissao              NUMERIC,
  frete                 NUMERIC,
  impostos              NUMERIC,
  lucro                 NUMERIC,
  lucro_pct             NUMERIC,
  pedidos               BIGINT,
  unidades              BIGINT,
  has_cmv               BOOLEAN,
  ads_spend             NUMERIC,
  ads_attributed_orders BIGINT,
  lucro_pos_ads         NUMERIC,
  lucro_pct_pos_ads     NUMERIC,
  ads_no_sale           BOOLEAN,
  marca                 TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH orders_side AS (
    SELECT
      o.item_id,
      MAX(o.titulo)                                                          AS titulo,
      MAX(o.sku)                                                             AS sku,
      MAX(o.listing_type)                                                    AS listing_type,
      MAX(o.marca)                                                           AS marca,
      COALESCE(SUM(o.receita_bruta), 0)                                     AS receita,
      COALESCE(SUM(o.custo_unit * o.quantidade), 0)                         AS cmv,
      COALESCE(SUM(o.comissao), 0)                                          AS comissao,
      COALESCE(SUM(o.frete), 0)                                             AS frete,
      COALESCE(SUM(o.tax_amount), 0)                                        AS impostos,
      COALESCE(SUM(
        o.receita_bruta
        - COALESCE(o.custo_unit * o.quantidade, 0)
        - COALESCE(o.comissao, 0)
        - COALESCE(o.frete, 0)
        - COALESCE(o.tax_amount, 0)
      ), 0)                                                                  AS lucro,
      COUNT(*)                                                               AS pedidos,
      COALESCE(SUM(o.quantidade), 0)                                        AS unidades,
      BOOL_OR(o.custo_unit IS NOT NULL)                                     AS has_cmv
    FROM public.orders o
    WHERE o.organization_id = p_org_id
      AND o.ml_user_id = ANY(p_user_ids)
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date BETWEEN p_from AND p_to
      AND o.item_id IS NOT NULL
    GROUP BY o.item_id
  ),
  ads_side AS (
    SELECT
      a.item_id,
      MAX(a.title)                                AS ads_title,
      COALESCE(SUM(a.spend), 0)                  AS ads_spend,
      COALESCE(SUM(a.attributed_orders), 0)      AS ads_attributed_orders
    FROM public.ml_ads_products_cache a
    WHERE a.organization_id = p_org_id
      AND a.ml_user_id = ANY(p_user_ids)
      AND a.date BETWEEN p_from AND p_to
    GROUP BY a.item_id
  )
  SELECT
    COALESCE(o.item_id, a.item_id)              AS item_id,
    COALESCE(o.titulo, a.ads_title)             AS titulo,
    o.sku,
    o.listing_type,
    COALESCE(o.receita, 0)                      AS receita,
    COALESCE(o.cmv, 0)                          AS cmv,
    COALESCE(o.comissao, 0)                     AS comissao,
    COALESCE(o.frete, 0)                        AS frete,
    COALESCE(o.impostos, 0)                     AS impostos,
    COALESCE(o.lucro, 0)                        AS lucro,
    CASE WHEN COALESCE(o.receita, 0) > 0
      THEN ROUND(COALESCE(o.lucro, 0) / o.receita * 100, 2)
      ELSE NULL END                              AS lucro_pct,
    COALESCE(o.pedidos, 0)                      AS pedidos,
    COALESCE(o.unidades, 0)                     AS unidades,
    COALESCE(o.has_cmv, false)                  AS has_cmv,
    COALESCE(a.ads_spend, 0)                    AS ads_spend,
    COALESCE(a.ads_attributed_orders, 0)        AS ads_attributed_orders,
    COALESCE(o.lucro, 0) - COALESCE(a.ads_spend, 0) AS lucro_pos_ads,
    CASE WHEN COALESCE(o.receita, 0) > 0
      THEN ROUND((COALESCE(o.lucro, 0) - COALESCE(a.ads_spend, 0)) / o.receita * 100, 2)
      ELSE NULL END                              AS lucro_pct_pos_ads,
    (COALESCE(a.ads_spend, 0) > 0 AND COALESCE(a.ads_attributed_orders, 0) = 0) AS ads_no_sale,
    o.marca                                      AS marca
  FROM orders_side o
  FULL OUTER JOIN ads_side a USING (item_id)
  ORDER BY COALESCE(o.receita, 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_margin_with_ads_by_product(UUID, TEXT[], DATE, DATE) TO authenticated;
