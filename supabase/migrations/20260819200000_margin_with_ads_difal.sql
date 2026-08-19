-- ──────────────────────────────────────────────────────────────────────────────
-- RPC: get_margin_with_ads_by_product — os DOIS cenários de MCO por anúncio
--
-- Fase 222, plano 222-15-R2 (FISC-04/FISC-07). O Wesley pediu, em 19/08, que
-- toda tela do sistema que exibe margem mostre os dois cenários: sem DIFAL e
-- com DIFAL. Esta RPC alimenta TRÊS telas ao mesmo tempo — /resultado,
-- /publicidade e /anuncios (nos dois ramos de renderização) — e hoje devolve
-- um número só, o otimista, sem dizer que é otimista.
--
-- POR QUE O SEGUNDO CENÁRIO NASCE AQUI, E NÃO NO NAVEGADOR: nestas três telas
-- o MCO já vem PRONTO do banco (`lucro`, `lucro_pct`, `lucro_pos_ads`,
-- `lucro_pct_pos_ads` são calculados em SQL). Compor o primeiro cenário no
-- banco e o segundo no navegador seria criar duas réguas para o mesmo número.
-- Os dois nascem da MESMA expressão, diferindo apenas no termo de imposto:
--
--     lucro           = Σ(lucro_antes_imposto − imposto_sem_difal)
--     lucro_com_difal = Σ(lucro_antes_imposto − imposto_com_difal)
--
-- O termo `lucro_antes_imposto` é escrito UMA vez, no CTE `pedidos_base`. Escrever
-- a expressão de lucro duas vezes de forma independente é como as duas metades
-- divergem sem ninguém notar.
--
-- 🔴 O TERMO DE DIFAL NÃO É O DIFAL CHEIO. Ele vem de
-- public.difal_efeito_liquido (20260812225000), que desconta a queda do débito
-- de PIS/COFINS que o próprio DIFAL provoca. Somar `difal_amount` sobre
-- `tax_amount` foi bug real de R$ 3,85 por pedido (222-06-R/07-R): imposto
-- maior e MCO menor que o real.
--
-- SÓ O DIFAL CALCULADO ENTRA POR LINHA. O DIFAL que o Mercado Livre já cobra
-- na fatura (conceito CDIFAL) é diário e por loja — não tem granularidade de
-- anúncio, e rateá-lo por item seria inventar atribuição. Por isso o filtro
-- `difal_fonte IN ('calculado','nao_conciliado')`: os pedidos `cobrado_ml`
-- entram apenas no AGREGADO (get_difal_summary), pela decisão de procedência
-- que já existe. O número por linha é sempre ESTIMATIVA (D-12) e a tela é
-- obrigada a dizer isso.
--
-- POR QUE DROP + CREATE (não CREATE OR REPLACE): a RETURNS TABLE ganha seis
-- colunas, e o Postgres recusa CREATE OR REPLACE nesse caso ("cannot change
-- return type of existing function"). A assinatura de ARGUMENTOS não muda, e
-- as vinte colunas antigas continuam com o mesmo nome, o mesmo tipo e a mesma
-- POSIÇÃO — as seis novas entram no fim, para quem mapeia por nome e para
-- quem mapeia por posição continuarem funcionando.
--
-- 🔴 REMOVER UMA FUNÇÃO APAGA A ACL. Entre o DROP e o CREATE toda tela que
-- chama esta função falha; se o GRANT não for reemitido, ela falha PARA
-- SEMPRE. Este repositório já perdeu lista de controle de acesso exatamente
-- assim. O GRANT está no fim deste mesmo arquivo, e o checkpoint humano
-- confere a concessão DEPOIS de aplicar.
--
-- APLICAÇÃO É PORTÃO HUMANO (222-15-R2, Task 5): este plano SÓ escreve o
-- arquivo. Aplicar via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`
-- (NUNCA SQL Editor, NUNCA `supabase db push`) é passo do orquestrador, na
-- posição que a ordem consolidada da rodada R2 define — sempre DEPOIS de
-- 20260812225000_difal_efeito_liquido.sql.
--
-- Sem LIMIT: evita truncamento PostgREST de 1000 linhas (MCO-01).
-- SECURITY INVOKER (igual à RPC base): a RLS org-first de orders e
-- ml_ads_products_cache enforça o isolamento de tenant. As colunas fiscais
-- novas são somas dos MESMOS pedidos que o chamador já enxerga um a um —
-- nenhuma superfície nova de vazamento entre organizações.
-- ──────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_margin_with_ads_by_product(UUID, TEXT[], DATE, DATE);

CREATE FUNCTION public.get_margin_with_ads_by_product(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  item_id                     TEXT,
  titulo                      TEXT,
  sku                         TEXT,
  listing_type                TEXT,
  receita                     NUMERIC,
  cmv                         NUMERIC,
  comissao                    NUMERIC,
  frete                       NUMERIC,
  impostos                    NUMERIC,
  lucro                       NUMERIC,
  lucro_pct                   NUMERIC,
  pedidos                     BIGINT,
  unidades                    BIGINT,
  has_cmv                     BOOLEAN,
  ads_spend                   NUMERIC,
  ads_attributed_orders       BIGINT,
  lucro_pos_ads               NUMERIC,
  lucro_pct_pos_ads           NUMERIC,
  ads_no_sale                 BOOLEAN,
  marca                       TEXT,
  -- ── Colunas novas (222-15-R2), todas no FIM ────────────────────────────────
  -- Efeito líquido do DIFAL do anúncio no período, somado só sobre os pedidos
  -- cuja procedência é calculada ou ainda não conciliada.
  difal_efeito                NUMERIC,
  -- Pedidos do anúncio com destino interestadual conhecido e SEM DIFAL
  -- calculado (UF ainda não confirmada). A tela exibe a contagem em palavras
  -- em vez de esconder a lacuna atrás de um zero.
  pedidos_difal_indefinido    BIGINT,
  -- Os quatro números do segundo cenário — mesmas expressões do primeiro.
  lucro_com_difal             NUMERIC,
  lucro_pct_com_difal         NUMERIC,
  lucro_pos_ads_com_difal     NUMERIC,
  lucro_pct_pos_ads_com_difal NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pedidos_base AS (
    -- Bloco intermediário POR PEDIDO: um único termo de lucro antes do
    -- imposto, e DOIS termos de imposto. É daqui que os dois cenários saem —
    -- e é por isso que eles não podem divergir.
    SELECT
      o.item_id,
      o.titulo,
      o.sku,
      o.listing_type,
      o.marca,
      o.receita_bruta,
      o.custo_unit,
      o.quantidade,
      o.comissao,
      o.frete,
      o.tax_amount,
      o.difal_amount,
      o.estado,
      o.uf_origem,
      o.receita_bruta
        - COALESCE(o.custo_unit * o.quantidade, 0)
        - COALESCE(o.comissao, 0)
        - COALESCE(o.frete, 0)                                             AS lucro_antes_imposto,
      COALESCE(o.tax_amount, 0)                                            AS imposto_sem_difal,
      COALESCE(o.tax_amount, 0)
        + CASE
            WHEN o.difal_fonte IN ('calculado', 'nao_conciliado')
              THEN public.difal_efeito_liquido(
                     o.difal_amount,
                     o.fcp_amount,
                     o.pis_cofins_debito,
                     o.pis_cofins_debito_com_difal
                   )
            ELSE 0
          END                                                              AS imposto_com_difal
    FROM public.orders o
    WHERE o.organization_id = p_org_id
      AND o.ml_user_id = ANY(p_user_ids)
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date BETWEEN p_from AND p_to
      AND o.item_id IS NOT NULL
  ),
  orders_side AS (
    SELECT
      p.item_id,
      MAX(p.titulo)                                                        AS titulo,
      MAX(p.sku)                                                           AS sku,
      MAX(p.listing_type)                                                  AS listing_type,
      MAX(p.marca)                                                         AS marca,
      COALESCE(SUM(p.receita_bruta), 0)                                    AS receita,
      COALESCE(SUM(p.custo_unit * p.quantidade), 0)                        AS cmv,
      COALESCE(SUM(p.comissao), 0)                                         AS comissao,
      COALESCE(SUM(p.frete), 0)                                            AS frete,
      COALESCE(SUM(p.tax_amount), 0)                                       AS impostos,
      COALESCE(SUM(p.lucro_antes_imposto - p.imposto_sem_difal), 0)        AS lucro,
      COALESCE(SUM(p.lucro_antes_imposto - p.imposto_com_difal), 0)        AS lucro_com_difal,
      COALESCE(SUM(p.imposto_com_difal - p.imposto_sem_difal), 0)          AS difal_efeito,
      COUNT(*) FILTER (
        WHERE p.difal_amount IS NULL
          AND p.estado    IS NOT NULL
          AND p.uf_origem IS NOT NULL
          AND p.estado    <> p.uf_origem
      )                                                                    AS pedidos_difal_indefinido,
      COUNT(*)                                                             AS pedidos,
      COALESCE(SUM(p.quantidade), 0)                                       AS unidades,
      BOOL_OR(p.custo_unit IS NOT NULL)                                    AS has_cmv
    FROM pedidos_base p
    GROUP BY p.item_id
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
    o.marca                                      AS marca,
    -- ── Segundo cenário: as MESMAS expressões acima, com o imposto trocado ──
    COALESCE(o.difal_efeito, 0)                 AS difal_efeito,
    COALESCE(o.pedidos_difal_indefinido, 0)     AS pedidos_difal_indefinido,
    COALESCE(o.lucro_com_difal, 0)              AS lucro_com_difal,
    CASE WHEN COALESCE(o.receita, 0) > 0
      THEN ROUND(COALESCE(o.lucro_com_difal, 0) / o.receita * 100, 2)
      ELSE NULL END                              AS lucro_pct_com_difal,
    COALESCE(o.lucro_com_difal, 0) - COALESCE(a.ads_spend, 0) AS lucro_pos_ads_com_difal,
    CASE WHEN COALESCE(o.receita, 0) > 0
      THEN ROUND((COALESCE(o.lucro_com_difal, 0) - COALESCE(a.ads_spend, 0)) / o.receita * 100, 2)
      ELSE NULL END                              AS lucro_pct_pos_ads_com_difal
  FROM orders_side o
  FULL OUTER JOIN ads_side a USING (item_id)
  ORDER BY COALESCE(o.receita, 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_margin_with_ads_by_product(UUID, TEXT[], DATE, DATE) TO authenticated;
