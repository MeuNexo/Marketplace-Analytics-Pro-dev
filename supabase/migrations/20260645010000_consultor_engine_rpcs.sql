-- ============================================================
-- Phase 45 Consultor v1 — RPCs SECURITY DEFINER para o engine
-- ============================================================
--
-- NOTA ARQUITETURAL IMPORTANTE:
--   TACoS (regra 3) e meta do mês (regra 10) NÃO viram RPC aqui.
--   São queries agregadas pequenas (≤ alguns registros) que o engine
--   (EF Deno consultor-insights) roda inline sem risco de truncamento.
--
--   A receita usada para TACoS e meta é SEMPRE `orders.receita_bruta`
--   (NÃO `ml_daily_cache.approved_revenue`, que é scoped por user_id
--   e não por organization_id — descoberta desta fase, corrige A5 do RESEARCH.md).
--
-- Por que RPCs SECURITY DEFINER aqui:
--   As regras de margem, cobertura e custo ausente podem envolver
--   centenas ou milhares de produtos por org. Se o engine usasse
--   supabase.from('orders').select(...) ou similar via PostgREST,
--   haveria truncamento em 1000 linhas (Pitfall 1 do RESEARCH.md).
--   RPCs SQL retornam aggregados sem limite PostgREST.
--
--   SECURITY DEFINER: engine na EF invoca via service_role_key;
--   DEFINER garante que a função roda com os privilégios do owner
--   e sempre aplica o filtro org explícito (p_org_id).
--   GRANT EXECUTE apenas a service_role (não a authenticated).
--
-- Nomes de coluna baseados em inspeção direta do codebase:
--   orders: receita_bruta, custo_unit, quantidade, comissao, frete,
--           tax_amount, status, data_pedido, item_id, ml_user_id,
--           organization_id (VERIFIED: 20260527110000_margin_aggregate_rpcs.sql)
--   ml_inventory_cache: item_id, available_quantity, price, title, status,
--                       organization_id, seller_custom_field
--   ml_product_daily_cache: item_id, qty_sold, date, organization_id
--   ml_product_costs: item_id, seller_sku, organization_id, cost
--   (Se algum nome divergir na validação via MCP, orquestrador corrige e reaaplica.)
--
-- Idempotente: CREATE OR REPLACE FUNCTION.
-- Supabase project: ckcdevcxgvueywivefgx.
-- ============================================================


-- ============================================================
-- RPC 1: get_consultor_margin_by_product
-- ============================================================
-- Calcula margem líquida por item_id para o engine avaliar
-- regras D-03 (margem crítica ≤ 0% e alerta ≤ alvo).
--
-- Filtra apenas pedidos pagos, org-scoped, com custo cadastrado.
-- Retorna somente produtos com receita > 0 (HAVING).
-- Sem LIMIT: o engine precisa de todos os produtos (sem truncar).
--
-- Parâmetros:
--   p_org_id   — organization_id da org a processar
--   p_user_ids — array de ml_user_id da org (obtido via ml_tokens)
--   p_from     — data inicial do período (últimos 30d tipicamente)
--   p_to       — data final do período (hoje)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_consultor_margin_by_product(
  p_org_id   uuid,
  p_user_ids text[],
  p_from     date,
  p_to       date
)
RETURNS TABLE (
  item_id   text,
  receita   numeric,
  lucro     numeric,
  lucro_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.item_id,
    COALESCE(SUM(o.receita_bruta), 0)                                     AS receita,
    COALESCE(SUM(
      o.receita_bruta
      - COALESCE(o.custo_unit * o.quantidade, 0)
      - COALESCE(o.comissao, 0)
      - COALESCE(o.frete, 0)
      - COALESCE(o.tax_amount, 0)
    ), 0)                                                                  AS lucro,
    CASE
      WHEN SUM(o.receita_bruta) > 0 THEN
        ROUND(SUM(
          o.receita_bruta
          - COALESCE(o.custo_unit * o.quantidade, 0)
          - COALESCE(o.comissao, 0)
          - COALESCE(o.frete, 0)
          - COALESCE(o.tax_amount, 0)
        ) / SUM(o.receita_bruta) * 100, 2)
      ELSE NULL
    END                                                                    AS lucro_pct
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to
    AND o.custo_unit  IS NOT NULL
    AND o.item_id     IS NOT NULL
  GROUP BY o.item_id
  HAVING SUM(o.receita_bruta) > 0
$$;

GRANT EXECUTE ON FUNCTION public.get_consultor_margin_by_product(uuid, text[], date, date)
  TO service_role;


-- ============================================================
-- RPC 2: get_consultor_coverage
-- ============================================================
-- Calcula cobertura de estoque em dias por item_id para o engine
-- avaliar regras D-05 (crítico ≤ 7d, alerta ≤ 15d).
--
-- Porta a lógica de useMLCoverage.ts para SQL:
--   avg_daily = SUM(qty_sold nos últimos 30d) / 30
--   coverage_days = FLOOR(available_quantity / avg_daily)
--
-- Inclui apenas itens ativos (status='active') em ml_inventory_cache.
-- LEFT JOIN com vendas: itens sem vendas no período terão avg_daily=0
-- → coverage_days=NULL (ruptura desconhecida, engine trata como não crítico).
--
-- Parâmetros:
--   p_org_id — organization_id da org
--   p_from   — data inicial do lookback de vendas (tipicamente NOW()-30d)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_consultor_coverage(
  p_org_id uuid,
  p_from   date
)
RETURNS TABLE (
  item_id       text,
  title         text,
  price         numeric,
  coverage_days integer,
  avg_daily     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sales AS (
    SELECT
      s.item_id,
      COALESCE(SUM(s.qty_sold), 0) / 30.0  AS avg_daily
    FROM public.ml_product_daily_cache s
    WHERE
      s.organization_id = p_org_id
      AND s.date >= p_from
    GROUP BY s.item_id
  ),
  inventory AS (
    SELECT
      i.item_id,
      i.title,
      i.price,
      i.available_quantity
    FROM public.ml_inventory_cache i
    WHERE
      i.organization_id = p_org_id
      AND i.status = 'active'
  )
  SELECT
    i.item_id,
    i.title,
    i.price,
    CASE
      WHEN COALESCE(s.avg_daily, 0) > 0
        THEN FLOOR(i.available_quantity / s.avg_daily)::integer
      ELSE NULL
    END                             AS coverage_days,
    COALESCE(s.avg_daily, 0)       AS avg_daily
  FROM inventory i
  LEFT JOIN sales s USING (item_id)
$$;

GRANT EXECUTE ON FUNCTION public.get_consultor_coverage(uuid, date)
  TO service_role;


-- ============================================================
-- RPC 3: get_consultor_paused_with_sales
-- ============================================================
-- Identifica anúncios pausados que tiveram vendas no lookback
-- para a regra D-08 (anúncio pausado com histórico de venda).
--
-- Default lookback: 30 dias (D-08 / paused_ads_lookback_days na config).
-- O engine passa p_from = NOW() - paused_ads_lookback_days.
--
-- Retorna apenas itens com status='paused' em ml_inventory_cache
-- que tenham SUM(qty_sold) > 0 no período. O engine estima impacto:
--   vendas_30d × price = receita mensal em risco (D-13).
--
-- Parâmetros:
--   p_org_id — organization_id da org
--   p_from   — data inicial do lookback (tipicamente NOW()-30d)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_consultor_paused_with_sales(
  p_org_id uuid,
  p_from   date
)
RETURNS TABLE (
  item_id    text,
  title      text,
  price      numeric,
  vendas_30d numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.item_id,
    i.title,
    i.price,
    COALESCE(SUM(s.qty_sold), 0)  AS vendas_30d
  FROM public.ml_inventory_cache i
  JOIN public.ml_product_daily_cache s
    ON  s.item_id        = i.item_id
    AND s.organization_id = i.organization_id
    AND s.date           >= p_from
  WHERE
    i.organization_id = p_org_id
    AND i.status = 'paused'
  GROUP BY i.item_id, i.title, i.price
  HAVING SUM(s.qty_sold) > 0
$$;

GRANT EXECUTE ON FUNCTION public.get_consultor_paused_with_sales(uuid, date)
  TO service_role;


-- ============================================================
-- RPC 4: get_consultor_no_cost_count
-- ============================================================
-- Conta itens ativos sem custo cadastrado para a regra "Completude Custos"
-- (produto sem CMV = motor não consegue calcular margem real).
--
-- Faz LEFT JOIN de ml_inventory_cache (ativos) com ml_product_costs
-- tentando match por item_id OU por seller_sku (seller_custom_field).
-- Itens sem match em ambos os critérios = sem custo.
--
-- Retorna: integer (COUNT de itens ativos sem custo).
--
-- Parâmetros:
--   p_org_id — organization_id da org
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_consultor_no_cost_count(
  p_org_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(i.item_id)::integer
  FROM public.ml_inventory_cache i
  LEFT JOIN public.ml_product_costs c
    ON  c.organization_id = i.organization_id
    AND (
      c.item_id   = i.item_id
      OR c.seller_sku = i.seller_custom_field
    )
  WHERE
    i.organization_id = p_org_id
    AND i.status = 'active'
    AND c.item_id IS NULL
$$;

GRANT EXECUTE ON FUNCTION public.get_consultor_no_cost_count(uuid)
  TO service_role;
