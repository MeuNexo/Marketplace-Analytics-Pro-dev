-- RPC aditiva do resumo de DIFAL (Fase 222, plano 222-07, FISC-04/FISC-07).
--
-- POR QUE UMA FUNCAO NOVA, NUNCA UMA COLUNA A MAIS NO RESUMO DE KPI JA
-- EXISTENTE: mudar o tipo de retorno de uma funcao existente exige
-- remove-la antes de recriar com a assinatura nova -- e remover uma funcao
-- apaga a ACL (GRANT EXECUTE) que o frontend depende para chamar via RPC.
-- Este arquivo so cria; nenhuma das nove RPCs de imposto/margem ja
-- existentes neste banco e tocada.
--
-- SEMANTICA DE CADA COLUNA (D-02, D-07, 222-CONTEXT.md):
--
-- difal_calculado ................... soma DIFAL + FCP dos pedidos cuja
--   procedencia (orders.difal_fonte) e "calculado" ou "nao_conciliado" --
--   NUNCA dos pedidos cujo DIFAL o ML ja cobrou na fatura (difal_fonte =
--   'cobrado_ml'). E o termo "previsao" do cenario com DIFAL.
--
-- fcp_calculado ...................... a mesma particao acima, so o FCP,
--   para quem quiser abrir o componente separadamente.
--
-- difal_recolhido_pela_loja ......... subconjunto do calculado acima,
--   restrito as UFs que a loja declarou recolher
--   (ml_tax_config.difal_ufs_recolhidas, lido AO VIVO na hora da consulta,
--   nao o snapshot gravado no pedido) -- e o teto usado quando a loja ja
--   confirmou quais UFs recolhe de fato.
--
-- difal_cobrado_ml ................... soma o conceito CDIFAL de
--   ml_billing_daily (fato: o que o ML ja cobrou na fatura), na mesma
--   janela e nas mesmas lojas.
--
-- difal_previsto_nas_ufs_cobradas ... soma DIFAL + FCP dos pedidos cuja
--   procedencia e "cobrado_ml" -- ou seja, o valor que a REGUA teria
--   calculado para esses mesmos pedidos, para comparar contra
--   difal_cobrado_ml e calibrar a formula. INFORMATIVO: nunca entra em
--   nenhum total exibido, porque somar isso ao cobrado ou ao calculado
--   contaria o mesmo destino duas vezes -- o erro que esta fase existe para
--   nao cometer.
--
-- pedidos_com_difal .................. contagem de pedidos com DIFAL
--   calculado com sucesso (orders.difal_amount IS NOT NULL).
--
-- pedidos_difal_indefinido .......... contagem de pedidos com destino
--   conhecido e interestadual (estado <> uf_origem, os dois preenchidos) mas
--   SEM DIFAL calculado -- e o numero que torna a UF nao confirmada pelo
--   contador visivel na tela, mesmo criterio de
--   orders_regua_health.pedidos_difal_ausente_destino_interestadual (222-05).
--
-- pedidos_nao_conciliados ............ contagem de pedidos cuja procedencia
--   e "nao_conciliado" -- o cruzamento fatura<->pedidos (222-02) ainda nao
--   foi feito para aquela loja.
--
-- regua_recolhimento_configurada .... true somente quando TODAS as lojas do
--   filtro tem difal_ufs_recolhidas preenchido (nao nulo). Pelo menos uma
--   loja sem config = false, para a tela nunca aplicar um teto so parcial
--   como se fosse completo.
--
-- regua_cobranca_configurada ........ mesma regra acima, para
--   difal_ufs_cobradas_pelo_ml.
--
-- Mesmo filtro de status ('paid','shipped','delivered') e mesmo recorte de
-- data (data_pedido::date BETWEEN) do resumo de KPI ja existente -- os dois
-- numeros exibidos juntos na tela precisam vir do mesmo conjunto de
-- pedidos, senao deixam de ser comparaveis.
--
-- Privilegio de invocador (nao de definidor): a RLS de orders,
-- ml_tax_config e ml_billing_daily continua valendo integralmente para quem
-- chama esta funcao -- nenhum bypass de tenant.

CREATE OR REPLACE FUNCTION public.get_difal_summary(
  p_org_id   UUID,
  p_user_ids TEXT[],
  p_from     DATE,
  p_to       DATE
)
RETURNS TABLE (
  difal_calculado                 NUMERIC,
  fcp_calculado                   NUMERIC,
  difal_recolhido_pela_loja       NUMERIC,
  difal_cobrado_ml                NUMERIC,
  difal_previsto_nas_ufs_cobradas NUMERIC,
  reducao_pc_por_difal            NUMERIC,
  pedidos_com_difal               BIGINT,
  pedidos_difal_indefinido        BIGINT,
  pedidos_nao_conciliados         BIGINT,
  regua_recolhimento_configurada  BOOLEAN,
  regua_cobranca_configurada      BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH cfg_check AS (
    SELECT
      count(*)                                                             AS total_lojas,
      count(*) FILTER (WHERE difal_ufs_recolhidas IS NOT NULL)             AS lojas_recolhimento_config,
      count(*) FILTER (WHERE difal_ufs_cobradas_pelo_ml IS NOT NULL)       AS lojas_cobranca_config
    FROM public.ml_tax_config
    WHERE organization_id = p_org_id
      AND ml_user_id      = ANY(p_user_ids)
  ),
  pedidos AS (
    SELECT
      o.difal_amount,
      o.fcp_amount,
      o.difal_fonte,
      o.pis_cofins_debito,
      o.pis_cofins_debito_com_difal,
      o.estado,
      o.uf_origem,
      c.difal_ufs_recolhidas
    FROM public.orders o
    LEFT JOIN public.ml_tax_config c
      ON c.organization_id = o.organization_id
     AND c.ml_user_id      = o.ml_user_id
    WHERE o.organization_id  = p_org_id
      AND o.ml_user_id       = ANY(p_user_ids)
      AND o.status            IN ('paid', 'shipped', 'delivered')
      AND o.data_pedido::date BETWEEN p_from AND p_to
  ),
  billing AS (
    SELECT COALESCE(SUM(b.amount), 0) AS total
    FROM public.ml_billing_daily b
    WHERE b.organization_id = p_org_id
      AND b.ml_user_id      = ANY(p_user_ids)
      AND b.charge_type     = 'CDIFAL'
      AND b.charge_date     BETWEEN p_from AND p_to
  )
  SELECT
    COALESCE(
      SUM(p.difal_amount + COALESCE(p.fcp_amount, 0))
        FILTER (WHERE p.difal_fonte IN ('calculado', 'nao_conciliado')),
      0
    )                                                                      AS difal_calculado,
    COALESCE(
      SUM(p.fcp_amount)
        FILTER (WHERE p.difal_fonte IN ('calculado', 'nao_conciliado')),
      0
    )                                                                      AS fcp_calculado,
    COALESCE(
      SUM(p.difal_amount + COALESCE(p.fcp_amount, 0))
        FILTER (
          WHERE p.difal_fonte IN ('calculado', 'nao_conciliado')
            AND p.difal_ufs_recolhidas IS NOT NULL
            AND upper(btrim(p.estado)) = ANY(p.difal_ufs_recolhidas)
        ),
      0
    )                                                                      AS difal_recolhido_pela_loja,
    (SELECT total FROM billing)                                           AS difal_cobrado_ml,
    COALESCE(
      SUM(p.difal_amount + COALESCE(p.fcp_amount, 0))
        FILTER (WHERE p.difal_fonte = 'cobrado_ml'),
      0
    )                                                                      AS difal_previsto_nas_ufs_cobradas,
    -- [222-07-R / D-10.1] Quanto o PIS/COFINS DIMINUI por causa do DIFAL.
    -- A base do PIS/COFINS no cenario COM DIFAL e (receita - ICMS - DIFAL),
    -- entao entrar com o DIFAL nao custa o DIFAL cheio: custa o DIFAL menos
    -- este valor. Sem este campo, quem soma difal_amount por cima de
    -- tax_amount SUPERESTIMA o imposto -- medido no caso-prova: R$ 3,85 por
    -- pedido, imposto maior e MCO menor que o real.
    -- Positivo por construcao (a base com DIFAL e sempre menor); COALESCE
    -- protege as linhas que a regua nova ainda nao gravou.
    COALESCE(
      SUM(COALESCE(p.pis_cofins_debito, 0) - COALESCE(p.pis_cofins_debito_com_difal, 0))
        FILTER (
          WHERE p.difal_fonte IN ('calculado', 'nao_conciliado')
            AND p.pis_cofins_debito_com_difal IS NOT NULL
        ),
      0
    )                                                                      AS reducao_pc_por_difal,
    count(*) FILTER (WHERE p.difal_amount IS NOT NULL)                    AS pedidos_com_difal,
    count(*) FILTER (
      WHERE p.difal_amount IS NULL
        AND p.estado     IS NOT NULL
        AND p.uf_origem  IS NOT NULL
        AND p.estado     <> p.uf_origem
    )                                                                      AS pedidos_difal_indefinido,
    count(*) FILTER (WHERE p.difal_fonte = 'nao_conciliado')              AS pedidos_nao_conciliados,
    (SELECT total_lojas > 0 AND lojas_recolhimento_config = total_lojas FROM cfg_check)
                                                                            AS regua_recolhimento_configurada,
    (SELECT total_lojas > 0 AND lojas_cobranca_config = total_lojas FROM cfg_check)
                                                                            AS regua_cobranca_configurada
  FROM pedidos p;
$$;

GRANT EXECUTE ON FUNCTION public.get_difal_summary(UUID, TEXT[], DATE, DATE) TO authenticated;
