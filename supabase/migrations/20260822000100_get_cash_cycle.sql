-- ============================================================================
-- Fase 230, Plano 03 (CX-02) — get_cash_cycle
--
-- Responde "onde meu dinheiro esta preso?" com a metrica canonica de varejo
-- com estoque: o ciclo de conversao de caixa (DIO + DSO - DPO).
--
-- Esta funcao devolve INSUMOS CRUS e os tres componentes. Ela NAO compoe o
-- ciclo e NAO decide como falar de ausencia — isso mora na regua pura
-- `src/lib/cicloCaixa.ts`, testada, para que um componente faltando nunca vire
-- zero somado no meio de um ciclo.
--
-- ── Por que a chave do custo e `seller_sku`, nunca `item_id` sozinho ─────────
-- Boa parte das linhas de `ml_product_costs` vem do import do Tiny e grava
-- `item_id` no formato `TINY_<sku>`, nao o `item_id` real do MLB (comentario
-- de `src/hooks/useMLProductCosts.ts:27-28`). Juntar o cache de anuncios por
-- `item_id` casa 2 anuncios de 132 e faz a tabela PARECER vazia — foi esse
-- erro que contaminou o briefing desta fase e teve de ser desfeito. Pela chave
-- de negocio (`ml_product_costs.seller_sku = ml_inventory_cache.seller_custom_field`)
-- a cobertura medida em 21/08 e de 168 SKUs em 168 e 2.995 unidades em 2.995,
-- R$ 189.277,32. Mesma disciplina de `src/lib/estoqueCapital.ts`.
--
-- ── Por que o extremo do DSO e devolvido em vez de escondido ────────────────
-- `dso_dias` reusa exatamente a conta de `lag_liberacao_dias` de
-- `get_dre_cash_forecast` (migration 20260717070000, linhas 219-241): diferenca
-- de centroides ponderados, presa entre 7 e 30 dias, com queda para 14 quando
-- qualquer lado da janela esta vazio. Nao ha vinculo venda -> liberacao no
-- banco: `cash_inflows` guarda `payment_id` do Mercado Pago e `orders` guarda
-- `ml_order_id`, sem chave comum. O valor de 7 dias medido em 21/08 esta
-- exatamente no piso — e "no limite ou abaixo dele", nao "sete dias medidos".
-- Por isso `dso_no_limite` sai junto: sem ele a tela publicaria um numero preso
-- com cara de medicao, que e a forma exata do erro dos "102,4%" da Fase 224.
-- Consequencia: o ciclo real e SEMPRE >= ao publicado, nunca menor.
--
-- ── Por que o DPO e mediana, nao media ──────────────────────────────────────
-- Prazo de fornecedor tem cauda: um punhado de titulos pagos com muito atraso
-- (ou antecipados) desloca a media e nao descreve o prazo tipico que decide
-- compra. `percentile_cont(0.5)` sobre `outflow_date - competence_date` em
-- titulos efetivamente pagos, restrito as categorias de fornecedor, foi como os
-- 12 dias de `230-MEDICOES-CAIXA.md` foram medidos (n=198).
--
-- ── Ressalva do estoque (limitacao da fonte, nao do calculo) ────────────────
-- `ml_inventory_cache` e cache da listagem do ML e pode conter anuncio ja
-- fechado no ML e ainda `active` no cache — medido em 21/08: 9 anuncios e 94
-- unidades nessa condicao, que empurram o DIO para cima. Declarado no rodape do
-- card; fora do escopo desta fase corrigir a sincronizacao.
--
-- Seguranca: funcao de INVOCADOR (o padrao). Ela recebe `p_org_id` por
-- parametro, e a combinacao "parametro de organizacao + privilegio de
-- definidor" e IDOR — proibida pela regra da casa. Todas as tabelas lidas tem
-- RLS por organizacao, que continua valendo aqui.
--
-- ⚠️ Aplicar via MCP `apply_migration` no projeto ckcdevcxgvueywivefgx.
-- NUNCA `supabase db push`.
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
  -- Mesma forma de `costs_by_sku` em get_replenishment_by_sku_alvo_order_up_to.
  -- Custo ausente NAO vira 0 e NAO vira preco: a linha simplesmente nao existe
  -- aqui, e a unidade cai na contagem declarada.
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

  estoque AS MATERIALIZED (
    SELECT
      i.available_quantity,
      cps.cost
    FROM public.ml_inventory_cache i
    LEFT JOIN custo_por_sku cps
      ON cps.seller_sku = i.seller_custom_field
    WHERE i.organization_id = p_org_id
      AND i.status = 'active'
      AND i.available_quantity > 0
  ),

  estoque_agg AS (
    SELECT
      COALESCE(SUM(e.cost * e.available_quantity) FILTER (WHERE e.cost IS NOT NULL), 0)::numeric AS valor,
      COALESCE(SUM(e.available_quantity), 0)::bigint                                             AS unidades,
      COALESCE(SUM(e.available_quantity) FILTER (WHERE e.cost IS NULL), 0)::bigint               AS unidades_sem_custo,
      COUNT(*) FILTER (WHERE e.cost IS NULL)::bigint                                             AS skus_sem_custo
    FROM estoque e
  ),

  -- ── CMV realizado da janela ───────────────────────────────────────────────
  -- Predicado de pedido pago copiado de `get_cost_waterfall` (os tres status de
  -- venda concretizada, recorte por `data_pedido::date`). `orders.custo_unit` e
  -- a fonte CERTA aqui — CMV realizado —, e a fonte ERRADA para valorar estoque
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
      -- Mesma saida numerica da conta original: clamp [7,30], queda para 14
      -- quando um dos lados esta vazio.
      CASE
        WHEN d.bruto IS NULL THEN 14
        ELSE LEAST(GREATEST(d.bruto, 7), 30)
      END::numeric AS dias,
      d.n          AS n,
      -- Verdadeiro quando o numero NAO e uma medicao livre: ou caiu no valor
      -- fixo, ou encostou em um dos dois extremos do intervalo.
      (d.bruto IS NULL OR d.bruto <= 7 OR d.bruto >= 30) AS no_limite
    FROM dso_calc d
  ),

  -- ── DPO: mediana do atraso entre competencia e pagamento ──────────────────
  -- Categorias de fornecedor, nomeadas: foi com estas duas (e so com elas) que
  -- os 12 dias de `230-MEDICOES-CAIXA.md` sairam, n=198.
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

-- Execucao: so quem esta autenticado, e a RLS por organizacao das tabelas
-- lidas continua valendo dentro da funcao.
REVOKE ALL ON FUNCTION public.get_cash_cycle(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cash_cycle(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cash_cycle(uuid, int) TO authenticated;
