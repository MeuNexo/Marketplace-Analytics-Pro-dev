-- ============================================================================
-- 233-06 — O saldo declarado e o de AGORA. A classificacao por LIQUIDACAO vira
--          coluna do banco, e a saida cancelada sai da previsao de fechamento.
--
-- 🔴 D-10 (Wesley, 27/08/2026): *"hoje o saldo ja considerando a liberacao ja e
-- o que passei, 37430"*. Ele declara olhando o EXTRATO — o numero que ele digita
-- ja inclui tudo que ja entrou hoje. O D-07 (o declarado e a ABERTURA) CAIU.
--
-- 🔴 O ESTRAGO DO D-07, medido: gravado como abertura, o sistema somava o dia
-- por cima e contava R$ 13.157,27 DUAS VEZES — fechamento previsto saiu
-- R$ 42.457,04 contra os R$ 38.785,31 corretos.
--
-- As tres identidades que esta migration precisa preservar:
--
--   abertura    = declarado − entradas_liquidadas + saidas_pagas
--   saldo_agora = abertura  + entradas_liquidadas − saidas_pagas
--   fechamento  = abertura  + entradas_do_dia     − saidas_do_dia
--
-- Aplicadas a mao em producao em 27/08 (org Pe Vermeio
-- `7f615df7-7bac-45e5-8a93-827fb9ddeec7`): 37.430 − 13.157,27 + 9.485,54 =
-- **33.758,27**, e a recomposicao devolve os R$ 37.430,00 ao centavo. O que
-- sobra — R$ 1.355,31 — e exatamente o `in_mediation`, o que ainda pode entrar
-- hoje. Fecha dos dois lados.
--
-- ⚠️ NENHUM literal acima pode virar criterio de aceite. Entre planejar e
-- executar o 233-05, `entradas_hoje` caiu de 14.790,16 para 14.512,58 porque o
-- MP remanejou release no meio do dia (M-07). **A prova e contra a INVARIANTE,
-- nunca contra o numero.**
--
-- 🔴 O QUE ESTA MIGRATION **NAO** FAZ: nao toca em `get_cashflow`, nao toca em
-- `get_confianca_do_saldo` (a escolha do comparador da curva e decisao do
-- Wesley, no human-check), nao troca INVOKER por DEFINER em funcao nenhuma e
-- nao mexe em `get_rolled_opening_balance` (a unificacao do 233-05 fica de pe).
--
-- 🔵 Corpo vivo: `get_daily_balance` foi lido do BANCO no 233-05 antes de ser
-- reescrito, e a migration `20260827190000` que o reescreveu FOI APLICADA e
-- PROVADA em producao (M-07: `unificou = true`). O corpo abaixo parte dela.
-- ⚠️ O orquestrador confere com `pg_get_functiondef` ANTES de aplicar —
-- `feedback_corpo_vivo_de_rpc_vem_do_banco` custou R$ 30.372,11 na 224.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A allowlist, num lugar so
-- ---------------------------------------------------------------------------
-- 🔴 A REGRA E ALLOWLIST, NAO DENYLIST, e os dois defaults sao OPOSTOS DE
-- PROPOSITO — os dois conservadores para o caixa:
--
--   entrada de estado desconhecido -> NAO conta como dinheiro em maos
--   saida   de estado desconhecido -> CONTA como saida prevista
--
-- Ambos erram para o lado de ter MENOS dinheiro do que o sistema pensa. Uma
-- denylist faria um estado novo do Mercado Pago virar dinheiro em caixa sem
-- ninguem decidir isso.
--
-- 🔴 `entradas_pendentes` sai por SUBTRACAO, nao por lista. Listar os estados
-- pendentes um a um faria um estado novo DESAPARECER da conta. Por subtracao
-- ele aparece, e ainda sai nomeado em `entradas_estado_desconhecido`.
--
-- Estados medidos nos ultimos 60 dias (org Pe Vermeio, 27/08/2026):
--   cash_inflows.status_mp : approved (2.566 · 609.213,00) LIQUIDOU
--                            refunded (319 · −85.324,26)   LIQUIDOU (estorno ja saiu)
--                            in_mediation (26 · 7.569,22)  NAO
--   cash_outflows.status   : paid (122 · 477.943,70)       LIQUIDOU
--                            pending (683 · 2.879.033,53)  NAO — mas ainda e saida prevista
--                            cancelled (4 · 8.030,12)      NAO, E NUNCA VAI (D-12)
CREATE OR REPLACE FUNCTION public.get_movimentos_por_liquidacao(p_org_id uuid, p_dia date)
RETURNS TABLE(
  entradas_liquidadas          numeric,
  entradas_pendentes           numeric,
  entradas_estado_desconhecido numeric,
  saidas_pagas                 numeric,
  saidas_previstas             numeric,
  saidas_canceladas            numeric,
  saidas_estado_desconhecido   numeric
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_ent_total   NUMERIC := 0;
  v_ent_liq     NUMERIC := 0;
  v_ent_desc    NUMERIC := 0;
  v_sai_paid    NUMERIC := 0;
  v_sai_pend    NUMERIC := 0;
  v_sai_canc    NUMERIC := 0;
  v_sai_desc    NUMERIC := 0;
BEGIN
  -- Entradas. `organization_id` explicito (T-224-07-01: o numero de uma loja na
  -- tela da outra ja aconteceu nesta base — M-02 desta fase).
  SELECT
    COALESCE(SUM(ci.net_amount), 0),
    COALESCE(SUM(ci.net_amount) FILTER (
      WHERE ci.status_mp IN ('approved', 'refunded')
    ), 0),
    COALESCE(SUM(ci.net_amount) FILTER (
      WHERE COALESCE(ci.status_mp, '(nulo)')
            NOT IN ('approved', 'refunded', 'in_mediation')
    ), 0)
  INTO v_ent_total, v_ent_liq, v_ent_desc
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date = p_dia;

  -- Saidas. `pending` e `cancelled` sao os dois estados nao-liquidados
  -- conhecidos, e eles se comportam DIFERENTE na previsao: `pending` ainda vai
  -- sair, `cancelled` nunca mais.
  SELECT
    COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0),
    COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'pending'), 0),
    COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'cancelled'), 0),
    COALESCE(SUM(co.amount) FILTER (
      WHERE COALESCE(co.status, '(nulo)') NOT IN ('paid', 'pending', 'cancelled')
    ), 0)
  INTO v_sai_paid, v_sai_pend, v_sai_canc, v_sai_desc
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date = p_dia;

  RETURN QUERY SELECT
    v_ent_liq,
    (v_ent_total - v_ent_liq),   -- 🔴 por SUBTRACAO: estado novo aparece aqui
    v_ent_desc,
    v_sai_paid,
    v_sai_pend,
    v_sai_canc,
    v_sai_desc;
END;
$function$;

COMMENT ON FUNCTION public.get_movimentos_por_liquidacao(uuid, date) IS
  '233-06: a classificacao por LIQUIDACAO num lugar so. Allowlist explicita — '
  'entradas liquidadas sao `approved` + `refunded`; saidas liquidadas sao '
  '`paid`. `entradas_pendentes` sai por SUBTRACAO de proposito: listar os '
  'estados pendentes um a um faria um estado novo do Mercado Pago DESAPARECER '
  'da conta em vez de aparecer. O que nao bate nenhum estado conhecido sai em '
  'coluna propria (`*_estado_desconhecido`) para APARECER em vez de sumir '
  'dentro de um agregado. Os dois defaults sao opostos de proposito e os dois '
  'sao conservadores para o caixa: entrada desconhecida nao conta como dinheiro '
  'em maos, saida desconhecida conta como saida prevista.';

-- ---------------------------------------------------------------------------
-- 2. `get_daily_balance` ganha o saldo de AGORA
-- ---------------------------------------------------------------------------
-- 🔴 A assinatura de RETORNO muda, entao `CREATE OR REPLACE` nao serve: e
-- `DROP FUNCTION` + `CREATE`. **O `DROP` APAGA A ACL**
-- (`feedback_drop_function_apaga_acl`) — ela e reemitida na secao 3, e o
-- orquestrador confere `pg_proc.proacl` DEPOIS de aplicar.
--
-- As colunas atuais ficam nas MESMAS POSICOES e as novas entram no fim. Os dois
-- consumidores (`useTodayBalance()` no garment e a tool `get_saldo_diario` do
-- nexo-mcp — medido em `pg_proc.prosrc`: nenhuma funcao do banco chama esta)
-- leem por NOME, entao coluna nova nao quebra nada.
--
-- 🔴 O QUE MUDA DE VALOR e `saidas_hoje`: ela passa a EXCLUIR `cancelled`
-- (D-12, confirmado pelo Wesley em 27/08). Saida cancelada nao e "ainda vai
-- sair", e "nao vai sair nunca" — soma-la e prever uma saida que nao existe. O
-- valor excluido aparece em `saidas_canceladas` para nao sumir sem rastro.
--
-- ⚠️ IMPACTO MEDIDO: 4 linhas, R$ 8.030,12, TODAS NO PASSADO. Nao ha saida
-- cancelada hoje nem no futuro. O defeito era LATENTE, nao ativo — registrado
-- assim para nao virar urgencia que nao e.
DROP FUNCTION IF EXISTS public.get_daily_balance(uuid, date);

CREATE FUNCTION public.get_daily_balance(p_org_id uuid, p_target_date date)
RETURNS TABLE(
  saldo_inicial                numeric,
  entradas_hoje                numeric,
  saidas_hoje                  numeric,
  saldo_final_previsto         numeric,
  entradas_liquidadas          numeric,
  saidas_pagas                 numeric,
  entradas_pendentes           numeric,
  saidas_canceladas            numeric,
  saldo_agora                  numeric,
  entradas_estado_desconhecido numeric,
  saidas_estado_desconhecido   numeric
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_initial   NUMERIC := 0;
  v_entradas  NUMERIC := 0;
  v_saidas    NUMERIC := 0;
  v_mov       RECORD;
BEGIN
  -- 🔵 A unificacao do 233-05 NAO E TOCADA: a abertura continua sendo o ROLADO.
  -- `COALESCE` porque a funcao devolve NULL para org sem linha em
  -- `financial_settings`, e sem ele o numero sumiria da tela sem erro nenhum —
  -- o estado mudo que esta fase inteira combate.
  v_initial := COALESCE(public.get_rolled_opening_balance(p_org_id, p_target_date), 0);

  -- A classificacao por liquidacao vem de UM lugar so. Duas implementacoes da
  -- mesma regra divergem, e a divergencia aparece como numero errado na tela,
  -- nao como erro.
  SELECT * INTO v_mov
  FROM public.get_movimentos_por_liquidacao(p_org_id, p_target_date);

  -- `entradas_hoje` continua sendo o TOTAL do dia: o pendente (`in_mediation`)
  -- ainda pode entrar hoje, entao ele pertence a previsao de fechamento.
  SELECT COALESCE(SUM(ci.net_amount), 0) INTO v_entradas
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date = p_target_date;

  -- 🔴 `saidas_hoje` EXCLUI `cancelled` (D-12). `status` nulo ou desconhecido
  -- CONTINUA entrando: saida desconhecida conta como saida prevista, que e o
  -- default conservador para o caixa.
  SELECT COALESCE(SUM(co.amount), 0) INTO v_saidas
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date = p_target_date
    AND COALESCE(co.status, '(nulo)') <> 'cancelled';

  RETURN QUERY SELECT
    v_initial,
    v_entradas,
    v_saidas,
    (v_initial + v_entradas - v_saidas),                      -- fechamento previsto
    v_mov.entradas_liquidadas,
    v_mov.saidas_pagas,
    v_mov.entradas_pendentes,
    v_mov.saidas_canceladas,
    (v_initial + v_mov.entradas_liquidadas - v_mov.saidas_pagas),  -- 🔵 saldo de AGORA
    v_mov.entradas_estado_desconhecido,
    v_mov.saidas_estado_desconhecido;
END;
$function$;

COMMENT ON FUNCTION public.get_daily_balance(uuid, date) IS
  '233-06: devolve TRES numeros diferentes de proposito. `saldo_inicial` e a '
  'ABERTURA rolada (233-05, o mesmo numero pelo qual o grafico de fluxo de '
  'caixa abre). `saldo_agora` e a abertura mais o que JA LIQUIDOU hoje — e o '
  'numero que o Wesley ve no extrato e o que ele declara (D-10). '
  '`saldo_final_previsto` e o FECHAMENTO previsto do dia, que soma tambem o que '
  'ainda pode entrar. 🔴 `saidas_hoje` EXCLUI `cancelled` desde 233-06 (D-12): '
  'cancelada nao e "adiada", e "nao vai sair nunca"; o valor excluido sai em '
  '`saidas_canceladas`.';

-- ---------------------------------------------------------------------------
-- 3. ACL — reemitida DEPOIS do `DROP`, que a apagou
-- ---------------------------------------------------------------------------
-- ⚠️ `anon` fica de fora DE PROPOSITO, no mesmo criterio do 233-04 e do 233-05:
-- as funcoes sao INVOKER sobre tabelas com RLS e nenhuma tela publica as usa.
-- Se alguma passar a precisar, este e o lugar de reverter.
REVOKE ALL ON FUNCTION public.get_movimentos_por_liquidacao(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_movimentos_por_liquidacao(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_movimentos_por_liquidacao(uuid, date) TO service_role;

REVOKE ALL ON FUNCTION public.get_daily_balance(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_balance(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_balance(uuid, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. `saldo_declarado` guarda o RETRATO COMPLETO
-- ---------------------------------------------------------------------------
-- 🔵 Estas quatro colunas sao o que permite escolher DEPOIS o comparador da
-- curva de confianca sem perder dado. Hoje `get_confianca_do_saldo` confronta
-- `saldo_real` (que, a partir do D-10, e o saldo de MEIO DE DIA) contra o
-- congelado, que e FECHAMENTO. Em 27/08 a diferenca entre os dois comparadores
-- foi R$ 1.355,31 no D+0. Com as parcelas gravadas, trocar o comparador vira uma
-- DECISAO, nao uma escavacao.
--
-- ⚠️ Nulas para as linhas antigas de proposito: elas foram feitas sob a regra
-- anterior e inventar valor para elas seria medicao fabricada.
ALTER TABLE public.saldo_declarado
  ADD COLUMN IF NOT EXISTS abertura_ancorada   numeric(14,2),
  ADD COLUMN IF NOT EXISTS entradas_liquidadas numeric(14,2),
  ADD COLUMN IF NOT EXISTS saidas_pagas        numeric(14,2),
  ADD COLUMN IF NOT EXISTS entradas_pendentes  numeric(14,2);

COMMENT ON COLUMN public.saldo_declarado.saldo_real IS
  '🔴 233-06 (D-10): e o saldo do INSTANTE DA DECLARACAO, NAO a abertura do dia. '
  'O Wesley declara olhando o extrato — o numero ja inclui tudo que liquidou ate '
  'aquela hora. O 233-05 gravou este campo como se fosse a abertura (D-07) e o '
  'sistema somou o dia por cima, contando R$ 13.157,27 duas vezes. A abertura '
  'correspondente esta em `abertura_ancorada`, e e ELA que vai para '
  '`financial_settings.initial_balance` via `set_financial_balance`.';

COMMENT ON COLUMN public.saldo_declarado.abertura_ancorada IS
  '233-06: a abertura decomposta a partir do declarado — '
  '`saldo_real − entradas_liquidadas + saidas_pagas`. E o valor que foi para a '
  'ancora (`financial_settings.initial_balance` com `balance_anchor_date` = o '
  'dia da declaracao).';

COMMENT ON COLUMN public.saldo_declarado.entradas_pendentes IS
  '233-06: o que o dia ainda podia receber e ainda nao recebera no instante da '
  'declaracao (tudo que nao era `approved` nem `refunded`). E a diferenca entre '
  'o saldo declarado e a previsao de fechamento daquele dia.';

-- ---------------------------------------------------------------------------
-- 5. A linha semente de 27/08 — o retrato do que foi aplicado a mao
-- ---------------------------------------------------------------------------
-- 🔴 `UPDATE` filtrado por `id` **E** `organization_id`. Nenhum `where` aberto.
-- O `id` vem do par unico (organization_id, data_declarada) — a constraint
-- `saldo_declarado_org_data_key` garante que ele e um so.
--
-- ⚠️ `abertura_ancorada IS NULL` no filtro: se a linha ja tiver retrato (porque
-- a tela do 233-06 ja gravou), o `UPDATE` nao a sobrescreve. Rodar a migration
-- duas vezes nao apaga dado mais novo.
--
-- Os valores sao os MEDIDOS em producao em 27/08/2026 no instante da
-- declaracao, e sao literais aqui porque sao um RETRATO — nao um criterio de
-- aceite. `entradas_pendentes` = 1.355,31 e exatamente o `in_mediation` do dia.
UPDATE public.saldo_declarado
   SET abertura_ancorada   = 33758.27,
       entradas_liquidadas = 13157.27,
       saidas_pagas        =  9485.54,
       entradas_pendentes  =  1355.31
 WHERE organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'::uuid
   AND id = (
     SELECT sd.id
     FROM public.saldo_declarado sd
     WHERE sd.organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'::uuid
       AND sd.data_declarada  = DATE '2026-08-27'
   )
   AND abertura_ancorada IS NULL;
