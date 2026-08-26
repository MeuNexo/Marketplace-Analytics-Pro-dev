-- =============================================================================
-- 231-09 — O calendário do fornecedor NÃO é fato estático: ele muda toda semana
-- =============================================================================
--
-- O 231-02 tratou o calendário de lote como dado de primeira classe, e estava
-- certo. O que ele não podia saber ainda é que esse dado tem prazo de validade
-- CURTO: em DOIS DIAS a leitura da casa envelheceu — feltro andou 10 dias,
-- palha 20, tecido 36, e a parada de fim de ano encolheu de dois meses para
-- duas semanas. Nada disso apareceu como aviso; apareceu porque o Wesley olhou.
--
-- Esta migration faz duas coisas:
--
-- 1. `confirmado_em` / `confirmado_por` viram COLUNA em `supplier_calendars` e
--    `supplier_lots`. Hoje a informação vive dentro de `fonte`, em texto livre
--    (`wesley_2026-08-26_reconfirmou_fabrica_msg_v2`) — a data está no meio da
--    string por acidente de convenção, não por contrato. Basta alguém escrever
--    "confirmado pelo Wesley" na semana que vem para "confirmado há N dias"
--    virar NULL sem ninguém perceber. `fonte` continua existindo para a prosa;
--    as duas coisas não se misturam.
--
-- 2. `supplier_calendar_versions` guarda o retrato ANTERIOR antes de cada
--    escrita. Hoje a mudança de 15/11 para 25/11 só sobrevive como prosa
--    concatenada com `|` dentro de `observacao` — registro honesto e ilegível
--    por máquina. **Sem série de versões, a amplitude do desvio não pode ser
--    MEDIDA, só presumida**, e o SUG-07 pede exatamente o contrário.
--
-- ⚠️ RLS ligada e políticas copiadas de `supplier_calendars` (que por sua vez as
-- copiou de `replenishment_params`). Tabela criada fora do caminho normal nasce
-- sem RLS e o lint não pega — `feedback_tabela_de_execucao_nasce_sem_rls`.
--
-- ⚠️ Entra pelo caminho versionado do repo, nunca pelo SQL Editor
-- (`feedback_no_drift_via_sql_editor`).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. A confirmação humana vira DADO, não prosa
-- ---------------------------------------------------------------------------

alter table public.supplier_calendars
  add column if not exists confirmado_em  date,
  add column if not exists confirmado_por text;

alter table public.supplier_lots
  add column if not exists confirmado_em  date,
  add column if not exists confirmado_por text;

comment on column public.supplier_calendars.confirmado_em is
  'Data em que um HUMANO confirmou este calendário contra a fábrica. NULL significa '
  '"nunca confirmado" — que é uma afirmação diferente e mais alarmante do que '
  '"confirmado hoje". Quem lê nunca deve transformar NULL em zero dias.';

comment on column public.supplier_lots.confirmado_em is
  'Idem supplier_calendars.confirmado_em, por lote: a fábrica remarca um material '
  'sem tocar nos outros, e a idade da confirmação é por linha.';

-- Backfill das 6 linhas existentes (1 calendário + 5 lotes). A data não é
-- chute: é o que o paliativo em `fonte` já afirmava —
-- `wesley_2026-08-26_reconfirmou_fabrica_msg_v2` no calendário e
-- `fabrica_msg_2026-08-24_v2 (Wesley reconfirmou 2026-08-26)` nos lotes.
-- Estamos promovendo a texto existente a coluna, não inventando informação.
update public.supplier_calendars
   set confirmado_em  = date '2026-08-26',
       confirmado_por = 'wesley'
 where confirmado_em is null
   and fonte ilike '%2026-08-26%';

update public.supplier_lots
   set confirmado_em  = date '2026-08-26',
       confirmado_por = 'wesley'
 where confirmado_em is null
   and fonte ilike '%2026-08-26%';

-- ---------------------------------------------------------------------------
-- 2. O histórico que torna a amplitude do desvio MENSURÁVEL
-- ---------------------------------------------------------------------------
--
-- Uma linha por lote (e uma por calendário) a cada atualização — algo como seis
-- linhas por semana. É barato, e é a ÚNICA forma de responder à pergunta que o
-- SUG-07 faz: quanto essas datas andam, de verdade?
--
-- Sem isso, a amplitude de "poucos dias" continua sendo o que o vendedor disse
-- ao Wesley, e o 231-06 segue projetando contra uma data cuja incerteza ninguém
-- mediu.

create table if not exists public.supplier_calendar_versions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  calendar_id           uuid references public.supplier_calendars(id) on delete cascade,
  fornecedor            text not null,
  -- `material` NULL = esta linha é o retrato do CALENDÁRIO (para_em, retoma_em,
  -- validade); preenchido = retrato de um LOTE.
  material              text,
  -- O retrato do que existia ANTES da escrita que gerou esta versão.
  data_entrega_prevista date,
  data_corte_pedido     date,
  para_em               date,
  retoma_em             date,
  calendario_valido_ate date,
  confirmado_em         date,
  confirmado_por        text,
  fonte                 text,
  -- Por que a versão foi gravada, em texto: "atualizacao FELTRO", "confirmacao
  -- sem mudanca de data", "seed inicial".
  motivo                text not null,
  gravado_em            timestamptz not null default now(),
  gravado_por           text
);

create index if not exists supplier_calendar_versions_org_forn_mat_idx
  on public.supplier_calendar_versions (organization_id, fornecedor, material, gravado_em);

alter table public.supplier_calendar_versions enable row level security;

drop policy if exists supplier_calendar_versions_select on public.supplier_calendar_versions;
create policy supplier_calendar_versions_select on public.supplier_calendar_versions
  for select using (is_org_member(auth.uid(), organization_id));

drop policy if exists supplier_calendar_versions_write on public.supplier_calendar_versions;
create policy supplier_calendar_versions_write on public.supplier_calendar_versions
  for all
  using      (get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]))
  with check (get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]));

comment on table public.supplier_calendar_versions is
  '231-09: retrato do calendário e dos lotes ANTES de cada escrita. É esta série — e não a '
  'prosa acumulada em supplier_lots.observacao — que torna a amplitude do desvio semanal '
  'MENSURÁVEL. Extrair número daquele texto produziria transcrição vestida de medição.';

-- ---------------------------------------------------------------------------
-- 3. A primeira versão, semeada com procedência EXPLÍCITA
-- ---------------------------------------------------------------------------
--
-- 🔴 Este INSERT existe para que a série não comece vazia, e ele é declarado
-- como TRANSCRIÇÃO, não como medição automática. As datas anteriores vêm da
-- mensagem da fábrica de 24/08/2026 registrada em `231-02-SUMMARY.md` e na
-- prosa de `observacao`. Nenhum parser leu aquele texto — uma pessoa o leu e
-- escreveu estas cinco linhas, e `motivo` diz isso.
--
-- ⚠️ O que esta semente já denuncia: PALHA andou 20 dias (15/11 -> 05/12) e
-- TECIDO andou 36 (15/12 -> 20/01) — os dois MUDARAM DE QUINZENA. A afirmação
-- "a amplitude é de poucos dias, a quinzena se mantém" nasce contestada pelo
-- próprio dado, e é por isso que ela precisa ser medida e não presumida.

insert into public.supplier_calendar_versions
  (organization_id, calendar_id, fornecedor, material, data_entrega_prevista,
   para_em, retoma_em, calendario_valido_ate, confirmado_em, confirmado_por,
   fonte, motivo, gravado_por)
select c.organization_id, c.id, c.fornecedor, v.material, v.data_anterior,
       date '2026-12-31', date '2027-03-01', c.calendario_valido_ate,
       date '2026-08-24', 'wesley',
       'fabrica_msg_2026-08-24_v1',
       'seed inicial 231-09 — TRANSCRICAO manual do estado de 24/08/2026 (231-02-SUMMARY), '
       'nao extracao automatica de observacao',
       'migration_231-09'
  from public.supplier_calendars c
  cross join (values
      ('BOINA',  date '2026-10-15'),
      ('BONE',   date '2026-10-15'),
      ('FELTRO', date '2026-11-15'),
      ('PALHA',  date '2026-11-15'),
      ('TECIDO', date '2026-12-15')
  ) as v(material, data_anterior)
 where c.fornecedor = 'PRALANA INDUSTRIA E COMERCIO LTDA'
   and c.ano = 2026
   and not exists (
     select 1 from public.supplier_calendar_versions x
      where x.calendar_id = c.id and x.motivo like 'seed inicial 231-09%'
   );
