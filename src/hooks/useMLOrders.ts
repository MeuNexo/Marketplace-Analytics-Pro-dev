/**
 * useMLOrders — aggregates real comissao/frete/paid-count from public.orders
 * Used by MercadoLivre.tsx to replace hardcoded 11%/5% cost estimates.
 */
import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export interface MLOrderSummary {
  total_comissao: number;
  total_frete: number;
  paid_orders_count: number;
  paid_revenue: number;
}

/**
 * Returns null (no data signal) when orders table has no rows for the period —
 * callers fall back to hardcoded percentages in that case.
 */
export function useMLOrders(from: string, to: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<MLOrderSummary | null>({
    queryKey: ["ml", "orders-summary", orgId, resolvedMLUserIds, from, to],
    queryFn: async (): Promise<MLOrderSummary | null> => {
      if (!orgId || resolvedMLUserIds.length === 0) return null;

      const { data, error } = await supabase
        .from("orders")
        .select("comissao, frete, status, preco_unit, quantidade")
        .eq("organization_id", orgId)
        .in("ml_user_id", resolvedMLUserIds)
        .gte("data_pedido", from)
        .lte("data_pedido", to);

      if (error) throw error;

      const rows = data ?? [];

      // Return null (no-data signal) when table has no rows for this period.
      // Caller falls back to hardcoded percentages.
      if (rows.length === 0) return null;

      const total_comissao = rows.reduce((s, r) => s + (r.comissao ?? 0), 0);
      const total_frete = rows.reduce((s, r) => s + (r.frete ?? 0), 0);

      const paidRows = rows.filter((r) => r.status === "paid");
      const paid_orders_count = paidRows.length;
      const paid_revenue = paidRows.reduce(
        (s, r) => s + (r.preco_unit ?? 0) * (r.quantidade ?? 1),
        0,
      );

      return { total_comissao, total_frete, paid_orders_count, paid_revenue };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 5 * 60 * 1000,
  });
}
