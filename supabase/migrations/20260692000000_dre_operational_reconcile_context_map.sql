-- Phase 87: reconcile the drift-deployed get_dre_operational_by_competence(uuid, date)
-- to the CURRENT 87-CONTEXT.md (2026-07-08) category->bloco map.
--
-- Background: this exact RPC was already built and applied to THIS SAME production
-- project (ckcdevcxgvueywivefgx) on an unmerged branch (gsd/phase-86-dre-competencia,
-- 2026-07-06), using an OLDER category map (Cartao de credito excluido, no COALESCE
-- fallback on competence_date, financeiro_is_approximate column). This migration
-- reconciles that drifted body to Wesley's current LOCKED decisions:
--   1. Cartao de credito: excluido -> operacional, with a visible double_count_risk flag
--      (the embedded ML-fatura double-count is surfaced, never auto-netted).
--   2. competence_date NULL fallback: COALESCE(competence_date, date_trunc('month',
--      outflow_date)::date) on BOTH window bounds (~8.7% of 2026 rows have no
--      competence_date and must not be silently dropped).
--   3. Emprestimo: keep the FULL parcela sum (already correct); drop the now-misleading
--      financeiro_is_approximate column (nothing is approximated -- no SAC split).
--   4. Insumos/Itens do CD move servicos -> operacional; Servicos gerais added to
--      servicos; Impostos, taxas + Veiculos, transportes added to operacional.
--   5. pessoal gains Pro-labore; excluido gains Reembolso cliente; the ELSE catch-all
--      becomes a distinct visible 'nao_classificado' bloco (does not silently inflate
--      operacional; folds today's 0-row Outros).
--
-- Because the RETURNS TABLE column set changes (financeiro_is_approximate is replaced
-- by double_count_risk), a plain CREATE OR REPLACE would raise 42P13 "cannot change
-- return type of existing function" -- so this file DROPs then CREATEs. The DROP is
-- safe: nothing in `main` consumes this function yet (Phase 88 frontend is not built).
--
-- Apply ONLY via Supabase MCP `apply_migration` on project ckcdevcxgvueywivefgx
-- (NOT the CLAUDE.md project id, NOT `supabase db push` -- no CLI token for this repo).
-- Timestamp 20260692000000 is chosen to sit above the highest migration filename seen
-- in either the `main` line (max 20260690000100) or the unmerged sibling branch
-- (max 20260690000200), per 87-RESEARCH.md Pitfall 1.

DROP FUNCTION IF EXISTS public.get_dre_operational_by_competence(uuid, date);

CREATE FUNCTION public.get_dre_operational_by_competence(
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
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
          >= date_trunc('month', p_month)::date
    AND COALESCE(co.competence_date, date_trunc('month', co.outflow_date)::date)
          <  (date_trunc('month', p_month) + interval '1 month')::date
  GROUP BY 1, co.category
  ORDER BY 1, sum(co.amount) DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_operational_by_competence(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_operational_by_competence(uuid, date) TO authenticated;
