-- Phase 90-02: contrato de dados do CMV a preço de custo cheio.
--
-- Hoje `sync-tiny-costs` colapsa `precos.precoCustoMedio ?? precos.precoCusto`
-- numa única coluna `ml_product_costs.cost` — o "preço de custo cheio" nunca é
-- persistido em lugar nenhum (ver 90-RESEARCH.md Q3/Landmines). Esta migration
-- cria o contrato de dados que separa os dois valores, para o mês FECHADO da
-- DRE (Plan 90-03/90-04) poder trocar CMV custo-médio → CMV custo cheio.
--
-- Par correto (decisão LOCKED, ver 90-CONTEXT.md): imposto real + CMV cheio
-- (custo cheio evita contar 2× o crédito de ICMS/PIS/COFINS já embutido na
-- guia real do Lucro Real não-cumulativo).

-- ──────────────────────────────────────────────────────────────────────────────
-- BLOCO A: ml_product_costs.cost_full — preço de custo cheio (Tiny `precoCusto`)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ml_product_costs
  ADD COLUMN IF NOT EXISTS cost_full numeric(12, 2) DEFAULT NULL;

COMMENT ON COLUMN public.ml_product_costs.cost_full IS
  'Preço de custo cheio (Tiny `precoCusto`, cadastro manual) — separado do `cost` '
  '(custo médio-preferido, Tiny `precoCustoMedio` com fallback para `precoCusto`). '
  'Usado pelo CMV cheio no mês fechado da DRE (Phase 90).';

-- ──────────────────────────────────────────────────────────────────────────────
-- BLOCO B: orders.custo_unit_cheio — custo cheio por linha, casado por SKU
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS custo_unit_cheio numeric DEFAULT NULL;

COMMENT ON COLUMN public.orders.custo_unit_cheio IS
  'Custo unitário a preço de custo cheio (paralelo a `custo_unit`, que é custo '
  'médio-preferido). Escrito por recalc-order-costs a partir de '
  'ml_product_costs.cost_full, casado por SKU. Populado retroativamente pela '
  'migration de backfill 20260690000200 (Phase 90).';

-- ──────────────────────────────────────────────────────────────────────────────
-- BLOCO C: get_cost_waterfall — acrescenta cmv_cheio, mantém tudo o mais igual
-- ──────────────────────────────────────────────────────────────────────────────
-- RETURNS TABLE muda de forma (nova coluna) → precisa DROP+CREATE (CREATE OR
-- REPLACE falha com "cannot change return type of existing function" quando o
-- RETURNS TABLE ganha uma coluna nova — lição da Phase 83).
DROP FUNCTION IF EXISTS public.get_cost_waterfall(uuid, text[], date, date);

CREATE FUNCTION public.get_cost_waterfall(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  paid_revenue   NUMERIC,
  cmv            NUMERIC,
  total_comissao NUMERIC,
  total_frete    NUMERIC,
  total_tax      NUMERIC,
  orders_count   BIGINT,
  cmv_cheio      NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(
      COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)
    ), 0)                                                        AS paid_revenue,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)                AS cmv,
    COALESCE(SUM(o.comissao), 0)                                 AS total_comissao,
    COALESCE(SUM(o.frete), 0)                                    AS total_frete,
    COALESCE(SUM(o.tax_amount), 0)                               AS total_tax,
    COUNT(*)                                                     AS orders_count,
    -- CMV a preço de custo cheio COM fallback para custo médio por linha quando
    -- o SKU não tem preço de custo cadastrado no Tiny (revenda / cost_full NULL).
    -- Sem o COALESCE interno, linhas sem cost_full somariam 0 → subestimariam o
    -- CMV → superestimariam o lucro (direção errada p/ número conciliado). Fallback
    -- = custo médio (custo_unit) é a melhor estimativa do custo bruto nesses casos.
    COALESCE(SUM(COALESCE(o.custo_unit_cheio, o.custo_unit) * o.quantidade), 0) AS cmv_cheio
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to;
$$;

GRANT EXECUTE ON FUNCTION public.get_cost_waterfall(UUID, TEXT[], DATE, DATE) TO authenticated;
