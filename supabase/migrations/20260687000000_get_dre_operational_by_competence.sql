-- Phase 87 — DRE de Resultado (fase 2/3): RPC de agregação dos custos operacionais por competência.
--
-- Retorna SÓ os blocos operacionais (fora do ML) agregados de public.cash_outflows por
-- competence_date (Phase 86) + mapa categoria→bloco. A margem (Receita − impostos − tarifas ML
-- − frete − CMV − ads) NÃO é re-derivada aqui — ela já é composta client-side no /vendas; a
-- Phase 88 junta as duas coisas.
--
-- APLICAR VIA Supabase MCP apply_migration em ckcdevcxgvueywivefgx. NUNCA supabase db push.
--
-- Anti-IDOR: SECURITY INVOKER — roda como o chamador; a RLS de cash_outflows (org) filtra as
-- linhas, então passar p_org_id de outra org retorna 0 (provado na 87-02).
-- Grafias das categorias confirmadas contra o banco vivo (2026-07-06) para evitar o mismatch
-- de string da Phase 85.
--
-- Empréstimo/Financeiro: retornado como financeiro_is_approximate=TRUE — o juro NÃO é separado
-- do principal aqui (aproximação SAC é frágil na carência). Pendente a tabela de amortização do
-- banco (Wesley). O frontend deve sinalizar "aproximado" nesse bloco.

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
        'ADS Shopee','Ads Magazine Luiza','Vendas Mercado Livre','Vendas Magalu'
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

REVOKE EXECUTE ON FUNCTION public.get_dre_operational_by_competence(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_operational_by_competence(uuid, date) TO authenticated;
