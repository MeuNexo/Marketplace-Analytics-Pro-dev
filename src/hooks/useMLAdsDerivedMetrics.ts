import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { AdsProductStat } from "./useMLAds";
import type { ProductMarginWithAds } from "./useMLMarginWithAds";

export interface EnrichedAdsProduct extends AdsProductStat {
  acos: number | null;
  cvr: number | null;
  /**
   * Gasto DESTE produto sobre a receita TOTAL da loja no período (Fase 213,
   * AV-10). Não é TACoS — TACoS é a métrica GLOBAL (gasto total da loja sobre
   * receita total da loja, no KPI "TACoS Global"). O corte de cor de 8% é a
   * régua do TACoS global e não faz sentido aplicado a um share por item; por
   * isso este campo é exibido sem semáforo.
   */
  spend_share_pct: number | null;
  /** Participação deste produto nos pedidos ATRIBUÍDOS a ads da loja no período. */
  share_ads_pct: number | null;
  /**
   * ACoS de equilíbrio (Fase 213, CR-02): a margem de CONTRIBUIÇÃO pré-ads do
   * anúncio no período — quanto de margem sobra antes da publicidade, depois
   * de CMV, comissão, frete e imposto. Indefinido (nunca 0, nunca um número
   * fictício) quando o anúncio não tem custo cadastrado ou não teve receita
   * no período.
   */
  acos_breakeven: number | null;
  seller_sku: string | null;
}

export interface AdsGlobalDerived {
  total_revenue: number;
  tacos_global: number | null;
}

/**
 * Métricas derivadas de publicidade, por produto e globais.
 *
 * `marginByItem` é o mapa de margem por `item_id` que a página já tem em mãos
 * via `useMLMarginWithAds` — é dele que sai o breakeven de ACoS (CR-02) e o
 * `seller_sku` (antes lidos de uma tabela de custos própria, agora uma fonte
 * a menos para divergir). Este hook não faz mais leitura própria de custo.
 */
export function useMLAdsDerivedMetrics(
  products: AdsProductStat[],
  totalSpend: number,
  dateFrom: string,
  dateTo: string,
  marginByItem: Map<string, ProductMarginWithAds>,
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

  const total_revenue = dailyCache?.total_revenue ?? 0;
  const total_orders  = dailyCache?.total_orders ?? 0;

  const enriched: EnrichedAdsProduct[] = products.map((p) => {
    const acos = p.spend > 0 && p.attributed_revenue > 0
      ? Math.round((p.spend / p.attributed_revenue) * 10000) / 100
      : null;
    const cvr = p.clicks > 0
      ? Math.round((p.attributed_orders / p.clicks) * 10000) / 100
      : null;
    const spend_share_pct = p.spend > 0 && total_revenue > 0
      ? Math.round((p.spend / total_revenue) * 10000) / 100
      : null;
    const share_ads_pct = total_orders > 0
      ? Math.round((p.attributed_orders / total_orders) * 10000) / 100
      : null;

    // CR-02: breakeven = margem de contribuição pré-ads (`lucro_pct`), nunca
    // margem bruta. Sem CMV cadastrado o `lucro_pct` da RPC sai inflado
    // (custo entra como zero) — usá-lo trocaria um número errado por outro,
    // então o breakeven fica indefinido. `lucro_pct` já é null quando a
    // receita do período é zero (mesma disciplina do has_cmv).
    const margin = marginByItem.get(p.item_id);
    const seller_sku = margin?.sku ?? null;
    const acos_breakeven = margin?.has_cmv && margin.lucro_pct != null
      ? Math.round(margin.lucro_pct * 100) / 100
      : null;

    return { ...p, acos, cvr, spend_share_pct, share_ads_pct, acos_breakeven, seller_sku };
  });

  const tacos_global = total_revenue > 0 && totalSpend > 0
    ? Math.round((totalSpend / total_revenue) * 10000) / 100
    : null;

  // AV-11: `organic_revenue` (receita aprovada − receita atribuída, grampeada
  // em zero) misturava dois reconhecimentos de receita diferentes (cache de
  // publicidade × pedidos) e não tinha nenhum consumidor (confirmado por
  // grep). Removido do retorno global.
  const global: AdsGlobalDerived = { total_revenue, tacos_global };

  return { enriched, global };
}
