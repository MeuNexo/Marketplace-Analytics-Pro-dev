-- Phase 99 (DRE Caixa) — FIX 2, decisão do dono no checkpoint, 2026-07-16.
--
-- Decisão registrada em 99-CONTEXT.md: "Entrada cheia + estorno como saída".
-- O RECEBIMENTO LÍQUIDO MP passa a ser só os créditos que caíram na conta
-- (net_amount > 0); os estornos (net_amount < 0) saem da base de entrada e
-- viram uma LINHA DE SAÍDA visível na cascata ("Estornos (devoluções MP)").
-- O resultado do mês NÃO muda — muda só a leitura (junho: entrada
-- 193.476,52; estornos −33.837,64 como saída; resultado continua
-- −44.666,66).
--
-- CREATE OR REPLACE (NUNCA DROP — DROP apaga a ACL, lição crítica do
-- projeto: feedback_drop_function_apaga_acl.md).
--
-- get_dre_cash — corpo base = 20260717000000_dre_cash_rpcs.sql. Única
-- mudança: a CTE `inflows_agg` deixa de usar `status_mp = 'refunded'` para
-- detectar estornos (era ruído — refunded no MP nem sempre bate com
-- net_amount negativo) e passa a usar o sinal de `net_amount`:
--   - bruto/liquido agora só somam linhas com net_amount > 0 (créditos que
--     de fato caíram na conta) — a base fica "cheia", sem estornos dentro.
--   - descontos_fonte = bruto − liquido, agora coerente (tarifas só das
--     vendas que entraram).
--   - refunds passa a ser SUM(net_amount) FILTER (net_amount < 0) — valor
--     negativo, categoria `refunds` mantida por compat (a lib pura do
--     frontend, dreCashCascade.ts, é quem vira essa linha em SAÍDA
--     "Estornos (devoluções MP)", com ABS, logo após Fornecedores).
--   - a_liberar e as seções saida/previsao NÃO mudam.
--
-- get_dre_cash_history — corpo base = 20260717010000 (que já soma
-- fornecedores/`excluido` nas saídas). Única mudança: `entradas` do mês
-- passa a somar só net_amount > 0 (créditos), e os estornos do mês
-- (ABS de net_amount < 0, pré-agregados numa CTE própria por mês —
-- cash_inflows não tem NADA em comum com cash_outflows, então cada fonte é
-- agregada separadamente e só unida por LEFT JOIN no SELECT final, sem
-- subquery correlacionada) somam junto às saídas normais de cash_outflows.
-- `resultado` é algebricamente idêntico ao valor anterior — só migrou de
-- lado dentro da conta (entradas − estornos − outras_saidas, em vez de
-- (entradas líquidas já netadas) − outras_saidas).
--
-- Aplicar via Supabase MCP apply_migration no projeto ckcdevcxgvueywivefgx
-- — NUNCA supabase db push, NUNCA SQL Editor. Conferir max(version) vivo
-- antes de aplicar (lição 2026-07-13).

-- ============================================================================
-- RPC 1 — get_dre_cash (entrada cheia; refunds = estornos negativos)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dre_cash(
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
      -- [FIX 2 2026-07-16] bruto/liquido só somam créditos que caíram na
      -- conta (net_amount > 0) — base "cheia", sem estornos misturados.
      COALESCE(SUM(ci.gross_amount) FILTER (
        WHERE ci.release_date <= p.hoje AND ci.net_amount > 0
      ), 0)                                                                        AS bruto_total,
      COUNT(*) FILTER (
        WHERE ci.release_date <= p.hoje AND ci.net_amount > 0
      )::int                                                                       AS bruto_n,
      COALESCE(SUM(ci.net_amount) FILTER (
        WHERE ci.release_date <= p.hoje AND ci.net_amount > 0
      ), 0)                                                                        AS liquido_total,
      COUNT(*) FILTER (
        WHERE ci.release_date <= p.hoje AND ci.net_amount > 0
      )::int                                                                       AS liquido_n,
      -- [FIX 2 2026-07-16] refunds = estornos (net_amount < 0), não mais
      -- status_mp = 'refunded'. Continua negativo — a lib pura do frontend
      -- é quem transforma isso em linha de SAÍDA com ABS.
      COALESCE(SUM(ci.net_amount) FILTER (
        WHERE ci.release_date <= p.hoje AND ci.net_amount < 0
      ), 0)                                                                        AS refunds_total,
      COUNT(*) FILTER (
        WHERE ci.release_date <= p.hoje AND ci.net_amount < 0
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
-- RPC 2 — get_dre_cash_history (estornos somam nas saídas do histórico)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dre_cash_history(
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
  -- [FIX 2 2026-07-16] entradas do mês = só créditos (net_amount > 0) —
  -- base cheia, sem estornos netados dentro.
  inflows_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', ci.release_date)::date AS mes,
      COALESCE(SUM(ci.net_amount) FILTER (WHERE ci.net_amount > 0), 0) AS entradas
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date >= p.range_ini
      AND ci.release_date <= p.hoje
    GROUP BY 1
  ),
  -- [FIX 2 2026-07-16] estornos do mês, pré-agregados numa CTE própria
  -- (fonte é cash_inflows, igual entradas — nunca cash_outflows). ABS já
  -- aplicado aqui para somar direto com saidas_outflows.
  estornos_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', ci.release_date)::date AS mes,
      COALESCE(ABS(SUM(ci.net_amount) FILTER (WHERE ci.net_amount < 0)), 0) AS estornos
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
      -- Fornecedores (bloco `excluido`) somam como saída na DRE Caixa —
      -- decisão do dono do checkpoint anterior (20260717010000). Sem
      -- filtro `<> 'excluido'` de propósito.
    GROUP BY 1
  )
  SELECT
    m.mes,
    COALESCE(i.entradas, 0)                                             AS entradas,
    COALESCE(o.saidas, 0) + COALESCE(e.estornos, 0)                     AS saidas,
    COALESCE(i.entradas, 0) - (COALESCE(o.saidas, 0) + COALESCE(e.estornos, 0)) AS resultado
  FROM meses m
  LEFT JOIN inflows_por_mes  i ON i.mes = m.mes
  LEFT JOIN outflows_por_mes o ON o.mes = m.mes
  LEFT JOIN estornos_por_mes e ON e.mes = m.mes
  ORDER BY m.mes;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_cash_history(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_cash_history(uuid, integer) TO authenticated;
