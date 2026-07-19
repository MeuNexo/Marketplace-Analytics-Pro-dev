// ============================================================================
// useImpostoGuiaReal — Phase 94 Plan 02, Task 3
//
// Two hooks that feed the APURAÇÃO branch of resolveDreRegime (src/lib/dreRegime.ts):
//
//  (a) useImpostoGuiaReal(saleMonth) — the M+1 shift (LOCKED design, CONTEXT.md
//      <db_reality>): sale-month M's real imposto = the guia with
//      competence_date = M+1 (ICMS de venda de junho é pago ~dia 21 de julho).
//      Calls the already-live RPC get_imposto_guia_by_competence at
//      monthPlusOne(saleMonth) — the RPC itself is NEVER modified.
//
//  (b) useImpostoGuiaNudge(saleMonth) — raw ingredients for the 3-signal
//      empurrãozinho (shouldNudgeClose in dreRegime.ts). The aggregated RPC
//      returns no outflow_date/amount, so this does a DIRECT RLS read of
//      cash_outflows scoped to exactly the 3 Imposto Venda categories across
//      [M, M+2) (covers both the M placeholder and the M+1 target). This is
//      NOT the broad/unbounded cash_outflows aggregation pattern flagged
//      PROIBIDO in useFinancialHealth.ts/useProjectedBalance.ts (that ban is
//      about summing large unbounded datasets client-side, risking silent
//      PostgREST 1000-row truncation) — this read is narrowly filtered to 3
//      categories × 2 months, expected to return a handful of rows, and is
//      never summed for a financial total here (only day/status/amount
//      comparisons for the display-only hint). cash_outflows RLS is already
//      org-scoped and anti-IDOR-proven for get_cashflow/get_dre_operational.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { monthPlusOne, IMPOSTO_VENDA_CATEGORIES } from "@/lib/dreRegime";
import type { GuiaRealCategoryTotal, NudgeRow } from "@/lib/dreRegime";

export type { GuiaRealCategoryTotal, NudgeRow };

/**
 * The M+1 real-tax source for the resolver.
 *
 * @param saleMonth "YYYY-MM-01" — the sale month M being displayed. The RPC
 *        is called at p_competence = monthPlusOne(saleMonth) (M+1).
 */
export function useImpostoGuiaReal(saleMonth: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const pCompetence = saleMonth ? monthPlusOne(saleMonth) : null;

  return useQuery<GuiaRealCategoryTotal[]>({
    queryKey: ["dre", "imposto-guia", orgId, pCompetence] as const,
    enabled: !!orgId && !!saleMonth,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<GuiaRealCategoryTotal[]> => {
      if (!orgId || !pCompetence) return [];

      const { data, error } = await supabase.rpc("get_imposto_guia_by_competence", {
        p_org_id: orgId,
        p_competence: pCompetence,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        category: String(r.category),
        total: Number(r.total ?? 0),
        status: String(r.status ?? ""),
      }));
    },
  });
}

/**
 * Raw cash_outflows rows across [M, M+2) for the 3 imposto categories — the
 * ingredients for all 3 empurrãozinho signals (shouldNudgeClose consumes
 * these directly, filtering by competenceMonth === targetCompetence for the
 * "target" side and via monthPlusOne for the "previous placeholder" side).
 *
 * @param saleMonth "YYYY-MM-01" — the sale month M being displayed.
 */
export function useImpostoGuiaNudge(saleMonth: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<NudgeRow[]>({
    queryKey: ["dre", "imposto-nudge", orgId, saleMonth] as const,
    enabled: !!orgId && !!saleMonth,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<NudgeRow[]> => {
      if (!orgId || !saleMonth) return [];

      const rangeStart = saleMonth;
      const rangeEnd = monthPlusOne(monthPlusOne(saleMonth)); // [M, M+2)

      const { data, error } = await supabase
        .from("cash_outflows")
        .select("category, amount, status, outflow_date, competence_date")
        .eq("organization_id", orgId)
        .in("category", IMPOSTO_VENDA_CATEGORIES as unknown as string[])
        .gte("competence_date", rangeStart)
        .lt("competence_date", rangeEnd)
        .limit(100);

      if (error) throw error;

      return (data ?? []).map((r: any) => ({
        category: String(r.category),
        amount: Number(r.amount ?? 0),
        status: String(r.status ?? ""),
        outflowDate: String(r.outflow_date ?? ""),
        // competence_date sempre 1º dia do mês (Pitfall 3) — normaliza pra "YYYY-MM-01".
        competenceMonth: String(r.competence_date ?? "").substring(0, 10),
      }));
    },
  });
}
