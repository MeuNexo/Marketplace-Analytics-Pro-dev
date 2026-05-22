import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";

const PAID_STATUSES = ["paid", "shipped", "delivered"];

export function useMLProductMargins(dateFrom: string, dateTo: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["ml_product_margins", currentOrg?.id, resolvedMLUserIds, dateFrom, dateTo] as const,
    queryFn: async (): Promise<Map<string, number>> => {
      if (!currentOrg?.id || !resolvedMLUserIds.length) return new Map();

      const { data, error } = await supabase
        .from("orders")
        .select("item_id, receita_bruta, custo_unit, quantidade, comissao, frete")
        .eq("organization_id", currentOrg.id)
        .in("ml_user_id", resolvedMLUserIds)
        .in("status", PAID_STATUSES)
        .gte("data_pedido", dateFrom)
        .lte("data_pedido", dateTo)
        .not("item_id", "is", null)
        .not("custo_unit", "is", null);

      if (error) throw error;

      const acc = new Map<string, { receita: number; lucro: number }>();
      for (const r of data ?? []) {
        const receita = (r.receita_bruta as number) ?? 0;
        const custo = ((r.custo_unit as number) ?? 0) * ((r.quantidade as number) ?? 1);
        const comissao = (r.comissao as number) ?? 0;
        const frete = (r.frete as number) ?? 0;
        const lucro = receita - custo - comissao - frete;
        const existing = acc.get(r.item_id) ?? { receita: 0, lucro: 0 };
        acc.set(r.item_id, {
          receita: existing.receita + receita,
          lucro: existing.lucro + lucro,
        });
      }

      const result = new Map<string, number>();
      for (const [id, { receita, lucro }] of acc) {
        if (receita > 0) result.set(id, (lucro / receita) * 100);
      }
      return result;
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
