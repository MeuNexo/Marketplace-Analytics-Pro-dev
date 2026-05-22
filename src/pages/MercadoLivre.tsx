import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { STORE_STROKE_COLORS as STORE_STROKE_COLORS_SHARED } from "@/config/storeColors";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useSeller } from "@/contexts/SellerContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMLAds } from "@/hooks/useMLAds";
import { computeAdsSummary } from "@/hooks/useMLAds";
import { useMLReputation } from "@/hooks/useMLReputation";
import { useMLFilters, getFilterDates, todayUTC, getComparisonRanges } from "@/hooks/useMLFilters";
import { useMLDailyQuery, useMLHourlyQuery, useMLProductsQuery, useMLUserQuery, useMLMonthlyDailyQuery, useInvalidateMLQueries, type DailyBreakdown, type HourlyBreakdown } from "@/hooks/useMLQueries";
import { useMLSync } from "@/hooks/useMLSync";
import { useMLLastSync } from "@/hooks/useMLLastSync";
import { useMLOrders } from "@/hooks/useMLOrders";
import { useMLKPISummary } from "@/hooks/useMLKPISummary";
import { useMLCostWaterfall } from "@/hooks/useMLCostWaterfall";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useMLOrdersByBrand } from "@/hooks/useMLOrdersByBrand";
import { BrandRevenueChart } from "@/components/mercadolivre/BrandRevenueChart";
import { BrandMarkupChart } from "@/components/mercadolivre/BrandMarkupChart";
import { CustoOperacionalChart } from "@/components/mercadolivre/CustoOperacionalChart";
import { BrandSharePieChart } from "@/components/mercadolivre/BrandSharePieChart";
import { MLKPIGrid } from "@/components/mercadolivre/MLKPIGrid";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { MLRevenueChart } from "@/components/mercadolivre/MLRevenueChart";
import { MLCostCard } from "@/components/mercadolivre/MLCostCard";
import { MLTopProducts } from "@/components/mercadolivre/MLTopProducts";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { GoalsCard } from "@/components/mercadolivre/GoalsCard";
import type { ProductSalesRow } from "@/components/mercadolivre/TopSellingProducts";
import { Plug, Info, Loader2, Monitor, RefreshCw, Settings2, ChevronUp, ChevronDown, RotateCcw } from "lucide-react";
import { format, parseISO, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MLSalesAnalytics } from "@/components/mercadolivre/MLSalesAnalytics";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";

const currencyFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function buildHourlyChartData(hourlyRows: HourlyBreakdown[]) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, "0")}h`,
    hour,
    "Receita Total": 0,
    Pedidos: 0,
  }));
  hourlyRows.forEach((row) => {
    const bucket = buckets[row.hour];
    if (!bucket) return;
    bucket["Receita Total"] += row.total;
    bucket.Pedidos += row.qty;
  });
  return buckets;
}

function aggregateDailyRows(rows: DailyBreakdown[]): DailyBreakdown[] {
  const dateMap = new Map<string, DailyBreakdown>();
  for (const d of rows) {
    const existing = dateMap.get(d.date);
    if (existing) {
      existing.total += d.total;
      existing.approved += d.approved;
      existing.qty += d.qty;
      existing.units_sold += d.units_sold;
      existing.cancelled += d.cancelled;
      existing.shipped += d.shipped;
      existing.unique_visits += d.unique_visits;
      existing.unique_buyers += d.unique_buyers;
    } else {
      dateMap.set(d.date, { ...d });
    }
  }
  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export default function MercadoLivre() {
  const { user } = useAuth();
  const { stores, selectedStore, setSalesCache, scopeKey, sellerId, resolvedMLUserIds, hasMLConnection, loading: storeLoading } = useMLStore();
  const { selectedSeller, selectedStoreIds } = useSeller();
  const { currentOrg } = useOrganization();

  // ── Dashboard layout personalização ──
  const { widgets, toggleWidget, moveUp, moveDown, resetLayout, isVisible } = useDashboardLayout();
  const [layoutOpen, setLayoutOpen] = useState(false);

  // ── Filters ──
  const filters = useMLFilters();
  const { period, setPeriod, customRange, setCustomRange, chartMode, isHourlyAvailable, hourlyTargetDate, activeFilterKey, currentFrom, currentTo, prevFrom, prevTo, fetchFrom, fetchTo, adsChartFrom, periodLabel } = filters;

  // ── Effective stores (only ML is supported) ──
  const mlStores = useMemo(() => {
    const allActive = (selectedSeller?.stores ?? []).filter((s) => s.is_active && s.marketplace === "ml");
    const base = selectedStoreIds.length === 0 ? allActive : allActive.filter((s) => selectedStoreIds.includes(s.id));
    return base;
  }, [selectedSeller, selectedStoreIds]);

  const isML = true;
  const isAll = selectedStore === "all" && resolvedMLUserIds.length > 1;
  const useRealData = true;

  // ── React Query data ──
  const { data: allDaily = [], isLoading: dailyLoading } = useMLDailyQuery(fetchFrom, fetchTo);
  const { data: allHourly = [], isLoading: hourlyLoading } = useMLHourlyQuery(isHourlyAvailable, hourlyTargetDate);
  const { data: allProductSales = [], isLoading: productsLoading } = useMLProductsQuery(currentFrom, currentTo);
  const { data: mlUser = null } = useMLUserQuery();
  // Monthly query is independent of the period filter — always fetches month-to-date.
  const { data: allMonthlyDaily = [] } = useMLMonthlyDailyQuery();

  const [productStockMap, setProductStockMap] = useState<Record<string, number>>({});
  const [sellerReputation, setSellerReputation] = useState<any>(null);

  const connected = hasMLConnection && resolvedMLUserIds.length > 0;
  const loading = useRealData && (storeLoading || dailyLoading);

  // ── Sync ──
  const sync = useMLSync({
    customRange, period,
    setSellerReputation,
  });
  const { syncing, lastSyncedAt, syncProgress, syncFromAPI, resetSync } = sync;
  const { data: lastSyncTimestamp } = useMLLastSync();
  const invalidate = useInvalidateMLQueries();

  const { reputation: realReputation } = useMLReputation();
  const { daily: adsDaily } = useMLAds({ dateFrom: adsChartFrom, dateTo: currentTo });
  const adsSummary = useMemo(
    () => computeAdsSummary(adsDaily.filter((d) => d.date >= currentFrom && d.date <= currentTo)),
    [adsDaily, currentFrom, currentTo],
  );

  const { data: ordersSummary } = useMLOrders(currentFrom, currentTo);

  const { data: costWaterfall, isLoading: costWaterfallLoading } = useMLCostWaterfall(currentFrom, currentTo);

  const {
    data: brandData,
    isLoading: brandLoading,
  } = useMLOrdersByBrand(currentFrom, currentTo);
  const { data: kpiSummary, isLoading: kpiSummaryLoading } = useMLKPISummary(
    currentFrom,
    currentTo,
    adsSummary.total_spend,
  );

  // Waterfall mensal — sempre mês corrente, independente do filtro de período
  const monthlyFrom = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }, []);
  const monthlyTo = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const monthlyAdsTotal = useMemo(
    () => adsDaily.filter((d) => d.date >= monthlyFrom && d.date <= monthlyTo).reduce((s, d) => s + d.spend, 0),
    [adsDaily, monthlyFrom, monthlyTo],
  );
  const { data: monthlyCostWaterfall } = useMLCostWaterfall(monthlyFrom, monthlyTo);

  const currentGrossProfit = useMemo(() => {
    if (!monthlyCostWaterfall) return 0;
    const { paid_revenue, cmv, has_cmv, total_comissao, total_frete, total_tax, has_tax_data } = monthlyCostWaterfall;
    return Math.max(
      0,
      paid_revenue
        - (has_cmv ? cmv : 0)
        - total_comissao
        - total_frete
        - monthlyAdsTotal
        - (has_tax_data ? total_tax : 0),
    );
  }, [monthlyCostWaterfall, monthlyAdsTotal]);

  // Imposto: usa costWaterfall (pedidos pagos) como fonte — mesmo que GoalsCard
  const impostosTotal = costWaterfall?.has_tax_data ? costWaterfall.total_tax : null;

  // ── Sync state to context (debounced) ──
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      setSalesCache(() => ({
        daily: allDaily,
        hourly: allHourly,
        products: allProductSales.map(p => ({ ...p, date: p.date ?? "" })),
        mlUser,
        connected,
        lastSyncedAt,
        accessToken: "server-managed",
        productStockMap,
      }));
    }, 50);
    return () => clearTimeout(syncTimerRef.current);
  }, [allDaily, allHourly, allProductSales, mlUser, connected, lastSyncedAt, productStockMap, setSalesCache]);

  // ── Auto-sync de hoje no mount (1x por sessão, se stale > 10min) ──
  const autoSyncDoneRef = useRef(false);
  useEffect(() => {
    if (!user || storeLoading || !connected || autoSyncDoneRef.current) return;
    autoSyncDoneRef.current = true;
    const lastTs = Number(localStorage.getItem("ml_last_synced_ts") ?? 0);
    if (Date.now() - lastTs > 10 * 60 * 1000) {
      syncFromAPI({ periodDays: 1 });
    }
    const firstStore = stores.find((s) => resolvedMLUserIds.includes(s.ml_user_id));
    if (firstStore) {
      supabase.functions
        .invoke("ml-inventory", { body: { ml_user_id: firstStore.ml_user_id } })
        .then(({ data: invData }) => {
          if (invData?.items) {
            const stockMap: Record<string, number> = {};
            for (const item of invData.items) stockMap[item.id] = item.available_quantity ?? 0;
            setProductStockMap(stockMap);
          }
        })
        .catch(() => {});
    }
  }, [user, storeLoading, connected, stores, resolvedMLUserIds, syncFromAPI]);

  // Reset on scope change
  useEffect(() => {
    autoSyncDoneRef.current = false;
    resetSync();
    setProductStockMap({});
  }, [scopeKey, resetSync]);

  // ── Supabase Realtime: auto-refresh quando cron atualiza ml_daily_cache ──
  const orgId = currentOrg?.id;
  useEffect(() => {
    if (!orgId || resolvedMLUserIds.length === 0) return;
    const channel = supabase
      .channel("ml_daily_cache_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ml_daily_cache",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          invalidate.invalidateAll();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, resolvedMLUserIds, invalidate]);

  // ── Period confirmation ──
  const handleConfirm = useCallback(() => {
    if (filters.pendingRange?.from) {
      const resolvedTo = filters.pendingRange.to ?? filters.pendingRange.from;
      const resolvedRange = { from: filters.pendingRange.from, to: resolvedTo };
      setCustomRange(resolvedRange);
      setPeriod(0);
      filters.setPopoverOpen(false);
    } else if (filters.pendingPeriod !== null) {
      setCustomRange(null);
      setPeriod(filters.pendingPeriod);
      filters.setPopoverOpen(false);
    }
  }, [filters, setCustomRange, setPeriod]);

  // ── Filtered data ──
  const isNonZero = (d: DailyBreakdown) => d.total > 0 || d.qty > 0 || d.units_sold > 0;
  const daily = allDaily.filter((d) => d.date >= currentFrom && d.date <= currentTo && isNonZero(d));
  const previousDaily = allDaily.filter((d) => d.date >= prevFrom && d.date <= prevTo && isNonZero(d));
  const hourly = allHourly.filter((d) => {
    if (isHourlyAvailable) {
      if (filters.singleDayRange) return d.date === filters.singleDayRange;
      return d.date === todayUTC();
    }
    if (customRange?.from) {
      const from = format(startOfDay(customRange.from), "yyyy-MM-dd");
      const to = customRange.to ? format(startOfDay(customRange.to), "yyyy-MM-dd") : from;
      return d.date >= from && d.date <= to;
    }
    const cutoff = period === 0 ? todayUTC() : (() => { const dd = new Date(); dd.setDate(dd.getDate() - period); return format(dd, "yyyy-MM-dd"); })();
    return d.date >= cutoff;
  });

  const filteredTopProducts = useMemo(() => {
    // Products already come aggregated from the Edge Function
    return allProductSales
      .map((p) => ({ ...p, available_quantity: productStockMap[p.item_id] }))
      .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
      .slice(0, 10);
  }, [allProductSales, productStockMap]);

  // ── Effective data (Mercado Livre only) ──
  const effectiveDaily = useMemo(() => {
    return aggregateDailyRows(daily);
  }, [daily]);

  const effectiveHourly = useMemo(() => {
    const hourMap = new Map<number, HourlyBreakdown>();
    for (const h of hourly) {
      const existing = hourMap.get(h.hour);
      if (existing) { existing.total += h.total; existing.approved += h.approved; existing.qty += h.qty; }
      else hourMap.set(h.hour, { ...h });
    }
    return Array.from(hourMap.values()).sort((a, b) => a.hour - b.hour);
  }, [hourly]);

  const effectiveProducts = filteredTopProducts;

  // ── Metrics ──
  const effectiveMetrics = useMemo(() => {
    if (effectiveDaily.length === 0) return null;
    const m = {
      total_revenue: effectiveDaily.reduce((s, d) => s + d.total, 0),
      approved_revenue: effectiveDaily.reduce((s, d) => s + d.approved, 0),
      total_orders: effectiveDaily.reduce((s, d) => s + d.qty, 0),
      units_sold: effectiveDaily.reduce((s, d) => s + d.units_sold, 0),
      unique_visits: effectiveDaily.reduce((s, d) => s + (d.unique_visits || 0), 0),
      unique_buyers: effectiveDaily.reduce((s, d) => s + (d.unique_buyers || 0), 0),
      avg_ticket: 0,
      conversion_rate: 0,
    };
    const paidCount = ordersSummary?.paid_orders_count ?? m.total_orders;
    const paidRev   = ordersSummary?.paid_revenue     ?? m.approved_revenue;
    if (paidCount > 0) {
      m.avg_ticket = paidRev / paidCount;
    } else if (m.total_orders > 0) {
      m.avg_ticket = m.total_revenue / m.total_orders; // fallback completo
    }
    if (m.unique_visits > 0) m.conversion_rate = (m.unique_buyers / m.unique_visits) * 100;
    return m;
  }, [effectiveDaily, ordersSummary]);

  const effectivePreviousDaily = useMemo(
    () => aggregateDailyRows(previousDaily),
    [previousDaily]
  );

  const previousMetrics = useMemo(() => {
    if (effectivePreviousDaily.length === 0) return null;
    const m = {
      total_revenue: effectivePreviousDaily.reduce((s, d) => s + d.total, 0),
      units_sold: effectivePreviousDaily.reduce((s, d) => s + d.units_sold, 0),
      unique_visits: effectivePreviousDaily.reduce((s, d) => s + (d.unique_visits || 0), 0),
      unique_buyers: effectivePreviousDaily.reduce((s, d) => s + (d.unique_buyers || 0), 0),
      total_orders: effectivePreviousDaily.reduce((s, d) => s + d.qty, 0),
      avg_ticket: 0,
      conversion_rate: 0,
    };
    if (m.total_orders > 0) m.avg_ticket = m.total_revenue / m.total_orders;
    if (m.unique_visits > 0) m.conversion_rate = (m.unique_buyers / m.unique_visits) * 100;
    return m;
  }, [effectivePreviousDaily]);

  // ── Monthly metrics for GoalsCard ──
  // Uses allMonthlyDaily — always month-to-date, independent of the period filter.
  const monthlyMetrics = useMemo(() => {
    const monthRows = aggregateDailyRows(allMonthlyDaily);
    if (monthRows.length === 0) return null;
    const r = {
      total_revenue: monthRows.reduce((s, d) => s + d.total, 0),
      units_sold: monthRows.reduce((s, d) => s + d.units_sold, 0),
      total_orders: monthRows.reduce((s, d) => s + d.qty, 0),
      unique_visits: monthRows.reduce((s, d) => s + (d.unique_visits || 0), 0),
      unique_buyers: monthRows.reduce((s, d) => s + (d.unique_buyers || 0), 0),
      avg_ticket: 0,
      conversion_rate: 0,
    };
    if (r.total_orders > 0) r.avg_ticket = r.total_revenue / r.total_orders;
    if (r.unique_visits > 0) r.conversion_rate = (r.unique_buyers / r.unique_visits) * 100;
    return r;
  }, [allMonthlyDaily]);

  // ── Per-store hourly data ──
  const perMarketplaceHourly = useMemo(() => {
    if (!isAll || stores.length < 2) return null;
    return stores
      .filter((s) => resolvedMLUserIds.includes(s.ml_user_id))
      .map((store) => ({
        id: store.ml_user_id,
        name: store.displayName,
        data: hourly.filter((h: any) => h.ml_user_id === store.ml_user_id),
        chartData: buildHourlyChartData(hourly.filter((h: any) => h.ml_user_id === store.ml_user_id)),
      }));
  }, [isAll, stores, resolvedMLUserIds, hourly]);

  const overlaidHourlyData = useMemo(() => {
    if (!isAll || !perMarketplaceHourly) return null;
    return Array.from({ length: 24 }, (_, hour) => {
      const row: Record<string, any> = { label: `${String(hour).padStart(2, "0")}h`, hour };
      for (const mp of perMarketplaceHourly) {
        row[mp.name] = mp.data.filter((d) => d.hour === hour).reduce((s, d) => s + d.total, 0);
      }
      return row;
    });
  }, [isAll, perMarketplaceHourly]);

  // ── Not connected state ──
  const onlyMLSelected = mlStores.length > 0;
  if (onlyMLSelected && !loading && !connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Plug className="w-16 h-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold text-foreground">Mercado Livre não conectado</h2>
        <p className="text-muted-foreground text-sm">
          {mlStores.length === 1
            ? "Conecte sua conta do Mercado Livre para visualizar os dados desta loja."
            : `Conecte as ${mlStores.length} contas do Mercado Livre para visualizar os dados.`}
        </p>
        <Button asChild><Link to="/integracoes">Ir para Integrações</Link></Button>
      </div>
    );
  }

  const effectiveLoading = useRealData ? loading : false;
  const effectiveSyncing = useRealData ? syncing : false;

  const dailyChartData = [...effectiveDaily].map((d) => ({
    label: format(parseISO(d.date), "dd/MM", { locale: ptBR }),
    "Receita Total": d.total,
    "Venda Aprovada": d.approved,
    Pedidos: d.qty,
  }));

  const hourlyChartData = buildHourlyChartData(effectiveHourly);
  const showHourlyChart = (useRealData ? isHourlyAvailable : true) && chartMode === "hourly";
  const chartData = showHourlyChart ? hourlyChartData : dailyChartData;
  const hasData = useRealData ? allDaily.length > 0 || effectiveDaily.length > 0 : effectiveDaily.length > 0;
  const hasHourlyData = effectiveHourly.length > 0;
  const chartTitle = showHourlyChart ? `Receita por Hora — ${periodLabel}` : `Receita Diária — ${periodLabel}`;

  return (
    <div className="space-y-5">
      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
          <AnimatePresence>
            {syncProgress && (() => {
              const pct = Math.round((syncProgress.current / syncProgress.total) * 100);
              const barColor = pct >= 100 ? "bg-[hsl(142,70%,45%)]" : pct >= 66 ? "bg-[hsl(25,95%,53%)]" : "bg-[hsl(217,70%,45%)]";
              return (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-3 px-3 py-1.5 mb-3 rounded-md border border-border/50 bg-muted/30 text-xs text-muted-foreground"
                >
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="tabular-nums">{pct}%</span>
                </motion.div>
              );
            })()}
          </AnimatePresence>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
            <MLPageHeader title="Vendas" lastUpdated={lastSyncTimestamp ? new Date(lastSyncTimestamp) : null} />
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <Link to="/tv" target="_blank">
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs px-2 sm:px-3" aria-label="Modo TV">
                  <Monitor className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Modo TV</span>
                </Button>
              </Link>
              <MLPeriodPicker
                periodLabel={periodLabel}
                popoverOpen={filters.popoverOpen}
                setPopoverOpen={filters.setPopoverOpen}
                pendingRange={filters.pendingRange}
                setPendingRange={filters.setPendingRange}
                pendingPeriod={filters.pendingPeriod}
                setPendingPeriod={filters.setPendingPeriod}
                pendingLabel={filters.pendingLabel}
                canConfirm={filters.canConfirm}
                customRange={customRange}
                period={period}
                onConfirm={handleConfirm}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => syncFromAPI()}
                disabled={syncing || !connected}
                className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                aria-label="Atualizar"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{syncing ? "Atualizando..." : "Atualizar"}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLayoutOpen(true)}
                className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                aria-label="Personalizar dashboard"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Personalizar</span>
              </Button>
            </div>
          </div>
      </div>

      <div className="space-y-5 animate-fade-in">
          {isML && !effectiveLoading && connected && !hasData && (
            <Card className="border-dashed">
              <CardContent className="flex items-center gap-3 py-4">
                <Info className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Nenhum dado no cache. Clique em <strong>Atualizar</strong> ou use <strong>Histórico</strong>.
                </p>
              </CardContent>
            </Card>
          )}

          {widgets.map((widget) => {
            if (!widget.visible) return null;
            if (widget.id === "kpi_grid") return (
              <MLKPIGrid
                key="kpi_grid"
                metrics={effectiveMetrics}
                previousMetrics={previousMetrics}
                loading={effectiveLoading}
                syncing={effectiveSyncing}
                hasSyncProgress={!!syncProgress}
                kpiSummary={kpiSummary}
                kpiSummaryLoading={kpiSummaryLoading}
                adsTotalForPeriod={adsSummary.total_spend}
              />
            );
            if (widget.id === "revenue_chart") return (
              <div key="revenue_chart" className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
                <MLRevenueChart
                  chartTitle={chartTitle}
                  showHourlyChart={showHourlyChart}
                  hasHourlyData={hasHourlyData}
                  syncing={syncing}
                  chartData={chartData}
                  isAll={isAll}
                  overlaidHourlyData={overlaidHourlyData}
                  perMarketplaceHourly={perMarketplaceHourly}
                />
                <GoalsCard
                  currentRevenue={monthlyMetrics?.total_revenue ?? 0}
                  currentOrders={monthlyMetrics?.units_sold ?? 0}
                  currentTicket={monthlyMetrics?.avg_ticket ?? 0}
                  currentConversion={monthlyMetrics?.conversion_rate ?? 0}
                  currentGrossProfit={currentGrossProfit}
                  grossProfitRevenue={monthlyCostWaterfall?.paid_revenue ?? 0}
                  storeId={selectedStore !== "all" ? String(selectedStore) : (stores[0]?.ml_user_id ?? undefined)}
                />
              </div>
            );
            if (widget.id === "cost_waterfall") return (
              <div key="cost_waterfall" className="grid grid-cols-1 lg:grid-cols-6 gap-3">
                <MLCostCard
                  gross_revenue={effectiveMetrics?.total_revenue ?? 0}
                  cancelled_revenue={costWaterfall?.cancelled_revenue ?? 0}
                  paid_revenue={costWaterfall?.paid_revenue}
                  comissao={costWaterfall?.total_comissao ?? ordersSummary?.total_comissao ?? (effectiveMetrics?.total_revenue ?? 0) * 0.11}
                  frete={costWaterfall?.total_frete ?? ordersSummary?.total_frete ?? (effectiveMetrics?.total_revenue ?? 0) * 0.05}
                  publicidade={adsSummary.total_spend}
                  cmv={costWaterfall?.has_cmv ? costWaterfall.cmv : null}
                  impostos={impostosTotal}
                  loading={costWaterfallLoading}
                />
                <MLTopProducts products={effectiveProducts} />
              </div>
            );
            if (widget.id === "brand_charts") return (
              <div key="brand_charts" className="space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <BrandRevenueChart
                    data={brandData?.brandRevenueSeries ?? []}
                    topBrands={brandData?.topBrands ?? []}
                    loading={brandLoading}
                  />
                  <BrandMarkupChart
                    data={brandData?.brandMarkupSeries ?? []}
                    topBrands={brandData?.topBrands ?? []}
                    loading={brandLoading}
                  />
                </div>
                <CustoOperacionalChart
                  custoSeries={brandData?.custoSeries ?? []}
                  adsDaily={adsDaily}
                  loading={brandLoading}
                />
                <BrandSharePieChart
                  brandAggregates={brandData?.brandAggregates ?? []}
                  loading={brandLoading}
                />
              </div>
            );
            if (widget.id === "analytics") return (
              <MLSalesAnalytics key="analytics" from={currentFrom} to={currentTo} />
            );
            return null;
          })}
      </div>

      {/* ── Sheet de personalização ── */}
      <Sheet open={layoutOpen} onOpenChange={setLayoutOpen}>
        <SheetContent side="right" className="w-[340px] sm:w-[400px]">
          <SheetHeader className="pb-4">
            <SheetTitle>Personalizar Dashboard</SheetTitle>
            <SheetDescription>
              Ative, oculte e reordene as seções da página de Vendas.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-2">
            {widgets.map((widget, idx) => (
              <div
                key={widget.id}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 p-3"
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveUp(widget.id)}
                    disabled={idx === 0}
                    className="rounded p-0.5 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Mover para cima"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => moveDown(widget.id)}
                    disabled={idx === widgets.length - 1}
                    className="rounded p-0.5 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Mover para baixo"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-none">{widget.label}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-tight">{widget.description}</p>
                </div>
                <Switch
                  checked={widget.visible}
                  onCheckedChange={() => toggleWidget(widget.id)}
                  aria-label={`${widget.visible ? "Ocultar" : "Mostrar"} ${widget.label}`}
                />
              </div>
            ))}
          </div>
          <div className="pt-4 border-t border-border/40 mt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetLayout}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar padrão
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
