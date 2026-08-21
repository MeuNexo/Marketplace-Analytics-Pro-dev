-- ────────────────────────────────────────────────────────────────────────────
-- Corrige a identidade FALSA gravada em 20260821100000 (Fase 223, quick
-- 260821-inn).
--
-- POR QUE ARQUIVO NOVO, E NÃO EDIÇÃO: `20260821100000_ml_order_sale_fee.sql`
-- já está APLICADA em produção. Migration aplicada não se reescreve nesta
-- casa — a correção nasce em arquivo novo, posterior por nome.
--
-- O DEFEITO: a restrição `ml_order_sale_fee_captura_identidade_gross_rebate_net`
-- exige `gross - rebate == net`. Ela nasceu de uma amostra de 7 pedidos
-- medida em 20/08 (223-CONTRATO-SALE-FEE.md) em que o campo `discount`
-- valia EXATAMENTE ZERO nos 7 — a parcela que faltava era invisível. A regra
-- era VERDADEIRA NA AMOSTRA e FALSA NO MUNDO.
--
-- O CONTRAEXEMPLO, medido ao vivo em 21/08, pedido 2000015317143520 (Pé
-- Vermeio, seller 1639558873):
--   gross 49,00 · net 46,55 · rebate 0 · discount 2,45 · discount_reason
--   "Desconto geral"
--   49,00 - 0            = 49,00 ≠ 46,55  → regra de DUAS parcelas QUEBRA
--   49,00 - 0 - 2,45      = 46,55 = 46,55  → regra de TRÊS parcelas FECHA
--
-- 🔴 CONSEQUÊNCIA ATIVA: a restrição errada estava recusando o upsert desta
-- linha e abortando o backfill inteiro. Três rodadas seguidas falharam.
-- 6.295 pedidos travados.
--
-- APLICAÇÃO É PORTÃO DO ORQUESTRADOR: este plano só escreve o arquivo.
-- Aplicar via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` — NUNCA
-- SQL Editor, NUNCA `supabase db push`.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── Passo 1: deriva a restrição antiga, pelo nome ──────────────────────────
ALTER TABLE public.ml_order_sale_fee_captura
  DROP CONSTRAINT IF EXISTS ml_order_sale_fee_captura_identidade_gross_rebate_net;

-- ─── Passo 2: guarda — nenhuma linha já gravada pode violar a regra nova ────
-- 🔴 Nunca apagar nem ajustar linha para a restrição entrar: se houver
-- violador, quem decide o que fazer com ele é o Wesley, não a migration.
-- Como é a mesma transação, a exceção abaixo desfaz o DROP do passo 1 junto.
DO $$
DECLARE
  v_contagem   integer;
  v_ids        text;
BEGIN
  SELECT count(*) INTO v_contagem
    FROM public.ml_order_sale_fee_captura
   WHERE status = 'ok'
     AND ABS(
           (sale_fee_gross - sale_fee_rebate - COALESCE(sale_fee_discount, 0))
           - sale_fee_net
         ) > 0.01;

  IF v_contagem > 0 THEN
    SELECT string_agg(ml_order_id, ', ') INTO v_ids
      FROM (
        SELECT ml_order_id
          FROM public.ml_order_sale_fee_captura
         WHERE status = 'ok'
           AND ABS(
                 (sale_fee_gross - sale_fee_rebate - COALESCE(sale_fee_discount, 0))
                 - sale_fee_net
               ) > 0.01
         ORDER BY ml_order_id
         LIMIT 5
      ) amostra;

    RAISE EXCEPTION
      'ml_order_sale_fee_captura: % linha(s) capturada(s) violam a identidade de tres parcelas (gross - rebate - COALESCE(discount,0) == net). Primeiros ml_order_id (ate 5): %. Nenhuma linha foi alterada — decisao humana necessaria antes de aplicar a restricao nova.',
      v_contagem, v_ids;
  END IF;
END $$;

-- ─── Passo 3: cria a restrição certa, com nome NOVO ─────────────────────────
-- Não reaproveita o nome antigo: ele carrega a fórmula errada dentro do
-- próprio nome e mentiria sobre a regra em toda mensagem de erro futura.
--
-- 🔴 O desconto entra SEMPRE dentro de COALESCE(sale_fee_discount, 0). Numa
-- CHECK do Postgres, expressão que dá NULL não reprova a linha — passa como
-- se fosse não-falsa. `sale_fee_discount` é nulável: sem o COALESCE, toda
-- linha com desconto ausente produziria NULL e passaria sem ser conferida —
-- a restrição existiria e não valeria nada exatamente nas linhas em que o
-- campo não veio (D-inn-03). `gross`, `net` e `rebate` não precisam de
-- COALESCE: a restrição irmã `ml_order_sale_fee_captura_ok_tem_sale_fee` já
-- exige os três preenchidos quando status = 'ok'.
ALTER TABLE public.ml_order_sale_fee_captura
  ADD CONSTRAINT ml_order_sale_fee_captura_identidade_sale_fee CHECK (
    status <> 'ok'
    OR ABS(
         (sale_fee_gross - sale_fee_rebate - COALESCE(sale_fee_discount, 0))
         - sale_fee_net
       ) <= 0.01
  );

-- ─── Passo 4: comentários — a regra certa e por que a antiga estava errada ──
COMMENT ON CONSTRAINT ml_order_sale_fee_captura_identidade_sale_fee
  ON public.ml_order_sale_fee_captura IS
  'Identidade de TRES parcelas: gross - rebate - COALESCE(discount, 0) == net, '
  'dentro de um centavo, quando status = ok. Substitui '
  'ml_order_sale_fee_captura_identidade_gross_rebate_net (duas parcelas), que '
  'nasceu de uma amostra de 7 pedidos medida em 20/08 em que discount valia '
  'exatamente zero nos 7 — verdadeira na amostra, falsa no mundo. '
  'Contraexemplo medido ao vivo em 21/08, pedido 2000015317143520: '
  'gross 49,00 - rebate 0 - discount 2,45 = net 46,55. A regra de duas '
  'parcelas (49,00 - 0 = 49,00) recusava esta linha e travou o backfill de '
  '6.295 pedidos.';

COMMENT ON COLUMN public.ml_order_sale_fee_captura.sale_fee_discount IS
  'sale_fee.discount da RAIZ do result, TOTAL do pedido (nao por unidade). '
  'NAO E rebate: rebate e desconto por participacao em campanha comercial '
  '(o unico que a tela mostra nos dois cenarios da fase 223); discount com '
  'discount_reason "Desconto geral" e reducao geral da tarifa, outro fato, '
  'outra origem — os dois entram como parcelas SEPARADAS na identidade '
  '(ml_order_sale_fee_captura_identidade_sale_fee), nunca somados um ao '
  'outro. Era a UNICA coluna de valor desta tabela sem comentario de '
  'unidade ate esta migration — o que a deixou fora da auditoria '
  'COLUNAS_DE_VALOR_COM_UNIDADE (rebateSqlAudit.test.ts) e contribuiu para '
  'o defeito passar despercebido.';

COMMENT ON COLUMN public.ml_order_sale_fee_captura.discount_reason IS
  'Razao do desconto do PEDIDO INTEIRO, lida da raiz do result. Armadilha '
  'de nome: existe um campo de mesmo nome (discount_info.discount_reason) '
  'por LINHA de cobranca dentro de details[], que traz o mesmo texto '
  '"Desconto geral" em linhas de FRETE mesmo quando o pedido nao tem rebate '
  '(mlOrderSaleFeeContrato.ts). Dois fatos diferentes, um rotulo so — nao '
  'confundir esta coluna (raiz, pedido inteiro) com a informacao por linha.';

COMMIT;
