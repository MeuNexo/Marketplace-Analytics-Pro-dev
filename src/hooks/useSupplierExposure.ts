// ============================================================================
// useSupplierExposure — exposição por fornecedor via RPC get_supplier_exposure
// Retorna linhas {supplier, amount_30d, amount_60d, amount_90d}
// TESO-02
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface SupplierExposureRow {
  supplier:   string;
  amount_30d: number;
  amount_60d: number;
  amount_90d: number;
}

export function useSupplierExposure(topN: number = 10) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<SupplierExposureRow[]>({
    queryKey: ["cashflow", "supplier_exposure", orgId, topN] as const,
    enabled: !!orgId,
    staleTime: 3 * 60 * 1000,
    queryFn: async (): Promise<SupplierExposureRow[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase.rpc("get_supplier_exposure", {
        p_org_id: orgId,
        p_top_n:  topN,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        supplier:   String(r.supplier ?? ""),
        amount_30d: Number(r.amount_30d ?? 0),
        amount_60d: Number(r.amount_60d ?? 0),
        amount_90d: Number(r.amount_90d ?? 0),
      }));
    },
  });
}
