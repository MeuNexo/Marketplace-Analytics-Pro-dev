-- Série temporal de preço praticado por anúncio, para a página "Análise de Preços".
-- Portada de /root/garment-glow-official/supabase/migrations/20260630170000_orders_price_timeseries.sql
--
-- ADAPTAÇÃO vs. oficial (Phase 77):
--   - oficial: o.data_pedido é tipo date  → pode usar direto no date_trunc e nos filtros
--   - nosso:   o.data_pedido é TEXT        → cast o.data_pedido::date obrigatório
--
-- SECURITY INVOKER (padrão anti-IDOR Phases 63/69 — sem DEFINER, sem parâmetro org):
--   A RLS de `orders` já isola por organização do chamador autenticado.
--   Usar DEFINER com p_org_id seria IDOR crítico (Phase 63 lesson).
--
-- Deploy: via MCP apply_migration no projeto ckcdevcxgvueywivefgx (não via SQL Editor).
CREATE OR REPLACE FUNCTION public.orders_price_timeseries(
  _item_id      text,
  _ml_user_ids  text[] DEFAULT NULL,
  _from         date   DEFAULT NULL,
  _to           date   DEFAULT NULL,
  _granularity  text   DEFAULT 'day'
)
RETURNS TABLE(
  bucket       date,
  preco_medio  numeric,
  preco_min    numeric,
  preco_max    numeric,
  qtd          bigint,
  total        numeric,
  orders       bigint
)
LANGUAGE sql
STABLE
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
    MIN(o.preco_unit)::numeric  AS preco_min,
    MAX(o.preco_unit)::numeric  AS preco_max,
    SUM(o.quantidade)::bigint   AS qtd,
    SUM(o.receita_bruta)::numeric AS total,
    COUNT(*)::bigint             AS orders
  FROM orders o
  WHERE o.item_id = _item_id
    AND o.status IN ('paid', 'shipped', 'delivered')
    AND (_ml_user_ids IS NULL OR array_length(_ml_user_ids, 1) IS NULL OR o.ml_user_id = ANY(_ml_user_ids))
    AND (_from IS NULL OR o.data_pedido::date >= _from)
    AND (_to   IS NULL OR o.data_pedido::date <= _to)
  GROUP BY 1
  ORDER BY 1;
$function$;

-- Sem GRANT extra: SECURITY INVOKER com RLS de orders já garante isolamento de org.
-- Smoke pós-deploy (orquestrador via MCP execute_sql):
--   SELECT * FROM orders_price_timeseries('MLB0000000000', NULL, NULL, NULL, 'day') LIMIT 1;
--   Deve retornar sem erro "function does not exist".
