-- Phase 100 FIX (decisão do dono 2026-07-17): taxas venda->caixa medem 30 dias
-- (estornos subindo: 14,5%/30d vs 12,4%/90d — 90d suavizava a piora). Lag segue 90d.
-- CREATE OR REPLACE, corpo = 20260717050000 + janela_taxas.

CREATE OR REPLACE FUNCTION public.get_dre_cash_forecast(
  p_org_id uuid,
  p_month  date
)
RETURNS TABLE (
  secao     text,
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
      date_trunc('month', p_month)::date                          AS mes_ini,
      (date_trunc('month', p_month) + interval '1 month')::date   AS mes_fim_excl,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date               AS hoje,
      ((now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '90 days')::date AS janela_ini,
      -- [FIX 2026-07-17, decisão do dono] taxas medem os últimos 30 dias
      -- (reagem à tendência atual de estornos: 14,5% em 30d vs 12,4% em 90d);
      -- o lag de liberação continua na janela de 90d (centroide precisa de série longa).
      ((now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '30 days')::date AS janela_taxas
  ),

  -- ==========================================================================
  -- SAÍDAS PREVISTAS
  -- ==========================================================================

  saidas_pagas_agg AS MATERIALIZED (
    -- Todo pagamento é saída na régua de caixa — sem filtro de bloco
    -- (mesma decisão da Phase 99, incl. bloco excluido e financeiro).
    SELECT
      COALESCE(SUM(co.amount), 0) AS total,
      COUNT(*)::int               AS n
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'paid'
      AND co.outflow_date >= p.mes_ini
      AND co.outflow_date < p.mes_fim_excl
  ),

  estornos_ocorridos_agg AS MATERIALIZED (
    -- Clone literal da régua refunds_agg da get_dre_cash (Phase 99): as
    -- entradas liberadas são base CHEIA; o estorno já ocorrido no mês
    -- precisa pesar como saída para o gap reconciliar com a DRE Caixa
    -- apurada. COALESCE(ci.refund_date, ci.release_date) — nunca só
    -- release_date.
    SELECT
      COALESCE(ABS(SUM(ci.net_amount)), 0) AS total,
      COUNT(*)::int                        AS n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.net_amount < 0
      AND COALESCE(ci.refund_date, ci.release_date) >= p.mes_ini
      AND COALESCE(ci.refund_date, ci.release_date) < p.mes_fim_excl
      AND COALESCE(ci.refund_date, ci.release_date) <= p.hoje
  ),

  saidas_pendentes_agg AS MATERIALIZED (
    -- Guarda anti-fantasma parte (a) / D-06a (BEC-04): teto = mes_fim_excl
    -- (fim do MÊS CORRENTE). Pendente com vencimento em mês futuro NUNCA
    -- entra aqui — evita repetir a recorrência acidental de ads/full
    -- (16.958,57/mês até jun/2027) inflando a previsão. `cancelled` nunca
    -- (filtro status='pending' já exclui). Pendente vencido dentro do mês
    -- (outflow_date < hoje) fica fora por decisão travada (D-02: "entre
    -- hoje e fim do mês"); quando for pago, aparece em saidas_pagas_agg.
    SELECT
      COALESCE(SUM(co.amount), 0) AS total,
      COUNT(*)::int               AS n
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'pending'
      AND co.outflow_date >= p.hoje
      AND co.outflow_date < p.mes_fim_excl
  ),

  -- ==========================================================================
  -- ENTRADAS GARANTIDAS
  -- ==========================================================================

  entradas_liberadas_agg AS MATERIALIZED (
    -- Clone da régua base-cheia do inflows_agg da get_dre_cash — igual
    -- Phase 99.
    SELECT
      COALESCE(SUM(
        CASE WHEN ci.net_amount > 0 THEN ci.net_amount ELSE ABS(ci.net_amount) END
      ), 0)          AS total,
      COUNT(*)::int  AS n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date >= p.mes_ini
      AND ci.release_date < p.mes_fim_excl
      AND ci.release_date <= p.hoje
  ),

  entradas_agendadas_agg AS MATERIALIZED (
    -- "A liberar" até fim do mês — dado REAL do MP (sync traz 45d à
    -- frente).
    SELECT
      COALESCE(SUM(ci.net_amount), 0) AS total,
      COUNT(*)::int                   AS n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date > p.hoje
      AND ci.release_date < p.mes_fim_excl
  ),

  -- ==========================================================================
  -- TAXAS MEDIDAS (D-03 — nunca constante fixa) — janela 90d
  -- ==========================================================================

  taxas_base AS MATERIALIZED (
    -- bruto/líquido (base-cheia) por release_date, janela 90d.
    SELECT
      COALESCE(SUM(ci.gross_amount), 0) AS bruto_90,
      COALESCE(SUM(
        CASE WHEN ci.net_amount > 0 THEN ci.net_amount ELSE ABS(ci.net_amount) END
      ), 0)                              AS liquido_90,
      COUNT(*)::int                      AS n_base
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date >= p.janela_taxas
      AND ci.release_date <= p.hoje
  ),

  taxas_estornos_calc AS MATERIALIZED (
    -- estornos por COALESCE(refund_date, release_date), mesma janela 90d.
    SELECT
      COALESCE(ABS(SUM(ci.net_amount)), 0) AS estornos_90,
      COUNT(*)::int                        AS n_estornos
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.net_amount < 0
      AND COALESCE(ci.refund_date, ci.release_date) >= p.janela_taxas
      AND COALESCE(ci.refund_date, ci.release_date) <= p.hoje
  ),

  taxas_venda_calc AS MATERIALIZED (
    -- Divisões sempre com NULLIF (nunca divisão sem guarda). NULL quando a
    -- janela não tem dado suficiente — a lib pura do plano 100-02 trata.
    SELECT
      tb.n_base,
      te.n_estornos,
      (tb.liquido_90 / NULLIF(tb.bruto_90, 0))    AS taxa_liquido_bruto,
      (te.estornos_90 / NULLIF(tb.liquido_90, 0)) AS taxa_estornos
    FROM taxas_base tb
    CROSS JOIN taxas_estornos_calc te
  ),
  taxas_janela AS MATERIALIZED (
    -- D-03: taxa_venda_para_caixa = taxa_liquido_bruto x (1 - taxa_estornos).
    SELECT
      n_base,
      n_estornos,
      taxa_liquido_bruto,
      taxa_estornos,
      CASE WHEN taxa_liquido_bruto IS NOT NULL
        THEN taxa_liquido_bruto * (1 - COALESCE(taxa_estornos, 0))
        ELSE NULL
      END AS taxa_venda_para_caixa
    FROM taxas_venda_calc
  ),

  -- ==========================================================================
  -- LAG DE LIBERAÇÃO (D-03 — método documentado, sem vínculo direto
  -- venda↔liberação em cash_inflows)
  -- ==========================================================================

  lag_liberacoes_calc AS MATERIALIZED (
    -- Centroide ponderado por valor das liberações: release_date pesado
    -- por gross_amount, janela 90d. Data convertida em nº de dias desde
    -- 2000-01-01 para permitir a média ponderada; a diferença entre os
    -- dois centroides abaixo já sai direto em dias.
    SELECT
      SUM((ci.release_date - DATE '2000-01-01') * ci.gross_amount) AS soma_pond,
      SUM(ci.gross_amount)                                          AS soma_peso,
      COUNT(*)::int                                                  AS n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date >= p.janela_ini
      AND ci.release_date <= p.hoje
      AND ci.gross_amount IS NOT NULL
      AND ci.gross_amount > 0
  ),
  lag_vendas_calc AS MATERIALIZED (
    -- Centroide ponderado das vendas: data_pedido pesado pela receita,
    -- mesma janela 90d, mesmo status/COALESCE das RPCs da Phase 99.
    SELECT
      SUM(
        (o.data_pedido::date - DATE '2000-01-01')
        * COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)
      )                                                                       AS soma_pond,
      SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0))          AS soma_peso
    FROM public.orders o
    CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND o.data_pedido::date >= p.janela_ini
      AND o.data_pedido::date <= p.hoje
      AND COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0) > 0
  ),
  lag_calc AS MATERIALIZED (
    -- Método = diferença de centroides ponderados (aproximação na
    -- ausência de vínculo venda↔liberação em cash_inflows). Viés de borda
    -- (vendas recentes ainda sem liberação, liberações de vendas fora da
    -- janela) aceito e mitigado pelo clamp [7,30] — nunca reporta um lag
    -- implausível. Fallback = 14 (mediana histórica observada na Phase 99)
    -- quando qualquer lado da janela está vazio.
    SELECT
      CASE
        WHEN lb.soma_peso IS NULL OR lb.soma_peso = 0
          OR lv.soma_peso IS NULL OR lv.soma_peso = 0
          THEN 14
        ELSE LEAST(GREATEST(
          ROUND((lb.soma_pond / lb.soma_peso) - (lv.soma_pond / lv.soma_peso))::int,
          7
        ), 30)
      END           AS lag_dias,
      COALESCE(lb.n, 0) AS n_base
    FROM lag_liberacoes_calc lb
    CROSS JOIN lag_vendas_calc lv
  ),

  -- ==========================================================================
  -- RITMO REAL (D-05 — dado bruto; semáforo/comparação fica na lib pura)
  -- ==========================================================================

  vendas_7d_agg AS MATERIALIZED (
    SELECT
      COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0) / 7.0 AS media_diaria,
      COUNT(*)::int                                                                      AS n
    FROM public.orders o
    CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      -- [FIX 2026-07-17, achado do dono] janela = últimos 7 dias COMPLETOS
      -- (ontem para trás). Incluir o dia corrente parcial deflacionava o
      -- ritmo logo após a virada do dia (hoje quase zerado puxava a média).
      AND o.data_pedido::date >= p.hoje - 7
      AND o.data_pedido::date <= p.hoje - 1
  ),

  -- ==========================================================================
  -- IMPOSTO PREVISTO RESTANTE — clone LITERAL das CTEs de imposto_previsto
  -- da get_dre_cash (reuso de public.dre_bloco_for_category, nunca
  -- redefinido; nunca hardcoded).
  -- ==========================================================================

  imposto_guia_mes AS MATERIALIZED (
    SELECT
      COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0) AS total,
      COUNT(*) FILTER (WHERE co.status = 'paid')::int                AS n
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND public.dre_bloco_for_category(co.category) = 'impostos_venda'
      AND co.outflow_date >= p.mes_ini
      AND co.outflow_date < p.mes_fim_excl
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
      AND o.data_pedido::date < p.mes_fim_excl
  ),
  meses_anteriores AS MATERIALIZED (
    SELECT
      k,
      (date_trunc('month', p_month) - (k || ' months')::interval)::date       AS mes_k_ini,
      (date_trunc('month', p_month) - ((k - 1) || ' months')::interval)::date AS mes_k_fim_excl
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
     AND co.outflow_date < m.mes_k_fim_excl
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
     AND o.data_pedido::date < m.mes_k_fim_excl
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
      AVG(taxa)        AS taxa_media,
      COUNT(taxa)::int  AS n_validas
    FROM taxas
  ),

  -- ==========================================================================
  -- GUARDA ANTI-FANTASMA parte (b) / D-06b (BEC-04) — recorrência suspeita
  -- ==========================================================================

  pendentes_mes_agg AS MATERIALIZED (
    -- CTE A: pares (categoria, valor) distintos dos pendentes do mês
    -- corrente — mesmo filtro de saidas_pendentes_agg.
    SELECT DISTINCT co.category, co.amount
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'pending'
      AND co.outflow_date >= p.hoje
      AND co.outflow_date < p.mes_fim_excl
  ),
  pendentes_futuros_agg AS MATERIALIZED (
    -- CTE B: pendentes de meses FUTUROS (outflow_date >= mes_fim_excl),
    -- agrupados por (categoria, valor) — recorrência = mesma dupla
    -- aparecendo em >= 2 meses futuros distintos (set-based, sem
    -- subquery correlacionada).
    SELECT
      co.category,
      co.amount,
      COUNT(DISTINCT date_trunc('month', co.outflow_date))::int AS n_meses_futuros
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'pending'
      AND co.outflow_date >= p.mes_fim_excl
    GROUP BY co.category, co.amount
    HAVING COUNT(DISTINCT date_trunc('month', co.outflow_date)) >= 2
  ),
  recorrencia_suspeita AS MATERIALIZED (
    -- Dupla (categoria, valor) do pendente do mês corrente que TAMBÉM
    -- aparece em >=2 meses futuros — padrão de recorrência suspeita (ex.:
    -- ads/full 16.958,57/mês até jun/2027, lição 2026-07-17).
    SELECT
      a.category,
      a.amount,
      f.n_meses_futuros
    FROM pendentes_mes_agg a
    JOIN pendentes_futuros_agg f
      ON f.category = a.category
     AND f.amount = a.amount
  )

  -- ==========================================================================
  -- SELECT final — contrato de 12 categorias canônicas + 0..N linhas
  -- alerta_recorrencia (nomes de secao/categoria EXATOS — consumidos pelo
  -- plano 100-02).
  -- ==========================================================================

  SELECT 'saida_prevista'::text, 'saidas_pagas'::text, spa.total, spa.n
    FROM saidas_pagas_agg spa
  UNION ALL
  SELECT 'saida_prevista'::text, 'estornos_ocorridos'::text, eo.total, eo.n
    FROM estornos_ocorridos_agg eo
  UNION ALL
  SELECT 'saida_prevista'::text, 'saidas_pendentes'::text, sp.total, sp.n
    FROM saidas_pendentes_agg sp
  UNION ALL
  -- estornos_previstos: só sobre as agendadas (estornos de vendas novas já
  -- estão dentro da taxa_venda_para_caixa).
  SELECT 'saida_prevista'::text, 'estornos_previstos'::text,
         COALESCE(tj.taxa_estornos, 0) * ea.total, ea.n
    FROM taxas_janela tj CROSS JOIN entradas_agendadas_agg ea
  UNION ALL
  SELECT 'saida_prevista'::text, 'imposto_previsto_restante'::text,
         CASE WHEN igm.total > 0 THEN 0 ELSE COALESCE(pc.taxa_media * fm.total, 0) END,
         pc.n_validas
    FROM imposto_guia_mes igm CROSS JOIN faturamento_mes fm CROSS JOIN previsao_calc pc
  UNION ALL
  SELECT 'entrada'::text, 'entradas_liberadas'::text, el.total, el.n
    FROM entradas_liberadas_agg el
  UNION ALL
  SELECT 'entrada'::text, 'entradas_agendadas'::text, ea.total, ea.n
    FROM entradas_agendadas_agg ea
  UNION ALL
  SELECT 'taxa'::text, 'taxa_liquido_bruto'::text, tj.taxa_liquido_bruto, tj.n_base
    FROM taxas_janela tj
  UNION ALL
  SELECT 'taxa'::text, 'taxa_estornos'::text, tj.taxa_estornos, tj.n_estornos
    FROM taxas_janela tj
  UNION ALL
  SELECT 'taxa'::text, 'taxa_venda_para_caixa'::text, tj.taxa_venda_para_caixa, NULL::integer
    FROM taxas_janela tj
  UNION ALL
  SELECT 'taxa'::text, 'lag_liberacao_dias'::text, lc.lag_dias::numeric, lc.n_base
    FROM lag_calc lc
  UNION ALL
  SELECT 'ritmo'::text, 'vendas_7d_media_diaria'::text, v7.media_diaria, v7.n
    FROM vendas_7d_agg v7
  UNION ALL
  SELECT 'alerta_recorrencia'::text, rs.category, rs.amount, rs.n_meses_futuros
    FROM recorrencia_suspeita rs
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_cash_forecast(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_cash_forecast(uuid, date) TO authenticated;
