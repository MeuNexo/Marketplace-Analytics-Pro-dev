import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export interface MLKPISummary {
  markup_ratio: number | null;
  markup_has_cost: boolean;
  custo_plataforma: number;
  custo_operacional: number;
  pct_custo_operacional: number;
  gross_revenue: number;
  total_tax: number;
  has_tax_data: boolean;
  cmv: number;
  cmv_has_cost: boolean;
}

export function useMLKPISummary(
  from: string,
  to: string,
  ads_total: number,
) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<MLKPISummary | null>({
    queryKey: ["ml", "kpi-summary", orgId, resolvedMLUserIds, from, to],
    queryFn: async (): Promise<MLKPISummary | null> => {
      if (!orgId || resolvedMLUserIds.length === 0) return null;

      const { data, error } = await supabase.rpc("get_kpi_summary", {
        p_org_id:   orgId,
        p_user_ids: resolvedMLUserIds,
        p_from:     from.slice(0, 10),
        p_to:       to.slice(0, 10),
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;

      const gross_revenue  = Number(row.gross_revenue)  || 0;
      const total_frete    = Number(row.total_frete)    || 0;
      const total_comissao = Number(row.total_comissao) || 0;
      const total_tax      = Number(row.total_tax)      || 0;
      const cmv            = Number(row.cmv)            || 0;
      const has_tax_data   = Boolean(row.has_tax_data);
      const cmv_has_cost   = Boolean(row.cmv_has_cost);

      if (gross_revenue === 0 && cmv === 0 && total_frete === 0) return null;

      const markup_ratio = cmv_has_cost && cmv > 0 ? gross_revenue / cmv : null;
      const custo_plataforma = total_frete + total_comissao;
      const custo_operacional = custo_plataforma + ads_total;
      const pct_custo_operacional =
        gross_revenue > 0
          ? Math.round((custo_operacional / gross_revenue) * 10000) / 100
          : 0;

      return {
        markup_ratio,
        markup_has_cost: cmv_has_cost,
        custo_plataforma,
        custo_operacional,
        pct_custo_operacional,
        gross_revenue,
        total_tax,
        has_tax_data,
        cmv,
        cmv_has_cost,
      };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 5 * 60 * 1000,
  });
}
