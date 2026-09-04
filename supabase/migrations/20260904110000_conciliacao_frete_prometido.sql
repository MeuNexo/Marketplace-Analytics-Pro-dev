-- ────────────────────────────────────────────────────────────────────────────
-- Fase 225, plano 225-06, Task 3 — a comparacao: frete PROMETIDO x frete COBRADO.
--
-- 🔴 ESTA E A PERGUNTA QUE ORIGINOU A FASE, e ela nao tinha resposta ate aqui:
-- "no painel de anuncios da plataforma esta uma coisa cobrada, ja na venda
-- acontece outra... e e SEMPRE A MAIS".
--
-- ⚠️ E ela NAO e a pergunta que os 98,9% do research responderam (D-225-19).
-- Aquele numero compara a FATURA do ML com o que o ENVIO registrou
-- (/shipments): fontes independentes, numero legitimo, pergunta diferente. A
-- regua do Wesley e uma TERCEIRA — entre o que o ANUNCIO publicava e o que a
-- venda cobrou — e ela nasce neste arquivo.
--
-- ─── 🔴 A DECISAO DE DESENHO QUE DECIDE SE A PERGUNTA PODE SER RESPONDIDA ───
--
-- "E SEMPRE A MAIS" e uma hipotese COM DIRECAO. Erro aleatorio oscila para os
-- dois lados; erro sistematico tem um so. Para medir direcao e preciso emitir
-- OS DOIS LADOS: se esta funcao so devolvesse diferenca positiva, F-02 estaria
-- medindo uma distribuicao truncada e "sempre a mais" seria IMPOSSIVEL DE
-- REFUTAR — a resposta viria de graca, pelo recorte, nao pelo dado.
--
-- Por isso existe o motivo `frete_a_menor_medido`: cobrado ABAIXO do prometido
-- aparece, nao acusa ninguem, e e ele que da sentido ao percentual acima e
-- abaixo de zero de F-02. Refutar a suspeita e resultado tao valido quanto
-- confirma-la, e o desenho precisa deixar as duas saidas abertas.
--
-- ─── O QUE ESTA MIGRATION NAO TOCA, E POR QUE ──────────────────────────────
--
-- 🔴 `conciliacao_base_linhas` NAO E SUBSTITUIDA. Sao ~250 linhas de regra
-- calibrada em producao, e clonar corpo de RPC do repositorio ja regrediu
-- producao nesta casa em R$ 30.372,11 (Fase 224, get_cashflow). O tipo novo de
-- caso entra por uma funcao NOVA e autocontida, `conciliacao_frete_linhas`, e o
-- unico corpo substituido e o de `get_casos_conciliacao` — oito linhas, que
-- passam a unir as duas.
--
-- E a substituicao tem GUARDA, nao promessa: o bloco `DO $$` abaixo LE o corpo
-- vivo com `pg_get_functiondef` e ABORTA se ele nao contiver os marcadores
-- esperados. Se o plano 04 ou 05 tiver mexido na funcao, esta migration falha
-- alto em vez de sobrescrever em silencio uma versao que ninguem leu.
--
-- ⚠️ E o contrato de 24 colunas e protegido pelo PROPRIO POSTGRES: o
-- `CREATE OR REPLACE` de funcao que devolve TABLE recusa qualquer mudanca de
-- nome ou tipo de coluna de retorno ("cannot change return type of existing
-- function"). F-05 nao depende de disciplina — depende do motor.
--
-- ─── AS TRES EXCLUSOES, CADA UMA COM MOTIVO MEDIDO ─────────────────────────
--
--  1. CARRINHO. Frete de carrinho e cobrado UMA VEZ pelo pacote; comparar por
--     pedido acusaria a mais em todo pacote. Predicado identico ao de C-05
--     (mesmo comprador, mesmo dia) para que as duas reguas nunca discordem.
--     ⚠️ C-05 mediu 0,0% de carrinho entre os pedidos sem repasse da janela —
--     a exclusao pode nao remover nenhuma linha hoje. Ela existe porque o custo
--     do falso positivo e assimetrico, nao porque o numero e grande.
--
--  2. PEDIDO COM MAIS DE UM ITEM. `list_cost` e por ANUNCIO e o frete e por
--     PACOTE. Somar o custo de tabela dos itens promete demais; pegar um so
--     promete de menos. Nao ha resposta certa, entao nao se responde: sai como
--     `frete_multi_item`, visivel e fora da acusacao. Esta armadilha nao estava
--     no plano — apareceu ao escrever a regua.
--
--  3. VENDA ANTERIOR A PRIMEIRA CAPTURA DO ITEM. Sem linha vigente naquela
--     data o que existe e o custo de HOJE, e comparar com ele e comparar reguas
--     diferentes. Sai como `frete_sem_vigencia_na_venda`, com `diferenca` NULA
--     — 🔴 nao com um numero calculado pela regua errada. Numero errado dentro
--     de uma tela e pior que numero ausente: o ausente se declara.
--
-- E a quarta, que o plano exige e nao e exclusao e sim NOMEACAO:
--
--  4. PEDIDO SEM LINHA DE COBRANCA DE FRETE devolve `diferenca` NULA com motivo
--     proprio, NUNCA zero presumido. Presumir zero e exatamente como o frete
--     apagado virou "R$ 0,00" na fase 219. ⚠️ Este ramo tem endereco conhecido:
--     sao os 187 pedidos sem linha de frete da janela de 75 dias que C-03b
--     isolou, onde mora todo o lado que acusaria de "valor a menor".
--
-- ─── POR QUE `acusar_frete_a_maior` NASCE FALSE ────────────────────────────
--
-- Mesma disciplina de `acusar_valor_a_menor` depois de C-03: a regua MEDE
-- sempre (D-225-06) e so ACUSA quando a linha de configuracao liberar. F-02
-- ainda nao rodou; ligar a acusacao antes de medir a direcao seria afirmar
-- "sempre a mais" pela tela em vez de pelo dado. Liberar custa um UPDATE, nao
-- um deploy.
--
-- APLICACAO: via MCP `apply_migration` no projeto ckcdevcxgvueywivefgx.
-- ⚠️ Prefixo `20260904110000` — `20260903160000` ja e do plano 04.
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ 0. Guarda do corpo VIVO: aborta antes de sobrescrever o que nao foi lido ═

DO $$
DECLARE
  v_corpo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_corpo
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_casos_conciliacao'
   LIMIT 1;

  IF v_corpo IS NULL THEN
    RAISE EXCEPTION 'get_casos_conciliacao nao existe — esta migration depende da onda 2';
  END IF;

  -- Os dois marcadores do corpo que esta migration ACHA que vai substituir. Se
  -- algum sumiu, alguem reescreveu a funcao e este arquivo esta cego.
  IF position('conciliacao_base_linhas' in v_corpo) = 0 THEN
    RAISE EXCEPTION
      'o corpo VIVO de get_casos_conciliacao nao chama conciliacao_base_linhas — '
      'foi reescrito por outro plano. Leia o corpo vivo antes de substituir (Fase 224, R$ 30.372,11)';
  END IF;
  IF position('dias_restantes' in v_corpo) = 0 THEN
    RAISE EXCEPTION
      'o corpo VIVO de get_casos_conciliacao nao ordena por dias_restantes — '
      'D-225-03 sumiu do corpo vivo. Pare e leia antes de substituir';
  END IF;
END $$;

-- ═══ 1. A regua do frete mora em DADO, como o resto ════════════════════════

alter table public.conciliacao_config
  add column if not exists acusar_frete_a_maior boolean not null default false;

comment on column public.conciliacao_config.acusar_frete_a_maior is
  '🔴 NASCE FALSE, e isso NAO e conservadorismo generico: e que a DIRECAO do desvio ainda nao '
  'foi medida. A queixa de origem tem direcao declarada ("e sempre a mais") e erro aleatorio '
  'oscila para os dois lados. Enquanto F-02 (225-PROVA-FRETE.md) nao devolver a distribuicao de '
  'cobrado - prometido com o percentual acima e abaixo de zero, a RPC MEDE a diferenca e nao '
  'ACUSA ninguem por ela. Mesma mecanica de acusar_valor_a_menor depois de C-03. Liberar custa '
  'um UPDATE, nunca um deploy.';

-- ═══ 2. conciliacao_frete_linhas — o terceiro tipo, autocontido ════════════
--
-- 🔴 SECURITY INVOKER, sempre. Funcao de tenant com DEFINER e parametro de
-- organizacao e IDOR — e o numero de uma loja na tela da outra JA ACONTECEU
-- nesta base. `p_org_id` recorta; quem autoriza e a RLS das tabelas de origem.
--
-- Mesmas 24 colunas de `conciliacao_base_linhas`, porque `get_casos_conciliacao`
-- une as duas e o contrato dos planos 03 e 05 nao pode mudar de forma.

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
       'frete_a_maior'::text                               as tipo_caso,
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
       -- Nao ha "retido" nem "recebido" nesta regua: as duas fontes sao a FICHA
       -- do anuncio e a FATURA. Nulo em vez de zero, sempre.
       null::numeric                                       as retido_de_fato,
       round(m.cobrado, 2)                                 as cobranca_declarada,
       m.dif                                               as residuo_ml,
       round(m.prometido, 2)                               as esperado_nosso,
       null::numeric                                       as recebido,
       null::numeric                                       as residuo_nosso,
       -- 🔴 SINAL PRESERVADO: cobrado - prometido. Positivo = cobrou a mais.
       -- Truncar o lado negativo tornaria "e sempre a mais" irrefutavel.
       m.dif                                               as diferenca,
       m.data_pedido,
       -- ⚠️ `ml_order_sale_fee` NAO tem data de cobranca (so `capturado_em`, que
       -- e quando NOS ingerimos). O evento e a data do PEDIDO — escolha
       -- conservadora: aperta o relogio, nunca o afrouxa. Mesma disciplina que a
       -- onda 2 aplicou a `data_pagamento`, que e coluna morta.
       m.data_pedido                                       as data_evento,
       m.dias_restantes,
       0                                                   as n_pagamentos,
       null::text[]                                        as payment_ids,
       null::date                                          as release_date_max,
       (m.prometido is null or m.n_frete = 0)              as valor_estimado
  from mot m
  left join public.conciliacao_casos k
         on k.organization_id = p_org_id
        and k.ml_order_id     = m.ml_order_id
        and k.tipo_caso       = 'frete_a_maior';
$$;

comment on function public.conciliacao_frete_linhas(uuid, int) is
  '225-06: a TERCEIRA regua da fase — frete PROMETIDO na ficha do anuncio (list_cost vigente na '
  'data da venda) contra frete COBRADO na fatura (CFFE/CXDE/CXDED liquido de BFFE, netting de '
  'C-02). 🔴 Ela NAO e a regua dos 98,9%% do research (D-225-19): aquela compara a fatura com o '
  'que o ENVIO registrou. Esta compara com o que o ANUNCIO publicava, e e a que o Wesley pediu. '
  '⚠️ Devolve `diferenca` COM SINAL, os dois lados: sem o lado negativo a hipotese "e sempre a '
  'mais" seria impossivel de refutar pelo recorte. Tres exclusoes obrigatorias: carrinho, pedido '
  'multi-item e venda anterior a primeira captura do item. Pedido sem linha de cobranca de frete '
  'sai com `diferenca` NULA e motivo proprio — nunca zero presumido (fase 219).';

-- ═══ 3. get_casos_conciliacao — o unico corpo substituido, e sao 8 linhas ═══
--
-- 🔴 O contrato de 24 colunas NAO muda, e quem garante isso e o Postgres: o
-- CREATE OR REPLACE de funcao que devolve TABLE recusa mudanca de nome ou tipo
-- de coluna de retorno. F-05 e verificada pelo motor, nao pela disciplina.

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
   order by t.dias_restantes asc nulls last, t.diferenca desc nulls last
   -- Teto duro de 1000: o PostgREST trunca em 1000 EM SILENCIO, e a RPC nao
   -- deve nem chegar perto disso sem o chamador saber. O plano 03 pagina.
   limit  least(coalesce(p_limite, 200), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.get_casos_conciliacao(uuid, int, boolean, int, int) is
  '225-02/225-06: a fila do monitor de conciliacao, uma linha por anomalia. Contrato de 24 '
  'colunas consumido pelos planos 03, 04, 05 e 06 — inalterado. 🔴 A regua do dinheiro do ciclo '
  'venda->repasse e ML-CONTRA-ML e vive em `conciliacao_base_linhas`, que este arquivo NAO toca. '
  'O 225-06 acrescenta um QUARTO valor de tipo_caso, `frete_a_maior`, vindo de '
  '`conciliacao_frete_linhas`: frete publicado na ficha do anuncio contra frete cobrado na '
  'fatura. ⚠️ `acionavel` continua verdadeiro em pouquissimos motivos — sem_repasse_confirmado, '
  'repasse_a_menor_confirmado e frete_a_maior_confirmado — e os tres dependem de flag de '
  'configuracao ou de verificacao registrada. Tudo o mais aparece na tela com o motivo REAL e '
  'sem botao de chamado.';

-- ═══ 4. ACL — recriar funcao apaga a ACL, entao o par vai NO MESMO ARQUIVO ══
--
-- 🔴 `from anon` e EXPLICITO: revogar de PUBLIC nao desfaz o grant direto que o
-- Supabase concede a `anon`. R-08(c) da onda 2 falhou exatamente nisso.

revoke all on function public.conciliacao_frete_linhas(uuid, int) from public;
revoke all on function public.conciliacao_frete_linhas(uuid, int) from anon;
grant execute on function public.conciliacao_frete_linhas(uuid, int) to authenticated;

revoke all on function public.get_casos_conciliacao(uuid, int, boolean, int, int) from public;
revoke all on function public.get_casos_conciliacao(uuid, int, boolean, int, int) from anon;
grant execute on function public.get_casos_conciliacao(uuid, int, boolean, int, int) to authenticated;

-- ═══ 5. Guardas finais ══════════════════════════════════════════════════════

DO $$
DECLARE
  v_funcao text;
BEGIN
  FOREACH v_funcao IN ARRAY ARRAY[
    'public.conciliacao_frete_linhas(uuid,int)',
    'public.get_casos_conciliacao(uuid,int,boolean,int,int)'
  ]
  LOOP
    IF has_function_privilege('anon', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon ainda EXECUTA % — o revoke de PUBLIC nao alcanca o grant direto', v_funcao;
    END IF;
    IF NOT has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated PERDEU execute em % — recriar funcao apagou a ACL', v_funcao;
    END IF;
  END LOOP;

  -- As duas continuam INVOKER. DEFINER com parametro de organizacao e IDOR.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('conciliacao_frete_linhas','get_casos_conciliacao')
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'alguma funcao do monitor virou SECURITY DEFINER — isso e IDOR com p_org_id';
  END IF;

  -- A regua do frete nasce DESLIGADA: a direcao do desvio ainda nao foi medida.
  IF EXISTS (SELECT 1 FROM public.conciliacao_config WHERE acusar_frete_a_maior) THEN
    RAISE EXCEPTION 'acusar_frete_a_maior nasceu TRUE — F-02 ainda nao mediu a direcao do desvio';
  END IF;
END $$;
