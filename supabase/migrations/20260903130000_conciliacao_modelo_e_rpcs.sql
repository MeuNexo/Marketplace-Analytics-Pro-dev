-- ────────────────────────────────────────────────────────────────────────────
-- Fase 225, plano 225-02 — o modelo do caso e as duas RPCs do monitor de
-- conciliacao venda ↔ repasse.
--
-- 🔴 TUDO NESTE ARQUIVO SAI DE `225-CALIBRACAO.md`, MEDIDO EM 03/09/2026 CONTRA
-- PRODUCAO. Nenhuma regra aqui foi escrita por suposicao. Os cinco achados que
-- moldaram o arquivo:
--
--  C-02  O estorno esta gravado POSITIVO. No pedido 2000017811575194 cada linha
--        BONUS repete o valor EXATO do CHARGE que ela cancela, com o MESMO
--        sinal (51,29 / 0,37 / 28,35). Somar `detail_amount` direto declararia
--        R$ 159,92 de cobranca onde o liquido e ZERO. Por isso o netting
--        INVERTE o sinal — e a expressao esta escrita uma vez so, em `tar`.
--
--  C-03  🔴 A formula ML-contra-ML tem mediana de residuo 0,0000 mas so 55,3%
--        dos pedidos ficam dentro de +/- R$ 0,01, e o vazamento LIQUIDO da
--        janela viva e -R$ 14.221,84 contra +R$ 3.752,44 do lado que acusaria.
--        Uma regua assim nao tem autoridade para acusar um pedido de R$ 28,67.
--        POR ISSO EXISTE `conciliacao_config.acusar_valor_a_menor`, que nasce
--        FALSE: a RPC MEDE `residuo_ml` sempre (D-225-06), e so CLASSIFICA
--        `repasse_a_menor` como acionavel quando a linha de configuracao
--        liberar. Liberar custa um UPDATE, nao um deploy.
--
--  C-04  `orders.receita_bruta` concorda com o `gross_amount` do Mercado Pago:
--        F-A e F-B diferem por centavos. A fila "nosso erro" NAO pode ser
--        povoada por divergencia de valor — ela e povoada pelos motivos
--        NOMEADOS (sem_captura_cobranca, chave orfa, entrada sem origem,
--        fora da janela de ingestao), que sao os que de fato existem.
--
--  C-06  🔴 5 de 5 pedidos "sem repasse" da janela de 75 dias sao CHARGEBACK
--        (R$ 2.278,22, `status_detail = reimbursed`). `cash_inflows` NAO
--        guarda `charged_back` — a Edge Function so aceita cinco status.
--        Portanto "zero linha de repasse" NAO PROVA ausencia de repasse.
--        `repasse_ausente` nasce `acionavel = false`, com motivo
--        `ausencia_a_verificar`, e so vira acionavel depois de uma verificacao
--        REGISTRADA contra o Mercado Pago (colunas `verificado_no_mp` /
--        `status_mp_verificado` em `conciliacao_casos`). Sem isso, a primeira
--        tela da fase abriria 5 chamados contra o ML por evento do emissor do
--        cartao — a acusacao falsa que D-225-07 diz queimar o proximo ticket.
--
--  C-06  🔴 `orders.data_pagamento` e COLUNA MORTA: 100% NULL em 14.278
--        pedidos. NENHUM predicado deste arquivo FILTRA por ela. Ela aparece
--        so dentro de um COALESCE, e hoje o coalesce sempre cai na data do
--        pedido — o que aperta o relogio, nunca o afrouxa.
--
-- REGRAS DE SEGURANCA QUE NAO SE NEGOCIAM:
--   · as tres funcoes sao SECURITY INVOKER. Funcao de tenant com DEFINER e
--     parametro de organizacao e IDOR, e o numero de uma loja na tela da outra
--     JA ACONTECEU nesta base (feedback_supabase_security_invoker).
--   · as tres tabelas nascem com RLS e policy NO MESMO ARQUIVO. Tabela criada
--     fora de migration nasce sem protecao e o lint nao a alcanca
--     (feedback_tabela_de_execucao_nasce_sem_rls).
--   · o par REVOKE/GRANT vai ao fim do arquivo: remover funcao apaga a ACL
--     (feedback_drop_function_apaga_acl).
--
-- NENHUM UUID E SEMEADO AQUI. `conciliacao_config` nasce VAZIA — quem semeia e
-- o orquestrador, com o nome da organizacao conferido em
-- `select id, name from public.organizations`. UUID nao se completa por
-- prefixo nesta casa.
--
-- APLICACAO E PORTAO DO ORQUESTRADOR: via MCP `apply_migration` no projeto
-- ckcdevcxgvueywivefgx. NUNCA SQL Editor, NUNCA `db push`.
--
-- ⚠️ Este arquivo NAO TOCA nenhuma das 14 funcoes de caixa que leem
-- `cash_inflows`. O sinal do estorno na DRE de caixa e da Fase 237.
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ 1. conciliacao_config — a regua mora em linha de tabela ════════════════

create table if not exists public.conciliacao_config (
  organization_id       uuid        primary key references public.organizations(id) on delete cascade,
  piso_materialidade    numeric     not null default 5.00,
  dias_aguardando       int         not null default 15,
  dias_ausente          int         not null default 22,
  janela_dias           int         not null default 30,
  ingestao_inicio       date        not null default date '2026-01-28',
  acusar_valor_a_menor  boolean     not null default false,
  atualizado_em         timestamptz not null default now()
);

comment on table public.conciliacao_config is
  '225-02: a regua do monitor de conciliacao, em DADO e nao em codigo. Existe porque o piso '
  'e de ACAO e nao de MEDICAO (D-225-06): toda diferenca continua somando no vazamento total, '
  'e so acima do piso vira caso com dossie. Depois que o monitor provar valor o piso precisa '
  'ser BARATO de baixar — um UPDATE, nunca um deploy. Nasce VAZIA: quem semeia e o portao de '
  'producao, com o nome da organizacao conferido na tela.';

comment on column public.conciliacao_config.piso_materialidade is
  'Piso de ACAO em R$, por diferenca. Semeado em 5,00 (D-W-225-02, resposta do Wesley em '
  '03/09/2026). Dimensionamento medido em 225-CALIBRACAO C-08 sobre a janela viva de 30 dias: '
  'R$ 0,01 = 139 casos/R$ 3.752,44 · R$ 1 = 138 · R$ 5 = 130/R$ 3.726,69 · R$ 10 = 102 · '
  'R$ 20 = 84. A curva e rasa de proposito na leitura: o piso corta 40%% dos casos e 15%% do '
  'valor entre 0,01 e 20,00.';

comment on column public.conciliacao_config.acusar_valor_a_menor is
  '🔴 NASCE FALSE E ISSO E O RESULTADO DA CALIBRACAO, NAO UM PADRAO CONSERVADOR QUALQUER. '
  'C-03 mediu a formula ML-contra-ML na janela de 75 dias: mediana do residuo 0,0000, mas so '
  '55,3%% dos pedidos dentro de +/- R$ 0,01, media -15,00, p25 -32,26, e vazamento liquido de '
  '-R$ 14.221,84 contra +R$ 3.752,44 do lado positivo. Os "130 casos" do piso de R$ 5,00 sao '
  'a cauda direita de uma distribuicao cuja massa esta a esquerda — nao sao 130 casos, sao 130 '
  'amostras do mesmo residuo nao explicado. A hipotese aberta e o frete (CFFE medio R$ 33,28 '
  'contra p25 do residuo -R$ 32,26, diferenca de R$ 1,02): a fatura do ML cobra frete que o '
  'Mercado Pago nao retem no pagamento. O teste esta escrito como C-03b. Enquanto ele nao '
  'voltar, a RPC MEDE residuo_ml e nao ACUSA ninguem por ele.';

comment on column public.conciliacao_config.ingestao_inicio is
  'Data antes da qual nada pode ser reportado como repasse ausente. Semeada em 2026-01-28, que '
  'e MAIS RESTRITIVA que a borda medida (min(release_date) = 2025-12-27, C-07a) — ser mais '
  'restritivo nunca fabrica acusacao, o contrario sim. ⚠️ A justificativa historica MUDOU: a '
  'premissa de D-225-15 ("janeiro tem 103 repasses, e buraco nosso") foi REFUTADA pela onda 1; '
  'janeiro/2026 tem hoje 98,5%% de cobertura (C-07c). O mes de fato incompleto e dez/2025, com '
  '43,4%%. A regra sobrevive por outro fundamento: janeiro esta ~7 meses fora da janela de 30 '
  'dias de D-225-01 e nao poderia virar caso de qualquer forma.';

comment on column public.conciliacao_config.dias_ausente is
  'Dias desde a data do evento a partir dos quais a ausencia de repasse deixa de ser espera '
  'normal. 22 = p95 do atraso aprovacao->liberacao medido em 1.885 pagamentos (mediana 10d, '
  'p90 14,9d, p95 28d). ⚠️ Cruzar este corte NAO torna o caso acionavel: ver C-06 e a coluna '
  'conciliacao_casos.verificado_no_mp.';

alter table public.conciliacao_config enable row level security;

drop policy if exists conciliacao_config_select on public.conciliacao_config;
create policy conciliacao_config_select on public.conciliacao_config
  for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

drop policy if exists conciliacao_config_write on public.conciliacao_config;
create policy conciliacao_config_write on public.conciliacao_config
  for all to authenticated
  using      (public.is_org_member(auth.uid(), organization_id)
              and public.get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]))
  with check (public.is_org_member(auth.uid(), organization_id)
              and public.get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]));

-- ═══ 2. conciliacao_casos — o desfecho rastreado (D-225-13) ═════════════════

create table if not exists public.conciliacao_casos (
  id                    uuid        primary key default gen_random_uuid(),
  organization_id       uuid        not null references public.organizations(id) on delete cascade,
  ml_user_id            bigint      null,
  ml_order_id           text        not null,
  tipo_caso             text        not null,
  estado                text        not null default 'aberto',
  valor_diferenca       numeric     null,
  valor_recuperado      numeric     null,
  data_evento           date        null,
  contestado_em         date        null,
  desfecho_em           date        null,
  -- 🔴 As tres colunas de verificacao existem por causa de C-06: 5 de 5 pedidos
  -- "sem repasse" eram chargeback. `cash_inflows` nao guarda `charged_back`,
  -- logo o banco SOZINHO nao consegue distinguir ausencia real de contestacao
  -- de cartao. Sem verificacao registrada, a ausencia nao e acionavel.
  verificado_no_mp      boolean     not null default false,
  status_mp_verificado  text        null,
  verificado_em         date        null,
  observacao            text        null,
  criado_por            uuid        null,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),

  constraint conciliacao_casos_tipo_chk check (tipo_caso in (
    'repasse_ausente', 'repasse_a_menor', 'entrada_sem_origem', 'frete_a_maior'
  )),
  constraint conciliacao_casos_estado_chk check (estado in (
    'aberto', 'contestado', 'ganho', 'negado', 'resolvido_sozinho', 'expirado'
  )),
  constraint conciliacao_casos_unico unique (organization_id, ml_order_id, tipo_caso)
);

comment on table public.conciliacao_casos is
  '225-02: um caso por par (pedido, tipo). D-225-13 — sem desfecho rastreado nao se sabe '
  'quanto o ML devolveu de fato nem que tipo de caso ele aceita. O check de tipo_caso ja aceita '
  'os QUATRO tipos, inclusive `frete_a_maior`, para que o plano 06 nao precise de migration so '
  'para acrescentar um valor.';

comment on column public.conciliacao_casos.estado is
  '🔴 `resolvido_sozinho` e `expirado` sao DERIVADOS PELO SISTEMA e nunca escolhidos pelo '
  'usuario (UI-SPEC, Problema de Design 5). resolvido_sozinho = o repasse chegou depois da '
  'abertura do caso; expirado = dias_restantes cruzou zero sem desfecho. Caso ja em '
  '`contestado` NAO vira resolvido_sozinho: quem fecha um chamado aberto e o usuario.';

comment on column public.conciliacao_casos.verificado_no_mp is
  '🔴 O portao que separa ausencia REAL de chargeback. Medido em 225-CALIBRACAO C-06: os 5 '
  'unicos pedidos da janela de 75 dias com zero linha em cash_inflows voltaram 5/5 '
  '`charged_back` / `reimbursed` na API do Mercado Pago (R$ 2.278,22). Como a Edge Function '
  'so aceita cinco status e `charged_back` nao e um deles, "sem linha de repasse" NAO prova '
  'ausencia. Enquanto esta coluna for false, o caso aparece na tela com motivo '
  '`ausencia_a_verificar` e acionavel = false.';

comment on column public.conciliacao_casos.status_mp_verificado is
  'O `status` que a API do Mercado Pago devolveu para o pedido. `charged_back`, `cancelled` e '
  '`refunded` tiram o caso da fila e o mandam para o rodape (D-W-225-01: fora do monitor, mas '
  'NOMEADO). Qualquer outro valor, com verificado_no_mp = true, torna a ausencia acionavel.';

create index if not exists conciliacao_casos_org_estado_idx
  on public.conciliacao_casos (organization_id, estado);

alter table public.conciliacao_casos enable row level security;

drop policy if exists conciliacao_casos_select on public.conciliacao_casos;
create policy conciliacao_casos_select on public.conciliacao_casos
  for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

drop policy if exists conciliacao_casos_write on public.conciliacao_casos;
create policy conciliacao_casos_write on public.conciliacao_casos
  for all to authenticated
  using      (public.is_org_member(auth.uid(), organization_id)
              and public.get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]))
  with check (public.is_org_member(auth.uid(), organization_id)
              and public.get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]));

-- ═══ 3. mp_saidas — nasce VAZIA e de proposito ══════════════════════════════

create table if not exists public.mp_saidas (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations(id) on delete cascade,
  ml_user_id          bigint      null,
  source_id           text        null,
  external_reference  text        null,
  ml_order_id         text        null,
  data_movimento      date        not null,
  tipo                text        null,
  descricao           text        null,
  valor               numeric     not null,
  payload             jsonb       null,
  capturado_em        timestamptz not null default now(),

  constraint mp_saidas_unico unique (organization_id, source_id)
);

comment on table public.mp_saidas is
  '225-02: as SAIDAS da conta do Mercado Pago (D-225-09). Nasce VAZIA E DE PROPOSITO — e ela '
  'que torna a flag de capacidade um DADO em vez de um comentario no codigo: enquanto nao '
  'houver linha na janela, `get_conciliacao_resumo.saidas_auditadas` devolve false e a tela '
  'declara que as saidas nao sao auditadas (UI-SPEC, Problema de Design 6c). O banner some '
  'sozinho quando a ingestao do plano 04 gravar a primeira linha; ninguem precisa lembrar de '
  'apagar constante nenhuma. As colunas sao MINIMAS e genericas porque o formato do relatorio '
  'de liberacoes do MP ainda nao foi lido — o plano 04 pode ACRESCENTAR colunas, e `payload` '
  'existe justamente para absorver o que nao foi previsto.';

create index if not exists mp_saidas_org_data_idx
  on public.mp_saidas (organization_id, data_movimento);

alter table public.mp_saidas enable row level security;

drop policy if exists mp_saidas_select on public.mp_saidas;
create policy mp_saidas_select on public.mp_saidas
  for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

-- Nenhuma policy de escrita para `authenticated`: a escrita e exclusiva do papel
-- de servico, que passa por cima de RLS por definicao. Mesma disciplina de
-- `cash_inflows`, que e a tabela irma desta.

revoke all on public.conciliacao_config from anon;
revoke all on public.conciliacao_casos  from anon;
revoke all on public.mp_saidas          from anon;

grant select                         on public.conciliacao_config to authenticated;
grant select, insert, update, delete on public.conciliacao_casos  to authenticated;
grant select                         on public.mp_saidas          to authenticated;

-- ═══ 4. A funcao base — fonte unica das linhas do monitor ═══════════════════
--
-- POR QUE UMA TERCEIRA FUNCAO: as duas RPCs publicas precisam do MESMO conjunto
-- de linhas — uma pagina, a outra agrega. Duplicar as CTEs em dois corpos e
-- exatamente a classe de defeito que esta fase existe para combater: duas
-- copias da mesma aritmetica que divergem em silencio (foi o que custou
-- R$ 3,85 por pedido no retrabalho da 222). A regra fica escrita UMA vez.
-- E o resumo nao pode passar pela RPC de lista porque a lista tem teto duro de
-- 1000 linhas — agregar sobre uma pagina truncada mentiria no total.

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
-- Varredura: janela + 45 dias de folga, porque a cobranca do ML chega com
-- defasagem medida de ate 47 dias (D-225-04) e o relogio corre do EVENTO.
-- ⚠️ orders.data_pedido e TEXT com carimbo de hora. Filtro por FAIXA DE STRING,
-- inicio inclusivo e fim exclusivo no dia seguinte; conversao para data so
-- DEPOIS de filtrar — expressao no lado esquerdo cega o indice de uma coluna
-- que ja e divida de performance conhecida.
pedidos as (
  select o.ml_order_id,
         max(o.titulo)                        as titulo,
         max(o.sku)                           as sku,
         sum(o.quantidade)::int               as quantidade,
         sum(o.receita_bruta)                 as receita_bruta,
         max(o.comprador)                     as comprador,
         (left(min(o.data_pedido), 10))::date as data_pedido,
         -- 🔴 `data_pagamento` e COLUNA MORTA (100% NULL, C-06). Ela NUNCA
         -- aparece num WHERE deste arquivo — so aqui, dentro de um COALESCE que
         -- hoje sempre cai na data do pedido. Como o pedido antecede a
         -- aprovacao, o relogio fica mais APERTADO, nunca mais frouxo.
         coalesce((left(max(o.data_pagamento), 10))::date,
                  (left(min(o.data_pedido), 10))::date) as data_evento_venda
    from public.orders o
   where o.organization_id = p_org_id
     and o.status in ('paid','shipped','delivered')
     and o.data_pedido >= to_char((select hoje - (janela + 45) from cfg), 'YYYY-MM-DD')
     and o.data_pedido <  to_char((select hoje + 1 from cfg), 'YYYY-MM-DD')
   group by o.ml_order_id
),
-- 🔴 GROUP BY, NUNCA join 1:1. Split payment e estrutural: 224 pedidos de 9.389
-- tem mais de um pagamento (2,39% da base; 7,7% na janela 01/07-03/09 — os dois
-- numeros estao certos, os denominadores diferem). Um join 1:1 transformaria
-- cada um deles num "repasse a menor" falso.
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
-- 🔴 A EXPRESSAO DE NETTING. Copiada literalmente do veredito de C-02, nao
-- escrita de memoria. O predicado e mais largo do que a medicao exigiria de
-- proposito: hoje BONUS e charge_bonified_id coincidem 299/299, mas a Fase 223
-- registrou que BONUS carrega DUAS coisas — estorno de cancelamento (com
-- bonified_id) e PROMOCAO (sem ele) —, e promocao tambem reduz o que foi
-- cobrado. O predicado largo continua certo se aparecer promocao; o estreito
-- passaria a somar cobranca que o ML nao fez.
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
         -- Guarda do carrinho. C-05 mediu 0,0% na janela (nenhum pedido sem
         -- repasse divide comprador e dia com outro), mas a guarda fica: negar
         -- alguns casos verdadeiros e aceitavel, acusar em cima de um pacote nao.
         count(p.comprador) over (partition by p.comprador, p.data_pedido) as n_no_grupo
    from pedidos p
    left join rep r on r.ml_order_id = p.ml_order_id
    left join tar t on t.ml_order_id = p.ml_order_id
),
ev as (
  select c.*,
         -- D-225-01/D-225-04: o relogio corre do EVENTO, nao da venda.
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
-- A verificacao contra o Mercado Pago, quando ela existe. Join restrito ao tipo
-- para nao multiplicar linha: a unicidade e (org, pedido, tipo).
mot as (
  select x.*,
         case
           -- 1. Fora da janela de ingestao NUNCA vira caso, em nenhuma hipotese.
           when x.data_evento < (select ingestao_inicio from cfg)
                then 'fora_da_janela_de_ingestao'
           -- 2. Mediacao fica fora do monitor (D-225-08), contada no rodape.
           when x.tem_mediacao
                then 'fora_do_escopo'
           -- 3. Sem repasse: a cascata que C-06 reescreveu.
           when not x.tem_repasse and x.n_no_grupo > 1
                then 'possivel_carrinho'
           when not x.tem_repasse and x.dias_desde < (select dias_ausente from cfg)
                then 'aguardando_liberacao'
           when not x.tem_repasse and coalesce(kv.verificado_no_mp, false)
                and kv.status_mp_verificado in ('charged_back','cancelled','refunded')
                then 'fora_do_escopo'
           when not x.tem_repasse and coalesce(kv.verificado_no_mp, false)
                then 'sem_repasse_confirmado'
           -- 🔴 O default da ausencia NAO e acusar: e verificar. C-06 mediu 5/5
           -- chargeback entre os candidatos, e cash_inflows nao guarda esse status.
           when not x.tem_repasse
                then 'ausencia_a_verificar'
           -- 4. Liberacao futura e observavel direto, sem estimar nada.
           --    ⚠️ C-05 achou release_date = 2026-10-01 com hoje = 2026-09-03.
           when x.tem_aprovado and x.release_date_max > (select hoje from cfg)
                then 'aguardando_liberacao'
           -- 5. Sem captura de cobranca e lacuna NOSSA, nunca erro do ML.
           when x.declarado is null
                then 'sem_captura_cobranca'
           -- 6. Valor a menor — so acusa se a linha de configuracao liberar.
           when x.residuo_ml > (select piso from cfg) and (select acusar from cfg)
                then 'repasse_a_menor_confirmado'
           when x.residuo_ml > (select piso from cfg)
                then 'regua_nao_liberada'
           -- 7. A regra de D-225-07. C-04 mediu que ela quase nunca dispara,
           --    porque receita_bruta concorda com o gross do MP — fica ligada
           --    de qualquer forma, para o dia em que divergir.
           when abs(x.residuo_ml) <= (select piso from cfg)
                and abs(x.residuo_nosso) > (select piso from cfg)
                then 'divergencia_da_nossa_base'
           -- 8. Abaixo do piso: a linha CONTINUA existindo e continua somando
           --    no vazamento total (D-225-06). O piso e de acao, nao de medicao.
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
-- Entradas sem pedido (D-225-10) e chaves orfas (C-05). Tres nomes, todos
-- derivados de medicao: `marketplace_shipment` e repasse de frete com chave de
-- 11 digitos; gross = net significa que nenhuma comissao foi cobrada, logo NAO
-- e venda de marketplace (12 de 12 assim, C-09); o resto tem titulo de produto
-- e e venda cuja chave nao foi capturada.
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
       -- 🔴 ACIONAVEL E DOIS MOTIVOS, E SO DOIS. `ausencia_a_verificar` aparece
       -- na tela mas NAO e acionavel (C-06: 5/5 chargeback).
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
       round(case when l.tipo_calc = 'repasse_ausente' then l.receita_bruta
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

comment on function public.conciliacao_base_linhas(uuid, int) is
  '225-02: fonte unica das linhas do monitor de conciliacao. NAO e para o front — quem o front '
  'chama e get_casos_conciliacao / get_conciliacao_resumo. Existe para que a regra de '
  'classificacao seja escrita UMA vez: duas copias da mesma aritmetica divergindo em silencio '
  'e a classe de defeito que esta fase existe para combater. Roda como INVOKER (jamais como '
  'definidor): a RLS de orders, cash_inflows e ml_order_sale_fee continua decidindo o que este '
  'usuario ve.';

-- ═══ 5. get_casos_conciliacao — a lista paginada ════════════════════════════
--
-- 🔴 SECURITY INVOKER, sempre. Funcao de tenant com DEFINER e parametro de
-- organizacao e IDOR — e o numero de uma loja na tela da outra JA ACONTECEU
-- nesta base. O `p_org_id` aqui NAO e fonte de confianca: ele recorta, e quem
-- autoriza e a RLS das tabelas de origem, sob o papel de quem chamou.

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
  select b.*
    from public.conciliacao_base_linhas(p_org_id, p_janela_dias) b
   where (not p_apenas_acionaveis) or b.acionavel
   -- D-225-03: a fila ordena por dias restantes ate expirar, nunca por valor.
   -- Um caso de R$ 2 mil com 2 dias de vida vale mais atencao que um de R$ 5 mil
   -- com 25. Nulo por ultimo; a diferenca so desempata.
   order by b.dias_restantes asc nulls last, b.diferenca desc nulls last
   -- Teto duro de 1000: o PostgREST trunca em 1000 EM SILENCIO, e a RPC nao
   -- deve nem chegar perto disso sem o chamador saber. O plano 03 pagina.
   limit  least(coalesce(p_limite, 200), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.get_casos_conciliacao(uuid, int, boolean, int, int) is
  '225-02: a fila do monitor de conciliacao, uma linha por anomalia. Contrato de 24 colunas '
  'consumido pelos planos 03, 04, 05 e 06. 🔴 A regua do dinheiro e ML-CONTRA-ML: '
  '`retido_de_fato` = soma(gross) - soma(net) de cash_inflows, `cobranca_declarada` = soma de '
  'detail_amount de ml_order_sale_fee liquida de estorno. As duas pontas sao do proprio '
  'Mercado Livre, e nenhum cadastro nosso participa da acusacao — por isso o bug ativo do '
  'campo POR UNIDADE da Fase 234 nao consegue fabricar um caso aqui. ⚠️ `acionavel` e '
  'verdadeiro em apenas DOIS motivos: sem_repasse_confirmado e repasse_a_menor_confirmado. '
  'Tudo o mais aparece na tela com o motivo REAL e sem botao de chamado.';

-- ═══ 6. get_conciliacao_resumo — uma linha, a regua ecoada ══════════════════

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
  ultima_sync              timestamptz
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
       -- D-225-06: o vazamento soma TODAS as diferencas, inclusive as abaixo do
       -- piso. O piso e de ACAO, nunca de medicao.
       coalesce(sum(b.diferenca) filter (where b.tipo_caso <> 'entrada_sem_origem'), 0) as vazamento_total,
       count(*) filter (where b.motivo = 'abaixo_do_piso')::int                    as sub_piso_n,
       coalesce(sum(b.diferenca) filter (where b.motivo = 'abaixo_do_piso'), 0)    as sub_piso_soma,
       count(*) filter (where b.fila = 'nosso' and b.tipo_caso <> 'entrada_sem_origem')::int as nosso_erro_n,
       coalesce(sum(b.diferenca) filter (where b.fila = 'nosso' and b.tipo_caso <> 'entrada_sem_origem'), 0) as nosso_erro_soma,
       -- Mediacao (D-225-08) e contestacao de cartao (D-W-225-01): fora do
       -- monitor, mas NOMEADOS. O rodape da tela le estes dois campos.
       count(*) filter (where b.motivo = 'fora_do_escopo')::int                    as fora_escopo_n,
       coalesce(sum(b.diferenca) filter (where b.motivo = 'fora_do_escopo'), 0)    as fora_escopo_soma,
       count(*) filter (where b.tipo_caso = 'entrada_sem_origem')::int             as entradas_sem_origem_n,
       coalesce(sum(b.diferenca) filter (where b.tipo_caso = 'entrada_sem_origem'), 0) as entradas_sem_origem_soma,
       count(*) filter (where b.motivo = 'ausencia_a_verificar')::int              as a_verificar_n,
       coalesce(sum(b.diferenca) filter (where b.motivo = 'ausencia_a_verificar'), 0) as a_verificar_soma,
       (select coalesce(sum(k.valor_recuperado), 0) from public.conciliacao_casos k
         where k.organization_id = p_org_id and k.estado = 'ganho')                as recuperado_total,
       -- 🔴 Flag de capacidade DERIVADA DE DADO, nao de constante no codigo:
       -- enquanto mp_saidas nao tiver linha na janela, a tela declara que as
       -- saidas nao sao auditadas (UI-SPEC, Problema de Design 6c).
       (exists (select 1 from public.mp_saidas s
                 where s.organization_id = p_org_id
                   and s.data_movimento >= (select hoje - janela from cfg)))       as saidas_auditadas,
       (select ingestao_inicio from cfg)                                           as ingestao_inicio,
       (select piso from cfg)                                                      as piso_materialidade,
       (select acusar from cfg)                                                    as acusar_valor_a_menor,
       (select dias_aguardando from cfg)                                           as dias_aguardando,
       (select dias_ausente from cfg)                                              as dias_ausente,
       (select max(ci.synced_at) from public.cash_inflows ci
         where ci.organization_id = p_org_id)                                      as ultima_sync
  from b;
$$;

comment on function public.get_conciliacao_resumo(uuid, int) is
  '225-02: uma linha com o resumo do monitor. Devolve a REGUA junto dos numeros — piso, cortes '
  'de dias, inicio da ingestao e o estado de `acusar_valor_a_menor` — para que a tela diga qual '
  'regra esta valendo sem repetir o numero em codigo. `saidas_auditadas` e derivada de existir '
  'linha em mp_saidas, nunca de constante. `fora_escopo_*` e `a_verificar_*` existem para que '
  'mediacao e contestacao de cartao fiquem FORA da fila mas NOMEADAS no rodape (D-225-08, '
  'D-W-225-01) — o que nao e lacuna nao some de vista.';

-- ═══ 7. Grants — o par explicito, porque remover funcao apaga a ACL ═════════

revoke all on function public.conciliacao_base_linhas(uuid, int) from public;
grant execute on function public.conciliacao_base_linhas(uuid, int) to authenticated;

revoke all on function public.get_casos_conciliacao(uuid, int, boolean, int, int) from public;
grant execute on function public.get_casos_conciliacao(uuid, int, boolean, int, int) to authenticated;

revoke all on function public.get_conciliacao_resumo(uuid, int) from public;
grant execute on function public.get_conciliacao_resumo(uuid, int) to authenticated;

-- ═══ 8. Guardas — falha alto em vez de aplicar pela metade ══════════════════

do $$
declare
  v_tabela  text;
  v_rls     boolean;
  v_pol     int;
  v_funcao  text;
  v_definer boolean;
begin
  foreach v_tabela in array array['conciliacao_config','conciliacao_casos','mp_saidas']
  loop
    select c.relrowsecurity into v_rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = v_tabela;

    if v_rls is not true then
      raise exception 'tabela % nao tem seguranca de linha ligada', v_tabela;
    end if;

    select count(*) into v_pol
      from pg_policies where schemaname = 'public' and tablename = v_tabela;

    if v_pol = 0 then
      raise exception 'tabela % nao tem nenhuma policy', v_tabela;
    end if;

    select count(*) into v_pol
      from pg_policies
     where schemaname = 'public' and tablename = v_tabela
       and (qual is null or qual not ilike '%is_org_member%');

    if v_pol > 0 then
      raise exception 'tabela % tem policy sem checagem de organizacao', v_tabela;
    end if;
  end loop;

  foreach v_funcao in array array['conciliacao_base_linhas','get_casos_conciliacao','get_conciliacao_resumo']
  loop
    select p.prosecdef into v_definer
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_funcao;

    if v_definer is null then
      raise exception 'funcao % nao existe', v_funcao;
    end if;

    if v_definer is true then
      raise exception 'funcao % esta com prosecdef = true (definidor de seguranca) — e IDOR nesta base', v_funcao;
    end if;
  end loop;

  -- A configuracao nasce VAZIA: quem semeia e o portao de producao, com o nome
  -- da organizacao conferido na tela.
  if exists (select 1 from public.conciliacao_config) then
    raise exception 'conciliacao_config nao pode nascer com linhas — a semeadura e portao de producao';
  end if;

  -- mp_saidas nasce vazia de proposito: e ela que faz `saidas_auditadas` ser
  -- dado em vez de comentario.
  if exists (select 1 from public.mp_saidas) then
    raise exception 'mp_saidas nao pode nascer com linhas — a flag de capacidade depende disso';
  end if;
end $$;
