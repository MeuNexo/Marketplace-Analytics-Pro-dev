-- ============================================================================
-- 233-04 — A RPC de confianca passa a emitir o HORIZONTE INTEIRO
--
-- 🔴 O QUE O WESLEY VIU em 27/08/2026: seis barras, D+1 a D+6, e nada mais.
--   *"ele so me da previsao de 6 dias? e o restante dos dias? queria poder ir
--    vendo ao longo do tempo ate onde posso confiar"*
--
-- A raiz esta AQUI, nao na tela. A versao da 233-02 parte da juncao entre
-- `saldo_declarado` e `cashflow_forecast_snapshot` e agrupa por `horizon_days`:
-- **horizonte sem par nao produz linha**. O front nunca recebia D+7..D+30 e por
-- isso nao tinha como nomea-los. Somado ao descarte da tela, isso afirmava o que
-- ninguem escreveu: *"o sistema so sabe prever 6 dias"*. E falso.
--
-- 🔵 A INVERSAO: a FAIXA vira o esqueleto (`generate_series`) e a medicao se
-- pendura nela por `left join`. Toda linha da faixa sai, tenha par ou nao.
--
-- 🔴 SAO DUAS ESCASSEZES DIFERENTES, e distingui-las e o coracao desta migration:
--
--   `serie_curta`    o primeiro snapshot de `saldo_projetado` e de 2026-08-21.
--                    D+7 so e medivel a partir de 28/08, D+15 de 05/09, D+30 de
--                    20/09. E CALENDARIO — resolve-se ESPERANDO — e por isso
--                    carrega `medivel_em`.
--   `sem_declaracao` a serie ja alcancou o prazo, mas nao ha `saldo_declarado`
--                    naquele dia. NAO tem data: resolve-se DECLARANDO. E o
--                    gancho direto para o 233-03.
--   `sem_serie`      a organizacao nao tem snapshot nenhum de `saldo_projetado`.
--
-- Confundir as duas primeiras faz a tela mentir sobre o que destrava a medicao.
--
-- ⚠️ `medivel_em` e a data mais CEDO em que o par PODERIA existir. Nao e promessa
-- de que ele vai existir: tambem depende de haver declaracao naquele dia.
--
-- 🔴 `confianca_pct` e `erro_pct` continuam NULOS em toda linha sem par. Nunca 0
-- (que diria "erra tudo") e nunca 100 (que diria "e perfeita").
--
-- 🔴 NADA AQUI MEXE NA REGUA DE ERRO. WAPE por soma sobre soma, piso em zero,
-- horizonte 0 fora por default (a regra dos relogios, M-01). Muda **quais linhas
-- saem**, nao como o numero e calculado.
--
-- ⚠️ `create or replace` NAO altera tipo de retorno, e o tipo muda (duas colunas
-- novas). Precisa de `drop function` com a assinatura (uuid, int, int).
-- 🔴 E `DROP FUNCTION` APAGA A ACL (`feedback_drop_function_apaga_acl`): o bloco
-- de `revoke`/`grant` do fim e obrigatorio, ou a tela passa a receber erro de
-- permissao sem nenhum aviso na migration.
--
-- Projeto: ckcdevcxgvueywivefgx. Aplicar via Management API, NUNCA `db push`,
-- NUNCA pelo SQL Editor.
-- ============================================================================

drop function if exists public.get_confianca_do_saldo(uuid, int, int);

-- 🔴 SECURITY INVOKER + filtro explicito de `organization_id`. DEFINER com
-- parametro de org e IDOR (`feedback_supabase_security_invoker`), e o
-- T-224-07-01 — o numero de uma loja na tela da outra — ja aconteceu nesta base
-- (M-02: a primeira consulta desta fase devolveu a Thales junto).
create function public.get_confianca_do_saldo(
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
  ultimo_alvo      date,
  motivo_ausencia  text,
  medivel_em       date
)
language sql
stable
security invoker
set search_path = public
as $$
  -- A idade da serie sai do DADO, nunca de constante escrita a mao: o menor
  -- `snapshot_date` de `saldo_projetado` DESTA organizacao.
  with serie as (
    select min(s.snapshot_date) as inicio
      from public.cashflow_forecast_snapshot s
     where s.organization_id = p_org_id
       and s.fonte           = 'saldo_projetado'
  ),
  -- 🔵 O ESQUELETO. A faixa existe independentemente de haver medicao nela.
  faixa as (
    select h::int as horizon_days
      from generate_series(p_horizonte_minimo, p_horizonte_maximo) as h
  ),
  pares as (
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
  ),
  agregado as (
    select p.horizon_days,
           count(*)              as n_pares,
           sum(p.valor_previsto) as soma_previsto,
           sum(p.saldo_real)     as soma_real,
           -- 🔴 WAPE (sum/sum), NUNCA `avg(previsto/realizado)`: a media das
           -- razoes e patologia numa serie com zeros e sazonalidade extrema.
           round(100.0 * sum(abs(p.valor_previsto - p.saldo_real)) / nullif(sum(abs(p.saldo_real)), 0), 1)
                                 as erro_pct,
           -- Confianca = 100 − erro, PISADA EM ZERO. Erro de 150% nao vira
           -- confianca negativa: vira zero, que ja diz tudo.
           greatest(0, round(100.0 - 100.0 * sum(abs(p.valor_previsto - p.saldo_real)) / nullif(sum(abs(p.saldo_real)), 0), 1))
                                 as confianca_pct,
           min(p.data_declarada) as primeiro_alvo,
           max(p.data_declarada) as ultimo_alvo
      from pares p
     group by p.horizon_days
  )
  select f.horizon_days,
         coalesce(a.n_pares, 0)::bigint as n_pares,
         a.soma_previsto,
         a.soma_real,
         -- Sem par: nulo dos dois lados. Nunca 0, nunca 100.
         a.erro_pct,
         a.confianca_pct,
         a.primeiro_alvo,
         a.ultimo_alvo,
         case
           when coalesce(a.n_pares, 0) > 0                        then null
           when se.inicio is null                                 then 'sem_serie'
           -- Ainda nao alcancado pela serie: e IDADE, resolve esperando.
           when (se.inicio + f.horizon_days) > current_date        then 'serie_curta'
           -- Ja alcancado e mesmo assim sem par: falta DECLARACAO, nao tempo.
           else                                                        'sem_declaracao'
         end::text as motivo_ausencia,
         case
           when coalesce(a.n_pares, 0) > 0                        then null
           when se.inicio is null                                 then null
           when (se.inicio + f.horizon_days) > current_date        then (se.inicio + f.horizon_days)
           -- `sem_declaracao` NAO tem data por desenho: esperar nao resolve.
           else                                                        null
         end::date as medivel_em
    from faixa f
    cross join serie se
    left join agregado a on a.horizon_days = f.horizon_days
   order by f.horizon_days;
$$;

comment on function public.get_confianca_do_saldo(uuid, int, int) is
  '233-04: confianca da previsao de SALDO por horizonte = 100 − WAPE contra o saldo DECLARADO, '
  'emitida para TODA a faixa pedida. Horizonte sem par sai com `motivo_ausencia` nomeado e, '
  'quando o motivo e a idade da serie, com `medivel_em` — a data mais cedo em que o par pode '
  'nascer (nao promessa de que vai). `serie_curta` resolve-se esperando; `sem_declaracao` '
  'resolve-se declarando saldo. `n_pares` viaja junto de todo percentual: 84%% sobre 2 pares '
  'nao e a mesma afirmacao que 84%% sobre 50. Horizonte 0 fica FORA por default — o snapshot '
  'das 04h antecede a declaracao da tarde, e compara-lo mediria a correcao, nao a previsao.';

-- ---------------------------------------------------------------------------
-- ACL — reemitida DEPOIS do create, porque o `drop` acima a apagou
-- ---------------------------------------------------------------------------
-- 🔴 `feedback_drop_function_apaga_acl`. Sem este bloco a tela recebe erro de
-- permissao e a migration nao avisa nada.
--
-- ⚠️ DECISAO DELIBERADA sobre `anon`: antes desta migration `anon` TINHA execute,
-- herdado do default privilege do Supabase (a 233-02 fez `revoke ... from public`
-- + `grant ... to authenticated`, e o default privilege reconcedeu a anon por
-- fora). O `create` abaixo reconcederia de novo. O card de confianca so existe
-- dentro do painel autenticado, e a funcao e INVOKER sobre tabelas com RLS —
-- anon nao enxerga linha nenhuma de qualquer jeito. O `revoke from anon` aqui e
-- menor privilegio EXPLICITO, nao efeito colateral: se alguma tela publica
-- passar a precisar desta funcao, este e o lugar de reverter.
revoke all on function public.get_confianca_do_saldo(uuid, int, int) from public;
revoke all on function public.get_confianca_do_saldo(uuid, int, int) from anon;
grant execute on function public.get_confianca_do_saldo(uuid, int, int) to authenticated;
grant execute on function public.get_confianca_do_saldo(uuid, int, int) to service_role;
