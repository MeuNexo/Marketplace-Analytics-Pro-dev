-- ===========================================================================
-- 244-04 — `declarado` passa a somar só o que o Mercado Livre RETÉM
--
-- ── O ACHADO ──────────────────────────────────────────────────────────────
--
-- A CTE `tar` somava TODAS as linhas de `ml_order_sale_fee` em `declarado`, e
-- `residuo_ml = (gross − net) − declarado` é a régua que decide se o repasse
-- fecha. Medido em 05/09/2026 sobre 8.004 pedidos com repasse aprovado:
--
--   grupo                    n       fecha com CFONPN dentro   fecha com ele FORA
--   com parcelamento      2.762                  0                     2.655
--   sem parcelamento      5.242              4.853                     4.853
--
-- ZERO de 2.762. A diferença acumulada era de −R$ 108.802,33.
--
-- ── POR QUE, COM FONTE INDEPENDENTE ───────────────────────────────────────
--
-- O próprio Mercado Livre nomeia a linha: "Taxa de parcelamento (equivalente ao
-- acréscimo no preço pago pelo comprador)". Conferido ao vivo em 12 pedidos
-- sorteados, comparando `CFONPN` contra `total_paid_amount −
-- transaction_amount` do recurso de PEDIDO: 10 de 12 batem ao centavo, de 1 a
-- 12 parcelas.
--
-- O comprador paga o acréscimo, o ML fica com ele, e a linha aparece no nosso
-- extrato como espelho contábil. Não sai do nosso bolso — e somá-la ao que o ML
-- nos cobrou inventava um vazamento de R$ 43.960,50 na janela da tela.
--
-- ⚠️ D-244-09: O QUE SAI É A LINHA DA RÉGUA, NÃO O DADO. Os R$ 108.802 que o
-- comprador pagou a mais pelo nosso produto continuam em `ml_order_sale_fee`,
-- medidos e nomeados no dicionário — e são informação de PRECIFICAÇÃO, não de
-- vazamento de caixa. Esta tela mede o que o Mercado Livre nos cobra; quem tem
-- de olhar o acréscimo do comprador é a régua de preço. Está registrado em
-- `244-ACHADO-PARCELAMENTO.md` em vez de virar uma coluna que esta tela não
-- sabe explicar.
--
-- 🔴 A exceção é NOMEADA e vem do dicionário (`NAO_RETIDOS_DO_REPASSE`), com
-- portão conferindo. Um dia o ML pode emitir cobrança de parcelamento que ele
-- de fato retenha: a pergunta certa continua sendo "sai do nosso bolso?", nunca
-- "é da família parcelamento?".
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.conciliacao_base_linhas(
  p_org_id uuid,
  p_janela_dias integer DEFAULT NULL::integer
)
RETURNS TABLE(
  caso_id uuid, ml_order_id text, tipo_caso text, fila text, acionavel boolean,
  motivo text, estado text, titulo text, sku text, quantidade integer,
  retido_de_fato numeric, cobranca_declarada numeric, residuo_ml numeric,
  esperado_nosso numeric, recebido numeric, residuo_nosso numeric,
  diferenca numeric, data_pedido date, data_evento date, dias_restantes integer,
  n_pagamentos integer, payment_ids text[], release_date_max date,
  valor_estimado boolean, ponta_comprador numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
with cfg as (
  select coalesce(c.piso_materialidade, 5.00)                as piso,
         coalesce(c.dias_aguardando, 15)                     as dias_aguardando,
         coalesce(c.dias_ausente, 22)                        as dias_ausente,
         coalesce(p_janela_dias, c.janela_dias, 30)          as janela,
         coalesce(c.ingestao_inicio, date '2026-01-28')      as ingestao_inicio,
         coalesce(c.acusar_valor_a_menor, false)             as acusar,
         -- 🔴 239-04: a defasagem entre a venda e a emissao da cobranca pelo
         -- Mercado Livre, MEDIDA no CFFE: mediana 1 dia, maximo 18. Ela entra
         -- nomeada porque decide se uma linha sem cobranca e ESPERA NORMAL ou
         -- LACUNA NOSSA — e somar as duas inflaria o diagnostico em ordem de
         -- grandeza. Numero solto no meio da cascata e numero que a proxima
         -- pessoa muda sem saber o que esta mudando.
         18                                                 as dias_defasagem_cffe,
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
   where ci.organization_id = p_org_id and ci.entra_no_caixa
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
     -- 🔴 244-04: SO o que o Mercado Livre RETEM do repasse. `CFONPN` e
     -- `BFONPN` sao o espelho contabil do acrescimo que o COMPRADOR pagou —
     -- o proprio ML os nomeia assim — e nao saem do nosso bolso. Medido:
     -- com eles dentro, `(gross - net) = declarado` fechava em 0 de 2.762
     -- pedidos parcelados; sem eles, 2.655. Diferenca de R$ 108.802,33.
     and f.detail_sub_type not in ('CFONPN','BFONPN')
   group by f.ml_order_id
),
-- ── 🔴 239-05: A PONTA DO COMPRADOR ─────────────────────────────────────────
-- `esperado_nosso` comparava `receita_bruta - declarado` contra um `net` que JA
-- CONTEM o envio pago pelo comprador. Medido em 04/09/2026: as 23 linhas de
-- `divergencia_da_nossa_base` da janela sao 23/23 esta conta faltando — 15 com
-- o envio em pagamento SEPARADO e 8 com ele DENTRO do mesmo pagamento, e nos 8
-- `retido_de_fato = cobranca_declarada` (o ML fecha com ele mesmo). Nenhuma era
-- erro de cadastro, e o rotulo mandava corrigir cadastro certo.
--
-- A fonte e o ENVIO, nao o dinheiro: `gross - receita_bruta = custo_comprador`
-- bateu ao centavo em 15 de 15 dos pedidos com ponta E com captura desde 01/06.
-- Derivar a ponta do proprio `gross` fecharia a conta por construcao e mataria
-- a capacidade da regua de detectar divergencia real.
--
-- 🔴 AUSENCIA DE CAPTURA NAO E PONTA ZERO. `ponta` fica NULA quando o envio nao
-- foi capturado, e a cascata de motivo nomeia a lacuna em vez de acusar — a
-- mesma licao do par recebedor x pagador (225-09) e do `aceite.ts` (225-13).
--
-- ⚠️ `n_pedidos_no_envio > 1` tambem devolve NULO: 5 dos 1.209 envios carregam
-- dois pedidos, e atribuir a ponta inteira a cada um contaria o mesmo dinheiro
-- duas vezes. Ali a resposta honesta e "nao da para atribuir", nao um numero.
env as (
  select sp.ml_order_id,
         f.custo_comprador,
         (f.shipment_id is not null)                            as tem_captura,
         count(*) over (partition by sp.shipment_id)            as n_pedidos_no_envio
    from public.ml_shipment_pedido sp
    left join public.ml_shipment_frete f
           on f.organization_id = p_org_id
          and f.shipment_id     = sp.shipment_id
   where sp.organization_id = p_org_id
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
         case when e.tem_captura and e.n_pedidos_no_envio = 1
                   then coalesce(e.custo_comprador, 0)
              end                                    as ponta_comprador,
         (p.receita_bruta
            + coalesce(case when e.tem_captura and e.n_pedidos_no_envio = 1
                            then coalesce(e.custo_comprador, 0) end, 0)
            - t.declarado)                           as esperado_nosso,
         (p.receita_bruta
            + coalesce(case when e.tem_captura and e.n_pedidos_no_envio = 1
                            then coalesce(e.custo_comprador, 0) end, 0)
            - t.declarado) - r.net                   as residuo_nosso,
         count(p.comprador) over (partition by p.comprador, p.data_pedido) as n_no_grupo
    from pedidos p
    left join rep r on r.ml_order_id = p.ml_order_id
    left join tar t on t.ml_order_id = p.ml_order_id
    -- 1:1: `ml_shipment_pedido` tem chave unica (organization_id, ml_order_id).
    left join env e on e.ml_order_id = p.ml_order_id
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
           -- ── 🔴 239-04: o balde de QUATRO causas, separado ─────────────────
           -- `sem_captura_cobranca` dizia "falta dado nosso" para quatro
           -- situacoes distintas, e TRES delas nao sao lacuna nossa. A ordem
           -- abaixo e conteudo, nao estilo: a espera do ML e decidida PRIMEIRO
           -- porque uma venda de ontem tambem nao tem linha de captura — se a
           -- causa de captura viesse antes, a tela acusaria a nossa base em
           -- cima do relogio do Mercado Livre.
           when x.declarado is null
                and x.data_pedido >= ((select hoje from cfg)
                                      - (select dias_defasagem_cffe from cfg))
                then 'cobranca_nao_emitida_pelo_ml'
           when x.declarado is null and cap.ml_order_id is null
                then 'captura_nunca_tentada'
           when x.declarado is null and cap.status = 'erro'
                then 'captura_com_erro'
           when x.declarado is null and cap.status = 'sem_linha'
                then 'ml_respondeu_sem_cobranca'
           -- ⚠️ SAIDA FINAL, de proposito. Um estado de captura que ninguem
           -- previu (hoje o check admite 'ok', 'parcial', 'sem_linha', 'erro')
           -- cai aqui e aparece FEIO na tela, em vez de escapar da cascata sem
           -- motivo e sumir da contagem.
           when x.declarado is null
                then 'sem_captura_cobranca'
           when x.residuo_ml > (select piso from cfg) and (select acusar from cfg)
                then 'repasse_a_menor_confirmado'
           when x.residuo_ml > (select piso from cfg)
                then 'regua_nao_liberada'
           -- 🔴 239-05: ANTES da acusacao, de proposito. Sem a ponta do
           -- comprador a conta nao pode fechar, e mandar "corrigir cadastro"
           -- e afirmar sem prova — exatamente o que a fase 239 existe para
           -- matar. Com a ponta capturada, o que sobra e divergencia de fato.
           when abs(x.residuo_ml) <= (select piso from cfg)
                and abs(x.residuo_nosso) > (select piso from cfg)
                and x.ponta_comprador is null
                then 'base_sem_ponta_do_comprador'
           when abs(x.residuo_ml) <= (select piso from cfg)
                and abs(x.residuo_nosso) > (select piso from cfg)
                then 'divergencia_da_nossa_base'
           when abs(coalesce(x.residuo_ml, 0)) > 0.005
                then 'abaixo_do_piso'
           else null
         end as motivo
    from cls x
    -- 🔴 239-04: 1:1 pela chave primaria (organization_id, ml_order_id) — nao
    -- multiplica linha. LEFT porque a AUSENCIA de linha e uma das quatro
    -- causas (`captura_nunca_tentada`), nao um pedido que some da tela.
    left join public.ml_order_sale_fee_captura cap
           on cap.organization_id = p_org_id
          and cap.ml_order_id     = x.ml_order_id
    left join public.conciliacao_casos kv
           on kv.organization_id = p_org_id
          and kv.ml_order_id     = x.ml_order_id
          and kv.tipo_caso       = 'repasse_ausente'
),
linhas_pedido as (
  select m.*,
         case when not m.tem_repasse then 'repasse_ausente' else 'repasse_a_menor' end as tipo_calc,
         -- 🔴 239-04: a MESMA expressao que a coluna `acionavel` emite, uma vez
         -- so. O rotulo derivado precisa dela, e recalcula-la no SELECT final
         -- criaria duas reguas para o mesmo numero.
         (m.motivo in ('sem_repasse_confirmado','repasse_a_menor_confirmado')) as acionavel_calc
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
         (o.ml_order_id is null)                     as sem_pedido,
         ci.entra_no_caixa,
         ci.motivo_fora_do_caixa
    from public.cash_inflows ci
    left join public.orders o
           on o.ml_order_id     = ci.ml_order_id
          and o.organization_id = ci.organization_id
   where ci.organization_id = p_org_id
     and ci.release_date >= (select hoje - janela from cfg)
     and (ci.ml_order_id is null or o.ml_order_id is null or ci.entra_no_caixa is false)
),
linhas_entrada as (
  select distinct on (e.payment_id)
         e.payment_id,
         e.ml_order_id,
         e.release_date,
         e.net_amount,
         e.description,
         case
           -- 🔴 225-11: o PRIMEIRO ramo, e por isso ele existe. A compra pessoal
           -- do titular carrega o identificador do pedido do OUTRO vendedor, entao
           -- ela TEM ml_order_id e caia no ramo de baixo — o mesmo balde das vendas
           -- realmente perdidas do G-05, cujo diagnostico ela vinha inflando.
           -- 🔴 A linha NAO some da tela: ela e NOMEADA. D-225-10 exige classificar
           -- toda entrada, e linha que sai da tela vira o buraco que a fase fecha.
           when e.entra_no_caixa is false then e.motivo_fora_do_caixa
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
       -- ── 🔴 239-04 · D-239-01: ROTULO AFIRMATIVO EXIGE PROVA ──────────
       -- `Repasse a menor` e uma afirmacao sobre o que aconteceu com o
       -- dinheiro. Sem as tres linhas do card fechadas — esperado, recebido e
       -- diferenca — a funcao nao sabe de que lado o numero cai, e o rotulo
       -- vira acusacao sem conta. Medido em 04/09: linhas com as tres nulas
       -- ostentando o rotulo afirmativo.
       --
       -- ⚠️ `acionavel` e o PRIMEIRO braco de proposito. `sem_repasse_confirmado`
       -- e `repasse_a_menor_confirmado` tem `recebido` nulo porque o dinheiro
       -- NAO VEIO, verificado no Mercado Pago — ali o nulo E o achado, nao a
       -- lacuna. Forca-los a "em aberto" apagaria caso legitimo.
       --
       -- 🔴 A JUNCAO com `conciliacao_casos` continua no `l.tipo_calc` logo
       -- abaixo: a identidade PERSISTIDA nao muda. O check
       -- `conciliacao_casos_tipo_chk` recusa `repasse_em_aberto`, o que impede
       -- gravar como caso uma linha que nao e caso — e trocar a chave do join
       -- pela coluna derivada orfanaria todo caso ja gravado, em silencio.
       case when l.acionavel_calc
                 or (l.esperado_nosso is not null
                     and l.net           is not null
                     and l.residuo_nosso is not null)
            then l.tipo_calc
            else 'repasse_em_aberto'
       end                                                       as tipo_caso,
       case
         when l.motivo in ('sem_repasse_confirmado','repasse_a_menor_confirmado',
                           'ausencia_a_verificar')                     then 'ml'
         -- 🔴 239-04: das quatro causas novas, so DUAS sao lacuna nossa.
         -- `cobranca_nao_emitida_pelo_ml` e espera do ML (mesma natureza de
         -- `aguardando_liberacao`, que ja cai em 'nenhuma') e
         -- `ml_respondeu_sem_cobranca` e resposta da fonte — nenhuma das duas
         -- e erro que a gente corrige, e po-las em "Nosso erro" seria a
         -- mesma mentira do balde, so que com nome novo.
         when l.motivo in ('fora_da_janela_de_ingestao','sem_captura_cobranca',
                           'divergencia_da_nossa_base','possivel_carrinho',
                           'captura_nunca_tentada','captura_com_erro',
                           'base_sem_ponta_do_comprador')                   then 'nosso'
         else 'nenhuma'
       end                                                       as fila,
       l.acionavel_calc                                          as acionavel,
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
                  when l.motivo in ('divergencia_da_nossa_base',
                                    'base_sem_ponta_do_comprador') then l.residuo_nosso
                  else l.residuo_ml end, 2)                      as diferenca,
       l.data_pedido,
       l.data_evento,
       l.dias_restantes::int,
       l.n_pagamentos,
       l.payment_ids,
       l.release_date_max,
       (l.declarado is null)                                     as valor_estimado,
       -- 🔴 O card PRECISA do numero para provar a linha. Soma que nao aparece
       -- na tela e magica, e magica e o oposto do contrato desta fase.
       round(l.ponta_comprador, 2)                               as ponta_comprador
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
       true                                                      as valor_estimado,
       null::numeric                                             as ponta_comprador
  from linhas_entrada e;
$function$;

REVOKE ALL ON FUNCTION public.conciliacao_base_linhas(uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.conciliacao_base_linhas(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.conciliacao_base_linhas(uuid, integer) TO authenticated;
