-- ──────────────────────────────────────────────────────────────────────────────
-- RPC: get_margin_with_ads_by_product — o par com/sem REBATE, por cima do par
-- já existente com/sem DIFAL
--
-- Fase 223, plano 223-05 (REB-02/REB-03/REB-04). Esta RPC alimenta TRÊS telas
-- ao mesmo tempo — /resultado, /publicidade e /anuncios (nos dois ramos de
-- renderização) — e hoje mostra o par SEM/COM DIFAL sem dizer o quanto do
-- lucro depende de o Mercado Livre não ter cobrado a tarifa cheia.
--
-- POR QUE O SEGUNDO CENÁRIO NASCE AQUI, E NÃO NO NAVEGADOR: nestas três telas
-- o MCO já vem PRONTO do banco. Compor o primeiro cenário no banco e o
-- segundo no navegador seria criar duas réguas para o mesmo número. Os dois
-- nascem da MESMA expressão de lucro (`lucro_antes_imposto - imposto_sem_difal`),
-- diferindo apenas no termo de rebate — exatamente o desenho que já existe
-- para o par DIFAL, aplicado agora ao par rebate.
--
-- 🔴 SEM RATEIO — HÁ UMA CONFERÊNCIA. A premissa original desta fase supunha
-- carrinho com N linhas em `orders` por pedido, exigindo ratear o rebate.
-- Medido em produção (223-01): `orders` é 1:1 com o pedido do ML — julho/2026
-- tem 1.136 linhas para 1.136 pedidos distintos, zero multilinha, e a tabela
-- não tem coluna de pacote. A junção com `ml_order_sale_fee_captura` é direta
-- pela chave (organization_id, ml_order_id), uma linha para uma linha. No
-- lugar do rateio entra uma GUARDA DE CONFERÊNCIA, porque as duas fontes
-- estão em unidades diferentes:
--
--   · captura.sale_fee_net / captura.sale_fee_rebate  — TOTAL do pedido
--   · orders.comissao / orders.credito_pc_comissao    — POR UNIDADE
--
-- As duas fecham ao centavo em 7 de 7 (223-01) quando o multiplicador
-- `orders.quantidade` entra: `sale_fee_net == orders.comissao × quantidade`.
-- SEM o multiplicador, 62 pedidos bons da Pé Vermeio sairiam como
-- divergentes — é por isso que a conferência abaixo NUNCA compara
-- `sale_fee_net` contra `comissao` sozinha.
--
-- O rebate só é afirmado (`rebate_do_pedido` não-nulo) quando:
--   1. a captura fechou (`status = 'ok'`);
--   2. não há estorno por cancelamento (`tem_estorno = false`) — medido: o
--      `sale_fee` da fatura NÃO enxerga o cancelamento (223-01, Q4: pedido
--      cancelado seguia dizendo `rebate 21,17` como se a venda valesse); e
--   3. a conferência fecha (`sale_fee_net` == `comissao × quantidade`,
--      tolerância de um centavo).
--
-- As duas ausências são contadas SEPARADAMENTE, porque significam coisas
-- diferentes: `pedidos_sem_captura_rebate` (ainda não consultamos — captura
-- ausente ou em estado não final) e `pedidos_rebate_nao_conferido`
-- (consultamos, mas a tarifa cobrada não bate com a comissão gravada, ou
-- houve estorno — o erro é NOSSO, e é o único dos dois acionável).
--
-- 🔴 O TERMO DE REBATE NÃO É O REBATE CHEIO. `rebate_do_pedido` é o TOTAL do
-- pedido (fatura); o que entra na expressão de lucro é
-- `public.rebate_efeito_liquido(rebate_do_pedido, o.comissao,
-- o.credito_pc_comissao)` (20260821101000) — o rebate MENOS o crédito extra
-- de PIS/COFINS que a comissão maior (sem rebate) teria gerado. Somar o
-- rebate cru sobre um lucro já pronto é o espelho exato do defeito de
-- R$ 3,85/pedido que o retrabalho 222-06-R/07-R fechou para o DIFAL — aqui
-- ele nunca nasce, porque as duas expressões de lucro (`lucro` e
-- `lucro_sem_rebate`) compartilham o MESMO `lucro_antes_imposto`.
--
-- 🔴 `orders.comissao` JÁ É O VALOR LÍQUIDO DO REBATE (medido em 223-01: é o
-- `sale_fee.net`, não o `gross`). Descontar o rebate de `orders.comissao` em
-- qualquer expressão desta função seria dupla contagem — já aconteceu uma
-- vez nesta casa e não pode acontecer de novo.
--
-- 🔵 SOMAS SEM SUBSTITUIÇÃO DE NULO POR ZERO: `rebate_bruto` e `rebate_efeito`
-- são `SUM(...)` puro sobre uma coluna por pedido que já é NULL quando o
-- pedido não é afirmável. O Postgres soma ignorando NULL e devolve NULL
-- quando TODAS as parcelas do grupo são NULL — é exatamente a semântica de
-- "nada afirmável no período", sem precisar de `COALESCE` nenhum. Trocar por
-- `COALESCE(..., 0)` transformaria "não sabemos" em "sabemos que é zero", o
-- oposto de D-223-06.
--
-- 🔵 ORTOGONALIDADE COM O PAR DIFAL: o par de rebate nasce sobre o cenário
-- SEM DIFAL (`imposto_sem_difal`) — o mesmo termo que já alimenta `lucro`. Ele
-- nunca se mistura com `imposto_com_difal`: cruzar as duas réguas produziria
-- quatro números por linha e nenhuma leitura possível.
--
-- ⚠️ DÍVIDA HERDADA, DECLARADA E NÃO CORRIGIDA AQUI: `lucro`/`lucro_sem_rebate`
-- usam `SUM(o.comissao)`, que é POR UNIDADE, enquanto a receita é TOTAL. O
-- DELTA entre os dois cenários está certo (o rebate é dinheiro real); o
-- NÍVEL dos dois carrega a comissão subestimada em pedidos de mais de uma
-- unidade (medido: Pé Vermeio R$ 713,41 em 62 pedidos; Thales/Junior por
-- extrapolação — 223-CONTRATO-SALE-FEE.md). Corrigir é `sync-ml-orders`,
-- outra fase, e mexe em número que a contadora já validou.
--
-- POR QUE DROP + CREATE: a RETURNS TABLE ganha oito colunas — mesmo caso do
-- par DIFAL, o Postgres recusa CREATE OR REPLACE quando o tipo de retorno
-- muda. A assinatura de ARGUMENTOS não muda, e as 26 colunas antigas
-- continuam com o mesmo nome, o mesmo tipo e a mesma POSIÇÃO — as oito novas
-- entram no fim.
--
-- 🔴 REMOVER UMA FUNÇÃO APAGA A ACL. O GRANT está reemitido no fim deste
-- mesmo arquivo — este repositório já perdeu lista de controle de acesso
-- exatamente assim.
--
-- APLICAÇÃO É PORTÃO DO ORQUESTRADOR (223-08): este plano SÓ escreve o
-- arquivo. Aplicar via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`
-- (NUNCA SQL Editor, NUNCA `supabase db push`) — sempre DEPOIS de
-- 20260821101000_rebate_efeito_liquido.sql, que esta função consome.
--
-- Sem LIMIT: evita truncamento PostgREST de 1000 linhas (MCO-01).
-- SECURITY INVOKER (igual à RPC base): a RLS org-first de `orders` e de
-- `ml_order_sale_fee_captura` enforça o isolamento de tenant. As colunas
-- novas são somas dos MESMOS pedidos que o chamador já enxerga um a um.
-- ──────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_margin_with_ads_by_product(UUID, TEXT[], DATE, DATE);

CREATE FUNCTION public.get_margin_with_ads_by_product(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  item_id                     TEXT,
  titulo                      TEXT,
  sku                         TEXT,
  listing_type                TEXT,
  receita                     NUMERIC,
  cmv                         NUMERIC,
  comissao                    NUMERIC,
  frete                       NUMERIC,
  impostos                    NUMERIC,
  lucro                       NUMERIC,
  lucro_pct                   NUMERIC,
  pedidos                     BIGINT,
  unidades                    BIGINT,
  has_cmv                     BOOLEAN,
  ads_spend                   NUMERIC,
  ads_attributed_orders       BIGINT,
  lucro_pos_ads               NUMERIC,
  lucro_pct_pos_ads           NUMERIC,
  ads_no_sale                 BOOLEAN,
  marca                       TEXT,
  difal_efeito                NUMERIC,
  pedidos_difal_indefinido    BIGINT,
  lucro_com_difal             NUMERIC,
  lucro_pct_com_difal         NUMERIC,
  lucro_pos_ads_com_difal     NUMERIC,
  lucro_pct_pos_ads_com_difal NUMERIC,
  -- ── Colunas novas (223-05), todas no FIM ────────────────────────────────
  -- Soma do rebate dos pedidos afirmáveis do anúncio, TOTAL em R$, como veio
  -- da fatura — só para conferência. NÃO é o que a margem usa (ver
  -- rebate_efeito). NULL quando nenhum pedido do anúncio é afirmável.
  rebate_bruto                 NUMERIC,
  -- Soma do EFEITO LÍQUIDO do rebate (rebate_efeito_liquido), TOTAL em R$ —
  -- é o que entra em lucro_sem_rebate. NULL quando nenhum pedido é afirmável.
  rebate_efeito                NUMERIC,
  -- Contagem de pedidos do anúncio cuja captura ainda não fechou (sem linha
  -- de captura, ou status parcial/sem_linha/erro) — "ainda não consultamos".
  pedidos_sem_captura_rebate   BIGINT,
  -- Contagem de pedidos capturados (status='ok') mas NÃO afirmáveis: a
  -- tarifa cobrada não bate com a comissão gravada, ou houve estorno por
  -- cancelamento — "sabemos, e é erro nosso". Distinta da anterior de
  -- propósito (D-223-05/critério 3 da fase).
  pedidos_rebate_nao_conferido BIGINT,
  -- O lucro no cenário de tarifa CHEIA (pré-ads), TOTAL em R$: a mesma
  -- expressão de `lucro`, com o efeito líquido do rebate subtraído dentro
  -- dela. NULL quando rebate_efeito é NULL — número parcial sobre nenhuma
  -- afirmação seria afirmação sem medida.
  lucro_sem_rebate             NUMERIC,
  -- O mesmo, como percentual da receita. NULL sem receita ou sem apuração.
  lucro_pct_sem_rebate         NUMERIC,
  -- O mesmo, depois da publicidade rateada da fatura. NULL sem apuração.
  lucro_pos_ads_sem_rebate     NUMERIC,
  -- O mesmo, percentual. NULL sem receita ou sem apuração.
  lucro_pct_pos_ads_sem_rebate NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pedidos_base AS (
    -- Bloco intermediário POR PEDIDO: um único termo de lucro antes do
    -- imposto, e dois termos de imposto (DIFAL) — inalterado desta migration.
    SELECT
      o.item_id,
      o.titulo,
      o.sku,
      o.listing_type,
      o.marca,
      o.receita_bruta,
      o.custo_unit,
      o.quantidade,
      o.comissao,
      o.frete,
      o.tax_amount,
      o.difal_amount,
      o.estado,
      o.uf_origem,
      o.ml_order_id,
      o.credito_pc_comissao,
      o.receita_bruta
        - COALESCE(o.custo_unit * o.quantidade, 0)
        - COALESCE(o.comissao, 0)
        - COALESCE(o.frete, 0)                                             AS lucro_antes_imposto,
      COALESCE(o.tax_amount, 0)                                            AS imposto_sem_difal,
      COALESCE(o.tax_amount, 0)
        + CASE
            WHEN o.difal_fonte IN ('calculado', 'nao_conciliado')
              THEN public.difal_efeito_liquido(
                     o.difal_amount,
                     o.fcp_amount,
                     o.pis_cofins_debito,
                     o.pis_cofins_debito_com_difal
                   )
            ELSE 0
          END                                                              AS imposto_com_difal
    FROM public.orders o
    WHERE o.organization_id = p_org_id
      AND o.ml_user_id = ANY(p_user_ids)
      AND o.status IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date BETWEEN p_from AND p_to
      AND o.item_id IS NOT NULL
  ),
  pedidos_rebate AS (
    -- Junção externa à esquerda com a captura, UMA linha para UMA linha, sem
    -- agregação e sem rateio. Pedido sem captura continua aparecendo aqui,
    -- com ausência declarada pelas duas flags abaixo — sumir da margem é
    -- pior que aparecer incompleto.
    --
    -- ⚠️ Os pedidos cancelados já não entram em pedidos_base (filtro de
    -- status `paid`/`shipped`/`delivered`, inalterado). A guarda de estorno
    -- abaixo é defesa em profundidade para qualquer consumidor futuro que
    -- afrouxe esse filtro — o `sale_fee` da fatura NÃO enxerga o
    -- cancelamento (medido, 223-01 Q4).
    SELECT
      p.*,
      CASE
        WHEN c.status = 'ok'
         AND c.tem_estorno = false
         AND ABS(c.sale_fee_net - COALESCE(p.comissao, 0) * p.quantidade) <= 0.01
          THEN c.sale_fee_rebate          -- já é o TOTAL do pedido
        ELSE NULL
      END AS rebate_do_pedido,
      -- "Ainda não consultamos": sem linha de captura, ou captura em estado
      -- não final (parcial/sem_linha/erro).
      (c.status IS DISTINCT FROM 'ok') AS rebate_sem_captura,
      -- "Consultamos, mas não é afirmável": capturado (status='ok') e, ainda
      -- assim, a conferência não fecha OU há estorno por cancelamento.
      (
        c.status = 'ok'
        AND NOT (
          c.tem_estorno = false
          AND ABS(c.sale_fee_net - COALESCE(p.comissao, 0) * p.quantidade) <= 0.01
        )
      ) AS rebate_nao_conferido
    FROM pedidos_base p
    LEFT JOIN public.ml_order_sale_fee_captura c
      ON c.organization_id = p_org_id
     AND c.ml_order_id = p.ml_order_id
  ),
  pedidos_rebate_efeito AS (
    -- Segundo bloco intermediário: o alias `rebate_do_pedido` não é visível
    -- no mesmo nível de projeção que o calcula, então o efeito líquido entra
    -- num CTE à parte, consumindo a função única do 223-03.
    SELECT
      p.*,
      CASE
        WHEN p.rebate_do_pedido IS NOT NULL
          THEN public.rebate_efeito_liquido(p.rebate_do_pedido, p.comissao, p.credito_pc_comissao)
        ELSE NULL
      END AS rebate_efeito_pedido
    FROM pedidos_rebate p
  ),
  orders_side AS (
    SELECT
      p.item_id,
      MAX(p.titulo)                                                        AS titulo,
      MAX(p.sku)                                                           AS sku,
      MAX(p.listing_type)                                                  AS listing_type,
      MAX(p.marca)                                                         AS marca,
      COALESCE(SUM(p.receita_bruta), 0)                                    AS receita,
      COALESCE(SUM(p.custo_unit * p.quantidade), 0)                        AS cmv,
      COALESCE(SUM(p.comissao), 0)                                         AS comissao,
      COALESCE(SUM(p.frete), 0)                                            AS frete,
      COALESCE(SUM(p.tax_amount), 0)                                       AS impostos,
      COALESCE(SUM(p.lucro_antes_imposto - p.imposto_sem_difal), 0)        AS lucro,
      COALESCE(SUM(p.lucro_antes_imposto - p.imposto_com_difal), 0)        AS lucro_com_difal,
      COALESCE(SUM(p.imposto_com_difal - p.imposto_sem_difal), 0)          AS difal_efeito,
      COUNT(*) FILTER (
        WHERE p.difal_amount IS NULL
          AND p.estado    IS NOT NULL
          AND p.uf_origem IS NOT NULL
          AND p.estado    <> p.uf_origem
      )                                                                    AS pedidos_difal_indefinido,
      COUNT(*)                                                             AS pedidos,
      COALESCE(SUM(p.quantidade), 0)                                       AS unidades,
      BOOL_OR(p.custo_unit IS NOT NULL)                                    AS has_cmv,
      -- Rebate: SUM puro, sem COALESCE — NULL quando tudo é NULL no grupo.
      SUM(p.rebate_do_pedido)                                              AS rebate_bruto,
      SUM(p.rebate_efeito_pedido)                                          AS rebate_efeito,
      COUNT(*) FILTER (WHERE p.rebate_sem_captura)                        AS pedidos_sem_captura_rebate,
      COUNT(*) FILTER (WHERE p.rebate_nao_conferido)                      AS pedidos_rebate_nao_conferido,
      -- Pedido não afirmável entra como ZERO de efeito aqui dentro — a
      -- lacuna é declarada pelas contagens acima, não escondida como
      -- redução. O guardião de "nada afirmável" é rebate_efeito (acima),
      -- consultado na projeção final para decidir se este valor é exposto.
      SUM(p.lucro_antes_imposto - p.imposto_sem_difal - COALESCE(p.rebate_efeito_pedido, 0)) AS lucro_sem_rebate_bruto
    FROM pedidos_rebate_efeito p
    GROUP BY p.item_id
  ),
  ads_side AS (
    SELECT
      a.item_id,
      MAX(a.title)                                AS ads_title,
      COALESCE(SUM(a.spend), 0)                  AS ads_spend,
      COALESCE(SUM(a.attributed_orders), 0)      AS ads_attributed_orders
    FROM public.ml_ads_products_cache a
    WHERE a.organization_id = p_org_id
      AND a.ml_user_id = ANY(p_user_ids)
      AND a.date BETWEEN p_from AND p_to
    GROUP BY a.item_id
  )
  SELECT
    COALESCE(o.item_id, a.item_id)              AS item_id,
    COALESCE(o.titulo, a.ads_title)             AS titulo,
    o.sku,
    o.listing_type,
    COALESCE(o.receita, 0)                      AS receita,
    COALESCE(o.cmv, 0)                          AS cmv,
    COALESCE(o.comissao, 0)                     AS comissao,
    COALESCE(o.frete, 0)                        AS frete,
    COALESCE(o.impostos, 0)                     AS impostos,
    COALESCE(o.lucro, 0)                        AS lucro,
    CASE WHEN COALESCE(o.receita, 0) > 0
      THEN ROUND(COALESCE(o.lucro, 0) / o.receita * 100, 2)
      ELSE NULL END                              AS lucro_pct,
    COALESCE(o.pedidos, 0)                      AS pedidos,
    COALESCE(o.unidades, 0)                     AS unidades,
    COALESCE(o.has_cmv, false)                  AS has_cmv,
    COALESCE(a.ads_spend, 0)                    AS ads_spend,
    COALESCE(a.ads_attributed_orders, 0)        AS ads_attributed_orders,
    COALESCE(o.lucro, 0) - COALESCE(a.ads_spend, 0) AS lucro_pos_ads,
    CASE WHEN COALESCE(o.receita, 0) > 0
      THEN ROUND((COALESCE(o.lucro, 0) - COALESCE(a.ads_spend, 0)) / o.receita * 100, 2)
      ELSE NULL END                              AS lucro_pct_pos_ads,
    (COALESCE(a.ads_spend, 0) > 0 AND COALESCE(a.ads_attributed_orders, 0) = 0) AS ads_no_sale,
    o.marca                                      AS marca,
    -- ── Segundo cenário (DIFAL): as MESMAS expressões acima, imposto trocado ──
    COALESCE(o.difal_efeito, 0)                 AS difal_efeito,
    COALESCE(o.pedidos_difal_indefinido, 0)     AS pedidos_difal_indefinido,
    COALESCE(o.lucro_com_difal, 0)              AS lucro_com_difal,
    CASE WHEN COALESCE(o.receita, 0) > 0
      THEN ROUND(COALESCE(o.lucro_com_difal, 0) / o.receita * 100, 2)
      ELSE NULL END                              AS lucro_pct_com_difal,
    COALESCE(o.lucro_com_difal, 0) - COALESCE(a.ads_spend, 0) AS lucro_pos_ads_com_difal,
    CASE WHEN COALESCE(o.receita, 0) > 0
      THEN ROUND((COALESCE(o.lucro_com_difal, 0) - COALESCE(a.ads_spend, 0)) / o.receita * 100, 2)
      ELSE NULL END                              AS lucro_pct_pos_ads_com_difal,
    -- ── Terceiro cenário (REBATE): ausência é NULL, nunca zero (D-223-06) ──
    o.rebate_bruto                               AS rebate_bruto,
    o.rebate_efeito                              AS rebate_efeito,
    COALESCE(o.pedidos_sem_captura_rebate, 0)   AS pedidos_sem_captura_rebate,
    COALESCE(o.pedidos_rebate_nao_conferido, 0) AS pedidos_rebate_nao_conferido,
    CASE WHEN o.rebate_efeito IS NULL THEN NULL
      ELSE COALESCE(o.lucro_sem_rebate_bruto, 0) END AS lucro_sem_rebate,
    CASE WHEN o.rebate_efeito IS NULL THEN NULL
      WHEN COALESCE(o.receita, 0) > 0
        THEN ROUND(COALESCE(o.lucro_sem_rebate_bruto, 0) / o.receita * 100, 2)
      ELSE NULL END                              AS lucro_pct_sem_rebate,
    CASE WHEN o.rebate_efeito IS NULL THEN NULL
      ELSE COALESCE(o.lucro_sem_rebate_bruto, 0) - COALESCE(a.ads_spend, 0) END AS lucro_pos_ads_sem_rebate,
    CASE WHEN o.rebate_efeito IS NULL THEN NULL
      WHEN COALESCE(o.receita, 0) > 0
        THEN ROUND((COALESCE(o.lucro_sem_rebate_bruto, 0) - COALESCE(a.ads_spend, 0)) / o.receita * 100, 2)
      ELSE NULL END                              AS lucro_pct_pos_ads_sem_rebate
  FROM orders_side o
  FULL OUTER JOIN ads_side a USING (item_id)
  ORDER BY COALESCE(o.receita, 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_margin_with_ads_by_product(UUID, TEXT[], DATE, DATE) TO authenticated;
