-- 231-02 — O calendário de lote do fornecedor como dado de primeira classe.
--
-- Hoje o sistema tem UM número para saber quando a mercadoria chega:
-- `replenishment_params.lead_time_dias`. Ele mente por desenho, porque a Pralana
-- não entrega continuamente — entrega por LOTE DE MATERIAL. Boina e boné na 1ª
-- quinzena de outubro, feltro e palha na 1ª de novembro, tecido na 1ª de
-- dezembro (último lote de 2026), e depois ela PARA até início de março.
--
-- Três tabelas:
--   supplier_calendars — o ano do fornecedor, incluindo quando ele FECHA. É ela
--     que faz o sistema saber que não existe pedido que chegue em janeiro, em
--     vez de inferir isso de uma ausência de linha.
--   supplier_lots      — um lote por material, com data de entrega e data de
--     corte do pedido.
--   product_materials  — o material do produto como DADO. O cadastro escreve
--     "Felt" e "Cotton", em inglês, e cinco modelos não dizem o material
--     nenhuma. Procurar '%feltro%' no título foi o erro cometido em 24/08/2026.
--
-- 🔴 RLS: tabela criada por execução avulsa NASCE SEM RLS e o lint do Supabase
-- não pega esse caso (registro de 05/08/2026). As três ligam RLS explicitamente
-- e copiam, literalmente, as duas políticas de `replenishment_params`.
--
-- Idempotente de ponta a ponta: `create table if not exists`, `drop policy if
-- exists` antes de cada `create policy`, e todo insert com `on conflict do
-- nothing`. Reaplicar não estraga nada.

-- ---------------------------------------------------------------------------
-- 1. supplier_calendars
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_calendars (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null,
  fornecedor              text not null,
  ano                     int  not null,
  -- `para_em` / `retoma_em`: o fornecedor declarou que para de entregar e
  -- quando volta. Isto é um FATO afirmado pela fábrica.
  para_em                 date,
  retoma_em               date,
  -- `calendario_valido_de` / `_ate`: o horizonte em que ESTE calendário é
  -- declarado COMPLETO. Fora dele, "não há lote" significa "não sei" — que é o
  -- oposto de "a fábrica não entrega". As duas coisas não podem compartilhar a
  -- mesma resposta, e é esta distinção que separa ignorância de afirmação.
  calendario_valido_de    date,
  calendario_valido_ate   date,
  regra_pedido_misto      text,
  fonte                   text,
  -- 🔴 A data de corte de cada lote é PERGUNTA ABERTA (Q1 do 231-CONTEXT). Sem
  -- um default, `proxima_janela` ficaria sem régua e o plano travaria numa
  -- pergunta que não é dele. Com ele, a régua existe desde o primeiro dia,
  -- declarada como ESTIMATIVA DA CASA e não como palavra da fábrica, e a
  -- resposta real vira um UPDATE de uma linha quando chegar.
  -- O 30 sai do lead mais curto observado nas OCs Pralana recentes (87 dias)
  -- contra a distância típica entre lotes. `fonte` registra que ele é nosso.
  corte_padrao_dias_antes int  not null default 30,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint supplier_calendars_org_forn_ano_key unique (organization_id, fornecedor, ano)
);

create index if not exists supplier_calendars_org_forn_idx
  on public.supplier_calendars (organization_id, fornecedor);

alter table public.supplier_calendars enable row level security;

drop policy if exists supplier_calendars_select on public.supplier_calendars;
create policy supplier_calendars_select on public.supplier_calendars
  for select using (is_org_member(auth.uid(), organization_id));

drop policy if exists supplier_calendars_write on public.supplier_calendars;
create policy supplier_calendars_write on public.supplier_calendars
  for all
  using      (get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]))
  with check (get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]));

-- ---------------------------------------------------------------------------
-- 2. supplier_lots
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_lots (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  calendar_id           uuid references public.supplier_calendars(id) on delete cascade,
  fornecedor            text not null,
  material              text not null,
  lote_nome             text not null,
  data_entrega_prevista date not null,
  -- Nulo aqui significa "NÃO SEI", não "não tem corte". Quem lê cai no
  -- `corte_padrao_dias_antes` do calendário e marca a resposta como ESTIMADA.
  data_corte_pedido     date,
  aceita_complemento    boolean not null default false,
  complemento_ate       date,
  ultimo_lote_do_ano    boolean not null default false,
  observacao            text,
  fonte                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint supplier_lots_org_forn_mat_data_key
    unique (organization_id, fornecedor, material, data_entrega_prevista),
  -- Configuração incoerente tem de ser IMPOSSÍVEL, não só improvável: uma data
  -- de complemento com `aceita_complemento` falso deixaria `proxima_janela`
  -- decidindo entre dois dados que se contradizem.
  constraint supplier_lots_complemento_coerente
    check (aceita_complemento or complemento_ate is null)
);

create index if not exists supplier_lots_org_forn_data_idx
  on public.supplier_lots (organization_id, fornecedor, data_entrega_prevista);

alter table public.supplier_lots enable row level security;

drop policy if exists supplier_lots_select on public.supplier_lots;
create policy supplier_lots_select on public.supplier_lots
  for select using (is_org_member(auth.uid(), organization_id));

drop policy if exists supplier_lots_write on public.supplier_lots;
create policy supplier_lots_write on public.supplier_lots
  for all
  using      (get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]))
  with check (get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]));

-- ---------------------------------------------------------------------------
-- 3. product_materials
-- ---------------------------------------------------------------------------
create table if not exists public.product_materials (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  marca           text not null,
  -- O prefixo numérico do SKU É o código de modelo da Pralana (medido em
  -- 24/08/2026): 22 códigos cobrem o catálogo inteiro. Chave curta e estável —
  -- muito melhor que casar título, que muda a cada reescrita de anúncio.
  codigo_modelo   text not null,
  modelo_nome     text,
  material        text not null,
  -- `fonte` distingue o que veio do título do que veio da boca do Wesley, e
  -- `confirmado_por`/`confirmado_em` deixam isso auditável daqui a seis meses.
  fonte           text not null,
  confirmado_por  text,
  confirmado_em   date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint product_materials_org_marca_codigo_key unique (organization_id, marca, codigo_modelo)
);

create index if not exists product_materials_org_marca_idx
  on public.product_materials (organization_id, marca);

alter table public.product_materials enable row level security;

drop policy if exists product_materials_select on public.product_materials;
create policy product_materials_select on public.product_materials
  for select using (is_org_member(auth.uid(), organization_id));

drop policy if exists product_materials_write on public.product_materials;
create policy product_materials_write on public.product_materials
  for all
  using      (get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]))
  with check (get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]));

-- ---------------------------------------------------------------------------
-- 4. Seed — calendário Pralana 2026 (Pé Vermeio)
-- ---------------------------------------------------------------------------
-- Fonte: mensagem da fábrica em 24/08/2026 + confirmação do Wesley na mesma
-- data. `fornecedor` é o nome EXATO que está em `purchase_orders`, senão o
-- casamento com o lead medido não fecha.
insert into public.supplier_calendars (
  organization_id, fornecedor, ano, para_em, retoma_em,
  calendario_valido_de, calendario_valido_ate, regra_pedido_misto, fonte,
  corte_padrao_dias_antes
) values (
  '7f615df7-7bac-45e5-8a93-827fb9ddeec7',
  'PRALANA INDUSTRIA E COMERCIO LTDA',
  2026,
  '2026-12-31',   -- para de entregar no FINAL de dezembro
  '2027-03-01',   -- volta a entregar em INÍCIO de março
  '2026-08-24',
  '2026-12-31',   -- fora daqui o calendário NÃO afirma nada
  'enviar pedidos em separado, porém respeitando o valor de faturamento mínimo. Caso o pedido não venha sem separar, o prazo de entrega vai seguir o da data mais longa.',
  'msg da fabrica 24/08/2026 + confirmacao do Wesley. corte_padrao_dias_antes=30 e ESTIMATIVA DA CASA, nao palavra da fabrica: a data de corte de cada lote foi perguntada em 25/08/2026 e ainda nao foi respondida.',
  30
)
on conflict (organization_id, fornecedor, ano) do nothing;

-- Os QUATRO lotes da mensagem da fábrica, em CINCO linhas. `lote_nome` guarda
-- os quatro nomes da mensagem — `count(distinct lote_nome)` é 4 — e as cinco
-- linhas existem porque o lote de OUTUBRO cobre DOIS materiais (boina militar e
-- bonés) e `material` é singular: `proxima_janela('BONE')` precisa ter resposta,
-- e enfiar "BOINA e BONE" num campo de texto tiraria isso do sistema. Boina e
-- boné compartilham o mesmo `lote_nome` justamente para não virarem dois lotes.
--
-- `data_entrega_prevista` no dia 15: é o ÚLTIMO dia da "1ª quinzena" que a
-- fábrica citou — estimativa conservadora dentro do que ela disse, e a
-- `observacao` registra que a precisão é nossa, não dela.
--
-- `data_corte_pedido` fica NULO nos cinco: é o Q1 em aberto. Nulo é "não sei", e
-- `proxima_janela()` trata isso de forma explícita, caindo no
-- `corte_padrao_dias_antes` e MARCANDO a resposta como estimada.
insert into public.supplier_lots (
  organization_id, calendar_id, fornecedor, material, lote_nome,
  data_entrega_prevista, data_corte_pedido, aceita_complemento, complemento_ate,
  ultimo_lote_do_ano, observacao, fonte
)
select
  c.organization_id, c.id, c.fornecedor, v.material, v.lote_nome,
  v.data_entrega, null::date, false, null::date,
  v.ultimo, v.observacao,
  'msg da fabrica 24/08/2026; data de corte NAO respondida ate 24/08 — cai no corte_padrao_dias_antes do calendario'
from public.supplier_calendars c
cross join (values
  ('BOINA',  '1a quinzena OUT/2026 - boina e bone', date '2026-10-15', false,
   'Lote de outubro cobre boina militar E bones. Dia 15 e o ultimo dia da 1a quinzena — a fabrica disse "1a quinzena", a precisao do dia e nossa.'),
  ('BONE',   '1a quinzena OUT/2026 - boina e bone', date '2026-10-15', false,
   'Mesmo lote da boina militar. Dia 15 e o ultimo dia da 1a quinzena — precisao do dia e nossa.'),
  ('FELTRO', '1a quinzena NOV/2026 - feltro', date '2026-11-15', false,
   'Maior linha da PV. Pode ir no MESMO pedido da palha (mesma data, confirmado). Misturar com TECIDO joga o feltro para dezembro pela regra da data mais longa. Este lote cobre nov, dez, jan e fev — quatro meses, porque a fabrica para no fim de dezembro.'),
  ('PALHA',  '1a quinzena NOV/2026 - palha', date '2026-11-15', false,
   'Mesma data do feltro — palha PODE ir junto com feltro, confirmado pela fabrica. ATENCAO: entrega rapida do Bangora esta SUSPENSA, e e a linha que mais cresce (207 un em jun-jul/26 contra 31 em 2025). Sem plano B se faltar.'),
  ('TECIDO', '1a quinzena DEZ/2026 - tecido', date '2026-12-15', true,
   'ULTIMO LOTE DE 2026. Depois dele a fabrica so volta a entregar em inicio de marco/2027.')
) as v(material, lote_nome, data_entrega, ultimo, observacao)
where c.organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'
  and c.fornecedor = 'PRALANA INDUSTRIA E COMERCIO LTDA'
  and c.ano = 2026
on conflict (organization_id, fornecedor, material, data_entrega_prevista) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Seed — material por código de modelo (Pralana, Pé Vermeio)
-- ---------------------------------------------------------------------------
-- Vinte códigos. Os DOIS que faltam para fechar os 22 do catálogo — `12012462`
-- (Arizona Trend Ana Castela) e `12012489` (Arena New), 18 SKUs entre eles —
-- ficam DE FORA de propósito: o título de nenhum dos dois diz o material e
-- nenhum está na lista que o Wesley confirmou. A ausência deles é o que faz o
-- leitor devolver `desconhecido` e PERGUNTAR, em vez de chutar.
insert into public.product_materials (
  organization_id, marca, codigo_modelo, modelo_nome, material, fonte, confirmado_por, confirmado_em
) values
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','18012849',     'Bangora Rodeo Cross 2',            'PALHA', 'titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','13011457',     'Boina Bandeirantes 100% La',       'BOINA', 'titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','14724',        'Arizona Rope Ride Feltro',         'FELTRO','titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','12011598',     'Arena Felt',                       'FELTRO','titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','12011666',     'Arizona VI Rodeio',                'FELTRO','confirmacao Wesley 24/08/2026','Wesley','2026-08-24'),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','12012422',     'Champion Felt Biplay',             'FELTRO','titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','11012336',     'Classic 5x Campo III Gustavo Lima','FELTRO','confirmacao Wesley 24/08/2026','Wesley','2026-08-24'),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','12012485',     'American Horse de Feltro de La',   'FELTRO','confirmacao Wesley 24/08/2026','Wesley','2026-08-24'),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','11011273',     '5x Classic Campo Gustavo Lima',    'FELTRO','confirmacao Wesley 24/08/2026','Wesley','2026-08-24'),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','11012335',     'Classic 5x Campo 2 Feltro',        'FELTRO','titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','18012895',     'Journey Bangora',                  'PALHA', 'titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','110123573274', 'Gold 5x 100% La',                  'FELTRO','titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','110123573360', 'Gold 5x 100% La',                  'FELTRO','titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','12012459',     'Cross Barretos Feltro',            'FELTRO','titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','127123270',    'Bangora Bankok Palha',             'PALHA', 'titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','12963',        'Ropen Ride Bangora Palha',         'PALHA', 'titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','175126343315', 'Cross Coton',                      'TECIDO','titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','175126343390', 'Cross Coton',                      'TECIDO','titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','180128333270', 'Bangora 8 Segundos',               'PALHA', 'titulo', null, null),
  ('7f615df7-7bac-45e5-8a93-827fb9ddeec7','Pralana','101110',       'Carapuca Maconica Feltro',         'FELTRO','titulo', null, null)
on conflict (organization_id, marca, codigo_modelo) do nothing;
