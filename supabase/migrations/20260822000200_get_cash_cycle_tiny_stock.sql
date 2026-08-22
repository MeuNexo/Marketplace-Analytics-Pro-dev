-- ============================================================================
-- Fase 230, Plano 03 (CX-02) — get_cash_cycle: a fonte do estoque e `tiny_stock`
--
-- CORRECAO da migration 20260822000100, medida contra o banco depois de aplicada.
--
-- ── O que estava errado ─────────────────────────────────────────────────────
-- A versao anterior valorava o estoque por `ml_inventory_cache`, que e o cache
-- do que esta ANUNCIADO E ATIVO no Mercado Livre. Medido em 22/08:
--
--   ml_inventory_cache (status='active') → 132 SKUs, 1.434 unidades
--   tiny_stock                           → 777 SKUs, 2.995 unidades
--
-- Faltavam 52% das unidades. A pergunta que esta RPC serve e "onde meu dinheiro
-- esta preso?", e o dinheiro foi gasto em TODA a mercadoria — anunciada ou nao.
-- A Pe Vermeio tem 777 SKUs no Tiny contra 132 anunciados (heranca da Fase 214,
-- "reposicao fonte unica": existem centenas de SKUs so-Tiny), e o cache do ML
-- ignorava inclusive as 640 unidades paradas no Centro de distribuicao.
--
-- O cache do ML ainda estava contaminado do outro lado: 9 anuncios fechados no
-- ML seguem `active` ali, com 94 unidades que nao existem (o mais velho desde
-- 17/06). Ele subestimava muito de um lado e superestimava do outro. A ressalva
-- do card sobre anuncio fantasma deixa de valer com esta troca — o estoque
-- agora e o fisico do Tiny, nao a listagem do ML.
--
-- ── Efeito colateral bom: a cobertura de custo fecha em 100% ────────────────
-- Os `unidades_sem_custo = 616` (43%) da versao anterior vinham dos 24 anuncios
-- sem `seller_custom_field` no cache. Em `tiny_stock` o `sku` e NOT NULL, e o
-- casamento por `ml_product_costs.seller_sku` cobre 168 de 168 SKUs com estoque
-- e 2.995 de 2.995 unidades. A contagem de ausencia continua existindo — ela
-- protege o caso generico — mas para de disparar a toa.
--
-- ── Duas regras da casa aplicadas na leitura de `tiny_stock` ────────────────
-- (D-7) O MESMO SKU tem mais de um `tiny_id` (medido na Fase 214: 337 e -1 no
--       mesmo SKU). Sem `DISTINCT ON (sku, deposito)` a soma misturaria os dois
--       registros. Vence o de MAIOR saldo, igual a `get_replenishment_by_sku`.
-- (D-6) `disponivel` e guardado cru, negativos inclusive. O piso em zero e
--       aplicado na LEITURA (`GREATEST(disponivel, 0)`) — estoque negativo e
--       erro de origem, e somar negativo aqui abateria dinheiro real de outro
--       SKU.
--
-- ⚠️ Diferenca deliberada em relacao a `get_replenishment_by_sku`: aqui NAO se
-- filtra deposito. A reposicao olha so o CD Expedicao porque a pergunta dela e
-- "o que da para vender ja"; a pergunta desta RPC e "quanto dinheiro esta
-- parado", e dinheiro parado no Centro de distribuicao ou no Fulfillment do ML
-- esta igualmente parado. Os tres depositos somam.
--
-- ── Janela do DPO: 90 dias, declarada ──────────────────────────────────────
-- A RPC devolveu 15 dias (n=123) na janela de 90; `230-MEDICOES-CAIXA.md` diz
-- 12 (n=198) porque mediu em 180. Nenhum dos dois esta errado — sao recortes
-- diferentes. Fica 90, o mesmo recorte do CMV e do resto do card: um ciclo
-- composto por tres janelas diferentes nao e um ciclo. A janela sai em
-- `janela_dias` e a tela a declara.
--
-- Tudo o mais permanece: seguranca de INVOCADOR, `NULLIF` em cada divisao,
-- `dso_no_limite`, DPO por `percentile_cont`.
--
-- ⚠️ Aplicar via MCP `apply_migration` no projeto ckcdevcxgvueywivefgx.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cash_cycle(
  p_org_id       uuid,
  p_janela_dias  int DEFAULT 90
)
RETURNS TABLE (
  valor_estoque      numeric,
  unidades_estoque   bigint,
  unidades_sem_custo bigint,
  skus_sem_custo     bigint,
  cmv_diario         numeric,
  cmv_pedidos        bigint,
  dso_dias           numeric,
  dso_n              int,
  dso_no_limite      boolean,
  dpo_dias           numeric,
  dpo_n              int,
  janela_dias        int
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      CURRENT_DATE                                        AS hoje,
      CURRENT_DATE - GREATEST(p_janela_dias, 1)           AS janela_ini,
      GREATEST(p_janela_dias, 1)                          AS janela
  ),

  -- ── Custo por SKU: uma linha por seller_sku, a mais recente ───────────────
  -- Custo ausente NAO vira 0 e NAO vira preco: a linha nao existe aqui, e a
  -- unidade cai na contagem declarada.
  custo_por_sku AS MATERIALIZED (
    SELECT DISTINCT ON (c.seller_sku)
      c.seller_sku,
      c.cost
    FROM public.ml_product_costs c
    WHERE c.organization_id = p_org_id
      AND c.seller_sku IS NOT NULL
      AND c.seller_sku <> ''
      AND c.cost IS NOT NULL
    ORDER BY c.seller_sku, c.updated_at DESC NULLS LAST
  ),

  -- ── Estoque fisico: `tiny_stock`, os tres depositos, com D-7 e D-6 ────────
  estoque_dedup AS MATERIALIZED (
    SELECT DISTINCT ON (s.sku, s.deposito)
      s.sku,
      s.deposito,
      s.disponivel
    FROM public.tiny_stock s
    WHERE s.organization_id = p_org_id
    ORDER BY s.sku, s.deposito, s.saldo DESC, s.tiny_id
  ),
  estoque_por_sku AS MATERIALIZED (
    SELECT
      d.sku,
      SUM(GREATEST(d.disponivel, 0))::numeric AS unidades
    FROM estoque_dedup d
    GROUP BY d.sku
    HAVING SUM(GREATEST(d.disponivel, 0)) > 0
  ),
  estoque AS MATERIALIZED (
    SELECT
      e.unidades,
      cps.cost
    FROM estoque_por_sku e
    LEFT JOIN custo_por_sku cps
      ON cps.seller_sku = e.sku
  ),
  estoque_agg AS (
    SELECT
      COALESCE(SUM(e.cost * e.unidades) FILTER (WHERE e.cost IS NOT NULL), 0)::numeric AS valor,
      COALESCE(SUM(e.unidades), 0)::bigint                                             AS unidades,
      COALESCE(SUM(e.unidades) FILTER (WHERE e.cost IS NULL), 0)::bigint               AS unidades_sem_custo,
      COUNT(*) FILTER (WHERE e.cost IS NULL)::bigint                                   AS skus_sem_custo
    FROM estoque e
  ),

  -- ── CMV realizado da janela ───────────────────────────────────────────────
  -- Predicado de pedido pago copiado de `get_cost_waterfall`. `orders.custo_unit`
  -- e a fonte CERTA aqui — CMV realizado — e a ERRADA para valorar estoque
  -- parado, que e `ml_product_costs`.
  cmv_agg AS (
    SELECT
      COALESCE(SUM(o.custo_unit * o.quantidade), 0)::numeric AS cmv_total,
      COUNT(*)::bigint                                       AS pedidos
    FROM public.orders o
    CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date >= p.janela_ini
      AND o.data_pedido::date <= p.hoje
  ),

  -- ── DSO: centroides ponderados, com o clamp da conta original preservado ──
  dso_liberacoes AS MATERIALIZED (
    SELECT
      SUM((ci.release_date - DATE '2000-01-01') * ci.gross_amount) AS soma_pond,
      SUM(ci.gross_amount)                                          AS soma_peso,
      COUNT(*)::int                                                 AS n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date >= p.janela_ini
      AND ci.release_date <= p.hoje
      AND ci.gross_amount IS NOT NULL
      AND ci.gross_amount > 0
  ),
  dso_vendas AS MATERIALIZED (
    SELECT
      SUM(
        (o.data_pedido::date - DATE '2000-01-01')
        * COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)
      )                                                             AS soma_pond,
      SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)) AS soma_peso
    FROM public.orders o
    CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date >= p.janela_ini
      AND o.data_pedido::date <= p.hoje
      AND COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0) > 0
  ),
  dso_calc AS (
    SELECT
      CASE
        WHEN lb.soma_peso IS NULL OR lb.soma_peso = 0
          OR lv.soma_peso IS NULL OR lv.soma_peso = 0
          THEN NULL
        ELSE ROUND((lb.soma_pond / NULLIF(lb.soma_peso, 0))
                 - (lv.soma_pond / NULLIF(lv.soma_peso, 0)))::int
      END               AS bruto,
      COALESCE(lb.n, 0) AS n
    FROM dso_liberacoes lb
    CROSS JOIN dso_vendas lv
  ),
  dso_agg AS (
    SELECT
      CASE
        WHEN d.bruto IS NULL THEN 14
        ELSE LEAST(GREATEST(d.bruto, 7), 30)
      END::numeric AS dias,
      d.n          AS n,
      (d.bruto IS NULL OR d.bruto <= 7 OR d.bruto >= 30) AS no_limite
    FROM dso_calc d
  ),

  -- ── DPO: mediana do atraso entre competencia e pagamento, na MESMA janela ─
  dpo_agg AS (
    SELECT
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY (co.outflow_date - co.competence_date)::numeric
      )::numeric AS dias,
      COUNT(*)::int AS n
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'paid'
      AND co.competence_date IS NOT NULL
      AND co.category IN ('Fornecedores', 'Previsões de compra')
      AND co.outflow_date >= p.janela_ini
      AND co.outflow_date <= p.hoje
  )

  SELECT
    ea.valor                                            AS valor_estoque,
    ea.unidades                                         AS unidades_estoque,
    ea.unidades_sem_custo                               AS unidades_sem_custo,
    ea.skus_sem_custo                                   AS skus_sem_custo,
    -- Denominador vazio devolve NULL, jamais 0: a regua pura le a ausencia e
    -- diz o motivo. Um CMV diario de 0 tornaria o DIO infinito.
    (ca.cmv_total / NULLIF(p.janela, 0)::numeric)       AS cmv_diario,
    ca.pedidos                                          AS cmv_pedidos,
    da.dias                                             AS dso_dias,
    da.n                                                AS dso_n,
    da.no_limite                                        AS dso_no_limite,
    dpa.dias                                            AS dpo_dias,
    dpa.n                                               AS dpo_n,
    p.janela                                            AS janela_dias
  FROM params p
  CROSS JOIN estoque_agg ea
  CROSS JOIN cmv_agg ca
  CROSS JOIN dso_agg da
  CROSS JOIN dpo_agg dpa;
$$;

-- CREATE OR REPLACE nao garante preservar REVOKEs anteriores — reemitir.
REVOKE ALL ON FUNCTION public.get_cash_cycle(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cash_cycle(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cash_cycle(uuid, int) TO authenticated;
