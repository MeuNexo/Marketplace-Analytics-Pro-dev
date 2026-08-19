-- ──────────────────────────────────────────────────────────────────────────────
-- public.difal_efeito_liquido — o quanto entrar com o DIFAL efetivamente CUSTA,
-- em UMA definição só (Fase 222, plano 222-15-R2, FISC-04/FISC-07).
--
-- POR QUE ESTA FUNÇÃO EXISTE: até aqui esta aritmética vivia escrita à mão em
-- dois lugares — o resumo agregado de DIFAL no banco e o helper de cenários no
-- navegador (`src/lib/mcoCenarios.ts`). As duas RPCs de margem que este plano
-- altera precisariam de uma TERCEIRA e de uma QUARTA cópia, e é exatamente
-- assim que se reintroduz o defeito que o retrabalho 222-06-R/07-R fechou:
-- somar `difal_amount` por cima de `tax_amount` mostrava imposto MAIOR e MCO
-- MENOR que o real, medido em R$ 3,85 por pedido.
--
-- A RÉGUA, EM UMA FRASE: o DIFAL não custa o DIFAL cheio. Ele soma como débito
-- (junto com o FCP, que é parcela própria desde a D-R2-03), mas DERRUBA a base
-- do PIS/COFINS — porque a base do PIS/COFINS no cenário com DIFAL é
-- `base tributável − ICMS − DIFAL − FCP`. O custo real é a diferença:
--
--     efeito líquido = (DIFAL + FCP) − (PIS/COFINS sem DIFAL − PIS/COFINS com DIFAL)
--
-- ARGUMENTO NULO É AUSÊNCIA DE PARCELA, NUNCA ERRO: a função é declarada
-- `CALLED ON NULL INPUT` de propósito. Com `STRICT`, um único insumo ausente
-- faria a função inteira devolver NULL — e um NULL somado a um total de loja
-- vira total nulo, que a tela leria como "não há DIFAL". O oposto do que se
-- quer. Pedido gravado pela régua anterior a esta fase (sem
-- `pis_cofins_debito_com_difal`) entra com redução ZERO, não com redução
-- inventada a partir de um débito sozinho.
--
-- IMMUTABLE: o mesmo pedido não pode produzir dois custos. Sem `SET
-- search_path`, de propósito — a função não toca tabela nenhuma, e a cláusula
-- impediria o Postgres de embutir a expressão dentro das agregações que a
-- chamam linha a linha.
--
-- APLICAÇÃO É PORTÃO HUMANO (222-15-R2, Task 5): este plano SÓ escreve o
-- arquivo. Aplicar via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`
-- (NUNCA SQL Editor, NUNCA `supabase db push`) é passo do orquestrador, na
-- posição que a ordem consolidada da rodada R2 define. Esta função precisa
-- existir ANTES das três RPCs que a consomem.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.difal_efeito_liquido(
  p_difal               numeric,
  p_fcp                 numeric,
  p_pc_debito           numeric,
  p_pc_debito_com_difal numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
CALLED ON NULL INPUT
PARALLEL SAFE
AS $$
  SELECT
    COALESCE(p_difal, 0) + COALESCE(p_fcp, 0)
    - CASE
        -- Régua anterior a esta fase, ou pedido que o recálculo ainda não
        -- tocou: sem os DOIS débitos não há redução conhecida, e "não
        -- conhecida" é ZERO de desconto, jamais um desconto estimado.
        WHEN p_pc_debito IS NULL OR p_pc_debito_com_difal IS NULL THEN 0
        ELSE p_pc_debito - p_pc_debito_com_difal
      END;
$$;

COMMENT ON FUNCTION public.difal_efeito_liquido(numeric, numeric, numeric, numeric) IS
  'Fase 222: custo líquido de entrar com o DIFAL = (DIFAL + FCP) menos a queda do débito de PIS/COFINS que o próprio DIFAL provoca. Fonte única — somar difal_amount sobre tax_amount superestima o imposto em ~R$ 3,85/pedido (222-06-R/07-R).';

GRANT EXECUTE ON FUNCTION public.difal_efeito_liquido(numeric, numeric, numeric, numeric) TO authenticated;
