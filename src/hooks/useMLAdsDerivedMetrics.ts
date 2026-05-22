import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { AdsProductStat } from "./useMLAds";

export interface EnrichedAdsProduct extends AdsProductStat {
  acos: number | null;
  cvr: number | null;
  share_ads_pct: number | null;
  acos_breakeven: number | null;
  seller_sku: string | null;
}

export interface AdsGlobalDerived {
  total_revenue: number;
  organic_revenue: number;
  tacos_global: number | null;
}

export function useMLAdsDerivedMetrics(
  products: AdsProductStat[],
  totalSpend: number,
  totalAttributedRevenue: number,
  dateFrom: string,
  dateTo: string,
) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  const { data: dailyCache } = useQuery({
    queryKey: ["ml_ads_daily_rev", currentOrg?.id, resolvedMLUserIds, dateFrom, dateTo] as const,
    queryFn: async () => {
      if (!currentOrg?.id) return { total_revenue: 0, total_orders: 0 };
      const { data } = await supabase
        .from("ml_daily_cache")
        .select("approved_revenue, qty_orders")
        .eq("organization_id", currentOrg.id)
        .in("ml_user_id", resolvedMLUserIds)
        .gte("date", dateFrom)
        .lte("date", dateTo);
      const total_revenue = (data ?? []).reduce((s, r) => s + ((r.approved_revenue as number) ?? 0), 0);
      const total_orders  = (data ?? []).reduce((s, r) => s + ((r.qty_orders as number) ?? 0), 0);
      return { total_revenue, total_orders };
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  const itemIds = products.map((p) => p.item_id).filter(Boolean);
  const { data: costsMap } = useQuery({
    queryKey: ["ml_ads_product_costs", currentOrg?.id, itemIds] as const,
    queryFn: async (): Promise<Map<string, { cost: number; sku: string | null }>> => {
      if (!currentOrg?.id || !itemIds.length) return new Map();
      const { data } = await supabase
        .from("ml_product_costs")
        .select("item_id, cost, seller_sku")
        .eq("organization_id", currentOrg.id)
        .in("item_id", itemIds)
        .not("cost", "is", null);
      const map = new Map<string, { cost: number; sku: string | null }>();
      for (const r of data ?? []) {
        map.set(r.item_id as string, {
          cost: r.cost as number,
          sku: (r.seller_sku as string | null) ?? null,
        });
      }
      return map;
    },
    enabled: !!currentOrg?.id && itemIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const total_revenue = dailyCache?.total_revenue ?? 0;
  const total_orders  = dailyCache?.total_orders ?? 0;

  const enriched: EnrichedAdsProduct[] = products.map((p) => {
    const acos = p.spend > 0 && p.attributed_revenue > 0
      ? Math.round((p.spend / p.attributed_revenue) * 10000) / 100
      : null;
    const cvr = p.clicks > 0
      ? Math.round((p.attributed_orders / p.clicks) * 10000) / 100
      : null;
    const share_ads_pct = total_orders > 0
      ? Math.round((p.attributed_orders / total_orders) * 10000) / 100
      : null;
    const costEntry = costsMap?.get(p.item_id);
    const unit_cost = costEntry?.cost ?? null;
    const seller_sku = costEntry?.sku ?? null;
    const avg_price = p.attributed_orders > 0 ? p.attributed_revenue / p.attributed_orders : 0;
    const acos_breakeven = unit_cost != null && avg_price > 0
      ? Math.round(((avg_price - unit_cost) / avg_price) * 10000) / 100
      : null;
    return { ...p, acos, cvr, share_ads_pct, acos_breakeven, seller_sku };
  });

  const organic_revenue = total_revenue > totalAttributedRevenue
    ? total_revenue - totalAttributedRevenue
    : 0;
  const tacos_global = total_revenue > 0 && totalSpend > 0
    ? Math.round((totalSpend / total_revenue) * 10000) / 100
    : null;

  const global: AdsGlobalDerived = { total_revenue, organic_revenue, tacos_global };

  return { enriched, global };
}
