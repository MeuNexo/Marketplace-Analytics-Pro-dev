-- Phase 79: estende orders_price_timeseries com componentes de custo firmes por bucket
-- (cmv, comissao, frete, qtd_sem_custo, impostos, qtd_sem_imposto) para a Análise de
-- Preços responder "o preço praticado deu MCO?".
--
-- Deploy: via MCP apply_migration no projeto ckcdevcxgvueywivefgx (NUNCA via SQL Editor).
-- Smoke pós-deploy: rodar como role authenticated (não postgres), comparando 2-3 buckets
-- contra soma manual em SQL (plano 79-02 — checkpoint do orquestrador).
--
-- PITFALL (Postgres): CREATE OR REPLACE falha ao mudar o RETURNS TABLE de função
-- existente ("cannot change return type of existing function") → DROP antes do CREATE.
-- O DROP identifica a função pelos tipos dos argumentos de entrada (sem defaults);
-- a assinatura de entrada não muda, só o retorno ganha colunas.
--
-- SECURITY INVOKER explícito (padrão anti-IDOR Phases 63/69 — sem DEFINER, sem
-- parâmetro de organização): a RLS de `orders` já isola a organização do chamador
-- autenticado. Nenhuma subquery correlacionada — todas as colunas novas são agregações
-- simples no mesmo GROUP BY (lição RPC RLS timeout 8s).
DROP FUNCTION IF EXISTS public.orders_price_timeseries(text, text[], date, date, text);

CREATE FUNCTION public.orders_price_timeseries(
  _item_id      text,
  _ml_user_ids  text[] DEFAULT NULL,
  _from         date   DEFAULT NULL,
  _to           date   DEFAULT NULL,
  _granularity  text   DEFAULT 'day'
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
  qtd_sem_imposto bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    date_trunc(
      CASE
        WHEN lower(_granularity) IN ('week', 'month') THEN lower(_granularity)
        ELSE 'day'
      END,
      o.data_pedido::date   -- ADAPTAÇÃO: cast TEXT→date (nosso schema usa TEXT)
    )::date AS bucket,
    (SUM(o.receita_bruta) / NULLIF(SUM(o.quantidade), 0))::numeric AS preco_medio,
    MIN(o.preco_unit)::numeric    AS preco_min,
    MAX(o.preco_unit)::numeric    AS preco_max,
    SUM(o.quantidade)::bigint     AS qtd,
    SUM(o.receita_bruta)::numeric AS total,
    COUNT(*)::bigint              AS orders,
    -- Componentes firmes por bucket (template: get_margin_with_ads_by_product)
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)::numeric                       AS cmv,
    COALESCE(SUM(o.comissao), 0)::numeric                                        AS comissao,
    COALESCE(SUM(o.frete), 0)::numeric                                           AS frete,
    COALESCE(SUM(o.quantidade) FILTER (WHERE o.custo_unit IS NULL), 0)::bigint   AS qtd_sem_custo,
    -- Imposto FIRME por pedido (tax_amount calculado com UF de destino real por
    -- recalc-order-costs) — mesmo padrão de get_cost_waterfall/MLCostCard.
    COALESCE(SUM(o.tax_amount), 0)::numeric                                      AS impostos,
    COALESCE(SUM(o.quantidade) FILTER (WHERE o.tax_amount IS NULL), 0)::bigint   AS qtd_sem_imposto
  FROM orders o
  WHERE o.item_id = _item_id
    AND o.status IN ('paid', 'shipped', 'delivered')
    AND (_ml_user_ids IS NULL OR array_length(_ml_user_ids, 1) IS NULL OR o.ml_user_id = ANY(_ml_user_ids))
    AND (_from IS NULL OR o.data_pedido::date >= _from)
    AND (_to   IS NULL OR o.data_pedido::date <= _to)
  GROUP BY 1
  ORDER BY 1;
$function$;

-- Sem GRANT extra: SECURITY INVOKER com RLS de orders já garante isolamento por organização.
-- Smoke pós-deploy (orquestrador via MCP execute_sql, como role authenticated):
--   SELECT * FROM orders_price_timeseries('MLB0000000000', NULL, NULL, NULL, 'day') LIMIT 1;
--   Deve retornar 13 colunas sem erro "function does not exist".
