// ============================================================================
// useProjectedBalance — projeção de saldo via RPC get_projected_balance_summary
// Fonte ÚNICA de confirmed_income / total_expenses para useFinancialHealth
// (proibido select direto em cash_inflows/cash_outflows — risco truncamento)
// CASH-05
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface ProjectedBalanceData {
  current_balance: number;
  pessimistic_balance: number;
  realistic_balance: number;
  critical_date: string | null;
  min_balance: number;
  /** Entradas confirmadas nos próximos 30d (use via useFinancialHealth — não select direto) */
  confirmed_income: number;
  /** Saídas totais nos próximos 30d (use via useFinancialHealth — não select direto) */
  total_expenses: number;
}

/** Quantidade de dias de projeção passados para o RPC */
const DEFAULT_PROJECTION_DAYS = 120;

export function useProjectedBalance(projectionDays: number = DEFAULT_PROJECTION_DAYS) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<ProjectedBalanceData | null>({
    queryKey: ["cashflow", "projected_balance", orgId, projectionDays] as const,
    enabled: !!orgId,
    staleTime: 3 * 60 * 1000,
    queryFn: async (): Promise<ProjectedBalanceData | null> => {
      if (!orgId) return null;

      const { data, error } = await supabase.rpc("get_projected_balance_summary", {
        p_org_id:         orgId,
        p_projection_days: projectionDays,
      });

      if (error) throw error;

      const r = data?.[0];
      if (!r) return null;

      return {
        current_balance:    Number(r.current_balance    ?? 0),
        pessimistic_balance: Number(r.pessimistic_balance ?? 0),
        realistic_balance:   Number(r.realistic_balance   ?? 0),
        critical_date:       r.critical_date ? String(r.critical_date) : null,
        min_balance:        Number(r.min_balance         ?? 0),
        confirmed_income:   Number(r.confirmed_income    ?? 0),
        total_expenses:     Number(r.total_expenses      ?? 0),
      };
    },
  });
}
