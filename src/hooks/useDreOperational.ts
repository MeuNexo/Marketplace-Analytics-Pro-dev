// ============================================================================
// useDreOperational — react-query hook for get_dre_operational_by_competence
// Reduces RPC rows (bloco/category/total/n/financeiro_is_approximate) into
// DreOperationalBlocks via the pure aggregateOperationalBlocks() reducer.
//
// Phase: 88-dre-frontend-resultado-completo-vendas / Plan 01
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  aggregateOperationalBlocks,
  type DreOperationalRow,
  type DreOperationalBlocks,
} from "@/lib/dreOperational";

export function useDreOperational(month: string | null) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<DreOperationalBlocks>({
    queryKey: ["dre", "operational", orgId, month] as const,
    enabled: !!orgId && !!month,
    staleTime: 3 * 60 * 1000,
    queryFn: async (): Promise<DreOperationalBlocks> => {
      if (!orgId || !month) return aggregateOperationalBlocks([]);

      const { data, error } = await supabase.rpc("get_dre_operational_by_competence", {
        p_org_id: orgId,
        p_month: month,
      });

      if (error) throw error;
      const rows: DreOperationalRow[] = (data ?? []).map((r: any) => ({
        bloco: String(r.bloco),
        category: String(r.category),
        total: Number(r.total ?? 0),
        n: Number(r.n ?? 0),
        financeiro_is_approximate: Boolean(r.financeiro_is_approximate),
      }));

      return aggregateOperationalBlocks(rows);
    },
  });
}
