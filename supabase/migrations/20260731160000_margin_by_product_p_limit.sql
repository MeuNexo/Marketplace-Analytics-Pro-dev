-- Phase 18-01 Task 2 — parametrizar o teto de linhas de get_margin_by_product.
--
-- PROBLEMA
-- A função termina com `LIMIT 500`. Isso não é hipotético: a conta Thales já
-- tem 504 anúncios distintos em 90 dias e 1.324 em 12 meses, então o corte
-- acontece hoje — silenciosamente. Pior, `useMLMarginAnalysis.ts` soma as linhas
-- retornadas para montar a curva ABC, então em janela longa essa curva é
-- calculada sobre o top-500 e apresentada como total.
--
-- ESTRATÉGIA: NÃO usar DROP FUNCTION.
-- Adicionar um parâmetro muda a assinatura, e `CREATE OR REPLACE` não aceita
-- isso — o caminho óbvio seria DROP + CREATE. Mas DROP FUNCTION **apaga a ACL**
-- (o incidente de 2026-07-15 quase derrubou a EF nexo-chat exatamente assim).
--
-- Em vez disso:
--   1. cria a versão de 5 argumentos (com o corpo real);
--   2. troca o corpo da versão de 4 argumentos por um wrapper que chama a de 5
--      passando 500 — via CREATE OR REPLACE, que preserva a ACL porque a
--      assinatura não muda.
--
-- Resultado: o dash, que chama com 4 argumentos, recebe exatamente o mesmo
-- resultado de antes, byte a byte. Nada nele precisa mudar.
--
-- ACL da função de 4 args no momento desta migration (para conferência):
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

-- ── 1. Versão de 5 argumentos: o corpo real ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_margin_by_product(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE,
  p_limit    INT
)
RETURNS TABLE (
  item_id      TEXT,
  titulo       TEXT,
  sku          TEXT,
  listing_type TEXT,
  receita      NUMERIC,
  cmv          NUMERIC,
  comissao     NUMERIC,
  frete        NUMERIC,
  impostos     NUMERIC,
  lucro        NUMERIC,
  lucro_pct    NUMERIC,
  pedidos      BIGINT,
  unidades     BIGINT,
  has_cmv      BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    o.item_id,
    MAX(o.titulo)                                                          AS titulo,
    MAX(o.sku)                                                             AS sku,
    MAX(o.listing_type)                                                    AS listing_type,
    COALESCE(SUM(o.receita_bruta), 0)                                      AS receita,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)                          AS cmv,
    COALESCE(SUM(o.comissao), 0)                                           AS comissao,
    COALESCE(SUM(o.frete), 0)                                              AS frete,
    COALESCE(SUM(o.tax_amount), 0)                                         AS impostos,
    COALESCE(SUM(
      o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
      - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)
    ), 0)                                                                  AS lucro,
    CASE WHEN SUM(o.receita_bruta) > 0 THEN
      ROUND(SUM(
        o.receita_bruta - COALESCE(o.custo_unit * o.quantidade, 0)
        - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0) - COALESCE(o.tax_amount, 0)
      ) / SUM(o.receita_bruta) * 100, 2)
    ELSE NULL END                                                          AS lucro_pct,
    COUNT(*)                                                               AS pedidos,
    COALESCE(SUM(o.quantidade), 0)                                         AS unidades,
    BOOL_OR(o.custo_unit IS NOT NULL)                                      AS has_cmv
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id  = ANY(p_user_ids)
    AND o.status      IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to
    AND o.item_id IS NOT NULL
  GROUP BY o.item_id
  ORDER BY lucro DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_margin_by_product(UUID, TEXT[], DATE, DATE, INT) IS
  'Margem por anúncio no período. p_limit controla o teto de linhas; a versão de '
  '4 argumentos chama esta com 500 para preservar o comportamento do dash. '
  'ORDER BY lucro DESC: com p_limit baixo o resultado é o topo por lucro, não o total.';

-- ── 2. Versão de 4 argumentos vira wrapper (ACL preservada) ──────────────────
-- CREATE OR REPLACE mantém a assinatura, logo mantém a ACL. Sem DROP.

CREATE OR REPLACE FUNCTION public.get_margin_by_product(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  item_id      TEXT,
  titulo       TEXT,
  sku          TEXT,
  listing_type TEXT,
  receita      NUMERIC,
  cmv          NUMERIC,
  comissao     NUMERIC,
  frete        NUMERIC,
  impostos     NUMERIC,
  lucro        NUMERIC,
  lucro_pct    NUMERIC,
  pedidos      BIGINT,
  unidades     BIGINT,
  has_cmv      BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.get_margin_by_product(p_org_id, p_user_ids, p_from, p_to, 500);
$$;

-- ── 3. GRANT explícito na função nova ────────────────────────────────────────
-- A de 4 args conserva a ACL por não ter sido dropada; a de 5 args é nova e
-- precisa dos grants espelhando a original.

GRANT EXECUTE ON FUNCTION public.get_margin_by_product(UUID, TEXT[], DATE, DATE, INT)
  TO anon, authenticated, service_role;
