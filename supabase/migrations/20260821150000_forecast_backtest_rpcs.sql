-- ============================================================
-- Backtest da previsao de caixa — reconstrucao por created_at
-- (Fase 224 — ERR-01)
-- ============================================================
-- Quatro funcoes de MEDICAO. Nenhuma delas e chamada por tela de producao
-- neste plano; get_estorno_deflator passa a ser chamada por get_cashflow
-- no 224-05.
--
-- POR QUE ISTO EXISTE. Nenhuma RPC de caixa guarda o que a previsao dizia
-- ontem — todas recalculam na hora. `cash_inflows.created_at` registra
-- quando cada parcela entrou na base, e o sync roda de 3 em 3 horas, entao
-- da para perguntar retroativamente "o que sabiamos em D-N sobre o dia D".
--
-- A8 FECHADA DOS DOIS LADOS (224-MEDICOES.md Q1 e Q10). Efeito: created_at
-- diverge de synced_at em 99,28% das linhas de cash_inflows (13 colisoes em
-- 1.810), com 46 dias distintos. Mecanismo: nao existe trigger em
-- cash_inflows nem em cash_outflows, e o payload do upsert de
-- sync-mp-releases nao inclui created_at. A reconstrucao esta de pe.
--
-- A REGUA DA RECONSTRUCAO (224-MEDICOES.md Q5): `release_date >= created_at`,
-- e NAO um corte por data de criacao. Houve dois backfills (17/07 com 4.176
-- linhas e 19/06 com 1.201) que respondem por 99,4% das linhas retroativas —
-- nesses dias o sistema soube de tudo de uma vez e a linha nao tem horizonte
-- de previsao real. Cortar por `created_at > 17/07` custaria 28 dias de
-- observacao e 1.366 parcelas (1.586 contra 2.952). Aqui a regua e satisfeita
-- POR CONSTRUCAO: ent_prev exige `created_at::date <= corte` E
-- `release_date > corte`, logo release_date > created_at sempre. Linha de
-- backfill retroativa nao tem como entrar.
--
-- O VAZAMENTO QUE ISTO CORRIGE. sync-mp-releases/index.ts:213 faz
-- `if (status === "refunded") net = -Math.abs(net)`, e o upsert
-- (:252-256) reescreve a linha no lugar. Uma parcela que em 01/08 valia
-- +R$ 500 e foi estornada em 10/08 esta hoje na base com -500. Ler a
-- tabela hoje para reconstruir 03/08 devolveria -500, um valor impossivel
-- de conhecer naquele dia. O CASE sobre refund_date desfaz isso.
--
-- O QUE O CASE NAO CORRIGE, e esta declarado em 224-CURVA.md:
--   · estorno PARCIAL — status continua approved, refund_date fica nulo e
--     net_amount e sobrescrito para menos. Nao ha vestigio. A propria
--     edge function documenta a limitacao na linha 218.
--   · reagendamento de release_date — o MP move money_release_date e nao
--     existe historico. Q5 de 224-MEDICOES.md da a cota superior: ZERO
--     linhas com lead > 45 dias, e toda a contaminacao medida e lead < 0
--     (backfill), nao reagendamento.
-- Os dois enviesam na MESMA direcao: subestimam o vies. O numero medido
-- e piso, nao estimativa central.
--
-- REGUA DO REALIZADO. E a do get_cashflow: SUM(net_amount) por
-- release_date (20260660000000:74-79). NAO e a regua base-cheia da Fase 99
-- (get_dre_cash_forecast, entradas_liberadas_agg). Sao duas reguas
-- diferentes, as duas em producao, para telas diferentes. Esta fase mede o
-- erro do que a tela de caixa mostra.
--
-- METRICA. A RPC devolve n e somas. Quem divide e src/lib/forecastErrorCurve.ts:
--   WAPE(h)  = soma_erro_abs   / soma_realizado
--   FATOR(h) = soma_previsto   / soma_realizado     <- razao de SOMAS
--   ME(h)    = soma_erro_sinal / n
-- Nunca avg(previsto/realizado): num sabado de R$ 50k contra uma segunda
-- de R$ 2.400 a media de razoes e dominada pelos dias pequenos.
--
-- Projeto: ckcdevcxgvueywivefgx (NAO usar gionpsuunfkkzzjdubfy).
-- Aplicar via MCP apply_migration. NUNCA `supabase db push`.
-- ============================================================

-- ------------------------------------------------------------
-- 1/4 — serie diaria de liberacao e estorno (insumo do deflator e da tela)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_estorno_serie_diaria(
  p_org_id uuid,
  p_dias   int DEFAULT 180
)
RETURNS TABLE (
  dia             date,
  valor_liberado  numeric,
  valor_estornado numeric,
  n_parcelas      int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    ci.release_date,
    SUM(abs(ci.net_amount)),
    COALESCE(SUM(abs(ci.net_amount)) FILTER (WHERE ci.refund_date IS NOT NULL), 0),
    COUNT(*)::int
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - p_dias
    AND ci.release_date <  (now() AT TIME ZONE 'America/Sao_Paulo')::date
  GROUP BY ci.release_date
  ORDER BY ci.release_date;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_estorno_serie_diaria(uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_estorno_serie_diaria(uuid, int) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2/4 — deflator de estorno, media exponencial em janela movel
-- ------------------------------------------------------------
-- O erro do curto prazo e estorno: a agenda promete mais do que entra
-- porque as devolucoes chegam depois. Corrigivel por deflator
-- MULTIPLICATIVO (o vies e proporcional ao nivel, nao um valor fixo).
--
-- ⚠️ A D-4 do CONTEXT esta REFUTADA na parte "o cancelamento DOBROU"
-- (224-MEDICOES.md Q4): por VALOR, fev = 11,39% e jul = 12,78%. E
-- oscilacao de faixa (0,25 sigma), nao duplicacao. A media dos seis meses
-- maduros (fev-jul) e 13,06%. Nada aqui trata a taxa como tendencia
-- crescente — o deflator e uma media movel, e e por isso que ele continua
-- valendo mesmo com a D-4 caindo.
--
-- REGUA POR VALOR, nao por contagem (Q4): a taxa por valor supera a de
-- contagem em 7 dos 8 meses — parcelas estornadas valem acima da media.
-- Numerador e denominador aqui sao SOMAS DE VALOR, nunca COUNT.
--
-- FORMA. Peso exponencial (1-alpha)^idade, com alpha = 2/(span+1). O
-- numerador e o denominador sao ponderados SEPARADAMENTE e a razao e
-- tirada no fim — suavizar a razao faria um domingo de denominador quase
-- zero injetar uma razao absurda com peso total. Como a razao e invariante
-- a escala, os pesos nao precisam ser normalizados.
--
-- SPAN DEFAULT = 30 dias, medido (224-MEDICOES.md Q3). A pesquisa pedia 45
-- porque assumiu CV = 1,4; o CV real e 0,642 e o design effect e 1,41, nao 3.
-- Com os numeros reais, EP(30) = 1,17 pp, dentro do teto de 1,5 pp. O 224-05
-- herda este default.
--
-- MATURACAO. Uma parcela liberada ontem ainda pode ser estornada amanha.
-- Contar a coorte recente censura a serie a direita e SUBESTIMA a taxa.
-- p_maturacao_dias exclui o fim da serie. O default 14 e o p90 do lag de
-- estorno medido SO em coortes com >= 120 dias de observacao (Q4, n=370).
-- O p90 de TODAS as coortes daria 10 e subestimaria em 4 dias — a serie
-- mensal de p90 cai monotonicamente (34,16,15,12,5,8,5,2) por censura a
-- direita, nao porque o estorno acelerou.
--
-- p_asof torna a estimativa AS-OF: chamada com uma data de corte, ela so
-- enxerga linhas que ja existiam (created_at <= asof) e estornos que ja
-- eram conhecidos (refund_date <= asof). E isso que torna a validacao do
-- 224-05 out-of-sample de verdade, e nao in-sample disfarcada.
--
-- CLAMP [0,80 ; 1,00]. Acima de 1,00 nao faz sentido fisico (o MP nao
-- paga mais do que agendou) e um piso de 0,80 impede que um dia de dado
-- corrompido derrube a projecao em 40%. Denominador zero devolve NULL —
-- nunca 1,00 por omissao, que seria um valor nao verificado virando
-- numero silencioso.
CREATE OR REPLACE FUNCTION public.get_estorno_deflator(
  p_org_id         uuid,
  p_span_dias      int  DEFAULT 30,
  p_maturacao_dias int  DEFAULT 14,
  p_asof           date DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT
      COALESCE(p_asof, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS asof,
      (2.0 / (GREATEST(p_span_dias, 1) + 1))::numeric                  AS alpha,
      GREATEST(p_span_dias, 1)                                         AS span
  ),
  dia AS (
    SELECT
      ci.release_date AS d,
      SUM(abs(ci.net_amount))                                      AS liberado,
      COALESCE(SUM(abs(ci.net_amount)) FILTER (
        WHERE ci.refund_date IS NOT NULL AND ci.refund_date <= p.asof
      ), 0)                                                        AS estornado
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id  = p_org_id
      AND ci.created_at::date <= p.asof
      AND ci.release_date     <= p.asof - p_maturacao_dias
      AND ci.release_date     >  p.asof - p_maturacao_dias - (4 * p.span)
    GROUP BY ci.release_date
  ),
  pond AS (
    SELECT
      SUM(power(1 - p.alpha, (p.asof - p_maturacao_dias - d.d)) * d.estornado) AS num,
      SUM(power(1 - p.alpha, (p.asof - p_maturacao_dias - d.d)) * d.liberado)  AS den
    FROM dia d CROSS JOIN params p
  )
  SELECT CASE
           WHEN pond.den IS NULL OR pond.den <= 0 THEN NULL::numeric
           ELSE LEAST(1.00::numeric,
                GREATEST(0.80::numeric, 1 - (pond.num / pond.den)))
         END
  FROM pond;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_estorno_deflator(uuid, int, int, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_estorno_deflator(uuid, int, int, date) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3/4 — o backtest par a par (corte x horizonte). E a UNICA implementacao
--       da reconstrucao; a curva agregada e um GROUP BY sobre esta.
-- ------------------------------------------------------------
-- Volume: ~64 cortes x 15 horizontes x 6 variantes = ~5.700 linhas. Acima
-- do teto de 1000 do PostgREST — quem consome do browser LE COM .range()
-- em laco, obrigatoriamente (precedente de dano real:
-- useMLAdsBillingSpend.ts:19, "sem o laco de .range() o gasto de ads sairia
-- SUBESTIMADO sem nenhum sinal").
CREATE OR REPLACE FUNCTION public.get_forecast_backtest_errors(
  p_org_id            uuid,
  p_h_max             int     DEFAULT 15,
  p_corte_min         date    DEFAULT DATE '2026-06-19',
  p_excluir_fantasmas boolean DEFAULT true,
  p_deflator_span     int     DEFAULT NULL,
  p_maturacao_dias    int     DEFAULT 14
)
RETURNS TABLE (
  escopo       text,
  corrigido    boolean,
  agregacao    text,
  corte        date,
  horizon_days int,
  previsto     numeric,
  realizado    numeric,
  erro         numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH params AS MATERIALIZED (
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje,
           -- Piso sobre a data de CORTE, nunca sobre created_at das linhas:
           -- filtrar created_at descartaria a carga inicial de 18/06 e
           -- esvaziaria a agenda dos primeiros cortes por artefato.
           GREATEST(p_corte_min, DATE '2026-06-19')       AS piso
  ),
  cortes AS MATERIALIZED (
    SELECT gs::date AS corte
    FROM params p, generate_series(p.piso, p.hoje - 1, interval '1 day') gs
  ),
  defl AS MATERIALIZED (
    SELECT c.corte,
           CASE WHEN p_deflator_span IS NULL THEN 1.0::numeric
                ELSE COALESCE(
                       public.get_estorno_deflator(p_org_id, p_deflator_span,
                                                   p_maturacao_dias, c.corte),
                       1.0::numeric)
           END AS fator
    FROM cortes c
  ),
  grade AS MATERIALIZED (
    SELECT c.corte, (c.corte + h)::date AS alvo, h::int AS h
    FROM cortes c
    CROSS JOIN generate_series(1, p_h_max) AS h
    CROSS JOIN params p
    WHERE (c.corte + h) < p.hoje
  ),
  fantasmas AS MATERIALIZED (
    -- EXCLUSAO NOMINAL, nunca por regua (224-MEDICOES.md Q7).
    --
    -- O detector generico da Fase 100 (dupla categoria+valor repetida em
    -- >= 2 meses futuros) marca R$ 280.684,26 nos proximos 30 dias. O
    -- fantasma REAL e 6% disso: R$ 16.958,57/mes. O resto e folha, aluguel,
    -- contabilidade, INSS, imposto e previsao de compra LEGITIMOS (o
    -- falso-positivo BEC-04, conhecido e adiado). Usar o detector como
    -- filtro destruiria a projecao.
    --
    -- O fantasma medido: a MESMA dupla de tarifas do ML replicada em 10
    -- meses (10/09/2026 -> 10/06/2027), origem 'tiny', fornecedor
    -- "Mercado livre". E uma fatura unica multiplicada, nao contas a pagar
    -- reais:
    --     ADS Mercado Livre                            R$ 13.725,27
    --     Prestacao de servico do Mercado Envios Full  R$  3.233,30
    --                                                  ------------
    --                                                  R$ 16.958,57 / mes
    --
    -- A classe E de Q7 (71 linhas, R$ 61.765,12 em 30 dias) NAO foi triada
    -- linha a linha e por isso NAO e excluida aqui — pendencia declarada em
    -- 224-CURVA.md, nao exclusao silenciosa.
    SELECT * FROM (VALUES
      ('ADS Mercado Livre',                           13725.27::numeric),
      ('Prestação de serviço do Mercado Envios Full',  3233.30::numeric)
    ) AS f(rotulo, valor)
    WHERE p_excluir_fantasmas
  ),
  ent_prev AS MATERIALIZED (
    -- created_at <= corte E release_date > corte  =>  release_date > created_at.
    -- A regua da reconstrucao de Q5 e satisfeita por construcao: linha de
    -- backfill retroativa (release_date anterior a criacao) nao entra.
    SELECT e.corte, ci.release_date AS alvo,
           SUM(ci.net_amount) AS bruto,
           SUM(CASE
                 WHEN ci.refund_date IS NOT NULL AND ci.refund_date > e.corte
                   THEN abs(ci.net_amount)   -- no corte, o estorno ainda nao existia
                 ELSE ci.net_amount
               END) AS corr
    FROM cortes e
    JOIN public.cash_inflows ci
      ON  ci.organization_id  = p_org_id
      AND ci.created_at::date <= e.corte
      AND ci.release_date     >  e.corte
      AND ci.release_date     <= e.corte + p_h_max
    GROUP BY e.corte, ci.release_date
  ),
  ent_real AS MATERIALIZED (
    SELECT ci.release_date AS alvo, SUM(ci.net_amount) AS realizado
    FROM public.cash_inflows ci CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date < p.hoje
    GROUP BY ci.release_date
  ),
  sai_prev AS MATERIALIZED (
    -- 'Previsões de compra' sai dos DOIS lados (previsto e realizado): e
    -- linha gerada pelo sistema, nunca vira 'paid', e entraria no previsto
    -- com realizado zero inflando o erro das saidas por artefato. E a
    -- classe D de Q7 — legitima como PLANEJAMENTO, mas nao e conta a pagar.
    SELECT e.corte, co.outflow_date AS alvo, SUM(co.amount) AS previsto
    FROM cortes e
    JOIN public.cash_outflows co
      ON  co.organization_id  = p_org_id
      AND co.created_at::date <= e.corte
      AND co.outflow_date     >  e.corte
      AND co.outflow_date     <= e.corte + p_h_max
      AND COALESCE(co.category, '') <> 'Previsões de compra'
      AND NOT EXISTS (
            SELECT 1 FROM fantasmas f
             WHERE co.source = 'tiny'
               AND co.amount = f.valor
               AND COALESCE(co.supplier, '') ILIKE '%mercado livre%'
               AND (COALESCE(co.category, '') ILIKE '%' || f.rotulo || '%'
                 OR co.description               ILIKE '%' || f.rotulo || '%'))
    GROUP BY e.corte, co.outflow_date
  ),
  sai_real AS MATERIALIZED (
    SELECT co.outflow_date AS alvo, SUM(co.amount) AS realizado
    FROM public.cash_outflows co CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'paid'
      AND co.outflow_date < p.hoje
      AND COALESCE(co.category, '') <> 'Previsões de compra'
      AND NOT EXISTS (
            SELECT 1 FROM fantasmas f
             WHERE co.source = 'tiny'
               AND co.amount = f.valor
               AND COALESCE(co.supplier, '') ILIKE '%mercado livre%'
               AND (COALESCE(co.category, '') ILIKE '%' || f.rotulo || '%'
                 OR co.description               ILIKE '%' || f.rotulo || '%'))
    GROUP BY co.outflow_date
  ),
  celula AS MATERIALIZED (
    SELECT g.corte, g.h,
           COALESCE(ep.bruto, 0) * dl.fator AS ent_pb,
           COALESCE(ep.corr,  0) * dl.fator AS ent_pc,
           COALESCE(er.realizado, 0)        AS ent_r,
           COALESCE(sp.previsto,  0)        AS sai_p,
           COALESCE(sr.realizado, 0)        AS sai_r
    FROM grade g
    JOIN defl dl          ON dl.corte = g.corte
    LEFT JOIN ent_prev ep ON ep.corte = g.corte AND ep.alvo = g.alvo
    LEFT JOIN ent_real er ON er.alvo  = g.alvo
    LEFT JOIN sai_prev sp ON sp.corte = g.corte AND sp.alvo = g.alvo
    LEFT JOIN sai_real sr ON sr.alvo  = g.alvo
  ),
  acum AS MATERIALIZED (
    -- Erro acumulado MEDIDO, nunca derivado por raiz de h: erros
    -- multi-step sao positivamente correlacionados e a derivacao
    -- subestima a banda. Soma corrida dentro do corte.
    SELECT corte, h,
           SUM(ent_pb) OVER w AS ent_pb,
           SUM(ent_pc) OVER w AS ent_pc,
           SUM(ent_r)  OVER w AS ent_r,
           SUM(sai_p)  OVER w AS sai_p,
           SUM(sai_r)  OVER w AS sai_r
    FROM celula
    WINDOW w AS (PARTITION BY corte ORDER BY h
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  )
  SELECT 'entradas'::text, false, 'diario'::text, c.corte, c.h,
         c.ent_pb, c.ent_r, (c.ent_pb - c.ent_r) FROM celula c
  UNION ALL
  SELECT 'entradas', true, 'diario', c.corte, c.h,
         c.ent_pc, c.ent_r, (c.ent_pc - c.ent_r) FROM celula c
  UNION ALL
  SELECT 'entradas', false, 'acumulado', a.corte, a.h,
         a.ent_pb, a.ent_r, (a.ent_pb - a.ent_r) FROM acum a
  UNION ALL
  SELECT 'entradas', true, 'acumulado', a.corte, a.h,
         a.ent_pc, a.ent_r, (a.ent_pc - a.ent_r) FROM acum a
  UNION ALL
  SELECT 'saidas', NULL::boolean, 'diario', c.corte, c.h,
         c.sai_p, c.sai_r, (c.sai_p - c.sai_r) FROM celula c
  UNION ALL
  SELECT 'saidas', NULL::boolean, 'acumulado', a.corte, a.h,
         a.sai_p, a.sai_r, (a.sai_p - a.sai_r) FROM acum a;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_forecast_backtest_errors(uuid, int, date, boolean, int, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_forecast_backtest_errors(uuid, int, date, boolean, int, int) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4/4 — a curva agregada. GROUP BY sobre a funcao par a par: uma
--       implementacao so da reconstrucao e da correcao de vazamento.
--       Devolve n e SOMAS. Nenhum indicador derivado — quem divide e
--       src/lib/forecastErrorCurve.ts.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_forecast_backtest_curve(
  p_org_id            uuid,
  p_h_max             int     DEFAULT 15,
  p_corte_min         date    DEFAULT DATE '2026-06-19',
  p_excluir_fantasmas boolean DEFAULT true,
  p_deflator_span     int     DEFAULT NULL,
  p_maturacao_dias    int     DEFAULT 14
)
RETURNS TABLE (
  escopo          text,
  corrigido       boolean,
  agregacao       text,
  horizon_days    int,
  n               int,
  soma_previsto   numeric,
  soma_realizado  numeric,
  soma_erro_abs   numeric,
  soma_erro_sinal numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    e.escopo,
    e.corrigido,
    e.agregacao,
    e.horizon_days,
    COUNT(*)::int,
    SUM(e.previsto),
    SUM(e.realizado),
    SUM(abs(e.erro)),
    SUM(e.erro)
  FROM public.get_forecast_backtest_errors(
         p_org_id, p_h_max, p_corte_min, p_excluir_fantasmas,
         p_deflator_span, p_maturacao_dias) e
  GROUP BY e.escopo, e.corrigido, e.agregacao, e.horizon_days
  ORDER BY e.escopo, e.agregacao, e.corrigido NULLS FIRST, e.horizon_days;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_forecast_backtest_curve(uuid, int, date, boolean, int, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_forecast_backtest_curve(uuid, int, date, boolean, int, int) TO authenticated, service_role;
