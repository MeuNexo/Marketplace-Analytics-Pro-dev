-- ────────────────────────────────────────────────────────────────────────────
-- Fase 225, plano 225-05 (tarefa extra) — a cascata de `estado` que nunca
-- derivava nada.
--
-- As migrations 20260903130000 e 20260903140000 JA ESTAO APLICADAS e nao se
-- editam: o que esta em producao so muda por migration nova.
--
-- 🔴 O QUE ESTA EM JOGO. D-225-13 existe para responder "quanto o ML devolveu
-- de fato, e que tipo de caso ele aceita". A resposta depende de separar duas
-- vitorias que nao sao a mesma coisa:
--
--     `ganho`             = eu contestei e o Mercado Livre me pagou;
--     `resolvido_sozinho` = o dinheiro so chegou atrasado, sem merito nosso.
--
-- Somar as duas inventa uma taxa de sucesso de contestacao que nao existe. O
-- front ja preserva a distincao (a mutacao de desfecho recusa o `upsert` que
-- apagaria `contestado_em`), mas ela morre na ORIGEM se a RPC nunca emitir
-- `resolvido_sozinho`. E ela nunca emitiu.
--
-- 🔴 TRES DEFEITOS COMPOSTOS, medidos em 04/09/2026 lendo o SQL aplicado
-- (20260903140000, linhas 287-292):
--
--   case
--     when k.estado is null                                    then 'aberto'
--     when k.estado = 'aberto' and l.tem_aprovado
--          and l.tipo_calc = 'repasse_ausente'                 then 'resolvido_sozinho'
--     when k.estado = 'aberto' and l.dias_restantes < 0        then 'expirado'
--     else k.estado
--   end
--
-- (1) CURTO-CIRCUITO. O primeiro ramo intercepta todo caso sem linha
--     persistida, e `conciliacao_casos` tem ZERO linha hoje. Na pratica as duas
--     derivacoes eram codigo morto para 100% da janela. Ha linhas com
--     `dias_restantes = -89` medidas em R-09 saindo como "Aberto".
--
-- (2) CONJUNCAO IMPOSSIVEL. `tipo_calc = 'repasse_ausente'` e definido como
--     `not tem_repasse`, e `tem_repasse` e `(r.ml_order_id is not null)` do
--     agregado de `cash_inflows`. Sem linha em `cash_inflows`,
--     `tem_aprovado = coalesce(r.tem_aprovado, false)` e obrigatoriamente
--     FALSO. `tem_aprovado AND tipo_calc = 'repasse_ausente'` nao pode ser
--     verdadeiro em nenhum estado do mundo — nem com o curto-circuito removido.
--     Remover so o ramo (1), como a leitura rapida sugere, consertaria
--     `expirado` e deixaria `resolvido_sozinho` igualmente morto.
--
-- (3) O JOIN PERDE O CASO NO UNICO INSTANTE QUE INTERESSA. `k` casa por
--     `k.tipo_caso = l.tipo_calc`. Quando o repasse chega, `tipo_calc` vira
--     `repasse_a_menor` e o caso persistido como `repasse_ausente` deixa de
--     casar: `k.estado` volta NULO exatamente quando o dinheiro apareceu.
--
-- ⚠️ ESCOPO DELIBERADAMENTE ESTREITO. Nada alem da cascata de `estado` e do
-- lookup que ela precisa muda. A assinatura e as 24 colunas sao as mesmas, e
-- `get_conciliacao_resumo` NAO agrega por `estado` em nenhum dos seus campos
-- (ele filtra por `acionavel`, `motivo`, `fila` e `tipo_caso`; `recuperado_total`
-- le a tabela direto). Logo NENHUM numero de KPI se move com esta migration —
-- o que muda e o rotulo de estado de linhas individuais.
--
-- ⚠️ `CREATE OR REPLACE`, jamais `DROP`: a assinatura nao muda, e apagar a
-- funcao apagaria a ACL junto (feedback_drop_function_apaga_acl). O par
-- revoke/grant e reemitido mesmo assim, com `anon` NOMEADO — revogar de PUBLIC
-- nao desfaz a concessao direta que o default privilege do Supabase grava, e
-- foi exatamente isso que R-08(c) reprovou nesta fase.
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ 0. GUARDA DE DERIVA — antes de substituir, conferir o que esta VIVO ════
--
-- 🔴 `feedback_corpo_vivo_de_rpc_vem_do_banco`: clonar corpo de RPC a partir do
-- repositorio ja REGREDIU producao nesta casa (`get_cashflow`, R$ 30.372,11).
-- O corpo abaixo foi copiado de 20260903140000, que e a ultima definicao no
-- repositorio — mas o repositorio nao e autoridade sobre o que esta no ar. Se
-- alguem corrigiu a funcao direto no banco, substituir por esta versao
-- desfaria a correcao EM SILENCIO. Entao a migration recusa aplicar.

do $$
declare
  v_corpo text;
begin
  select pg_get_functiondef(p.oid) into v_corpo
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'conciliacao_base_linhas';

  if v_corpo is null then
    raise exception 'conciliacao_base_linhas nao existe; aplique 20260903130000 e 20260903140000 antes desta';
  end if;

  -- Marcador 1: o ramo do curto-circuito, que so existe na cascata antiga.
  if position('when k.estado is null' in v_corpo) = 0 then
    raise exception 'o corpo VIVO de conciliacao_base_linhas nao contem a cascata que esta migration substitui: producao divergiu do repositorio, confira antes de aplicar';
  end if;

  -- Marcador 2: o alias `ka` so existe na versao corrigida. Se ja estiver la,
  -- alguem corrigiu direto no banco e esta migration desfaria o conserto.
  if position('ka.tipo_caso' in v_corpo) > 0 then
    raise exception 'o corpo VIVO ja contem o lookup corrigido: alguem consertou direto no banco e esta migration desfaria isso';
  end if;
end $$;

-- ═══ 1. A funcao base, com a cascata corrigida ══════════════════════════════

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
         -- 1. O desfecho REGISTRADO pelo usuario manda sempre, e nunca e
         --    sobrescrito por derivacao. `ka` entra como segunda opcao porque,
         --    no instante em que o repasse chega, `tipo_calc` vira
         --    `repasse_a_menor` e o caso persistido como `repasse_ausente`
         --    deixa de casar em `k`.
         when coalesce(k.estado, ka.estado) in ('contestado', 'ganho', 'negado')
              then coalesce(k.estado, ka.estado)
         -- 2. O repasse CHEGOU depois de um caso de ausencia aberto.
         --    ⚠️ `ka.estado` NULO nao entra de proposito: sem caso persistido
         --    nao houve caso para se resolver sozinho, e uma linha
         --    `abaixo_do_piso` com repasse aprovado viraria falso
         --    `resolvido_sozinho`. Aqui a ausencia de linha e a resposta certa.
         when ka.estado = 'aberto' and l.tem_repasse and l.tem_aprovado
              then 'resolvido_sozinho'
         -- 3. O prazo fechou sem desfecho — SO onde existe prazo de
         --    ressarcimento. A fila "Nosso erro" nao tem janela nenhuma;
         --    marcar correcao de cadastro como "prazo perdido" afirmaria que
         --    um prazo que nunca existiu foi perdido.
         when coalesce(k.estado, 'aberto') = 'aberto'
              and l.motivo in ('sem_repasse_confirmado', 'repasse_a_menor_confirmado',
                               'ausencia_a_verificar')
              and l.dias_restantes < 0
              then 'expirado'
         else coalesce(k.estado, 'aberto')
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
  -- 🔴 Lookup do caso de AUSENCIA por tipo LITERAL, ao lado do join principal.
  -- O join acima casa por `l.tipo_calc`, que muda de `repasse_ausente` para
  -- `repasse_a_menor` exatamente quando o dinheiro aparece — o unico momento em
  -- que `resolvido_sozinho` poderia ser detectado. Mesmo padrao ja em producao
  -- no `kv` da cascata de motivo: 1:1 pela chave unica
  -- (organization_id, ml_order_id, tipo_caso), portanto sem multiplicar linha.
  left join public.conciliacao_casos ka
         on ka.organization_id = p_org_id
        and ka.ml_order_id     = l.ml_order_id
        and ka.tipo_caso       = 'repasse_ausente'
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

-- ═══ 2. A ACL reemitida, com `anon` NOMEADO ═════════════════════════════════
--
-- `CREATE OR REPLACE` preserva a ACL, entao este bloco e redundante por
-- construcao. Ele fica assim mesmo: e barato, e a alternativa e depender de
-- lembrar da regra no dia em que alguem trocar o REPLACE por outra coisa.

revoke all on function public.conciliacao_base_linhas(uuid, int) from public;
revoke all on function public.conciliacao_base_linhas(uuid, int) from anon;
grant execute on function public.conciliacao_base_linhas(uuid, int) to authenticated;

-- ═══ 3. Guarda final: falhar ALTO em vez de aplicar pela metade ═════════════

do $$
declare
  v_anon        boolean;
  v_auth        boolean;
  v_corpo       text;
  v_colunas     text;
  v_org         uuid;
  v_pedido      text;
  v_estado      text;
  v_antes       bigint;
  v_depois      bigint;
begin
  select has_function_privilege('anon', 'public.conciliacao_base_linhas(uuid,int)', 'execute')
    into v_anon;
  select has_function_privilege('authenticated', 'public.conciliacao_base_linhas(uuid,int)', 'execute')
    into v_auth;

  if v_anon then
    raise exception 'anon ainda executa conciliacao_base_linhas; revogar de PUBLIC nao basta nesta base';
  end if;

  if not v_auth then
    raise exception 'authenticated PERDEU execute em conciliacao_base_linhas; a tela quebraria inteira';
  end if;

  select pg_get_functiondef(p.oid) into v_corpo
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'conciliacao_base_linhas';

  -- 🔴 NAO procurar `l.tipo_calc = 'repasse_ausente'` solto aqui. Ele aparece
  -- DUAS vezes no corpo: na cascata (que esta migration remove) e na coluna
  -- `diferenca` (que ela mantem de proposito). Uma guarda ancorada nesse
  -- literal encontra a segunda ocorrencia no corpo que ela mesma acabou de
  -- instalar e acusa falha em qualquer estado do mundo — foi exatamente o que
  -- aconteceu na primeira tentativa de aplicar esta migration.
  -- `feedback_gate_por_invariante_nao_por_literal`: a guarda tem que verificar
  -- o EFEITO, que nao pode ser enganado por onde o literal aparece.

  if position('ka.tipo_caso' in v_corpo) = 0 then
    raise exception 'o lookup do caso de ausencia nao entrou; resolvido_sozinho seguiria morto';
  end if;

  -- O contrato de 24 colunas nao pode ter mudado: a tela le por nome.
  select pg_get_function_result(p.oid) into v_colunas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'conciliacao_base_linhas';

  if v_colunas not like '%valor_estimado%' or v_colunas not like '%dias_restantes%' then
    raise exception 'o contrato de colunas de conciliacao_base_linhas mudou; a tela le por nome';
  end if;

  -- ═══ A INVARIANTE, MEDIDA ═══════════════════════════════════════════════
  --
  -- 🔴 Esta e a unica guarda que prova que a migration fez o que diz. Ela
  -- monta a situacao real: um caso aberto como `repasse_ausente` num pedido
  -- cujo repasse ja chegou e foi aprovado. Se a cascata estiver certa, a linha
  -- volta como `resolvido_sozinho`. Se estiver errada, volta `aberto` — e ai
  -- a migration inteira reverte.
  --
  -- Escolhe um pedido que ainda NAO tem caso persistido, para nao esbarrar na
  -- chave unica nem tocar dado de verdade. A linha de sonda e apagada logo
  -- depois; se algo levantar excecao antes disso, a transacao da migration
  -- desfaz tudo de qualquer jeito.

  select c.organization_id, b.ml_order_id
    into v_org, v_pedido
    from public.conciliacao_config c
    cross join lateral public.conciliacao_base_linhas(c.organization_id, null) b
   where b.tipo_caso    = 'repasse_a_menor'
     and b.recebido     is not null
     and b.ml_order_id  is not null
     and not exists (select 1
                       from public.conciliacao_casos k
                      where k.organization_id = c.organization_id
                        and k.ml_order_id     = b.ml_order_id
                        and k.tipo_caso       = 'repasse_ausente')
   limit 1;

  -- ⚠️ Guarda que passa sem exercitar nada NAO e guarda. Se nao ha candidato,
  -- a invariante fica sem prova e esta migration recusa aplicar em silencio.
  if v_pedido is null then
    raise exception 'a invariante de resolvido_sozinho nao pode ser exercida: nenhum pedido com repasse aprovado disponivel na janela. Guarda vazia nao aprova migration';
  end if;

  select count(*) into v_antes
    from public.conciliacao_base_linhas(v_org, null);

  insert into public.conciliacao_casos (organization_id, ml_order_id, tipo_caso, estado)
  values (v_org, v_pedido, 'repasse_ausente', 'aberto');

  select count(*),
         max(b.estado) filter (where b.ml_order_id = v_pedido
                                 and b.tipo_caso   = 'repasse_a_menor')
    into v_depois, v_estado
    from public.conciliacao_base_linhas(v_org, null) b;

  delete from public.conciliacao_casos
   where organization_id = v_org
     and ml_order_id     = v_pedido
     and tipo_caso       = 'repasse_ausente';

  if v_estado is distinct from 'resolvido_sozinho' then
    raise exception 'INVARIANTE REPROVADA: caso de ausencia aberto, com repasse aprovado chegado depois, saiu como "%" no pedido % — deveria ser resolvido_sozinho', coalesce(v_estado, 'linha ausente'), v_pedido;
  end if;

  -- O lookup `ka` e 1:1 pela chave unica, mas isso e argumento, nao medida.
  if v_depois <> v_antes then
    raise exception 'FAN-OUT: o lookup do caso de ausencia multiplicou linhas, de % para %', v_antes, v_depois;
  end if;
end $$;
