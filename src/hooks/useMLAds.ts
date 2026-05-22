import { useState, useEffect, useCallback, useMemo } from "react";
import { format, subDays } from "date-fns";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
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

export function useMLAds(opts: UseMLAdsOptions = {}): UseMLAdsResult {
  const { daysBack = 30, dateFrom, dateTo } = opts;
  const { stores, selectedStore, loading: storeLoading, scopeKey, hasMLConnection } = useMLStore();
  const { user } = useAuth();
  const { currentOrg } = useOrganization();
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

  const ADS_SYNC_LS_KEY = "ads_last_synced_ts";
  const ADS_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

  const connected = stores.length > 0;

  const effectiveDateFrom = useMemo(() => {
    if (dateFrom) return dateFrom;
    return format(subDays(new Date(), daysBack - 1), "yyyy-MM-dd");
  }, [daysBack, dateFrom]);

  const effectiveDateTo = useMemo(() => {
    if (dateTo) return dateTo;
    return format(new Date(), "yyyy-MM-dd");
  }, [dateTo]);

  // Read from cache tables (DB-first — no live ML API calls)
  const refresh = useCallback(async () => {
    if (!user || mlUserIds.length === 0) return;
    setLoading(true);
    try {
      const [dailyRes, campaignsRes, productsRes] = await Promise.all([
        supabase
          .from("ml_ads_daily_cache")
          .select("*")
          .in("ml_user_id", mlUserIds)
          .gte("date", effectiveDateFrom)
          .lte("date", effectiveDateTo),
        supabase
          .from("ml_ads_campaigns_cache")
          .select("*")
          .in("ml_user_id", mlUserIds),
        supabase
          .from("ml_ads_products_cache")
          .select("*")
          .in("ml_user_id", mlUserIds)
          .gte("date", effectiveDateFrom)
          .lte("date", effectiveDateTo),
      ]);

      if (dailyRes.error) throw dailyRes.error;
      if (campaignsRes.error) throw campaignsRes.error;
      if (productsRes.error) throw productsRes.error;

      const dailyRows = dailyRes.data ?? [];
      const campaignRows = campaignsRes.data ?? [];
      const productRows = productsRes.data ?? [];

      // Aggregate daily rows by date (multiple stores)
      const dailyMap = new Map<string, AdsDailyStat>();
      for (const row of dailyRows) {
        const existing = dailyMap.get(row.date);
        if (existing) {
          existing.impressions        += row.impressions        ?? 0;
          existing.clicks             += row.clicks             ?? 0;
          existing.spend              += row.spend              ?? 0;
          existing.attributed_revenue += row.attributed_revenue ?? 0;
          existing.attributed_orders  += row.attributed_orders  ?? 0;
        } else {
          dailyMap.set(row.date, {
            date:                row.date,
            impressions:         row.impressions        ?? 0,
            clicks:              row.clicks             ?? 0,
            spend:               row.spend              ?? 0,
            attributed_revenue:  row.attributed_revenue ?? 0,
            attributed_orders:   row.attributed_orders  ?? 0,
            cpc:                 row.cpc                ?? 0,
            ctr:                 row.ctr                ?? 0,
            roas:                row.roas               ?? 0,
          });
        }
      }
      const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      const campaigns: AdsCampaign[] = campaignRows.map((r) => ({
        id:                  r.campaign_id,
        name:                r.name ?? "",
        status:              (r.status as AdsCampaign["status"]) ?? "ended",
        daily_budget:        r.daily_budget     ?? 0,
        impressions:         r.impressions      ?? 0,
        clicks:              r.clicks           ?? 0,
        spend:               r.spend            ?? 0,
        attributed_revenue:  r.attributed_revenue ?? 0,
        attributed_orders:   r.attributed_orders  ?? 0,
        cpc:                 r.cpc  ?? 0,
        ctr:                 r.ctr  ?? 0,
        roas:                r.roas ?? 0,
      }));

      // Aggregate per item_id — sync-ads v10 writes one row per item per day
      const productAcc = new Map<string, AdsProductStat>();
      for (const r of productRows) {
        const prev = productAcc.get(r.item_id);
        if (prev) {
          prev.impressions        += r.impressions        ?? 0;
          prev.clicks             += r.clicks             ?? 0;
          prev.spend              += r.spend              ?? 0;
          prev.attributed_revenue += r.attributed_revenue ?? 0;
          prev.attributed_orders  += r.attributed_orders  ?? 0;
        } else {
          productAcc.set(r.item_id, {
            item_id:             r.item_id,
            title:               r.title     ?? "",
            thumbnail:           r.thumbnail ?? null,
            impressions:         r.impressions        ?? 0,
            clicks:              r.clicks             ?? 0,
            spend:               r.spend              ?? 0,
            attributed_revenue:  r.attributed_revenue ?? 0,
            attributed_orders:   r.attributed_orders  ?? 0,
            cpc:  0,
            ctr:  0,
            roas: 0,
          });
        }
      }
      const products: AdsProductStat[] = Array.from(productAcc.values()).map((p) => ({
        ...p,
        cpc:  p.clicks > 0      ? p.spend / p.clicks                  : 0,
        ctr:  p.impressions > 0 ? (p.clicks / p.impressions) * 100    : 0,
        roas: p.spend > 0       ? p.attributed_revenue / p.spend      : 0,
      }));

      const summary = computeAdsSummary(daily);
      setData({ daily, campaigns, products, summary });
      setAdsAvailable(daily.length > 0 || campaigns.length > 0);

      // lastUpdated = most recent synced_at across all rows
      const allSyncedAt = [
        ...dailyRows.map((r) => r.synced_at),
        ...campaignRows.map((r) => r.synced_at),
      ].filter(Boolean) as string[];
      const latest = allSyncedAt.reduce<string | null>((max, v) => (!max || v > max ? v : max), null);
      setLastUpdated(latest ? new Date(latest) : null);
    } catch (err: any) {
      console.error("useMLAds cache read error:", err);
    } finally {
      setLoading(false);
    }
  }, [user, mlUserIds, effectiveDateFrom, effectiveDateTo]);

  // Trigger a fresh sync from ML API, then re-read cache
  const syncNow = useCallback(async () => {
    if (!user || syncing || mlUserIds.length === 0 || !currentOrg?.id) return;
    setSyncing(true);
    try {
      const today = format(new Date(), "yyyy-MM-dd");
      await supabase.from("sync_jobs").insert(
        mlUserIds.map((ml_user_id) => ({
          job_type:        "ads",
          ml_user_id,
          organization_id: currentOrg?.id,
          date_from:       effectiveDateFrom,
          date_to:         today,
          status:          "pending",
        }))
      );
      await refresh();
      localStorage.setItem(ADS_SYNC_LS_KEY, String(Date.now()));
      toast({ title: "Publicidade sincronizada", description: "Dados atualizados com sucesso." });
    } catch (err: any) {
      console.error("useMLAds syncNow error:", err);
      toast({ title: "Erro ao sincronizar", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }, [user, syncing, mlUserIds, currentOrg, effectiveDateFrom, refresh, toast]);

  // Auto-sync on mount when > 10min since last sync
  useEffect(() => {
    if (!user || mlUserIds.length === 0) return;
    const lastTs = Number(localStorage.getItem(ADS_SYNC_LS_KEY) ?? 0);
    if (Date.now() - lastTs > ADS_SYNC_COOLDOWN_MS) {
      syncNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, scopeKey]);

  // Reset on scope/date change
  useEffect(() => {
    setData(null);
    setAdsAvailable(null);
    setLastUpdated(null);
  }, [scopeKey]);

  // Load from cache on mount / scope change
  useEffect(() => {
    if (!hasMLConnection || stores.length === 0) return;
    refresh();
  }, [stores.length, scopeKey, effectiveDateFrom, effectiveDateTo]);

  // Keep sync() as alias for syncNow (backward compat for existing callers)
  const sync = syncNow;

  return {
    daily:     data?.daily     ?? [],
    campaigns: data?.campaigns ?? [],
    products:  data?.products  ?? [],
    summary:   data?.summary   ?? EMPTY_SUMMARY,
    loading: storeLoading || loading,
    connected,
    isRealData: data !== null,
    adsAvailable,
    lastUpdated,
    sync,
    syncNow,
    syncing,
  };
}
