-- ============================================================
-- Fluxo de Caixa — a media para de entrar onde a agenda ainda cobre
-- (Fase 224, criterio 6 do ROADMAP — ERR-03)
-- ============================================================
-- DEFEITO ATIVO CORRIGIDO AQUI, nao risco futuro.
--
-- A Phase 59 (20260659000000) cortou a projecao no setimo dia. A Phase 60
-- (20260660000000, CASHFIX-05) fez o oitavo dia em diante usar
-- GREATEST(d.inc, v_sma): a media virou PISO. A justificativa era a cauda
-- longa, onde o MP ainda nao agendou nada e o confirmado e trocado.
--
-- A medicao da Fase 224 (224-CONTEXT.md, D-3) mostra que a cauda comeca
-- depois do que a regra supoe. Quanto de cada dia ja era conhecido com
-- antecedencia, medido sobre os ultimos 45 dias:
--
--   D+1 a D+8 ....... 107% a 112%
--   D+9 ............. 103,7%
--   D+10 ............  66,7%   <- aqui a cobertura despenca
--   D+11 ...........   40,1%
--   D+12 ...........   23,5%
--
-- ⚠️ Esses numeros vem de uma reconstrucao com look-ahead bias documentado
-- (224-CONTEXT.md, correcao da D-4): o upsert de sync-mp-releases reescreve
-- a linha no lugar e importa estornos para o passado, o que SUPRIME parte
-- da promessa que a agenda fazia. A direcao do vies e conhecida: a
-- cobertura real era MAIOR que 107-112%, nao menor. Ou seja, o corte no
-- nono dia e CONSERVADOR — o vies trabalha a favor desta mudanca, nao
-- contra. O numero limpo sai no 224-03; a conclusao nao depende dele.
--
-- Ou seja: nos dias 8 e 9 o modelo injetava estimativa onde havia dado
-- deterministico. Isso viola a D-1 do 224-CONTEXT ("media nunca entra na
-- posicao diaria") e viola na direcao cara: GREATEST e piso, piso so
-- aumenta o saldo projetado, e para decidir "pago hoje ou prorrogo?" errar
-- para cima e o erro que quebra o caixa.
--
-- O QUE MUDA: as duas constantes de corte, de sete para nove dias.
--   · daily_projection: continua zero dentro da janela de agenda, agora
--     ate o nono dia.
--   · accumulated_balance_sma: continua confirmado-only dentro da janela
--     de agenda, agora ate o nono dia.
--
-- O QUE NAO MUDA, de proposito:
--   · a assinatura — por isso CREATE OR REPLACE e nunca DROP (DROP apaga a
--     ACL, regra da casa desde a Fase 220).
--   · a expressao de accumulated_balance (linha confirmada).
--   · o filtro co.status = 'pending' (CASHFIX-04).
--   · o toggle p_include_purchase_forecasts (CASHFIX-06).
--   · o calculo de v_sma sobre orders (15 dias).
--   · o GREATEST a partir do decimo dia. Piso enviesa para cima, e a
--     pesquisa recomenda revisar — mas a alternativa (completar o buraco
--     na proporcao da cobertura medida do horizonte) depende da curva que
--     o 224-03 ainda vai produzir. Trocar piso por complemento sem essa
--     curva seria trocar um palpite por outro. Fica medido, nao adivinhado.
--
-- REVOKE/GRANT sao reemitidos porque CREATE OR REPLACE nao garante
-- preservar REVOKEs anteriores (precedente registrado em
-- 20260686000000_cash_outflows_competence_date.sql:20-21).
--
-- Projeto: ckcdevcxgvueywivefgx (NAO usar gionpsuunfkkzzjdubfy).
-- Aplicar via MCP apply_migration. NUNCA `supabase db push`.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_cashflow(
  p_org_id UUID, p_start_date DATE, p_end_date DATE,
  p_include_purchase_forecasts BOOLEAN DEFAULT false
)
RETURNS TABLE (
  date DATE,
  daily_income NUMERIC,
  daily_expense NUMERIC,
  daily_projection NUMERIC,
  daily_balance NUMERIC,
  accumulated_balance NUMERIC,
  accumulated_balance_sma NUMERIC
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_initial NUMERIC := 0;
  v_today   DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_start   DATE;
  v_sma     NUMERIC := 0;
BEGIN
  v_initial := COALESCE((SELECT fs.initial_balance FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1), 0);
  v_start := GREATEST(p_start_date, v_today);

  v_sma := COALESCE((
    SELECT SUM(o.receita_bruta - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0)) / 15.0
    FROM orders o
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND LEFT(o.data_pedido, 10)::date BETWEEN v_today - 15 AND v_today - 1
  ), 0);

  RETURN QUERY
  WITH days AS (
    SELECT gs::date AS d_date
    FROM generate_series(v_start, p_end_date, INTERVAL '1 day') gs
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
      AND co.status = 'pending'   -- CASHFIX-04: so contas a pagar EM ABERTO
      AND (p_include_purchase_forecasts OR COALESCE(co.category, '') <> 'Previsões de compra')
    GROUP BY co.outflow_date
  ),
  daily AS (
    SELECT d.d_date,
           COALESCE(i.amt, 0) AS inc,
           COALESCE(e.amt, 0) AS exp
    FROM days d
    LEFT JOIN inc i ON i.d_date = d.d_date
    LEFT JOIN exp e ON e.d_date = d.d_date
  )
  SELECT d.d_date,
         d.inc,
         d.exp,
         -- daily_projection: zero enquanto a agenda do MP cobre o dia (ate o
         -- nono); do decimo em diante, o quanto a media acrescenta acima do
         -- confirmado. Fase 224, criterio 6.
         (CASE
            WHEN d.d_date <= v_today + 9 THEN 0::NUMERIC
            ELSE GREATEST(0, v_sma - d.inc)::NUMERIC
          END),
         (d.inc - d.exp),
         -- accumulated_balance: linha confirmada. EXPRESSAO INALTERADA.
         (v_initial + SUM(d.inc - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC,
         -- accumulated_balance_sma:
         --   dias 1 a 9  : confirmado-only (d.inc) — a agenda cobre 103% a 112%
         --   dia 10+     : GREATEST(d.inc, v_sma) — a media de 15d vira piso
         (v_initial + SUM(
           (CASE
              WHEN d.d_date <= v_today + 9 THEN d.inc
              ELSE GREATEST(d.inc, v_sma)
            END) - d.exp
         ) OVER (ORDER BY d.d_date ASC))::NUMERIC
  FROM daily d
  ORDER BY d.d_date ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE,BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE,BOOLEAN) TO authenticated;
