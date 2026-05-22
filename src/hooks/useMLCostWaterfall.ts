import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export interface CostWaterfallData {
  /** Receita bruta de pedidos pagos (paid/shipped/delivered) */
  paid_revenue: number;
  /** Receita de pedidos cancelados/devolvidos no período */
  cancelled_revenue: number;
  /** SUM(comissao) dos pedidos pagos */
  total_comissao: number;
  /** SUM(frete) dos pedidos pagos */
  total_frete: number;
  /** SUM(custo_unit * quantidade) dos pedidos pagos com custo_unit != null */
  cmv: number;
  /** true se ao menos 1 pedido pago tem custo_unit preenchido */
  has_cmv: boolean;
  /** SUM(tax_amount) dos pedidos pagos */
  total_tax: number;
  /** true se ao menos 1 pedido pago tem tax_amount > 0 */
  has_tax_data: boolean;
  /** Receita bruta por ml_user_id (para calcular impostos no caller) */
  revenue_per_store: Map<string, number>;
}

const PAID_STATUSES = ["paid", "shipped", "delivered"];
const CANCELLED_STATUSES = ["cancelled", "returned"];

export function useMLCostWaterfall(from: string, to: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<CostWaterfallData | null>({
    queryKey: ["ml", "cost-waterfall", orgId, resolvedMLUserIds, from, to],
    queryFn: async (): Promise<CostWaterfallData | null> => {
      if (!orgId || resolvedMLUserIds.length === 0) return null;

      const { data, error } = await supabase
        .from("orders")
        .select("receita_bruta, custo_unit, quantidade, frete, comissao, status, ml_user_id, tax_amount")
        .eq("organization_id", orgId)
        .in("ml_user_id", resolvedMLUserIds)
        .gte("data_pedido", from)
        .lte("data_pedido", to);

      if (error) throw error;

      const rows = data ?? [];
      if (rows.length === 0) return null;

      let paid_revenue = 0;
      let cancelled_revenue = 0;
      let total_comissao = 0;
      let total_frete = 0;
      let cmv = 0;
      let has_cmv = false;
      let total_tax = 0;
      let has_tax_data = false;
      const revenue_per_store = new Map<string, number>();

      for (const r of rows) {
        const receita = (r.receita_bruta as number | null) ?? 0;
        const status = (r.status as string | null) ?? "";
        const mlUserId = (r.ml_user_id as string | null) ?? "";

        if (PAID_STATUSES.includes(status)) {
          paid_revenue += receita;
          total_comissao += (r.comissao as number | null) ?? 0;
          total_frete += (r.frete as number | null) ?? 0;
          revenue_per_store.set(mlUserId, (revenue_per_store.get(mlUserId) ?? 0) + receita);

          const custo = r.custo_unit as number | null;
          const qty = (r.quantidade as number | null) ?? 1;
          if (custo != null) {
            has_cmv = true;
            cmv += custo * qty;
          }
          const tax = (r.tax_amount as number | null) ?? 0;
          if (tax > 0) has_tax_data = true;
          total_tax += tax;
        } else if (CANCELLED_STATUSES.includes(status)) {
          cancelled_revenue += receita;
        }
      }

      return {
        paid_revenue,
        cancelled_revenue,
        total_comissao,
        total_frete,
        cmv: Math.round(cmv * 100) / 100,
        has_cmv,
        total_tax: Math.round(total_tax * 100) / 100,
        has_tax_data,
        revenue_per_store,
      };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 5 * 60 * 1000,
  });
}
