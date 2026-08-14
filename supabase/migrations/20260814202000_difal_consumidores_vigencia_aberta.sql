-- Os dois consumidores de `ml_tax_config` que DOBRARIAM com a segunda vigência
-- (Fase 222, plano 222-05-R).
--
-- MOMENTO DE APLICAÇÃO: depois de `20260814201000` (schema da vigência) e
-- ANTES de qualquer loja passar a ter mais de uma linha. Enquanto houver uma
-- vigência por loja, esta migration não muda número nenhum — é exatamente essa
-- propriedade que a torna conferível: rodar a view e a função antes e depois
-- tem de dar totais IDÊNTICOS. Diferença aqui é bug da substituição.
--
-- O QUE ACONTECERIA SEM ELA: os dois objetos fazem `orders LEFT JOIN
-- ml_tax_config ON (organization_id, ml_user_id)`, sem filtro de vigência. Com
-- duas vigências, **cada pedido do Junior vira duas linhas** e toda soma dobra
-- — receita, contagem de pedidos, DIFAL. O CTE de contagem de lojas dentro de
-- `get_difal_summary` é pior ainda: ele conta linhas de `ml_tax_config` como se
-- fossem lojas, então `regua_recolhimento_configurada` passaria a comparar
-- "lojas com config" contra "número de vigências" e viraria falso sem motivo.
--
-- ⚠️ SOBRE A VIEW: `ml_difal_cobrado_por_dia` **já está em produção**, aplicada
-- sob a version `20260813002523` — stamp divergente do nome do arquivo
-- `20260812202000_ml_difal_cobrado_view.sql`. Por isso aquele arquivo **não
-- deve ser reaplicado**; o conserto vem por `CREATE OR REPLACE` aqui.
--
-- POR QUE O CORPO É COPIADO INTEIRO, LINHA A LINHA: `CREATE OR REPLACE VIEW`
-- exige a MESMA lista de colunas, na mesma ordem e com os mesmos tipos — é
-- literalmente a condição para a substituição ser possível sem `DROP VIEW`. E
-- `DROP` está proibido desde a Fase 220 (apaga a ACL). A única diferença em
-- relação ao original é a linha de vigência acrescentada em cada JOIN; nenhuma
-- linha do corpo original foi removida ou alterada.
--
-- Nenhum `DROP FUNCTION`, nenhum `DROP VIEW`, nenhuma mudança de assinatura,
-- nenhuma mudança de privilégio de invocador.

CREATE OR REPLACE VIEW public.ml_difal_cobrado_por_dia AS
WITH billing_agg AS (
  SELECT
    b.organization_id,
    b.ml_user_id,
    b.charge_date,
    SUM(b.amount)   AS difal_cobrado,
    COUNT(*)        AS lancamentos
  FROM public.ml_billing_daily b
  WHERE b.charge_type = 'CDIFAL'
  GROUP BY b.organization_id, b.ml_user_id, b.charge_date
),
orders_agg AS (
  SELECT
    o.organization_id,
    o.ml_user_id,
    o.data_pedido::date AS pedido_date,
    COUNT(*)                                                            AS pedidos_interestaduais_no_dia,
    array_agg(DISTINCT upper(btrim(o.estado)) ORDER BY upper(btrim(o.estado)))
                                                                         AS ufs_do_dia,
    COALESCE(SUM(o.receita_bruta), 0)                                   AS receita_interestadual_no_dia
  FROM public.orders o
  LEFT JOIN public.ml_tax_config cfg
    ON cfg.organization_id = o.organization_id
   AND cfg.ml_user_id      = o.ml_user_id
   -- [222-05-R] Só a vigência corrente. Sem esta linha, uma loja com histórico
   -- de alíquota casa N vezes e cada pedido dela é contado N vezes.
   AND cfg.vigencia_fim IS NULL
  WHERE o.status IN ('paid', 'shipped', 'delivered')
    AND o.estado IS NOT NULL
    AND btrim(o.estado) <> ''
    AND (
      cfg.uf_origem IS NULL
      OR upper(btrim(o.estado)) <> upper(btrim(cfg.uf_origem))
    )
  GROUP BY o.organization_id, o.ml_user_id, o.data_pedido::date
)
SELECT
  COALESCE(bi.organization_id, oa.organization_id)   AS organization_id,
  COALESCE(bi.ml_user_id, oa.ml_user_id)              AS ml_user_id,
  COALESCE(bi.charge_date, oa.pedido_date)            AS charge_date,
  bi.difal_cobrado,
  bi.lancamentos,
  COALESCE(oa.pedidos_interestaduais_no_dia, 0)       AS pedidos_interestaduais_no_dia,
  oa.ufs_do_dia,
  oa.receita_interestadual_no_dia
FROM billing_agg bi
FULL OUTER JOIN orders_agg oa
  ON bi.organization_id = oa.organization_id
 AND bi.ml_user_id      = oa.ml_user_id
 AND bi.charge_date     = oa.pedido_date;

COMMENT ON VIEW public.ml_difal_cobrado_por_dia IS
  'Cruza o DIFAL cobrado pelo ML na fatura (ml_billing_daily, charge_type=CDIFAL) com os pedidos interestaduais do mesmo dia/loja, para descobrir em quais UFs o ML já recolhe o DIFAL — não substitui atribuição por pedido, que ml_billing_daily não tem (dado agregado por dia/conceito, sem identificador de pedido).';

GRANT SELECT ON public.ml_difal_cobrado_por_dia TO authenticated;

-- ─── get_difal_summary: mesma assinatura, mesmo corpo, dois predicados a mais ─
-- Corpo copiado de `20260812230000_get_difal_summary.sql`. As únicas
-- diferenças são as duas condições de vigência aberta, marcadas abaixo.
-- Assinatura idêntica → `CREATE OR REPLACE FUNCTION` substitui sem tocar na
-- ACL; nenhum `DROP FUNCTION` (regra da casa desde a Fase 220).

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
      -- [222-05-R] Este CTE conta LOJAS. Sem o filtro, passaria a contar
      -- vigências, e `regua_*_configurada` viraria falso só porque a loja tem
      -- histórico de alíquota.
      AND vigencia_fim IS NULL
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
     -- [222-05-R] Só a vigência corrente: `difal_ufs_recolhidas` é lida AO VIVO
     -- (é a régua de hoje, não o snapshot do pedido — ver o cabeçalho do
     -- arquivo original). Sem o filtro, cada pedido da loja com histórico
     -- viraria N linhas e TODA soma deste resumo dobraria.
     AND c.vigencia_fim IS NULL
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
