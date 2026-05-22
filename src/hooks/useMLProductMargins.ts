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

      // Total de spend de publicidade no período (para alocação proporcional)
      const { data: adsData } = await supabase
        .from("ml_ads_daily_cache")
        .select("spend")
        .eq("organization_id", currentOrg.id)
        .in("ml_user_id", resolvedMLUserIds)
        .gte("date", dateFrom)
        .lte("date", dateTo);

      const totalAdsSpend = (adsData ?? []).reduce((s, r) => s + (Number(r.spend) || 0), 0);

      // Agrega por item_id
      const acc = new Map<string, { receita: number; lucro: number }>();
      let totalReceita = 0;

      for (const r of ordersData ?? []) {
        const receita   = (r.receita_bruta as number) ?? 0;
        const custo     = ((r.custo_unit as number) ?? 0) * ((r.quantidade as number) ?? 1);
        const comissao  = (r.comissao as number) ?? 0;
        const frete     = (r.frete as number) ?? 0;
        const imposto   = (r.tax_amount as number) ?? 0;
        // Publicidade é alocada depois, proporcionalmente
        const lucroParcial = receita - custo - comissao - frete - imposto;
        totalReceita += receita;

        const existing = acc.get(r.item_id) ?? { receita: 0, lucro: 0 };
        acc.set(r.item_id, {
          receita: existing.receita + receita,
          lucro:   existing.lucro + lucroParcial,
        });
      }

      // Aplica alocação proporcional de publicidade por produto
      const result = new Map<string, number>();
      for (const [id, { receita, lucro }] of acc) {
        if (receita <= 0) continue;
        const adsAlocado = totalReceita > 0 ? (receita / totalReceita) * totalAdsSpend : 0;
        const lucroFinal = lucro - adsAlocado;
        result.set(id, (lucroFinal / receita) * 100);
      }
      return result;
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
