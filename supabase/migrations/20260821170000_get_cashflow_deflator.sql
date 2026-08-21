-- ============================================================
-- Fluxo de Caixa — o deflator de estorno entra na faixa onde ele AJUDA
-- (Fase 224, plano 224-05 — ERR-03, criterio 3 do ROADMAP)
-- ============================================================
--
-- O QUE MUDA: os dias de D+1 a D+9 passam a ser multiplicados pelo deflator
-- de estorno em janela movel, devolvido por public.get_estorno_deflator().
-- Nada mais muda: o corte do nono dia (224-02), o piso GREATEST de D+10 em
-- diante, a expressao de saidas, o toggle de previsoes de compra, o calculo
-- de v_sma e o saldo inicial rolado seguem intactos.
--
-- 🔴 DIVERGENCIA DELIBERADA DO PLANO 224-05, POR MEDICAO
-- O plano especificava deflacionar TODOS os dias futuros (`d.d_date >
-- v_today`). A validacao rolling-origin da Task 1 (R-01, em
-- 224-PROVA-DEFLATOR.md) provou que isso PIORA de D+10 em diante, sem
-- excecao:
--
--   h    WAPE sem deflator   WAPE com deflator
--   D+1        0,3258              0,1728   melhora
--   D+9        0,1838              0,1461   melhora
--   D+10       0,3058              0,3792   PIORA
--   D+15       0,9339              0,9434   PIORA
--
-- A causa e simples: de D+10 em diante a agenda do MP ainda nao foi
-- preenchida e ja SUBESTIMA (fator 0,73 em D+10, 0,07 em D+15).
-- Multiplicar por 0,87 um numero que ja falta aumenta a falta. Deflacionar a
-- faixa inteira tornaria a previsao de medio prazo PIOR do que era antes
-- desta fase — o oposto do ERR-03.
--
-- A fronteira D+9/D+10 e a MESMA que o 224-02 estabeleceu, encontrada aqui
-- por uma terceira via independente (a curva de erro por horizonte do
-- 224-03). Os dois defeitos sao distintos e a correcao de cada um tambem:
--   D+1..D+9   agenda existe mas superestima  -> deflator
--   D+10+      agenda ainda nao foi preenchida -> media como piso
--
-- 🔵 O PISO NAO E DEFLACIONADO — medido, nao escolhido por simetria (M-01).
-- Comparando GREATEST(agenda, v_sma) contra GREATEST(agenda, v_sma*fator) em
-- D+10..D+15: o piso BRUTO vence em 5 dos 6 horizontes e no agregado
-- (WAPE 0,3017 x 0,3069), e o fator fica duas vezes mais perto de 1
-- (1,0474 x 0,9037). Deflacionar o piso faria a previsao SUBESTIMAR o caixa
-- em ~10% — num painel que existe para avisar falta de dinheiro, errar para
-- menos produz alarme falso. Excecao declarada: em D+10 isoladamente o
-- deflacionado ganha (0,2775 x 0,3030); nao vale um caso especial para um
-- unico dia.
--
-- SPAN = 30 DIAS. In-sample os quatro spans empatam (WAPE 0,1467 a 0,1486);
-- out-of-sample o 60 e melhor por 0,4 pp — menos que o erro-padrao de 1,17 pp
-- medido no Q3 para a janela de 30, portanto ruido. Escolhido 30 porque e o
-- que o Q3 derivou do CV real (0,642) e porque span menor reage mais rapido a
-- mudanca de regime. ⚠️ Registrado que o 60 foi marginalmente melhor
-- out-of-sample: a escolha NAO foi unanime.
--
-- QUANTO O DEFLATOR RESOLVE, E QUANTO NAO: o WAPE de D+1..D+9 cai de 0,3135
-- para 0,1670 out-of-sample — quase metade do erro. Mas se o estorno fosse a
-- unica causa, com taxa de 12,84% o fator de D+1 seria 1/(1-0,1284) = 1,1474;
-- o medido e 1,3258. Sobram ~15,6% de excesso SEM CAUSA MEDIDA. As duas
-- hipoteses declaradas e NAO testadas sao reagendamento de release_date pelo
-- MP e estorno parcial.
-- ⚠️ Em D+9 o fator deflacionado e 0,9620 — o deflator corrige um pouco
-- DEMAIS no ultimo dia da faixa. O WAPE ainda melhora, entao a aplicacao se
-- justifica, mas nao se pode dizer que "D+9 fica exato": fica 3,8% pessimista.
--
-- SEM DUPLA CONTAGEM NA APLICACAO: o Q11 mediu ZERO parcelas futuras com
-- estorno ja lancado (333 parcelas, R$ 94.202,69, 0,00% em todo horizonte de
-- 1 a 15). A agenda futura e bruta, entao multiplica-la pela taxa historica
-- nao desconta o estorno duas vezes. `p_maturacao_dias` corrige a ESTIMACAO
-- do deflator, nao a aplicacao.
--
-- O DIA DE HOJE NAO E DEFLACIONADO: ele ja e realizado.
--
-- CLAMP 0,80..1,00: protege contra um deflator absurdo vindo de amostra
-- degenerada. 1,00 e o teto porque estorno nunca AUMENTA o que entra.
--
-- COALESCE PARA 1,00: a RPC tem de devolver numero. Quem informa a AUSENCIA
-- de medicao a tela e `get_estorno_deflator`, que devolve NULL — e o hook
-- `useEstornoDeflator.ts` preserva esse nulo de proposito, sem coalescer.
-- Nao "conserte" o nulo la.
--
-- 🔴 ESTE ARQUIVO PARTE DO CORPO VIVO, lido de producao com
-- pg_get_functiondef() e congelado em 224-GET-CASHFLOW-CORPO-VIVO.sql — NAO
-- do .sql do repositorio. Foi clonar do repositorio que regrediu producao em
-- 21/08 (o repo estava atras de 20260713132524; o clone desfez o saldo rolado
-- e a guarda do dia corrente, R$ 30.372,11 no saldo confirmado em D+30).
-- As tres propriedades do corpo vivo estao preservadas aqui:
--   1. public.get_rolled_opening_balance(p_org_id), sem financial_settings
--   2. duas ocorrencias de CASE WHEN d.d_date > v_today (guarda do dia corrente)
--   3. duas ocorrencias de v_today + 9 (corte do 224-02)
--
-- Projeto: ckcdevcxgvueywivefgx (NAO usar gionpsuunfkkzzjdubfy).
-- Aplicar via MCP apply_migration. NUNCA `supabase db push`.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_cashflow(
  p_org_id UUID, p_start_date DATE, p_end_date DATE,
  p_include_purchase_forecasts BOOLEAN DEFAULT false
)
RETURNS TABLE (
  date DATE, daily_income NUMERIC, daily_expense NUMERIC, daily_projection NUMERIC,
  daily_balance NUMERIC, accumulated_balance NUMERIC, accumulated_balance_sma NUMERIC
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_initial  NUMERIC := 0;
  v_today    DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_start    DATE;
  v_sma      NUMERIC := 0;
  v_deflator NUMERIC := 1;
BEGIN
  v_initial := public.get_rolled_opening_balance(p_org_id);
  v_start := GREATEST(p_start_date, v_today);

  -- Janela movel de 30 dias, recalculada a cada chamada. NUNCA constante
  -- gravada: se a taxa de estorno se deslocar, isto se autocorrige sozinho
  -- (criterio 3 do ROADMAP).
  v_deflator := LEAST(1.0, GREATEST(0.80,
                  COALESCE(public.get_estorno_deflator(p_org_id, 30), 1)));

  v_sma := COALESCE((
    SELECT SUM(o.receita_bruta - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0)) / 15.0
    FROM orders o
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND LEFT(o.data_pedido, 10)::date BETWEEN v_today - 15 AND v_today - 1
  ), 0);

  RETURN QUERY
  WITH days AS (
    SELECT gs::date AS d_date FROM generate_series(v_start, p_end_date, INTERVAL '1 day') gs
  ),
  inc AS (
    SELECT ci.release_date AS d_date, SUM(ci.net_amount) AS amt
    FROM cash_inflows ci
    WHERE ci.organization_id = p_org_id AND ci.release_date BETWEEN v_start AND p_end_date
    GROUP BY ci.release_date
  ),
  exp AS (
    SELECT co.outflow_date AS d_date, SUM(co.amount) AS amt
    FROM cash_outflows co
    WHERE co.organization_id = p_org_id
      AND co.outflow_date BETWEEN v_start AND p_end_date
      AND co.status = 'pending'
      AND (p_include_purchase_forecasts OR COALESCE(co.category, '') <> 'Previsões de compra')
    GROUP BY co.outflow_date
  ),
  daily AS (
    SELECT d.d_date,
           -- 🔴 O deflator entra AQUI, e SO na faixa D+1..D+9. Hoje nao leva
           -- (ja e realizado) e D+10 em diante nao leva (a agenda ainda nao
           -- foi preenchida e ja subestima — R-01 provou que deflacionar la
           -- PIORA o WAPE em todos os seis horizontes).
           CASE
             WHEN d.d_date > v_today AND d.d_date <= v_today + 9
               THEN COALESCE(i.amt, 0) * v_deflator
             ELSE COALESCE(i.amt, 0)
           END AS inc,
           COALESCE(e.amt, 0) AS exp
    FROM days d
    LEFT JOIN inc i ON i.d_date = d.d_date
    LEFT JOIN exp e ON e.d_date = d.d_date
  )
  SELECT d.d_date, d.inc, d.exp,
         -- daily_projection: zero enquanto a agenda cobre (ate o nono dia);
         -- do decimo em diante, o quanto a media acrescenta acima do
         -- confirmado. Corte do 224-02, inalterado.
         (CASE WHEN d.d_date <= v_today + 9 THEN 0::NUMERIC
               ELSE GREATEST(0, v_sma - d.inc)::NUMERIC END),
         (d.inc - d.exp),
         -- accumulated_balance: guarda do dia corrente PRESERVADA (o saldo
         -- rolado ja inclui hoje). A linha e a mesma do corpo vivo; o que
         -- mudou foi o valor de d.inc na faixa deflacionada, nao a expressao.
         (v_initial + SUM(
            CASE WHEN d.d_date > v_today THEN (d.inc - d.exp) ELSE 0 END
          ) OVER (ORDER BY d.d_date ASC))::NUMERIC,
         -- accumulated_balance_sma: dias 1 a 9 usam a agenda JA deflacionada;
         -- do decimo em diante a media de 15d vira piso, e o piso e BRUTO
         -- (M-01: bruto vence em 5 de 6 horizontes e no agregado).
         (v_initial + SUM(
            CASE WHEN d.d_date > v_today
                 THEN (CASE WHEN d.d_date <= v_today + 9 THEN d.inc ELSE GREATEST(d.inc, v_sma) END) - d.exp
                 ELSE 0 END
          ) OVER (ORDER BY d.d_date ASC))::NUMERIC
  FROM daily d
  ORDER BY d.d_date ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE,BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE,BOOLEAN) TO authenticated;
