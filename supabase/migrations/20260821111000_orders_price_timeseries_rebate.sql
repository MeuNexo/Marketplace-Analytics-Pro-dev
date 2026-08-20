-- ──────────────────────────────────────────────────────────────────────────────
-- RPC: orders_price_timeseries — o INSUMO do segundo cenário de rebate por
-- intervalo
--
-- Fase 223, plano 223-05 (REB-02/REB-03/REB-04). A Análise de Preços é a
-- tela onde se decide PREÇO olhando margem: o card "Detalhamento de MCO" e a
-- série preço × break-even. Ela já mostra o par SEM/COM DIFAL; falta o
-- insumo do par SEM/COM rebate.
--
-- 🔴 ESTA RPC ENTREGA INSUMO, NÃO CENÁRIO PRONTO — igual ao par DIFAL desta
-- mesma tela. A composição do MCO desta tela SEMPRE aconteceu no navegador
-- (`src/lib/precoMcoSeries.ts` chama `computeMco`). Trazer o segundo cenário
-- pronto para cá criaria uma segunda régua da mesma página; o navegador
-- (223-07) chama `computeMco` de novo com o rebate acrescido do insumo
-- devolvido aqui.
--
-- As duas colunas de valor existem para separar BRUTO de EFEITO, porque o
-- waterfall e o MCO leem coisas diferentes: o waterfall mostra o `rebate_bruto`
-- na linha de comissão e a compensação de PIS/COFINS na linha de imposto,
-- enquanto o MCO usa o `rebate_efeito` (rebate menos o crédito que ele
-- deixaria de gerar — `public.rebate_efeito_liquido`, 223-03).
--
-- 🔴 SEM RATEIO — HÁ UMA CONFERÊNCIA. Medido em produção (223-01): `orders`
-- é 1:1 com o pedido do ML, sem coluna de pacote. A junção com
-- `ml_order_sale_fee_captura` é direta pela chave
-- (organization_id, ml_order_id), uma linha para uma linha. O rebate só é
-- afirmado quando a captura fechou (`status = 'ok'`), não há estorno por
-- cancelamento (`tem_estorno = false` — o `sale_fee` da fatura NÃO enxerga o
-- cancelamento, medido) e a conferência fecha: `sale_fee_net` ==
-- `orders.comissao × orders.quantidade` (tolerância de um centavo). SEM o
-- multiplicador `quantidade`, 62 pedidos bons da Pé Vermeio sairiam como
-- divergentes — a comissão gravada é POR UNIDADE, e a tarifa da fatura é
-- TOTAL do pedido.
--
-- As duas ausências são contadas separadamente:
-- `pedidos_sem_captura_rebate` (ainda não consultamos) e
-- `pedidos_rebate_nao_conferido` (consultamos, mas não é afirmável — erro
-- nosso, o único dos dois acionável).
--
-- 🔴 `orders.comissao` JÁ É O VALOR LÍQUIDO DO REBATE — descontar de novo em
-- qualquer expressão aqui seria dupla contagem.
--
-- 🔵 SOMAS SEM SUBSTITUIÇÃO DE NULO POR ZERO: `rebate_bruto`/`rebate_efeito`
-- são `SUM(...)` puro; o Postgres devolve NULL quando todas as parcelas do
-- intervalo são NULL — "nada afirmável", sem `COALESCE` escondendo a lacuna.
--
-- 🔵 ORTOGONALIDADE: o rebate não se mistura com o termo de DIFAL desta
-- mesma RPC — os dois insumos são colunas separadas, compostos no navegador
-- em chamadas independentes de `computeMco`.
--
-- POR QUE DROP + CREATE: a RETURNS TABLE ganha quatro colunas. Os SEIS
-- argumentos ficam idênticos — inclusive `_sku` no fim, com o mesmo DEFAULT
-- — e as quinze colunas antigas (13 originais + difal_efeito +
-- pedidos_difal_indefinido) mantêm nome, tipo e posição. As quatro novas
-- entram no fim.
--
-- 🔴 REMOVER UMA FUNÇÃO APAGA A ACL — a concessão ao papel autenticado está
-- reemitida no mesmo arquivo do DROP.
--
-- APLICAÇÃO É PORTÃO DO ORQUESTRADOR (223-08): este plano SÓ escreve o
-- arquivo. Aplicar via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`
-- (NUNCA SQL Editor, NUNCA `supabase db push`) — sempre DEPOIS de
-- 20260821101000_rebate_efeito_liquido.sql, que esta função consome.
--
-- SECURITY INVOKER (padrão anti-IDOR das fases 63/69/79 — sem DEFINER, sem
-- parâmetro de organização): a RLS de `orders` e de
-- `ml_order_sale_fee_captura` já isola a organização do chamador. A junção
-- usa `o.organization_id`, não um parâmetro — esta RPC nunca recebeu
-- `p_org_id`.
--
-- LIÇÃO PRESERVADA (Fase 82): venda por variação casa por `orders.sku`,
-- nunca por `orders.variation_id`.
-- ──────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.orders_price_timeseries(text, text[], date, date, text, text);

CREATE FUNCTION public.orders_price_timeseries(
  _item_id      text,
  _ml_user_ids  text[] DEFAULT NULL,
  _from         date   DEFAULT NULL,
  _to           date   DEFAULT NULL,
  _granularity  text   DEFAULT 'day',
  _sku          text   DEFAULT NULL
)
RETURNS TABLE(
  bucket          date,
  preco_medio     numeric,
  preco_min       numeric,
  preco_max       numeric,
  qtd             bigint,
  total           numeric,
  orders          bigint,
  cmv             numeric,
  comissao        numeric,
  frete           numeric,
  qtd_sem_custo   bigint,
  impostos        numeric,
  qtd_sem_imposto bigint,
  difal_efeito    numeric,
  pedidos_difal_indefinido bigint,
  -- ── Colunas novas (223-05), no FIM ─────────────────────────────────────
  -- Soma do rebate dos pedidos afirmáveis do intervalo, TOTAL em R$, como
  -- veio da fatura. NULL quando nada é afirmável no intervalo.
  rebate_bruto                 numeric,
  -- Soma do EFEITO LÍQUIDO do rebate (rebate_efeito_liquido) do intervalo,
  -- TOTAL em R$ — o insumo que o navegador soma ao imposto na segunda
  -- chamada de computeMco. NULL quando nada é afirmável.
  rebate_efeito                numeric,
  -- Pedidos do intervalo ainda não consultados (sem captura, ou captura em
  -- estado não final).
  pedidos_sem_captura_rebate   bigint,
  -- Pedidos capturados mas não afirmáveis (conferência que não fecha, ou
  -- estorno por cancelamento) — erro nosso, distinto do anterior.
  pedidos_rebate_nao_conferido bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH pedidos AS (
    SELECT
      o.*,
      date_trunc(
        CASE
          WHEN lower(_granularity) IN ('week', 'month') THEN lower(_granularity)
          ELSE 'day'
        END,
        o.data_pedido::date   -- ADAPTAÇÃO: cast TEXT→date (nosso schema usa TEXT)
      )::date AS bucket_key
    FROM public.orders o
    WHERE o.item_id = _item_id
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND (_ml_user_ids IS NULL OR array_length(_ml_user_ids, 1) IS NULL OR o.ml_user_id = ANY(_ml_user_ids))
      AND (_from IS NULL OR o.data_pedido::date >= _from)
      AND (_to   IS NULL OR o.data_pedido::date <= _to)
      AND (_sku  IS NULL OR o.sku = _sku)
  ),
  pedidos_rebate AS (
    -- Junção externa à esquerda, uma linha para uma linha, sem rateio (223-01:
    -- orders é 1:1 com o pedido do ML). Guarda de conferência (net contra
    -- comissao x quantidade) + guarda de estorno, igual à margem por anúncio.
    SELECT
      p.*,
      CASE
        WHEN c.status = 'ok'
         AND c.tem_estorno = false
         AND ABS(c.sale_fee_net - COALESCE(p.comissao, 0) * p.quantidade) <= 0.01
          THEN c.sale_fee_rebate          -- já é o TOTAL do pedido
        ELSE NULL
      END AS rebate_do_pedido,
      (c.status IS DISTINCT FROM 'ok') AS rebate_sem_captura,
      (
        c.status = 'ok'
        AND NOT (
          c.tem_estorno = false
          AND ABS(c.sale_fee_net - COALESCE(p.comissao, 0) * p.quantidade) <= 0.01
        )
      ) AS rebate_nao_conferido
    FROM pedidos p
    LEFT JOIN public.ml_order_sale_fee_captura c
      ON c.organization_id = p.organization_id
     AND c.ml_order_id = p.ml_order_id
  ),
  pedidos_rebate_efeito AS (
    -- O alias `rebate_do_pedido` não é visível no mesmo nível que o calcula
    -- — o efeito líquido entra num CTE à parte, consumindo a função única.
    SELECT
      p.*,
      CASE
        WHEN p.rebate_do_pedido IS NOT NULL
          THEN public.rebate_efeito_liquido(p.rebate_do_pedido, p.comissao, p.credito_pc_comissao)
        ELSE NULL
      END AS rebate_efeito_pedido
    FROM pedidos_rebate p
  )
  SELECT
    p.bucket_key AS bucket,
    (SUM(p.receita_bruta) / NULLIF(SUM(p.quantidade), 0))::numeric AS preco_medio,
    MIN(p.preco_unit)::numeric    AS preco_min,
    MAX(p.preco_unit)::numeric    AS preco_max,
    SUM(p.quantidade)::bigint     AS qtd,
    SUM(p.receita_bruta)::numeric AS total,
    COUNT(*)::bigint              AS orders,
    -- Componentes firmes por bucket (template: a RPC de margem por anúncio)
    COALESCE(SUM(p.custo_unit * p.quantidade), 0)::numeric                       AS cmv,
    COALESCE(SUM(p.comissao), 0)::numeric                                        AS comissao,
    COALESCE(SUM(p.frete), 0)::numeric                                           AS frete,
    COALESCE(SUM(p.quantidade) FILTER (WHERE p.custo_unit IS NULL), 0)::bigint   AS qtd_sem_custo,
    -- Imposto FIRME por pedido (tax_amount calculado com UF de destino real por
    -- recalc-order-costs) — este É o cenário SEM DIFAL.
    COALESCE(SUM(p.tax_amount), 0)::numeric                                      AS impostos,
    COALESCE(SUM(p.quantidade) FILTER (WHERE p.tax_amount IS NULL), 0)::bigint   AS qtd_sem_imposto,
    -- O que separa o segundo cenário (DIFAL) do primeiro, e SÓ isso.
    COALESCE(
      SUM(
        public.difal_efeito_liquido(
          p.difal_amount,
          p.fcp_amount,
          p.pis_cofins_debito,
          p.pis_cofins_debito_com_difal
        )
      ) FILTER (WHERE p.difal_fonte IN ('calculado', 'nao_conciliado')),
      0
    )::numeric                                                                   AS difal_efeito,
    COUNT(*) FILTER (
      WHERE p.difal_amount IS NULL
        AND p.estado    IS NOT NULL
        AND p.uf_origem IS NOT NULL
        AND p.estado    <> p.uf_origem
    )::bigint                                                                    AS pedidos_difal_indefinido,
    -- O insumo do terceiro cenário (REBATE) — SUM puro, sem COALESCE.
    SUM(p.rebate_do_pedido)::numeric                                             AS rebate_bruto,
    SUM(p.rebate_efeito_pedido)::numeric                                         AS rebate_efeito,
    COUNT(*) FILTER (WHERE p.rebate_sem_captura)::bigint                         AS pedidos_sem_captura_rebate,
    COUNT(*) FILTER (WHERE p.rebate_nao_conferido)::bigint                       AS pedidos_rebate_nao_conferido
  FROM pedidos_rebate_efeito p
  GROUP BY p.bucket_key
  ORDER BY p.bucket_key;
$function$;

GRANT EXECUTE ON FUNCTION public.orders_price_timeseries(text, text[], date, date, text, text) TO authenticated;

-- Smoke pós-deploy (orquestrador via MCP execute_sql, como papel authenticated):
--   -- comportamento do pai (sem _sku), 19 colunas, as 15 primeiras idênticas:
--   SELECT * FROM orders_price_timeseries('MLB0000000000', NULL, NULL, NULL, 'day') LIMIT 1;
--   -- comportamento por variação (6 argumentos, _sku no fim):
--   SELECT * FROM orders_price_timeseries('MLB0000000000', NULL, NULL, NULL, 'day', 'SKU-000') LIMIT 1;
--   Nenhuma deve devolver "function does not exist" / "function is not unique".
