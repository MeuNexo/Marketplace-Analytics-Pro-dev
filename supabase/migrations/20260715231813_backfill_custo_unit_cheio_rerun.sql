-- Phase 96-07: re-rodar o backfill de orders.custo_unit_cheio.
--
-- CONTEXTO: o repo garment-glow-test nunca teve migration para
-- custo_unit_cheio/cost_full -- vieram de DRIFT (worktree irmao
-- /root/garment-glow-dre, branch gsd/phase-86-dre-competencia, nao
-- mergeada) aplicado direto em prod. O backfill rodou UMA VEZ; nada em
-- producao gravava custo_unit_cheio em pedido novo ate a Task 1 deste
-- plano (96-07) portar as EFs sync-tiny-costs e recalc-order-costs.
-- Cobertura medida em 2026-07-15 (Pe Vermeio, pedidos pagos):
--   jan 86,4% | fev 79,4% | mar 77,2% | abr 80,5% | mai 79,8% | jun 85,6%
--   | jul 32,9% -- enquanto o custo medio (custo_unit) segue em 94,9%.
--
-- AUTORIZACAO (Wesley, 2026-07-15), sobre os campos do Tiny:
--   "Pode confiar nos valores que estao na Tiny, no que esta preco custo
--   e o cheio, e o preco custo medio e o descontado automaticamente ou
--   manualmente o ICMS, pis e cofins do produto."
-- Ou seja: precos.precoCusto (Tiny) = custo CHEIO, fonte de
-- ml_product_costs.cost_full -> orders.custo_unit_cheio. E
-- precos.precoCustoMedio = o mesmo custo com ICMS/PIS/COFINS ja
-- descontados (fonte de ml_product_costs.cost -> orders.custo_unit,
-- NUNCA tocado por esta migration). A razao entre os dois campos em
-- boa parte do catalogo e consequencia da estrutura tributaria
-- (credito de ICMS/PIS/COFINS), nao de uma conta aplicada em cima do
-- campo medio pelo nosso codigo -- os dois campos sao lidos SEPARADOS
-- do Tiny (ver sync-tiny-costs/index.ts). Esta migration so COPIA
-- cost_full -> custo_unit_cheio, nunca deriva um do outro.
--
-- ALVO (ADENDO do 96-RESEARCH.md, verificado no banco vivo em
-- 2026-07-15): dos 39 SKUs de maio sem custo_unit_cheio, 35 existem em
-- ml_product_costs e 34 ja tem cost_full disponivel -> este backfill
-- fecha 34 na hora. Os 4 restantes (K2CTXCB191380PTOBRANM,
-- K2CTXCB191380PTOBRANGG, K2CTXCB191380PTOBRANP, 180128333315NATP) nao
-- estao cadastrados no Tiny -- e exatamente a tarefa manual ja entregue
-- ao Wesley. O residuo do backfill e o trabalho dele, nao um bug.
--
-- ACHADO DE QUALIDADE DE DADO (nao bloqueia, nao corrigido aqui): 7 SKUs
-- da familia "1156120*" tem custo medio > custo cheio (ex.:
-- 1156120NATP medio 157,00 x cheio 107,81), o que e impossivel pela
-- definicao do Wesley (medio = cheio MENOS impostos). Ficha do Tiny
-- provavelmente com os dois campos invertidos. Impacto desprezivel: so
-- 2 SKUs venderam em 2026, R$396 no total. Candidato ao alerta de dado
-- ruim do C8 (mesma regra: so informar, nunca auto-corrigir).
--
-- PROPRIEDADES (nao podem mudar em re-execucoes futuras):
--   - IDEMPOTENTE: so toca linhas onde o campo ainda esta em branco.
--   - MONOCOLUNA: o unico campo no SET e custo_unit_cheio. custo_unit
--     (medio), tax_rate, tax_amount, uf_origem -- intocados.
--   - Escopo de org no join: pc.organization_id IS NULL OR = o.organization_id
--     -- evita casar SKU de uma org com custo de outra.
--   - Sem filtro de periodo: fecha o historico inteiro de uma vez.
--
-- ORDEM DE APLICACAO OBRIGATORIA (Task 3 do plano 96-07): so aplicar
-- APOS o deploy das EFs portadas (Task 1) e um re-sync de
-- sync-tiny-costs que garanta cost_full fresco em ml_product_costs --
-- caso contrario esta migration vira um no-op silencioso (0 rows, sem
-- erro).

UPDATE public.orders o
SET custo_unit_cheio = pc.cost_full
FROM public.ml_product_costs pc
WHERE o.sku = pc.seller_sku
  AND pc.cost_full IS NOT NULL
  AND o.custo_unit_cheio IS NULL
  AND (pc.organization_id IS NULL OR pc.organization_id = o.organization_id);
