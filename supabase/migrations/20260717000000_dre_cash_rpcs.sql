-- Phase 99 (DRE Caixa — apuração por recebimento Mercado Pago) — Plan 99-01.
--
-- 3 RPCs NOVAS (100% aditivo, nenhuma função existente é tocada):
--   1. get_dre_cash(p_org_id, p_month)          -> linhas cruas entrada/saida/previsao
--   2. get_dre_cash_items(p_org_id, p_month, p_bloco) -> drill-down de lançamentos
--   3. get_dre_cash_history(p_org_id, p_months)  -> até 12 meses (entradas/saidas/resultado)
--
-- Fonte da verdade: docs/superpowers/specs/2026-07-16-dre-caixa-design.md +
-- 99-CONTEXT.md (decisões LOCKED). Regime de CAIXA PURO, sem shift de mês:
--   - Entradas = líquido recebido do Mercado Pago pela data de liberação.
--   - Saídas   = contas pagas do Tiny pela data efetiva de pagamento.
--   - Tarifas do Mercado Livre NÃO são abatidas de novo aqui — já vêm
--     retidas na fonte dentro do valor líquido recebido do Mercado Pago.
--   - A "previsão de imposto" desta phase usa o MESMO mês da guia paga e do
--     faturamento (nunca o mês seguinte) — é uma régua deliberadamente
--     diferente da DRE por competência (página Vendas), que fica intocada.
--
-- Padrão obrigatório do projeto (clonado de get_inss_guia_by_competence /
-- get_cost_waterfall / dre_bloco_for_category): cabeçalho canônico de RPC
-- somente-leitura definido por invocador + search_path fixo + revogação
-- explícita de acesso público seguida de concessão só ao papel logado. RLS
-- org-first das tabelas de origem (is_org_member) faz o isolamento entre
-- organizações — nenhuma destas 3 funções filtra por org na aplicação, só
-- via WHERE organization_id = p_org_id combinado com a policy de SELECT.
--
-- Reusa public.dre_bloco_for_category(text) (já em produção, migration
-- 20260715221559) para mapear categoria -> bloco. Não redefinida aqui.
--
-- Zero subquery correlacionada — todo cruzamento entre saídas/faturamento
-- para a previsão de imposto (3 meses anteriores) é pré-agregado em CTEs
-- MATERIALIZED e unido por JOIN/generate_series, para não estourar o
-- statement_timeout de 8s do role authenticated.
--
-- Aplicar via Supabase MCP apply_migration no projeto ckcdevcxgvueywivefgx
-- (checkpoint da Task 2 deste plano) — NUNCA supabase db push, NUNCA SQL
-- Editor. Conferir max(version) vivo antes de aplicar (lição 2026-07-13).

-- ============================================================================
-- RPC 1 — get_dre_cash
-- ============================================================================

CREATE FUNCTION public.get_dre_cash(
  p_org_id uuid,
  p_month  date
)
RETURNS TABLE (
  secao     text,
  bloco     text,
  categoria text,
  total     numeric,
  n         integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH params AS MATERIALIZED (
    SELECT
      date_trunc('month', p_month)::date                        AS mes_ini,
      (date_trunc('month', p_month) + interval '1 month')::date AS mes_fim_excl,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date             AS hoje
  ),
  inflows_agg AS MATERIALIZED (
    SELECT
      COALESCE(SUM(ci.gross_amount) FILTER (WHERE ci.release_date <= p.hoje), 0)  AS bruto_total,
      COUNT(*) FILTER (WHERE ci.release_date <= p.hoje)::int                       AS bruto_n,
      COALESCE(SUM(ci.net_amount) FILTER (WHERE ci.release_date <= p.hoje), 0)    AS liquido_total,
      COUNT(*) FILTER (WHERE ci.release_date <= p.hoje)::int                       AS liquido_n,
      COALESCE(SUM(ci.net_amount) FILTER (
        WHERE ci.release_date <= p.hoje AND ci.status_mp = 'refunded'
      ), 0)                                                                        AS refunds_total,
      COUNT(*) FILTER (
        WHERE ci.release_date <= p.hoje AND ci.status_mp = 'refunded'
      )::int                                                                       AS refunds_n,
      COALESCE(SUM(ci.net_amount) FILTER (WHERE ci.release_date > p.hoje), 0)     AS a_liberar_total,
      COUNT(*) FILTER (WHERE ci.release_date > p.hoje)::int                        AS a_liberar_n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date >= p.mes_ini
      AND ci.release_date <  p.mes_fim_excl
  ),
  saida_agg AS MATERIALIZED (
    SELECT
      public.dre_bloco_for_category(co.category) AS bloco,
      co.category                                 AS categoria,
      SUM(co.amount)                              AS total,
      COUNT(*)::int                               AS n
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'paid'
      AND co.outflow_date >= p.mes_ini
      AND co.outflow_date <  p.mes_fim_excl
    GROUP BY 1, 2
  ),
  imposto_guia_mes AS MATERIALIZED (
    SELECT
      COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0) AS total,
      COUNT(*) FILTER (WHERE co.status = 'paid')::int                AS n
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND public.dre_bloco_for_category(co.category) = 'impostos_venda'
      AND co.outflow_date >= p.mes_ini
      AND co.outflow_date <  p.mes_fim_excl
  ),
  faturamento_mes AS MATERIALIZED (
    SELECT
      COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0) AS total,
      COUNT(*)::int                                                                AS n
    FROM public.orders o
    CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND o.data_pedido::date >= p.mes_ini
      AND o.data_pedido::date <  p.mes_fim_excl
  ),
  meses_anteriores AS MATERIALIZED (
    SELECT
      k,
      (date_trunc('month', p_month) - (k || ' months')::interval)::date        AS mes_k_ini,
      (date_trunc('month', p_month) - ((k - 1) || ' months')::interval)::date  AS mes_k_fim_excl
    FROM generate_series(1, 3) AS k
  ),
  guias_anteriores AS MATERIALIZED (
    SELECT
      m.k,
      COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0) AS guia
    FROM meses_anteriores m
    LEFT JOIN public.cash_outflows co
      ON co.organization_id = p_org_id
     AND public.dre_bloco_for_category(co.category) = 'impostos_venda'
     AND co.outflow_date >= m.mes_k_ini
     AND co.outflow_date <  m.mes_k_fim_excl
    GROUP BY m.k
  ),
  faturamento_anteriores AS MATERIALIZED (
    SELECT
      m.k,
      COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0) AS faturamento
    FROM meses_anteriores m
    LEFT JOIN public.orders o
      ON o.organization_id = p_org_id
     AND o.status IN ('paid','shipped','delivered')
     AND o.data_pedido::date >= m.mes_k_ini
     AND o.data_pedido::date <  m.mes_k_fim_excl
    GROUP BY m.k
  ),
  taxas AS MATERIALIZED (
    SELECT
      g.k,
      CASE
        WHEN g.guia > 0 AND f.faturamento > 0 THEN g.guia / f.faturamento
        ELSE NULL
      END AS taxa
    FROM guias_anteriores g
    JOIN faturamento_anteriores f USING (k)
  ),
  previsao_calc AS MATERIALIZED (
    SELECT
      AVG(taxa)     AS taxa_media,
      COUNT(taxa)::int AS n_validas
    FROM taxas
  )
  -- seção entrada (bloco NULL) — base de cash_inflows por release_date
  SELECT 'entrada'::text, NULL::text, 'bruto'::text,            ia.bruto_total,                     ia.bruto_n     FROM inflows_agg ia
  UNION ALL
  SELECT 'entrada'::text, NULL::text, 'liquido'::text,          ia.liquido_total,                   ia.liquido_n   FROM inflows_agg ia
  UNION ALL
  SELECT 'entrada'::text, NULL::text, 'descontos_fonte'::text,  (ia.bruto_total - ia.liquido_total), ia.bruto_n     FROM inflows_agg ia
  UNION ALL
  SELECT 'entrada'::text, NULL::text, 'refunds'::text,          ia.refunds_total,                   ia.refunds_n   FROM inflows_agg ia
  UNION ALL
  SELECT 'entrada'::text, NULL::text, 'a_liberar'::text,        ia.a_liberar_total,                 ia.a_liberar_n FROM inflows_agg ia
  UNION ALL
  -- seção saida — todos os blocos de cash_outflows pagos no mês (inclui excluido/nao_classificado;
  -- o filtro de cascata é responsabilidade da lib pura no frontend)
  SELECT 'saida'::text, sa.bloco, sa.categoria, sa.total, sa.n FROM saida_agg sa
  UNION ALL
  -- seção previsao (bloco NULL) — guia paga no mês, faturamento do mês, e a previsão
  -- pela média das taxas (guia/faturamento) dos até 3 meses anteriores válidos
  SELECT 'previsao'::text, NULL::text, 'imposto_guia_paga'::text, ig.total, ig.n FROM imposto_guia_mes ig
  UNION ALL
  SELECT 'previsao'::text, NULL::text, 'faturamento_mes'::text,   fm.total, fm.n FROM faturamento_mes fm
  UNION ALL
  SELECT
    'previsao'::text,
    NULL::text,
    'imposto_previsto'::text,
    CASE WHEN pc.n_validas > 0 THEN pc.taxa_media * fm.total ELSE NULL END,
    pc.n_validas
  FROM previsao_calc pc
  CROSS JOIN faturamento_mes fm
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_cash(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_cash(uuid, date) TO authenticated;

-- ============================================================================
-- RPC 2 — get_dre_cash_items (drill-down de lançamentos pagos de um bloco)
-- ============================================================================

CREATE FUNCTION public.get_dre_cash_items(
  p_org_id uuid,
  p_month  date,
  p_bloco  text
)
RETURNS TABLE (
  outflow_date    date,
  supplier        text,
  category        text,
  amount          numeric,
  document_number text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    co.outflow_date,
    co.supplier,
    co.category,
    co.amount,
    co.document_number
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.status = 'paid'
    AND public.dre_bloco_for_category(co.category) = p_bloco
    AND co.outflow_date >= date_trunc('month', p_month)::date
    AND co.outflow_date <  (date_trunc('month', p_month) + interval '1 month')::date
  ORDER BY co.amount DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_cash_items(uuid, date, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_cash_items(uuid, date, text) TO authenticated;

-- ============================================================================
-- RPC 3 — get_dre_cash_history (até 12 meses de entradas/saidas/resultado)
-- ============================================================================

CREATE FUNCTION public.get_dre_cash_history(
  p_org_id uuid,
  p_months integer
)
RETURNS TABLE (
  mes       date,
  entradas  numeric,
  saidas    numeric,
  resultado numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH params AS MATERIALIZED (
    SELECT
      LEAST(GREATEST(p_months, 1), 12)                                          AS v_meses,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date                            AS hoje,
      (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        - ((LEAST(GREATEST(p_months, 1), 12) - 1) || ' months')::interval)::date AS range_ini
  ),
  meses AS MATERIALIZED (
    SELECT (date_trunc('month', p.hoje) - (gs || ' months')::interval)::date AS mes
    FROM params p, generate_series(0, p.v_meses - 1) AS gs
  ),
  inflows_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', ci.release_date)::date AS mes,
      COALESCE(SUM(ci.net_amount), 0)             AS entradas
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date >= p.range_ini
      AND ci.release_date <= p.hoje
    GROUP BY 1
  ),
  outflows_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', co.outflow_date)::date AS mes,
      COALESCE(SUM(co.amount), 0)                 AS saidas
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'paid'
      AND co.outflow_date >= p.range_ini
      AND public.dre_bloco_for_category(co.category) <> 'excluido'
    GROUP BY 1
  )
  SELECT
    m.mes,
    COALESCE(i.entradas, 0)                        AS entradas,
    COALESCE(o.saidas, 0)                           AS saidas,
    COALESCE(i.entradas, 0) - COALESCE(o.saidas, 0) AS resultado
  FROM meses m
  LEFT JOIN inflows_por_mes  i ON i.mes = m.mes
  LEFT JOIN outflows_por_mes o ON o.mes = m.mes
  ORDER BY m.mes;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_cash_history(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_cash_history(uuid, integer) TO authenticated;
