-- Phase 97: contas canceladas no Tiny propagam como status='cancelled' e são
-- ignoradas por toda a leitura de DRE/custos.
--
-- Contexto (Wesley, 2026-07-16): a apuração de junho deu CRÉDITO de PIS/COFINS
-- — nenhuma guia foi emitida — e o dono cancelou as contas recorrentes no Tiny.
-- O pipeline achatava "cancelada" para 'pending' (EF sync-tiny-payables), o que:
--   (a) travava o gate de fechamento da DRE de junho para sempre;
--   (b) inflaria o imposto de junho em R$4.015,06 se fechasse;
--   (c) mantinha R$4.015,06 de saída fantasma na projeção de caixa.
-- A EF v8 passa a gravar 'cancelled'. Este migration:
--   1. amplia o CHECK de cash_outflows.status para aceitar 'cancelled';
--   2. exclui canceladas de get_dre_operational_by_competence (blocos da DRE);
--   3. exclui canceladas de get_dre_nao_classificado_items (gate visual);
--   4. exclui canceladas de get_cost_by_month (composição de custos).
-- get_cashflow / get_treasury_panel / get_supplier_exposure / get_rolled_opening_balance
-- já filtram explicitamente por 'paid'/'pending' — canceladas saem sozinhas.
-- get_imposto_guia_by_competence fica INTOCADA de propósito: ela devolve as
-- linhas COM status e o frontend (dreCloseGate/dreRegime) decide — a linha
-- cancelada continua visível para auditoria, só não bloqueia nem soma.
--
-- CREATE OR REPLACE em tudo (nunca DROP) — preserva as ACLs existentes.

-- 1. CHECK constraint aceita 'cancelled'
ALTER TABLE public.cash_outflows
  DROP CONSTRAINT IF EXISTS cash_outflows_status_check;
ALTER TABLE public.cash_outflows
  ADD CONSTRAINT cash_outflows_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text]));

-- 2. Blocos da DRE por competência: cancelada não é despesa
CREATE OR REPLACE FUNCTION public.get_dre_operational_by_competence(
  p_org_id uuid,
  p_month  date
)
RETURNS TABLE (
  bloco             text,
  category          text,
  total             numeric,
  n                 integer,
  double_count_risk boolean
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
      WHEN co.category IN ('Salários','Pró-labore','Pessoal - INSS')
        THEN 'pessoal'
      WHEN co.category IN ('Aluguéis e condomínio','Água, luz','Telecomunicação, internet')
        THEN 'estrutura'
      WHEN co.category IN ('Contabilidade','Serviços gerais')
        THEN 'servicos'
      WHEN co.category IN ('Insumos','Itens do CD','Impostos, taxas','Veículos, transportes','Cartão de crédito')
        THEN 'operacional'
      WHEN co.category = 'Empréstimo'
        THEN 'financeiro'
      WHEN co.category IN (
        'Fornecedores','Previsões de compra','Aporte',
        'ADS Mercado Livre','Prestação de serviço do Mercado Envios Full',
        'ADS Shopee','Ads Magazine Luiza','Vendas Mercado Livre','Vendas Magalu',
        'Reembolso cliente'
      ) THEN 'excluido'
      ELSE 'nao_classificado'
    END                                          AS bloco,
    co.category                                  AS category,
    sum(co.amount)                               AS total,
    count(*)::integer                            AS n,
    (co.category = 'Cartão de crédito')          AS double_count_risk
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.status <> 'cancelled'
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
          >= date_trunc('month', p_month)::date
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
          <  (date_trunc('month', p_month) + interval '1 month')::date
  GROUP BY 1, co.category
  ORDER BY 1, sum(co.amount) DESC;
$function$;

-- 3. Itens não classificados: cancelada não bloqueia nem aparece
CREATE OR REPLACE FUNCTION public.get_dre_nao_classificado_items(
  p_org_id uuid,
  p_month  date
)
RETURNS TABLE (
  outflow_date     date,
  competence_month date,
  description      text,
  supplier         text,
  category         text,
  amount           numeric,
  document_number  text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    co.outflow_date                                                        AS outflow_date,
    COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
                                                                             AS competence_month,
    co.description                                                         AS description,
    co.supplier                                                            AS supplier,
    co.category                                                            AS category,
    co.amount                                                              AS amount,
    co.document_number                                                     AS document_number
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.status <> 'cancelled'
    AND public.dre_bloco_for_category(co.category) = 'nao_classificado'
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
          >= date_trunc('month', p_month)::date
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
          <  (date_trunc('month', p_month) + interval '1 month')::date
  ORDER BY co.amount DESC;
$function$;

-- 4. Composição de custos por mês: cancelada não é custo
CREATE OR REPLACE FUNCTION public.get_cost_by_month(
  p_org_id uuid,
  p_months integer DEFAULT 9
)
RETURNS TABLE (
  month    text,
  category text,
  total    numeric
)
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  WITH base AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje)
  SELECT TO_CHAR(co.outflow_date, 'YYYY-MM'),
         COALESCE(NULLIF(TRIM(co.category), ''), 'Outros'),
         SUM(co.amount)
  FROM cash_outflows co, base
  WHERE co.organization_id = p_org_id
    AND co.status <> 'cancelled'
    AND co.outflow_date >= (DATE_TRUNC('month', base.hoje) - ((p_months - 1) || ' months')::INTERVAL)::date
    AND co.outflow_date <  (DATE_TRUNC('month', base.hoje) + INTERVAL '4 months')::date
  GROUP BY 1, 2 ORDER BY 1, 3 DESC;
$function$;
