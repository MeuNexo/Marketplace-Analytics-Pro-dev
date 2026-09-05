-- 241-01 — a familia de frete tem QUATRO cobrancas, e a regua conhecia tres
--
-- 🔴 ACHADO PELO WESLEY em 05/09/2026, comparando a tela com o app do ML no
-- pedido `2000017810721990`. O extrato mostra "Envios -R$ 68,65" e o card do
-- Protetor do Caixa dizia:
--
--   "Nao ha linha de cobranca de frete para este pedido. Pode ser frete gratis
--    ou lacuna da nossa captura"
--
-- A linha ESTAVA na nossa base — `CHARGE/CFFI`, R$ 68,65, detail_id
-- 68716456691 — e o `esperado_nosso` do proprio card ja exibia R$ 68,65. O que
-- faltava era `CFFI` na lista de subtipos de frete da RPC.
--
-- Os significados vieram do PROPRIO ML (campo `transaction_detail`), nao de
-- suposicao sobre as siglas:
--   CFFE  Tarifa de envio extra ou intermunicipal
--   CFFI  Tarifa por envio interno ao municipio        <- FALTAVA
--   CXDE  Tarifa de envio extra ou intermunicipal (variante)
--   CXDED Tarifa de devolucao por envio externo ou intermunicipal
--   BFFE / BXDE / BXDED  os cancelamentos correspondentes
--
-- Medido na base da Pe Vermeio: CFFI em 19 pedidos (R$ 640,15), CXDE em 42
-- (R$ 792,10), CXDED em 5 (R$ 322,04).
--
-- ⚠️ O netting so tinha `BFFE`. `BXDE` e `BXDED` entram agora: sem eles, um
-- frete de devolucao integralmente estornado seguia contando como cobranca.
--
-- 🔴 CREATE OR REPLACE, sem DROP: a assinatura NAO muda, entao a ACL fica
-- intacta e nao ha o que regravar (ao contrario da 239-05).

CREATE OR REPLACE FUNCTION public.conciliacao_frete_linhas(p_org_id uuid, p_janela_dias integer DEFAULT NULL::integer)
 RETURNS TABLE(caso_id uuid, ml_order_id text, tipo_caso text, fila text, acionavel boolean, motivo text, estado text, titulo text, sku text, quantidade integer, retido_de_fato numeric, cobranca_declarada numeric, residuo_ml numeric, esperado_nosso numeric, recebido numeric, residuo_nosso numeric, diferenca numeric, data_pedido date, data_evento date, dias_restantes integer, n_pagamentos integer, payment_ids text[], release_date_max date, valor_estimado boolean, ponta_comprador numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with cfg as (
  select coalesce(c.piso_materialidade, 5.00)            as piso,
         coalesce(p_janela_dias, c.janela_dias, 30)      as janela,
         coalesce(c.acusar_frete_a_maior, false)         as acusar_frete,
         (now() at time zone 'America/Sao_Paulo')::date  as hoje,
         -- 🔴 A DEFASAGEM MAXIMA MEDIDA DO `CFFE`, nao um numero escolhido:
         -- no censo do 239-01, a mediana entre a venda e a emissao da linha de
         -- cobranca foi 1 dia e o MAXIMO foi 18. Venda mais nova que isso sem
         -- linha e ESPERA NORMAL do Mercado Livre; mais velha e pergunta em
         -- aberto nossa. Somar as duas transforma espera em defeito — foi
         -- assim que 244 linhas viraram um numero so, sendo 225 delas espera.
         18                                             as defasagem_max_cffe
    from (select 1) z
    left join public.conciliacao_config c on c.organization_id = p_org_id
),
pedidos as (
  select o.ml_order_id,
         max(o.titulo)                         as titulo,
         max(o.sku)                            as sku,
         sum(o.quantidade)::int                as quantidade,
         (left(min(o.data_pedido), 10))::date  as data_pedido
    from public.orders o
   where o.organization_id = p_org_id
     and o.status in ('paid','shipped','delivered')
     and o.data_pedido >= to_char((select hoje - janela from cfg), 'YYYY-MM-DD')
     and o.data_pedido <  to_char((select hoje + 1 from cfg),      'YYYY-MM-DD')
   group by o.ml_order_id
),
-- 🔴 A FONTE DO ESPERADO. `list_cost` e `custo_vendedor` sao do recurso de
-- ENVIO, congelados na data da venda (239-02). O `left join` duplo e
-- deliberado: pedido sem par pedido->envio e envio sem opcao publicada sao
-- causas DIFERENTES e a cascata precisa distingui-las. Ausencia viaja como
-- ausencia — nunca `coalesce(..., 0)`, que exibiria regua de zero.
envio as (
  select p.ml_order_id,
         p.titulo,
         p.sku,
         p.quantidade,
         p.data_pedido,
         sp.shipment_id,
         sf.list_cost,
         sf.custo_vendedor
    from pedidos p
    left join public.ml_shipment_pedido sp
           on sp.organization_id = p_org_id
          and sp.ml_order_id     = p.ml_order_id
    left join public.ml_shipment_frete sf
           on sf.organization_id = p_org_id
          and sf.shipment_id     = sp.shipment_id
),
-- 🔴 A APURACAO E POR PACOTE, E O PACOTE AGORA E FATO. Ate a v2 o carrinho era
-- adivinhado por heuristica (mesmo comprador, mesmo dia) e N pedidos viravam N
-- nao-casos. O envio diz quem divide frete com quem, entao a comparacao sai
-- UMA vez, no pedido canonico, e os demais apontam para ele.
--
-- ⚠️ O lider e escolhido DENTRO DA JANELA, entre os pedidos que esta consulta
-- devolve — se o lider ficasse fora do recorte, o card apontaria para um
-- pedido que a tela nao mostra.
--
-- ⚠️ A ordenacao e `(length, id)`, nao `min(id)` cru: `ml_order_id` e TEXT, e
-- se dois pedidos do mesmo envio tivessem numeros de comprimentos diferentes a
-- ordem lexicografica escolheria outro lider que a numerica. Com comprimentos
-- iguais as duas coincidem — isto e uma trava contra o dia em que nao
-- coincidirem, nao uma correcao de defeito observado.
lider as (
  select e.shipment_id,
         (array_agg(e.ml_order_id order by length(e.ml_order_id), e.ml_order_id))[1]
                            as ml_order_lider,
         count(*)::int      as n_no_envio
    from envio e
   where e.shipment_id is not null
   group by e.shipment_id
),
-- A cobranca de frete e LIQUIDA DO ESTORNO e agregada por ENVIO: as linhas de
-- TODOS os pedidos do pacote somam no mesmo lugar em que o custo foi cotado.
-- A expressao de netting e a de C-02, intacta: o BONUS repete o valor EXATO do
-- CHARGE que aponta (51,29 / 0,37 / 28,35 no pedido 2000017811575194), entao
-- somar direto declara cobranca em dobro onde o liquido e zero. `n_frete`
-- conta so as linhas de COBRANCA, para que um pedido cujo frete foi
-- integralmente estornado nao seja lido como "nunca teve frete".
frete_cobrado as (
  select sp.shipment_id,
         sum(case when f.detail_type = 'BONUS' or f.charge_bonified_id is not null
                  then -f.detail_amount
                  else  f.detail_amount
             -- 🔴 241-01: A FAMILIA DE FRETE TEM QUATRO COBRANCAS, NAO TRES.
             -- `CFFI` — "Tarifa por envio interno ao municipio" — estava FORA
             -- da lista, e com ela o card dizia "Nao ha linha de cobranca de
             -- frete para este pedido" sobre pedido cujo extrato do ML mostra
             -- "Envios -R$ 68,65". Achado pelo Wesley em 05/09/2026 no pedido
             -- 2000017810721990, comparando a tela com o app do ML.
             --
             -- Os nomes vieram do proprio ML (`transaction_detail`), nao de
             -- suposicao: CFFE = envio extra ou intermunicipal · CFFI = envio
             -- interno ao municipio · CXDE = envio extra/intermunicipal
             -- (variante) · CXDED = devolucao por envio externo.
             --
             -- ⚠️ E o netting ganhou os DOIS bonus que faltavam: `BXDE` e
             -- `BXDED` cancelam CXDE e CXDED. Com so `BFFE` na lista, um frete
             -- de devolucao integralmente estornado seguia contando como
             -- cobranca.
             end) filter (where f.detail_sub_type
                            in ('CFFE','CFFI','CXDE','CXDED','BFFE','BXDE','BXDED')) as cobrado,
         count(*) filter (where f.detail_sub_type
                            in ('CFFE','CFFI','CXDE','CXDED'))::int                  as n_frete
    from public.ml_order_sale_fee f
    join public.ml_shipment_pedido sp
      on sp.organization_id = f.organization_id
     and sp.ml_order_id     = f.ml_order_id
   where f.organization_id = p_org_id
   group by sp.shipment_id
),
calc as (
  select e.ml_order_id,
         e.titulo,
         e.sku,
         e.quantidade,
         e.data_pedido,
         e.shipment_id,
         e.list_cost,
         e.custo_vendedor,
         l.ml_order_lider,
         coalesce(l.n_no_envio, 1)                                    as n_no_envio,
         (l.ml_order_lider is not distinct from e.ml_order_id)        as e_lider,
         fc.cobrado,
         coalesce(fc.n_frete, 0)                                      as n_frete,
         -- 🔴 A diferenca so existe no pedido CANONICO do envio. No nao-lider
         -- ela e nula de proposito: repeti-la faria a mesma cobranca aparecer N
         -- vezes e qualquer soma da tela contaria o pacote N vezes.
         case when e.list_cost is not null
               and coalesce(fc.n_frete, 0) > 0
               and l.ml_order_lider is not distinct from e.ml_order_id
              then round((fc.cobrado - e.list_cost)::numeric, 2)
         end                                                          as dif
    from envio e
    left join lider         l  on l.shipment_id  = e.shipment_id
    left join frete_cobrado fc on fc.shipment_id = e.shipment_id
),
mot as (
  select c.*,
         (30 - ((select hoje from cfg) - c.data_pedido))::int as dias_restantes,
         case
           -- 1) lacuna NOSSA, nomeada: sem o par pedido->envio nao ha o que
           --    consultar. Nao pode sair como "sem cobranca": a cobranca pode
           --    existir e nos e que nao sabemos em qual envio procurar.
           when c.shipment_id is null                 then 'frete_sem_envio_capturado'
           -- 2) ausencia DA FONTE: o ML nao publicou a opcao daquele envio.
           --    Sem `list_cost` nao existe esperado, e somar zero seria inventar.
           when c.list_cost is null                   then 'frete_sem_opcao_no_envio'
           -- 3) carrinho, agora por FATO: a conta sai no lider do envio.
           when not c.e_lider                         then 'frete_apurado_no_pacote'
           -- 4) espera NORMAL do ML: venda dentro da defasagem maxima medida.
           when c.n_frete = 0
            and c.data_pedido >= (select hoje - defasagem_max_cffe from cfg)
                                                      then 'frete_cobranca_nao_emitida'
           -- 5) venda velha e sem linha: frete gratis ou lacuna da captura —
           --    nao presumimos zero em nenhum dos dois casos.
           when c.n_frete = 0                         then 'frete_sem_cobranca_registrada'
           when abs(c.dif) <= (select piso from cfg)  then 'frete_abaixo_do_piso'
           -- 🔴 o lado que NAO acusa, e sem ele "sempre a mais" seria
           --    irrefutavel por construcao do recorte.
           when c.dif < 0                             then 'frete_a_menor_medido'
           when (select acusar_frete from cfg)        then 'frete_a_maior_confirmado'
           else                                            'regua_frete_nao_liberada'
         end as motivo
    from calc c
)
select k.id                                                as caso_id,
       m.ml_order_id,
       -- 🔴 D-239-01: o tipo e DERIVADO, nao constante. Rotulo que afirma o
       -- desfecho ("cobrado acima do publicado") exige a diferenca calculada;
       -- sem ela a linha nao sabe de que lado o numero cai — nem se cai.
       case when m.dif is null then 'frete_em_aberto'
            else                    'frete_a_maior'
       end                                                 as tipo_caso,
       case
         when m.motivo = 'frete_a_maior_confirmado'                    then 'ml'
         -- So o que e lacuna NOSSA entra na fila "nosso erro". A espera do ML
         -- e a opcao que o ML nao publicou nao sao trabalho nosso e nao podem
         -- inflar essa fila.
         when m.motivo in ('frete_sem_envio_capturado',
                           'frete_sem_cobranca_registrada')            then 'nosso'
         else 'nenhuma'
       end                                                 as fila,
       (m.motivo = 'frete_a_maior_confirmado')             as acionavel,
       m.motivo,
       case
         when k.estado is null                             then 'aberto'
         when k.estado = 'aberto' and m.dias_restantes < 0 then 'expirado'
         else k.estado
       end                                                 as estado,
       -- O card do nao-lider aponta para onde a conta ESTA, em vez de ser um
       -- nao-caso mudo.
       case when m.motivo = 'frete_apurado_no_pacote'
            then 'Apurado no pedido ' || m.ml_order_lider || ' · ' || coalesce(m.titulo, '')
            else m.titulo
       end                                                 as titulo,
       m.sku,
       m.quantidade,
       -- 🔴 A SEGUNDA FONTE INDEPENDENTE, que na v2 era nula em 1.214 de 1.214
       -- com o motivo escrito: `custo_vendedor` vem do recurso de ENVIO e nao
       -- do Mercado Pago. Com ela o bloco fecha: as duas leituras sao do
       -- proprio Mercado Livre, e `custo_vendedor + custo_comprador =
       -- list_cost` ao centavo em 1.209 de 1.209 (239-02).
       round(m.custo_vendedor, 2)                          as retido_de_fato,
       -- ⚠️ Cobranca do PACOTE aparece UMA vez, no lider. No nao-lider ela sai
       -- ausente com o motivo dizendo onde esta — repetida, qualquer soma da
       -- tela contaria o mesmo dinheiro N vezes.
       case when m.e_lider then round(m.cobrado, 2) end    as cobranca_declarada,
       m.dif                                               as residuo_ml,
       round(m.list_cost, 2)                               as esperado_nosso,
       -- Mesma expressao de `cobranca_declarada` de proposito: um segundo
       -- calculo aqui seria uma segunda regua para o mesmo numero, que foi como
       -- o saldo quebrou na fase 233.
       -- ⚠️ Na regua do frete este slot e COBRANCA, nao entrada de dinheiro —
       -- por isso o card o rotula "Cobrado pelo ML" (`rotuloSlotRecebido`).
       case when m.e_lider then round(m.cobrado, 2) end    as recebido,
       -- 🔴 SINAL PRESERVADO nos tres: cobrado - esperado. Positivo = cobrou a
       -- mais. Truncar o lado negativo tornaria "e sempre a mais" irrefutavel.
       m.dif                                               as residuo_nosso,
       m.dif                                               as diferenca,
       m.data_pedido,
       -- ⚠️ `ml_order_sale_fee` NAO tem data de cobranca (so `capturado_em`,
       -- que e quando NOS ingerimos). O evento e a data do PEDIDO — escolha
       -- conservadora: aperta o relogio, nunca o afrouxa.
       m.data_pedido                                       as data_evento,
       m.dias_restantes,
       0                                                   as n_pagamentos,
       null::text[]                                        as payment_ids,
       null::date                                          as release_date_max,
       -- Estimado e exatamente "a diferenca nao fechou" — o mesmo predicado que
       -- decide `frete_em_aberto`, para que os dois nunca discordem.
       (m.dif is null)                                     as valor_estimado,
       -- 239-05: a regua do frete nao tem ponta do comprador para provar; a
       -- coluna existe para casar com a base no `union all` de get_casos.
       null::numeric                                       as ponta_comprador
  from mot m
  -- 🔴 A IDENTIDADE PERSISTIDA NAO MUDA. A juncao casa com o LITERAL
  -- `'frete_a_maior'`, nunca com o `tipo_caso` derivado acima: trocar a chave
  -- pela expressao orfanaria todo caso ja gravado no instante do deploy.
  left join public.conciliacao_casos k
         on k.organization_id = p_org_id
        and k.ml_order_id     = m.ml_order_id
        and k.tipo_caso       = 'frete_a_maior';
$function$;
