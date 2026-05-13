import { useState, useEffect, useCallback, useMemo } from "react";
import { format, subDays } from "date-fns";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

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
}

export function computeAdsSummary(daily: AdsDailyStat[]): AdsSummary {
  if (daily.length === 0) {
    return {
      total_impressions: 0, total_clicks: 0, total_spend: 0,
      total_attributed_revenue: 0, total_attributed_orders: 0,
      avg_cpc: 0, avg_ctr: 0, avg_roas: 0,
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
  return { total_impressions, total_clicks, total_spend, total_attributed_revenue, total_attributed_orders, avg_cpc, avg_ctr, avg_roas };
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface AdsCache {
  daily: AdsDailyStat[];
  campaigns: AdsCampaign[];
  products: AdsProductStat[];
  summary: AdsSummary;
  fetchedAt: number;
}
const adsCache = new Map<string, AdsCache>();
const CACHE_TTL_MS = 5 * 60 * 1000;

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
  sync: () => Promise<void>;
  syncing: boolean;
}

const EMPTY_SUMMARY = computeAdsSummary([]);

export function useMLAds(opts: UseMLAdsOptions = {}): UseMLAdsResult {
  const { daysBack = 30, dateFrom, dateTo } = opts;
  const { stores, selectedStore, loading: storeLoading, scopeKey, hasMLConnection } = useMLStore();
  const { user } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [realData, setRealData] = useState<{
    daily: AdsDailyStat[];
    campaigns: AdsCampaign[];
    products: AdsProductStat[];
    summary: AdsSummary;
  } | null>(null);
  const [isRealData, setIsRealData] = useState(false);
  const [adsAvailable, setAdsAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const targetStoreIds = useMemo(() => {
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

  const cacheKey = `${scopeKey}:${effectiveDateFrom}:${effectiveDateTo}`;

  const fetchOneStore = useCallback(async (
    targetStoreId: string,
    accessToken: string,
    force: boolean,
  ) => {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const params = new URLSearchParams({
      ml_user_id: targetStoreId,
      date_from: effectiveDateFrom,
      date_to: effectiveDateTo,
    });
    if (force) params.set("force", "true");

    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/ml-ads?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
        },
      },
    );
    if (!res.ok) return null;
    return res.json();
  }, [effectiveDateFrom, effectiveDateTo]);

  const fetchRealData = useCallback(async (force = false) => {
    if (!connected || !user || targetStoreIds.length === 0) return;

    const hasCachedData = !!(adsCache.get(cacheKey) && Date.now() - (adsCache.get(cacheKey)?.fetchedAt ?? 0) < CACHE_TTL_MS);
    if (!hasCachedData) setLoading(true);

    try {
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      if (!accessToken) return;

      const results = await Promise.all(
        targetStoreIds.map((id) => fetchOneStore(id, accessToken, force)),
      );

      const aggregated: { daily: AdsDailyStat[]; campaigns: AdsCampaign[]; products: AdsProductStat[] } = {
        daily: [], campaigns: [], products: [],
      };
      let anyAvailable = false;

      for (const result of results) {
        if (!result) continue;
        if (result.adsAvailable === true) anyAvailable = true;
        if (result.daily?.length) {
          for (const row of result.daily as AdsDailyStat[]) {
            const existing = aggregated.daily.find((d) => d.date === row.date);
            if (existing) {
              existing.impressions        = (existing.impressions        ?? 0) + (row.impressions        ?? 0);
              existing.clicks             = (existing.clicks             ?? 0) + (row.clicks             ?? 0);
              existing.spend              = (existing.spend              ?? 0) + (row.spend              ?? 0);
              existing.attributed_revenue = (existing.attributed_revenue ?? 0) + (row.attributed_revenue ?? 0);
              existing.attributed_orders  = (existing.attributed_orders  ?? 0) + (row.attributed_orders  ?? 0);
            } else {
              aggregated.daily.push({ ...row });
            }
          }
        }
        if (result.campaigns?.length) aggregated.campaigns.push(...result.campaigns);
        if (result.products?.length)  aggregated.products.push(...result.products);
      }

      setAdsAvailable(anyAvailable);

      const summary = computeAdsSummary(aggregated.daily);
      const cached: AdsCache = { ...aggregated, summary, fetchedAt: Date.now() };
      setRealData({ ...aggregated, summary });
      adsCache.set(cacheKey, cached);
      setIsRealData(true);
    } catch (err) {
      console.warn("ml-ads: Error fetching data", err);
    } finally {
      setLoading(false);
    }
  }, [connected, user, targetStoreIds, cacheKey, fetchOneStore]);

  // Reset ao trocar seller/store
  useEffect(() => {
    setRealData(null);
    setIsRealData(false);
    setAdsAvailable(null);
  }, [scopeKey]);

  // Auto-fetch
  useEffect(() => {
    if (!hasMLConnection) return;
    const cached = adsCache.get(cacheKey);
    const cacheValid = !!(cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS);
    if (cacheValid) {
      setRealData(cached);
      setIsRealData(true);
      return;
    }
    setRealData(null);
    setIsRealData(false);
    fetchRealData();
  }, [fetchRealData, cacheKey, hasMLConnection]);

  const sync = useCallback(async () => {
    if (!connected) return;
    setSyncing(true);
    await fetchRealData(true);
    setSyncing(false);
  }, [connected, fetchRealData]);

  return {
    daily:     realData?.daily     ?? [],
    campaigns: realData?.campaigns ?? [],
    products:  realData?.products  ?? [],
    summary:   realData?.summary   ?? EMPTY_SUMMARY,
    loading: storeLoading || loading,
    connected,
    isRealData,
    adsAvailable,
    sync,
    syncing,
  };
}
