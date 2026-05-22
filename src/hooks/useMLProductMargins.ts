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

      // Busca pedidos com tax_amount incluído
      const { data: ordersData, error: ordersError } = await supabase
        .from("orders")
        .select("item_id, receita_bruta, custo_unit, quantidade, comissao, frete, tax_amount")
        .eq("organization_id", currentOrg.id)
        .in("ml_user_id", resolvedMLUserIds)
        .in("status", PAID_STATUSES)
        .gte("data_pedido", dateFrom)
        .lte("data_pedido", dateTo)
        .not("item_id", "is", null)
        .not("custo_unit", "is", null);

      if (ordersError) throw ordersError;

      // Spend real por item_id no período (série histórica com coluna date)
      const { data: adsData } = await supabase
        .from("ml_ads_products_cache")
        .select("item_id, spend")
        .eq("organization_id", currentOrg.id)
        .in("ml_user_id", resolvedMLUserIds)
        .gte("date", dateFrom)
        .lte("date", dateTo);

      const adsSpendByItem = new Map<string, number>();
      for (const r of adsData ?? []) {
        const prev = adsSpendByItem.get(r.item_id) ?? 0;
        adsSpendByItem.set(r.item_id, prev + (Number(r.spend) || 0));
      }

      // Agrega por item_id
      const acc = new Map<string, { receita: number; lucro: number }>();

      for (const r of ordersData ?? []) {
        const receita  = (r.receita_bruta as number) ?? 0;
        const custo    = ((r.custo_unit as number) ?? 0) * ((r.quantidade as number) ?? 1);
        const comissao = (r.comissao as number) ?? 0;
        const frete    = (r.frete as number) ?? 0;
        const imposto  = (r.tax_amount as number) ?? 0;
        const lucro    = receita - custo - comissao - frete - imposto;

        const existing = acc.get(r.item_id) ?? { receita: 0, lucro: 0 };
        acc.set(r.item_id, {
          receita: existing.receita + receita,
          lucro:   existing.lucro + lucro,
        });
      }

      // Desconta spend real de ads por produto
      const result = new Map<string, number>();
      for (const [id, { receita, lucro }] of acc) {
        if (receita <= 0) continue;
        const ads = adsSpendByItem.get(id) ?? 0;
        result.set(id, ((lucro - ads) / receita) * 100);
      }
      return result;
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
