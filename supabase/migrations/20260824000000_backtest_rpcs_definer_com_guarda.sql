-- ============================================================
-- As RPCs de backtest param de estourar o limite de 8s do usuario logado
-- (Fase 230, correcao pos-publicacao — 24/08/2026)
-- ============================================================
-- DEFEITO EM PRODUCAO, medido:
--   como `postgres`      : 0,6s
--   como `authenticated` : 8,6s  -> ESTOURA o statement_timeout de 8s
-- A tela mostrava "Erro ao carregar o historico de erro da previsao" e o
-- ForecastErrorCard nunca renderizava.
--
-- CAUSA: as duas funcoes sao SECURITY INVOKER e leem cash_inflows,
-- cash_outflows e orders. Com RLS ativo, `is_org_member(auth.uid(), org)` e
-- avaliada por LINHA — e o backtest reconstroi 5.220 pares. As policies ja
-- estao no formato bom e `is_org_member` ja e STABLE/DEFINER com custo 100:
-- nao ha o que otimizar nelas. O custo e estrutural, do volume.
--
-- CORRECAO: validar o acesso UMA VEZ e deixar a leitura correr sem RLS.
-- O corpo pesado vira `_raw` em SECURITY DEFINER, sem grant para ninguem
-- alem do dono; e um wrapper com o nome original valida a associacao a
-- organizacao antes de delegar.
--
-- 🔴 POR QUE ISTO NAO E O IDOR QUE A CASA PROIBE: a regra registrada e
-- "DEFINER + parametro de org SEM validacao = IDOR". O wrapper valida
-- `is_org_member(auth.uid(), p_org_id)` e levanta excecao — quem pedir org
-- alheia recebe erro, nao dado. E `_raw` nao tem EXECUTE para `authenticated`
-- nem `anon`, entao nao ha como chamar o corpo sem passar pela guarda.
--
-- Projeto: ckcdevcxgvueywivefgx. Aplicar via API. NUNCA `supabase db push`.
-- ============================================================

ALTER FUNCTION public.get_forecast_backtest_errors(uuid, integer, date, boolean, integer, integer)
  RENAME TO _backtest_errors_raw;
ALTER FUNCTION public._backtest_errors_raw(uuid, integer, date, boolean, integer, integer)
  SECURITY DEFINER;
REVOKE ALL ON FUNCTION public._backtest_errors_raw(uuid, integer, date, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.get_forecast_backtest_curve(uuid, integer, date, boolean, integer, integer)
  RENAME TO _backtest_curve_raw;
ALTER FUNCTION public._backtest_curve_raw(uuid, integer, date, boolean, integer, integer)
  SECURITY DEFINER;
REVOKE ALL ON FUNCTION public._backtest_curve_raw(uuid, integer, date, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_forecast_backtest_errors(
  p_org_id uuid,
  p_h_max integer DEFAULT 15,
  p_corte_min date DEFAULT '2026-06-19'::date,
  p_excluir_fantasmas boolean DEFAULT true,
  p_deflator_span integer DEFAULT NULL::integer,
  p_maturacao_dias integer DEFAULT 14
)
RETURNS TABLE(escopo text, corrigido boolean, agregacao text, corte date,
              horizon_days integer, previsto numeric, realizado numeric, erro numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_org_member(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'acesso negado a organizacao %', p_org_id
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._backtest_errors_raw(
    p_org_id, p_h_max, p_corte_min, p_excluir_fantasmas, p_deflator_span, p_maturacao_dias);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_forecast_backtest_curve(
  p_org_id uuid,
  p_h_max integer DEFAULT 15,
  p_corte_min date DEFAULT '2026-06-19'::date,
  p_excluir_fantasmas boolean DEFAULT true,
  p_deflator_span integer DEFAULT NULL::integer,
  p_maturacao_dias integer DEFAULT 14
)
RETURNS TABLE(escopo text, corrigido boolean, agregacao text, horizon_days integer,
              n integer, soma_previsto numeric, soma_realizado numeric,
              erro_medio numeric, erro_absoluto_medio numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_org_member(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'acesso negado a organizacao %', p_org_id
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._backtest_curve_raw(
    p_org_id, p_h_max, p_corte_min, p_excluir_fantasmas, p_deflator_span, p_maturacao_dias);
END;
$$;

REVOKE ALL ON FUNCTION public.get_forecast_backtest_errors(uuid, integer, date, boolean, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_forecast_backtest_curve(uuid, integer, date, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_forecast_backtest_errors(uuid, integer, date, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_forecast_backtest_curve(uuid, integer, date, boolean, integer, integer) TO authenticated;
