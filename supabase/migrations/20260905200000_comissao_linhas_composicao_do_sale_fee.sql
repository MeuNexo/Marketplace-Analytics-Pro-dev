-- ===========================================================================
-- 244-01 — `comissao_linhas` recalculada pela COMPOSIÇÃO medida do `sale_fee`
--
-- ── O QUE ESTA MIGRATION FAZ, E POR QUE NÃO GASTA UMA CHAMADA AO ML ────────
--
-- As linhas de cobrança já estão em `ml_order_sale_fee`. O que mudou foi a
-- LISTA de quais delas compõem o `sale_fee` do pedido — três siglas entraram
-- (`CV`, `CVML`, `CVMP`), medidas em 05/09/2026. Recapturar do Mercado Livre
-- devolveria exatamente as mesmas linhas e queimaria orçamento de API.
--
-- ── A DECISÃO, E A MEDIÇÃO QUE A SUSTENTA ─────────────────────────────────
--
-- `SUBTIPOS_COMISSAO` não é taxonomia de nomes: é a lista de parcelas em que
-- o ML QUEBRA a mesma tarifa. Prova ao centavo, pedido `2000017848004682`:
--   `CVVML` 45,76 + `CVVPRC` 0,32 = 46,08 = `sale_fee.net` = 12,0% publicado.
--
-- Sobre 8.136 pedidos com captura, contando só linhas `CHARGE`:
--   lista de agosto  -> 8.103 identidades fecham, erro R$ 371,96
--   esta lista       -> 8.108 identidades fecham, erro R$ 137,59
--   esta + `CVAF`    -> 8.079  (por isso `CVAF` NÃO está aqui)
--
-- ⚠️ A lista abaixo é literal REPETIDO — a mesma classe de defeito que deixou
-- `CFFI` fora da régua de frete por semanas (fase 241). O portão
-- `comissaoComposicaoSqlAudit.test.ts` confere, sigla por sigla, que ela é
-- idêntica a `COMPOEM_SALE_FEE_CHARGE` do dicionário TypeScript. Mudar uma
-- sem a outra REPROVA.
--
-- ── O QUE MUDA NA BASE (medido ANTES de aplicar) ───────────────────────────
--
--   32 linhas passam de NULO para valor   ·  R$ 1.024,84
--    0 linhas passam de valor para NULO
--    0 linhas mudam de valor
--
-- 🔴 NULO CONTINUA SENDO NULO onde não há nenhuma linha de comissão. `0` ali
-- leria "o ML não cobrou comissão", que é afirmação; o nulo diz "não confere",
-- que é o que se sabe. Mesma régua de `aceite.ts` (225-13).
-- ===========================================================================

UPDATE public.ml_order_sale_fee_captura c
   SET comissao_linhas = s.soma
  FROM (
        SELECT f.organization_id,
               f.ml_order_id,
               SUM(f.detail_amount) AS soma
          FROM public.ml_order_sale_fee f
         WHERE f.detail_type = 'CHARGE'
           AND f.detail_sub_type IN ('CV','CVML','CVMP','CVVFN','CVVFNU','CVVML','CVVPRC')
         GROUP BY f.organization_id, f.ml_order_id
       ) s
 WHERE s.organization_id = c.organization_id
   AND s.ml_order_id     = c.ml_order_id
   AND c.comissao_linhas IS DISTINCT FROM s.soma;
