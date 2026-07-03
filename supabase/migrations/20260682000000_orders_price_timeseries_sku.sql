-- Phase 82: estende orders_price_timeseries com filtro opcional por SKU (variação),
-- permitindo que a Análise de Preços (82-03) rode faixas/giro/cobertura de UMA variação
-- em vez do anúncio pai agregado (Phase 79/81 continua intacta quando _sku é nulo).
--
-- Deploy: via MCP apply_migration no projeto ckcdevcxgvueywivefgx (NUNCA via SQL Editor,
-- NUNCA `supabase db push`). Aplicação real em prod + smoke = plano 82-02 (checkpoint do
-- orquestrador) — este plano (82-01) SÓ escreve o arquivo.
--
-- PITFALL (Postgres): a nova assinatura ACRESCENTA um argumento (_sku). Usar
-- CREATE OR REPLACE criaria uma SOBRECARGA nova em vez de substituir a função existente,
-- deixando duas versões e gerando "function is not unique" nas chamadas de 5 argumentos.
-- Por isso: DROP explícito da assinatura ANTIGA (5 args, sem _sku) antes do CREATE.
--
-- SECURITY INVOKER explícito (padrão anti-IDOR Phases 63/69/79 — sem DEFINER, sem
-- parâmetro de organização): a RLS de `orders` já isola a organização do chamador
-- autenticado. `_sku` só filtra dentro do escopo já visível pelo RLS — não é uma nova
-- superfície de IDOR. Nenhuma subquery correlacionada — mesma agregação simples no
-- mesmo GROUP BY (lição RPC RLS timeout 8s).
--
-- LIÇÃO CRÍTICA (validação manual Phase 82, MLB4113792113): join de vendas por variação
-- deve usar `orders.sku` (= `seller_custom_field` no jsonb de estoque), NUNCA
-- `orders.variation_id` (casou 0 de 43 vendas reais; `sku` casou 43 de 43).
DROP FUNCTION IF EXISTS public.orders_price_timeseries(text, text[], date, date, text);

CREATE FUNCTION public.orders_price_timeseries(
  _item_id      text,
  _ml_user_ids  text[] DEFAULT NULL,
  _from         date   DEFAULT NULL,
  _to           date   DEFAULT NULL,
  _granularity  text   DEFAULT 'day',
  _sku text DEFAULT NULL
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
    AND (_sku  IS NULL OR o.sku = _sku)
  GROUP BY 1
  ORDER BY 1;
$function$;

-- Sem GRANT extra: SECURITY INVOKER com RLS de orders já garante isolamento por organização.
-- Smoke pós-deploy (orquestrador via MCP execute_sql, como role authenticated):
--   -- comportamento do pai (sem _sku), deve ser idêntico ao pré-migration:
--   SELECT * FROM orders_price_timeseries('MLB0000000000', NULL, NULL, NULL, 'day') LIMIT 1;
--   -- comportamento por variação (6 argumentos, _sku no fim):
--   SELECT * FROM orders_price_timeseries('MLB0000000000', NULL, NULL, NULL, 'day', 'SKU-000') LIMIT 1;
--   Ambas devem retornar 13 colunas sem erro "function does not exist" / "not unique".
