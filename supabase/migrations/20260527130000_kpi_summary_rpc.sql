CREATE OR REPLACE FUNCTION public.get_kpi_summary(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  gross_revenue     NUMERIC,
  total_frete       NUMERIC,
  total_comissao    NUMERIC,
  total_tax         NUMERIC,
  cmv               NUMERIC,
  has_tax_data      BOOLEAN,
  cmv_has_cost      BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(o.receita_bruta), 0)                         AS gross_revenue,
    COALESCE(SUM(o.frete), 0)                                 AS total_frete,
    COALESCE(SUM(o.comissao), 0)                              AS total_comissao,
    COALESCE(SUM(o.tax_amount), 0)                            AS total_tax,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)             AS cmv,
    BOOL_OR(COALESCE(o.tax_amount, 0) > 0)                    AS has_tax_data,
    BOOL_OR(o.custo_unit IS NOT NULL)                         AS cmv_has_cost
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to;
$$;

GRANT EXECUTE ON FUNCTION public.get_kpi_summary(UUID, TEXT[], DATE, DATE) TO authenticated;
