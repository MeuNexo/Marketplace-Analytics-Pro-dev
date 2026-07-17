-- Phase 99 (DRE Caixa) — FIX 3, decisão do dono, 2026-07-17.
--
-- Decisão: "estorno pesa no mês em que o dinheiro SAIU, não no mês da venda
-- original". Hoje uma venda de junho estornada em julho abate junho
-- retroativamente (porque get_dre_cash/get_dre_cash_history filtram tudo por
-- `release_date`, e o estorno reaproveita a MESMA linha da liberação
-- original — mesmo payment_id, upsert onConflict). Passa a valer:
--   - a liberação ORIGINAL conta como ENTRADA no mês da liberação (o
--     dinheiro entrou de fato ali, mesmo que depois seja estornado);
--   - o estorno conta como SAÍDA no mês em que o estorno de fato aconteceu.
--
-- Para separar as duas datas é preciso uma coluna própria: `refund_date`.
-- A EF sync-mp-releases passa a gravar `date_last_updated` do payment quando
-- status = 'refunded' (melhor aproximação disponível no /v1/payments/search
-- para "quando o estorno aconteceu" — ver comentário na EF).
--
-- CREATE OR REPLACE (NUNCA DROP — DROP apaga a ACL, lição crítica do
-- projeto: feedback_drop_function_apaga_acl.md). Corpo base das 2 RPCs =
-- 20260717020000_dre_cash_estorno_como_saida.sql.
--
-- get_dre_cash — única mudança na CTE `inflows_agg` / nova CTE `refunds_agg`:
--   - bruto/liquido (entrada por release_date no mês) agora somam TODAS as
--     linhas do mês, inclusive as que depois foram estornadas:
--       * bruto  = SUM(gross_amount) — gross_amount é sempre o
--         transaction_amount original, nunca negativado pela EF, então já
--         está "cheio" por natureza.
--       * liquido = SUM(CASE WHEN net_amount > 0 THEN net_amount
--         ELSE ABS(net_amount) END) — recupera o valor da liberação
--         ORIGINAL quando a linha foi negativada pelo estorno (a EF grava
--         net_amount negativo em status='refunded'); o dinheiro entrou de
--         fato nesse mês, então conta cheio aqui.
--     descontos_fonte = bruto − liquido, continua coerente.
--   - refunds passa a ter régua PRÓPRIA, numa CTE separada (`refunds_agg`):
--     soma net_amount das linhas com net_amount < 0 cuja
--     COALESCE(refund_date, release_date) cai dentro do mês — SEM exigir que
--     release_date também esteja no mês. Um estorno de julho de uma venda
--     liberada em junho pertence a julho (mês em que o dinheiro saiu), não a
--     junho. `refund_date` NULL (linhas sync-adas antes desta migration, ou
--     refunded sem date_last_updated) cai no fallback `release_date` —
--     mantém o comportamento anterior para dados históricos sem a coluna.
--   - a_liberar e as seções saida/previsao NÃO mudam.
--
-- get_dre_cash_history — mesma lógica: `entradas` do mês por release_date
-- agora recupera o valor original (ABS quando negativo, igual acima);
-- `estornos_por_mes` agrupa por `date_trunc('month', COALESCE(refund_date,
-- release_date))` em vez de `release_date` — cada estorno cai no mês em que
-- realmente aconteceu. `resultado` continua sendo entradas − (saídas +
-- estornos), só migrou a régua de qual mês cada estorno pertence.
--
-- Aplicar via Supabase MCP apply_migration no projeto ckcdevcxgvueywivefgx
-- — NUNCA supabase db push, NUNCA SQL Editor. Conferir max(version) vivo
-- antes de aplicar (lição 2026-07-13). NÃO aplicar em prod neste commit —
-- orquestrador aplica depois.

-- ============================================================================
-- Coluna nova: cash_inflows.refund_date
-- ============================================================================

ALTER TABLE public.cash_inflows
  ADD COLUMN IF NOT EXISTS refund_date date;

COMMENT ON COLUMN public.cash_inflows.refund_date IS
  'Data em que o estorno de fato aconteceu (date_last_updated do payment no MP, quando status=refunded). NULL para liberações sem estorno, ou para linhas estornadas sincronizadas antes desta coluna existir (nesse caso a RPC usa release_date como fallback). Não confundir com release_date, que é a data da liberação ORIGINAL.';

CREATE INDEX IF NOT EXISTS idx_cash_inflows_org_refund_date
  ON public.cash_inflows (organization_id, refund_date)
  WHERE refund_date IS NOT NULL;

-- ============================================================================
-- RPC 1 — get_dre_cash (entrada cheia por release_date; estorno com régua
-- própria por refund_date)
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
      -- [FIX 3 2026-07-17] bruto soma TODAS as linhas do mês (inclusive as
      -- depois estornadas) — gross_amount é sempre o transaction_amount
      -- original, nunca negativado pela EF.
      COALESCE(SUM(ci.gross_amount) FILTER (
        WHERE ci.release_date <= p.hoje
      ), 0)                                                                        AS bruto_total,
      COUNT(*) FILTER (
        WHERE ci.release_date <= p.hoje
      )::int                                                                       AS bruto_n,
      -- [FIX 3] liquido recupera o valor da liberação ORIGINAL mesmo quando
      -- a linha foi negativada pelo estorno (ABS) — o dinheiro entrou de
      -- fato nesse mês; o estorno em si é contado em outro mês (refunds_agg).
      COALESCE(SUM(
        CASE WHEN ci.net_amount > 0 THEN ci.net_amount ELSE ABS(ci.net_amount) END
      ) FILTER (
        WHERE ci.release_date <= p.hoje
      ), 0)                                                                        AS liquido_total,
      COUNT(*) FILTER (
        WHERE ci.release_date <= p.hoje
      )::int                                                                       AS liquido_n,
      COALESCE(SUM(ci.net_amount) FILTER (WHERE ci.release_date > p.hoje), 0)     AS a_liberar_total,
      COUNT(*) FILTER (WHERE ci.release_date > p.hoje)::int                        AS a_liberar_n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date >= p.mes_ini
      AND ci.release_date <  p.mes_fim_excl
  ),
  refunds_agg AS MATERIALIZED (
    -- [FIX 3] estorno com régua PRÓPRIA: COALESCE(refund_date, release_date)
    -- dentro do mês — SEM restringir release_date ao mês. Um estorno de
    -- julho de venda liberada em junho pertence a julho (mês em que o
    -- dinheiro saiu de fato), nunca a junho retroativamente.
    SELECT
      COALESCE(SUM(ci.net_amount), 0) AS refunds_total,
      COUNT(*)::int                    AS refunds_n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.net_amount < 0
      AND COALESCE(ci.refund_date, ci.release_date) >= p.mes_ini
      AND COALESCE(ci.refund_date, ci.release_date) <  p.mes_fim_excl
      AND COALESCE(ci.refund_date, ci.release_date) <= p.hoje
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
  SELECT 'entrada'::text, NULL::text, 'refunds'::text,          ra.refunds_total,                   ra.refunds_n   FROM refunds_agg ra
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
-- RPC 2 — get_dre_cash_history (estorno pesa no mês do refund_date, não no
-- mês da liberação original)
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
  -- [FIX 3 2026-07-17] entradas do mês (por release_date) recuperam o valor
  -- da liberação ORIGINAL mesmo quando a linha foi negativada pelo estorno
  -- (ABS) — o dinheiro entrou de fato nesse mês.
  inflows_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', ci.release_date)::date AS mes,
      COALESCE(SUM(
        CASE WHEN ci.net_amount > 0 THEN ci.net_amount ELSE ABS(ci.net_amount) END
      ), 0) AS entradas
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date >= p.range_ini
      AND ci.release_date <= p.hoje
    GROUP BY 1
  ),
  -- [FIX 3] estornos agrupados pelo mês em que de fato aconteceram —
  -- date_trunc('month', COALESCE(refund_date, release_date)), não mais por
  -- release_date. Fonte é cash_inflows, igual entradas (nunca cash_outflows).
  estornos_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', COALESCE(ci.refund_date, ci.release_date))::date AS mes,
      COALESCE(ABS(SUM(ci.net_amount)), 0)                                  AS estornos
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.net_amount < 0
      AND COALESCE(ci.refund_date, ci.release_date) >= p.range_ini
      AND COALESCE(ci.refund_date, ci.release_date) <= p.hoje
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
