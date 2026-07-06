-- Phase 87 refino (aplicado via MCP 2026-07-06): 'Cartão de crédito' → bloco EXCLUIDO.
-- Motivo (confirmado c/ Wesley): a fatura do cartão contém o billing do Mercado Livre (já
-- contado nas tarifas do DRE atual) + custos já lançados em outras categorias → contá-la
-- duplicaria (principalmente o ML). Cartão é forma de pagamento, não custo.
-- Corpo idêntico ao 20260687000000, só movendo 'Cartão de crédito' para a lista de excluídos.

CREATE OR REPLACE FUNCTION public.get_dre_operational_by_competence(
  p_org_id uuid,
  p_month  date
)
RETURNS TABLE (
  bloco                     text,
  category                  text,
  total                     numeric,
  n                         integer,
  financeiro_is_approximate boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN co.category IN ('Imposto Venda - ICMS','Imposto Venda - PIS','Imposto Venda - COFINS')
        THEN 'impostos_venda'
      WHEN co.category IN ('Salários','Pessoal - INSS')
        THEN 'pessoal'
      WHEN co.category IN ('Aluguéis e condomínio','Água, luz','Telecomunicação, internet')
        THEN 'estrutura'
      WHEN co.category IN ('Contabilidade','Insumos','Itens do CD')
        THEN 'servicos'
      WHEN co.category = 'Empréstimo'
        THEN 'financeiro'
      WHEN co.category IN (
        'Fornecedores','Previsões de compra','Aporte',
        'ADS Mercado Livre','Prestação de serviço do Mercado Envios Full',
        'ADS Shopee','Ads Magazine Luiza','Vendas Mercado Livre','Vendas Magalu',
        'Cartão de crédito'
      ) THEN 'excluido'
      ELSE 'outros_operacionais'
    END                                        AS bloco,
    co.category                                AS category,
    sum(co.amount)                             AS total,
    count(*)::integer                          AS n,
    (co.category = 'Empréstimo')               AS financeiro_is_approximate
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.competence_date >= date_trunc('month', p_month)::date
    AND co.competence_date <  (date_trunc('month', p_month) + interval '1 month')::date
  GROUP BY 1, co.category
  ORDER BY 1, sum(co.amount) DESC;
$function$;
