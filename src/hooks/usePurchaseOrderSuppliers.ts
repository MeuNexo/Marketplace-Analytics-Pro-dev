import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

/**
 * Busca a lista de fornecedores distintos das ordens de compra da org via RPC.
 *
 * Alimenta o dropdown de "Por Fornecedor" no ReplenishmentParamsDialog.
 * Escopado por `currentOrg.id` (SECURITY INVOKER — sem fuga de tenant, FORN-04).
 *
 * @returns string[] com os nomes de fornecedor distintos das OCs da org.
 */
export function usePurchaseOrderSuppliers() {
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["get_purchase_order_suppliers", currentOrg?.id] as const,
    queryFn: async (): Promise<string[]> => {
      if (!currentOrg?.id) return [];
      const { data, error } = await supabase.rpc("get_purchase_order_suppliers", {
        p_org_id: currentOrg.id,
      });
      if (error) throw error;
      return (data ?? []).map((r: { fornecedor: string }) => r.fornecedor);
    },
    enabled: !!currentOrg?.id,
    staleTime: 5 * 60 * 1000,
  });
}
