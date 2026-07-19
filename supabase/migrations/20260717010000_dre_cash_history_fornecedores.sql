-- Phase 99 (DRE Caixa) — fix pós-checkpoint de verificação visual, 2026-07-16.
--
-- Decisão do dono (Wesley), registrada em 99-CONTEXT.md "Régua de saídas":
-- "Nessa DRE não é para excluir fornecedores — fornecedor também é saída."
-- O bloco `excluido` (categoria Tiny "Fornecedores", mapeada por
-- dre_bloco_for_category) era herdado do filtro da DRE por competência e
-- ficava fora do histórico de saídas da DRE Caixa. Na DRE Caixa, todo
-- pagamento é saída — fornecedores agora somam.
--
-- CREATE OR REPLACE (NUNCA DROP — DROP apaga a ACL, lição crítica do
-- projeto: feedback_drop_function_apaga_acl.md). Corpo idêntico ao de
-- 20260717000000_dre_cash_rpcs.sql, com UMA mudança: a CTE
-- `outflows_por_mes` deixa de filtrar `dre_bloco_for_category(co.category)
-- <> 'excluido'` — fornecedores agora entram na soma de saídas do
-- histórico de 12 meses. get_dre_cash e get_dre_cash_items não mudam aqui:
-- já retornavam o bloco `excluido` cru; o filtro/rótulo é responsabilidade
-- da lib pura do frontend (dreCashCascade.ts), corrigida no mesmo commit
-- deste fix.
--
-- Aplicar via Supabase MCP apply_migration no projeto ckcdevcxgvueywivefgx
-- — NUNCA supabase db push, NUNCA SQL Editor. Conferir max(version) vivo
-- antes de aplicar (lição 2026-07-13).

CREATE OR REPLACE FUNCTION public.get_dre_cash_history(
  p_org_id uuid,
  p_months integer
)
RETURNS TABLE (
  mes       date,
  entradas  numeric,
  saidas    numeric,
  resultado numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH params AS MATERIALIZED (
    SELECT
      LEAST(GREATEST(p_months, 1), 12)                                          AS v_meses,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date                            AS hoje,
      (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        - ((LEAST(GREATEST(p_months, 1), 12) - 1) || ' months')::interval)::date AS range_ini
  ),
  meses AS MATERIALIZED (
    SELECT (date_trunc('month', p.hoje) - (gs || ' months')::interval)::date AS mes
    FROM params p, generate_series(0, p.v_meses - 1) AS gs
  ),
  inflows_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', ci.release_date)::date AS mes,
      COALESCE(SUM(ci.net_amount), 0)             AS entradas
    FROM public.cash_inflows ci
    CROSS JOIN params p
    WHERE ci.organization_id = p_org_id
      AND ci.release_date >= p.range_ini
      AND ci.release_date <= p.hoje
    GROUP BY 1
  ),
  outflows_por_mes AS MATERIALIZED (
    SELECT
      date_trunc('month', co.outflow_date)::date AS mes,
      COALESCE(SUM(co.amount), 0)                 AS saidas
    FROM public.cash_outflows co
    CROSS JOIN params p
    WHERE co.organization_id = p_org_id
      AND co.status = 'paid'
      AND co.outflow_date >= p.range_ini
      -- [FIX 2026-07-16] Fornecedores (bloco `excluido`) somam como saída na
      -- DRE Caixa — decisão do dono no checkpoint da Phase 99. Filtro
      -- `<> 'excluido'` removido de propósito (era herança da DRE por
      -- competência, onde excluido é dedup de dupla-contagem, não aqui).
    GROUP BY 1
  )
  SELECT
    m.mes,
    COALESCE(i.entradas, 0)                        AS entradas,
    COALESCE(o.saidas, 0)                           AS saidas,
    COALESCE(i.entradas, 0) - COALESCE(o.saidas, 0) AS resultado
  FROM meses m
  LEFT JOIN inflows_por_mes  i ON i.mes = m.mes
  LEFT JOIN outflows_por_mes o ON o.mes = m.mes
  ORDER BY m.mes;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dre_cash_history(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dre_cash_history(uuid, integer) TO authenticated;
