-- ============================================================================
-- 233-02 — A confiança da previsão de caixa, medida contra o saldo DECLARADO
--
-- 🔴 O PROBLEMA QUE ESTA MIGRATION RESOLVE, medido em 27/08/2026:
--
--   initial_balance (digitado pelo Wesley) ......  R$ 46.000,00
--   + entradas de hoje ..........................  R$ 14.790,16
--   − saidas de hoje ............................  R$  9.485,54
--   = saldo que a TELA exibe ....................  R$ 51.304,62
--   saldo REAL, declarado por ele ...............  R$ 37.430,00
--   -> o dia ZERO erra R$ 13.874,62 (+37,1%)
--
-- O campo `financial_settings.initial_balance` e o saldo ANTES dos movimentos do
-- dia, mas a tela o apresenta como "corrigir saldo". O Wesley digita o valor que
-- quer ver, os movimentos entram por cima, e ele converge por tentativa e erro —
-- palavras dele: "tenho que ficar inserindo valores e atualizando ate o saldo do
-- dia chegar no real que temos".
--
-- 🔵 A FONTE DE VERDADE E A DECLARACAO DELE, nao o `initial_balance` nem o valor
-- exibido. Esta tabela captura essa declaracao, e e ela que ancora a medicao de
-- confianca: para cada dia declarado, comparamos contra tudo que o
-- `cashflow_forecast_snapshot` (Fase 224) havia congelado para aquele dia.
--
-- 🔴 POR QUE ISTO E URGENTE: `initial_balance` e campo unico, sobrescrito. Nao ha
-- historico nenhum. A correcao da proxima quinta apaga a de hoje, e o ponto de
-- verdade de 27/08 desaparece. E o TERCEIRO caso identico na mesma semana — o
-- calendario do fornecedor (231-09) e o estoque (231-05) tinham o mesmo defeito:
-- o dado certo existe no instante e evapora, e a serie nunca nasce.
--
-- Projeto: ckcdevcxgvueywivefgx. Aplicar via Management API, NUNCA `db push`,
-- NUNCA pelo SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. O saldo DECLARADO — a serie que nao existia
-- ---------------------------------------------------------------------------
create table if not exists public.saldo_declarado (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  -- O dia a que a declaracao se refere. E a ANCORA: todo snapshot cujo
  -- `target_date` seja este dia pode ser confrontado contra `saldo_real`.
  data_declarada    date not null,
  -- 🔵 O numero que o humano afirma ser verdade. Nao e calculado, nao e derivado
  -- e nao e o `initial_balance` — e a declaracao.
  saldo_real        numeric(14,2) not null,
  -- O retrato do que o sistema dizia NAQUELE momento, para o erro do dia zero
  -- ficar medido e nao precisar ser reconstruido depois.
  saldo_exibido     numeric(14,2),
  initial_balance   numeric(14,2),
  entradas_do_dia   numeric(14,2),
  saidas_do_dia     numeric(14,2),
  declarado_por     text not null default 'wesley',
  fonte             text not null default 'declaracao_manual',
  observacao        text,
  created_at        timestamptz not null default now(),
  -- Uma declaracao por dia. Redeclarar o mesmo dia SOBRESCREVE de proposito: o
  -- Wesley converge por tentativa, e o que vale e a ultima palavra dele.
  constraint saldo_declarado_org_data_key unique (organization_id, data_declarada)
);

create index if not exists saldo_declarado_org_data_idx
  on public.saldo_declarado (organization_id, data_declarada desc);

alter table public.saldo_declarado enable row level security;

drop policy if exists saldo_declarado_select on public.saldo_declarado;
create policy saldo_declarado_select on public.saldo_declarado
  for select using (is_org_member(auth.uid(), organization_id));

drop policy if exists saldo_declarado_write on public.saldo_declarado;
create policy saldo_declarado_write on public.saldo_declarado
  for all
  using      (get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]))
  with check (get_org_role(auth.uid(), organization_id) = any (array['owner'::org_role, 'admin'::org_role]));

comment on table public.saldo_declarado is
  '233-02: o saldo que um humano AFIRMA ser verdade num dia. E a ancora da medicao de '
  'confianca — nao o `initial_balance` (que e o saldo antes dos movimentos do dia) nem o '
  'valor exibido pela tela. Em 27/08/2026 os tres eram numeros diferentes: 46.000, 51.304,62 '
  'e 37.430.';

-- ---------------------------------------------------------------------------
-- 2. O ponto de 27/08 — capturado antes que a proxima quinta o apague
-- ---------------------------------------------------------------------------
-- ⚠️ Este INSERT e uma TRANSCRICAO declarada, nao uma medicao automatica: o
-- R$ 37.430,00 foi dito pelo Wesley no chat em 27/08/2026. As outras tres
-- parcelas foram lidas do banco no mesmo dia.
insert into public.saldo_declarado
  (organization_id, data_declarada, saldo_real, saldo_exibido, initial_balance,
   entradas_do_dia, saidas_do_dia, declarado_por, fonte, observacao)
select o.id, date '2026-08-27', 37430.00, 51304.62, 46000.00, 14790.16, 9485.54,
       'wesley', 'declaracao_manual',
       'Primeiro ponto da serie. TRANSCRICAO da declaracao do Wesley em 27/08/2026. '
       'O dia zero errava R$ 13.874,62 (+37,1%) no momento da captura.'
  from public.organizations o
 where o.id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'
   and not exists (select 1 from public.saldo_declarado s
                    where s.organization_id = o.id and s.data_declarada = date '2026-08-27');

-- ---------------------------------------------------------------------------
-- 3. A RPC de confianca — o confronto por horizonte
-- ---------------------------------------------------------------------------
-- Para cada dia declarado, confronta o `saldo_real` contra TUDO que o
-- `cashflow_forecast_snapshot` congelou com aquele `target_date`. Uma declaracao
-- semanal produz um ponto por horizonte disponivel — e e assim que uma correcao
-- por semana desenha a curva inteira.
--
-- 🔴 A REGRA DOS RELOGIOS (M-01 do 233-MEDICOES): o cron do snapshot roda as 04h
-- e a declaracao acontece de tarde. O snapshot do PROPRIO dia declarado foi
-- tirado antes da correcao — comparar contra ele mede a CORRECAO, nao a
-- previsao. Por isso `horizon_days >= p_horizonte_minimo` (default 1), e por isso
-- o default NAO e zero.
--
-- 🔴 SECURITY INVOKER + filtro explicito de org: RPC com DEFINER e parametro de
-- org e IDOR (`feedback_supabase_security_invoker`). E o T-224-07-01 — o numero
-- de uma loja na tela da outra — ja aconteceu nesta base.
create or replace function public.get_confianca_do_saldo(
  p_org_id uuid,
  p_horizonte_minimo int default 1,
  p_horizonte_maximo int default 30
)
returns table (
  horizon_days     int,
  n_pares          bigint,
  soma_previsto    numeric,
  soma_real        numeric,
  erro_pct         numeric,
  confianca_pct    numeric,
  primeiro_alvo    date,
  ultimo_alvo      date
)
language sql
stable
security invoker
set search_path = public
as $$
  with pares as (
    select s.horizon_days,
           s.valor_previsto,
           d.saldo_real,
           d.data_declarada
      from public.saldo_declarado d
      join public.cashflow_forecast_snapshot s
        on s.organization_id = d.organization_id
       and s.target_date     = d.data_declarada
       and s.fonte           = 'saldo_projetado'
     where d.organization_id = p_org_id
       and s.horizon_days between p_horizonte_minimo and p_horizonte_maximo
       and d.saldo_real <> 0          -- divisao por zero nao vira erro infinito
  )
  select p.horizon_days,
         count(*)                                as n_pares,
         sum(p.valor_previsto)                   as soma_previsto,
         sum(p.saldo_real)                       as soma_real,
         -- 🔴 WAPE (sum/sum), NUNCA `avg(previsto/realizado)`: a media das razoes
         -- e patologia numa serie com zeros e sazonalidade extrema. Regua herdada
         -- da Fase 224.
         round(100.0 * sum(abs(p.valor_previsto - p.saldo_real)) / nullif(sum(abs(p.saldo_real)), 0), 1)
                                                 as erro_pct,
         -- Confianca = 100 − erro, PISADA EM ZERO. Erro de 150% nao vira
         -- confianca negativa: vira zero, que ja diz tudo.
         greatest(0, round(100.0 - 100.0 * sum(abs(p.valor_previsto - p.saldo_real)) / nullif(sum(abs(p.saldo_real)), 0), 1))
                                                 as confianca_pct,
         min(p.data_declarada)                   as primeiro_alvo,
         max(p.data_declarada)                   as ultimo_alvo
    from pares p
   group by p.horizon_days
   order by p.horizon_days;
$$;

comment on function public.get_confianca_do_saldo(uuid, int, int) is
  '233-02: confianca da previsao de SALDO por horizonte = 100 − WAPE, medida contra o saldo '
  'DECLARADO. `n_pares` viaja junto de todo percentual: 84%% sobre 2 pares nao e a mesma '
  'afirmacao que 84%% sobre 50. Horizonte 0 fica FORA por default — o snapshot das 04h '
  'antecede a declaracao da tarde, e compara-lo mediria a correcao, nao a previsao.';

revoke all on function public.get_confianca_do_saldo(uuid, int, int) from public;
grant execute on function public.get_confianca_do_saldo(uuid, int, int) to authenticated;
