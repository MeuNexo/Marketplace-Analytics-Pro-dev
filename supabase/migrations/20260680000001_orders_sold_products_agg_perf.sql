-- Phase 80 — performance: acelera orders_sold_products_agg (lista de anúncios da tela
-- /analise-precos). Antes: Seq Scan de ~295k linhas + GROUP BY em disco = ~4,4s (30d).
-- Depois: 147ms (30d) / 2,5s (365d). Resultado IDÊNTICO ao original (::date = filtro exato).
--
-- Três coisas somadas (ver histórico de iteração v1..v5 na sessão):
--   1) predicado de texto redundante e sargable (superset com folga de 1 dia p/ os ~14k
--      pedidos em fuso != UTC) → habilita Index Scan por idx_orders_data_pedido; o ::date
--      exato depois remove as bordas, mantendo a semântica ao centavo.
--   2) EXECUTE dinâmico com valores interpolados como LITERAIS (format %L, quoting seguro):
--      com parâmetros o planner caía em plano genérico (seq scan / sort em disco); com
--      literais ele enxerga a seletividade real do range e escolhe Index Scan + sort em RAM.
--   3) SET LOCAL work_mem (exige VOLATILE) → o sort do GROUP BY cabe em memória em vez de
--      external merge em disco.
--
-- data_pedido é TEXT (não timestamptz) — daí o ::date não ser indexável diretamente.
-- Migrar a coluna para timestamptz é a solução definitiva, mas fica como melhoria futura.
CREATE OR REPLACE FUNCTION public.orders_sold_products_agg(
  _ml_user_ids text[] DEFAULT NULL::text[],
  _from date DEFAULT NULL::date,
  _to date DEFAULT NULL::date
)
 RETURNS TABLE(item_id text, titulo text, marca text, quantidade bigint, receita_bruta numeric, pedidos bigint)
 LANGUAGE plpgsql
 VOLATILE
 SET search_path TO 'public'
AS $function$
DECLARE
  _lo text := CASE WHEN _from IS NULL THEN NULL ELSE (_from - 1)::text END;  -- superset lower (folga fuso)
  _hi text := CASE WHEN _to   IS NULL THEN NULL ELSE (_to   + 2)::text END;  -- superset upper (folga fuso)
BEGIN
  SET LOCAL work_mem = '128MB';
  RETURN QUERY EXECUTE format($q$
    SELECT
      o.item_id,
      max(o.titulo),
      max(o.marca),
      SUM(o.quantidade)::bigint,
      SUM(o.receita_bruta)::numeric,
      COUNT(*)::bigint
    FROM orders o
    WHERE o.status = 'paid'
      AND o.item_id IS NOT NULL
      AND (%L::text[] IS NULL OR array_length(%L::text[], 1) IS NULL OR o.ml_user_id = ANY(%L::text[]))
      AND (%L::date IS NULL OR o.data_pedido::date >= %L::date)
      AND (%L::date IS NULL OR o.data_pedido::date <= %L::date)
      AND (%L::text IS NULL OR o.data_pedido >= %L::text)
      AND (%L::text IS NULL OR o.data_pedido <  %L::text)
    GROUP BY o.item_id
    ORDER BY SUM(o.receita_bruta) DESC
  $q$, _ml_user_ids, _ml_user_ids, _ml_user_ids, _from, _from, _to, _to, _lo, _lo, _hi, _hi);
END;
$function$;
