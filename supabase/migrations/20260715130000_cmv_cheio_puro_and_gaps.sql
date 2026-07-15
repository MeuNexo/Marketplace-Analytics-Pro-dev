-- Phase 96 Plan 03 (C6-backend): CMV cheio puro no waterfall + RPC nova de
-- gaps (SKUs sem custo cheio) para o gate de "marcar mês como apurado".
--
-- ⚠️ DRIFT RECONCILIATION: get_cost_waterfall já vive em produção com 7
-- colunas (inclui cmv_cheio), mas o repo local só tem a versão de 6 colunas
-- (20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql), sem
-- cmv_cheio — o schema real veio do worktree irmão não mergeado
-- (/root/garment-glow-dre, branch gsd/phase-86-dre-competencia,
-- 20260690000100_cmv_cheio_schema.sql), igual ao padrão já documentado em
-- 20260692000000_dre_operational_reconcile_context_map.sql. O Bloco A abaixo
-- é a MELHOR RECONSTRUÇÃO do corpo vivo com a informação disponível no plano
-- (96-CONTEXT.md, 96-RESEARCH.md) — o orquestrador tem que colar o
-- `pg_get_functiondef('public.get_cost_waterfall(uuid,text[],date,date)'::regprocedure)`
-- real no checkpoint (Task 2, PASSO 1) e CORRIGIR este arquivo antes de
-- aplicar, se algo divergir (nomes/ordem de coluna, WHERE, etc.).
--
-- O QUE MUDA (decisão do dono, Wesley, 2026-07-15): a coluna `cmv_cheio` de
-- get_cost_waterfall hoje é
--   COALESCE(SUM(COALESCE(o.custo_unit_cheio, o.custo_unit) * o.quantidade), 0)
-- — o COALESCE INTERNO (cheio, médio) troca o custo cheio pelo médio quando
-- o cheio é NULL, mascarando custo faltante sem avisar. O autor original
-- documentou isso como decisão deliberada ("sem ele, linhas sem cost_full
-- somariam 0 → subestimariam o CMV"). Wesley REVERTE essa decisão: prefere
-- bloquear o fechamento do mês a mascarar. A mudança é CIRÚRGICA: remove só
-- o COALESCE interno. SUM já ignora NULL por definição, então uma linha sem
-- custo cheio passa a contribuir ZERO (denunciado pelo gate do C6 em vez de
-- disfarçado pelo custo médio) — o COALESCE externo (SUM vazio -> 0) fica.
--
-- 🚨 TUDO O MAIS fica byte-a-byte idêntico ao corpo vivo: as outras 6
-- colunas (paid_revenue com o fallback receita_bruta -> preco_unit*quantidade,
-- cmv médio, total_comissao, total_frete, total_tax, orders_count), o mesmo
-- WHERE (status IN ('paid','shipped','delivered') + ml_user_id = ANY(...) +
-- cast de data_pedido). paid_revenue tem 6 consumidores (/financeiro, MCO,
-- GoalsCard, Nexo, useAutoRecalc, o próprio card) — mudar o significado dela
-- vazaria para todos. cmv (médio) alimenta a PREVISÃO (regime aberto) — mudar
-- quebraria o SC5 da Phase 94. Só cmv_cheio muda; só o branch de APURAÇÃO lê
-- essa coluna (useMLCostWaterfall.ts -> resolveDreRegime, branch isClosed).
--
-- Alvo numérico de maio/2026 (org Pé Vermeio 7f615df7-7bac-45e5-8a93-827fb9ddeec7,
-- ml_user_id 1639558873): cmv_cheio 136.462,51 (COALESCE, hoje) ->
-- 126.574,59 (cheio puro, depois desta migration). As outras 6 colunas do
-- waterfall PERMANECEM IDÊNTICAS antes/depois (paid_revenue = 247.216,12).
--
-- BLOCO B — get_cmv_cheio_gaps: RPC NOVA que lista, por SKU, os pedidos
-- pagos do período sem custo_unit_cheio (o gate do C6 precisa dessa lista
-- para o Wesley corrigir no Tiny; não dá para derivar client-side sem
-- estourar o truncamento de 1000 linhas do PostgREST). O WHERE (fora a
-- condição extra de custo_unit_cheio IS NULL) é IDÊNTICO ao de
-- get_cost_waterfall — se os dois conjuntos de pedidos divergirem, o gate e
-- o CMV discordam e o número não fecha. Alvo de maio: 39 SKUs / 226 linhas /
-- R$23.828,31, dos quais 4 SKUs sem custo NENHUM (nem médio) —
-- `tem_custo_medio` distingue os dois casos na tela.
--
-- Numeração: renomear este arquivo no checkpoint (Task 2), acima do
-- max(version) vivo (>= 20260715120000 — a migration irmã do plano 96-04 já
-- ocupa esse timestamp e está aplicada em prod). Sugestão: 20260715130000.
-- Nunca numerar pelo `ls` do repo (o repo local está atrás do banco).
--
-- Aplicar SOMENTE via Supabase MCP `apply_migration` no projeto
-- ckcdevcxgvueywivefgx (NÃO o projeto do CLAUDE.md). Nunca `supabase db push`
-- — o CLI local está linkado no projeto errado (gionpsuunfkkzzjdubfy).

-- ============================================================================
-- BLOCO A — get_cost_waterfall (REESCRITA — cmv_cheio puro)
-- DROP+CREATE porque RETURNS TABLE não muda de forma nesta migration (mesmas
-- 7 colunas do corpo vivo), mas usamos o mesmo padrão DROP+CREATE do resto
-- do repo (nunca CREATE OR REPLACE em função com múltiplos consumidores,
-- para deixar explícito que os GRANTs precisam ser reafirmados). Grants NÃO
-- sobrevivem ao DROP -> re-GRANT obrigatório.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_cost_waterfall(uuid, text[], date, date);

CREATE FUNCTION public.get_cost_waterfall(
  p_org_id   uuid,
  p_user_ids text[],
  p_from     date,
  p_to       date
)
RETURNS TABLE (
  paid_revenue   numeric,
  cmv            numeric,
  total_comissao numeric,
  total_frete    numeric,
  total_tax      numeric,
  orders_count   bigint,
  cmv_cheio      numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(SUM(
      COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)
    ), 0)                                           AS paid_revenue,
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)   AS cmv,
    COALESCE(SUM(o.comissao), 0)                    AS total_comissao,
    COALESCE(SUM(o.frete), 0)                       AS total_frete,
    COALESCE(SUM(o.tax_amount), 0)                  AS total_tax,
    COUNT(*)::bigint                                AS orders_count,
    -- [C6] cheio PURO: sem o COALESCE(cheio, médio) interno. SUM ignora NULL
    -- por definição -> linha sem custo cheio contribui zero (denunciado pelo
    -- gate, não mascarado pelo custo médio).
    COALESCE(SUM(o.custo_unit_cheio * o.quantidade), 0) AS cmv_cheio
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id   = ANY(p_user_ids)
    AND o.status       IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cost_waterfall(uuid, text[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cost_waterfall(uuid, text[], date, date) TO authenticated;

-- ============================================================================
-- BLOCO B — get_cmv_cheio_gaps (RPC nova)
-- Agregação simples por SKU, sem subquery correlacionada (RPC INVOKER com
-- subquery correlacionada estoura o statement_timeout de 8s do role
-- authenticated). Mesmo predicado de get_cost_waterfall + custo_unit_cheio
-- IS NULL. tem_custo_medio distingue "tem médio, falta o cheio" (resolvido
-- pelo backfill do 96-07) de "não tem custo nenhum" (Wesley cadastra no
-- Tiny).
-- ============================================================================

CREATE FUNCTION public.get_cmv_cheio_gaps(
  p_org_id   uuid,
  p_user_ids text[],
  p_from     date,
  p_to       date
)
RETURNS TABLE (
  sku             text,
  marca           text,
  linhas          bigint,
  unidades        bigint,
  receita         numeric,
  tem_custo_medio boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    o.sku                                     AS sku,
    MAX(o.marca)                              AS marca,
    COUNT(*)::bigint                          AS linhas,
    SUM(o.quantidade)::bigint                 AS unidades,
    COALESCE(SUM(o.receita_bruta), 0)         AS receita,
    bool_or(o.custo_unit IS NOT NULL)         AS tem_custo_medio
  FROM public.orders o
  WHERE
    o.organization_id = p_org_id
    AND o.ml_user_id   = ANY(p_user_ids)
    AND o.status       IN ('paid', 'shipped', 'delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to
    AND o.custo_unit_cheio IS NULL
  GROUP BY o.sku
  ORDER BY COALESCE(SUM(o.receita_bruta), 0) DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cmv_cheio_gaps(uuid, text[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cmv_cheio_gaps(uuid, text[], date, date) TO authenticated;
