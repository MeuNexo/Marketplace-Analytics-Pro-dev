-- ────────────────────────────────────────────────────────────────────────────
-- Fase 225, plano 11 — O CAIXA VOLTA A SOMAR SO O DINHEIRO DA EMPRESA
--
-- O 225-09 fechou a torneira: a entrada nova nasce sabendo quem recebeu. Este
-- arquivo tira do caixa o que ja entrou errado — e nao apaga NADA para isso.
-- Nenhum DELETE, nenhum TRUNCATE, nenhum net_amount ou gross_amount alterado.
-- O valor continua sendo o que a API devolveu; quem decide se ele conta e a
-- flag `entra_no_caixa` ao lado, e a reversao e um UPDATE de uma coluna.
--
-- O NUMERO: R$ 12.232,60 em 38 linhas de compra pessoal do titular somaram
-- como receita da empresa desde 07/01/2026, com 97,6% concentrados em maio
-- (R$ 6.436,32) e agosto (R$ 5.496,89). Agosto e o mes de Barretos, cujo
-- fechamento foi analisado com esse numero dentro.
--
-- 🔴 O LIQUIDO ESCONDE DOIS SINAIS OPOSTOS: os R$ 12.232,60 sao o saldo de
-- R$ 14.790,16 de ENTRADAS falsas menos R$ 2.557,56 de ESTORNOS falsos (4
-- linhas). Abril (-22,06) e junho (-1.412,37) ficam NEGATIVOS: nesses dois
-- meses a linha falsa estava SUBTRAINDO do caixa. Tirar as 38 corrige nos dois
-- sentidos, e um resumo que so fale de inflacao esta errado nesses dois meses.
--
-- 🔴🔴 O DISCRIMINADOR NAO E ANTI-JOIN CONTRA `orders`, E ISSO VALE
-- R$ 2.449,52. As 28 vendas REAIS orfas da familia B falham no MESMO teste de
-- "nao casa com orders" que as 38 compras — elas sao orfas porque a ingestao de
-- PEDIDOS as perdeu, nao porque o dinheiro nao seja nosso. Quem separa e o par
-- collector_id x payer_id que o 225-09 gravou, e nada mais. Um flag por
-- anti-join apagaria R$ 2.449,52 de dinheiro real da empresa. E o atalho obvio
-- e e a armadilha desta correcao.
--
-- O QUE ESTE ARQUIVO FAZ, e so isso:
--   Bloco 0  o pre-guarda que aborta um replay ANTES de qualquer DDL
--   Bloco 1  14 funcoes de caixa passam a filtrar; 2 recebem marcador de
--            dispensa porque so leem max(synced_at) e nao somam dinheiro
--   Bloco 2  conciliacao_base_linhas para de contar compra pessoal como
--            repasse, e passa a NOMEA-LA na tela em vez de escondê-la
--   Bloco 3  a guarda de pos-estado: denominador, cobertura, seguranca,
--            permissoes — nessa ordem, denominador ANTES de numerador
--
-- O QUE ESTE ARQUIVO NAO FAZ:
--   🔴 NAO corrige o estorno somado como entrada em get_dre_cash
--      (`CASE WHEN net_amount > 0 THEN net_amount ELSE ABS(net_amount) END`).
--      E outro defeito, na mesma funcao, e e da FASE 237. Misturar as duas
--      destruiria a rastreabilidade de qual fase moveu qual numero. E por causa
--      dele que o efeito na DRE (R$ 17.347,72) e MAIOR que no caixa
--      (R$ 12.232,60): la os R$ 2.557,56 de estorno somam em vez de subtrair.
--   NAO usa DROP FUNCTION: recriar apaga a lista de permissoes; CREATE OR
--      REPLACE com assinatura identica nao (feedback_drop_function_apaga_acl).
--   NAO muda assinatura, tipo de retorno, volatilidade nem modo de seguranca.
--      Sete das 16 sao VOLATILE e nove STABLE; uma e DEFINER. Reemitidas
--      exatamente como estao no banco — sao contrato, nao detalhe.
--   NAO alarga nem aperta permissao: o par revoke/grant reemitido reproduz o
--      ACL medido hoje. Zero funcoes tem execute para anon ou public.
--   NAO esconde a compra pessoal da tela. Filtrar do caixa e nomear na tela sao
--      coisas diferentes, e a segunda e requisito (D-225-10).
--
-- ⚠️ PROCEDENCIA DOS CORPOS: os 16 vieram de pg_get_functiondef do banco vivo
-- em 04/09/2026, gravados direto em disco pela Management API e injetados por
-- script — nenhum byte transcrito a mao, de lado nenhum. Clonar corpo de RPC a
-- partir do repositorio ja regrediu `get_cashflow` em producao nesta casa em
-- R$ 30.372,11 (feedback_corpo_vivo_de_rpc_vem_do_banco).
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ BLOCO 0 — O PRE-GUARDA, ANTES DE QUALQUER DDL ══════════════════════════
--
-- 🔴 POR QUE NO TOPO E NAO NO FIM. Na primeira aplicacao legitima nenhuma funcao
-- carrega o predicado, entao ele passa e o arquivo roda inteiro. Num replay
-- todas carregam, e ele aborta ANTES de o Bloco 1 sobrescrever qualquer corpo.
-- A MESMA checagem no fim faria o oposto do que promete: o Bloco 1 acabou de por
-- o predicado em todas, entao a condicao seria verdadeira NA PRIMEIRA APLICACAO
-- e a migration abortaria sempre.
--
-- ⚠️ E o replay e plausivel, nao teorico: `apply_migration` grava a versao pelo
-- RELOGIO DO SERVIDOR e nao pelo nome do arquivo — na propria fase 225 o arquivo
-- `20260904140000_…` foi registrado como `20260904054130`. Num `db push` futuro
-- este arquivo apareceria como nao aplicado.
--
-- 🔴 O QUE UM REPLAY DESTRUIRIA: a Fase 237 vai alterar `get_dre_cash` por outro
-- motivo (o estorno somado como entrada). Rodar este arquivo de novo depois dela
-- restauraria o corpo de hoje por cima da correcao dela, EM SILENCIO.
--
-- ⚠️ SOBRE COMENTARIO VERSUS CODIGO: `position()`/`ilike` sobre
-- `pg_get_functiondef` nao distingue os dois — a prosa que EXPLICA a regra seria
-- contada como se FOSSE a regra. Por isso a busca pelo predicado roda sobre o
-- corpo COM AS LINHAS DE COMENTARIO REMOVIDAS. O marcador de dispensa e o
-- contrario: ele E um comentario por natureza, e por isso e procurado no corpo
-- INTEIRO. A assimetria e deliberada.
do $$
declare
  v_denominador int;
  v_com_flag    int;
begin
  -- 🔴 O REPLAY SE RECONHECE POR "JA TRATADA", NAO POR "JA FILTRA".
  -- Duas das 16 nao ganham o predicado: elas so leem max(ci.synced_at) e
  -- recebem o marcador de dispensa. Contar so quem menciona a flag daria 14
  -- de 16 DEPOIS de esta migration rodar — e o pre-guarda nunca reconheceria
  -- o proprio efeito, deixando o replay passar. Tratada = filtra OU dispensa.
  select count(*),
         count(*) filter (
           where regexp_replace(pg_get_functiondef(p.oid), '^[[:space:]]*--.*$', '', 'gn')
                 ilike '%entra_no_caixa%'
              or pg_get_functiondef(p.oid) ilike '%dispensa-do-filtro%')
    into v_denominador, v_com_flag
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ilike '%cash_inflows%';

  -- 🔴 Contador zero nao aprova nada. Se a consulta nao enxerga funcao nenhuma,
  -- o pre-guarda "passaria" por nao ter achado o que olhar — que e exatamente o
  -- defeito que o gate de cobertura do GSD ja cometeu nesta casa.
  if v_denominador = 0 then
    raise exception
      '225-11 PRE-GUARDA VAZIA: nenhuma funcao de public menciona cash_inflows. Guarda que aprova por nao ter achado nada para olhar nao e aprovacao — conferir a consulta antes de seguir.';
  end if;

  if v_com_flag = v_denominador then
    raise exception
      '225-11 REPLAY BLOQUEADO: as % funcoes que leem cash_inflows JA estao tratadas (predicado de entra_no_caixa ou marcador de dispensa). Reaplicar sobrescreveria corpos vivos que outras fases (a 237 mexe em get_dre_cash) podem ter alterado desde entao — e faria isso em silencio. Se a intencao e mesmo reaplicar, leia os corpos vivos do banco primeiro e monte uma migration nova a partir deles.',
      v_denominador;
  end if;

  raise notice '225-11 pre-guarda OK: % funcoes leem cash_inflows, % ja tratadas — a migration segue.',
    v_denominador, v_com_flag;
end $$;




-- ────────────────────────────────────────────────────────────────────────────
-- _backtest_errors_raw(p_org_id uuid, p_h_max integer, p_corte_min date, p_excluir_fantasmas boolean, p_deflator_span integer, p_maturacao_dias integer)  ·  DEFINER · STABLE
--
-- O QUE MUDOU: 2 predicado(s).
-- POR QUE: o backtest da previsao comparava previsto contra realizado somando compra pessoal do dono no realizado; a calibracao de erro das Fases 224 e 233 leu essa serie.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._backtest_errors_raw(p_org_id uuid, p_h_max integer DEFAULT 15, p_corte_min date DEFAULT '2026-06-19'::date, p_excluir_fantasmas boolean DEFAULT true, p_deflator_span integer DEFAULT NULL::integer, p_maturacao_dias integer DEFAULT 14)
 RETURNS TABLE(escopo text, corrigido boolean, agregacao text, corte date, horizon_days integer, previsto numeric, realizado numeric, erro numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH params AS MATERIALIZED (
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje,
           -- Piso sobre a data de CORTE, nunca sobre created_at das linhas:
           -- filtrar created_at descartaria a carga inicial de 18/06 e
           -- esvaziaria a agenda dos primeiros cortes por artefato.
           GREATEST(p_corte_min, DATE '2026-06-19')       AS piso
  ),
  cortes AS MATERIALIZED (
    SELECT gs::date AS corte
    FROM params p, generate_series(p.piso, p.hoje - 1, interval '1 day') gs
  ),
  defl AS MATERIALIZED (
    SELECT c.corte,
           CASE WHEN p_deflator_span IS NULL THEN 1.0::numeric
                ELSE COALESCE(
                       public.get_estorno_deflator(p_org_id, p_deflator_span,
                                                   p_maturacao_dias, c.corte),
                       1.0::numeric)
           END AS fator
    FROM cortes c
  ),
  grade AS MATERIALIZED (
    SELECT c.corte, (c.corte + h)::date AS alvo, h::int AS h
    FROM cortes c
    CROSS JOIN generate_series(1, p_h_max) AS h
    CROSS JOIN params p
    WHERE (c.corte + h) < p.hoje
  ),
  fantasmas AS MATERIALIZED (
    -- EXCLUSAO NOMINAL, nunca por regua (224-MEDICOES.md Q7).
    --
    -- O detector generico da Fase 100 (dupla categoria+valor repetida em
    -- >= 2 meses futuros) marca R$ 280.684,26 nos proximos 30 dias. O
    -- fantasma REAL e 6% disso: R$ 16.958,57/mes. O resto e folha, aluguel,
    -- contabilidade, INSS, imposto e previsao de compra LEGITIMOS (o
    -- falso-positivo BEC-04, conhecido e adiado). Usar o detector como
    -- filtro destruiria a projecao.
    --
    -- O fantasma medido: a MESMA dupla de tarifas do ML replicada em 10
    -- meses (10/09/2026 -> 10/06/2027), origem 'tiny', fornecedor
    -- "Mercado livre". E uma fatura unica multiplicada, nao contas a pagar
    -- reais:
    --     ADS Mercado Livre                            R$ 13.725,27
    --     Prestacao de servico do Mercado Envios Full  R$  3.233,30
    --                                                  ------------
    --                                                  R$ 16.958,57 / mes
    --
    -- A classe E de Q7 (71 linhas, R$ 61.765,12 em 30 dias) NAO foi triada
    -- linha a linha e por isso NAO e excluida aqui — pendencia declarada em
    -- 224-CURVA.md, nao exclusao silenciosa.
    --
    -- 🔴 O FILTRO DE STATUS E O QUE SEPARA "EXCLUIR COPIA" DE "APAGAR
    -- DESPESA REAL" (medido pelo C-05, 2026-08-21). A mesma dupla de valores
    -- existe DUAS VEZES na base: 20 linhas 'pending' de 10/09/2026 a
    -- 10/06/2027, todas criadas em 17/07 (o dia do backfill de Q5), e
    -- 2 linhas 'paid' de 10/03/2026 — a FATURA VERDADEIRA, competencia
    -- 03/2026, R$ 16.958,57 que a empresa pagou de fato. Sem
    -- `status = 'pending'` a regua casava as 22 e apagava a despesa real de
    -- DENTRO da janela do backtest. Com o filtro: 20 linhas,
    -- R$ 169.585,70, ZERO dentro do backtest — bate com Q7 ao centavo.
    --
    -- Consequencia declarada: a exclusao NAO altera a curva desta fase (as
    -- copias sao todas futuras e o backtest so olha outflow_date < hoje).
    -- Ela vale para a PROJECAO do 224-05 e do 224-07.
    SELECT * FROM (VALUES
      ('ADS Mercado Livre',                           13725.27::numeric),
      ('Prestação de serviço do Mercado Envios Full',  3233.30::numeric)
    ) AS f(rotulo, valor)
    WHERE p_excluir_fantasmas
  ),
  ent_prev AS MATERIALIZED (
    -- created_at <= corte E release_date > corte  =>  release_date > created_at.
    -- A regua da reconstrucao de Q5 e satisfeita por construcao: linha de
    -- backfill retroativa (release_date anterior a criacao) nao entra.
    SELECT e.corte, ci.release_date AS alvo,
           SUM(ci.net_amount) AS bruto,
           SUM(CASE
                 WHEN ci.refund_date IS NOT NULL AND ci.refund_date > e.corte
                   THEN abs(ci.net_amount)   -- no corte, o estorno ainda nao existia
                 ELSE ci.net_amount
               END) AS corr
    FROM cortes e
    JOIN public.cash_inflows ci
      ON  ci.organization_id  = p_org_id AND ci.entra_no_caixa
      AND ci.created_at::date <= e.corte
      AND ci.release_date     >  e.corte
      AND ci.release_date     <= e.corte + p_h_max
    GROUP BY e.corte, ci.release_date
  ),
  ent_real AS MATERIALIZED (
    SELECT ci.release_date AS alvo, SUM(ci.net_amount) AS realizado
    FROM public.cash_inflows ci CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
      AND ci.release_date < p.hoje
    GROUP BY ci.release_date
  ),
  sai_prev AS MATERIALIZED (
    -- 'Previsões de compra' sai dos DOIS lados (previsto e realizado): e
    -- linha gerada pelo sistema, nunca vira 'paid', e entraria no previsto
    -- com realizado zero inflando o erro das saidas por artefato. E a
    -- classe D de Q7 — legitima como PLANEJAMENTO, mas nao e conta a pagar.
    SELECT e.corte, co.outflow_date AS alvo, SUM(co.amount) AS previsto
    FROM cortes e
    JOIN public.cash_outflows co
      ON  co.organization_id  = p_org_id
      AND co.created_at::date <= e.corte
      AND co.outflow_date     >  e.corte
      AND co.outflow_date     <= e.corte + p_h_max
      AND COALESCE(co.category, '') <> 'Previsões de compra'
      AND NOT EXISTS (
            SELECT 1 FROM fantasmas f
             WHERE co.status = 'pending'   -- a fatura REAL e 'paid' e NUNCA se exclui
               AND co.source = 'tiny'
               AND co.amount = f.valor
               AND COALESCE(co.supplier, '') ILIKE '%mercado livre%'
               AND (COALESCE(co.category, '') ILIKE '%' || f.rotulo || '%'
                 OR co.description               ILIKE '%' || f.rotulo || '%'))
    GROUP BY e.corte, co.outflow_date
  ),
  sai_real AS MATERIALIZED (
    SELECT co.outflow_date AS alvo, SUM(co.amount) AS realizado
    FROM public.cash_outflows co CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'paid'
      AND co.outflow_date < p.hoje
      AND COALESCE(co.category, '') <> 'Previsões de compra'
      AND NOT EXISTS (
            SELECT 1 FROM fantasmas f
             WHERE co.status = 'pending'   -- a fatura REAL e 'paid' e NUNCA se exclui
               AND co.source = 'tiny'
               AND co.amount = f.valor
               AND COALESCE(co.supplier, '') ILIKE '%mercado livre%'
               AND (COALESCE(co.category, '') ILIKE '%' || f.rotulo || '%'
                 OR co.description               ILIKE '%' || f.rotulo || '%'))
    GROUP BY co.outflow_date
  ),
  celula AS MATERIALIZED (
    SELECT g.corte, g.h,
           COALESCE(ep.bruto, 0) * dl.fator AS ent_pb,
           COALESCE(ep.corr,  0) * dl.fator AS ent_pc,
           COALESCE(er.realizado, 0)        AS ent_r,
           COALESCE(sp.previsto,  0)        AS sai_p,
           COALESCE(sr.realizado, 0)        AS sai_r
    FROM grade g
    JOIN defl dl          ON dl.corte = g.corte
    LEFT JOIN ent_prev ep ON ep.corte = g.corte AND ep.alvo = g.alvo
    LEFT JOIN ent_real er ON er.alvo  = g.alvo
    LEFT JOIN sai_prev sp ON sp.corte = g.corte AND sp.alvo = g.alvo
    LEFT JOIN sai_real sr ON sr.alvo  = g.alvo
  ),
  acum AS MATERIALIZED (
    -- Erro acumulado MEDIDO, nunca derivado por raiz de h: erros
    -- multi-step sao positivamente correlacionados e a derivacao
    -- subestima a banda. Soma corrida dentro do corte.
    SELECT corte, h,
           SUM(ent_pb) OVER w AS ent_pb,
           SUM(ent_pc) OVER w AS ent_pc,
           SUM(ent_r)  OVER w AS ent_r,
           SUM(sai_p)  OVER w AS sai_p,
           SUM(sai_r)  OVER w AS sai_r
    FROM celula
    WINDOW w AS (PARTITION BY corte ORDER BY h
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  )
  SELECT 'entradas'::text, false, 'diario'::text, c.corte, c.h,
         c.ent_pb, c.ent_r, (c.ent_pb - c.ent_r) FROM celula c
  UNION ALL
  SELECT 'entradas', true, 'diario', c.corte, c.h,
         c.ent_pc, c.ent_r, (c.ent_pc - c.ent_r) FROM celula c
  UNION ALL
  SELECT 'entradas', false, 'acumulado', a.corte, a.h,
         a.ent_pb, a.ent_r, (a.ent_pb - a.ent_r) FROM acum a
  UNION ALL
  SELECT 'entradas', true, 'acumulado', a.corte, a.h,
         a.ent_pc, a.ent_r, (a.ent_pc - a.ent_r) FROM acum a
  UNION ALL
  SELECT 'saidas', NULL::boolean, 'diario', c.corte, c.h,
         c.sai_p, c.sai_r, (c.sai_p - c.sai_r) FROM celula c
  UNION ALL
  SELECT 'saidas', NULL::boolean, 'acumulado', a.corte, a.h,
         a.sai_p, a.sai_r, (a.sai_p - a.sai_r) FROM acum a;
$function$
;

revoke all on function public._backtest_errors_raw(p_org_id uuid, p_h_max integer, p_corte_min date, p_excluir_fantasmas boolean, p_deflator_span integer, p_maturacao_dias integer) from public;
revoke all on function public._backtest_errors_raw(p_org_id uuid, p_h_max integer, p_corte_min date, p_excluir_fantasmas boolean, p_deflator_span integer, p_maturacao_dias integer) from anon;
grant execute on function public._backtest_errors_raw(p_org_id uuid, p_h_max integer, p_corte_min date, p_excluir_fantasmas boolean, p_deflator_span integer, p_maturacao_dias integer) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- conciliacao_base_linhas(p_org_id uuid, p_janela_dias integer)  ·  INVOKER · STABLE
--
-- O QUE MUDOU: 1 predicado(s).
-- POR QUE: a agregacao de repasses contava compra pessoal como repasse de uma venda nossa, e a cascata a mandava para o balde `pedido_nao_ingerido`, onde ela se passava por venda perdida do G-05.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conciliacao_base_linhas(p_org_id uuid, p_janela_dias integer DEFAULT NULL::integer)
 RETURNS TABLE(caso_id uuid, ml_order_id text, tipo_caso text, fila text, acionavel boolean, motivo text, estado text, titulo text, sku text, quantidade integer, retido_de_fato numeric, cobranca_declarada numeric, residuo_ml numeric, esperado_nosso numeric, recebido numeric, residuo_nosso numeric, diferenca numeric, data_pedido date, data_evento date, dias_restantes integer, n_pagamentos integer, payment_ids text[], release_date_max date, valor_estimado boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
pedidos as (
  select o.ml_order_id,
         max(o.titulo)                        as titulo,
         max(o.sku)                           as sku,
         sum(o.quantidade)::int               as quantidade,
         sum(o.receita_bruta)                 as receita_bruta,
         max(o.comprador)                     as comprador,
         (left(min(o.data_pedido), 10))::date as data_pedido,
         -- 🔴 `data_pagamento` e COLUNA MORTA (100% NULL, C-06): nunca num WHERE.
         coalesce((left(max(o.data_pagamento), 10))::date,
                  (left(min(o.data_pedido), 10))::date) as data_evento_venda
    from public.orders o
   where o.organization_id = p_org_id
     and o.status in ('paid','shipped','delivered')
     and o.data_pedido >= to_char((select hoje - (janela + 45) from cfg), 'YYYY-MM-DD')
     and o.data_pedido <  to_char((select hoje + 1 from cfg), 'YYYY-MM-DD')
   group by o.ml_order_id
),
-- 🔴 GROUP BY, NUNCA join 1:1. Provado em producao por R-04: o pedido
-- 2000017188643228 tem DOIS pagamentos aprovados e a soma saiu 56,58 (nao 28,29
-- nem um dos dois isolado), residuo zero, e ele NAO virou caso falso.
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
   where ci.organization_id = p_org_id and ci.entra_no_caixa
     and ci.ml_order_id is not null
   group by ci.ml_order_id
),
-- 🔴 O netting de C-02, inalterado: o BONUS repete o valor exato do CHARGE que
-- aponta, entao somar direto declararia cobranca que nao existe.
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
         count(p.comprador) over (partition by p.comprador, p.data_pedido) as n_no_grupo
    from pedidos p
    left join rep r on r.ml_order_id = p.ml_order_id
    left join tar t on t.ml_order_id = p.ml_order_id
),
ev as (
  select c.*,
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
mot as (
  select x.*,
         case
           when x.data_evento < (select ingestao_inicio from cfg)
                then 'fora_da_janela_de_ingestao'
           when x.tem_mediacao
                then 'fora_do_escopo'
           when not x.tem_repasse and x.n_no_grupo > 1
                then 'possivel_carrinho'
           when not x.tem_repasse and x.dias_desde < (select dias_ausente from cfg)
                then 'aguardando_liberacao'
           when not x.tem_repasse and coalesce(kv.verificado_no_mp, false)
                and kv.status_mp_verificado in ('charged_back','cancelled','refunded')
                then 'fora_do_escopo'
           when not x.tem_repasse and coalesce(kv.verificado_no_mp, false)
                then 'sem_repasse_confirmado'
           -- 🔴 Provado nos dois sentidos por R-09: sem verificacao registrada a
           -- ausencia NAO acusa; com verificacao `approved` ela vira acionavel,
           -- com `charged_back` ela sai da fila para o rodape.
           when not x.tem_repasse
                then 'ausencia_a_verificar'
           when x.tem_aprovado and x.release_date_max > (select hoje from cfg)
                then 'aguardando_liberacao'
           when x.declarado is null
                then 'sem_captura_cobranca'
           when x.residuo_ml > (select piso from cfg) and (select acusar from cfg)
                then 'repasse_a_menor_confirmado'
           when x.residuo_ml > (select piso from cfg)
                then 'regua_nao_liberada'
           when abs(x.residuo_ml) <= (select piso from cfg)
                and abs(x.residuo_nosso) > (select piso from cfg)
                then 'divergencia_da_nossa_base'
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
entradas as (
  select ci.id                                       as origem_id,
         ci.ml_order_id,
         ci.payment_id,
         ci.release_date::date                       as release_date,
         ci.net_amount,
         ci.description,
         (ci.gross_amount is not distinct from ci.net_amount) as sem_tarifa,
         (o.ml_order_id is null)                     as sem_pedido,
         ci.entra_no_caixa,
         ci.motivo_fora_do_caixa
    from public.cash_inflows ci
    left join public.orders o
           on o.ml_order_id     = ci.ml_order_id
          and o.organization_id = ci.organization_id
   where ci.organization_id = p_org_id
     and ci.release_date >= (select hoje - janela from cfg)
     and (ci.ml_order_id is null or o.ml_order_id is null or ci.entra_no_caixa is false)
),
linhas_entrada as (
  select distinct on (e.payment_id)
         e.payment_id,
         e.ml_order_id,
         e.release_date,
         e.net_amount,
         e.description,
         case
           -- 🔴 225-11: o PRIMEIRO ramo, e por isso ele existe. A compra pessoal
           -- do titular carrega o identificador do pedido do OUTRO vendedor, entao
           -- ela TEM ml_order_id e caia no ramo de baixo — o mesmo balde das vendas
           -- realmente perdidas do G-05, cujo diagnostico ela vinha inflando.
           -- 🔴 A linha NAO some da tela: ela e NOMEADA. D-225-10 exige classificar
           -- toda entrada, e linha que sai da tela vira o buraco que a fase fecha.
           when e.entra_no_caixa is false then e.motivo_fora_do_caixa
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
       (l.motivo in ('sem_repasse_confirmado','repasse_a_menor_confirmado')) as acionavel,
       l.motivo,
       case
         -- 1. O desfecho REGISTRADO pelo usuario manda sempre, e nunca e
         --    sobrescrito por derivacao. `ka` entra como segunda opcao porque,
         --    no instante em que o repasse chega, `tipo_calc` vira
         --    `repasse_a_menor` e o caso persistido como `repasse_ausente`
         --    deixa de casar em `k`.
         when coalesce(k.estado, ka.estado) in ('contestado', 'ganho', 'negado')
              then coalesce(k.estado, ka.estado)
         -- 2. O repasse CHEGOU depois de um caso de ausencia aberto.
         --    ⚠️ `ka.estado` NULO nao entra de proposito: sem caso persistido
         --    nao houve caso para se resolver sozinho, e uma linha
         --    `abaixo_do_piso` com repasse aprovado viraria falso
         --    `resolvido_sozinho`. Aqui a ausencia de linha e a resposta certa.
         when ka.estado = 'aberto' and l.tem_repasse and l.tem_aprovado
              then 'resolvido_sozinho'
         -- 3. O prazo fechou sem desfecho — SO onde existe prazo de
         --    ressarcimento. A fila "Nosso erro" nao tem janela nenhuma;
         --    marcar correcao de cadastro como "prazo perdido" afirmaria que
         --    um prazo que nunca existiu foi perdido.
         when coalesce(k.estado, 'aberto') = 'aberto'
              and l.motivo in ('sem_repasse_confirmado', 'repasse_a_menor_confirmado',
                               'ausencia_a_verificar')
              and l.dias_restantes < 0
              then 'expirado'
         else coalesce(k.estado, 'aberto')
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
       -- 🔴 CORRECAO 4. `divergencia_da_nossa_base` so dispara quando
       -- |residuo_ml| <= piso, entao exibir residuo_ml ali mostrava justamente o
       -- numero pequeno: R-05 devolveu 8 linhas somando R$ 0,00. A grandeza da
       -- fila "nosso" e `residuo_nosso` — o tamanho do erro que e NOSSO.
       round(case when l.tipo_calc = 'repasse_ausente'            then l.receita_bruta
                  when l.motivo = 'divergencia_da_nossa_base'     then l.residuo_nosso
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
  -- 🔴 Lookup do caso de AUSENCIA por tipo LITERAL, ao lado do join principal.
  -- O join acima casa por `l.tipo_calc`, que muda de `repasse_ausente` para
  -- `repasse_a_menor` exatamente quando o dinheiro aparece — o unico momento em
  -- que `resolvido_sozinho` poderia ser detectado. Mesmo padrao ja em producao
  -- no `kv` da cascata de motivo: 1:1 pela chave unica
  -- (organization_id, ml_order_id, tipo_caso), portanto sem multiplicar linha.
  left join public.conciliacao_casos ka
         on ka.organization_id = p_org_id
        and ka.ml_order_id     = l.ml_order_id
        and ka.tipo_caso       = 'repasse_ausente'
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
$function$
;

revoke all on function public.conciliacao_base_linhas(p_org_id uuid, p_janela_dias integer) from public;
revoke all on function public.conciliacao_base_linhas(p_org_id uuid, p_janela_dias integer) from anon;
grant execute on function public.conciliacao_base_linhas(p_org_id uuid, p_janela_dias integer) to authenticated;
grant execute on function public.conciliacao_base_linhas(p_org_id uuid, p_janela_dias integer) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_cash_cycle(p_org_id uuid, p_janela_dias integer)  ·  INVOKER · STABLE
--
-- O QUE MUDOU: 1 predicado(s).
-- POR QUE: o ciclo de caixa media giro sobre um numerador que incluia compra pessoal.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cash_cycle(p_org_id uuid, p_janela_dias integer DEFAULT 90)
 RETURNS TABLE(valor_estoque numeric, unidades_estoque bigint, unidades_sem_custo bigint, skus_sem_custo bigint, cmv_diario numeric, cmv_pedidos bigint, dso_dias numeric, dso_n integer, dso_no_limite boolean, dpo_dias numeric, dpo_n integer, janela_dias integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT
      CURRENT_DATE                                        AS hoje,
      CURRENT_DATE - GREATEST(p_janela_dias, 1)           AS janela_ini,
      GREATEST(p_janela_dias, 1)                          AS janela
  ),

  -- ── Custo por SKU: uma linha por seller_sku, a mais recente ───────────────
  -- Custo ausente NAO vira 0 e NAO vira preco: a linha nao existe aqui, e a
  -- unidade cai na contagem declarada.
  custo_por_sku AS MATERIALIZED (
    SELECT DISTINCT ON (c.seller_sku)
      c.seller_sku,
      c.cost
    FROM public.ml_product_costs c
    WHERE c.organization_id = p_org_id
      AND c.seller_sku IS NOT NULL
      AND c.seller_sku <> ''
      AND c.cost IS NOT NULL
    ORDER BY c.seller_sku, c.updated_at DESC NULLS LAST
  ),

  -- ── Estoque fisico: `tiny_stock`, os tres depositos, com D-7 e D-6 ────────
  estoque_dedup AS MATERIALIZED (
    SELECT DISTINCT ON (s.sku, s.deposito)
      s.sku,
      s.deposito,
      s.disponivel
    FROM public.tiny_stock s
    WHERE s.organization_id = p_org_id
    ORDER BY s.sku, s.deposito, s.saldo DESC, s.tiny_id
  ),
  estoque_por_sku AS MATERIALIZED (
    SELECT
      d.sku,
      SUM(GREATEST(d.disponivel, 0))::numeric AS unidades
    FROM estoque_dedup d
    GROUP BY d.sku
    HAVING SUM(GREATEST(d.disponivel, 0)) > 0
  ),
  estoque AS MATERIALIZED (
    SELECT
      e.unidades,
      cps.cost
    FROM estoque_por_sku e
    LEFT JOIN custo_por_sku cps
      ON cps.seller_sku = e.sku
  ),
  estoque_agg AS (
    SELECT
      COALESCE(SUM(e.cost * e.unidades) FILTER (WHERE e.cost IS NOT NULL), 0)::numeric AS valor,
      COALESCE(SUM(e.unidades), 0)::bigint                                             AS unidades,
      COALESCE(SUM(e.unidades) FILTER (WHERE e.cost IS NULL), 0)::bigint               AS unidades_sem_custo,
      COUNT(*) FILTER (WHERE e.cost IS NULL)::bigint                                   AS skus_sem_custo
    FROM estoque e
  ),

  -- ── CMV realizado da janela ───────────────────────────────────────────────
  -- Predicado de pedido pago copiado de `get_cost_waterfall`. `orders.custo_unit`
  -- e a fonte CERTA aqui — CMV realizado — e a ERRADA para valorar estoque
  -- parado, que e `ml_product_costs`.
  cmv_agg AS (
    SELECT
      COALESCE(SUM(o.custo_unit * o.quantidade), 0)::numeric AS cmv_total,
      COUNT(*)::bigint                                       AS pedidos
    FROM public.orders o
    CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date >= p.janela_ini
      AND o.data_pedido::date <= p.hoje
  ),

  -- ── DSO: centroides ponderados, com o clamp da conta original preservado ──
  dso_liberacoes AS MATERIALIZED (
    SELECT
      SUM((ci.release_date - DATE '2000-01-01') * ci.gross_amount) AS soma_pond,
      SUM(ci.gross_amount)                                          AS soma_peso,
      COUNT(*)::int                                                 AS n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
      AND ci.release_date >= p.janela_ini
      AND ci.release_date <= p.hoje
      AND ci.gross_amount IS NOT NULL
      AND ci.gross_amount > 0
  ),
  dso_vendas AS MATERIALIZED (
    SELECT
      SUM(
        (o.data_pedido::date - DATE '2000-01-01')
        * COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)
      )                                                             AS soma_pond,
      SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)) AS soma_peso
    FROM public.orders o
    CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date >= p.janela_ini
      AND o.data_pedido::date <= p.hoje
      AND COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0) > 0
  ),
  dso_calc AS (
    SELECT
      CASE
        WHEN lb.soma_peso IS NULL OR lb.soma_peso = 0
          OR lv.soma_peso IS NULL OR lv.soma_peso = 0
          THEN NULL
        ELSE ROUND((lb.soma_pond / NULLIF(lb.soma_peso, 0))
                 - (lv.soma_pond / NULLIF(lv.soma_peso, 0)))::int
      END               AS bruto,
      COALESCE(lb.n, 0) AS n
    FROM dso_liberacoes lb
    CROSS JOIN dso_vendas lv
  ),
  dso_agg AS (
    SELECT
      CASE
        WHEN d.bruto IS NULL THEN 14
        ELSE LEAST(GREATEST(d.bruto, 7), 30)
      END::numeric AS dias,
      d.n          AS n,
      (d.bruto IS NULL OR d.bruto <= 7 OR d.bruto >= 30) AS no_limite
    FROM dso_calc d
  ),

  -- ── DPO: mediana do atraso entre competencia e pagamento, na MESMA janela ─
  dpo_agg AS (
    SELECT
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY (co.outflow_date - co.competence_date)::numeric
      )::numeric AS dias,
      COUNT(*)::int AS n
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'paid'
      AND co.competence_date IS NOT NULL
      AND co.category IN ('Fornecedores', 'Previsões de compra')
      AND co.outflow_date >= p.janela_ini
      AND co.outflow_date <= p.hoje
  )

  SELECT
    ea.valor                                            AS valor_estoque,
    ea.unidades                                         AS unidades_estoque,
    ea.unidades_sem_custo                               AS unidades_sem_custo,
    ea.skus_sem_custo                                   AS skus_sem_custo,
    -- Denominador vazio devolve NULL, jamais 0: a regua pura le a ausencia e
    -- diz o motivo. Um CMV diario de 0 tornaria o DIO infinito.
    (ca.cmv_total / NULLIF(p.janela, 0)::numeric)       AS cmv_diario,
    ca.pedidos                                          AS cmv_pedidos,
    da.dias                                             AS dso_dias,
    da.n                                                AS dso_n,
    da.no_limite                                        AS dso_no_limite,
    dpa.dias                                            AS dpo_dias,
    dpa.n                                               AS dpo_n,
    p.janela                                            AS janela_dias
  FROM params p
  CROSS JOIN estoque_agg ea
  CROSS JOIN cmv_agg ca
  CROSS JOIN dso_agg da
  CROSS JOIN dpo_agg dpa;
$function$
;

revoke all on function public.get_cash_cycle(p_org_id uuid, p_janela_dias integer) from public;
revoke all on function public.get_cash_cycle(p_org_id uuid, p_janela_dias integer) from anon;
grant execute on function public.get_cash_cycle(p_org_id uuid, p_janela_dias integer) to authenticated;
grant execute on function public.get_cash_cycle(p_org_id uuid, p_janela_dias integer) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_cashflow(p_org_id uuid, p_start_date date, p_end_date date, p_include_purchase_forecasts boolean)  ·  INVOKER · VOLATILE
--
-- O QUE MUDOU: 1 predicado(s).
-- POR QUE: e a funcao que a tela de caixa consome; ela somava net_amount filtrando so por organizacao e data, sem perguntar de quem era o dinheiro.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cashflow(p_org_id uuid, p_start_date date, p_end_date date, p_include_purchase_forecasts boolean DEFAULT false)
 RETURNS TABLE(date date, daily_income numeric, daily_expense numeric, daily_projection numeric, daily_balance numeric, accumulated_balance numeric, accumulated_balance_sma numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_initial  NUMERIC := 0;
  v_today    DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_start    DATE;
  v_sma      NUMERIC := 0;
  v_deflator NUMERIC := 1;
BEGIN
  v_initial := public.get_rolled_opening_balance(p_org_id);
  v_start := GREATEST(p_start_date, v_today);

  -- Janela movel de 30 dias, recalculada a cada chamada. NUNCA constante
  -- gravada: se a taxa de estorno se deslocar, isto se autocorrige sozinho
  -- (criterio 3 do ROADMAP).
  v_deflator := LEAST(1.0, GREATEST(0.80,
                  COALESCE(public.get_estorno_deflator(p_org_id, 30), 1)));

  v_sma := COALESCE((
    SELECT SUM(o.receita_bruta - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0)) / 15.0
    FROM orders o
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND LEFT(o.data_pedido, 10)::date BETWEEN v_today - 15 AND v_today - 1
  ), 0);

  RETURN QUERY
  WITH days AS (
    SELECT gs::date AS d_date FROM generate_series(v_start, p_end_date, INTERVAL '1 day') gs
  ),
  inc AS (
    SELECT ci.release_date AS d_date, SUM(ci.net_amount) AS amt
    FROM cash_inflows ci
    WHERE ci.organization_id = p_org_id AND ci.release_date BETWEEN v_start AND p_end_date AND ci.entra_no_caixa
    GROUP BY ci.release_date
  ),
  exp AS (
    SELECT co.outflow_date AS d_date, SUM(co.amount) AS amt
    FROM cash_outflows co
    WHERE co.organization_id = p_org_id
      AND co.outflow_date BETWEEN v_start AND p_end_date
      AND co.status = 'pending'
      AND (p_include_purchase_forecasts OR COALESCE(co.category, '') <> 'Previsões de compra')
    GROUP BY co.outflow_date
  ),
  daily AS (
    SELECT d.d_date,
           -- 🔴 O deflator entra AQUI, e SO na faixa D+1..D+9. Hoje nao leva
           -- (ja e realizado) e D+10 em diante nao leva (a agenda ainda nao
           -- foi preenchida e ja subestima — R-01 provou que deflacionar la
           -- PIORA o WAPE em todos os seis horizontes).
           CASE
             WHEN d.d_date > v_today AND d.d_date <= v_today + 9
               THEN COALESCE(i.amt, 0) * v_deflator
             ELSE COALESCE(i.amt, 0)
           END AS inc,
           COALESCE(e.amt, 0) AS exp
    FROM days d
    LEFT JOIN inc i ON i.d_date = d.d_date
    LEFT JOIN exp e ON e.d_date = d.d_date
  )
  SELECT d.d_date, d.inc, d.exp,
         -- daily_projection: zero enquanto a agenda cobre (ate o nono dia);
         -- do decimo em diante, o quanto a media acrescenta acima do
         -- confirmado. Corte do 224-02, inalterado.
         (CASE WHEN d.d_date <= v_today + 9 THEN 0::NUMERIC
               ELSE GREATEST(0, v_sma - d.inc)::NUMERIC END),
         (d.inc - d.exp),
         -- accumulated_balance: guarda do dia corrente PRESERVADA (o saldo
         -- rolado ja inclui hoje). A linha e a mesma do corpo vivo; o que
         -- mudou foi o valor de d.inc na faixa deflacionada, nao a expressao.
         (v_initial + SUM(
            CASE WHEN d.d_date > v_today THEN (d.inc - d.exp) ELSE 0 END
          ) OVER (ORDER BY d.d_date ASC))::NUMERIC,
         -- accumulated_balance_sma: dias 1 a 9 usam a agenda JA deflacionada;
         -- do decimo em diante a media de 15d vira piso, e o piso e BRUTO
         -- (M-01: bruto vence em 5 de 6 horizontes e no agregado).
         (v_initial + SUM(
            CASE WHEN d.d_date > v_today
                 THEN (CASE WHEN d.d_date <= v_today + 9 THEN d.inc ELSE GREATEST(d.inc, v_sma) END) - d.exp
                 ELSE 0 END
          ) OVER (ORDER BY d.d_date ASC))::NUMERIC
  FROM daily d
  ORDER BY d.d_date ASC;
END;
$function$
;

revoke all on function public.get_cashflow(p_org_id uuid, p_start_date date, p_end_date date, p_include_purchase_forecasts boolean) from public;
revoke all on function public.get_cashflow(p_org_id uuid, p_start_date date, p_end_date date, p_include_purchase_forecasts boolean) from anon;
grant execute on function public.get_cashflow(p_org_id uuid, p_start_date date, p_end_date date, p_include_purchase_forecasts boolean) to authenticated;
grant execute on function public.get_cashflow(p_org_id uuid, p_start_date date, p_end_date date, p_include_purchase_forecasts boolean) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_cashflow_data_health(p_org_id uuid)  ·  INVOKER · VOLATILE
--
-- O QUE MUDOU: nada no calculo — so o marcador de dispensa.
-- POR QUE: so le max(ci.synced_at) para dizer QUANDO a captura rodou. Nao soma dinheiro: filtrar aqui esconderia a defasagem da ingestao, que e o unico numero que esta funcao existe para dar.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cashflow_data_health(p_org_id uuid)
 RETURNS TABLE(tiny_last_sync timestamp with time zone, tiny_hours_ago numeric, tiny_stale boolean, mp_last_sync timestamp with time zone, mp_hours_ago numeric, mp_stale boolean, anchor_date date, anchor_days_ago numeric, anchor_stale boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- dispensa-do-filtro (225-11): so le max(ci.synced_at) para dizer QUANDO a captura rodou. Nao soma dinheiro: filtrar aqui esconderia a defasagem da ingestao, que e o unico numero que esta funcao existe para dar.
-- 🔴 Dispensa ESCRITA e decisao; dispensa por esquecimento e o defeito, e a
-- guarda desta migration nao sabe distinguir as duas sem este marcador.
DECLARE
  v_today           DATE        := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_tiny_last_sync  TIMESTAMPTZ;
  v_mp_last_sync    TIMESTAMPTZ;
  v_anchor_date     DATE;
  v_tiny_hours_ago  NUMERIC;
  v_mp_hours_ago    NUMERIC;
  v_anchor_days_ago NUMERIC;
BEGIN
  SELECT MAX(co.synced_at) FILTER (WHERE co.source = 'tiny')
    INTO v_tiny_last_sync
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id;

  SELECT MAX(ci.synced_at)
    INTO v_mp_last_sync
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id;

  SELECT fs.balance_anchor_date
    INTO v_anchor_date
  FROM public.financial_settings fs
  WHERE fs.organization_id = p_org_id
  LIMIT 1;

  v_tiny_hours_ago  := CASE WHEN v_tiny_last_sync IS NULL THEN NULL
                            ELSE EXTRACT(EPOCH FROM (now() - v_tiny_last_sync)) / 3600 END;
  v_mp_hours_ago    := CASE WHEN v_mp_last_sync IS NULL THEN NULL
                            ELSE EXTRACT(EPOCH FROM (now() - v_mp_last_sync)) / 3600 END;
  v_anchor_days_ago := CASE WHEN v_anchor_date IS NULL THEN NULL
                            ELSE (v_today - v_anchor_date) END;

  RETURN QUERY SELECT
    v_tiny_last_sync,
    v_tiny_hours_ago,
    (v_tiny_last_sync IS NULL OR v_tiny_hours_ago > 6),
    v_mp_last_sync,
    v_mp_hours_ago,
    (v_mp_last_sync IS NULL OR v_mp_hours_ago > 6),
    v_anchor_date,
    v_anchor_days_ago,
    (v_anchor_date IS NULL OR v_anchor_days_ago > 7);
END;
$function$
;

revoke all on function public.get_cashflow_data_health(p_org_id uuid) from public;
revoke all on function public.get_cashflow_data_health(p_org_id uuid) from anon;
grant execute on function public.get_cashflow_data_health(p_org_id uuid) to authenticated;
grant execute on function public.get_cashflow_data_health(p_org_id uuid) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_conciliacao_resumo(p_org_id uuid, p_janela_dias integer)  ·  INVOKER · STABLE
--
-- O QUE MUDOU: nada no calculo — so o marcador de dispensa.
-- POR QUE: so le max(ci.synced_at) como `ultima_sync`. O dinheiro do monitor vem de conciliacao_base_linhas, que ja filtra; somar a flag aqui nao mudaria numero nenhum e mascararia a data da ultima captura.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_conciliacao_resumo(p_org_id uuid, p_janela_dias integer DEFAULT NULL::integer)
 RETURNS TABLE(casos_urgentes integer, soma_urgente numeric, proximo_prazo_dias integer, acionaveis_n integer, vazamento_total numeric, sub_piso_n integer, sub_piso_soma numeric, nosso_erro_n integer, nosso_erro_soma numeric, fora_escopo_n integer, fora_escopo_soma numeric, entradas_sem_origem_n integer, entradas_sem_origem_soma numeric, a_verificar_n integer, a_verificar_soma numeric, recuperado_total numeric, saidas_auditadas boolean, ingestao_inicio date, piso_materialidade numeric, acusar_valor_a_menor boolean, dias_aguardando integer, dias_ausente integer, ultima_sync timestamp with time zone, linhas_total integer, teto_da_lista integer, valor_desconhecido_n integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
-- dispensa-do-filtro (225-11): so le max(ci.synced_at) como `ultima_sync`. O dinheiro do monitor vem de conciliacao_base_linhas, que ja filtra; somar a flag aqui nao mudaria numero nenhum e mascararia a data da ultima captura.
-- 🔴 Dispensa ESCRITA e decisao; dispensa por esquecimento e o defeito, e a
-- guarda desta migration nao sabe distinguir as duas sem este marcador.
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
-- O plano 06 uniu o frete no wrapper e nao aqui; desde entao o resumo contava
-- so a base (1.926) contra ~3.167 na lista, e `faltamLinhas` nunca podia ser
-- positivo. O Alert "A lista nao esta completa" ficou permanentemente inerte —
-- e ele existia para D-225-16, o criterio que a fase escolheu como o seu.
b as (
  select * from public.conciliacao_base_linhas(p_org_id, p_janela_dias)
  union all
  select * from public.conciliacao_frete_linhas(p_org_id, p_janela_dias)
)
select count(*) filter (where b.acionavel and b.dias_restantes <= 7)::int          as casos_urgentes,
       coalesce(sum(b.diferenca) filter (where b.acionavel and b.dias_restantes <= 7), 0) as soma_urgente,
       min(b.dias_restantes) filter (where b.acionavel)::int                       as proximo_prazo_dias,
       count(*) filter (where b.acionavel)::int                                    as acionaveis_n,
       coalesce(sum(b.diferenca) filter (where b.tipo_caso <> 'entrada_sem_origem'), 0) as vazamento_total,
       count(*) filter (where b.motivo = 'abaixo_do_piso')::int                    as sub_piso_n,
       coalesce(sum(b.diferenca) filter (where b.motivo = 'abaixo_do_piso'), 0)    as sub_piso_soma,
       count(*) filter (where b.fila = 'nosso' and b.tipo_caso <> 'entrada_sem_origem')::int as nosso_erro_n,
       -- 🔴 CORRECAO 3: SEM coalesce. Quando nenhuma das linhas tem valor
       -- mensuravel, este campo vem NULO — "nao sei" — e nunca R$ 0,00, que na
       -- tela leria "o nosso erro custa zero". A tela do plano 03 e obrigada a
       -- distinguir os dois (feedback_ausencia_diz_o_motivo_real).
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
       -- 🔴 CORRECAO 2: o total REAL, contado sem teto. A lista corta em 1.000 e
       -- hoje ha 1.351 linhas em 30 dias. Sem este campo a tela mostra 1.000 e o
       -- usuario acha que sao todos — e o caso da linha 1.001 nunca e olhado,
       -- que reprova D-225-16 direto.
       count(*)::int                                                               as linhas_total,
       1000                                                                        as teto_da_lista,
       -- Quantas linhas nao tem valor mensuravel. Existe para a tela poder dizer
       -- "31 casos, 12 sem valor apurado" em vez de somar zero por cima deles.
       count(*) filter (where b.diferenca is null)::int                            as valor_desconhecido_n
  from b;
$function$
;

revoke all on function public.get_conciliacao_resumo(p_org_id uuid, p_janela_dias integer) from public;
revoke all on function public.get_conciliacao_resumo(p_org_id uuid, p_janela_dias integer) from anon;
grant execute on function public.get_conciliacao_resumo(p_org_id uuid, p_janela_dias integer) to authenticated;
grant execute on function public.get_conciliacao_resumo(p_org_id uuid, p_janela_dias integer) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_daily_balance(p_org_id uuid, p_target_date date)  ·  INVOKER · VOLATILE
--
-- O QUE MUDOU: 1 predicado(s).
-- POR QUE: o saldo do dia somava a entrada falsa junto com a venda real.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_daily_balance(p_org_id uuid, p_target_date date)
 RETURNS TABLE(saldo_inicial numeric, entradas_hoje numeric, saidas_hoje numeric, saldo_final_previsto numeric, entradas_liquidadas numeric, saidas_pagas numeric, entradas_pendentes numeric, saidas_canceladas numeric, saldo_agora numeric, entradas_estado_desconhecido numeric, saidas_estado_desconhecido numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_initial   NUMERIC := 0;
  v_entradas  NUMERIC := 0;
  v_saidas    NUMERIC := 0;
  v_mov       RECORD;
BEGIN
  v_initial := COALESCE(public.get_rolled_opening_balance(p_org_id, p_target_date), 0);

  SELECT * INTO v_mov
  FROM public.get_movimentos_por_liquidacao(p_org_id, p_target_date);

  SELECT COALESCE(SUM(ci.net_amount), 0) INTO v_entradas
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
    AND ci.release_date = p_target_date;

  SELECT COALESCE(SUM(co.amount), 0) INTO v_saidas
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date = p_target_date
    AND COALESCE(co.status, '(nulo)') <> 'cancelled';

  RETURN QUERY SELECT
    v_initial,
    v_entradas,
    v_saidas,
    (v_initial + v_entradas - v_saidas),
    v_mov.entradas_liquidadas,
    v_mov.saidas_pagas,
    v_mov.entradas_pendentes,
    v_mov.saidas_canceladas,
    (v_initial + v_mov.entradas_liquidadas - v_mov.saidas_pagas),
    v_mov.entradas_estado_desconhecido,
    v_mov.saidas_estado_desconhecido;
END;
$function$
;

revoke all on function public.get_daily_balance(p_org_id uuid, p_target_date date) from public;
revoke all on function public.get_daily_balance(p_org_id uuid, p_target_date date) from anon;
grant execute on function public.get_daily_balance(p_org_id uuid, p_target_date date) to authenticated;
grant execute on function public.get_daily_balance(p_org_id uuid, p_target_date date) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_dre_cash(p_org_id uuid, p_month date)  ·  INVOKER · STABLE
--
-- O QUE MUDOU: 2 predicado(s).
-- POR QUE: a DRE de caixa e o numero que a empresa le todo mes; maio saia inflado em 2,93% no bruto e 3,68% no liquido.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dre_cash(p_org_id uuid, p_month date)
 RETURNS TABLE(secao text, bloco text, categoria text, total numeric, n integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH params AS MATERIALIZED (
    SELECT
      date_trunc('month', p_month)::date                        AS mes_ini,
      (date_trunc('month', p_month) + interval '1 month')::date AS mes_fim_excl,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date             AS hoje
  ),
  inflows_agg AS MATERIALIZED (
    SELECT
      COALESCE(SUM(ci.gross_amount) FILTER (
        WHERE ci.release_date <= p.hoje
      ), 0)                                                                        AS bruto_total,
      COUNT(*) FILTER (
        WHERE ci.release_date <= p.hoje
      )::int                                                                       AS bruto_n,
      COALESCE(SUM(
        CASE WHEN ci.net_amount > 0 THEN ci.net_amount ELSE ABS(ci.net_amount) END
      ) FILTER (
        WHERE ci.release_date <= p.hoje
      ), 0)                                                                        AS liquido_total,
      COUNT(*) FILTER (
        WHERE ci.release_date <= p.hoje
      )::int                                                                       AS liquido_n,
      COALESCE(SUM(ci.net_amount) FILTER (WHERE ci.release_date > p.hoje), 0)     AS a_liberar_total,
      COUNT(*) FILTER (WHERE ci.release_date > p.hoje)::int                        AS a_liberar_n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
      AND ci.release_date >= p.mes_ini
      AND ci.release_date <  p.mes_fim_excl
  ),
  refunds_agg AS MATERIALIZED (
    SELECT
      COALESCE(SUM(ci.net_amount), 0) AS refunds_total,
      COUNT(*)::int                    AS refunds_n
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
      AND ci.net_amount < 0
      AND COALESCE(ci.refund_date, ci.release_date) >= p.mes_ini
      AND COALESCE(ci.refund_date, ci.release_date) <  p.mes_fim_excl
      AND COALESCE(ci.refund_date, ci.release_date) <= p.hoje
  ),
  saida_agg AS MATERIALIZED (
    SELECT
      public.dre_bloco_for_category(co.category) AS bloco,
      co.category                                 AS categoria,
      SUM(co.amount)                              AS total,
      COUNT(*)::int                               AS n
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'paid'
      AND co.outflow_date >= p.mes_ini
      AND co.outflow_date <  p.mes_fim_excl
    GROUP BY 1, 2
  ),
  imposto_guia_mes AS MATERIALIZED (
    SELECT
      COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0) AS total,
      COUNT(*) FILTER (WHERE co.status = 'paid')::int                AS n
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND public.dre_bloco_for_category(co.category) = 'impostos_venda'
      AND co.outflow_date >= p.mes_ini
      AND co.outflow_date <  p.mes_fim_excl
  ),
  faturamento_mes AS MATERIALIZED (
    SELECT
      COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0) AS total,
      COUNT(*)::int                                                                AS n
    FROM public.orders o
    CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND o.data_pedido::date >= p.mes_ini
      AND o.data_pedido::date <  p.mes_fim_excl
  ),
  meses_anteriores AS MATERIALIZED (
    SELECT
      k,
      (date_trunc('month', p_month) - (k || ' months')::interval)::date        AS mes_k_ini,
      (date_trunc('month', p_month) - ((k - 1) || ' months')::interval)::date  AS mes_k_fim_excl
    FROM generate_series(1, 3) AS k
  ),
  guias_anteriores AS MATERIALIZED (
    SELECT
      m.k,
      COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0) AS guia
    FROM meses_anteriores m
    LEFT JOIN public.cash_outflows co
      ON co.organization_id = p_org_id
     AND public.dre_bloco_for_category(co.category) = 'impostos_venda'
     AND co.outflow_date >= m.mes_k_ini
     AND co.outflow_date <  m.mes_k_fim_excl
    GROUP BY m.k
  ),
  faturamento_anteriores AS MATERIALIZED (
    SELECT
      m.k,
      COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0) AS faturamento
    FROM meses_anteriores m
    LEFT JOIN public.orders o
      ON o.organization_id = p_org_id
     AND o.status IN ('paid','shipped','delivered')
     AND o.data_pedido::date >= m.mes_k_ini
     AND o.data_pedido::date <  m.mes_k_fim_excl
    GROUP BY m.k
  ),
  taxas AS MATERIALIZED (
    SELECT
      g.k,
      CASE
        WHEN g.guia > 0 AND f.faturamento > 0 THEN g.guia / f.faturamento
        ELSE NULL
      END AS taxa
    FROM guias_anteriores g
    JOIN faturamento_anteriores f USING (k)
  ),
  previsao_calc AS MATERIALIZED (
    SELECT
      AVG(taxa)     AS taxa_media,
      COUNT(taxa)::int AS n_validas
    FROM taxas
  )
  SELECT 'entrada'::text, NULL::text, 'bruto'::text,            ia.bruto_total,                     ia.bruto_n     FROM inflows_agg ia
  UNION ALL
  SELECT 'entrada'::text, NULL::text, 'liquido'::text,          ia.liquido_total,                   ia.liquido_n   FROM inflows_agg ia
  UNION ALL
  SELECT 'entrada'::text, NULL::text, 'descontos_fonte'::text,  (ia.bruto_total - ia.liquido_total), ia.bruto_n     FROM inflows_agg ia
  UNION ALL
  SELECT 'entrada'::text, NULL::text, 'refunds'::text,          ra.refunds_total,                   ra.refunds_n   FROM refunds_agg ra
  UNION ALL
  SELECT 'entrada'::text, NULL::text, 'a_liberar'::text,        ia.a_liberar_total,                 ia.a_liberar_n FROM inflows_agg ia
  UNION ALL
  SELECT 'saida'::text, sa.bloco, sa.categoria, sa.total, sa.n FROM saida_agg sa
  UNION ALL
  SELECT 'previsao'::text, NULL::text, 'imposto_guia_paga'::text, ig.total, ig.n FROM imposto_guia_mes ig
  UNION ALL
  SELECT 'previsao'::text, NULL::text, 'faturamento_mes'::text,   fm.total, fm.n FROM faturamento_mes fm
  UNION ALL
  SELECT
    'previsao'::text,
    NULL::text,
    'imposto_previsto'::text,
    CASE WHEN pc.n_validas > 0 THEN pc.taxa_media * fm.total ELSE NULL END,
    pc.n_validas
  FROM previsao_calc pc
  CROSS JOIN faturamento_mes fm
$function$
;

revoke all on function public.get_dre_cash(p_org_id uuid, p_month date) from public;
revoke all on function public.get_dre_cash(p_org_id uuid, p_month date) from anon;
grant execute on function public.get_dre_cash(p_org_id uuid, p_month date) to authenticated;
grant execute on function public.get_dre_cash(p_org_id uuid, p_month date) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_dre_cash_forecast(p_org_id uuid, p_month date)  ·  INVOKER · STABLE
--
-- O QUE MUDOU: 6 predicado(s).
-- POR QUE: a previsao projetava para a frente uma serie contaminada, em seis leituras diferentes da mesma tabela.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dre_cash_forecast(p_org_id uuid, p_month date)
 RETURNS TABLE(secao text, categoria text, total numeric, n integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH params AS MATERIALIZED (
    SELECT
      date_trunc('month', p_month)::date                          AS mes_ini,
      (date_trunc('month', p_month) + interval '1 month')::date   AS mes_fim_excl,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date               AS hoje,
      ((now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '90 days')::date AS janela_ini,
      ((now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '30 days')::date AS janela_taxas
  ),
  saidas_pagas_agg AS MATERIALIZED (
    SELECT COALESCE(SUM(co.amount), 0) AS total, COUNT(*)::int AS n
    FROM public.cash_outflows co CROSS JOIN params p
    WHERE co.organization_id = p_org_id AND co.status = 'paid'
      AND co.outflow_date >= p.mes_ini AND co.outflow_date < p.mes_fim_excl
  ),
  estornos_ocorridos_agg AS MATERIALIZED (
    SELECT COALESCE(ABS(SUM(ci.net_amount)), 0) AS total, COUNT(*)::int AS n
    FROM public.cash_inflows ci CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.net_amount < 0 AND ci.entra_no_caixa
      AND COALESCE(ci.refund_date, ci.release_date) >= p.mes_ini
      AND COALESCE(ci.refund_date, ci.release_date) < p.mes_fim_excl
      AND COALESCE(ci.refund_date, ci.release_date) <= p.hoje
  ),
  saidas_pendentes_agg AS MATERIALIZED (
    SELECT COALESCE(SUM(co.amount), 0) AS total, COUNT(*)::int AS n
    FROM public.cash_outflows co CROSS JOIN params p
    WHERE co.organization_id = p_org_id AND co.status = 'pending'
      AND (co.category IS DISTINCT FROM 'Previsões de compra')
      AND co.outflow_date >= p.hoje AND co.outflow_date < p.mes_fim_excl
  ),
  entradas_liberadas_agg AS MATERIALIZED (
    SELECT COALESCE(SUM(CASE WHEN ci.net_amount > 0 THEN ci.net_amount ELSE ABS(ci.net_amount) END), 0) AS total, COUNT(*)::int AS n
    FROM public.cash_inflows ci CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
      AND ci.release_date >= p.mes_ini AND ci.release_date < p.mes_fim_excl
      AND ci.release_date <= p.hoje
  ),
  entradas_agendadas_agg AS MATERIALIZED (
    SELECT COALESCE(SUM(ci.net_amount), 0) AS total, COUNT(*)::int AS n
    FROM public.cash_inflows ci CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
      AND ci.release_date > p.hoje AND ci.release_date < p.mes_fim_excl
  ),
  taxas_base AS MATERIALIZED (
    SELECT COALESCE(SUM(ci.gross_amount), 0) AS bruto_90,
           COALESCE(SUM(CASE WHEN ci.net_amount > 0 THEN ci.net_amount ELSE ABS(ci.net_amount) END), 0) AS liquido_90,
           COUNT(*)::int AS n_base
    FROM public.cash_inflows ci CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
      AND ci.release_date >= p.janela_taxas AND ci.release_date <= p.hoje
  ),
  taxas_estornos_calc AS MATERIALIZED (
    SELECT COALESCE(ABS(SUM(ci.net_amount)), 0) AS estornos_90, COUNT(*)::int AS n_estornos
    FROM public.cash_inflows ci CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.net_amount < 0 AND ci.entra_no_caixa
      AND COALESCE(ci.refund_date, ci.release_date) >= p.janela_taxas
      AND COALESCE(ci.refund_date, ci.release_date) <= p.hoje
  ),
  taxas_venda_calc AS MATERIALIZED (
    SELECT tb.n_base, te.n_estornos,
           (tb.liquido_90 / NULLIF(tb.bruto_90, 0))    AS taxa_liquido_bruto,
           (te.estornos_90 / NULLIF(tb.liquido_90, 0)) AS taxa_estornos
    FROM taxas_base tb CROSS JOIN taxas_estornos_calc te
  ),
  taxas_janela AS MATERIALIZED (
    SELECT n_base, n_estornos, taxa_liquido_bruto, taxa_estornos,
           CASE WHEN taxa_liquido_bruto IS NOT NULL
             THEN taxa_liquido_bruto * (1 - COALESCE(taxa_estornos, 0))
             ELSE NULL END AS taxa_venda_para_caixa
    FROM taxas_venda_calc
  ),
  lag_liberacoes_calc AS MATERIALIZED (
    SELECT SUM((ci.release_date - DATE '2000-01-01') * ci.gross_amount) AS soma_pond,
           SUM(ci.gross_amount) AS soma_peso, COUNT(*)::int AS n
    FROM public.cash_inflows ci CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
      AND ci.release_date >= p.janela_ini AND ci.release_date <= p.hoje
      AND ci.gross_amount IS NOT NULL AND ci.gross_amount > 0
  ),
  lag_vendas_calc AS MATERIALIZED (
    SELECT SUM((o.data_pedido::date - DATE '2000-01-01') * COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)) AS soma_pond,
           SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)) AS soma_peso
    FROM public.orders o CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND o.data_pedido::date >= p.janela_ini AND o.data_pedido::date <= p.hoje
      AND COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0) > 0
  ),
  lag_calc AS MATERIALIZED (
    SELECT CASE
        WHEN lb.soma_peso IS NULL OR lb.soma_peso = 0 OR lv.soma_peso IS NULL OR lv.soma_peso = 0 THEN 14
        ELSE LEAST(GREATEST(ROUND((lb.soma_pond / lb.soma_peso) - (lv.soma_pond / lv.soma_peso))::int, 7), 30)
      END AS lag_dias,
      COALESCE(lb.n, 0) AS n_base
    FROM lag_liberacoes_calc lb CROSS JOIN lag_vendas_calc lv
  ),
  vendas_7d_agg AS MATERIALIZED (
    SELECT COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0) / 7.0 AS media_diaria,
           COUNT(*)::int AS n
    FROM public.orders o CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND o.data_pedido::date >= p.hoje - 7
      AND o.data_pedido::date <= p.hoje - 1
  ),
  imposto_guia_mes AS MATERIALIZED (
    SELECT COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0) AS total,
           COUNT(*) FILTER (WHERE co.status = 'paid')::int AS n,
           COALESCE(SUM(co.amount) FILTER (WHERE co.status IN ('paid','pending')), 0) AS total_qualquer
    FROM public.cash_outflows co CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND public.dre_bloco_for_category(co.category) = 'impostos_venda'
      AND co.outflow_date >= p.mes_ini AND co.outflow_date < p.mes_fim_excl
  ),
  faturamento_mes AS MATERIALIZED (
    SELECT COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0) AS total, COUNT(*)::int AS n
    FROM public.orders o CROSS JOIN params p
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND o.data_pedido::date >= p.mes_ini AND o.data_pedido::date < p.mes_fim_excl
  ),
  meses_anteriores AS MATERIALIZED (
    SELECT k,
      (date_trunc('month', p_month) - (k || ' months')::interval)::date       AS mes_k_ini,
      (date_trunc('month', p_month) - ((k - 1) || ' months')::interval)::date AS mes_k_fim_excl
    FROM generate_series(1, 3) AS k
  ),
  guias_anteriores AS MATERIALIZED (
    SELECT m.k, COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0) AS guia
    FROM meses_anteriores m
    LEFT JOIN public.cash_outflows co
      ON co.organization_id = p_org_id
     AND public.dre_bloco_for_category(co.category) = 'impostos_venda'
     AND co.outflow_date >= m.mes_k_ini AND co.outflow_date < m.mes_k_fim_excl
    GROUP BY m.k
  ),
  faturamento_anteriores AS MATERIALIZED (
    SELECT m.k, COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0) AS faturamento
    FROM meses_anteriores m
    LEFT JOIN public.orders o
      ON o.organization_id = p_org_id
     AND o.status IN ('paid','shipped','delivered')
     AND o.data_pedido::date >= m.mes_k_ini AND o.data_pedido::date < m.mes_k_fim_excl
    GROUP BY m.k
  ),
  taxas AS MATERIALIZED (
    SELECT g.k,
      CASE WHEN g.guia > 0 AND f.faturamento > 0 THEN g.guia / f.faturamento ELSE NULL END AS taxa
    FROM guias_anteriores g JOIN faturamento_anteriores f USING (k)
  ),
  previsao_calc AS MATERIALIZED (
    SELECT AVG(taxa) AS taxa_media, COUNT(taxa)::int AS n_validas FROM taxas
  ),
  pendentes_mes_agg AS MATERIALIZED (
    SELECT DISTINCT co.category, co.amount
    FROM public.cash_outflows co CROSS JOIN params p
    WHERE co.organization_id = p_org_id AND co.status = 'pending'
      AND (co.category IS DISTINCT FROM 'Previsões de compra')
      AND co.outflow_date >= p.hoje AND co.outflow_date < p.mes_fim_excl
  ),
  pendentes_futuros_agg AS MATERIALIZED (
    SELECT co.category, co.amount,
           COUNT(DISTINCT date_trunc('month', co.outflow_date))::int AS n_meses_futuros
    FROM public.cash_outflows co CROSS JOIN params p
    WHERE co.organization_id = p_org_id AND co.status = 'pending'
      AND co.outflow_date >= p.mes_fim_excl
    GROUP BY co.category, co.amount
    HAVING COUNT(DISTINCT date_trunc('month', co.outflow_date)) >= 2
  ),
  recorrencia_suspeita AS MATERIALIZED (
    SELECT a.category, a.amount, f.n_meses_futuros
    FROM pendentes_mes_agg a
    JOIN pendentes_futuros_agg f ON f.category = a.category AND f.amount = a.amount
  )
  SELECT 'saida_prevista'::text, 'saidas_pagas'::text, spa.total, spa.n FROM saidas_pagas_agg spa
  UNION ALL
  SELECT 'saida_prevista'::text, 'estornos_ocorridos'::text, eo.total, eo.n FROM estornos_ocorridos_agg eo
  UNION ALL
  SELECT 'saida_prevista'::text, 'saidas_pendentes'::text, sp.total, sp.n FROM saidas_pendentes_agg sp
  UNION ALL
  SELECT 'saida_prevista'::text, 'estornos_previstos'::text, COALESCE(tj.taxa_estornos, 0) * ea.total, ea.n
    FROM taxas_janela tj CROSS JOIN entradas_agendadas_agg ea
  UNION ALL
  SELECT 'saida_prevista'::text, 'imposto_previsto_restante'::text,
         CASE WHEN igm.total_qualquer > 0 THEN 0 ELSE COALESCE(pc.taxa_media * fm.total, 0) END, pc.n_validas
    FROM imposto_guia_mes igm CROSS JOIN faturamento_mes fm CROSS JOIN previsao_calc pc
  UNION ALL
  SELECT 'entrada'::text, 'entradas_liberadas'::text, el.total, el.n FROM entradas_liberadas_agg el
  UNION ALL
  SELECT 'entrada'::text, 'entradas_agendadas'::text, ea.total, ea.n FROM entradas_agendadas_agg ea
  UNION ALL
  SELECT 'taxa'::text, 'taxa_liquido_bruto'::text, tj.taxa_liquido_bruto, tj.n_base FROM taxas_janela tj
  UNION ALL
  SELECT 'taxa'::text, 'taxa_estornos'::text, tj.taxa_estornos, tj.n_estornos FROM taxas_janela tj
  UNION ALL
  SELECT 'taxa'::text, 'taxa_venda_para_caixa'::text, tj.taxa_venda_para_caixa, NULL::integer FROM taxas_janela tj
  UNION ALL
  SELECT 'taxa'::text, 'lag_liberacao_dias'::text, lc.lag_dias::numeric, lc.n_base FROM lag_calc lc
  UNION ALL
  SELECT 'ritmo'::text, 'vendas_7d_media_diaria'::text, v7.media_diaria, v7.n FROM vendas_7d_agg v7
  UNION ALL
  SELECT 'alerta_recorrencia'::text, rs.category, rs.amount, rs.n_meses_futuros FROM recorrencia_suspeita rs
$function$
;

revoke all on function public.get_dre_cash_forecast(p_org_id uuid, p_month date) from public;
revoke all on function public.get_dre_cash_forecast(p_org_id uuid, p_month date) from anon;
grant execute on function public.get_dre_cash_forecast(p_org_id uuid, p_month date) to authenticated;
grant execute on function public.get_dre_cash_forecast(p_org_id uuid, p_month date) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_dre_cash_history(p_org_id uuid, p_months integer)  ·  INVOKER · STABLE
--
-- O QUE MUDOU: 2 predicado(s).
-- POR QUE: a serie historica da DRE alimentava comparacao mes a mes com entrada que nunca existiu.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dre_cash_history(p_org_id uuid, p_months integer)
 RETURNS TABLE(mes date, entradas numeric, saidas numeric, resultado numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH params AS MATERIALIZED (
    SELECT
      LEAST(GREATEST(p_months, 1), 12)                                          AS v_meses,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date                            AS hoje,
      (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        - ((LEAST(GREATEST(p_months, 1), 12) - 1) || ' months')::interval)::date AS range_ini
  ),
  meses AS MATERIALIZED (
    SELECT (date_trunc('month', p.hoje) - (gs || ' months')::interval)::date AS mes
    FROM params p, generate_series(0, p.v_meses - 1) AS gs
  ),
  inflows_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', ci.release_date)::date AS mes,
      COALESCE(SUM(
        CASE WHEN ci.net_amount > 0 THEN ci.net_amount ELSE ABS(ci.net_amount) END
      ), 0) AS entradas
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
      AND ci.release_date >= p.range_ini
      AND ci.release_date <= p.hoje
    GROUP BY 1
  ),
  estornos_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', COALESCE(ci.refund_date, ci.release_date))::date AS mes,
      COALESCE(ABS(SUM(ci.net_amount)), 0)                                  AS estornos
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
      AND ci.net_amount < 0
      AND COALESCE(ci.refund_date, ci.release_date) >= p.range_ini
      AND COALESCE(ci.refund_date, ci.release_date) <= p.hoje
    GROUP BY 1
  ),
  outflows_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', co.outflow_date)::date AS mes,
      COALESCE(SUM(co.amount), 0)                 AS saidas
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'paid'
      AND co.outflow_date >= p.range_ini
    GROUP BY 1
  )
  SELECT
    m.mes,
    COALESCE(i.entradas, 0)                                             AS entradas,
    COALESCE(o.saidas, 0) + COALESCE(e.estornos, 0)                     AS saidas,
    COALESCE(i.entradas, 0) - (COALESCE(o.saidas, 0) + COALESCE(e.estornos, 0)) AS resultado
  FROM meses m
  LEFT JOIN inflows_por_mes  i ON i.mes = m.mes
  LEFT JOIN outflows_por_mes o ON o.mes = m.mes
  LEFT JOIN estornos_por_mes e ON e.mes = m.mes
  ORDER BY m.mes;
$function$
;

revoke all on function public.get_dre_cash_history(p_org_id uuid, p_months integer) from public;
revoke all on function public.get_dre_cash_history(p_org_id uuid, p_months integer) from anon;
grant execute on function public.get_dre_cash_history(p_org_id uuid, p_months integer) to authenticated;
grant execute on function public.get_dre_cash_history(p_org_id uuid, p_months integer) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_estorno_deflator(p_org_id uuid, p_span_dias integer, p_maturacao_dias integer, p_asof date)  ·  INVOKER · STABLE
--
-- O QUE MUDOU: 1 predicado(s).
-- POR QUE: o deflator de estorno calibrava sobre estorno de compra pessoal — R$ 2.557,56 em 4 linhas que nao sao da empresa.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_estorno_deflator(p_org_id uuid, p_span_dias integer DEFAULT 30, p_maturacao_dias integer DEFAULT 14, p_asof date DEFAULT NULL::date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT
      COALESCE(p_asof, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS asof,
      (2.0 / (GREATEST(p_span_dias, 1) + 1))::numeric                  AS alpha,
      GREATEST(p_span_dias, 1)                                         AS span
  ),
  dia AS (
    SELECT
      ci.release_date AS d,
      SUM(abs(ci.net_amount))                                      AS liberado,
      COALESCE(SUM(abs(ci.net_amount)) FILTER (
        WHERE ci.refund_date IS NOT NULL AND ci.refund_date <= p.asof
      ), 0)                                                        AS estornado
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id  = p_org_id AND ci.entra_no_caixa
      AND ci.created_at::date <= p.asof
      AND ci.release_date     <= p.asof - p_maturacao_dias
      AND ci.release_date     >  p.asof - p_maturacao_dias - (4 * p.span)
    GROUP BY ci.release_date
  ),
  pond AS (
    SELECT
      SUM(power(1 - p.alpha, (p.asof - p_maturacao_dias - d.d)) * d.estornado) AS num,
      SUM(power(1 - p.alpha, (p.asof - p_maturacao_dias - d.d)) * d.liberado)  AS den
    FROM dia d CROSS JOIN params p
  )
  SELECT CASE
           WHEN pond.den IS NULL OR pond.den <= 0 THEN NULL::numeric
           ELSE LEAST(1.00::numeric,
                GREATEST(0.80::numeric, 1 - (pond.num / pond.den)))
         END
  FROM pond;
$function$
;

revoke all on function public.get_estorno_deflator(p_org_id uuid, p_span_dias integer, p_maturacao_dias integer, p_asof date) from public;
revoke all on function public.get_estorno_deflator(p_org_id uuid, p_span_dias integer, p_maturacao_dias integer, p_asof date) from anon;
grant execute on function public.get_estorno_deflator(p_org_id uuid, p_span_dias integer, p_maturacao_dias integer, p_asof date) to authenticated;
grant execute on function public.get_estorno_deflator(p_org_id uuid, p_span_dias integer, p_maturacao_dias integer, p_asof date) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_estorno_serie_diaria(p_org_id uuid, p_dias integer)  ·  INVOKER · STABLE
--
-- O QUE MUDOU: 1 predicado(s).
-- POR QUE: a serie diaria de estorno somava os mesmos 4 estornos falsos.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_estorno_serie_diaria(p_org_id uuid, p_dias integer DEFAULT 180)
 RETURNS TABLE(dia date, valor_liberado numeric, valor_estornado numeric, n_parcelas integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    ci.release_date,
    SUM(abs(ci.net_amount)),
    COALESCE(SUM(abs(ci.net_amount)) FILTER (WHERE ci.refund_date IS NOT NULL), 0),
    COUNT(*)::int
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
    AND ci.release_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - p_dias
    AND ci.release_date <  (now() AT TIME ZONE 'America/Sao_Paulo')::date
  GROUP BY ci.release_date
  ORDER BY ci.release_date;
$function$
;

revoke all on function public.get_estorno_serie_diaria(p_org_id uuid, p_dias integer) from public;
revoke all on function public.get_estorno_serie_diaria(p_org_id uuid, p_dias integer) from anon;
grant execute on function public.get_estorno_serie_diaria(p_org_id uuid, p_dias integer) to authenticated;
grant execute on function public.get_estorno_serie_diaria(p_org_id uuid, p_dias integer) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_movimentos_por_liquidacao(p_org_id uuid, p_dia date)  ·  INVOKER · VOLATILE
--
-- O QUE MUDOU: 1 predicado(s).
-- POR QUE: os movimentos por liquidacao listavam entrada que nao e receita da empresa.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_movimentos_por_liquidacao(p_org_id uuid, p_dia date)
 RETURNS TABLE(entradas_liquidadas numeric, entradas_pendentes numeric, entradas_estado_desconhecido numeric, saidas_pagas numeric, saidas_previstas numeric, saidas_canceladas numeric, saidas_estado_desconhecido numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ent_total   NUMERIC := 0;
  v_ent_liq     NUMERIC := 0;
  v_ent_desc    NUMERIC := 0;
  v_sai_paid    NUMERIC := 0;
  v_sai_pend    NUMERIC := 0;
  v_sai_canc    NUMERIC := 0;
  v_sai_desc    NUMERIC := 0;
BEGIN
  SELECT
    COALESCE(SUM(ci.net_amount), 0),
    COALESCE(SUM(ci.net_amount) FILTER (
      WHERE ci.status_mp IN ('approved', 'refunded')
    ), 0),
    COALESCE(SUM(ci.net_amount) FILTER (
      WHERE COALESCE(ci.status_mp, '(nulo)')
            NOT IN ('approved', 'refunded', 'in_mediation')
    ), 0)
  INTO v_ent_total, v_ent_liq, v_ent_desc
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
    AND ci.release_date = p_dia;

  SELECT
    COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0),
    COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'pending'), 0),
    COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'cancelled'), 0),
    COALESCE(SUM(co.amount) FILTER (
      WHERE COALESCE(co.status, '(nulo)') NOT IN ('paid', 'pending', 'cancelled')
    ), 0)
  INTO v_sai_paid, v_sai_pend, v_sai_canc, v_sai_desc
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.outflow_date = p_dia;

  RETURN QUERY SELECT
    v_ent_liq,
    (v_ent_total - v_ent_liq),
    v_ent_desc,
    v_sai_paid,
    v_sai_pend,
    v_sai_canc,
    v_sai_desc;
END;
$function$
;

revoke all on function public.get_movimentos_por_liquidacao(p_org_id uuid, p_dia date) from public;
revoke all on function public.get_movimentos_por_liquidacao(p_org_id uuid, p_dia date) from anon;
grant execute on function public.get_movimentos_por_liquidacao(p_org_id uuid, p_dia date) to authenticated;
grant execute on function public.get_movimentos_por_liquidacao(p_org_id uuid, p_dia date) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_projected_balance_summary(p_org_id uuid, p_projection_days integer, p_include_purchase_forecasts boolean)  ·  INVOKER · VOLATILE
--
-- O QUE MUDOU: 2 predicado(s).
-- POR QUE: o saldo projetado incluia a linha de 09/09/2026 (R$ 28,59), que e compra pessoal com liberacao no futuro.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_projected_balance_summary(p_org_id uuid, p_projection_days integer, p_include_purchase_forecasts boolean DEFAULT false)
 RETURNS TABLE(current_balance numeric, pessimistic_balance numeric, realistic_balance numeric, critical_date date, min_balance numeric, confirmed_income numeric, total_expenses numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_initial NUMERIC := 0; v_current NUMERIC := 0; v_pess NUMERIC := 0; v_real NUMERIC := 0;
  v_critical DATE := NULL; v_min NUMERIC := 0; v_income NUMERIC := 0; v_expenses NUMERIC := 0;
  v_day INT; v_day_date DATE; v_day_inc NUMERIC; v_day_exp NUMERIC;
BEGIN
  v_initial := public.get_rolled_opening_balance(p_org_id);
  v_current := v_initial;
  v_pess := v_current; v_real := v_current; v_min := v_current;
  SELECT COALESCE(SUM(ci.net_amount),0) INTO v_income FROM cash_inflows ci
   WHERE ci.organization_id=p_org_id AND ci.release_date > v_today AND ci.release_date <= v_today + p_projection_days AND ci.entra_no_caixa;
  SELECT COALESCE(SUM(co.amount),0) INTO v_expenses FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.outflow_date > v_today AND co.outflow_date <= v_today + p_projection_days
     AND (p_include_purchase_forecasts OR COALESCE(co.category,'') <> 'Previsões de compra');
  FOR v_day IN 1..p_projection_days LOOP
    v_day_date := v_today + v_day;
    SELECT COALESCE(SUM(ci.net_amount),0) INTO v_day_inc FROM cash_inflows ci WHERE ci.organization_id=p_org_id AND ci.release_date = v_day_date AND ci.entra_no_caixa;
    SELECT COALESCE(SUM(co.amount),0) INTO v_day_exp FROM cash_outflows co WHERE co.organization_id=p_org_id AND co.outflow_date = v_day_date
       AND (p_include_purchase_forecasts OR COALESCE(co.category,'') <> 'Previsões de compra');
    v_pess := v_pess - v_day_exp;
    v_real := v_real + v_day_inc - v_day_exp;
    IF v_critical IS NULL AND v_real < 0 THEN v_critical := v_day_date; END IF;
    IF v_real < v_min THEN v_min := v_real; END IF;
  END LOOP;
  RETURN QUERY SELECT v_current, v_pess, v_real, v_critical, v_min, v_income, v_expenses;
END; $function$
;

revoke all on function public.get_projected_balance_summary(p_org_id uuid, p_projection_days integer, p_include_purchase_forecasts boolean) from public;
revoke all on function public.get_projected_balance_summary(p_org_id uuid, p_projection_days integer, p_include_purchase_forecasts boolean) from anon;
grant execute on function public.get_projected_balance_summary(p_org_id uuid, p_projection_days integer, p_include_purchase_forecasts boolean) to authenticated;
grant execute on function public.get_projected_balance_summary(p_org_id uuid, p_projection_days integer, p_include_purchase_forecasts boolean) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_rolled_opening_balance(p_org_id uuid, p_as_of date)  ·  INVOKER · VOLATILE
--
-- O QUE MUDOU: 1 predicado(s).
-- POR QUE: o saldo de abertura rolado carregava o acumulado contaminado para o dia seguinte.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_rolled_opening_balance(p_org_id uuid, p_as_of date)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anchor_date DATE;
  v_anchor_bal  NUMERIC := 0;
  v_inc         NUMERIC := 0;
  v_paid_exp    NUMERIC := 0;
BEGIN
  SELECT fs.balance_anchor_date, fs.initial_balance
    INTO v_anchor_date, v_anchor_bal
  FROM public.financial_settings fs
  WHERE fs.organization_id = p_org_id
  LIMIT 1;

  IF v_anchor_date IS NULL THEN
    RETURN COALESCE(v_anchor_bal, 0);
  END IF;

  SELECT COALESCE(SUM(ci.net_amount), 0) INTO v_inc
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id AND ci.entra_no_caixa
    AND ci.release_date >= v_anchor_date
    AND ci.release_date <  p_as_of;

  SELECT COALESCE(SUM(co.amount), 0) INTO v_paid_exp
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.status = 'paid'
    AND co.outflow_date >= v_anchor_date
    AND co.outflow_date <  p_as_of;

  RETURN v_anchor_bal + v_inc - v_paid_exp;
END;
$function$
;

revoke all on function public.get_rolled_opening_balance(p_org_id uuid, p_as_of date) from public;
revoke all on function public.get_rolled_opening_balance(p_org_id uuid, p_as_of date) from anon;
grant execute on function public.get_rolled_opening_balance(p_org_id uuid, p_as_of date) to authenticated;
grant execute on function public.get_rolled_opening_balance(p_org_id uuid, p_as_of date) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- get_treasury_panel(p_org_id uuid, p_horizon integer, p_include_purchase_forecasts boolean)  ·  INVOKER · VOLATILE
--
-- O QUE MUDOU: 2 predicado(s).
-- POR QUE: o painel de tesouraria mediu o colchao de 2 dias da Fase 230 sobre um numerador que incluia compra pessoal.
-- R$ 12.232,60 de compra pessoal do titular somaram como receita desde
-- 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89) — 38 linhas,
-- classificadas 438 de 438 contra a API do Mercado Pago pelo par
-- collector_id x payer_id, nunca por anti-join contra `orders`.
--
-- 🔴 CORPO VIVO, lido do banco com pg_get_functiondef em 04/09/2026 e injetado
-- por script. Nenhum byte veio do repositorio: foi assim que `get_cashflow`
-- regrediu R$ 30.372,11 nesta casa.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_treasury_panel(p_org_id uuid, p_horizon integer DEFAULT 30, p_include_purchase_forecasts boolean DEFAULT false)
 RETURNS TABLE(burn_rate numeric, alert_threshold numeric, alert_date date, min_balance_date date, min_balance numeric, entrada_real_30d numeric, saida_real_30d numeric, fornec_30d numeric, fornec_60d numeric, fornec_90d numeric, total_exposicao numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_alert_thresh NUMERIC := 30000; v_initial NUMERIC := 0; v_current NUMERIC := 0;
  v_burn NUMERIC := 0; v_entrada NUMERIC := 0; v_saida NUMERIC := 0;
  v_f30 NUMERIC := 0; v_f60 NUMERIC := 0; v_f90 NUMERIC := 0; v_total NUMERIC := 0;
  v_alert_date DATE := NULL; v_min_bal_date DATE := NULL;
  v_bal NUMERIC; v_min_bal NUMERIC; v_day_inc NUMERIC; v_day_exp NUMERIC; v_day INT;
BEGIN
  SELECT COALESCE(fs.alert_threshold, 30000)
  INTO v_alert_thresh FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1;
  v_initial := public.get_rolled_opening_balance(p_org_id);
  v_current := v_initial;
  SELECT COALESCE(SUM(co.amount),0)/3.0 INTO v_burn FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.outflow_date >= v_today - 90 AND co.outflow_date < v_today AND co.status='paid';
  SELECT COALESCE(SUM(ci.net_amount),0) INTO v_entrada FROM cash_inflows ci
   WHERE ci.organization_id=p_org_id AND ci.release_date >= v_today - 30 AND ci.release_date <= v_today AND ci.entra_no_caixa;
  SELECT COALESCE(SUM(co.amount),0) INTO v_saida FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.outflow_date >= v_today - 30 AND co.outflow_date <= v_today AND co.status='paid';
  SELECT COALESCE(SUM(co.amount),0) INTO v_f30 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending' AND co.outflow_date <= v_today + 30;
  SELECT COALESCE(SUM(co.amount),0) INTO v_f60 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending' AND co.outflow_date <= v_today + 60;
  SELECT COALESCE(SUM(co.amount),0) INTO v_f90 FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending' AND co.outflow_date <= v_today + 90;
  SELECT COALESCE(SUM(co.amount),0) INTO v_total FROM cash_outflows co
   WHERE co.organization_id=p_org_id AND co.supplier IS NOT NULL AND co.status='pending';
  v_bal := v_current; v_min_bal := v_current; v_min_bal_date := v_today;
  FOR v_day IN 1..p_horizon LOOP
    SELECT COALESCE(SUM(ci.net_amount),0) INTO v_day_inc FROM cash_inflows ci WHERE ci.organization_id=p_org_id AND ci.release_date = v_today + v_day AND ci.entra_no_caixa;
    SELECT COALESCE(SUM(co.amount),0) INTO v_day_exp FROM cash_outflows co WHERE co.organization_id=p_org_id AND co.outflow_date = v_today + v_day
       AND (p_include_purchase_forecasts OR COALESCE(co.category,'') <> 'Previsões de compra');
    v_bal := v_bal + v_day_inc - v_day_exp;
    IF v_alert_date IS NULL AND v_bal < v_alert_thresh THEN v_alert_date := v_today + v_day; END IF;
    IF v_bal < v_min_bal THEN v_min_bal := v_bal; v_min_bal_date := v_today + v_day; END IF;
  END LOOP;
  RETURN QUERY SELECT v_burn, v_alert_thresh, v_alert_date, v_min_bal_date, v_min_bal, v_entrada, v_saida, v_f30, v_f60, v_f90, v_total;
END; $function$
;

revoke all on function public.get_treasury_panel(p_org_id uuid, p_horizon integer, p_include_purchase_forecasts boolean) from public;
revoke all on function public.get_treasury_panel(p_org_id uuid, p_horizon integer, p_include_purchase_forecasts boolean) from anon;
grant execute on function public.get_treasury_panel(p_org_id uuid, p_horizon integer, p_include_purchase_forecasts boolean) to authenticated;
grant execute on function public.get_treasury_panel(p_org_id uuid, p_horizon integer, p_include_purchase_forecasts boolean) to service_role;


-- ═══ BLOCO 3 — A GUARDA DE POS-ESTADO, DENOMINADOR ANTES DE NUMERADOR ═══════
--
-- ⚠️ A idempotencia NAO mora aqui: ela e o Bloco 0, no topo. Esta guarda prova o
-- POS-ESTADO. Misturar as duas foi o defeito que travava a primeira aplicacao.
do $$
declare
  v_denominador int;
  v_sem_filtro  int;
  v_definidoras int;
  v_anon        int;
  v_lista       text;
begin
  -- ── (1) DENOMINADOR, antes de qualquer numerador ─────────────────────────
  select count(*) into v_denominador
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prokind='f'
     and pg_get_functiondef(p.oid) ilike '%cash_inflows%';

  if v_denominador < 16 then
    raise exception
      '225-11 DENOMINADOR SUSPEITO: a guarda enxerga % funcoes lendo cash_inflows, e a leitura do banco antes da migration mediu 16. Um gate que aprova por nao ter achado nada para olhar nao e aprovacao.',
      v_denominador;
  end if;

  -- ── (2) COBERTURA: zero funcoes sem filtro E sem marcador ────────────────
  --
  -- 🔴 A assimetria e de proposito: o PREDICADO e procurado no corpo SEM as
  -- linhas de comentario (comentario que fala do filtro nao E o filtro); o
  -- MARCADOR DE DISPENSA e procurado no corpo INTEIRO, porque ele e um
  -- comentario por natureza. Dispensa escrita e decisao; dispensa por
  -- esquecimento e o defeito.
  select count(*), string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
    into v_sem_filtro, v_lista
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prokind='f'
     and pg_get_functiondef(p.oid) ilike '%cash_inflows%'
     and regexp_replace(pg_get_functiondef(p.oid), '^[[:space:]]*--.*$', '', 'gn') not ilike '%entra_no_caixa%'
     and pg_get_functiondef(p.oid) not ilike '%dispensa-do-filtro%';

  if v_sem_filtro > 0 then
    raise exception
      '225-11 COBERTURA: % funcao(oes) ainda somam cash_inflows sem olhar a flag e sem marcador de dispensa: %. Se a dispensa e proposital, ESCREVA o marcador `dispensa-do-filtro` no corpo dela — NAO acrescente o filtro a funcao que nao soma dinheiro.',
      v_sem_filtro, v_lista;
  end if;

  -- ── (3) SEGURANCA PRESERVADA ─────────────────────────────────────────────
  select count(*) filter (where p.prosecdef) into v_definidoras
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prokind='f'
     and pg_get_functiondef(p.oid) ilike '%cash_inflows%';

  if v_definidoras <> 1 then
    raise exception
      '225-11 SEGURANCA: % funcoes definidoras entre as que leem cash_inflows, contra 1 medidas antes. Funcao de tenant com parametro de organizacao em SECURITY DEFINER e IDOR, e o numero de uma loja ja apareceu na tela da outra nesta base.',
      v_definidoras;
  end if;

  -- ── (4) PERMISSOES: nao exige melhora, exige que nada piore em silencio ──
  select count(*) filter (
           where has_function_privilege('anon', p.oid, 'EXECUTE')
              or has_function_privilege('public', p.oid, 'EXECUTE'))
    into v_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prokind='f'
     and pg_get_functiondef(p.oid) ilike '%cash_inflows%';

  if v_anon > 0 then
    raise exception
      '225-11 PERMISSOES: % funcoes executaveis por anon ou public, contra 0 medidas antes da migration. CREATE OR REPLACE preserva a lista, entao um aumento aqui significa que alguem a alargou.',
      v_anon;
  end if;

  raise notice '225-11 pos-estado OK: denominador %, sem filtro %, definidoras %, anon/public %.',
    v_denominador, v_sem_filtro, v_definidoras, v_anon;
end $$;
