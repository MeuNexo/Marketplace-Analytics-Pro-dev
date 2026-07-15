-- Phase 96 Plan 04 (C1-backend + C8-backend): receita cancelada isolada +
-- lista de lançamentos do bloco nao_classificado.
--
-- MIGRATION 100% ADITIVA. Nenhuma função existente é tocada, redefinida ou
-- removida. As 3 funções abaixo são todas NOVAS.
--
-- ⚠️ NÃO ALTERA public.get_cost_waterfall (a RPC de `paid_revenue`). Aquela
-- RPC tem 6 consumidores (/financeiro, MCO, GoalsCard, Nexo, useAutoRecalc,
-- o próprio card de Custos) — mudar o significado dela vazaria para todos.
-- A receita bruta/cancelamentos deste plano vive numa RPC nova e isolada;
-- a composição (bruta = paid + cancelada) acontece no card (96-05).
--
-- ⚠️ NÃO REDEFINE a RPC 87 (Phase 87, migration 20260692000000, a função
-- que calcula o DRE operacional por competência). O helper do Bloco B é
-- uma CÓPIA LITERAL do CASE daquela RPC, deliberadamente — dreCascade.ts documenta que o campo `bloco` é
-- consumido DIRETAMENTE e NUNCA re-derivado de `category` no cliente; este
-- helper existe só para que a listagem do C8 (Bloco C) não precise
-- re-implementar o mapa categoria→bloco no frontend. A equivalência entre
-- este helper e o CASE da RPC 87, sobre TODAS as categorias vivas da org, é
-- provada por query no checkpoint (Task 2 deste plano) — não no CI.
--
-- Decisão do dono sobre reembolso (Wesley, 2026-07-15, 96-CONTEXT.md §3 [C1]):
--   "reembolso fica de fora da receita e e considerado como cancelamento"
-- → o pedido `partially_refunded` NÃO é receita e É cancelamento. Por isso
-- o Bloco A soma `status IN ('cancelled','partially_refunded')` — os dois
-- juntos, sem separar "parte mantida vs. parte estornada".
--
-- Alvo de maio/2026 (org Pé Vermeio 7f615df7-7bac-45e5-8a93-827fb9ddeec7):
--   cancelled_revenue = 14.450,29 (cancelled 14.063,90 + partially_refunded 386,39)
--   receita bruta composta no card = paid_revenue (247.216,12) + 14.450,29 = 261.666,41
--   receita líquida permanece 247.216,12 (identidade que protege o swing de 52.496,21)
--   get_dre_nao_classificado_items soma 10.809,20 (igual à linha "Não classificado"
--     da cascata — RPC 87), maiores lançamentos: Textile Xtra 4.627,04 +
--     Pralana 3.329,39 + Pralana 2.852,77.
--
-- Numeração: renomear este arquivo no checkpoint (Task 2), com o max(version)
-- vivo em mãos via MCP Supabase. O repo local está ~19 dias atrás do banco
-- (max(version) vivo ~20260713xxxxxx) — nunca numerar pelo `ls` do repo.
--
-- Aplicar SOMENTE via Supabase MCP `apply_migration` no projeto
-- ckcdevcxgvueywivefgx (NÃO o projeto do CLAUDE.md). Nunca `supabase db push`
-- — o CLI local está linkado no projeto errado (gionpsuunfkkzzjdubfy).

-- ============================================================================
-- BLOCO A — get_cancelled_revenue
-- Espelha o predicado de status/data/fallback de receita do get_cost_waterfall
-- (20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql), mas
-- soma o COMPLEMENTO de status: cancelled + partially_refunded, em vez de
-- paid/shipped/delivered. Mesmo eixo de data (data_pedido::date), mesmo
-- fallback de receita (COALESCE(receita_bruta, preco_unit * quantidade, 0)).
-- Se as réguas divergirem do waterfall, o bruto exibido no card não bate com
-- paid_revenue + cancelled_revenue e o C1 mente.
-- ============================================================================

CREATE FUNCTION public.get_cancelled_revenue(
  p_org_id   uuid,
  p_user_ids text[],
  p_from     date,
  p_to       date
)
RETURNS TABLE (
  cancelled_revenue numeric,
  cancelled_orders  bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(SUM(
      COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)
    ), 0)                     AS cancelled_revenue,
    COUNT(*)::bigint          AS cancelled_orders
  FROM public.orders o
  WHERE o.organization_id = p_org_id
    AND o.ml_user_id      = ANY(p_user_ids)
    AND o.data_pedido::date BETWEEN p_from AND p_to
    AND o.status IN ('cancelled', 'partially_refunded');
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cancelled_revenue(uuid, text[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cancelled_revenue(uuid, text[], date, date) TO authenticated;

-- ============================================================================
-- BLOCO B — dre_bloco_for_category
-- Cópia LITERAL do CASE da RPC 87 (20260692000000, linhas 51-76), incluindo
-- o ramo final que devolve 'nao_classificado'. Não simplificado, não
-- reordenado. IMMUTABLE puro sobre texto — não toca em nenhuma tabela nem
-- depende de RLS ou de contexto de invocador. A RPC 87 NÃO usa este helper (ela
-- permanece intocada, protegendo SC5/SC6 da Phase 94/87); ele existe só para
-- o Bloco C abaixo.
-- ============================================================================

CREATE FUNCTION public.dre_bloco_for_category(p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN p_category IN ('Imposto Venda - ICMS','Imposto Venda - PIS','Imposto Venda - COFINS')
        THEN 'impostos_venda'
      WHEN p_category IN ('Salários','Pró-labore','Pessoal - INSS')
        THEN 'pessoal'
      WHEN p_category IN ('Aluguéis e condomínio','Água, luz','Telecomunicação, internet')
        THEN 'estrutura'
      WHEN p_category IN ('Contabilidade','Serviços gerais')
        THEN 'servicos'
      WHEN p_category IN ('Insumos','Itens do CD','Impostos, taxas','Veículos, transportes','Cartão de crédito')
        THEN 'operacional'
      WHEN p_category = 'Empréstimo'
        THEN 'financeiro'
      WHEN p_category IN (
        'Fornecedores','Previsões de compra','Aporte',
        'ADS Mercado Livre','Prestação de serviço do Mercado Envios Full',
        'ADS Shopee','Ads Magazine Luiza','Vendas Mercado Livre','Vendas Magalu',
        'Reembolso cliente'
      ) THEN 'excluido'
      ELSE 'nao_classificado'
    END;
$function$;

-- ============================================================================
-- BLOCO C — get_dre_nao_classificado_items
-- Lista os lançamentos crus de cash_outflows que caem no bloco
-- 'nao_classificado' (via o helper do Bloco B) para o Wesley recategorizar
-- no Tiny. Só INFORMA — nenhuma linha é auto-corrigida ou movida de bloco.
--
-- Pitfall 9 (96-RESEARCH.md): as linhas de maio em nao_classificado têm
-- competence_date NULL (resíduo do backfill da Phase 86). Réplica do MESMO
-- COALESCE(competence_date, date_trunc('month', outflow_date)) usado pela
-- RPC 87 nas duas bordas do range E na coluna competence_month projetada —
-- sem isso a lista vem vazia enquanto a cascata mostra 10.809,20.
-- ============================================================================

CREATE FUNCTION public.get_dre_nao_classificado_items(
  p_org_id uuid,
  p_month  date
)
RETURNS TABLE (
  outflow_date     date,
  competence_month date,
  description      text,
  supplier         text,
  category         text,
  amount           numeric,
  document_number  text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    co.outflow_date                                                        AS outflow_date,
    COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
                                                                             AS competence_month,
    co.description                                                         AS description,
    co.supplier                                                            AS supplier,
    co.category                                                            AS category,
    co.amount                                                              AS amount,
    co.document_number                                                     AS document_number
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND public.dre_bloco_for_category(co.category) = 'nao_classificado'
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
          >= date_trunc('month', p_month)::date
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
          <  (date_trunc('month', p_month) + interval '1 month')::date
  ORDER BY co.amount DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_nao_classificado_items(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dre_nao_classificado_items(uuid, date) TO authenticated;
