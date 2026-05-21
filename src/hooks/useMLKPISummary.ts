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
  total_tax: number;       // SUM(orders.tax_amount) para o período
  has_tax_data: boolean;   // true se ao menos 1 order com tax_amount > 0
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

      const { data, error } = await supabase
        .from("orders")
        .select("receita_bruta, custo_unit, quantidade, frete, comissao, tax_amount")
        .eq("organization_id", orgId)
        .in("ml_user_id", resolvedMLUserIds)
        .gte("data_pedido", from)
        .lte("data_pedido", to);

      if (error) throw error;

      const rows = data ?? [];
      if (rows.length === 0) return null;

      let sum_receita = 0;
      let sum_custo = 0;
      let markup_has_cost = false;

      for (const r of rows) {
        const receita = r.receita_bruta ?? 0;
        const custo = r.custo_unit;
        const qty = r.quantidade ?? 1;
        sum_receita += receita;
        if (custo != null) {
          markup_has_cost = true;
          sum_custo += custo * qty;
        }
      }

      const markup_ratio =
        markup_has_cost && sum_custo > 0 ? sum_receita / sum_custo : null;

      const total_tax = rows.reduce((s, r) => s + (r.tax_amount ?? 0), 0);
      const has_tax_data = rows.some((r) => (r.tax_amount ?? 0) > 0);

      const total_frete = rows.reduce((s, r) => s + (r.frete ?? 0), 0);
      const total_comissao = rows.reduce((s, r) => s + (r.comissao ?? 0), 0);
      const custo_plataforma = total_frete + total_comissao;
      const custo_operacional = custo_plataforma + ads_total;
      const gross_revenue = sum_receita;
      const pct_custo_operacional =
        gross_revenue > 0
          ? Math.round((custo_operacional / gross_revenue) * 10000) / 100
          : 0;

      return {
        markup_ratio,
        markup_has_cost,
        custo_plataforma,
        custo_operacional,
        pct_custo_operacional,
        gross_revenue,
        total_tax,
        has_tax_data,
      };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 5 * 60 * 1000,
  });
}
