-- ===========================================================================
-- 244-03 (parte 2) — a régua de comissão entra nos DOIS wrappers da tela
--
-- 🔴 G-02, a lição da fase 225: o plano 06 uniu o frete em `get_casos` e NÃO em
-- `get_conciliacao_resumo`. Desde então o resumo contava só a base (1.926)
-- contra ~3.167 na lista, e o alerta "A lista não está completa" ficou
-- permanentemente inerte — justamente o critério que a fase tinha escolhido
-- como o seu. Por isso as duas funções mudam JUNTAS, na mesma migration.
--
-- ⚠️ `CREATE OR REPLACE`, nunca DROP + CREATE: `DROP FUNCTION` apaga a ACL e a
-- função renasce com EXECUTE para PUBLIC e `anon` — aconteceu em 05/09 com
-- três funções desta mesma tela.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_casos_conciliacao(
  p_org_id uuid,
  p_janela_dias integer DEFAULT NULL::integer,
  p_apenas_acionaveis boolean DEFAULT true,
  p_limite integer DEFAULT 200,
  p_offset integer DEFAULT 0
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
  with todas as (
    select * from public.conciliacao_base_linhas(p_org_id, p_janela_dias)
    union all
    -- 225-06: a terceira régua. A função base fica INTOCADA de propósito.
    select * from public.conciliacao_frete_linhas(p_org_id, p_janela_dias)
    union all
    -- 244-03: a quarta. A comissão é R$ 257.634,65 líquidos e até aqui só era
    -- conferida pela régua de repasse, que compara o Mercado Livre contra o
    -- extrato dele mesmo.
    select * from public.conciliacao_comissao_linhas(p_org_id, p_janela_dias)
  )
  select t.*
    from todas t
   where (not p_apenas_acionaveis) or t.acionavel
   -- D-225-03: a fila ordena por dias restantes até expirar, nunca por valor.
   -- 🔴 G-03: DESEMPATE, porque o hook pagina por OFFSET em até 40 chamadas
   -- INDEPENDENTES e cada uma reexecuta a função inteira. Ordem parcial +
   -- OFFSET = uma linha repete numa página e some de outra, sem nada piscar.
   order by t.dias_restantes asc nulls last,
            t.diferenca      desc nulls last,
            t.ml_order_id    asc  nulls last,
            t.tipo_caso      asc  nulls last,
            t.payment_ids    asc  nulls last
   limit  least(coalesce(p_limite, 200), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

CREATE OR REPLACE FUNCTION public.get_conciliacao_resumo(
  p_org_id uuid,
  p_janela_dias integer DEFAULT NULL::integer
)
RETURNS TABLE(
  casos_urgentes integer, soma_urgente numeric, proximo_prazo_dias integer,
  acionaveis_n integer, vazamento_total numeric, sub_piso_n integer,
  sub_piso_soma numeric, nosso_erro_n integer, nosso_erro_soma numeric,
  fora_escopo_n integer, fora_escopo_soma numeric, entradas_sem_origem_n integer,
  entradas_sem_origem_soma numeric, a_verificar_n integer, a_verificar_soma numeric,
  recuperado_total numeric, saidas_auditadas boolean, ingestao_inicio date,
  piso_materialidade numeric, acusar_valor_a_menor boolean, dias_aguardando integer,
  dias_ausente integer, ultima_sync timestamp with time zone, linhas_total integer,
  teto_da_lista integer, valor_desconhecido_n integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
-- dispensa-do-filtro (225-11): so le max(ci.synced_at) como `ultima_sync`.
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
-- 🔴 G-02: o universo do resumo tem que ser o MESMO que a tela carrega.
b as (
  select * from public.conciliacao_base_linhas(p_org_id, p_janela_dias)
  union all
  select * from public.conciliacao_frete_linhas(p_org_id, p_janela_dias)
  union all
  select * from public.conciliacao_comissao_linhas(p_org_id, p_janela_dias)
)
select count(*) filter (where b.acionavel and b.dias_restantes <= 7)::int          as casos_urgentes,
       coalesce(sum(b.diferenca) filter (where b.acionavel and b.dias_restantes <= 7), 0) as soma_urgente,
       min(b.dias_restantes) filter (where b.acionavel)::int                       as proximo_prazo_dias,
       count(*) filter (where b.acionavel)::int                                    as acionaveis_n,
       coalesce(sum(b.diferenca) filter (where b.tipo_caso <> 'entrada_sem_origem'), 0) as vazamento_total,
       count(*) filter (where b.motivo = 'abaixo_do_piso')::int                    as sub_piso_n,
       coalesce(sum(b.diferenca) filter (where b.motivo = 'abaixo_do_piso'), 0)    as sub_piso_soma,
       count(*) filter (where b.fila = 'nosso' and b.tipo_caso <> 'entrada_sem_origem')::int as nosso_erro_n,
       -- 🔴 SEM coalesce: nulo é "não sei", nunca R$ 0,00, que leria "o nosso
       -- erro custa zero" (feedback_ausencia_diz_o_motivo_real).
       sum(b.diferenca) filter (where b.fila = 'nosso' and b.tipo_caso <> 'entrada_sem_origem') as nosso_erro_soma,
       count(*) filter (where b.motivo = 'fora_do_escopo')::int                    as fora_escopo_n,
       sum(b.diferenca) filter (where b.motivo = 'fora_do_escopo')                 as fora_escopo_soma,
       count(*) filter (where b.tipo_caso = 'entrada_sem_origem')::int             as entradas_sem_origem_n,
       coalesce(sum(b.diferenca) filter (where b.tipo_caso = 'entrada_sem_origem'), 0) as entradas_sem_origem_soma,
       count(*) filter (where b.motivo = 'ausencia_a_verificar')::int              as a_verificar_n,
       coalesce(sum(b.diferenca) filter (where b.motivo = 'ausencia_a_verificar'), 0) as a_verificar_soma,
       (select coalesce(sum(k.valor_recuperado), 0) from public.conciliacao_casos k
         where k.organization_id = p_org_id and k.estado = 'ganho')                as recuperado_total,
       (exists (select 1 from public.mp_saidas s
                 where s.organization_id = p_org_id
                   and s.data_movimento >= (select hoje - janela from cfg)))       as saidas_auditadas,
       (select ingestao_inicio from cfg)                                           as ingestao_inicio,
       (select piso from cfg)                                                      as piso_materialidade,
       (select acusar from cfg)                                                    as acusar_valor_a_menor,
       (select dias_aguardando from cfg)                                           as dias_aguardando,
       (select dias_ausente from cfg)                                              as dias_ausente,
       (select max(ci.synced_at) from public.cash_inflows ci
         where ci.organization_id = p_org_id)                                      as ultima_sync,
       count(*)::int                                                               as linhas_total,
       1000                                                                        as teto_da_lista,
       count(*) filter (where b.diferenca is null)::int                            as valor_desconhecido_n
  from b;
$function$;

REVOKE ALL ON FUNCTION public.get_casos_conciliacao(uuid, integer, boolean, integer, integer) FROM public;
REVOKE ALL ON FUNCTION public.get_casos_conciliacao(uuid, integer, boolean, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_casos_conciliacao(uuid, integer, boolean, integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_conciliacao_resumo(uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.get_conciliacao_resumo(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_conciliacao_resumo(uuid, integer) TO authenticated;
