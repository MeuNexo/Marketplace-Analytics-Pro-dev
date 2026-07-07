-- Phase 90 (imposto real / CMV cheio no fechamento) — Plan 90-01.
--
-- RPC NOVA, isolada de `get_dre_operational_by_competence` (Phase 87/88): aquela RPC soma
-- TODAS as linhas de impostos_venda por competência SEM filtrar `status` e alimenta o cálculo
-- do -R$29k de junho em `useDreOperational` — mexer nela arrisca a reconciliação da Phase 88.
--
-- Esta RPC devolve, por competência, uma linha por CATEGORIA x STATUS das guias
-- `Imposto Venda - ICMS/PIS/COFINS` de public.cash_outflows, expondo `status` (paid/pending)
-- e `total` — a granularidade que o frontend (Plans 90-03/90-04) precisa para aplicar:
--   (a) o gatilho de "mês fechado" = status='paid'
--   (b) a guarda de placeholder = toda categoria presente com total > ~R$1 (junho tem
--       PIS/COFINS = R$0,01, que é placeholder, NÃO guia real)
--
-- RÉGUA (decisão LOCKED do Wesley, ver 90-DATA-FINDINGS.md): a competência da guia é o mês do
-- PAGAMENTO, não da venda. Guia de competência C cobre as vendas de C-1. Portanto a DRE do mês
-- de venda S consulta esta RPC com competência S+1 (deslocamento aplicado pelo FRONTEND, não
-- aqui). A guarda de placeholder também é decidida pelo frontend — esta RPC só EXPÕE status e
-- valor por categoria; é uma fonte crua e testável, sem a régua nem a guarda embutidas.
--
-- APLICAR VIA Supabase MCP apply_migration em ckcdevcxgvueywivefgx. NUNCA supabase db push.
--
-- Anti-IDOR: SECURITY INVOKER — roda como o chamador; a RLS de cash_outflows (org) filtra as
-- linhas, então passar p_org_id de outra org retorna 0 (mesmo padrão da RPC da Phase 87).

CREATE OR REPLACE FUNCTION public.get_imposto_guia_by_competence(
  p_org_id     uuid,
  p_competence date
)
RETURNS TABLE (
  category text,
  total    numeric,
  status   text,
  n        integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    co.category                    AS category,
    sum(co.amount)                 AS total,
    co.status                      AS status,
    count(*)::integer              AS n
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.category IN ('Imposto Venda - ICMS','Imposto Venda - PIS','Imposto Venda - COFINS')
    AND co.competence_date >= date_trunc('month', p_competence)::date
    AND co.competence_date <  (date_trunc('month', p_competence) + interval '1 month')::date
  GROUP BY co.category, co.status
  ORDER BY co.category, co.status;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_imposto_guia_by_competence(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_imposto_guia_by_competence(uuid, date) TO authenticated;
