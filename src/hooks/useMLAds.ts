import { useState, useEffect, useCallback, useMemo } from "react";
import { format, subDays } from "date-fns";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdsDailyStat {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  attributed_revenue: number;
  attributed_orders: number;
  cpc: number;
  ctr: number;
  roas: number;
}

export interface AdsCampaign {
  id: string;
  name: string;
  status: "active" | "paused" | "ended";
  daily_budget: number;
  impressions: number;
  clicks: number;
  spend: number;
  attributed_revenue: number;
  attributed_orders: number;
  cpc: number;
  ctr: number;
  roas: number;
}

export interface AdsProductStat {
  item_id: string;
  title: string;
  thumbnail: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  attributed_revenue: number;
  attributed_orders: number;
  cpc: number;
  ctr: number;
  roas: number;
}

export interface AdsSummary {
  total_impressions: number;
  total_clicks: number;
  total_spend: number;
  total_attributed_revenue: number;
  total_attributed_orders: number;
  avg_cpc: number;
  avg_ctr: number;
  avg_roas: number;
  acos_global: number;
}

export function computeAdsSummary(daily: AdsDailyStat[]): AdsSummary {
  if (daily.length === 0) {
    return {
      total_impressions: 0, total_clicks: 0, total_spend: 0,
      total_attributed_revenue: 0, total_attributed_orders: 0,
      avg_cpc: 0, avg_ctr: 0, avg_roas: 0, acos_global: 0,
    };
  }
  const total_impressions = daily.reduce((s, d) => s + d.impressions, 0);
  const total_clicks      = daily.reduce((s, d) => s + d.clicks, 0);
  const total_spend       = Math.round(daily.reduce((s, d) => s + d.spend, 0) * 100) / 100;
  const total_attributed_revenue = Math.round(daily.reduce((s, d) => s + d.attributed_revenue, 0) * 100) / 100;
  const total_attributed_orders  = daily.reduce((s, d) => s + d.attributed_orders, 0);
  const avg_cpc  = total_clicks      > 0 ? Math.round((total_spend / total_clicks) * 100) / 100 : 0;
  const avg_ctr  = total_impressions > 0 ? Math.round((total_clicks / total_impressions) * 10000) / 100 : 0;
  const avg_roas = total_spend       > 0 ? Math.round((total_attributed_revenue / total_spend) * 100) / 100 : 0;
  const acos_global = total_attributed_revenue > 0
    ? Math.round((total_spend / total_attributed_revenue) * 10000) / 100
    : 0;
  return { total_impressions, total_clicks, total_spend, total_attributed_revenue, total_attributed_orders, avg_cpc, avg_ctr, avg_roas, acos_global };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseMLAdsOptions {
  daysBack?: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface UseMLAdsResult {
  daily: AdsDailyStat[];
  campaigns: AdsCampaign[];
  products: AdsProductStat[];
  summary: AdsSummary;
  loading: boolean;
  connected: boolean;
  isRealData: boolean;
  adsAvailable: boolean | null;
  lastUpdated: Date | null;
  sync: () => Promise<void>;
  syncNow: () => Promise<void>;
  syncing: boolean;
}

const EMPTY_SUMMARY = computeAdsSummary([]);
const ADS_SYNC_LS_KEY     = "ads_last_synced_ts";
const ADS_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

type MLAdsResponse = {
  adsAvailable: boolean;
  syncing?: boolean;   // true = a EF disparou o sync em background; dados chegam na próxima carga
  daily: AdsDailyStat[];
  campaigns: AdsCampaign[];
  products: AdsProductStat[];
};

export function useMLAds(opts: UseMLAdsOptions = {}): UseMLAdsResult {
  const { daysBack = 30, dateFrom, dateTo } = opts;
  const { stores, selectedStore, loading: storeLoading, scopeKey, hasMLConnection } = useMLStore();
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading]   = useState(false);
  const [syncing, setSyncing]   = useState(false);
  const [adsAvailable, setAdsAvailable] = useState<boolean | null>(null);
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);
  const [data, setData] = useState<{
    daily: AdsDailyStat[];
    campaigns: AdsCampaign[];
    products: AdsProductStat[];
    summary: AdsSummary;
  } | null>(null);

  const mlUserIds = useMemo(() => {
    if (selectedStore !== "all" && selectedStore) return [selectedStore];
    return stores.map((s) => s.ml_user_id);
  }, [selectedStore, stores]);

  const connected = stores.length > 0;

  const effectiveDateFrom = useMemo(() => {
    if (dateFrom) return dateFrom;
    return format(subDays(new Date(), daysBack - 1), "yyyy-MM-dd");
  }, [daysBack, dateFrom]);

  const effectiveDateTo = useMemo(() => {
    if (dateTo) return dateTo;
    return format(new Date(), "yyyy-MM-dd");
  }, [dateTo]);

  // Chama ml-ads edge function diretamente (sync síncrono ou leitura de cache)
  const fetchAdsData = useCallback(async (force = false) => {
    if (!user || mlUserIds.length === 0) return;
    force ? setSyncing(true) : setLoading(true);
    try {
      const results = await Promise.all(
        mlUserIds.map(async (ml_user_id) => {
          const { data: respData, error } = await supabase.functions.invoke("ml-ads", {
            body: {
              ml_user_id,
              date_from: effectiveDateFrom,
              date_to:   effectiveDateTo,
              ...(force && { force: true }),
            },
          });
          if (error) throw error;
          return respData as MLAdsResponse;
        })
      );

      // Agrega daily por data (múltiplas lojas)
      const dailyMap = new Map<string, AdsDailyStat>();
      for (const r of results) {
        for (const row of r.daily ?? []) {
          const ex = dailyMap.get(row.date);
          if (ex) {
            ex.impressions        += row.impressions        ?? 0;
            ex.clicks             += row.clicks             ?? 0;
            ex.spend              += row.spend              ?? 0;
            ex.attributed_revenue += row.attributed_revenue ?? 0;
            ex.attributed_orders  += row.attributed_orders  ?? 0;
          } else {
            dailyMap.set(row.date, { ...row });
          }
        }
      }
      const daily = Array.from(dailyMap.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(d => ({
          ...d,
          cpc:  d.clicks > 0      ? d.spend / d.clicks                  : 0,
          ctr:  d.impressions > 0 ? (d.clicks / d.impressions) * 100    : 0,
          roas: d.spend > 0       ? d.attributed_revenue / d.spend      : 0,
        }));

      const campaigns: AdsCampaign[] = results.flatMap(r => r.campaigns ?? []);

      // Agrega produtos por item_id (múltiplas lojas)
      const productMap = new Map<string, AdsProductStat>();
      for (const r of results) {
        for (const p of r.products ?? []) {
          const ex = productMap.get(p.item_id);
          if (ex) {
            ex.impressions        += p.impressions        ?? 0;
            ex.clicks             += p.clicks             ?? 0;
            ex.spend              += p.spend              ?? 0;
            ex.attributed_revenue += p.attributed_revenue ?? 0;
            ex.attributed_orders  += p.attributed_orders  ?? 0;
          } else {
            productMap.set(p.item_id, { ...p });
          }
        }
      }
      const products: AdsProductStat[] = Array.from(productMap.values()).map(p => ({
        ...p,
        cpc:  p.clicks > 0      ? p.spend / p.clicks                  : 0,
        ctr:  p.impressions > 0 ? (p.clicks / p.impressions) * 100    : 0,
        roas: p.spend > 0       ? p.attributed_revenue / p.spend      : 0,
      }));

      const summary = computeAdsSummary(daily);
      setData({ daily, campaigns, products, summary });
      setAdsAvailable(results.some(r => r.adsAvailable));
      setLastUpdated(new Date());

      if (force) {
        localStorage.setItem(ADS_SYNC_LS_KEY, String(Date.now()));
        const bgSyncing = results.some((r) => r.syncing);
        if (bgSyncing) {
          // A EF busca no ML em background (não trava mais a tela). Avisa e re-lê o
          // cache uma vez quando o sync provavelmente terminou, para refletir os dados.
          toast({ title: "Sincronizando publicidade", description: "Buscando no Mercado Livre em segundo plano — os dados atualizam em instantes." });
          window.setTimeout(() => { fetchAdsData(false); }, 15000);
        } else {
          toast({ title: "Publicidade sincronizada", description: "Dados atualizados com sucesso." });
        }
      }
    } catch (err: any) {
      console.error("useMLAds fetchAdsData error:", err);
      if (force) {
        toast({ title: "Erro ao sincronizar", description: err.message, variant: "destructive" });
      }
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [user, mlUserIds, effectiveDateFrom, effectiveDateTo, toast]);

  const refresh = useCallback(() => fetchAdsData(false), [fetchAdsData]);
  const syncNow = useCallback(() => fetchAdsData(true),  [fetchAdsData]);
  const sync    = syncNow;

  // Auto-sync no mount: força se >10min desde último sync, senão lê cache
  useEffect(() => {
    if (!user || mlUserIds.length === 0) return;
    const lastTs = Number(localStorage.getItem(ADS_SYNC_LS_KEY) ?? 0);
    fetchAdsData(Date.now() - lastTs > ADS_SYNC_COOLDOWN_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, scopeKey]);

  // Reset no troca de escopo
  useEffect(() => {
    setData(null);
    setAdsAvailable(null);
    setLastUpdated(null);
  }, [scopeKey]);

  // Recarrega ao mudar período de datas
  useEffect(() => {
    if (!hasMLConnection || stores.length === 0) return;
    fetchAdsData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores.length, scopeKey, effectiveDateFrom, effectiveDateTo]);

  return {
    daily:     data?.daily     ?? [],
    campaigns: data?.campaigns ?? [],
    products:  data?.products  ?? [],
    summary:   data?.summary   ?? EMPTY_SUMMARY,
    loading:   storeLoading || loading,
    connected,
    isRealData: data !== null,
    adsAvailable,
    lastUpdated,
    sync,
    syncNow,
    syncing,
  };
}
