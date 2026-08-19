-- ──────────────────────────────────────────────────────────────────────────────
-- RPC: orders_price_timeseries — o efeito líquido do DIFAL por intervalo
--
-- Fase 222, plano 222-15-R2 (FISC-04/FISC-07). A Análise de Preços é a tela
-- onde se decide PREÇO olhando margem: o card "Detalhamento de MCO" e a série
-- preço × break-even. Hoje ela mostra um número só, o otimista, e sem dizer
-- que é otimista — é a mais cara de todas de estar assim.
--
-- 🔴 AQUI A RPC **NÃO** CALCULA LUCRO, DE PROPÓSITO. Diferente de
-- get_margin_with_ads_by_product, a composição do MCO desta tela SEMPRE
-- aconteceu no navegador (`src/lib/precoMcoSeries.ts` chama `computeMco`).
-- Trazer o lucro para cá criaria a segunda régua do mesmo número. O que a RPC
-- devolve é o INSUMO: o efeito líquido do DIFAL do intervalo. O navegador
-- chama `computeMco` uma segunda vez com o imposto acrescido desse insumo —
-- nunca somando DIFAL sobre um MCO já pronto.
--
-- O termo de DIFAL vem de public.difal_efeito_liquido (20260812225000), a
-- definição única do custo real de entrar com o DIFAL. Ele NÃO é o DIFAL
-- cheio: o DIFAL derruba a base do PIS/COFINS, e ignorar isso superestimava o
-- imposto em R$ 3,85 por pedido (222-06-R/07-R).
--
-- SÓ O DIFAL CALCULADO ENTRA. Os pedidos cujo DIFAL o Mercado Livre já cobra
-- na fatura (`difal_fonte = 'cobrado_ml'`) ficam fora: aquele valor é diário e
-- por loja, entra apenas no agregado. Por linha, o número é sempre
-- ESTIMATIVA (D-12).
--
-- POR QUE DROP + CREATE (não CREATE OR REPLACE): a RETURNS TABLE ganha duas
-- colunas. Os SEIS argumentos ficam idênticos — inclusive `_sku` no fim, com
-- o mesmo DEFAULT — e as treze colunas antigas mantêm nome, tipo e posição.
-- As duas novas entram no fim.
--
-- 🔴 REMOVER UMA FUNÇÃO APAGA A ACL. A versão anterior deste arquivo não
-- emitia GRANT (contava com a concessão default a PUBLIC). Aqui a concessão ao
-- papel autenticado é EXPLÍCITA e fica no mesmo arquivo do DROP: é a única
-- forma de a auditoria conseguir provar, antes do deploy, que a tela não vai
-- perder acesso à própria função.
--
-- APLICAÇÃO É PORTÃO HUMANO (222-15-R2, Task 5): este plano SÓ escreve o
-- arquivo. Aplicar via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`
-- (NUNCA SQL Editor, NUNCA `supabase db push`) é passo do orquestrador —
-- sempre DEPOIS de 20260812225000_difal_efeito_liquido.sql.
--
-- SECURITY INVOKER (padrão anti-IDOR das fases 63/69/79 — sem DEFINER, sem
-- parâmetro de organização): a RLS de `orders` já isola a organização do
-- chamador. As duas colunas novas são somas dos mesmos pedidos já visíveis.
--
-- LIÇÃO PRESERVADA (Fase 82): venda por variação casa por `orders.sku`, nunca
-- por `orders.variation_id`.
-- ──────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.orders_price_timeseries(text, text[], date, date, text, text);

CREATE FUNCTION public.orders_price_timeseries(
  _item_id      text,
  _ml_user_ids  text[] DEFAULT NULL,
  _from         date   DEFAULT NULL,
  _to           date   DEFAULT NULL,
  _granularity  text   DEFAULT 'day',
  _sku          text   DEFAULT NULL
)
RETURNS TABLE(
  bucket          date,
  preco_medio     numeric,
  preco_min       numeric,
  preco_max       numeric,
  qtd             bigint,
  total           numeric,
  orders          bigint,
  cmv             numeric,
  comissao        numeric,
  frete           numeric,
  qtd_sem_custo   bigint,
  impostos        numeric,
  qtd_sem_imposto bigint,
  -- ── Colunas novas (222-15-R2), no FIM ──────────────────────────────────────
  -- Efeito líquido do DIFAL do intervalo — o INSUMO do segundo cenário, não o
  -- segundo cenário. Quem compõe é o navegador.
  difal_efeito    numeric,
  -- Pedidos do intervalo com destino interestadual conhecido e SEM DIFAL
  -- calculado. A tela diz a contagem em palavras; nunca finge que é zero.
  pedidos_difal_indefinido bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    date_trunc(
      CASE
        WHEN lower(_granularity) IN ('week', 'month') THEN lower(_granularity)
        ELSE 'day'
      END,
      o.data_pedido::date   -- ADAPTAÇÃO: cast TEXT→date (nosso schema usa TEXT)
    )::date AS bucket,
    (SUM(o.receita_bruta) / NULLIF(SUM(o.quantidade), 0))::numeric AS preco_medio,
    MIN(o.preco_unit)::numeric    AS preco_min,
    MAX(o.preco_unit)::numeric    AS preco_max,
    SUM(o.quantidade)::bigint     AS qtd,
    SUM(o.receita_bruta)::numeric AS total,
    COUNT(*)::bigint              AS orders,
    -- Componentes firmes por bucket (template: a RPC de margem por anúncio)
    COALESCE(SUM(o.custo_unit * o.quantidade), 0)::numeric                       AS cmv,
    COALESCE(SUM(o.comissao), 0)::numeric                                        AS comissao,
    COALESCE(SUM(o.frete), 0)::numeric                                           AS frete,
    COALESCE(SUM(o.quantidade) FILTER (WHERE o.custo_unit IS NULL), 0)::bigint   AS qtd_sem_custo,
    -- Imposto FIRME por pedido (tax_amount calculado com UF de destino real por
    -- recalc-order-costs) — este É o cenário SEM DIFAL.
    COALESCE(SUM(o.tax_amount), 0)::numeric                                      AS impostos,
    COALESCE(SUM(o.quantidade) FILTER (WHERE o.tax_amount IS NULL), 0)::bigint   AS qtd_sem_imposto,
    -- O que separa o segundo cenário do primeiro, e SÓ isso.
    COALESCE(
      SUM(
        public.difal_efeito_liquido(
          o.difal_amount,
          o.fcp_amount,
          o.pis_cofins_debito,
          o.pis_cofins_debito_com_difal
        )
      ) FILTER (WHERE o.difal_fonte IN ('calculado', 'nao_conciliado')),
      0
    )::numeric                                                                   AS difal_efeito,
    COUNT(*) FILTER (
      WHERE o.difal_amount IS NULL
        AND o.estado    IS NOT NULL
        AND o.uf_origem IS NOT NULL
        AND o.estado    <> o.uf_origem
    )::bigint                                                                    AS pedidos_difal_indefinido
  FROM orders o
  WHERE o.item_id = _item_id
    AND o.status IN ('paid', 'shipped', 'delivered')
    AND (_ml_user_ids IS NULL OR array_length(_ml_user_ids, 1) IS NULL OR o.ml_user_id = ANY(_ml_user_ids))
    AND (_from IS NULL OR o.data_pedido::date >= _from)
    AND (_to   IS NULL OR o.data_pedido::date <= _to)
    AND (_sku  IS NULL OR o.sku = _sku)
  GROUP BY 1
  ORDER BY 1;
$function$;

GRANT EXECUTE ON FUNCTION public.orders_price_timeseries(text, text[], date, date, text, text) TO authenticated;

-- Smoke pós-deploy (orquestrador via MCP execute_sql, como papel authenticated):
--   -- comportamento do pai (sem _sku), 15 colunas, as 13 primeiras idênticas:
--   SELECT * FROM orders_price_timeseries('MLB0000000000', NULL, NULL, NULL, 'day') LIMIT 1;
--   -- comportamento por variação (6 argumentos, _sku no fim):
--   SELECT * FROM orders_price_timeseries('MLB0000000000', NULL, NULL, NULL, 'day', 'SKU-000') LIMIT 1;
--   Nenhuma deve devolver "function does not exist" / "function is not unique".
