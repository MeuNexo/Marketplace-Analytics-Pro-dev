import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";

export function useMLProductMargins(dateFrom: string, dateTo: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["ml_product_margins", currentOrg?.id, resolvedMLUserIds, dateFrom, dateTo] as const,
    queryFn: async (): Promise<Map<string, number>> => {
      if (!currentOrg?.id || !resolvedMLUserIds.length) return new Map();

      const { data, error } = await supabase.rpc("get_margin_with_ads_by_product", {
        p_org_id:   currentOrg.id,
        p_user_ids: resolvedMLUserIds,
        p_from:     dateFrom.substring(0, 10),
        p_to:       dateTo.substring(0, 10),
      });

      if (error) throw error;

      const result = new Map<string, number>();
      for (const r of data ?? []) {
        const hasCmv        = Boolean(r.has_cmv);
        const receita       = Number(r.receita);
        const lucroPos      = r.lucro_pct_pos_ads != null ? Number(r.lucro_pct_pos_ads) : null;

        if (hasCmv && receita > 0 && lucroPos != null) {
          result.set(String(r.item_id), lucroPos);
        }
      }
      return result;
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
