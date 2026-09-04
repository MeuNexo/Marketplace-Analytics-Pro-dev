-- ────────────────────────────────────────────────────────────────────────────
-- Fase 225, passagem corretiva 225-07 — G-02 e G-03 do `225-VERIFICATION.md`.
--
-- As migrations 20260903130000, 20260903140000, 20260904110000 e 20260904120000
-- JA ESTAO APLICADAS e nao se editam: o que esta em producao so muda por
-- migration nova.
--
-- ═══ G-02 — O AVISO DE LISTA INCOMPLETA VIROU CODIGO MORTO ═════════════════
--
-- O plano 06 acrescentou `conciliacao_frete_linhas` ao `get_casos_conciliacao`
-- (union all) e NAO ao `get_conciliacao_resumo`. Os dois passaram a descrever
-- universos diferentes:
--
--     resumo.linhas_total = 1.926   (so a base, medido em S-06)
--     a lista carrega     ~3.167   (base + as 1.241 de frete, F-02)
--
-- A tela compara `linhas.length` contra `resumo.linhas_total`. Com o resumo
-- menor que a lista, `faltamLinhas = totalReal - linhas.length` NUNCA pode ser
-- positivo, e o Alert "A lista nao esta completa" ficou permanentemente inerte.
--
-- 🔴 Ele existia para uma coisa so: D-225-16, "nenhum caso expira sem eu ter
-- olhado". Uma guarda que nao pode disparar e PIOR que guarda nenhuma, porque a
-- tela parece vigiada. O 225-06-SUMMARY declara que o resumo nao foi tocado, e
-- nao percebeu que isso desarmou a guarda de completude do 225-03.
--
-- Efeito colateral no mesmo lugar: `valor_desconhecido_n` subconta as linhas de
-- frete sem valor apurado — a nota de rodape diz um numero MENOR que o que a
-- propria lista mostra tres centimetros acima.
--
-- ⚠️ O QUE SE MOVE, dito antes de rodar. Reunir os universos muda o valor de
-- cinco campos, e so cinco:
--
--     linhas_total          -- a correcao em si
--     valor_desconhecido_n  -- a correcao em si
--     vazamento_total       -- passa a somar a diferenca de frete (D-225-06:
--                              toda diferenca soma no total do vazamento)
--     nosso_erro_n / _soma  -- as linhas de frete com fila 'nosso'
--                              (frete_multi_item, possivel_carrinho,
--                              frete_sem_cobranca_registrada) ja APARECEM na
--                              aba "Nosso erro"; o rodape e que as ignorava
--
-- Os outros vinte e um NAO se movem, e da para provar por construcao:
-- `casos_urgentes`, `soma_urgente`, `proximo_prazo_dias` e `acionaveis_n`
-- filtram por `acionavel`, que nas linhas de frete depende de
-- `acusar_frete_a_maior` — DESLIGADA. `sub_piso_*` filtra `abaixo_do_piso` e o
-- frete emite `frete_abaixo_do_piso`, codigo diferente. `fora_escopo_*` filtra
-- `fora_do_escopo`, que a cascata do frete nao emite. `entradas_sem_origem_*` e
-- `a_verificar_*` filtram por tipo/motivo que so a base produz. O resto e eco
-- de configuracao.
--
-- ═══ G-03 — PAGINACAO POR OFFSET SOBRE ORDENACAO SEM DESEMPATE ═════════════
--
-- `get_casos_conciliacao` ordenava por `dias_restantes asc nulls last,
-- diferenca desc nulls last` e nada mais. O hook pagina por OFFSET em ate 40
-- chamadas INDEPENDENTES, e cada uma reexecuta a funcao inteira. Ha 1.188
-- linhas `frete_sem_vigencia_na_venda` com `diferenca` NULA: o empate e macico.
-- Se a ordem variar entre duas chamadas — outro plano, ou uma linha nova
-- gravada pelo `sync-mp-releases`, que roda de 3 em 3 horas — a mesma linha
-- aparece duas vezes numa pagina e some de outra, sem nada piscar na tela.
--
-- 🔴 S-07 mediu ausencia de duplicata DENTRO de uma unica consulta. Nunca ENTRE
-- paginas. E entre paginas e o unico lugar onde o defeito existe.
--
-- ═══ O QUE ESTA MIGRATION NAO FAZ ══════════════════════════════════════════
--
-- 🔴 NAO liga `acusar_valor_a_menor` nem `acusar_frete_a_maior`, e ABORTA se
-- alguem os tiver ligado por fora. C-03 reprovou a regua de valor a menor com
-- 55,3% de aderencia ao centavo e vazamento liquido NEGATIVO; F-02 fechou com
-- n = 0 comparaveis. Liga-los antes do passo (c) de C-03c e de F-02 ter amostra
-- desfaria o melhor trabalho desta fase: uma regua que se recusou a acusar
-- depois de reprovar na propria calibracao.
--
-- 🔴 NAO toca `conciliacao_base_linhas` nem `conciliacao_frete_linhas`. Esta
-- passagem corrige o AGREGADO e a ORDEM. Nenhum numero que uma linha carrega
-- muda de valor.
--
-- ⚠️ `CREATE OR REPLACE`, jamais `DROP`: as duas assinaturas sao identicas, e
-- apagar a funcao apagaria a ACL junto (`feedback_drop_function_apaga_acl`).
-- O par revoke/grant e reemitido mesmo assim, com `anon` NOMEADO — revogar de
-- PUBLIC nao desfaz a concessao direta que o default privilege do Supabase
-- grava, e foi exatamente isso que R-08(c) reprovou nesta fase.
--
-- ⚠️ E o `CREATE OR REPLACE` de funcao que devolve TABLE recusa mudanca de nome
-- ou tipo de coluna de retorno: os contratos de 26 e 24 colunas sao garantidos
-- pelo motor, nao pela disciplina de quem escreveu.
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ 0. GUARDA DE DERIVA — antes de substituir, conferir o que esta VIVO ════
--
-- 🔴 `feedback_corpo_vivo_de_rpc_vem_do_banco`: clonar corpo de RPC a partir do
-- repositorio ja REGREDIU producao nesta casa (`get_cashflow`, R$ 30.372,11).
-- Os dois corpos abaixo foram copiados de 20260903140000 e 20260904110000, que
-- sao as ultimas definicoes NO REPOSITORIO — e o repositorio nao e autoridade
-- sobre o que esta no ar. Se alguem corrigiu as funcoes direto no banco,
-- substituir por estas versoes desfaria a correcao EM SILENCIO.

do $$
declare
  v_resumo_corpo text;
  v_casos_corpo  text;
begin
  select pg_get_functiondef(p.oid) into v_resumo_corpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_conciliacao_resumo';

  select pg_get_functiondef(p.oid) into v_casos_corpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_casos_conciliacao';

  if v_resumo_corpo is null or v_casos_corpo is null then
    raise exception 'as RPCs do monitor nao existem; aplique 20260903130000..20260904120000 antes desta';
  end if;

  -- Marcador 1: o resumo VIVO tem que agregar so sobre a base. Se ja unir o
  -- frete, alguem consertou direto no banco e esta migration desfaria isso.
  if position('conciliacao_frete_linhas' in v_resumo_corpo) > 0 then
    raise exception 'o corpo VIVO de get_conciliacao_resumo ja une o frete: producao divergiu do repositorio, confira antes de aplicar';
  end if;
  if position('conciliacao_base_linhas' in v_resumo_corpo) = 0 then
    raise exception 'o corpo VIVO de get_conciliacao_resumo nao le a funcao base: producao divergiu do repositorio, confira antes de aplicar';
  end if;

  -- Marcador 2: os tres campos que a onda 2 acrescentou tem que estar vivos. Se
  -- faltarem, o corpo no ar e ANTERIOR ao 20260903140000 e substituir por este
  -- pularia uma correcao inteira.
  if position('linhas_total' in v_resumo_corpo) = 0
     or position('teto_da_lista' in v_resumo_corpo) = 0
     or position('valor_desconhecido_n' in v_resumo_corpo) = 0 then
    raise exception 'o corpo VIVO de get_conciliacao_resumo e anterior a 20260903140000: producao divergiu do repositorio, confira antes de aplicar';
  end if;

  -- Marcador 3: o wrapper VIVO tem que ja unir o frete (o 225-06 aplicado)...
  if position('conciliacao_frete_linhas' in v_casos_corpo) = 0 then
    raise exception 'o corpo VIVO de get_casos_conciliacao nao une o frete: 20260904110000 nao esta aplicada, ou producao divergiu do repositorio';
  end if;
  -- ...e NAO pode ja ter o desempate: se tiver, alguem consertou no banco.
  if position('t.payment_ids' in v_casos_corpo) > 0 then
    raise exception 'o corpo VIVO de get_casos_conciliacao ja tem o desempate: alguem consertou direto no banco e esta migration desfaria isso';
  end if;
end $$;

-- ═══ 1. G-02 — o resumo agrega sobre o MESMO universo que a tela carrega ════

create or replace function public.get_conciliacao_resumo(
  p_org_id      uuid,
  p_janela_dias int default null
)
returns table (
  casos_urgentes           int,
  soma_urgente             numeric,
  proximo_prazo_dias       int,
  acionaveis_n             int,
  vazamento_total          numeric,
  sub_piso_n               int,
  sub_piso_soma            numeric,
  nosso_erro_n             int,
  nosso_erro_soma          numeric,
  fora_escopo_n            int,
  fora_escopo_soma         numeric,
  entradas_sem_origem_n    int,
  entradas_sem_origem_soma numeric,
  a_verificar_n            int,
  a_verificar_soma         numeric,
  recuperado_total         numeric,
  saidas_auditadas         boolean,
  ingestao_inicio          date,
  piso_materialidade       numeric,
  acusar_valor_a_menor     boolean,
  dias_aguardando          int,
  dias_ausente             int,
  ultima_sync              timestamptz,
  linhas_total             int,
  teto_da_lista            int,
  valor_desconhecido_n     int
)
language sql
stable
security invoker
set search_path = public
as $$
with cfg as (
  select coalesce(c.piso_materialidade, 5.00)           as piso,
         coalesce(c.dias_aguardando, 15)                as dias_aguardando,
         coalesce(c.dias_ausente, 22)                   as dias_ausente,
         coalesce(p_janela_dias, c.janela_dias, 30)     as janela,
         coalesce(c.ingestao_inicio, date '2026-01-28') as ingestao_inicio,
         coalesce(c.acusar_valor_a_menor, false)        as acusar,
         (now() at time zone 'America/Sao_Paulo')::date as hoje
    from (select 1) z
    left join public.conciliacao_config c on c.organization_id = p_org_id
),
-- 🔴 G-02: o universo do resumo tem que ser o MESMO que a tela carrega.
-- O plano 06 uniu o frete no wrapper e nao aqui; desde entao o resumo contava
-- so a base (1.926) contra ~3.167 na lista, e `faltamLinhas` nunca podia ser
-- positivo. O Alert "A lista nao esta completa" ficou permanentemente inerte —
-- e ele existia para D-225-16, o criterio que a fase escolheu como o seu.
b as (
  select * from public.conciliacao_base_linhas(p_org_id, p_janela_dias)
  union all
  select * from public.conciliacao_frete_linhas(p_org_id, p_janela_dias)
)
select count(*) filter (where b.acionavel and b.dias_restantes <= 7)::int          as casos_urgentes,
       coalesce(sum(b.diferenca) filter (where b.acionavel and b.dias_restantes <= 7), 0) as soma_urgente,
       min(b.dias_restantes) filter (where b.acionavel)::int                       as proximo_prazo_dias,
       count(*) filter (where b.acionavel)::int                                    as acionaveis_n,
       coalesce(sum(b.diferenca) filter (where b.tipo_caso <> 'entrada_sem_origem'), 0) as vazamento_total,
       count(*) filter (where b.motivo = 'abaixo_do_piso')::int                    as sub_piso_n,
       coalesce(sum(b.diferenca) filter (where b.motivo = 'abaixo_do_piso'), 0)    as sub_piso_soma,
       count(*) filter (where b.fila = 'nosso' and b.tipo_caso <> 'entrada_sem_origem')::int as nosso_erro_n,
       -- 🔴 CORRECAO 3: SEM coalesce. Quando nenhuma das linhas tem valor
       -- mensuravel, este campo vem NULO — "nao sei" — e nunca R$ 0,00, que na
       -- tela leria "o nosso erro custa zero". A tela do plano 03 e obrigada a
       -- distinguir os dois (feedback_ausencia_diz_o_motivo_real).
       sum(b.diferenca) filter (where b.fila = 'nosso' and b.tipo_caso <> 'entrada_sem_origem') as nosso_erro_soma,
       count(*) filter (where b.motivo = 'fora_do_escopo')::int                    as fora_escopo_n,
       sum(b.diferenca) filter (where b.motivo = 'fora_do_escopo')                 as fora_escopo_soma,
       count(*) filter (where b.tipo_caso = 'entrada_sem_origem')::int             as entradas_sem_origem_n,
       coalesce(sum(b.diferenca) filter (where b.tipo_caso = 'entrada_sem_origem'), 0) as entradas_sem_origem_soma,
       count(*) filter (where b.motivo = 'ausencia_a_verificar')::int              as a_verificar_n,
       coalesce(sum(b.diferenca) filter (where b.motivo = 'ausencia_a_verificar'), 0) as a_verificar_soma,
       (select coalesce(sum(k.valor_recuperado), 0) from public.conciliacao_casos k
         where k.organization_id = p_org_id and k.estado = 'ganho')                as recuperado_total,
       (exists (select 1 from public.mp_saidas s
                 where s.organization_id = p_org_id
                   and s.data_movimento >= (select hoje - janela from cfg)))       as saidas_auditadas,
       (select ingestao_inicio from cfg)                                           as ingestao_inicio,
       (select piso from cfg)                                                      as piso_materialidade,
       (select acusar from cfg)                                                    as acusar_valor_a_menor,
       (select dias_aguardando from cfg)                                           as dias_aguardando,
       (select dias_ausente from cfg)                                              as dias_ausente,
       (select max(ci.synced_at) from public.cash_inflows ci
         where ci.organization_id = p_org_id)                                      as ultima_sync,
       -- 🔴 CORRECAO 2: o total REAL, contado sem teto. A lista corta em 1.000 e
       -- hoje ha 1.351 linhas em 30 dias. Sem este campo a tela mostra 1.000 e o
       -- usuario acha que sao todos — e o caso da linha 1.001 nunca e olhado,
       -- que reprova D-225-16 direto.
       count(*)::int                                                               as linhas_total,
       1000                                                                        as teto_da_lista,
       -- Quantas linhas nao tem valor mensuravel. Existe para a tela poder dizer
       -- "31 casos, 12 sem valor apurado" em vez de somar zero por cima deles.
       count(*) filter (where b.diferenca is null)::int                            as valor_desconhecido_n
  from b;
$$;
comment on function public.get_conciliacao_resumo(uuid, int) is
  '225-02/225-07: uma linha com o resumo do monitor. Devolve a REGUA junto dos numeros — piso, '
  'cortes de dias, inicio da ingestao e o estado de acusar_valor_a_menor — para que a tela diga '
  'qual regra esta valendo sem repetir o numero em codigo. 🔴 G-02 (225-07): agrega sobre o '
  'MESMO universo do wrapper (base UNION frete). Antes contava so a base, e como a tela compara '
  '`linhas.length` com `linhas_total`, o aviso "A lista nao esta completa" nunca podia disparar — '
  'a guarda de D-225-16 estava desarmada em silencio. 🔴 `nosso_erro_soma` e `fora_escopo_soma` '
  'vem NULOS quando nao ha valor mensuravel, nunca zero: zero e uma afirmacao, nulo e a ausencia '
  'dela. `valor_desconhecido_n` conta essas linhas, agora incluindo as de frete.';

create or replace function public.get_casos_conciliacao(
  p_org_id            uuid,
  p_janela_dias       int     default null,
  p_apenas_acionaveis boolean default true,
  p_limite            int     default 200,
  p_offset            int     default 0
)
returns table (
  caso_id             uuid,
  ml_order_id         text,
  tipo_caso           text,
  fila                text,
  acionavel           boolean,
  motivo              text,
  estado              text,
  titulo              text,
  sku                 text,
  quantidade          int,
  retido_de_fato      numeric,
  cobranca_declarada  numeric,
  residuo_ml          numeric,
  esperado_nosso      numeric,
  recebido            numeric,
  residuo_nosso       numeric,
  diferenca           numeric,
  data_pedido         date,
  data_evento         date,
  dias_restantes      int,
  n_pagamentos        int,
  payment_ids         text[],
  release_date_max    date,
  valor_estimado      boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with todas as (
    select * from public.conciliacao_base_linhas(p_org_id, p_janela_dias)
    union all
    -- 225-06: o terceiro tipo de caso. A funcao base fica INTOCADA de proposito.
    select * from public.conciliacao_frete_linhas(p_org_id, p_janela_dias)
  )
  select t.*
    from todas t
   where (not p_apenas_acionaveis) or t.acionavel
   -- D-225-03: a fila ordena por dias restantes ate expirar, nunca por valor.
   -- Um caso de R$ 2 mil com 2 dias de vida vale mais atencao que um de R$ 5 mil
   -- com 25. Nulo por ultimo; a diferenca so desempata.
   -- 🔴 G-03: DESEMPATE, porque o hook pagina por OFFSET em ate 40 chamadas
   -- INDEPENDENTES e cada uma reexecuta a funcao inteira. Ordem parcial +
   -- OFFSET = uma linha repete numa pagina e some de outra, sem nada piscar.
   -- Ha 1.188 linhas com `diferenca` NULA (F-02): o empate e macico, nao
   -- teorico. S-07 mediu duplicata DENTRO de uma consulta, nunca ENTRE paginas.
   -- `payment_ids` fecha o ultimo buraco: `entrada_sem_origem` usa
   -- coalesce(ml_order_id, payment_id) como pedido, entao dois pagamentos do
   -- MESMO pedido nao ingerido empatariam em (ml_order_id, tipo_caso).
   -- ⚠️ O desempate entra DEPOIS do prazo e do valor: D-225-03 continua sendo a
   -- regua da fila. Antes deles, mudaria a ordem que a tela promete.
   order by t.dias_restantes asc nulls last,
            t.diferenca      desc nulls last,
            t.ml_order_id    asc  nulls last,
            t.tipo_caso      asc  nulls last,
            t.payment_ids    asc  nulls last
   -- Teto duro de 1000: o PostgREST trunca em 1000 EM SILENCIO, e a RPC nao
   -- deve nem chegar perto disso sem o chamador saber. O plano 03 pagina.
   limit  least(coalesce(p_limite, 200), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
comment on function public.get_casos_conciliacao(uuid, int, boolean, int, int) is
  '225-02/225-06/225-07: a fila do monitor de conciliacao, uma linha por anomalia. Contrato de 24 '
  'colunas consumido pelos planos 03, 04, 05 e 06 — inalterado. 🔴 A regua do dinheiro do ciclo '
  'venda->repasse e ML-CONTRA-ML e vive em `conciliacao_base_linhas`, que este arquivo NAO toca. '
  '🔴 G-03 (225-07): o ORDER BY ganhou desempate ate a ordem ficar TOTAL '
  '(ml_order_id, tipo_caso, payment_ids). O chamador pagina por OFFSET em ate 40 consultas '
  'independentes, e ordem parcial + OFFSET faz linha repetir numa pagina e sumir de outra — com '
  '1.188 linhas de `diferenca` NULA, o empate e macico. ⚠️ O desempate entra DEPOIS do prazo: '
  'D-225-03 continua sendo a regua da fila.';

-- ═══ 3. ACL — recriar funcao apagaria a ACL, entao o par vai NO MESMO ARQUIVO
--
-- 🔴 `from anon` e EXPLICITO: revogar de PUBLIC nao desfaz o grant direto que o
-- Supabase concede a `anon`. R-08(c) desta fase falhou exatamente nisso.
-- Com `CREATE OR REPLACE` a ACL e preservada e este bloco e redundante por
-- construcao. Ele fica assim mesmo: e barato, e a alternativa e depender de
-- alguem lembrar da regra no dia em que trocar o REPLACE por outra coisa.

revoke all on function public.get_conciliacao_resumo(uuid, int) from public;
revoke all on function public.get_conciliacao_resumo(uuid, int) from anon;
grant execute on function public.get_conciliacao_resumo(uuid, int) to authenticated;

revoke all on function public.get_casos_conciliacao(uuid, int, boolean, int, int) from public;
revoke all on function public.get_casos_conciliacao(uuid, int, boolean, int, int) from anon;
grant execute on function public.get_casos_conciliacao(uuid, int, boolean, int, int) to authenticated;

-- ═══ 4. Guardas — a correcao falha ALTO se nao pegar ════════════════════════

do $$
declare
  v_funcao   text;
  v_colunas  text;
  v_org      uuid;
  v_uniao    bigint;
  v_base     bigint;
  v_resumo   bigint;
  v_empates  bigint;
  v_pior     bigint;
  v_acusa    boolean;
begin
  -- ── (a) ACL: `anon` fora, `authenticated` dentro ────────────────────────
  foreach v_funcao in array array[
    'public.get_conciliacao_resumo(uuid,int)',
    'public.get_casos_conciliacao(uuid,int,boolean,int,int)'
  ]
  loop
    if has_function_privilege('anon', v_funcao, 'EXECUTE') then
      raise exception 'anon ainda EXECUTA % — o revoke de PUBLIC nao alcanca o grant direto', v_funcao;
    end if;
    if not has_function_privilege('authenticated', v_funcao, 'EXECUTE') then
      raise exception 'authenticated PERDEU execute em % — a tela quebraria inteira', v_funcao;
    end if;
  end loop;

  -- ── (b) As duas continuam INVOKER. DEFINER com p_org_id e IDOR ──────────
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_conciliacao_resumo','get_casos_conciliacao')
       and p.prosecdef
  ) then
    raise exception 'alguma funcao do monitor virou SECURITY DEFINER — isso e IDOR com p_org_id';
  end if;

  -- ── (c) Os contratos de coluna: a tela le por NOME ──────────────────────
  select pg_get_function_result(p.oid) into v_colunas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_conciliacao_resumo';
  if position('linhas_total' in v_colunas) = 0
     or position('valor_desconhecido_n' in v_colunas) = 0
     or position('acusar_valor_a_menor' in v_colunas) = 0 then
    raise exception 'o contrato de get_conciliacao_resumo perdeu coluna: a tela le por nome e o bloco sumiria';
  end if;

  select pg_get_function_result(p.oid) into v_colunas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_casos_conciliacao';
  if position('dias_restantes' in v_colunas) = 0
     or position('payment_ids' in v_colunas) = 0 then
    raise exception 'o contrato de get_casos_conciliacao perdeu coluna: a tela le por nome';
  end if;

  -- ── (d) A organizacao do teste, DERIVADA de dado ────────────────────────
  --
  -- 🔴 Sem UUID literal: UUID nao se completa por prefixo nesta casa, e o
  -- numero de uma loja ja apareceu na tela da outra. `conciliacao_config` so
  -- foi semeada para a Pe Vermeio (D-225-14), entao ela E o escopo.
  select c.organization_id into v_org
    from public.conciliacao_config c
   order by c.organization_id
   limit 1;

  if v_org is null then
    -- 🔴 O gate de cobertura do GSD que passou com zero itens e o mesmo defeito.
    raise exception 'Guarda vazia nao aprova migration: nenhuma organizacao configurada para exercitar as invariantes';
  end if;

  -- ── (e) 🔴 INVARIANTE DE G-02, medida contra producao ───────────────────
  --
  -- Nao basta o texto `conciliacao_frete_linhas` aparecer no corpo: uma uniao
  -- escrita errado tambem tem o texto. Aqui se mede o EFEITO — o total que o
  -- resumo devolve TEM que ser o total do universo que a tela carrega.
  -- (`feedback_gate_por_invariante_nao_por_literal`)
  --
  -- ⚠️ Esta assercao REPROVAVA antes desta migration, por construcao: o resumo
  -- devolvia a contagem da base e a uniao inclui o frete.
  with u as materialized (
    select * from public.conciliacao_base_linhas(v_org, null::int)
    union all
    select * from public.conciliacao_frete_linhas(v_org, null::int)
  ),
  d as (
    select count(*) as n
      from u
     group by u.dias_restantes, u.diferenca, u.ml_order_id, u.tipo_caso, u.payment_ids
    having count(*) > 1
  )
  select (select count(*) from u),
         (select count(*) from d),
         (select coalesce(max(d.n), 0) from d)
    into v_uniao, v_empates, v_pior;

  select count(*) into v_base
    from public.conciliacao_base_linhas(v_org, null::int);

  select r.linhas_total into v_resumo
    from public.get_conciliacao_resumo(v_org, null::int) r;

  raise notice 'G-02: base=% uniao=% resumo=% | G-03: chaves empatadas=% pior=%',
    v_base, v_uniao, v_resumo, v_empates, v_pior;

  if v_resumo is distinct from v_uniao then
    raise exception 'INVARIANTE REPROVADA (G-02): get_conciliacao_resumo.linhas_total = % mas o universo da lista tem % linhas. A guarda "A lista nao esta completa" continuaria inerte.',
      v_resumo, v_uniao;
  end if;

  -- ── (f) 🔴 INVARIANTE DE G-03, medida contra producao ───────────────────
  --
  -- A chave de ordenacao tem que ser UNICA. Enquanto ela for, `OFFSET` sobre
  -- ela nao pode pular nem repetir linha entre paginas, independentemente do
  -- plano que o Postgres escolher em cada uma das ate 40 chamadas.
  if v_empates > 0 then
    raise exception 'INVARIANTE REPROVADA (G-03): % chaves de ordenacao com mais de uma linha (a pior com %). A paginacao por OFFSET ainda pode repetir e pular casos.',
      v_empates, v_pior;
  end if;

  -- ── (g) 🔴 Os dois portoes calibrados continuam DESLIGADOS ──────────────
  --
  -- C-03 reprovou a regua de valor a menor (55,3% ao centavo, vazamento
  -- liquido NEGATIVO) e F-02 fechou com n = 0. Uma passagem que corrige
  -- agregado e ordem nao tem autoridade nenhuma para abrir acusacao.
  select bool_or(c.acusar_valor_a_menor) into v_acusa
    from public.conciliacao_config c;
  if coalesce(v_acusa, false) then
    raise exception 'acusar_valor_a_menor esta LIGADA — o passo (c) de C-03c ainda nao foi rodado';
  end if;

  select bool_or(c.acusar_frete_a_maior) into v_acusa
    from public.conciliacao_config c;
  if coalesce(v_acusa, false) then
    raise exception 'acusar_frete_a_maior esta LIGADA — F-02 ainda nao mediu a direcao do desvio';
  end if;
end $$;
