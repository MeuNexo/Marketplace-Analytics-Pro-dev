-- Phase 98 (INSS de folha na DRE deve seguir a régua M+1) — Plan 98-01.
--
-- RPC NOVA, IRMÃ de `get_imposto_guia_by_competence` (Phase 90, molde clonado
-- literalmente aqui) — NUNCA modificar aquela RPC, ela tem múltiplos
-- consumidores vivos (ICMS/PIS/COFINS).
--
-- Devolve dado CRU (category × status × total × n) por competência, para a
-- categoria única `Pessoal - INSS`, SEM nenhum deslocamento de mês embutido —
-- a régua M+1 é aplicada pelo FRONTEND (hook `useInssGuiaReal`, Plano 98-02),
-- nunca aqui. Mesma filosofia de `get_imposto_guia_by_competence`: expor
-- status e total, deixar o frontend decidir o que é crédito (cancelled) e o
-- que soma (paid/pending).
--
-- Decisão travada por Wesley em 2026-07-16 (98-CONTEXT.md): o INSS de folha
-- segue a MESMA régua de competência deslocada (M+1) que ICMS/PIS/COFINS já
-- seguem — a guia de INSS que sai/vence no mês M+1 é o encargo sobre a folha
-- do mês M.
--
-- NUMERAÇÃO: esta migration precisa ser numerada ACIMA do max(version) real
-- de prod — reconfirmado via MCP list_migrations antes de aplicar (Task 2
-- deste plano faz essa reconfirmação ao vivo; o addendum do 98-RESEARCH.md
-- achou 20260716172353 numa sessão anterior, mas isso pode ter mudado).
--
-- APLICAR VIA Supabase MCP apply_migration em ckcdevcxgvueywivefgx. NUNCA
-- supabase db push, NUNCA SQL Editor.
--
-- Anti-IDOR: SECURITY INVOKER (nunca DEFINER) — a RLS de cash_outflows
-- (já org-scoped, já anti-IDOR provada nas Phases 87/94/96) faz o isolamento;
-- p_org_id de uma org alheia devolve 0 linhas pela RLS, não por lógica desta
-- função.

CREATE OR REPLACE FUNCTION public.get_inss_guia_by_competence(
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
    AND co.category = 'Pessoal - INSS'
    AND co.competence_date >= date_trunc('month', p_competence)::date
    AND co.competence_date <  (date_trunc('month', p_competence) + interval '1 month')::date
  GROUP BY co.category, co.status
  ORDER BY co.category, co.status;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_inss_guia_by_competence(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_inss_guia_by_competence(uuid, date) TO authenticated;
