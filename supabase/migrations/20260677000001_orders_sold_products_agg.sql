-- Agregação server-side de pedidos pagos por anúncio, para as páginas
-- "Produtos Vendidos" e "Análise de Preços" (Phase 77 — fix pós-preview).
--
-- MOTIVAÇÃO (bugs validados pelo Wesley em 2026-07-01):
--   1. O hook useMLSoldProducts paginava `orders` client-side com teto de 50.000
--      linhas — mas só os últimos 30 dias já têm ~55k pedidos pagos → truncamento
--      silencioso em QUALQUER período.
--   2. `data_pedido` é TEXT com formatos MISTOS no banco ("YYYY-MM-DD" e
--      "YYYY-MM-DD HH24:MI:SS+00"). Filtro string `.lte("YYYY-MM-DD")` exclui as
--      linhas do último dia no formato longo. Aqui o cast `::date` normaliza tudo.
--
-- SECURITY INVOKER (padrão anti-IDOR Phases 63/69/77 — sem DEFINER, sem parâmetro
-- org): a RLS de `orders` isola por organização do chamador autenticado.
-- Set-based, sem subquery correlacionada (lição RPC INVOKER statement_timeout 8s).
--
-- Deploy: via MCP apply_migration no projeto ckcdevcxgvueywivefgx.
CREATE OR REPLACE FUNCTION public.orders_sold_products_agg(
  _ml_user_ids  text[] DEFAULT NULL,
  _from         date   DEFAULT NULL,
  _to           date   DEFAULT NULL
)
RETURNS TABLE(
  item_id        text,
  titulo         text,
  marca          text,
  quantidade     bigint,
  receita_bruta  numeric,
  pedidos        bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    o.item_id,
    max(o.titulo)                 AS titulo,
    max(o.marca)                  AS marca,
    SUM(o.quantidade)::bigint     AS quantidade,
    SUM(o.receita_bruta)::numeric AS receita_bruta,
    COUNT(*)::bigint              AS pedidos
  FROM orders o
  WHERE o.status = 'paid'
    AND o.item_id IS NOT NULL
    AND (_ml_user_ids IS NULL OR array_length(_ml_user_ids, 1) IS NULL OR o.ml_user_id = ANY(_ml_user_ids))
    AND (_from IS NULL OR o.data_pedido::date >= _from)
    AND (_to   IS NULL OR o.data_pedido::date <= _to)
  GROUP BY o.item_id
  ORDER BY SUM(o.receita_bruta) DESC;
$function$;

-- Smoke pós-deploy (orquestrador via MCP execute_sql):
--   SELECT count(*) FROM orders_sold_products_agg(NULL, (CURRENT_DATE-30)::date, CURRENT_DATE);
--   Comparar SUM(quantidade) com SELECT SUM(quantidade) FROM orders WHERE status='paid' AND data_pedido::date BETWEEN ...
