-- ===========================================================================
-- 244-03 — a régua de comissão: a tarifa PUBLICADA contra a COBRADA
--
-- ── A LACUNA QUE ELA FECHA ────────────────────────────────────────────────
--
-- Antes desta função, das quatro famílias que o ML cobra só o FRETE tinha
-- régua própria. A comissão — R$ 257.634,65 líquidos — era conferida apenas
-- pela `repasse_a_menor`, que compara `receita + ponta do comprador − o que o
-- ML DECLAROU cobrar` contra o que entrou. Isso pega erro de REPASSE, e não
-- erro de TARIFA: se o ML declarar 16% num anúncio de 11% e pagar de acordo, o
-- resíduo é zero, a conta fecha e ninguém acusa.
--
-- Esta função introduz a segunda fonte: `ml_comissao_tabela`, a tarifa que o
-- Mercado Livre PUBLICA em `/sites/MLB/listing_prices`.
--
-- ── 🔴 D-244-05: A TARIFA DE HOJE NÃO ACUSA A VENDA DE ONTEM ──────────────
--
-- Medido em 05/09/2026, comparando a alíquota cobrada com a publicada hoje:
--
--   ago/2026  139 de 139 batem   set/2026  13 de 13 batem
--   mar/2026  247 de 955         jan/2026  145 de 389
--
-- A tarifa MUDOU ao longo do ano (a mediana cobrada cai de 14,0% em março para
-- 12,0% em maio). Usar a tabela de hoje para julgar uma venda de março
-- acusaria o Mercado Livre de cobrar a mais quando ele cobrou o que estava
-- publicado NAQUELE dia. Seria exatamente o defeito que a fase 239 existe para
-- matar, com um número no lugar de uma opinião.
--
-- Por isso a comparação só produz VEREDITO onde `vigente_desde <= data_pedido`.
-- Antes disso o motivo é `comissao_tarifa_nao_vigente_na_venda`: a linha mostra
-- os dois números e NÃO afirma. A cobertura cresce sozinha, um dia por dia.
--
-- ── 🔴 DUAS RÉGUAS, PORQUE SÃO DUAS PERGUNTAS ────────────────────────────
--
-- A consequência de D-244-05 é que a régua independente só começa a valer da
-- primeira captura em diante. Deixar tudo antes disso como "em aberto" seria
-- honesto e INÚTIL: 29 dos 30 dias da janela sairiam mudos.
--
-- Por isso a função tem duas comparações, e o card SEMPRE diz qual usou:
--
--   (A) **Contra a tarifa PUBLICADA** — fonte independente. Só onde
--       `vigente_desde <= data_pedido`. É a única que pode dizer "o Mercado
--       Livre cobrou mais do que devia".
--
--   (B) **Contra o que o PRÓPRIO PEDIDO declara** (`sale_fee.net`, do recurso
--       de pedido) — quando não há tarifa vigente. É o ML contra o ML, mas por
--       ENDPOINTS DIFERENTES: o que a fatura cobrou contra o que o pedido
--       prometeu. Pega inconsistência interna do ML, não erro de tarifa, e o
--       rótulo diz exatamente isso: `comissao_divergente`, nunca "a maior".
--
-- ⚠️ Confundir as duas seria a acusação sem prova que a fase 239 existe para
-- matar. (B) NUNCA emite `comissao_a_maior`, e sua fila nunca é "a cobrar do
-- ML" — porque um desacordo do ML consigo mesmo não prova para que lado o
-- dinheiro andou.
--
-- ── O QUE É "COBRADO" ─────────────────────────────────────────────────────
--
-- 🔴 A soma exclui a cobrança que um BONUS ESTORNOU. Medido: 412 de 412 linhas
-- `BONUS` da base carregam `charge_bonified_id`, então o par é FATO e não
-- heurística. Sem isso, o pedido `2000017925192318` — cobrança, estorno,
-- recobrança do mesmo valor — apareceria com o dobro da comissão e a tela
-- acusaria cobrança em dobro que não existe.
--
-- ⚠️ E é a exclusão por PONTEIRO, não a subtração cega do bônus: subtrair todo
-- BONUS zera a comissão de pedido cancelado, e `sale_fee` do ML continua
-- valendo o original. Medido: a subtração cega derruba de 8.108 para 7.997 as
-- identidades que fecham.
-- ===========================================================================

ALTER TABLE public.conciliacao_config
  ADD COLUMN IF NOT EXISTS acusar_comissao_a_maior boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conciliacao_config.acusar_comissao_a_maior IS
  '244-03: enquanto false, a regua de comissao MEDE e nao acusa — o motivo sai como `regua_comissao_nao_liberada`. Mesma disciplina de `acusar_frete_a_maior` e `acusar_valor_a_menor`: ligar e decisao do Wesley com a calibracao na frente, nunca efeito colateral de deploy.';

CREATE OR REPLACE FUNCTION public.conciliacao_comissao_linhas(
  p_org_id uuid,
  p_janela_dias integer DEFAULT NULL
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
  select coalesce(c.piso_materialidade, 5.00)             as piso,
         coalesce(p_janela_dias, c.janela_dias, 30)       as janela,
         coalesce(c.acusar_comissao_a_maior, false)       as acusar,
         (now() at time zone 'America/Sao_Paulo')::date   as hoje,
         -- A MESMA defasagem medida no 239-01 e reusada no frete: mediana de 1
         -- dia entre a venda e a emissão da cobrança, máximo de 18. Venda mais
         -- nova que isso sem linha é espera normal do ML.
         18                                              as defasagem_max
    from (select 1) z
    left join public.conciliacao_config c on c.organization_id = p_org_id
),
-- 🔴 GROUP BY, e não join 1:1 — a mesma disciplina das outras duas réguas.
-- Medido em 05/09/2026: nenhum pedido da janela carrega mais de um anúncio
-- (0 de 7.535), então `max(item_id)` é o item, não uma escolha arbitrária.
-- Se um dia carregar, `n_anuncios > 1` manda a linha para o motivo próprio em
-- vez de comparar contra a tarifa de um dos anúncios como se fosse a do outro.
pedidos as (
  select o.ml_order_id,
         max(o.titulo)                        as titulo,
         max(o.sku)                           as sku,
         sum(o.quantidade)::int               as quantidade,
         max(o.item_id)                       as item_id,
         count(distinct o.item_id)::int       as n_anuncios,
         max(o.preco_unit)                    as preco_unit,
         (left(min(o.data_pedido), 10))::date as data_pedido
    from public.orders o
   where o.organization_id = p_org_id
     and o.status in ('paid','shipped','delivered')
     and o.data_pedido >= to_char((select hoje - janela from cfg), 'YYYY-MM-DD')
     and o.data_pedido <  to_char((select hoje + 1 from cfg),      'YYYY-MM-DD')
   group by o.ml_order_id
),
-- As cobranças que um BONUS estornou. `charge_bonified_id` aponta o
-- `detail_id` da cobrança cancelada — presente em 412 de 412 bônus da base.
estornadas as (
  select distinct f.ml_order_id, f.charge_bonified_id as detail_id
    from public.ml_order_sale_fee f
   where f.organization_id = p_org_id
     and f.charge_bonified_id is not null
),
cobranca as (
  select f.ml_order_id,
         sum(f.detail_amount) filter (
           where f.detail_type = 'CHARGE' and e.detail_id is null
             and f.detail_sub_type in ('CV','CVML','CVMP','CVVFN','CVVFNU','CVVML','CVVPRC')
         )                                                                as cobrado,
         count(*) filter (
           where f.detail_type = 'CHARGE' and e.detail_id is null
             and f.detail_sub_type in ('CV','CVML','CVMP','CVVFN','CVVFNU','CVVML','CVVPRC')
         )::int                                                           as n_comissao,
         bool_or(f.detail_type = 'BONUS'
                 and f.detail_sub_type in ('BVVML','BVVPRC','BVVFNU'))    as tem_estorno
    from public.ml_order_sale_fee f
    left join estornadas e
           on e.ml_order_id = f.ml_order_id
          and e.detail_id   = f.detail_id
   where f.organization_id = p_org_id
   group by f.ml_order_id
),
-- 🔴 A TARIFA VIGENTE NA DATA DA VENDA. `distinct on` com `vigente_desde <=
-- data_pedido` pega a mais recente que já valia — nunca uma futura. Sem essa
-- cláusula a régua julgaria março com a tabela de setembro.
tarifa as (
  select distinct on (p.ml_order_id)
         p.ml_order_id,
         t.sale_fee_publicado,
         t.percentage_fee,
         t.vigente_desde
    from pedidos p
    join public.ml_comissao_tabela t
      on t.organization_id = p_org_id
     and t.item_id         = p.item_id
     and t.preco           = p.preco_unit
     and t.vigente_desde  <= p.data_pedido
   order by p.ml_order_id, t.vigente_desde desc
),
-- A tarifa mais antiga que EXISTE para o par, mesmo posterior à venda. Ela não
-- serve de esperado — serve para separar "nunca capturamos" de "capturamos
-- depois da venda", que são lacunas de naturezas diferentes.
tarifa_qualquer as (
  select distinct on (p.ml_order_id)
         p.ml_order_id, t.vigente_desde as primeira_vigencia
    from pedidos p
    join public.ml_comissao_tabela t
      on t.organization_id = p_org_id
     and t.item_id         = p.item_id
     and t.preco           = p.preco_unit
   order by p.ml_order_id, t.vigente_desde asc
),
calc as (
  select p.*,
         co.cobrado,
         coalesce(co.n_comissao, 0)               as n_comissao,
         coalesce(co.tem_estorno, false)          as tem_estorno,
         ta.sale_fee_publicado,
         ta.percentage_fee,
         ta.vigente_desde,
         tq.primeira_vigencia,
         cap.ml_order_id                          as cap_id,
         cap.status                               as cap_status,
         cap.ultima_tentativa,
         capt.sale_fee_net,
         -- 🔴 O esperado é a tarifa unitária publicada VEZES a quantidade. A
         -- alíquota tem degrau por faixa de PREÇO UNITÁRIO, nunca do total do
         -- pedido: multiplicar por quantidade depois é o que preserva a faixa.
         case when ta.sale_fee_publicado is not null
              then round(ta.sale_fee_publicado * p.quantidade, 2)
         end                                      as esperado,
         case when ta.sale_fee_publicado is not null and coalesce(co.n_comissao,0) > 0
              then round(co.cobrado - ta.sale_fee_publicado * p.quantidade, 2)
         end                                      as dif_publicado,
         -- (B) o que o PRÓPRIO PEDIDO declarou como tarifa, de outro endpoint.
         -- Não multiplica por quantidade: `sale_fee.net` já é o total do
         -- pedido (medido na 223, Q3).
         case when capt.sale_fee_net is not null and coalesce(co.n_comissao,0) > 0
              then round(co.cobrado - capt.sale_fee_net, 2)
         end                                      as dif_pedido
    from pedidos p
    left join cobranca         co   on co.ml_order_id   = p.ml_order_id
    left join tarifa           ta   on ta.ml_order_id   = p.ml_order_id
    left join tarifa_qualquer  tq   on tq.ml_order_id   = p.ml_order_id
    -- 1:1 pela chave primária (organization_id, ml_order_id). LEFT porque a
    -- AUSÊNCIA de tentativa é uma das respostas, não um pedido que some.
    left join public.ml_order_sale_fee_captura cap
           on cap.organization_id = p_org_id and cap.ml_order_id = p.ml_order_id
    left join public.ml_order_sale_fee_captura capt
           on capt.organization_id = p_org_id and capt.ml_order_id = p.ml_order_id
),
mot as (
  select c.*,
         (30 - ((select hoje from cfg) - c.data_pedido))::int as dias_restantes,
         case
           -- 1) mais de um anúncio no mesmo pedido: a tarifa é POR ANÚNCIO e
           --    não há como atribuir. Hoje 0 de 7.535 — é trava, não correção.
           when c.n_anuncios > 1
                then 'comissao_varios_anuncios_no_pedido'
           -- 2) o estorno, ANTES de qualquer conta: venda desfeita não tem
           --    tarifa a conferir. 🔴 Basta EXISTIR bônus da família — não se
           --    exige `cobrado = 0`. Medido: quando o bônus cancela só uma das
           --    parcelas, `cobrado` fica em R$ 0,32 contra um `sale_fee` de
           --    R$ 46,08, e a régua leria "cobrou R$ 45,76 a menos". Comparar
           --    dinheiro que voltou é inventar rebate.
           when c.tem_estorno
                then 'comissao_estornada'
           -- 3) ⚠️ A ESPERA DO ML VEM ANTES DA LACUNA NOSSA, e a ordem é
           --    conteúdo: uma venda de ontem também não tem linha de comissão.
           --    Se a causa de captura viesse primeiro, a tela acusaria a nossa
           --    base em cima do relógio do Mercado Livre. Mesma lição da 239-04.
           --
           --    🔴 E ela exige PROVA de que perguntamos — a lição da 242-02,
           --    onde a presunção pela idade errou em 39 de 40 casos.
           when c.n_comissao = 0
            and c.data_pedido >= (select hoje - defasagem_max from cfg)
            and c.cap_id is not null
            and c.ultima_tentativa::date >= ((select hoje from cfg) - 1)
                then 'comissao_nao_emitida_pelo_ml'
           when c.n_comissao = 0
            and c.data_pedido >= (select hoje - defasagem_max from cfg)
                then 'comissao_captura_pendente'
           when c.n_comissao = 0 and c.cap_id is null
                then 'comissao_sem_captura_tentada'
           when c.n_comissao = 0
                then 'comissao_sem_cobranca_registrada'

           -- ── (A) A RÉGUA INDEPENDENTE: contra a tarifa PUBLICADA ─────────
           -- 🔴 D-244-05: só onde a tarifa já valia na data da venda. Medido
           -- em 05/09/2026, a alíquota MUDOU ao longo de 2026 — mediana de
           -- 14,0% em março contra 12,0% em maio. Julgar março com a tabela de
           -- setembro acusaria o ML de cobrar a mais tendo ele cobrado o
           -- publicado naquele dia.
           when c.dif_publicado is not null and abs(c.dif_publicado) <= (select piso from cfg)
                then 'comissao_confere_com_o_publicado'
           -- 🔴 O LADO QUE NÃO ACUSA. Cobrar MENOS que o publicado é o rebate
           -- promocional — o ML pagando parte do desconto. Sem este ramo,
           -- "sempre a mais" seria irrefutável por construção do recorte, que é
           -- o defeito que a 239-02 nomeou no frete.
           when c.dif_publicado is not null and c.dif_publicado < 0
                then 'comissao_com_rebate_medido'
           when c.dif_publicado is not null and (select acusar from cfg)
                then 'comissao_a_maior_confirmada'
           when c.dif_publicado is not null
                then 'regua_comissao_nao_liberada'

           -- ── (B) A SEGUNDA COMPARAÇÃO: fatura contra o próprio pedido ────
           -- ⚠️ Ela NUNCA vira acusação de tarifa. Diz que as duas leituras do
           -- Mercado Livre discordam entre si, o que é achado — e não diz para
           -- que lado o dinheiro andou, porque não sabe.
           when c.dif_pedido is not null and abs(c.dif_pedido) <= (select piso from cfg)
                then 'comissao_confere_com_o_pedido'
           when c.dif_pedido is not null
                then 'comissao_diverge_do_pedido'

           -- ── O que sobra: nem tabela publicada, nem `sale_fee` do pedido ──
           when c.primeira_vigencia is null
                then 'comissao_sem_tarifa_publicada'
           else 'comissao_sem_esperado'
         end as motivo
    from calc c
),
-- 🔴 A FONTE DO ESPERADO SAI DO MOTIVO, EM UM LUGAR SÓ.
--
-- Antes desta CTE o tipo era derivado de "qual diferença é calculável", e não
-- de "qual régua decidiu a linha". Medido em 05/09/2026: 2 pedidos com motivo
-- `comissao_estornada` saíam com tipo `comissao_divergente`, porque a
-- diferença contra o pedido era calculável mesmo com a venda desfeita. O card
-- diria "a fatura diverge do pedido" sobre uma venda que foi estornada.
--
-- É a mesma classe do defeito que a 239-04 corrigiu na régua do dinheiro: DUAS
-- RÉGUAS PARA O MESMO NÚMERO discordam no dia em que uma delas muda.
src as (
  select m.*,
         case
           when m.motivo in ('comissao_confere_com_o_publicado',
                             'comissao_com_rebate_medido',
                             'comissao_a_maior_confirmada',
                             'regua_comissao_nao_liberada')  then 'publicada'
           when m.motivo in ('comissao_confere_com_o_pedido',
                             'comissao_diverge_do_pedido')   then 'pedido'
           else null
         end as fonte
    from mot m
)
select k.id                                              as caso_id,
       m.ml_order_id,
       -- 🔴 D-239-01: rótulo afirmativo exige a diferença calculada. Sem ela a
       -- linha não sabe de que lado o número cai — nem se cai.
       -- 🔴 D-239-01: rótulo afirmativo exige a diferença calculada, E o tipo
       -- diz CONTRA O QUE ela foi calculada. `comissao_a_maior` só existe onde
       -- o esperado veio da tarifa PUBLICADA; onde veio do próprio pedido, o
       -- tipo é `comissao_divergente` e o card não fala em tarifa.
       case m.fonte
            when 'publicada' then 'comissao_a_maior'
            when 'pedido'    then 'comissao_divergente'
            else                  'comissao_em_aberto'
       end                                               as tipo_caso,
       case
         when m.motivo = 'comissao_a_maior_confirmada'                    then 'ml'
         -- Só o que é lacuna NOSSA. A espera do ML, o estorno e o rebate não
         -- são trabalho nosso e não podem inflar a aba "Nosso erro" — a mesma
         -- fronteira que a 239-04 desenhou e a 243-01 apertou.
         when m.motivo in ('comissao_captura_pendente',
                           'comissao_sem_captura_tentada',
                           'comissao_sem_cobranca_registrada',
                           'comissao_sem_tarifa_publicada',
                           'comissao_sem_esperado',
                           'comissao_captura_com_erro',
                           'comissao_varios_anuncios_no_pedido')          then 'nosso'
         -- ⚠️ `comissao_diverge_do_pedido` cai em 'nenhuma' de propósito: o ML
         -- discordar de si mesmo é achado, não trabalho de cadastro nosso — e
         -- também não prova retenção, então não pode ir para "a cobrar do ML".
         else 'nenhuma'
       end                                               as fila,
       (m.motivo = 'comissao_a_maior_confirmada')        as acionavel,
       m.motivo,
       case
         when k.estado is null                             then 'aberto'
         when k.estado = 'aberto' and m.dias_restantes < 0 then 'expirado'
         else k.estado
       end                                               as estado,
       m.titulo,
       m.sku,
       m.quantidade,
       -- 🔴 A TERCEIRA LEITURA, e ela vem de OUTRO endpoint. `sale_fee_net` é o
       -- que o próprio pedido declara como tarifa (recurso de PEDIDO), contra o
       -- que a FATURA cobrou (`cobrado`) e contra o que a TABELA publica
       -- (`esperado`). Três fontes no mesmo card é o que torna a acusação
       -- conferível — foi assim que o frete fechou em 1.209 de 1.209.
       round(m.sale_fee_net, 2)                          as retido_de_fato,
       -- ⚠️ Só onde a linha TEM régua. Exibir o cobrado sem esperado ao lado
       -- daria meia conta, e meia conta na tela é a que o leitor completa
       -- sozinho — errado.
       case when m.fonte is not null then round(m.cobrado, 2) end as cobranca_declarada,
       case m.fonte when 'publicada' then m.dif_publicado
                    when 'pedido'    then m.dif_pedido end as residuo_ml,
       -- O esperado exibido é o da régua que DECIDIU a linha — nunca os dois
       -- somados, nunca o outro. Uma linha, uma fonte, e o motivo diz qual.
       case m.fonte
            when 'publicada' then m.esperado
            when 'pedido'    then round(m.sale_fee_net, 2)
       end                                               as esperado_nosso,
       -- Mesma expressão de `cobranca_declarada` de propósito: um segundo
       -- cálculo aqui seria uma segunda régua para o mesmo número, que foi como
       -- o saldo quebrou na fase 233.
       case when m.fonte is not null then round(m.cobrado, 2) end as recebido,
       -- 🔴 SINAL PRESERVADO: positivo = a fatura cobrou mais que o esperado.
       case m.fonte when 'publicada' then m.dif_publicado
                    when 'pedido'    then m.dif_pedido end as residuo_nosso,
       case m.fonte when 'publicada' then m.dif_publicado
                    when 'pedido'    then m.dif_pedido end as diferenca,
       m.data_pedido,
       -- ⚠️ `ml_order_sale_fee` não tem data de cobrança (só `capturado_em`,
       -- que é quando NÓS ingerimos). O evento é a data do PEDIDO — escolha
       -- conservadora: aperta o relógio, nunca o afrouxa.
       m.data_pedido                                     as data_evento,
       m.dias_restantes,
       0                                                 as n_pagamentos,
       null::text[]                                      as payment_ids,
       null::date                                        as release_date_max,
       (m.fonte is null)                                 as valor_estimado,
       null::numeric                                     as ponta_comprador
  from src m
  -- 🔴 A identidade PERSISTIDA casa com o LITERAL, nunca com o `tipo_caso`
  -- derivado acima: trocar a chave pela expressão orfanaria todo caso já
  -- gravado no instante do deploy.
  left join public.conciliacao_casos k
         on k.organization_id = p_org_id
        and k.ml_order_id     = m.ml_order_id
        and k.tipo_caso       = 'comissao_a_maior';
$function$;

-- 🔴 `CREATE OR REPLACE`, nunca DROP + CREATE: DROP FUNCTION apaga a ACL e a
-- função renasce com EXECUTE para PUBLIC e `anon`. Já aconteceu em 05/09 com
-- três funções desta mesma tela.
REVOKE ALL ON FUNCTION public.conciliacao_comissao_linhas(uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.conciliacao_comissao_linhas(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.conciliacao_comissao_linhas(uuid, integer) TO authenticated;
