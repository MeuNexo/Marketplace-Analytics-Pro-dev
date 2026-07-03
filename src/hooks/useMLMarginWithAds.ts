import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface ProductMarginWithAds {
  item_id: string;
  titulo: string;
  sku: string | null;
  listing_type: string | null;
  receita: number;
  cmv: number;
  comissao: number;
  frete: number;
  impostos: number;
  /** Lucro operacional (sem publicidade) */
  lucro: number;
  /** Margem operacional em %, null quando receita = 0 */
  lucro_pct: number | null;
  pedidos: number;
  unidades: number;
  has_cmv: boolean;
  ads_spend: number;
  ads_attributed_orders: number;
  /** Lucro após dedução do gasto de publicidade do produto */
  lucro_pos_ads: number;
  /** Margem pós-ads em %, null quando receita = 0 */
  lucro_pct_pos_ads: number | null;
  /** true quando há gasto de ads mas nenhum pedido atribuído */
  ads_no_sale: boolean;
  /** Marca do anúncio (MAX(o.marca) agregado); null quando ausente. */
  marca: string | null;
}

export function useMLMarginWithAds(dateFrom: string, dateTo: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["ml_margin_with_ads", currentOrg?.id, resolvedMLUserIds, dateFrom, dateTo] as const,
    queryFn: async (): Promise<ProductMarginWithAds[]> => {
      if (!currentOrg?.id || !resolvedMLUserIds.length) return [];

      const { data, error } = await supabase.rpc("get_margin_with_ads_by_product", {
        p_org_id:   currentOrg.id,
        p_user_ids: resolvedMLUserIds,
        p_from:     dateFrom.substring(0, 10),
        p_to:       dateTo.substring(0, 10),
      });

      if (error) throw error;

      return (data ?? []).map((r: Record<string, unknown>) => ({
        item_id:               String(r.item_id),
        titulo:                String(r.titulo ?? ""),
        sku:                   r.sku ? String(r.sku) : null,
        listing_type:          r.listing_type ? String(r.listing_type) : null,
        receita:               Number(r.receita),
        cmv:                   Number(r.cmv),
        comissao:              Number(r.comissao),
        frete:                 Number(r.frete),
        impostos:              Number(r.impostos),
        lucro:                 Number(r.lucro),
        lucro_pct:             r.lucro_pct != null ? Number(r.lucro_pct) : null,
        pedidos:               Number(r.pedidos),
        unidades:              Number(r.unidades),
        has_cmv:               Boolean(r.has_cmv),
        ads_spend:             Number(r.ads_spend),
        ads_attributed_orders: Number(r.ads_attributed_orders),
        lucro_pos_ads:         Number(r.lucro_pos_ads),
        lucro_pct_pos_ads:     r.lucro_pct_pos_ads != null ? Number(r.lucro_pct_pos_ads) : null,
        ads_no_sale:           Boolean(r.ads_no_sale),
        marca:                 r.marca ? String(r.marca) : null,
      }));
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
