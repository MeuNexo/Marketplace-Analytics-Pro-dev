-- ──────────────────────────────────────────────────────────────────────────────
-- public.rebate_efeito_liquido — o quanto PERDER o rebate efetivamente CUSTA,
-- em UMA definição só (Fase 223, plano 223-03).
--
-- POR QUE ESTA FUNÇÃO EXISTE: `orders.comissao` é o `net` — a comissão já
-- descontada do rebate. No cenário SEM rebate a comissão seria o `gross`,
-- isto é, `comissao + rebate`. Isso muda DUAS coisas, não uma:
--
--   1. A comissão sobe em `rebate` (a margem cai).
--   2. O crédito de PIS/COFINS sobre a comissão sobe junto — a régua da 222
--      (`orderTaxRate.ts`, D-R2-01) credita PIS/COFINS sobre a comissão
--      LÍQUIDA de um ICMS de referência. Comissão maior, crédito maior,
--      imposto menor (a margem sobe um pouco de volta).
--
-- O crédito é PROPORCIONAL à comissão, e `orders.credito_pc_comissao` já
-- está gravado por pedido desde a 222. Logo o crédito extra que o rebate
-- teria gerado é `rebate × (credito_pc_comissao / comissao)`, e o custo real
-- de perder o rebate é a diferença:
--
--     efeito líquido = rebate − rebate × (credito_pc_comissao / comissao)
--
-- 🔴 POR QUE A RAZÃO SOBREVIVE À DIFERENÇA DE UNIDADE (a armadilha desta
-- fase): `p_rebate` é o TOTAL do pedido (`sale_fee.rebate`, medido em
-- 223-01); `p_comissao` e `p_credito_pc_comissao` são POR UNIDADE
-- (`orders.comissao`/`orders.credito_pc_comissao`). A conta continua válida
-- porque `credito_pc_comissao / comissao` é uma RAZÃO ADIMENSIONAL — uma
-- alíquota — e os dois numeradores estão na MESMA base (`computeOrderTax`
-- recebe a comissão por unidade e devolve o crédito por unidade). O
-- resultado sai na unidade do PRIMEIRO argumento: TOTAL do pedido. Trocar
-- um dos dois por uma grandeza total quebraria a conta em silêncio — e é
-- exatamente esse tipo de troca que produziu o defeito ativo registrado em
-- `223-CONTRATO-SALE-FEE.md` (comissão gravada subestimada em todo pedido
-- de quantidade > 1).
--
-- Sem `credito_pc_comissao` (Simples Nacional, como a conta do Junior — não
-- há crédito a tomar) ou com comissão nula/zero, o crédito extra é ZERO e o
-- efeito líquido é o rebate CHEIO: a Simples Nacional, que não toma crédito,
-- perde o rebate inteiro.
--
-- ARGUMENTO NULO É AUSÊNCIA DE PARCELA, NUNCA ERRO: a função é declarada
-- `CALLED ON NULL INPUT` de propósito — mesma régua de `difal_efeito_liquido`
-- (222-15-R2). Com `STRICT`, um único insumo ausente faria a função inteira
-- devolver NULL, e um NULL somado a um total de loja vira total nulo, lido
-- como "sem rebate". O oposto do que se quer.
--
-- IMMUTABLE: o mesmo pedido não pode produzir dois custos. Sem `SET
-- search_path`, de propósito — a função não toca tabela nenhuma, e a
-- cláusula impediria o Postgres de embutir a expressão dentro das agregações
-- que a chamam linha a linha (mesmo desenho do arquivo gêmeo).
--
-- APLICAÇÃO É PORTÃO DO ORQUESTRADOR: este plano só escreve o arquivo.
-- Aplicar via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` (NUNCA
-- SQL Editor, NUNCA `supabase db push`) é passo do 223-08. Esta função
-- precisa existir ANTES das duas RPCs do 223-05 que a consomem.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rebate_efeito_liquido(
  p_rebate               numeric,  -- sale_fee.rebate — TOTAL do pedido
  p_comissao             numeric,  -- orders.comissao — POR UNIDADE
  p_credito_pc_comissao  numeric   -- orders.credito_pc_comissao — POR UNIDADE (régua da 222)
)
RETURNS numeric                    -- TOTAL do pedido, na unidade de p_rebate
LANGUAGE sql
IMMUTABLE
CALLED ON NULL INPUT
PARALLEL SAFE
AS $$
  SELECT
    COALESCE(p_rebate, 0)
    - CASE
        -- Comissão nula/zero, ou crédito ainda não gravado: nao há credito
        -- extra CONHECIDO, e "nao conhecido" é ZERO de desconto, jamais um
        -- desconto estimado. Nesses casos o efeito líquido é o rebate CHEIO
        -- (ex.: Simples Nacional, que não toma crédito de PIS/COFINS).
        WHEN p_comissao IS NULL OR p_comissao = 0 OR p_credito_pc_comissao IS NULL THEN 0
        ELSE COALESCE(p_rebate, 0) * (p_credito_pc_comissao / p_comissao)
      END;
$$;

COMMENT ON FUNCTION public.rebate_efeito_liquido(numeric, numeric, numeric) IS
  'Fase 223: custo liquido de PERDER o rebate = rebate menos o credito extra de PIS/COFINS que o rebate teria gerado sobre a comissao (credito_pc_comissao / comissao, razao adimensional). Fonte unica — somar o rebate cru sobre a margem pronta superestima o custo, no mesmo padrao do defeito de R$ 3,85/pedido que difal_efeito_liquido fechou (222-06-R/07-R). Sem credito (Simples Nacional) ou comissao zero, o efeito e o rebate cheio.';

GRANT EXECUTE ON FUNCTION public.rebate_efeito_liquido(numeric, numeric, numeric) TO authenticated;
