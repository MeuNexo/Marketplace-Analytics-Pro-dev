-- ============================================================================
-- 233-05 — As duas nocoes de "saldo inicial" viram UMA
--
-- 🔴 O DEFEITO, medido no BANCO VIVO em 27/08/2026 (org Pe Vermeio
-- `7f615df7-7bac-45e5-8a93-827fb9ddeec7`), nao clonado do repositorio:
--
--   get_daily_balance(org, hoje).saldo_inicial ... R$ 37.430,00  <- campo CRU
--   get_rolled_opening_balance(org) ............. R$ 29.301,42  <- ROLADO
--   diferenca ................................... R$  8.128,58
--
-- Duas RPCs respondem a MESMA pergunta com numeros diferentes, e as duas
-- aparecem na mesma tela: o card de hoje mostra a soma do cru com os movimentos
-- do dia e o grafico de fluxo de caixa abre no rolado. Sao R$ 13.433,20 de
-- divergencia visiveis de uma olhada.
--
-- `get_cashflow`, `get_projected_balance_summary` e `get_treasury_panel` ja
-- abrem pelo rolado. O unico que nao abre e o `get_daily_balance`. Esta
-- migration alinha o ultimo, e nao mexe em mais nada.
--
-- 🔵 QUEM CONSOME O QUE (medido em `pg_proc.prosrc` em producao, 27/08/2026):
--
--   funcoes do banco que chamam `get_daily_balance` ......... NENHUMA
--   consumidores fora do banco .............................. `useTodayBalance()`
--                                                             (garment) e
--                                                             `get_saldo_diario`
--                                                             (nexo-mcp)
--
-- O raio de alcance e pequeno e esta nomeado. Nenhuma view cita
-- `balance_anchor_date`.
--
-- ⚠️ EFEITO COLATERAL NOMEADO, e ele e BENEFICO: `get_cashflow_data_health`
-- marca `anchor_stale = (anchor_days_ago > 7)`. Com a ancora parada em 13/07 ele
-- vive em alerta permanente; quando a tela passar a mover a ancora a cada
-- declaracao (Task 3 do 233-05) o indicador passa a medir de verdade "ha quantos
-- dias ninguem declara o saldo". Nenhum componente do garment monta esse
-- indicador hoje, entao nao ha tela para regredir.
--
-- 🔴 O QUE ESTA MIGRATION **NAO** FAZ: nao toca em `get_cashflow`, nao toca nos
-- fatores da Fase 224, nao troca INVOKER por DEFINER em funcao nenhuma e nao
-- corrige dado. A correcao do dado de producao e um `select` a parte, aplicado
-- pelo orquestrador DEPOIS de a unificacao ser provada — nesta ordem, porque a
-- prova so vale enquanto as duas nocoes ainda divergem (D-09).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A sobrecarga por data — o corpo vivo, com `p_as_of` no lugar do `v_today`
-- ---------------------------------------------------------------------------
-- Mesmo intervalo semiaberto `[ancora, p_as_of)`, mesmo filtro `status = 'paid'`
-- nas saidas, mesmo `COALESCE`, mesmo `SET search_path`, mesmo INVOKER.
--
-- ⚠️ `p_as_of` ANTES da ancora devolve o saldo da ancora (as somas ficam vazias
-- e o `COALESCE` as zera). E o mesmo comportamento de hoje quando a ancora e
-- futura, e esta escrito aqui para nao ser descoberto por um numero estranho:
-- perguntar o saldo de um dia anterior a ultima declaracao devolve a declaracao,
-- nao uma reconstrucao do passado. Reconstruir passado que ninguem gravou seria
-- medicao fabricada.
CREATE OR REPLACE FUNCTION public.get_rolled_opening_balance(p_org_id uuid, p_as_of date)
RETURNS numeric
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_anchor_date DATE;
  v_anchor_bal  NUMERIC := 0;
  v_inc         NUMERIC := 0;
  v_paid_exp    NUMERIC := 0;
BEGIN
  SELECT fs.balance_anchor_date, fs.initial_balance
    INTO v_anchor_date, v_anchor_bal
  FROM public.financial_settings fs
  WHERE fs.organization_id = p_org_id
  LIMIT 1;

  -- Sem ancora nao ha o que rolar: o campo cru E a resposta. Preserva o
  -- comportamento da versao de um argumento para organizacao que nunca declarou.
  IF v_anchor_date IS NULL THEN
    RETURN COALESCE(v_anchor_bal, 0);
  END IF;

  SELECT COALESCE(SUM(ci.net_amount), 0) INTO v_inc
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date >= v_anchor_date
    AND ci.release_date <  p_as_of;

  SELECT COALESCE(SUM(co.amount), 0) INTO v_paid_exp
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.status = 'paid'
    AND co.outflow_date >= v_anchor_date
    AND co.outflow_date <  p_as_of;

  RETURN v_anchor_bal + v_inc - v_paid_exp;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. A versao de UM argumento passa a DELEGAR — um corpo so, nao dois
-- ---------------------------------------------------------------------------
-- 🔴 Duplicar o corpo aqui seria garantir que o proximo ajuste corrija um lado
-- e esqueca o outro. `CREATE OR REPLACE` sobre a MESMA assinatura preserva a
-- ACL (nao ha `DROP`), mas ela e reemitida no fim assim mesmo, explicitamente.
CREATE OR REPLACE FUNCTION public.get_rolled_opening_balance(p_org_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.get_rolled_opening_balance(
           p_org_id,
           (now() AT TIME ZONE 'America/Sao_Paulo')::date
         );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. `get_daily_balance` passa a abrir pelo ROLADO
-- ---------------------------------------------------------------------------
-- 🔴 A UNICA linha que muda de significado e a do `v_initial`. Entradas e saidas
-- do dia seguem exatamente como estavam (filtro por `= p_target_date`), e
-- `saldo_final_previsto` segue sendo abertura + entradas − saidas.
--
-- Antes: `v_initial := financial_settings.initial_balance` (o campo CRU, que e o
-- saldo da ancora — 13/07/2026 na Pe Vermeio, 45 dias atras).
-- Depois: `v_initial := get_rolled_opening_balance(org, p_target_date)`, que e o
-- mesmo numero pelo qual o grafico de fluxo de caixa abre.
CREATE OR REPLACE FUNCTION public.get_daily_balance(p_org_id uuid, p_target_date date)
RETURNS TABLE(saldo_inicial numeric, entradas_hoje numeric, saidas_hoje numeric, saldo_final_previsto numeric)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_initial  NUMERIC := 0;
  v_entradas NUMERIC := 0;
  v_saidas   NUMERIC := 0;
BEGIN
  -- 🔵 A unificacao. `COALESCE` porque a funcao pode devolver NULL se
  -- `initial_balance` for nulo para uma org sem linha em `financial_settings`.
  v_initial := COALESCE(public.get_rolled_opening_balance(p_org_id, p_target_date), 0);

  SELECT COALESCE(SUM(ci.net_amount),0) INTO v_entradas
  FROM cash_inflows ci
  WHERE ci.organization_id = p_org_id AND ci.release_date = p_target_date;

  SELECT COALESCE(SUM(co.amount),0) INTO v_saidas
  FROM cash_outflows co
  WHERE co.organization_id = p_org_id AND co.outflow_date = p_target_date;

  RETURN QUERY SELECT v_initial, v_entradas, v_saidas, (v_initial + v_entradas - v_saidas);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. ACL — reemitida explicitamente para as tres assinaturas
-- ---------------------------------------------------------------------------
-- Nao houve `DROP FUNCTION` nesta migration, entao a ACL das assinaturas antigas
-- sobrevive (`feedback_drop_function_apaga_acl`). A sobrecarga por data e NOVA e
-- precisa da concessao. As linhas das assinaturas antigas sao idempotentes e
-- ficam aqui para que o menor privilegio seja LEGIVEL em um lugar so, no formato
-- de `20260618210000` e `20260821170000`.
--
-- ⚠️ `anon` fica de fora de proposito: as tres funcoes sao INVOKER sobre tabelas
-- com RLS e nenhuma tela publica as usa. Se alguma passar a precisar, este e o
-- lugar de reverter.
REVOKE ALL ON FUNCTION public.get_rolled_opening_balance(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rolled_opening_balance(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rolled_opening_balance(uuid, date) TO service_role;

REVOKE ALL ON FUNCTION public.get_rolled_opening_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rolled_opening_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rolled_opening_balance(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_daily_balance(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_balance(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_balance(uuid, date) TO service_role;

COMMENT ON FUNCTION public.get_rolled_opening_balance(uuid, date) IS
  '233-05: a abertura ROLADA em uma data qualquer. Saldo da ancora '
  '(`financial_settings.initial_balance` em `balance_anchor_date`) mais tudo que '
  'entrou e menos tudo que saiu PAGO no intervalo semiaberto [ancora, p_as_of). '
  'Com a ancora no proprio `p_as_of` o intervalo e vazio e a funcao devolve o '
  'declarado ao centavo — e e por isso que declarar saldo e MOVER A ANCORA, e nao '
  'inverter conta contra os movimentos do dia.';

COMMENT ON FUNCTION public.get_daily_balance(uuid, date) IS
  '233-05: abre pelo ROLADO, nao mais pelo `initial_balance` cru. Antes desta '
  'migration esta funcao e o `get_cashflow` respondiam a mesma pergunta com '
  'numeros diferentes (37.430,00 x 29.301,42 na Pe Vermeio em 27/08/2026) e os '
  'dois apareciam na mesma tela. `saldo_inicial` agora bate ao centavo com '
  '`get_rolled_opening_balance(org, data)`.';
