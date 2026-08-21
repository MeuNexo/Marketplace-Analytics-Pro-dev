-- ============================================================
-- Erro da provisao de imposto — medicao retroativa (Fase 224, ERR-05)
-- ============================================================
-- Mede de quanto erra a provisao QUE JA EXISTE. Nao propoe outra, nao
-- altera nenhuma RPC, e NAO INVENTA REGUA NOVA para numero que ja existe
-- em producao.
--
-- O PREVISTO e o clone literal da previsao_calc de get_dre_cash_forecast
-- (20260717070000_forecast_pendentes_reais.sql:266-336): media das taxas
-- guia/faturamento dos TRES meses anteriores, aplicada ao faturamento do
-- mes. Meses sem guia ou sem faturamento nao entram na media.
--
-- ⚠️ ACHADO DECLARADO, NAO CORRIGIDO: essa taxa e estimada como
-- "guia paga no mes k / faturamento do mes k" — o mesmo desalinhamento de
-- um mes que a regua M+1 existe para evitar. E provavelmente PARTE do erro
-- que esta funcao mede. Corrigir a formula esta FORA de escopo
-- (224-CONTEXT <domain>: "medir o erro da provisao e aceitavel como saida;
-- buscar previsao exata, nao"). Clonar com "melhorias" mediria o erro de
-- algo que ninguem usa.
--
-- 🔴🔴 ACHADO QUE MUDA O DESENHO DESTA MIGRATION (Q-B, medido 21/08/2026,
-- postgres, org Pe Vermeio 7f615df7-7bac-45e5-8a93-827fb9ddeec7):
-- A REGUA M+1 FOI TESTADA E REFUTADA para `impostos_venda` nesta conta.
-- Nas 46 linhas `paid` do bloco impostos_venda, `outflow_date` cai no
-- MESMO MES que `competence_date` em 46 de 46 (0 no mes seguinte).
-- `competence_date` e sempre normalizado para o dia 1; `outflow_date` cai
-- entre os dias 13 e 29 do MESMO mes, com mediana no dia 21 (dif_dias:
-- min 13, mediana 20, max 29). Ou seja: a guia de ICMS/PIS/COFINS da
-- Pe Vermeio e paga dentro do proprio mes de competencia — nao no mes
-- seguinte.
--
-- Isso NAO invalida a regua M+1 da Fase 94 em `useImpostoGuiaReal.ts`
-- (decisao TRAVADA, e o motivo dela e outro: e a leitura de QUANDO A VENDA
-- GEROU o imposto, nao de quando a guia historicamente caiu nesta conta;
-- alem disso a regua trava tambem a conta do Junior, que tem competencia
-- diferente — ver `project_junior_imposto_por_competencia`). Este plano
-- NAO toca `useImpostoGuiaReal.ts` nem `get_imposto_guia_by_competence`.
--
-- A consequencia e so PARA ESTA FUNCAO NOVA: o lado de apuracao casa a
-- guia pela MESMA competencia da venda (chama a RPC em `m.mes_ini`, nao em
-- `m.mes_fim_excl`/M+1) — porque e isso que os dados desta conta provam
-- ser o padrao real de pagamento. Chamar a RPC em M+1 aqui casaria cada
-- guia com o mes ERRADO e o erro medido seria artefato de calendario, nao
-- erro de provisao. `224-IMPOSTO.md` declara este achado com os numeros.
--
-- DUAS REGUAS DE REALIZADO, cada uma respondendo a SUA pergunta:
--
--   guia_caixa_no_mes   -> "quanto de imposto SAIU DO CAIXA no mes M?"
--     Clone de imposto_guia_mes (20260717070000:266-278): cash_outflows,
--     bloco impostos_venda, status='paid', outflow_date dentro de M.
--     E a comparacao internamente consistente com a provisao, que e um
--     numero de CAIXA. Nao leva deslocamento nenhum.
--
--   guia_apuracao_m_mais_1 -> "quanto as VENDAS do mes M geraram de imposto?"
--     (nome da coluna preservado do plano original por compatibilidade de
--     leitura entre 224-MEDICOES.md/224-CONTEXT.md e este artefato; o
--     CONTEUDO deixou de ser M+1 — ver achado acima). Lido da RPC VIVA
--     get_imposto_guia_by_competence, chamada na MESMA competencia da
--     venda (`m.mes_ini`), com a MESMA agregacao de estado que
--     dreRegime.ts:121-135 usa: 'cancelled' NUNCA soma (e credito sem
--     guia), 'paid' e 'pending' somam.
--     A RPC nao e modificada aqui nem em lugar nenhum: ela tem multiplos
--     consumidores vivos e a migration irma dela (20260716230000:3) manda
--     nunca altera-la.
--
-- A regua NAO se escolhe pelo numero que ela produz. As duas saem lado a
-- lado, rotuladas, e 224-IMPOSTO.md diz qual responde qual pergunta.
--
-- REGUA DO FATURAMENTO: o.data_pedido::date, identica a faturamento_mes da
-- Fase 100 (mesmo arquivo, linhas 279-289). Deliberadamente NAO se usa
-- LEFT(o.data_pedido,10)::date, que outras partes do repositorio preferem:
-- reproduzir a provisao significa reproduzir as escolhas dela, inclusive
-- as que se discordaria hoje.
--
-- AUSENCIA. Mes sem base suficiente devolve taxa e provisao NULAS, nunca
-- zero. Do lado do REALIZADO (guia_caixa e guia_apuracao), ausencia
-- TAMBEM e NULL, nunca zero.
--
-- 🔴 CORRECAO (achado da 1a rodada de I-01, medido pelo orquestrador em
-- producao, 21/08/2026): a versao anterior detectava lacuna por "nenhuma
-- LINHA no mes, seja qual for o status" — e isso deixava passar um 0,00
-- fantasma sempre que existia uma linha 'cancelled' (ou 'pending') mas
-- NENHUMA 'paid'/nao-cancelada. Prova ao vivo: 11/2025 tem uma linha
-- `cancelled` (R$ 15.673,84) e NENHUMA `paid` -> a versao anterior via
-- "existe linha" e somava o FILTER de paid, que dava 0 -> guia_caixa =
-- 0,00 (ERRADO, produziu um erro_regua_caixa de +R$ 13.154,79 que nao
-- existe). 12/2025 nao tem NENHUMA linha em nenhum estado -> a mesma
-- versao anterior corretamente dava NULL. Os dois meses sao a MESMA
-- lacuna (nao ha guia paga) e tinham que dar o MESMO resultado.
--
-- A lacuna agora e detectada pelo status que CADA lado realmente soma —
-- nao pela existencia de QUALQUER linha:
--   guia_caixa    -> lacuna quando nao ha NENHUMA linha 'paid' no mes
--                    (uma linha 'cancelled' ou 'pending' sozinha nao
--                    conta como guia realizada no caixa).
--   guia_apuracao -> lacuna quando nao ha NENHUMA linha 'paid' ou
--                    'pending' na competencia (uma competencia 100%
--                    'cancelled' e, para efeito desta MEDICAO DE ERRO,
--                    tratada como lacuna, nao como zero reconhecido).
--
-- ⚠️ Isto DIVERGE, de proposito e so aqui, da regra de dreRegime.ts
-- ("Mes 100% credito -> 0, nao null") para a TELA de Fechar o Mes. La,
-- 0 e uma resposta operacional legitima (nao ha imposto a pagar). Aqui a
-- pergunta e outra: "o erro da provisao contra este mes e confiavel?" —
-- e um mes 100% cancelado NAO tem guia real para comparar contra a
-- provisao, entao vira ausencia declarada, nunca um erro artificialmente
-- pequeno. Nao redecide a soma (cancelled continua fora do total nos
-- dois lados) — so redecide QUANDO o total e NULL em vez de 0.
--
-- Medido em Q-B: 11/2025 e 12/2025 sao lacunas reais (11/25 so tem
-- `cancelled`; 12/25 nao aparece em nenhum estado) e agora as DUAS
-- devolvem NULL, nao 0,00 — um 0,00 pareceria "provisao perfeita" quando
-- na verdade nao ha dado para comparar. 11/2024 tem guia PAGA de R$ 0,02
-- (credito quase total, legitimo nesta operacao) — isso E dado (existe
-- linha 'paid'), fica como esta e NAO vira lacuna, mas explode qualquer
-- razao percentual sobre ele; 224-IMPOSTO.md declara o mes explicitamente.
--
-- 🔴 SEGUNDA CORRECAO (mesma rodada): `guia_caixa_no_mes` e
-- `guia_apuracao_m_mais_1` saiam IDENTICOS nas 11 linhas medidas. Isso e
-- ESPERADO nesta janela, nao um bug: guia_caixa soma so 'paid' dentro do
-- mes (clone de imposto_guia_mes); guia_apuracao soma 'paid'+'pending' na
-- MESMA competencia via RPC. As duas coincidem sempre que a competencia
-- nao tem NENHUMA linha 'pending' — e, medido em Q-B, todo o historico
-- passado so tem 'pending' a partir de 09/2026 (sao as projecoes
-- replicadas do Tiny, fora do escopo desta medicao). As duas colunas
-- DIVERGEM no momento em que uma competencia tiver guia 'pending' real
-- (reconhecida mas ainda nao paga) — sao perguntas diferentes que so
-- coincidem por ausencia de 'pending' no periodo medido, e ficam as duas
-- porque cada uma responde a sua pergunta (ver rotulo acima). Nao
-- colapsar as colunas: colapsar perderia a distincao no dia em que
-- divergirem.
--
-- Projeto: ckcdevcxgvueywivefgx (NAO usar gionpsuunfkkzzjdubfy).
-- Aplicar via MCP apply_migration. NUNCA `supabase db push`.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_imposto_provisao_erro(
  p_org_id uuid,
  p_meses  int DEFAULT 12
)
RETURNS TABLE (
  mes_venda               date,
  faturamento             numeric,
  taxa_media_prevista     numeric,
  n_meses_base            int,
  provisao_prevista       numeric,
  guia_caixa_no_mes       numeric,
  n_guias_caixa           int,
  competencia_apuracao    date,
  guia_apuracao_m_mais_1  numeric,
  n_linhas_apuracao       int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH params AS MATERIALIZED (
    SELECT date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date AS mes_atual
  ),
  meses AS MATERIALIZED (
    SELECT
      (p.mes_atual - (k || ' months')::interval)::date       AS mes_ini,
      (p.mes_atual - ((k - 1) || ' months')::interval)::date AS mes_fim_excl
    FROM params p
    CROSS JOIN generate_series(1, p_meses) AS k
  ),
  fat AS MATERIALIZED (
    SELECT m.mes_ini,
           COALESCE(SUM(COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)), 0) AS total
    FROM meses m
    LEFT JOIN public.orders o
      ON  o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND o.data_pedido::date >= m.mes_ini
      AND o.data_pedido::date <  m.mes_fim_excl
    GROUP BY m.mes_ini
  ),
  -- REGUA DE CAIXA: o que saiu no mes. Clone de imposto_guia_mes.
  -- Lacuna = NENHUMA linha 'paid' no mes (uma linha 'cancelled' ou
  -- 'pending' sozinha NAO conta como guia realizada) -> NULL. Quando ha
  -- ao menos uma linha 'paid' (mesmo que de valor pequeno, ex. credito
  -- quase total), soma normalmente, mesmo que a soma de coincidencia
  -- desse exatamente 0.
  guia_caixa AS MATERIALIZED (
    SELECT m.mes_ini,
           CASE WHEN COUNT(co.id) FILTER (WHERE co.status = 'paid') = 0 THEN NULL
                ELSE SUM(co.amount) FILTER (WHERE co.status = 'paid')
           END                                                    AS total,
           COUNT(co.id) FILTER (WHERE co.status = 'paid')::int    AS n
    FROM meses m
    LEFT JOIN public.cash_outflows co
      ON  co.organization_id = p_org_id
      AND public.dre_bloco_for_category(co.category) = 'impostos_venda'
      AND co.outflow_date >= m.mes_ini
      AND co.outflow_date <  m.mes_fim_excl
    GROUP BY m.mes_ini
  ),
  -- REGUA DE APURACAO (Fase 94 respeitada, conteudo M+1 REFUTADO por Q-B
  -- para esta categoria nesta conta — ver cabecalho). A guia da venda do
  -- mes M e lida na MESMA competencia M, via RPC viva, agregacao identica
  -- a dreRegime.ts:121-135 na soma (cancelled nao soma, paid e pending
  -- somam). Lacuna = NENHUMA linha 'paid' NEM 'pending' na competencia
  -- (uma competencia 100% 'cancelled' e, so para esta MEDICAO DE ERRO,
  -- tratada como lacuna — diverge de proposito da regra de dreRegime.ts
  -- para a tela de Fechar o Mes, ver cabecalho) -> NULL.
  guia_apuracao AS MATERIALIZED (
    SELECT m.mes_ini,
           m.mes_ini                                                          AS competencia,
           CASE WHEN COUNT(g.status) FILTER (WHERE g.status <> 'cancelled') = 0 THEN NULL
                ELSE SUM(g.total) FILTER (WHERE g.status <> 'cancelled')
           END                                                                AS total,
           COALESCE(SUM(g.n) FILTER (WHERE g.status <> 'cancelled'), 0)::int  AS n
    FROM meses m
    LEFT JOIN LATERAL public.get_imposto_guia_by_competence(p_org_id, m.mes_ini) g
      ON true
    GROUP BY m.mes_ini
  ),
  taxa AS MATERIALIZED (
    -- Clone de `taxas` da Fase 100: guia de CAIXA do mes k sobre o
    -- faturamento do mes k. O desalinhamento e do original e fica.
    SELECT m.mes_ini,
           CASE WHEN gc.total > 0 AND f.total > 0
                THEN gc.total / f.total
                ELSE NULL
           END AS taxa
    FROM meses m
    JOIN fat        f  ON f.mes_ini  = m.mes_ini
    JOIN guia_caixa gc ON gc.mes_ini = m.mes_ini
  ),
  base AS MATERIALIZED (
    -- previsao_calc da Fase 100: media simples das taxas dos 3 meses
    -- anteriores, ignorando os meses sem taxa valida.
    SELECT m.mes_ini,
           AVG(t.taxa)        AS taxa_media,
           COUNT(t.taxa)::int AS n_base
    FROM meses m
    LEFT JOIN taxa t
      ON  t.mes_ini >= (m.mes_ini - interval '3 months')::date
      AND t.mes_ini <  m.mes_ini
    GROUP BY m.mes_ini
  )
  SELECT
    m.mes_ini,
    f.total,
    b.taxa_media,
    b.n_base,
    CASE WHEN b.taxa_media IS NULL THEN NULL ELSE b.taxa_media * f.total END,
    gc.total,
    gc.n,
    ga.competencia,
    ga.total,
    ga.n
  FROM meses m
  JOIN fat           f  ON f.mes_ini  = m.mes_ini
  JOIN guia_caixa    gc ON gc.mes_ini = m.mes_ini
  JOIN guia_apuracao ga ON ga.mes_ini = m.mes_ini
  JOIN base          b  ON b.mes_ini  = m.mes_ini
  ORDER BY m.mes_ini;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_imposto_provisao_erro(uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_imposto_provisao_erro(uuid, int) TO authenticated, service_role;
