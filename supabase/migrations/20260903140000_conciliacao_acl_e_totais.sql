-- ────────────────────────────────────────────────────────────────────────────
-- Fase 225, plano 225-02, Task 3 — as duas correcoes que a prova em producao
-- obrigou. A migration 20260903130000 JA ESTA APLICADA e nao se edita: o que
-- esta em producao so muda por migration nova.
--
-- 🔴 CORRECAO 1 — R-08(c) REPROVOU: `anon` tinha EXECUTE nas tres funcoes.
--
-- `revoke all on function ... from public` revoga do pseudo-papel PUBLIC, mas
-- NAO desfaz a concessao DIRETA a `anon` que o default privilege do Supabase
-- grava em toda funcao nova do schema `public`. Medido ao vivo:
--   proacl = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,...}
--   has_function_privilege('anon', 'public.get_casos_conciliacao(...)') = TRUE
--
-- ⚠️ NENHUM DADO VAZOU, e a razao importa: o `revoke all ... from anon` das
-- TABELAS (secao 3 da migration anterior) segurou. `anon` conseguia INVOCAR e
-- morria em `42501: permission denied for table conciliacao_casos`. Defesa em
-- profundidade funcionando NAO e desculpa para deixar a porta destrancada — e
-- e o MESMO padrao que a casa ja carrega em aberto desde a Fase 215 (`anon`
-- com INSERT/UPDATE/DELETE em `ml_tokens`). A licao: nesta base, revogar de
-- PUBLIC nunca basta; `anon` precisa ser nomeado.
--
-- 🔴 CORRECAO 2 — o teto de 1000 do PostgREST esta sendo ATINGIDO HOJE.
--
-- `get_casos_conciliacao` devolve 1.351 linhas em 30 dias e 1.921 em 75. O teto
-- corta em 1.000, EM SILENCIO. Isso nao e risco futuro: foi ele que fez R-09(c)
-- voltar vazio e parecer que o portao nao tinha caso para julgar, e foi ele que
-- escondeu 351 linhas de R-01. E a armadilha de `feedback_postgrest_pagination`
-- mordendo esta fase.
--
-- O teto FICA (o PostgREST trunca de qualquer jeito; abaixa-lo so esconde o
-- problema mais cedo). O que muda e que ele passa a ser DETECTAVEL: o resumo
-- devolve `linhas_total`, contado SEM teto pela funcao base. A tela do plano 03
-- compara o que recebeu com esse total e diz "mostrando 200 de 1.351" — e pagina
-- com `p_offset` / `.range()`. Uma tela que mostra 1.000 e deixa o usuario achar
-- que sao todos reprova D-225-16 direto: o caso da linha 1.001 nunca e olhado.
--
-- 🔴 CORRECAO 3 — dois numeros do resumo estavam MENTINDO por arredondamento
-- de ausencia. R-01 devolveu `nosso_erro_soma = 0.00` sobre 52 linhas e
-- `fora_escopo_soma = 0` sobre 10. Nenhum dos dois e zero: e NULO. As linhas de
-- `sem_captura_cobranca` e de `fora_do_escopo` nao tem valor mensuravel (falta a
-- cobranca capturada; a mediacao nao tem pagamento aprovado), e o `coalesce(...,0)`
-- transformava "nao sei" em "zero". Na tela isso lê "o nosso erro custa R$ 0,00",
-- que e exatamente o que `feedback_ausencia_diz_o_motivo_real` proibe.
-- Agora esses campos vem NULOS quando nao ha nada a somar, e
-- `valor_desconhecido_n` conta quantas linhas nao tem valor.
--
-- 🔴 CORRECAO 4 — `divergencia_da_nossa_base` exibia a diferenca ERRADA.
-- R-05 mostrou 8 linhas somando R$ 0,00. O motivo so dispara quando
-- `|residuo_ml| <= piso`, entao usar `residuo_ml` como `diferenca` mostra
-- justamente o numero pequeno. A grandeza que interessa nessa fila e
-- `residuo_nosso` — e o tamanho do erro que e NOSSO (D-225-07).
--
-- ⚠️ `get_conciliacao_resumo` muda de assinatura, entao precisa de DROP + CREATE.
-- DROP FUNCTION APAGA A ACL (feedback_drop_function_apaga_acl): o par
-- revoke/grant e reemitido ao fim deste arquivo, para as tres funcoes.
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ 1. A ACL: `anon` nomeado explicitamente ════════════════════════════════

revoke all on function public.conciliacao_base_linhas(uuid, int) from anon;
revoke all on function public.get_casos_conciliacao(uuid, int, boolean, int, int) from anon;
revoke all on function public.get_conciliacao_resumo(uuid, int) from anon;

-- ═══ 2. A funcao base: a diferenca certa para a fila "nosso" ════════════════
--
-- Mesma assinatura, mesmo contrato de 24 colunas — CREATE OR REPLACE basta e a
-- ACL sobrevive. A unica mudanca de comportamento esta na coluna `diferenca`.

create or replace function public.conciliacao_base_linhas(
  p_org_id       uuid,
  p_janela_dias  int default null
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
with cfg as (
  select coalesce(c.piso_materialidade, 5.00)                as piso,
         coalesce(c.dias_aguardando, 15)                     as dias_aguardando,
         coalesce(c.dias_ausente, 22)                        as dias_ausente,
         coalesce(p_janela_dias, c.janela_dias, 30)          as janela,
         coalesce(c.ingestao_inicio, date '2026-01-28')      as ingestao_inicio,
         coalesce(c.acusar_valor_a_menor, false)             as acusar,
         (now() at time zone 'America/Sao_Paulo')::date      as hoje
    from (select 1) z
    left join public.conciliacao_config c on c.organization_id = p_org_id
),
pedidos as (
  select o.ml_order_id,
         max(o.titulo)                        as titulo,
         max(o.sku)                           as sku,
         sum(o.quantidade)::int               as quantidade,
         sum(o.receita_bruta)                 as receita_bruta,
         max(o.comprador)                     as comprador,
         (left(min(o.data_pedido), 10))::date as data_pedido,
         -- 🔴 `data_pagamento` e COLUNA MORTA (100% NULL, C-06): nunca num WHERE.
         coalesce((left(max(o.data_pagamento), 10))::date,
                  (left(min(o.data_pedido), 10))::date) as data_evento_venda
    from public.orders o
   where o.organization_id = p_org_id
     and o.status in ('paid','shipped','delivered')
     and o.data_pedido >= to_char((select hoje - (janela + 45) from cfg), 'YYYY-MM-DD')
     and o.data_pedido <  to_char((select hoje + 1 from cfg), 'YYYY-MM-DD')
   group by o.ml_order_id
),
-- 🔴 GROUP BY, NUNCA join 1:1. Provado em producao por R-04: o pedido
-- 2000017188643228 tem DOIS pagamentos aprovados e a soma saiu 56,58 (nao 28,29
-- nem um dos dois isolado), residuo zero, e ele NAO virou caso falso.
rep as (
  select ci.ml_order_id,
         sum(ci.gross_amount) filter (where ci.status_mp = 'approved') as gross,
         sum(ci.net_amount)   filter (where ci.status_mp = 'approved') as net,
         count(*)::int                                                 as n_pagamentos,
         array_agg(ci.payment_id order by ci.release_date)             as payment_ids,
         max(ci.release_date)::date                                    as release_date_max,
         bool_or(ci.status_mp = 'in_mediation')                        as tem_mediacao,
         bool_or(ci.status_mp = 'approved')                            as tem_aprovado
    from public.cash_inflows ci
   where ci.organization_id = p_org_id
     and ci.ml_order_id is not null
   group by ci.ml_order_id
),
-- 🔴 O netting de C-02, inalterado: o BONUS repete o valor exato do CHARGE que
-- aponta, entao somar direto declararia cobranca que nao existe.
tar as (
  select f.ml_order_id,
         sum(case when f.detail_type = 'BONUS' or f.charge_bonified_id is not null
                  then -f.detail_amount
                  else  f.detail_amount
             end) as declarado
    from public.ml_order_sale_fee f
   where f.organization_id = p_org_id
   group by f.ml_order_id
),
calc as (
  select p.ml_order_id,
         p.titulo, p.sku, p.quantidade, p.receita_bruta, p.data_pedido, p.data_evento_venda,
         r.gross, r.net,
         coalesce(r.n_pagamentos, 0)                 as n_pagamentos,
         r.payment_ids,
         r.release_date_max,
         coalesce(r.tem_mediacao, false)             as tem_mediacao,
         coalesce(r.tem_aprovado, false)             as tem_aprovado,
         (r.ml_order_id is not null)                 as tem_repasse,
         t.declarado,
         (r.gross - r.net)                           as retido,
         (r.gross - r.net) - t.declarado             as residuo_ml,
         (p.receita_bruta - t.declarado)             as esperado_nosso,
         (p.receita_bruta - t.declarado) - r.net     as residuo_nosso,
         count(p.comprador) over (partition by p.comprador, p.data_pedido) as n_no_grupo
    from pedidos p
    left join rep r on r.ml_order_id = p.ml_order_id
    left join tar t on t.ml_order_id = p.ml_order_id
),
ev as (
  select c.*,
         case when not c.tem_repasse then c.data_evento_venda
              else coalesce(c.release_date_max, c.data_evento_venda) end as data_evento
    from calc c
),
cls as (
  select e.*,
         ((select hoje from cfg) - e.data_evento)        as dias_desde,
         (30 - ((select hoje from cfg) - e.data_evento)) as dias_restantes
    from ev e
),
mot as (
  select x.*,
         case
           when x.data_evento < (select ingestao_inicio from cfg)
                then 'fora_da_janela_de_ingestao'
           when x.tem_mediacao
                then 'fora_do_escopo'
           when not x.tem_repasse and x.n_no_grupo > 1
                then 'possivel_carrinho'
           when not x.tem_repasse and x.dias_desde < (select dias_ausente from cfg)
                then 'aguardando_liberacao'
           when not x.tem_repasse and coalesce(kv.verificado_no_mp, false)
                and kv.status_mp_verificado in ('charged_back','cancelled','refunded')
                then 'fora_do_escopo'
           when not x.tem_repasse and coalesce(kv.verificado_no_mp, false)
                then 'sem_repasse_confirmado'
           -- 🔴 Provado nos dois sentidos por R-09: sem verificacao registrada a
           -- ausencia NAO acusa; com verificacao `approved` ela vira acionavel,
           -- com `charged_back` ela sai da fila para o rodape.
           when not x.tem_repasse
                then 'ausencia_a_verificar'
           when x.tem_aprovado and x.release_date_max > (select hoje from cfg)
                then 'aguardando_liberacao'
           when x.declarado is null
                then 'sem_captura_cobranca'
           when x.residuo_ml > (select piso from cfg) and (select acusar from cfg)
                then 'repasse_a_menor_confirmado'
           when x.residuo_ml > (select piso from cfg)
                then 'regua_nao_liberada'
           when abs(x.residuo_ml) <= (select piso from cfg)
                and abs(x.residuo_nosso) > (select piso from cfg)
                then 'divergencia_da_nossa_base'
           when abs(coalesce(x.residuo_ml, 0)) > 0.005
                then 'abaixo_do_piso'
           else null
         end as motivo
    from cls x
    left join public.conciliacao_casos kv
           on kv.organization_id = p_org_id
          and kv.ml_order_id     = x.ml_order_id
          and kv.tipo_caso       = 'repasse_ausente'
),
linhas_pedido as (
  select m.*,
         case when not m.tem_repasse then 'repasse_ausente' else 'repasse_a_menor' end as tipo_calc
    from mot m
   where m.motivo is not null
),
entradas as (
  select ci.id                                       as origem_id,
         ci.ml_order_id,
         ci.payment_id,
         ci.release_date::date                       as release_date,
         ci.net_amount,
         ci.description,
         (ci.gross_amount is not distinct from ci.net_amount) as sem_tarifa,
         (o.ml_order_id is null)                     as sem_pedido
    from public.cash_inflows ci
    left join public.orders o
           on o.ml_order_id     = ci.ml_order_id
          and o.organization_id = ci.organization_id
   where ci.organization_id = p_org_id
     and ci.release_date >= (select hoje - janela from cfg)
     and (ci.ml_order_id is null or o.ml_order_id is null)
),
linhas_entrada as (
  select distinct on (e.payment_id)
         e.payment_id,
         e.ml_order_id,
         e.release_date,
         e.net_amount,
         e.description,
         case
           when e.description = 'marketplace_shipment' then 'repasse_de_frete'
           when e.ml_order_id is not null              then 'pedido_nao_ingerido'
           when e.sem_tarifa                           then 'entrada_fora_do_marketplace'
           else 'venda_sem_chave'
         end as motivo
    from entradas e
   order by e.payment_id, e.release_date
)
select k.id                                                      as caso_id,
       l.ml_order_id,
       l.tipo_calc                                               as tipo_caso,
       case
         when l.motivo in ('sem_repasse_confirmado','repasse_a_menor_confirmado',
                           'ausencia_a_verificar')                     then 'ml'
         when l.motivo in ('fora_da_janela_de_ingestao','sem_captura_cobranca',
                           'divergencia_da_nossa_base','possivel_carrinho') then 'nosso'
         else 'nenhuma'
       end                                                       as fila,
       (l.motivo in ('sem_repasse_confirmado','repasse_a_menor_confirmado')) as acionavel,
       l.motivo,
       case
         when k.estado is null                                                          then 'aberto'
         when k.estado = 'aberto' and l.tem_aprovado and l.tipo_calc = 'repasse_ausente' then 'resolvido_sozinho'
         when k.estado = 'aberto' and l.dias_restantes < 0                               then 'expirado'
         else k.estado
       end                                                       as estado,
       l.titulo,
       l.sku,
       l.quantidade,
       round(l.retido, 2)                                        as retido_de_fato,
       round(l.declarado, 2)                                     as cobranca_declarada,
       round(l.residuo_ml, 2)                                    as residuo_ml,
       round(l.esperado_nosso, 2)                                as esperado_nosso,
       round(l.net, 2)                                           as recebido,
       round(l.residuo_nosso, 2)                                 as residuo_nosso,
       -- 🔴 CORRECAO 4. `divergencia_da_nossa_base` so dispara quando
       -- |residuo_ml| <= piso, entao exibir residuo_ml ali mostrava justamente o
       -- numero pequeno: R-05 devolveu 8 linhas somando R$ 0,00. A grandeza da
       -- fila "nosso" e `residuo_nosso` — o tamanho do erro que e NOSSO.
       round(case when l.tipo_calc = 'repasse_ausente'            then l.receita_bruta
                  when l.motivo = 'divergencia_da_nossa_base'     then l.residuo_nosso
                  else l.residuo_ml end, 2)                      as diferenca,
       l.data_pedido,
       l.data_evento,
       l.dias_restantes::int,
       l.n_pagamentos,
       l.payment_ids,
       l.release_date_max,
       (l.declarado is null)                                     as valor_estimado
  from linhas_pedido l
  left join public.conciliacao_casos k
         on k.organization_id = p_org_id
        and k.ml_order_id     = l.ml_order_id
        and k.tipo_caso       = l.tipo_calc
union all
select null::uuid                                                as caso_id,
       coalesce(e.ml_order_id, e.payment_id)                     as ml_order_id,
       'entrada_sem_origem'                                      as tipo_caso,
       'nosso'                                                   as fila,
       false                                                     as acionavel,
       e.motivo,
       'aberto'                                                  as estado,
       coalesce(e.description, 'Origem desconhecida')            as titulo,
       null::text                                                as sku,
       null::int                                                 as quantidade,
       null::numeric                                             as retido_de_fato,
       null::numeric                                             as cobranca_declarada,
       null::numeric                                             as residuo_ml,
       null::numeric                                             as esperado_nosso,
       round(e.net_amount, 2)                                    as recebido,
       null::numeric                                             as residuo_nosso,
       round(e.net_amount, 2)                                    as diferenca,
       null::date                                                as data_pedido,
       e.release_date                                            as data_evento,
       (30 - ((select hoje from cfg) - e.release_date))::int      as dias_restantes,
       1                                                         as n_pagamentos,
       array[e.payment_id]                                       as payment_ids,
       e.release_date                                            as release_date_max,
       true                                                      as valor_estimado
  from linhas_entrada e;
$$;

-- ═══ 3. O resumo: o total sem teto e o fim do zero que mentia ═══════════════

drop function if exists public.get_conciliacao_resumo(uuid, int);

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
b as (select * from public.conciliacao_base_linhas(p_org_id, p_janela_dias))
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
  '225-02: uma linha com o resumo do monitor. Devolve a REGUA junto dos numeros — piso, cortes '
  'de dias, inicio da ingestao e o estado de acusar_valor_a_menor — para que a tela diga qual '
  'regra esta valendo sem repetir o numero em codigo. 🔴 `linhas_total` e `teto_da_lista` '
  'existem porque a lista TRUNCA: medido em producao, 1.351 linhas em 30 dias contra teto de '
  '1.000. A tela e obrigada a comparar os dois e paginar. 🔴 `nosso_erro_soma` e '
  '`fora_escopo_soma` vem NULOS quando nao ha valor mensuravel, nunca zero: zero e uma '
  'afirmacao, nulo e a ausencia dela. `valor_desconhecido_n` conta essas linhas.';

-- ═══ 4. Grants reemitidos — DROP FUNCTION apagou a ACL do resumo ════════════

revoke all on function public.conciliacao_base_linhas(uuid, int) from public;
revoke all on function public.conciliacao_base_linhas(uuid, int) from anon;
grant execute on function public.conciliacao_base_linhas(uuid, int) to authenticated;

revoke all on function public.get_casos_conciliacao(uuid, int, boolean, int, int) from public;
revoke all on function public.get_casos_conciliacao(uuid, int, boolean, int, int) from anon;
grant execute on function public.get_casos_conciliacao(uuid, int, boolean, int, int) to authenticated;

revoke all on function public.get_conciliacao_resumo(uuid, int) from public;
revoke all on function public.get_conciliacao_resumo(uuid, int) from anon;
grant execute on function public.get_conciliacao_resumo(uuid, int) to authenticated;

-- ═══ 5. Guardas — a correcao falha alto se nao pegar ════════════════════════

do $$
declare
  v_funcao   text;
  v_anon     boolean;
  v_auth     boolean;
  v_assinatura text;
begin
  foreach v_funcao in array array[
    'public.conciliacao_base_linhas(uuid,int)',
    'public.get_casos_conciliacao(uuid,int,boolean,int,int)',
    'public.get_conciliacao_resumo(uuid,int)'
  ]
  loop
    select has_function_privilege('anon', v_funcao, 'execute')          into v_anon;
    select has_function_privilege('authenticated', v_funcao, 'execute') into v_auth;

    if v_anon then
      raise exception 'anon ainda executa % — revogar de PUBLIC nao basta nesta base', v_funcao;
    end if;

    if not v_auth then
      raise exception 'authenticated PERDEU execute em % — o DROP apagou a ACL e o grant nao foi reemitido', v_funcao;
    end if;
  end loop;

  -- O resumo precisa ter ganhado os tres campos novos, senao a tela continua
  -- sem como saber que a lista truncou.
  select pg_get_function_result(p.oid) into v_assinatura
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_conciliacao_resumo';

  if v_assinatura not like '%linhas_total%'
     or v_assinatura not like '%teto_da_lista%'
     or v_assinatura not like '%valor_desconhecido_n%' then
    raise exception 'get_conciliacao_resumo nao devolve os campos de truncamento/ausencia';
  end if;

  -- A configuracao semeada na Parada 2 tem que ter sobrevivido.
  if not exists (select 1 from public.conciliacao_config) then
    raise exception 'conciliacao_config ficou vazia — a semeadura da Parada 2 se perdeu';
  end if;
end $$;
