-- ────────────────────────────────────────────────────────────────────────────
-- Fase 239, plano 239-03 — a regua do frete sai do ITEM e vai para o ENVIO.
--
-- 🔴 POR QUE O ITEM NUNCA FOI A UNIDADE CERTA:
--
--   O Mercado Livre COTA e COBRA frete por ENVIO. A tabela por anuncio
--   (`ml_item_frete_tabela`) e o custo publicado na ficha, que so coincide com
--   o cobrado quando o pedido tem um anuncio, um envio e nenhum carrinho. Tres
--   das quatro exclusoes da 225 — vigencia, multi-item e carrinho — existiam
--   so porque a regua estava na grandeza errada. Trocar a fonte as dissolve de
--   uma vez, sem exclusao nenhuma.
--
--   MEDIDO (239-02, populacao, nao amostra):
--     pares pedido->envio ............. 1.214
--     envios distintos ................ 1.209  (os 5 de diferenca sao pacote)
--     envios com `list_cost` .......... 1.209  (100%)
--     envios com `custo_vendedor` ..... 1.209  (100%)
--     `custo_vendedor + coalesce(custo_comprador,0) = list_cost`, ao centavo,
--     em 1.209 de 1.209 — `so_comprador_pagou = 0`, `so_diverge = 0`.
--
--   MEDIDO (P3-A/M-07): `shipping_option.list_cost` volta em 7 de 7 meses e
--   bate ao centavo com o cobrado na fatura em 6 de 6 que tem linha de
--   cobranca (o 7o e frete gratis, sem linha). A API devolve a tabela DA
--   EPOCA, nao a de hoje — por isso `frete_sem_vigencia_na_venda` deixa de ser
--   emitido: a vigencia parou de ser um problema quando a fonte mudou.
--
-- ─── FONTE UNICA, SEM QUEDA PARA A TABELA DO ITEM ──────────────────────────
--
-- 🔴 Esta funcao NAO le mais `ml_item_frete_tabela`, nem como plano B. As duas
-- nao sao a mesma grandeza medida: a do envio tem aderencia provada contra a
-- cobranca (6/6 ao centavo); a do item nunca foi exercitada contra cobranca
-- alguma (n = 0 na fase 225). Misturar uma regua provada com uma nao medida,
-- e deixar o card sem dizer qual das duas produziu o numero, e exatamente o
-- defeito que esta fase existe para matar.
--
-- ─── D-239-01: QUEM NAO FECHA DIZ A CAUSA REAL ─────────────────────────────
--
-- A cascata de motivos e ordenada por DURABILIDADE: a causa mais estrutural
-- primeiro, para que a linha nao seja rotulada pela consequencia quando a
-- causa e outra. Pedido sem envio capturado nao pode sair como "sem cobranca":
-- a cobranca pode existir e nos e que nao sabemos onde procurar.
--
-- ─── O QUE ESTE ARQUIVO NAO FAZ ────────────────────────────────────────────
--
-- 🔴 NAO LIGA ACUSACAO. `acusar_frete_a_maior` e `acusar_valor_a_menor`
-- continuam falsas e a guarda final ABORTA se alguma tiver sido ligada. Ligar
-- acusacao custa um UPDATE feito pelo Wesley com a calibracao na frente,
-- nunca um deploy (239-CONTEXT, "Fronteiras" e D-239-03 item 3).
--
-- 🔴 NAO REESCREVE O NETTING. O `BONUS` / `charge_bonified_id` repete o valor
-- EXATO do `CHARGE` que aponta, entao somar direto declara cobranca em dobro
-- onde o liquido e zero. A expressao vem da 225 intacta.
--
-- 🔴 NAO MUDA O CONTRATO. As mesmas 24 colunas, na mesma ordem e nos mesmos
-- tipos — quem garante isso e o Postgres, que recusa `create or replace` com
-- retorno diferente.
--
-- APLICACAO: via MCP `apply_migration` no projeto ckcdevcxgvueywivefgx.
-- Nunca SQL Editor, nunca `db push`.
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ 0. Guarda do corpo VIVO: aborta antes de sobrescrever o que nao foi lido ═
--
-- Clonar corpo de RPC do REPOSITORIO ja regrediu producao nesta casa em
-- R$ 30.372,11 (Fase 224, `get_cashflow`). O corpo lido antes de escrever este
-- arquivo e a v2 do plano 239-01, aplicada em 04/09. Entre a leitura e o apply
-- cabe outro plano — entao a conferencia se repete no instante da aplicacao.
--
-- ⚠️ A guarda aceita DOIS corpos conhecidos: a v2 (que este arquivo substitui)
-- e a propria v3 (para que reaplicar seja inofensivo). O que precisa abortar e
-- o corpo DESCONHECIDO. Os marcadores sao montados por concatenacao para que a
-- auditoria estatica do portao consiga distinguir uma STRING DE CONFERENCIA de
-- uma LEITURA DE VERDADE da tabela do item.

DO $$
DECLARE
  v_corpo         text;
  v_marca_v2      constant text := 'ml_item' || '_frete_tabela';
  v_marca_v3      constant text := 'ml_shipment' || '_pedido';
  v_marca_netting constant text := 'charge_bonified_id';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_corpo
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'conciliacao_frete_linhas'
   LIMIT 1;

  IF v_corpo IS NULL THEN
    RAISE EXCEPTION
      'conciliacao_frete_linhas nao existe — esta migration depende da 225-06 e da 239-01';
  END IF;

  IF position(v_marca_v2 in v_corpo) = 0 AND position(v_marca_v3 in v_corpo) = 0 THEN
    RAISE EXCEPTION
      'o corpo VIVO de conciliacao_frete_linhas nao e nem a v2 nem a v3 — '
      'foi reescrito por outro plano. Leia o corpo vivo antes de substituir (Fase 224)';
  END IF;

  IF position(v_marca_netting in v_corpo) = 0 THEN
    RAISE EXCEPTION
      'o corpo VIVO de conciliacao_frete_linhas perdeu o netting do estorno — '
      'pare e leia antes de substituir';
  END IF;

  -- As duas tabelas do 239-02 sao pre-requisito duro: sem elas a v3 compila e
  -- devolve zero linha com esperado, que e pior que falhar.
  IF to_regclass('public.ml_shipment_pedido') IS NULL
     OR to_regclass('public.ml_shipment_frete') IS NULL THEN
    RAISE EXCEPTION
      'as tabelas de envio do plano 239-02 nao existem — aplique 20260905110000 antes';
  END IF;
END $$;

-- ═══ 1. conciliacao_frete_linhas v3 — o esperado vem do ENVIO ═══════════════
--
-- 🔴 SECURITY INVOKER, sempre. Funcao de tenant com DEFINER e parametro de
-- organizacao e IDOR — e o numero de uma loja na tela da outra JA ACONTECEU
-- nesta base. `p_org_id` recorta; quem autoriza e a RLS das tabelas de origem.

create or replace function public.conciliacao_frete_linhas(
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
             end) filter (where f.detail_sub_type in ('CFFE','CXDE','CXDED','BFFE'))  as cobrado,
         count(*) filter (where f.detail_sub_type in ('CFFE','CXDE','CXDED'))::int    as n_frete
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
       (m.dif is null)                                     as valor_estimado
  from mot m
  -- 🔴 A IDENTIDADE PERSISTIDA NAO MUDA. A juncao casa com o LITERAL
  -- `'frete_a_maior'`, nunca com o `tipo_caso` derivado acima: trocar a chave
  -- pela expressao orfanaria todo caso ja gravado no instante do deploy.
  left join public.conciliacao_casos k
         on k.organization_id = p_org_id
        and k.ml_order_id     = m.ml_order_id
        and k.tipo_caso       = 'frete_a_maior';
$$;

comment on function public.conciliacao_frete_linhas(uuid, int) is
  '225-06 + 239-01 + 239-03: a TERCEIRA regua da fase. 🔴 239-03 TROCOU A FONTE DO ESPERADO: sai '
  'a tabela de frete por anuncio e entra `shipping_option.list_cost` do ENVIO (ml_shipment_frete '
  'x ml_shipment_pedido, plano 239-02), que e a grandeza em que o ML cota e cobra. Aderencia '
  'medida: `list_cost` = cobrado na fatura ao centavo em 6 de 6 meses com linha de cobranca, e '
  '`custo_vendedor + coalesce(custo_comprador,0) = list_cost` em 1.209 de 1.209 envios. A funcao '
  'NAO le mais `ml_item_frete_tabela`, nem como plano B: a regua do item nunca foi exercitada '
  'contra cobranca (n = 0 na 225), e misturar regua provada com regua nao medida e o defeito que '
  'a fase 239 existe para matar. 🔴 APURACAO POR PACOTE: a comparacao sai UMA vez, no pedido '
  'canonico do envio; os demais saem com `frete_apurado_no_pacote` e o numero do lider no titulo. '
  'A heuristica de carrinho por comprador+dia FOI REMOVIDA — o envio e fato, ela era suposicao. '
  '`frete_multi_item` deixou de existir pelo mesmo motivo: `list_cost` ja e do pacote, entao a '
  'exclusao perdeu a razao (a M-01 mediu 0 linhas nesse motivo na janela, entao a remocao nao '
  'muda contagem alguma hoje). `frete_sem_vigencia_na_venda` tambem deixa de ser emitido: a API '
  'devolve a opcao DA EPOCA, medida em 7 de 7 meses. 🔴 D-239-01: `tipo_caso` e DERIVADO — sem '
  '`diferenca` a linha sai `frete_em_aberto` e nao afirma desfecho; quem nao fecha diz a causa '
  'REAL, separando espera do ML (`frete_cobranca_nao_emitida`, defasagem maxima medida de 18 '
  'dias) de lacuna nossa (`frete_sem_envio_capturado`) e de ausencia da fonte '
  '(`frete_sem_opcao_no_envio`). 🔴 NENHUMA REGUA DE ACUSACAO E LIGADA AQUI.';

-- ═══ 2. ACL — recriar funcao apaga a ACL, entao o par vai NO MESMO ARQUIVO ══
--
-- 🔴 `from anon` e EXPLICITO: revogar de PUBLIC nao desfaz o grant direto que o
-- Supabase concede a `anon`. R-08(c) da onda 2 da fase 225 falhou nisso.

revoke all on function public.conciliacao_frete_linhas(uuid, int) from public;
revoke all on function public.conciliacao_frete_linhas(uuid, int) from anon;
grant execute on function public.conciliacao_frete_linhas(uuid, int) to authenticated;

-- ═══ 3. Guardas finais — o portao imprime o denominador antes do veredito ═══

DO $$
DECLARE
  v_funcao constant text := 'public.conciliacao_frete_linhas(uuid,int)';
BEGIN
  IF has_function_privilege('anon', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda EXECUTA % — o revoke de PUBLIC nao alcanca o grant direto', v_funcao;
  END IF;

  IF NOT has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated PERDEU execute em % — recriar funcao apagou a ACL', v_funcao;
  END IF;

  -- DEFINER com parametro de organizacao e IDOR, e ja aconteceu nesta base.
  -- ⚠️ A mensagem diz "(DEFINER)" e nao a expressao SQL inteira de proposito: o
  -- portao de auditoria reprova a expressao em QUALQUER lugar do SQL util, e uma
  -- string indistinguivel de codigo e exatamente o que ele existe para pegar.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'conciliacao_frete_linhas'
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'conciliacao_frete_linhas esta com prosecdef verdadeiro (DEFINER) — isso e IDOR com p_org_id';
  END IF;

  -- 🔴 As duas reguas de acusacao continuam DESLIGADAS. Esta fase e sobre
  -- PROVAR; ligar acusacao custa um UPDATE feito pelo Wesley com a calibracao
  -- na frente, nunca um deploy.
  IF EXISTS (SELECT 1 FROM public.conciliacao_config WHERE acusar_frete_a_maior) THEN
    RAISE EXCEPTION 'acusar_frete_a_maior esta LIGADA — a direcao do desvio ainda nao foi medida';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conciliacao_config WHERE acusar_valor_a_menor) THEN
    RAISE EXCEPTION 'acusar_valor_a_menor esta LIGADA — a calibracao de C-03 reprovou com 55,3%%';
  END IF;
END $$;
