-- View de cruzamento: DIFAL cobrado pelo ML na fatura x pedidos interestaduais
-- do mesmo dia (Fase 222, FISC-07, plano 222-02).
--
-- PERGUNTA QUE ESTA VIEW RESPONDE: em quais UFs o Mercado Livre já recolhe e
-- cobra o DIFAL na fatura? A resposta vira a lista de siglas de
-- `ml_tax_config.difal_ufs_cobradas_pelo_ml` (222-01) — mas só depois que um
-- humano ler o resultado (checkpoint da Task 2, orquestrador). Este arquivo
-- só cria a consulta; não roda contra dado real.
--
-- 🔴 GRANULARIDADE REAL DO DADO — ler antes de usar este resultado:
-- `ml_billing_daily` agrega por (organization_id, ml_user_id, charge_date,
-- charge_type, source_invoice_key). NÃO existe coluna de pedido nessa tabela
-- (ver `20260613020000_ml_billing_daily.sql`) — o ML não devolve, na fatura,
-- a qual pedido cada lançamento de DIFAL pertence. Por isso esta view produz
-- CANDIDATOS por dia (cobrança do dia vs. pedidos interestaduais do mesmo
-- dia), nunca uma atribuição pedido-a-pedido. Ler `pedidos_interestaduais_no_dia`
-- como "estes pedidos geraram aquela cobrança" seria inventar um vínculo que
-- o dado não tem — o mesmo erro de fabricar dado que esta fase existe para
-- não cometer (ver `222-CONTEXT.md`, D-07).
--
-- REGRA DE JUNÇÃO — por que FULL OUTER JOIN: a pergunta "em quais UFs o ML
-- já cobra" só tem resposta comparando os DOIS lados — dia com cobrança e
-- sem pedido candidato (cobrança não bate com pedido interestadual nenhum
-- daquele dia — vira ninguém para conciliar) E dia com pedido candidato e
-- sem cobrança (o ML não cobrou; se a UF for mesmo obrigada, é DIFAL que
-- ainda falta cobrar). Uma view que só mostra dias com cobrança nunca
-- permitiria descartar UF nenhuma.
--
-- RÉGUA DE DATA — `orders.data_pedido::date`: `data_pedido` é gravada como
-- TEXT em parte do histórico deste banco (não é indexável diretamente por
-- ::date — ver `feedback_garment_orders_date_perf`). A régua escolhida aqui é
-- a MESMA já usada pelas RPCs de KPI/margem por dia deste repo
-- (`get_margin_by_day`, `get_kpi_summary`, `20260527110000_margin_aggregate_
-- rpcs.sql`): `o.data_pedido::date`, agrupando por dia. Não inventar uma
-- terceira régua de data nesta fase — `ml_billing_daily.charge_date` já é
-- `DATE` nativo (não precisa de cast).
--
-- NOÇÃO DE "INTERESTADUAL" — a mesma do `_shared/orderTaxRate.ts` (Fase
-- 220/222): destino desconhecido (`estado` nulo ou vazio) NUNCA conta como
-- candidato; destino igual à UF de origem da loja é intraestadual (fora);
-- sem UF de origem configurada, TODO destino conhecido é tratado como
-- interestadual — o mesmo ramo "sem_uf_origem" da fórmula. A UF de origem
-- vem de `ml_tax_config.uf_origem`, por (organization_id, ml_user_id) — não
-- existe coluna de UF de origem em `orders`.
--
-- SEM PRIVILÉGIO DE DEFINIDOR, SEM TABELA NOVA, SEM ESCRITA: view comum,
-- herda a RLS de `ml_billing_daily` (`is_org_member`) e de `orders` para
-- quem a consultar autenticado. Este plano só LÊ — não altera
-- `ml_billing_daily`, `sync-ml-billing` nem nenhuma RPC existente.

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
