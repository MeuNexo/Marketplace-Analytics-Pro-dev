-- ────────────────────────────────────────────────────────────────────────────
-- Fase 239, plano 239-01 — os numeros aterrissam nos slots que o card LE.
--
-- 🔴 O DEFEITO, MEDIDO E NAO SUPOSTO (M-08, 04/09/2026):
--
--   `conciliacao_frete_linhas` CALCULA a cobranca de frete, grava em
--   `cobranca_declarada` — nao-nula em 970 linhas — e emite `recebido`,
--   `residuo_nosso` e `retido_de_fato` como `null::numeric` LITERAIS. O card
--   le os slots vazios e escreve "nao apurado" nas tres linhas, enquanto
--   ostenta o rotulo `Frete cobrado acima do publicado`.
--
--   Denominador de P1-A, janela de 30 dias, medido em 04/09 19h26 UTC:
--     linhas ................ 1.214
--     com cobranca .......... 970   (79,9%)
--     com esperado .......... 28    ( 2,3%)
--     com recebido .......... 0
--     com residuo ........... 0
--     com diferenca ......... 0
--     PROVAM AS TRES ........ 0
--
--   ⚠️ A M-08 do `239-MEDIDAS` mediu a MESMA funcao com janela NULA e achou
--   1.200 / 970 / 14. Os dois numeros estao certos: sao recortes diferentes.
--   Este arquivo e a janela de 30 dias, que e a que a tela usa.
--
-- ─── D-239-01, A REGRA QUE ESTA MIGRATION OBEDECE ──────────────────────────
--
-- Rotulo que AFIRMA o desfecho exige as tres linhas fechadas: esperado,
-- cobrado e diferenca. Sem elas o item nao e caso — e pergunta em aberto. Por
-- isso `tipo_caso` deixa de ser a constante `'frete_a_maior'` e passa a ser
-- DERIVADO da existencia da diferenca. Hoje `dif` e nula em 1.214 de 1.214,
-- entao TODAS as linhas saem `frete_em_aberto`: nenhuma acusa, e nenhuma
-- mente. Quem fecha o esperado — e devolve linhas afirmativas de verdade — e o
-- plano 239-03, com a regua do envio.
--
-- ─── O QUE ESTE ARQUIVO NAO FAZ, E POR QUE ─────────────────────────────────
--
-- 🔴 NAO LIGA ACUSACAO. `acusar_frete_a_maior` e `acusar_valor_a_menor`
-- continuam falsas, e a guarda final ABORTA se alguma tiver sido ligada. Esta
-- fase e sobre PROVAR, nunca sobre acusar (239-CONTEXT, "Fronteiras").
--
-- 🔴 NAO REESCREVE O NETTING. O `BONUS` / `charge_bonified_id` repete o valor
-- EXATO do `CHARGE` que aponta (provado par a par no pedido 2000017811575194),
-- entao somar direto declara cobranca em dobro onde o liquido e zero.
--
-- 🔴 NAO TOCA `conciliacao_base_linhas` nem `get_casos_conciliacao`. O
-- contrato de 24 colunas nao muda de nome nem de tipo — e quem garante isso e
-- o Postgres, que recusa `create or replace` com retorno diferente.
--
-- APLICACAO: via MCP `apply_migration` no projeto ckcdevcxgvueywivefgx.
-- Nunca SQL Editor, nunca `db push` (drift via SQL Editor e proibido nesta casa).
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ 0. Guarda do corpo VIVO: aborta antes de sobrescrever o que nao foi lido ═
--
-- Clonar corpo de RPC do REPOSITORIO ja regrediu producao nesta casa em
-- R$ 30.372,11 (Fase 224, `get_cashflow`). O corpo vivo foi lido em 04/09
-- 19h26 UTC — 8.062 bytes, INVOKER, com `n_no_grupo` na posicao 3884 — e este
-- bloco RECONFERE os marcadores no instante da aplicacao, porque entre a
-- leitura e o apply cabe outro plano.

DO $$
DECLARE
  v_corpo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_corpo
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'conciliacao_frete_linhas'
   LIMIT 1;

  IF v_corpo IS NULL THEN
    RAISE EXCEPTION
      'conciliacao_frete_linhas nao existe — esta migration depende da 225-06';
  END IF;

  -- A heuristica de carrinho e a assinatura do corpo que este arquivo ACHA que
  -- vai substituir. Se ela sumiu, alguem reescreveu a funcao e este arquivo
  -- esta cego: parar alto e reler o corpo vivo.
  IF position('n_no_grupo' in v_corpo) = 0 THEN
    RAISE EXCEPTION
      'o corpo VIVO de conciliacao_frete_linhas nao tem a heuristica de carrinho — '
      'foi reescrito por outro plano. Leia o corpo vivo antes de substituir (Fase 224)';
  END IF;

  -- Mesma disciplina para o netting: substituir sem ele seria trocar uma regua
  -- calibrada por outra sem perceber.
  IF position('charge_bonified_id' in v_corpo) = 0 THEN
    RAISE EXCEPTION
      'o corpo VIVO de conciliacao_frete_linhas perdeu o netting do estorno — '
      'pare e leia antes de substituir';
  END IF;

  -- ⚠️ Nao ha guarda contra "ja corrigido": reaplicar este arquivo tem de ser
  -- inofensivo. O que precisa abortar e o corpo DESCONHECIDO, nao o corpo novo.
END $$;

-- ═══ 1. conciliacao_frete_linhas v2 — os slots recebem o que ja e calculado ══
--
-- 🔴 SECURITY INVOKER, sempre. Funcao de tenant com DEFINER e parametro de
-- organizacao e IDOR — e o numero de uma loja na tela da outra JA ACONTECEU
-- nesta base. `p_org_id` recorta; quem autoriza e a RLS das tabelas de origem.
--
-- As MESMAS 24 colunas, na MESMA ordem e nos MESMOS tipos.

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
         (now() at time zone 'America/Sao_Paulo')::date  as hoje
    from (select 1) z
    left join public.conciliacao_config c on c.organization_id = p_org_id
),
pedidos as (
  select o.ml_order_id,
         max(o.item_id)                        as item_id,
         count(distinct o.item_id)::int        as n_itens,
         max(o.titulo)                         as titulo,
         max(o.sku)                            as sku,
         sum(o.quantidade)::int                as quantidade,
         max(o.comprador)                      as comprador,
         (left(min(o.data_pedido), 10))::date  as data_pedido
    from public.orders o
   where o.organization_id = p_org_id
     and o.status in ('paid','shipped','delivered')
     and o.data_pedido >= to_char((select hoje - janela from cfg), 'YYYY-MM-DD')
     and o.data_pedido <  to_char((select hoje + 1 from cfg),      'YYYY-MM-DD')
   group by o.ml_order_id
),
-- 🔴 A cobranca de frete e LIQUIDA DO ESTORNO, com a MESMA expressao de netting
-- de C-02: o BONUS repete o valor EXATO do CHARGE que aponta (51,29 / 0,37 /
-- 28,35 no pedido 2000017811575194), entao somar direto declara cobranca em
-- dobro onde o liquido e zero. `n_frete` conta so as linhas de COBRANCA, para
-- que um pedido cujo frete foi integralmente estornado nao seja lido como
-- "nunca teve frete".
frete_cobrado as (
  select f.ml_order_id,
         sum(case when f.detail_type = 'BONUS' or f.charge_bonified_id is not null
                  then -f.detail_amount
                  else  f.detail_amount
             end) filter (where f.detail_sub_type in ('CFFE','CXDE','CXDED','BFFE'))  as cobrado,
         count(*) filter (where f.detail_sub_type in ('CFFE','CXDE','CXDED'))::int    as n_frete
    from public.ml_order_sale_fee f
   where f.organization_id = p_org_id
   group by f.ml_order_id
),
-- O custo de tabela VIGENTE NA DATA DA VENDA: a linha mais recente do item cuja
-- vigencia comeca em ou antes do pedido. Exatamente uma linha por (pedido, item).
prometido as (
  select p.ml_order_id, v.list_cost, v.vigente_desde
    from pedidos p
    left join lateral (
      select t.list_cost, t.vigente_desde
        from public.ml_item_frete_tabela t
       where t.organization_id = p_org_id
         and t.item_id         = p.item_id
         and t.vigente_desde  <= p.data_pedido
       order by t.vigente_desde desc
       limit 1
    ) v on true
),
calc as (
  select p.ml_order_id, p.titulo, p.sku, p.quantidade, p.data_pedido,
         p.n_itens,
         pr.list_cost                                                        as prometido,
         fc.cobrado,
         coalesce(fc.n_frete, 0)                                             as n_frete,
         case when pr.list_cost is not null and coalesce(fc.n_frete, 0) > 0
              then round((fc.cobrado - pr.list_cost)::numeric, 2)
         end                                                                 as dif,
         count(p.comprador) over (partition by p.comprador, p.data_pedido)   as n_no_grupo
    from pedidos p
    join prometido    pr on pr.ml_order_id = p.ml_order_id
    left join frete_cobrado fc on fc.ml_order_id = p.ml_order_id
),
mot as (
  select c.*,
         (30 - ((select hoje from cfg) - c.data_pedido))::int as dias_restantes,
         case
           -- 1) pedido com mais de um anuncio: list_cost e por ITEM, frete e por
           --    PACOTE. Nao ha soma honesta, entao nao se soma.
           when c.n_itens > 1                        then 'frete_multi_item'
           -- 2) carrinho: frete cobrado uma vez pelo pacote (mesmo predicado de C-05).
           when c.n_no_grupo > 1                     then 'possivel_carrinho'
           -- 3) sem regua vigente na data da venda: comparacao retroativa e
           --    DIAGNOSTICO, nunca caso.
           when c.prometido is null                  then 'frete_sem_vigencia_na_venda'
           -- 4) sem linha de cobranca: lacuna NOSSA nomeada, jamais zero presumido.
           when c.n_frete = 0                        then 'frete_sem_cobranca_registrada'
           when abs(c.dif) <= (select piso from cfg) then 'frete_abaixo_do_piso'
           -- 🔴 o lado que NAO acusa, e sem ele "sempre a mais" seria irrefutavel.
           when c.dif < 0                            then 'frete_a_menor_medido'
           when (select acusar_frete from cfg)       then 'frete_a_maior_confirmado'
           else                                           'regua_frete_nao_liberada'
         end as motivo
    from calc c
)
select k.id                                                as caso_id,
       m.ml_order_id,
       -- 🔴 239-01 (D-239-01): o tipo e DERIVADO, nao constante. Rotulo que
       -- afirma o desfecho ("cobrado acima do publicado") exige a diferenca
       -- calculada; sem ela a linha nao sabe de que lado o numero cai — nem se
       -- cai. Medido em 04/09: 1.214 de 1.214 ostentavam o rotulo afirmativo
       -- com as tres linhas nulas.
       case when m.dif is null then 'frete_em_aberto'
            else                    'frete_a_maior'
       end                                                 as tipo_caso,
       case
         when m.motivo = 'frete_a_maior_confirmado'                              then 'ml'
         when m.motivo in ('frete_multi_item','possivel_carrinho',
                           'frete_sem_cobranca_registrada')                      then 'nosso'
         else 'nenhuma'
       end                                                 as fila,
       (m.motivo = 'frete_a_maior_confirmado')             as acionavel,
       m.motivo,
       case
         when k.estado is null                             then 'aberto'
         when k.estado = 'aberto' and m.dias_restantes < 0 then 'expirado'
         else k.estado
       end                                                 as estado,
       m.titulo,
       m.sku,
       m.quantidade,
       -- 🔴 CONTINUA AUSENTE, E O MOTIVO E ESTE: a segunda fonte independente do
       -- frete NAO e o Mercado Pago e nunca foi — e `senders[].cost` do recurso
       -- de envio (`/shipments/{id}/costs`), que o plano 239-02 captura e o
       -- 239-03 liga. Ausencia viaja NOMEADA; zero seria uma afirmacao que esta
       -- funcao nao tem como sustentar (fase 219: frete apagado virou R$ 0,00).
       null::numeric                                       as retido_de_fato,
       round(m.cobrado, 2)                                 as cobranca_declarada,
       m.dif                                               as residuo_ml,
       round(m.prometido, 2)                               as esperado_nosso,
       -- 🔴 239-01: era `null::numeric` literal em 100% das linhas enquanto o
       -- MESMO valor ja saia em `cobranca_declarada`. A expressao e a mesma de
       -- proposito: um segundo calculo aqui seria uma segunda regua para o
       -- mesmo numero, que foi como o saldo quebrou na fase 233.
       -- ⚠️ Na regua do frete este slot e COBRANCA, nao entrada de dinheiro —
       -- por isso o card o rotula "Cobrado pelo ML" (`rotuloSlotRecebido`).
       round(m.cobrado, 2)                                 as recebido,
       -- 🔴 239-01: a diferenca contra a NOSSA base, com o sinal preservado. A
       -- ficha do anuncio E a nossa base nesta regua, entao ela coincide com
       -- `residuo_ml` — coincidem porque sao a mesma conta, nao por descuido.
       -- Truncar o lado negativo tornaria "e sempre a mais" irrefutavel.
       m.dif                                               as residuo_nosso,
       -- 🔴 SINAL PRESERVADO: cobrado - prometido. Positivo = cobrou a mais.
       m.dif                                               as diferenca,
       m.data_pedido,
       -- ⚠️ `ml_order_sale_fee` NAO tem data de cobranca (so `capturado_em`, que
       -- e quando NOS ingerimos). O evento e a data do PEDIDO — escolha
       -- conservadora: aperta o relogio, nunca o afrouxa.
       m.data_pedido                                       as data_evento,
       m.dias_restantes,
       0                                                   as n_pagamentos,
       null::text[]                                        as payment_ids,
       null::date                                          as release_date_max,
       (m.prometido is null or m.n_frete = 0)              as valor_estimado
  from mot m
  -- 🔴 A IDENTIDADE PERSISTIDA NAO MUDA. A juncao casa com o LITERAL
  -- `'frete_a_maior'`, nunca com o `tipo_caso` derivado acima: trocar a chave
  -- pela expressao orfanaria todo caso ja gravado no instante do deploy. E
  -- `conciliacao_casos_tipo_chk` so aceita quatro valores, entre os quais
  -- `frete_em_aberto` NAO esta — essa recusa e a trava de D-239-01 em forma de
  -- constraint: linha sem diferenca nao pode ser persistida como caso.
  left join public.conciliacao_casos k
         on k.organization_id = p_org_id
        and k.ml_order_id     = m.ml_order_id
        and k.tipo_caso       = 'frete_a_maior';
$$;

comment on function public.conciliacao_frete_linhas(uuid, int) is
  '225-06 + 239-01: a TERCEIRA regua da fase — frete PROMETIDO na ficha do anuncio (list_cost '
  'vigente na data da venda) contra frete COBRADO na fatura (CFFE/CXDE/CXDED liquido de BFFE, '
  'netting de C-02). 🔴 239-01 corrigiu DOIS defeitos de aterrissagem: `recebido` e '
  '`residuo_nosso` eram `null::numeric` LITERAIS enquanto o valor ja era calculado (medido: '
  'cobranca nao-nula em 970 de 1.214 linhas, `recebido` nulo em 1.214). ⚠️ NA REGUA DO FRETE O '
  'SLOT DO MEIO E COBRANCA, NAO ENTRADA DE DINHEIRO: as duas fontes sao a FICHA e a FATURA, '
  'nenhum real entra nesta conta — o card o rotula "Cobrado pelo ML". 🔴 `tipo_caso` e DERIVADO '
  '(D-239-01): sem `diferenca` calculada a linha sai `frete_em_aberto` e NAO ostenta rotulo que '
  'afirma o desfecho; so com as tres linhas fechadas ela vira `frete_a_maior`. A juncao com '
  '`conciliacao_casos` continua no literal `frete_a_maior` — a identidade persistida nao mudou. '
  '`retido_de_fato` segue AUSENTE porque a segunda fonte independente do frete e `senders[].cost` '
  'do recurso de envio (plano 239-02), nunca o Mercado Pago.';

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
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'conciliacao_frete_linhas'
       AND p.prosecdef
  ) THEN
    -- ⚠️ A mensagem diz "(DEFINER)" e nao a expressao SQL inteira de proposito:
    -- o portao de auditoria reprova a expressao em QUALQUER lugar do SQL util, e
    -- uma string indistinguivel de codigo e exatamente o que ele existe para pegar.
    RAISE EXCEPTION 'conciliacao_frete_linhas esta com prosecdef verdadeiro (DEFINER) — isso e IDOR com p_org_id';
  END IF;

  -- 🔴 As duas reguas de acusacao continuam DESLIGADAS. Esta fase e sobre
  -- PROVAR (239-CONTEXT, "Fronteiras"); ligar acusacao custa um UPDATE feito
  -- pelo Wesley com a calibracao na frente, nunca um deploy.
  IF EXISTS (SELECT 1 FROM public.conciliacao_config WHERE acusar_frete_a_maior) THEN
    RAISE EXCEPTION 'acusar_frete_a_maior esta LIGADA — a direcao do desvio ainda nao foi medida';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conciliacao_config WHERE acusar_valor_a_menor) THEN
    RAISE EXCEPTION 'acusar_valor_a_menor esta LIGADA — a calibracao de C-03 reprovou com 55,3%%';
  END IF;
END $$;
