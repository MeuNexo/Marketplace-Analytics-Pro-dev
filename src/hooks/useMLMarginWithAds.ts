// ============================================================================
// useMLMarginWithAds — margem por anúncio, com publicidade na régua da fatura
//
// Fase 212: o campo `ads_spend` que sai daqui NÃO é mais o gasto do relatório
// de publicidade (`ml_ads_products_cache`) que a RPC devolve. É o total que o
// Mercado Livre cobrou na fatura (`ml_billing_daily`, PADS+BPAD) rateado entre
// os anúncios pela proporção do cache — a mesma régua da fase 211, aqui
// aplicada à carteira inteira do período (`ratearAdsDaCarteira`).
//
// Por que a troca: o cache subestima o gasto real (Pé Vermeio, 05/07 a 04/08:
// R$ 14.790,21 no cache contra R$ 9.474,36 cobrados — e por anúncio a
// diferença chega a inverter o sinal da decisão). As telas de RESULTADO
// (Produtos Vendidos, Catálogo de Anúncios, Margem) passam a ler o número que
// o ML cobrou; as telas de PERFORMANCE de campanha (Publicidade, ROAS, CTR,
// CPC) continuam no cache, porque a fatura não tem campanha (ADS-05).
//
// `lucro_pos_ads` e `lucro_pct_pos_ads` são recalculados aqui a partir do
// `lucro` da RPC (que é pré-ads e não muda) menos o ads rateado. A fórmula do
// MCO (`src/lib/mco.ts`) não muda — muda apenas quem preenche o campo `ads`.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { aggregateAdsBillingSpend } from "@/lib/adsBillingSpend";
import { ratearAdsDaCarteira, type RateioAnuncioSource } from "@/lib/adsRateio";
import { fetchAdsBillingRows } from "./useMLAdsBillingSpend";

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

/**
 * De onde veio a publicidade das linhas, e quanto da fatura ficou sem dono.
 * A tela é obrigada a dizer isso: a troca de régua nunca acontece escondida.
 */
export interface AdsCarteiraMeta {
  /** `billing-rateio` = fatura do ML rateada; `cache` = relatório de publicidade. */
  source: RateioAnuncioSource;
  /** Total de publicidade da fatura no período (0 no ramo de cache). */
  totalFatura: number;
  /** Parte da fatura que nenhum anúncio pôde receber (período sem chave). */
  naoRateado: number;
}

export interface MarginWithAdsResult {
  rows: ProductMarginWithAds[];
  ads: AdsCarteiraMeta;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const SEM_ADS: AdsCarteiraMeta = { source: "cache", totalFatura: 0, naoRateado: 0 };

export function useMLMarginWithAds(dateFrom: string, dateTo: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  return useQuery<MarginWithAdsResult>({
    queryKey: ["ml_margin_with_ads", currentOrg?.id, resolvedMLUserIds, dateFrom, dateTo] as const,
    queryFn: async (): Promise<MarginWithAdsResult> => {
      if (!currentOrg?.id || !resolvedMLUserIds.length) return { rows: [], ads: SEM_ADS };

      const from = dateFrom.substring(0, 10);
      const to = dateTo.substring(0, 10);

      // A fatura e a margem são lidas em paralelo — a fatura usa EXATAMENTE a
      // mesma leitura da fase 210/211 (`fetchAdsBillingRows`), nunca uma cópia.
      const [margem, faturaRows] = await Promise.all([
        supabase.rpc("get_margin_with_ads_by_product", {
          p_org_id:   currentOrg.id,
          p_user_ids: resolvedMLUserIds,
          p_from:     from,
          p_to:       to,
        }),
        fetchAdsBillingRows(currentOrg.id, resolvedMLUserIds, from, to),
      ]);

      const { data, error } = margem;
      if (error) throw error;

      const brutas: ProductMarginWithAds[] = (data ?? []).map((r: Record<string, unknown>) => ({
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

      // O denominador do rateio é a carteira INTEIRA do período — inclusive os
      // anúncios que só tiveram gasto e nenhuma venda. Filtrar antes (como a
      // tela Produtos Vendidos faz depois) inflaria a fatia de quem vendeu.
      const rateio = ratearAdsDaCarteira(
        aggregateAdsBillingSpend(faturaRows),
        brutas.map((r) => ({ itemId: r.item_id, cacheSpend: r.ads_spend })),
      );

      const rows = brutas.map((r) => {
        const ads = rateio.porItem.get(r.item_id) ?? 0;
        const lucroPosAds = r.lucro - ads;
        return {
          ...r,
          ads_spend:         ads,
          lucro_pos_ads:     lucroPosAds,
          lucro_pct_pos_ads: r.receita > 0 ? round2((lucroPosAds / r.receita) * 100) : null,
          ads_no_sale:       ads > 0 && r.ads_attributed_orders === 0,
        };
      });

      return {
        rows,
        ads: {
          source: rateio.source,
          totalFatura: rateio.totalFatura,
          naoRateado: rateio.naoRateado,
        },
      };
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
