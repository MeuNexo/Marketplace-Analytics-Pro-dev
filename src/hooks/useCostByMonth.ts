// ============================================================================
// useCostByMonth — composição de custos por mês via RPC get_cost_by_month
// Retorna linhas {month, category, total} para gráfico empilhado
// TESO-02
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface CostByMonthRaw {
  month:    string;   // "2026-04" (YYYY-MM)
  category: string;   // "Fornecedores" | "Salários" | ... | "Outros"
  total:    number;
}

export function useCostByMonth(months: number = 9) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<CostByMonthRaw[]>({
    queryKey: ["cashflow", "cost_by_month", orgId, months] as const,
    enabled: !!orgId,
    staleTime: 3 * 60 * 1000,
    queryFn: async (): Promise<CostByMonthRaw[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase.rpc("get_cost_by_month", {
        p_org_id: orgId,
        p_months: months,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        month:    String(r.month),
        category: String(r.category),
        total:    Number(r.total ?? 0),
      }));
    },
  });
}
