-- ============================================================================
-- 225-10 — A JANELA QUE VARRIA O FUTURO, E O VIGIA DA FOLGA DE 30 DIAS
--
-- Duas coisas, e só duas:
--
--   1. `public.sync_jobs` ganha duas colunas nulaveis para o vigia da folga da
--      janela de repescagem de 30 dias.
--   2. `public.dispatch_orders_jobs(boolean)` para de enfileirar, em duas
--      rodadas horarias por dia, uma janela inteiramente no FUTURO.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O DEFEITO 2, MEDIDO (225-CENSO-PEDIDOS.md, secao 2.4)
--
-- O banco esta em UTC (`current_setting('TIMEZONE') = 'UTC'`) e o alvo era
-- derivado de `CURRENT_DATE`. O cron horario `sync-orders-hoje` (jobid 51)
-- roda no minuto 5 das horas `11-23,0-1` UTC. Nas rodadas de **00:05 e 01:05
-- UTC** o `CURRENT_DATE` do banco JA VIROU para o dia seguinte, enquanto no
-- Brasil ainda sao 21:05 e 22:05 do dia anterior. A janela que a Edge Function
-- monta para esse alvo e `[alvo 03:00Z, alvo+1 02:59Z]` — um intervalo que
-- comeca DEPOIS do instante da varredura. As duas rodadas nao podiam achar
-- nada, e o censo confirmou nos dados: para `date_from = 2026-08-08` existem
-- jobs as 00:05 e 01:05 do proprio 08/08, para uma janela que so comeca as
-- 03:00Z.
--
-- Efeito pratico ANTES: a ultima varredura util do dia BRT era as 23:05 UTC
-- (20:05 BRT), e pedido criado entre 20:05 e 23:59 BRT nao tinha varredura
-- nenhuma no mesmo dia — dependia inteiramente do cron diario do dia seguinte.
-- Foi exatamente essa faixa que o incidente de maio esvaziou (11 dos 26
-- pedidos perdidos sao a cauda da noite de 27/05).
--
-- Efeito ESPERADO DEPOIS: as rodadas de 00:05 e 01:05 UTC passam a mirar o dia
-- BRT corrente, que naquele instante e o dia anterior em UTC, e a janela
-- `[dia 03:00Z, dia+1 02:59Z]` CONTEM o instante da varredura. A faixa de
-- 20:05 a 23:59 BRT passa a ter duas varreduras no proprio dia.
--
-- A CORRECAO: derivar o alvo do **dia BRT corrente**
-- (`(now() AT TIME ZONE 'America/Sao_Paulo')::date`) e nao do dia UTC.
--
-- POR QUE A JANELA RETROATIVA DE TRES DIAS NAO ENCOLHE: o cron diario
-- `sync-orders-daily` (jobid 7) roda as **09:00 UTC**, que e 06:00 BRT do
-- MESMO dia. Nesse instante o dia UTC e o dia BRT sao identicos, entao
-- `CURRENT_DATE - d` e `dia_brt - d` produzem exatamente os mesmos tres alvos.
-- A troca e um no-op para o diario e uma correcao para o horario. E ela alinha
-- o despachante com a Edge Function, que ja raciocina em dia BRT: a assinatura
-- da rodada diaria que dispara a repescagem compara `date_from` com
-- `hojeBRT() - 3` (`_shared/janelaMlBusca.ts`). Enfileirar em dia UTC e conferir
-- em dia BRT eram duas reguas para o mesmo fato — a classe de defeito que
-- quebrou o saldo na Fase 233.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O CORPO DESTA FUNCAO FOI LIDO DO BANCO, NAO DO REPOSITORIO
--
-- 🔴 O arquivo `20260805011500_sync_orders_dia_corrente.sql` deste mesmo
-- repositorio esta DESATUALIZADO em relacao ao que roda em producao: ele mostra
-- `alvo := CASE WHEN p_incluir_hoje THEN CURRENT_DATE ELSE CURRENT_DATE - 1 END`
-- e nao tem `v_dias_retro`. O corpo VIVO, lido com `pg_get_functiondef` em
-- 2026-09-04, tem `v_dias_retro integer := 3` e o filtro `sync_enabled` em
-- `ml_tokens`. Partir do arquivo apagaria a janela retroativa de tres dias e o
-- filtro — silenciosamente, sem quebrar nada visivel.
--
-- 🔴 EXISTE UMA SEGUNDA FORMA, `public.dispatch_orders_jobs()` SEM PARAMETRO,
-- e ela NAO e tocada aqui. Ela e orfa (nenhum cron a chama), tem ACL com
-- `anon=X` e `authenticated=X`, e SECURITY DEFINER sem `search_path`. Esta
-- registrada como achado no 225-10-SUMMARY.md. Por isso o comando abaixo e
-- `CREATE OR REPLACE` com a assinatura `(boolean)` explicita: um
-- `DROP FUNCTION` apagaria a lista de permissoes (licao ja paga nesta casa) e,
-- com duas funcoes de mesmo nome, poderia derrubar a errada.
--
-- ACL do corpo vivo, reemitida abaixo sem alteracao:
--   {postgres=X/postgres, service_role=X/postgres}
--   proconfig = ["search_path=public"] · provolatile = 'v' · prosecdef = true
--
-- ────────────────────────────────────────────────────────────────────────────
-- DUAS GUARDAS, EM PONTAS OPOSTAS, E ELAS CONCLUEM O OPOSTO DE PROPOSITO
--
-- A do TOPO pergunta "isto ja rodou antes?" ANTES de qualquer efeito: se as
-- colunas do vigia ja existirem, aborta. A do FIM pergunta "isto acabou de
-- rodar direito?" DEPOIS de todos os efeitos: exige que as colunas existam.
-- Uma guarda so, no fim, teria que provar que as colunas existem e abortar
-- porque existem — nao ha implementacao que satisfaca as duas.
--
-- Por que o replay e plausivel: `apply_migration` grava a versao pelo relogio
-- do SERVIDOR e nao pelo nome do arquivo (`225-05-SONDAS-ESTADO.md:43` — o
-- arquivo `20260904120000_...` foi gravado como `20260904011301`), e esta fase
-- ja teve duas colisoes de prefixo. Num `db push` futuro este arquivo
-- apareceria como nao aplicado, e um replay reexecutaria um CREATE OR REPLACE
-- sobre a funcao de despacho que DOIS CRONS ATIVOS consomem.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- PRE-GUARDA — no TOPO, antes de qualquer DDL.
-- Leitura pura: idempotente por construcao, e na primeira aplicacao passa
-- porque as colunas ainda nao existem.
-- ────────────────────────────────────────────────────────────────────────────
DO $preguarda$
DECLARE
  v_ja integer;
BEGIN
  SELECT count(*) INTO v_ja
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'sync_jobs'
    AND column_name IN ('repescagem_maior_atraso_horas', 'repescagem_atraso_denominador');

  IF v_ja > 0 THEN
    RAISE EXCEPTION
      '225-10: esta migration JA FOI APLICADA (% de 2 colunas do vigia ja existem em public.sync_jobs). Abortando antes de qualquer DDL: um replay reexecutaria CREATE OR REPLACE sobre public.dispatch_orders_jobs(boolean), consumida por 2 crons ativos. Se o objetivo e mesmo reaplicar, remova as colunas de proposito primeiro e registre o motivo.',
      v_ja;
  END IF;
END
$preguarda$;


-- ────────────────────────────────────────────────────────────────────────────
-- 1. AS DUAS COLUNAS DO VIGIA DA FOLGA
--
-- NULAVEIS de proposito, e o comentario de cada uma diz por que: so a
-- repescagem as preenche. Job de outro tipo as deixa vazias, e VAZIO AQUI
-- SIGNIFICA "esta rodada nao mediu" — nunca "o atraso foi zero". A diferenca
-- entre as duas leituras e a diferenca entre saber e achar que sabe.
--
-- ⚠️ Colunas NOVAS E PROPRIAS. O campo de texto livre que a tabela ja tem para
-- mensagem de falha NAO foi reaproveitado: ele e lido como "este job quebrou",
-- e gravar metrica de saude ali arrebentaria qualquer consulta de job com erro.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sync_jobs
  ADD COLUMN repescagem_maior_atraso_horas numeric(10,2),
  ADD COLUMN repescagem_atraso_denominador integer;

COMMENT ON COLUMN public.sync_jobs.repescagem_maior_atraso_horas IS
  'Vigia da folga da janela de repescagem de 30 dias (225-10). Maior intervalo, em horas, entre date_created e date_closed observado pela repescagem NESTA rodada. Existe para a folga da janela nao envelhecer calada: o numero de partida e 292h (maior atraso medido em 2026 inteiro, 225-CENSO-PEDIDOS.md), ou seja folga de 2,5x sobre os 720h da janela. NULL significa "esta rodada nao mediu" e nunca "o atraso foi zero". Se este valor passar de dois tercos da janela (480h) a acao e ALARGAR a janela, nao trocar a regua. Serie consultavel: SELECT date_from, repescagem_maior_atraso_horas, repescagem_atraso_denominador FROM public.sync_jobs WHERE repescagem_maior_atraso_horas IS NOT NULL ORDER BY created_at DESC;';

COMMENT ON COLUMN public.sync_jobs.repescagem_atraso_denominador IS
  'Denominador do vigia da folga (225-10): sobre quantos pedidos COM data de fechamento o maior atraso desta rodada foi calculado. Numero sem denominador nao e medicao — 292h sobre 1 pedido e 292h sobre 900 dizem coisas diferentes. Pedido sem date_closed fica FORA deste calculo e e contado a parte no retorno da Edge Function: ele nao tem atraso, ele tem ausencia, e o censo provou que /orders/search nao indexa pedido que nao fechou. NULL significa "esta rodada nao mediu".';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. A JANELA QUE VARRIA O FUTURO
--
-- Corpo IDENTICO ao vivo, com UMA unica mudanca: o alvo sai do dia BRT
-- corrente em vez do dia UTC. Assinatura, SECURITY DEFINER, search_path,
-- volatilidade, o filtro `sync_enabled` e `v_dias_retro := 3` preservados.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispatch_orders_jobs(p_incluir_hoje boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r    RECORD;
  d    date;
  alvo date;
  -- 2026-08-11: a janela era de UM dia so (hoje OU ontem). Um pedido cujo
  -- /shipments/{id} falhasse nessas duas chances ficava com frete NULL para
  -- sempre — ninguem voltava nele. Foi a causa dos 80 pedidos sem frete da
  -- conta Junior (o mesmo remedio que a Fase 221 aplicou ao ads: alargar a
  -- janela). O custo e baixo porque fetchShipmentDetails ja pula pedido que
  -- JA tem frete e endereco no banco (sync incremental) — a rodada extra so
  -- busca o que esta faltando.
  v_dias_retro integer := 3;
  -- 2026-09-04 (Fase 225, plano 10): o dia de referencia e o dia BRT, nao o
  -- dia UTC. O banco esta em UTC; nas rodadas horarias de 00:05 e 01:05 UTC o
  -- CURRENT_DATE ja virou enquanto no Brasil ainda e o dia anterior, e a
  -- janela `[alvo 03:00Z, alvo+1 02:59Z]` que a Edge Function monta ficava
  -- INTEIRAMENTE NO FUTURO — duas varreduras por dia que nao podiam achar
  -- nada, e a faixa de 20:05 a 23:59 BRT sem varredura no proprio dia.
  -- O cron diario roda as 09:00 UTC = 06:00 BRT do mesmo dia, entao para ele
  -- as duas reguas coincidem e a janela retroativa de tres dias nao muda.
  v_hoje_brt date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  FOR r IN
    SELECT DISTINCT ml_user_id, organization_id
    FROM public.ml_tokens
    WHERE access_token IS NOT NULL
      AND sync_enabled
  LOOP
    IF p_incluir_hoje THEN
      -- cron horario: so o dia corrente, para ficar leve
      alvo := v_hoje_brt;
      IF NOT EXISTS (
        SELECT 1 FROM public.sync_jobs
        WHERE ml_user_id = r.ml_user_id AND job_type = 'orders'
          AND date_from = alvo AND status IN ('pending','running')
      ) THEN
        INSERT INTO public.sync_jobs (ml_user_id, organization_id, job_type, status, date_from, date_to)
        VALUES (r.ml_user_id, r.organization_id, 'orders', 'pending', alvo, alvo);
      END IF;
    ELSE
      -- cron diario: D-1 ate D-3, para recuperar envio que falhou nas rodadas
      -- anteriores em vez de deixar o campo mudo para sempre
      FOR d IN 1..v_dias_retro LOOP
        alvo := v_hoje_brt - d;
        IF NOT EXISTS (
          SELECT 1 FROM public.sync_jobs
          WHERE ml_user_id = r.ml_user_id AND job_type = 'orders'
            AND date_from = alvo AND status IN ('pending','running')
        ) THEN
          INSERT INTO public.sync_jobs (ml_user_id, organization_id, job_type, status, date_from, date_to)
          VALUES (r.ml_user_id, r.organization_id, 'orders', 'pending', alvo, alvo);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$function$;

-- Disciplina de privilegio: SECURITY DEFINER exige REVOKE explicito, e o par
-- reemitido aqui reproduz a ACL do corpo vivo — {postgres=X/postgres,
-- service_role=X/postgres}. Nem `anon` nem `authenticated` executam esta forma.
REVOKE ALL ON FUNCTION public.dispatch_orders_jobs(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_orders_jobs(boolean) FROM anon;
REVOKE ALL ON FUNCTION public.dispatch_orders_jobs(boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_orders_jobs(boolean) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- GUARDA DE POS-ESTADO — no FIM, depois de todos os efeitos.
-- Nao pergunta "ja rodou?"; pergunta "acabou de rodar direito?".
-- ────────────────────────────────────────────────────────────────────────────
DO $posguarda$
DECLARE
  v_oid       oid;
  v_secdef    boolean;
  v_volatile  "char";
  v_config    text[];
  v_corpo     text;
  v_colunas   integer;
  v_crons     integer;
  v_faltando  text;
  v_formas    text;
BEGIN
  -- (a) a funcao existe com a MESMA assinatura, e as propriedades de que a ACL
  --     e o isolamento dependem continuam de pe.
  --
  -- 🔴 A ASSINATURA E CASADA POR TIPO, NUNCA POR TEXTO RENDERIZADO. Armadilha
  -- paga na primeira tentativa desta migration, em 2026-09-04: eu comparava
  -- `pg_get_function_identity_arguments(p.oid) = 'boolean'` e a guarda reprovou
  -- com "a funcao nao existe" sobre uma funcao que existia e acabara de ser
  -- substituida com sucesso. Motivo: `pg_get_function_identity_arguments`
  -- devolve o NOME do parametro junto com o tipo — aqui, `p_incluir_hoje
  -- boolean`, e nao `boolean`. Quem imprime `dispatch_orders_jobs(boolean)` e o
  -- `regprocedure`, que e o formato em que a assinatura circula nas conversas e
  -- na documentacao desta fase. Sao dois formatos diferentes para a mesma
  -- coisa, e confundi-los produz um falso negativo que parece um desastre.
  -- `pronargs` + `proargtypes` casa por TIPO e ainda fica imune a renomear o
  -- parametro, que e mudanca inocua e nao deveria derrubar guarda nenhuma.
  --
  -- ⚠️ `proargtypes` e um oidvector e comeca no indice ZERO.
  SELECT p.oid, p.prosecdef, p.provolatile, p.proconfig
    INTO v_oid, v_secdef, v_volatile, v_config
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'dispatch_orders_jobs'
    AND p.pronargs = 1
    AND p.proargtypes[0] = 'boolean'::regtype;

  IF v_oid IS NULL THEN
    -- Se falhar, a mensagem diz o que EXISTE — sem isso o diagnostico custa
    -- outra ida ao banco, que foi exatamente o que a primeira tentativa custou.
    SELECT COALESCE(string_agg(format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ' | '), '(nenhuma)')
      INTO v_formas
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'dispatch_orders_jobs';

    RAISE EXCEPTION
      '225-10 POS-ESTADO: nao achei public.dispatch_orders_jobs com exatamente 1 argumento boolean depois da migration. A assinatura mudou ou a funcao sumiu. Formas encontradas: %.',
      v_formas;
  END IF;

  IF v_secdef IS DISTINCT FROM true
     OR v_volatile IS DISTINCT FROM 'v'
     OR NOT ('search_path=public' = ANY(COALESCE(v_config, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION
      '225-10 POS-ESTADO: propriedades de seguranca de dispatch_orders_jobs(boolean) divergem do corpo vivo. Esperado prosecdef=true / provolatile=v / proconfig com search_path=public; encontrado prosecdef=% / provolatile=% / proconfig=%.',
      v_secdef, v_volatile, COALESCE(array_to_string(v_config, ','), '(vazio)');
  END IF;

  -- (b) a janela retroativa de tres dias SOBREVIVEU. Esta e a checagem que o
  --     arquivo desatualizado do repositorio teria apagado em silencio.
  v_corpo := pg_get_functiondef(v_oid);
  IF position('v_dias_retro' in v_corpo) = 0
     OR position('sync_enabled' in v_corpo) = 0 THEN
    RAISE EXCEPTION
      '225-10 POS-ESTADO: o corpo de dispatch_orders_jobs(boolean) perdeu v_dias_retro e/ou o filtro sync_enabled. Isto e exatamente o que acontece ao partir do arquivo do repositorio em vez do corpo vivo lido do banco.';
  END IF;

  -- (c) as duas colunas do vigia existem
  SELECT count(*) INTO v_colunas
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'sync_jobs'
    AND column_name IN ('repescagem_maior_atraso_horas', 'repescagem_atraso_denominador');

  IF v_colunas <> 2 THEN
    RAISE EXCEPTION '225-10 POS-ESTADO: esperava 2 colunas do vigia em public.sync_jobs, encontrei %.', v_colunas;
  END IF;

  -- (d) os DOIS crons que consomem a funcao continuam agendados e ativos.
  --     Substituir a funcao que um cron ativo chama e a operacao de maior risco
  --     deste arquivo; sair sem conferir seria entregar a prova pela metade.
  SELECT count(*) INTO v_crons
  FROM cron.job
  WHERE jobname IN ('sync-orders-daily', 'sync-orders-hoje')
    AND active;

  IF v_crons <> 2 THEN
    SELECT COALESCE(string_agg(x, ', '), '(nenhum dos dois)')
      INTO v_faltando
    FROM unnest(ARRAY['sync-orders-daily','sync-orders-hoje']) AS x
    WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = x AND j.active);

    RAISE EXCEPTION
      '225-10 POS-ESTADO: esperava 2 crons ativos consumindo dispatch_orders_jobs, encontrei %. Ausentes ou inativos: %.',
      v_crons, v_faltando;
  END IF;

  RAISE NOTICE '225-10 POS-ESTADO OK: dispatch_orders_jobs(boolean) com search_path/DEFINER/VOLATILE preservados, v_dias_retro e sync_enabled sobreviventes, 2 colunas do vigia em sync_jobs, 2 crons ativos.';
END
$posguarda$;
