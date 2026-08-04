import { useState, useMemo, useCallback, useEffect } from "react";
import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { useIsMobile } from "@/hooks/use-mobile";
import { KPI_GLOSSARY } from "@/lib/kpi-glossary";

const tip = (key: keyof typeof KPI_GLOSSARY) => {
  const e = KPI_GLOSSARY[key];
  return e.example ? `${e.definition} ${e.example}` : e.definition;
};
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  TrendingUp, TrendingDown, MousePointerClick,
  ShoppingCart, DollarSign, Zap, RefreshCw, Plug, Search,
  ArrowUpDown, ArrowDown, ArrowUp,
  AlertCircle, Package, Receipt, BarChart2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { KPICard } from "@/components/dashboard/KPICard";
import { useMLAds, type AdsCampaign } from "@/hooks/useMLAds";
import { useMLAdsDerivedMetrics, type EnrichedAdsProduct } from "@/hooks/useMLAdsDerivedMetrics";
import { useMLMarginWithAds, type ProductMarginWithAds } from "@/hooks/useMLMarginWithAds";
import { useMLFilters } from "@/hooks/useMLFilters";
import { useMLInventory } from "@/contexts/MLInventoryContext";
import { AdsOrigemNota } from "@/components/mercadolivre/AdsOrigemNota";
// AV-03: a ausência de CMV é contada e declarada em agregado, em vez de virar um
// traço solto célula a célula. Ver o cabeçalho de custoFaltante.ts.
import { AvisoCustoFaltante } from "@/components/mercadolivre/AvisoCustoFaltante";
import { contarSemCusto } from "@/lib/custoFaltante";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function adProductLabel(p: { item_id: string; seller_sku: string | null }) {
  const code = p.item_id.replace(/^MLB(\d+)$/, "MLB-$1");
  return p.seller_sku ? `${code} · ${p.seller_sku}` : code;
}

const currFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numFmt  = (v: number) => v.toLocaleString("pt-BR");
const pctFmt  = (v: number) => `${v.toFixed(2)}%`;

function roasBadge(roas: number) {
  if (roas >= 4) return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 font-mono">{roas.toFixed(2)}x</Badge>;
  if (roas >= 2) return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 font-mono">{roas.toFixed(2)}x</Badge>;
  return <Badge className="bg-red-500/15 text-red-600 border-red-500/30 font-mono">{roas.toFixed(2)}x</Badge>;
}

function statusBadge(status: AdsCampaign["status"]) {
  if (status === "active")  return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Ativa</Badge>;
  if (status === "paused")  return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">Pausada</Badge>;
  return <Badge className="bg-gray-500/15 text-gray-500 border-gray-500/30">Encerrada</Badge>;
}

// ─── Not connected ─────────────────────────────────────────────────────────────

function NotConnected() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Plug className="w-16 h-16 text-muted-foreground/40" />
      <h2 className="text-xl font-semibold">Mercado Livre não conectado</h2>
      <p className="text-muted-foreground text-sm">Conecte sua conta para acessar os dados de publicidade.</p>
      <Button asChild><Link to="/integracoes">Ir para Integrações</Link></Button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MLAnuncios() {
  const isMobile = useIsMobile();
  const [campaignSearch, setCampaignSearch] = useState("");
  const [productSearch, setProductSearch]   = useState("");
  const [productSort, setProductSort]       = useState<{ key: "spend" | "roas" | "clicks" | "attributed_orders" | "attributed_revenue" | "ctr" | "stock" | "acos" | "cvr" | "spend_share_pct"; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });
  const [productPage, setProductPage]       = useState(1);
  const [productPageSize, setProductPageSize] = useState<number>(20);
  const [campaignSort, setCampaignSort]     = useState<{ key: "daily_budget" | "spend" | "ctr" | "roas"; dir: "asc" | "desc" } | null>(null);
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [productDiagFilter, setProductDiagFilter] = useState<"all" | "sem_conversao" | "acos_critico" | "ruptura">("all");

  // ── Filters — default 30 days (ads data is not real-time, "Hoje" would be zeros) ──
  const filters = useMLFilters(30);
  const {
    period, setPeriod, customRange, setCustomRange,
    periodLabel, currentFrom, currentTo, prevFrom, prevTo, fetchFrom,
  } = filters;

  // Fetch enough data to cover both current and previous period for delta comparison.
  const { daily, campaigns, products, summary, loading, connected, sync, syncNow, syncing, lastUpdated } =
    useMLAds({ dateFrom: fetchFrom, dateTo: currentTo });

  // Inventory for "Estoque" column on sponsored products
  const { items: inventoryItems } = useMLInventory();
  const stockByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of inventoryItems) map.set(it.id, it.available_quantity ?? 0);
    return map;
  }, [inventoryItems]);

  // ── Margem por anúncio — régua da fatura (Fase 213: CR-01) ──
  // O hook antigo lia o `lucro_pct_pos_ads` CRU da RPC, calculado com o
  // `ads_spend` do cache de publicidade. `useMLMarginWithAds` descarta esse campo
  // e recalcula com a fatura do ML rateada — a mesma régua de `/anuncios` e
  // `/produtos-vendidos`. É essa convergência que o CR-01 promete.
  const { data: margem } = useMLMarginWithAds(currentFrom, currentTo);
  const marginMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of margem?.rows ?? []) {
      // Mesma disciplina do McoCell em /produtos-vendidos: sem custo cadastrado
      // ou sem receita, a célula fica com o marcador de ausência — nunca uma
      // margem positiva fictícia.
      if (r.has_cmv && r.receita > 0 && r.lucro_pct_pos_ads != null) {
        map.set(r.item_id, r.lucro_pct_pos_ads);
      }
    }
    return map;
  }, [margem]);

  // Mapa por item_id da linha de margem INTEIRA (não só o valor pós-ads acima)
  // — o hook de métricas derivadas usa `lucro_pct` (pré-ads) e `sku` dela para
  // o breakeven de ACoS e o seller_sku, sem ler custo por conta própria (CR-02).
  const marginByItem = useMemo(() => {
    const map = new Map<string, ProductMarginWithAds>();
    for (const r of margem?.rows ?? []) map.set(r.item_id, r);
    return map;
  }, [margem]);

  // ── Derived metrics hook ──
  const { enriched: enrichedProducts, global: globalDerived } = useMLAdsDerivedMetrics(
    products,
    summary.total_spend,
    currentFrom,
    currentTo,
    marginByItem,
  );

  // ── Confirm handler ──
  const handleConfirm = useCallback(() => {
    if (filters.pendingRange?.from) {
      const resolvedTo = filters.pendingRange.to ?? filters.pendingRange.from;
      setCustomRange({ from: filters.pendingRange.from, to: resolvedTo });
      setPeriod(0);
      filters.setPopoverOpen(false);
    } else if (filters.pendingPeriod !== null) {
      setCustomRange(null);
      setPeriod(filters.pendingPeriod);
      filters.setPopoverOpen(false);
    }
  }, [filters, setCustomRange, setPeriod]);

  // ── Chart data — only current range ──
  const chartData = useMemo(() => {
    return daily
      .filter((d) => d.date >= currentFrom && d.date <= currentTo)
      .map((d) => ({
        label: format(parseISO(d.date), "dd/MM", { locale: ptBR }),
        date: d.date,
        "Gasto": d.spend,
        "Receita Atribuída": d.attributed_revenue,
        "ROAS": d.roas,
        "Cliques": d.clicks,
      }));
  }, [daily, currentFrom, currentTo]);

  // ── Summary for current period ──
  const currentSummary = useMemo(() => {
    const slice = daily.filter((d) => d.date >= currentFrom && d.date <= currentTo);
    if (slice.length === 0) return summary; // fallback to hook summary when ranges match
    const ti = slice.reduce((s, d) => s + d.impressions, 0);
    const tc = slice.reduce((s, d) => s + d.clicks, 0);
    const ts = Math.round(slice.reduce((s, d) => s + d.spend, 0) * 100) / 100;
    const tr = Math.round(slice.reduce((s, d) => s + d.attributed_revenue, 0) * 100) / 100;
    const to = slice.reduce((s, d) => s + d.attributed_orders, 0);
    const acos_global = tr > 0 ? Math.round((ts / tr) * 10000) / 100 : 0;
    return {
      total_impressions: ti,
      total_clicks: tc,
      total_spend: ts,
      total_attributed_revenue: tr,
      total_attributed_orders: to,
      avg_cpc:  tc > 0 ? Math.round((ts / tc) * 100) / 100 : 0,
      avg_ctr:  ti > 0 ? Math.round((tc / ti) * 10000) / 100 : 0,
      avg_roas: ts > 0 ? Math.round((tr / ts) * 100) / 100 : 0,
      acos_global,
    };
  }, [daily, currentFrom, currentTo, summary]);

  // ── Previous period summary for delta ──
  const prevSummaryCalc = useMemo(() => {
    const slice = daily.filter((d) => d.date >= prevFrom && d.date <= prevTo);
    if (slice.length === 0) return null;
    const tc = slice.reduce((s, d) => s + d.clicks, 0);
    const ts = slice.reduce((s, d) => s + d.spend, 0);
    return {
      spend:  ts,
      roas:   slice.length > 0 ? slice.reduce((s, d) => s + d.roas, 0) / slice.length : 0,
      cpc:    slice.length > 0 ? slice.reduce((s, d) => s + d.cpc, 0) / slice.length : 0,
      clicks: tc,
      orders: slice.reduce((s, d) => s + d.attributed_orders, 0),
    };
  }, [daily, prevFrom, prevTo]);

  const delta = (curr: number, prev: number | undefined) =>
    prev && prev > 0 ? ((curr - prev) / prev) * 100 : 0;

  // ── Funnel data ──
  const funnelData = useMemo(() => [
    { name: "Impressões", value: currentSummary.total_impressions,      fill: "#6366f1" },
    { name: "Cliques",    value: currentSummary.total_clicks,           fill: "#8b5cf6" },
    { name: "Pedidos",    value: currentSummary.total_attributed_orders, fill: "#a855f7" },
  ], [currentSummary]);

  // ── Alert memos ──
  const SPEND_THRESHOLD = 10;

  const semConversao = useMemo(
    () => enrichedProducts
      .filter((p) => p.attributed_orders === 0 && p.spend > SPEND_THRESHOLD)
      .sort((a, b) => b.spend - a.spend),
    [enrichedProducts],
  );

  const topAcos = useMemo(
    () => enrichedProducts
      .filter((p) => p.acos != null && p.acos > 0)
      .sort((a, b) => (b.acos ?? 0) - (a.acos ?? 0))
      .slice(0, 10),
    [enrichedProducts],
  );

  const emRuptura = useMemo(
    () => enrichedProducts
      .filter((p) => (stockByItem.get(p.item_id) ?? -1) === 0 && p.spend > 0)
      .sort((a, b) => b.spend - a.spend),
    [enrichedProducts, stockByItem],
  );

  // ── Sorted + filtered product list (all sponsored products) ──
  const sortedProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    let filtered = q
      ? enrichedProducts.filter((p) => p.title.toLowerCase().includes(q) || p.item_id.toLowerCase().includes(q))
      : enrichedProducts;
    if (productDiagFilter === "sem_conversao") {
      filtered = filtered.filter((p) => p.attributed_orders === 0 && p.spend > SPEND_THRESHOLD);
    } else if (productDiagFilter === "acos_critico") {
      filtered = filtered.filter((p) => p.acos != null && p.acos_breakeven != null && p.acos > p.acos_breakeven);
    } else if (productDiagFilter === "ruptura") {
      filtered = filtered.filter((p) => (stockByItem.get(p.item_id) ?? -1) === 0 && p.spend > 0);
    }
    const { key, dir } = productSort;
    const mult = dir === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (key === "roas") {
        const aValid = a.spend > 0;
        const bValid = b.spend > 0;
        if (aValid !== bValid) return aValid ? -1 : 1;
      }
      if (key === "stock") {
        const aHas = stockByItem.has(a.item_id);
        const bHas = stockByItem.has(b.item_id);
        if (aHas !== bHas) return aHas ? -1 : 1;
        return ((stockByItem.get(a.item_id) ?? 0) - (stockByItem.get(b.item_id) ?? 0)) * mult;
      }
      if (key === "acos") {
        return ((a.acos ?? 0) - (b.acos ?? 0)) * mult;
      }
      if (key === "cvr") {
        return ((a.cvr ?? 0) - (b.cvr ?? 0)) * mult;
      }
      if (key === "spend_share_pct") {
        return ((a.spend_share_pct ?? 0) - (b.spend_share_pct ?? 0)) * mult;
      }
      return ((a[key] ?? 0) - (b[key] ?? 0)) * mult;
    });
  }, [enrichedProducts, productSearch, productDiagFilter, productSort, stockByItem]);

  // ── AV-03: quantos dos patrocinados EXIBIDOS estão sem CMV ────────────────
  // O conjunto é `sortedProducts` — o que a tabela mostra depois da busca e do
  // filtro de diagnóstico —, não a carteira inteira. A fonte de "tem custo" é o
  // `has_cmv` da linha de margem, exatamente o sinal que `marginMap` já usa para
  // decidir entre exibir a margem e exibir o traço. Anúncio patrocinado sem
  // linha de margem no período (gasto sem venda) também não tem CMV apurado.
  const contagemCusto = useMemo(
    () =>
      contarSemCusto(
        sortedProducts.map((p) => ({ temCusto: marginByItem.get(p.item_id)?.has_cmv === true })),
      ),
    [sortedProducts, marginByItem],
  );

  const toggleSort = useCallback((key: typeof productSort.key) => {
    setProductSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }, []);

  // Reset to first page when filters/sort/data change
  useEffect(() => { setProductPage(1); }, [productSearch, productSort, productPageSize, enrichedProducts.length]);

  const productTotalPages = Math.max(1, Math.ceil(sortedProducts.length / productPageSize));
  const productPageSafe   = Math.min(productPage, productTotalPages);
  const pageStart         = (productPageSafe - 1) * productPageSize;
  const pagedProducts     = useMemo(
    () => sortedProducts.slice(pageStart, pageStart + productPageSize),
    [sortedProducts, pageStart, productPageSize],
  );

  const SortIcon = ({ k }: { k: typeof productSort.key }) => {
    if (productSort.key !== k) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return productSort.dir === "desc"
      ? <ArrowDown className="w-3 h-3 text-foreground" />
      : <ArrowUp   className="w-3 h-3 text-foreground" />;
  };

  // ── Filtered campaigns ──
  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    let list = q ? campaigns.filter((c) => c.name.toLowerCase().includes(q)) : campaigns;
    if (campaignStatusFilter !== "all") {
      list = list.filter((c) => c.status === campaignStatusFilter);
    }
    if (!campaignSort) return list;
    const { key, dir } = campaignSort;
    const mult = dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => ((a[key] ?? 0) - (b[key] ?? 0)) * mult);
  }, [campaigns, campaignSearch, campaignStatusFilter, campaignSort]);

  const toggleCampaignSort = useCallback((key: NonNullable<typeof campaignSort>["key"]) => {
    setCampaignSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }, []);

  const CampaignSortIcon = ({ k }: { k: NonNullable<typeof campaignSort>["key"] }) => {
    if (campaignSort?.key !== k) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return campaignSort.dir === "desc"
      ? <ArrowDown className="w-3 h-3 text-foreground" />
      : <ArrowUp   className="w-3 h-3 text-foreground" />;
  };

  if (!loading && !connected) return <NotConnected />;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
          <MLPageHeader title="Publicidade" lastUpdated={lastUpdated} />
          <div className="flex items-center gap-2 flex-wrap min-w-0">

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
              variant="outline"
              size="sm"
              onClick={syncNow}
              disabled={syncing || !connected}
              className="h-8 gap-1.5 px-2.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{syncing ? "Atualizando..." : "Atualizar"}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard
          title="Gasto Total"
          value={currFmt(currentSummary.total_spend)}
          icon={<DollarSign className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-orange-500/10 text-orange-500"
          tooltip={tip("publicidade")}
        />
        <KPICard
          title="ROAS Global"
          value={`${currentSummary.avg_roas.toFixed(2)}x`}
          icon={<TrendingUp className="w-4 h-4" />}
          variant={currentSummary.avg_roas >= 4 ? "success" : currentSummary.avg_roas >= 2.5 ? "warning" : "minimal"}
          size="compact"
          iconClassName={currentSummary.avg_roas >= 4 ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}
          tooltip={tip("roas")}
        />
        <KPICard
          title="ACoS Global"
          value={currentSummary.acos_global > 0 ? pctFmt(currentSummary.acos_global) : "—"}
          icon={<Receipt className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-purple-500/10 text-purple-500"
          tooltip={tip("acos")}
        />
        <KPICard
          title="TACoS Global"
          value={globalDerived.tacos_global != null ? pctFmt(globalDerived.tacos_global) : "—"}
          icon={<BarChart2 className="w-4 h-4" />}
          variant={globalDerived.tacos_global != null && globalDerived.tacos_global < 8 ? "success" : "minimal"}
          size="compact"
          iconClassName={globalDerived.tacos_global != null && globalDerived.tacos_global < 8 ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}
          tooltip={tip("tacos")}
        />
        <KPICard
          title="Impressões"
          value={numFmt(currentSummary.total_impressions)}
          icon={<Zap className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-blue-500/10 text-blue-500"
        />
        <KPICard
          title="Cliques"
          value={numFmt(currentSummary.total_clicks)}
          icon={<MousePointerClick className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-indigo-500/10 text-indigo-500"
        />
      </div>

      {/* ── Alertas ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Sem Conversão */}
        <Card>
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-medium">Sem Conversão</span>
            <Badge className="ml-auto bg-red-500/15 text-red-600 border-red-500/30 text-[10px]">
              {semConversao.length}
            </Badge>
          </div>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-[10px] text-muted-foreground mb-2">
              Gasto &gt; R$10 sem venda — custo sem retorno
            </p>
            {semConversao.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nenhum no período 🎉</p>
            ) : (
              semConversao.slice(0, 5).map((p) => (
                <div key={p.item_id} className="flex items-center justify-between py-1 text-xs border-b border-border/30 last:border-0 gap-2">
                  <span className="text-muted-foreground font-mono text-[11px]">{adProductLabel(p)}</span>
                  <span className="font-semibold text-red-500 whitespace-nowrap tabular-nums">{currFmt(p.spend)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Top ACoS */}
        <Card>
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium">Top ACoS</span>
            <span className="text-[10px] text-muted-foreground ml-auto">mais caro proporcionalmente</span>
          </div>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-[10px] text-muted-foreground mb-2">
              Produtos com maior custo relativo à receita gerada
            </p>
            {topAcos.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Sem dados</p>
            ) : (
              topAcos.slice(0, 5).map((p) => (
                <div key={p.item_id} className="flex items-center justify-between py-1 text-xs border-b border-border/30 last:border-0 gap-2">
                  <span className="text-muted-foreground font-mono text-[11px]">{adProductLabel(p)}</span>
                  <span className={`font-semibold whitespace-nowrap tabular-nums ${(p.acos ?? 0) > 30 ? "text-red-500" : "text-amber-500"}`}>
                    {p.acos != null ? pctFmt(p.acos) : "—"}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Em Ruptura */}
        <Card>
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Package className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-medium">Em Ruptura c/ Ads</span>
            <Badge className="ml-auto bg-orange-500/15 text-orange-600 border-orange-500/30 text-[10px]">
              {emRuptura.length}
            </Badge>
          </div>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-[10px] text-muted-foreground mb-2">
              Estoque zero — pausar ads imediatamente
            </p>
            {emRuptura.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nenhum no período 🎉</p>
            ) : (
              emRuptura.slice(0, 5).map((p) => (
                <div key={p.item_id} className="flex items-center justify-between py-1 text-xs border-b border-border/30 last:border-0 gap-2">
                  <span className="text-muted-foreground font-mono text-[11px]">{adProductLabel(p)}</span>
                  <span className="font-semibold text-orange-500 whitespace-nowrap tabular-nums">{currFmt(p.spend)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Performance Chart + Funnel ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="px-4 pt-4 pb-3">
            <span className="text-sm font-medium text-foreground">
              Gasto vs Receita Atribuída — {periodLabel}
            </span>
          </div>
          <CardContent className="px-4 pb-2 pt-0">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false} axisLine={false}
                  interval={chartData.length <= 7 ? 0 : chartData.length <= 15 ? 1 : Math.floor(chartData.length / 6)}
                />
                <YAxis
                  yAxisId="brl"
                  tickFormatter={(v) => `R$${(v / 1000).toFixed(1)}k`}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false} axisLine={false} width={52}
                />
                <YAxis
                  yAxisId="roas" orientation="right"
                  tickFormatter={(v) => `${v}x`}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false} axisLine={false} width={36}
                />
                <RechartsTooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number, name: string) => {
                    if (name === "ROAS") return [`${(value as number).toFixed(2)}x`, name];
                    return [currFmt(value as number), name];
                  }}
                />
                <Bar  yAxisId="brl"  dataKey="Gasto"            fill="hsl(var(--destructive))" fillOpacity={0.7} radius={[3, 3, 0, 0]} maxBarSize={24} />
                <Area yAxisId="brl"  type="monotone" dataKey="Receita Atribuída" fill="hsl(var(--primary))" fillOpacity={0.12} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line yAxisId="roas" type="monotone" dataKey="ROAS" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <div className="px-4 pt-4 pb-3">
            <span className="text-sm font-medium text-foreground">Funil de Conversão</span>
          </div>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {funnelData.map((step, i) => {
                const top = funnelData[0]?.value || 0;
                const prev = i === 0 ? step.value : funnelData[i - 1].value;
                const pctTop = top > 0 ? (step.value / top) * 100 : 0;
                const pctPrev = prev > 0 ? (step.value / prev) * 100 : 0;
                return (
                  <div key={step.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: step.fill }} />
                        <span className="text-muted-foreground truncate">{step.name}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5 tabular-nums">
                        <span className="text-sm font-semibold text-foreground">{numFmt(step.value)}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {i === 0 ? "100%" : `${pctPrev.toFixed(1)}%`}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(pctTop, 2)}%`, background: step.fill }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              {[
                { label: "Impressões → Cliques", value: currentSummary.avg_ctr, suffix: "(CTR)" },
                {
                  label: "Cliques → Pedidos",
                  value: currentSummary.total_clicks > 0
                    ? Math.round((currentSummary.total_attributed_orders / currentSummary.total_clicks) * 10000) / 100
                    : 0,
                  suffix: "(CVR)",
                },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-semibold tabular-nums">
                    {pctFmt(row.value)}{" "}
                    <span className="text-muted-foreground font-normal">{row.suffix}</span>
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">CPC Médio</span>
                <span className="font-semibold tabular-nums">{currFmt(currentSummary.avg_cpc)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Campaigns Table ── */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <span className="text-sm font-medium text-foreground">Campanhas ({filteredCampaigns.length})</span>
            <div className="relative w-44">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Buscar..."
                value={campaignSearch}
                onChange={(e) => setCampaignSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {(["all", "active", "paused"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setCampaignStatusFilter(s)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  campaignStatusFilter === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {s === "all" ? "Todas" : s === "active" ? "Ativas" : "Pausadas"}
              </button>
            ))}
          </div>
        </div>

        <CardContent className="p-0">
          {isMobile ? (
            /* ── Mobile: cards (A-07) ── */
            <div className="space-y-2 p-3">
              {filteredCampaigns.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhuma campanha encontrada.</p>
              ) : (
                filteredCampaigns.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium line-clamp-2">{c.name}</p>
                      {statusBadge(c.status)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div><span className="text-muted-foreground">Gasto </span><span className="font-mono tabular-nums font-medium">{currFmt(c.spend)}</span></div>
                      <div><span className="text-muted-foreground">ROAS </span>{roasBadge(c.roas)}</div>
                      <div><span className="text-muted-foreground">Pedidos </span><span className="font-mono tabular-nums">{numFmt(c.attributed_orders)}</span></div>
                      <div><span className="text-muted-foreground">ACoS </span><span className="font-mono tabular-nums">{c.spend > 0 && c.attributed_revenue > 0 ? pctFmt(Math.round((c.spend / c.attributed_revenue) * 10000) / 100) : "—"}</span></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            /* ── Desktop: tabela completa (A-07) ── */
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    <th className="px-4 py-2.5 pl-6 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Campanha</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Status</th>
                    {([
                      ["daily_budget", "Orçamento/dia"],
                      ["spend", "Gasto"],
                    ] as const).map(([key, label]) => (
                      <th
                        key={key}
                        onClick={() => toggleCampaignSort(key)}
                        className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground"
                      >
                        <span className="inline-flex items-center gap-1">{label} <CampaignSortIcon k={key} /></span>
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Impressões</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Cliques</th>
                    <th
                      onClick={() => toggleCampaignSort("ctr")}
                      className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground"
                    >
                      <span className="inline-flex items-center gap-1">CTR <CampaignSortIcon k="ctr" /></span>
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Pedidos</th>
                    <th
                      onClick={() => toggleCampaignSort("roas")}
                      className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground"
                    >
                      <span className="inline-flex items-center gap-1">ROAS <CampaignSortIcon k="roas" /></span>
                    </th>
                    <th className="px-4 py-2.5 pr-6 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">ACoS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((c, i) => (
                    <tr
                      key={c.id}
                      className={`border-b border-border/40 transition-colors hover:bg-muted/20 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    >
                      <td className="px-4 py-3 pl-6 font-medium max-w-[200px] truncate">{c.name}</td>
                      <td className="px-4 py-3">{statusBadge(c.status)}</td>
                      <td className="px-4 py-3 tabular-nums">{currFmt(c.daily_budget)}</td>
                      <td className="px-4 py-3 tabular-nums font-medium">{currFmt(c.spend)}</td>
                      <td className="px-4 py-3 tabular-nums">{numFmt(c.impressions)}</td>
                      <td className="px-4 py-3 tabular-nums">{numFmt(c.clicks)}</td>
                      <td className="px-4 py-3 tabular-nums">{pctFmt(c.ctr)}</td>
                      <td className="px-4 py-3 tabular-nums">{numFmt(c.attributed_orders)}</td>
                      <td className="px-4 py-3">{roasBadge(c.roas)}</td>
                      <td className="px-4 py-3 pr-6 text-right text-xs tabular-nums">
                        {c.spend > 0 && c.attributed_revenue > 0
                          ? pctFmt(Math.round((c.spend / c.attributed_revenue) * 10000) / 100)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-border/60 bg-muted/20 px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{filteredCampaigns.length} campanhas</span>
            <span>Gasto total: <strong className="text-foreground tabular-nums">{currFmt(filteredCampaigns.reduce((s, c) => s + c.spend, 0))}</strong></span>
            <span>Impressões: <strong className="text-foreground tabular-nums">{numFmt(filteredCampaigns.reduce((s, c) => s + c.impressions, 0))}</strong></span>
            <span>Pedidos: <strong className="text-foreground tabular-nums">{numFmt(filteredCampaigns.reduce((s, c) => s + c.attributed_orders, 0))}</strong></span>
          </div>
        </CardContent>
      </Card>

      {/* ── Origem do número de publicidade da coluna de resultado (Fase 213) ──
          ROAS/ACoS/CTR/CPC/gráfico/funil/campanhas continuam no cache — só a
          coluna "Mg. Pós-Ads" abaixo mudou de fonte. A tela é obrigada a dizer
          isso, senão duas réguas convivem na mesma tabela sem aviso. */}
      {margem && (
        <AdsOrigemNota source={margem.ads.source} naoRateado={margem.ads.naoRateado} />
      )}

      {/* ── AV-03 — ausência de custo, em agregado ──
          Numa conta sem custo, a coluna de margem e a de breakeven de ACoS ficam
          ambas com traço. Antes disso a tela ficava muda; agora existe uma frase
          dizendo por quê, com a contagem sobre os patrocinados exibidos. */}
      <AvisoCustoFaltante
        contagem={contagemCusto}
        destinoCadastro="/precificacao"
        substantivoPlural="anúncios patrocinados"
      />

      {/* ── Top Products ── */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <span className="text-sm font-medium text-foreground">
              Produtos Patrocinados ({sortedProducts.length})
            </span>
            <div className="flex items-center gap-2">
              <div className="relative w-44">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Buscar..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {([
              { key: "all",           label: "Todos" },
              { key: "sem_conversao", label: `Sem Conversão (${semConversao.length})` },
              { key: "acos_critico",  label: "ACoS Crítico" },
              { key: "ruptura",       label: `Ruptura (${emRuptura.length})` },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setProductDiagFilter(key)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  productDiagFilter === key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <CardContent className="p-0">
          {isMobile ? (
            /* ── Mobile: cards (A-03) ── */
            <div className="space-y-2 p-3">
              {pagedProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum produto patrocinado encontrado.</p>
              ) : (
                pagedProducts.map((p, i) => {
                  const stock = stockByItem.get(p.item_id);
                  return (
                    <div key={p.item_id} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                      <div className="flex items-start gap-2">
                        {p.thumbnail && (
                          <img src={p.thumbnail} alt={p.title} loading="lazy" decoding="async" className="h-9 w-9 rounded-md object-cover shrink-0 border border-border/50" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium line-clamp-2">{p.title}</p>
                          <p className="text-[11px] font-mono text-muted-foreground">{p.item_id}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">#{pageStart + i + 1}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div><span className="text-muted-foreground">Gasto </span><span className="font-mono tabular-nums font-medium">{currFmt(p.spend)}</span></div>
                        <div><span className="text-muted-foreground">ROAS </span>{roasBadge(p.roas)}</div>
                        <div><span className="text-muted-foreground">ACoS </span><span className={`font-mono tabular-nums ${p.acos != null && p.acos_breakeven != null && p.acos > p.acos_breakeven ? "text-red-500 font-semibold" : ""}`}>{p.acos != null ? pctFmt(p.acos) : "—"}</span></div>
                        <div><span className="text-muted-foreground">Estoque </span><span className={`font-mono tabular-nums ${stock === 0 ? "text-red-600 font-medium" : stock != null && stock < 5 ? "text-amber-600 font-medium" : ""}`}>{stock !== undefined ? numFmt(stock) : "—"}</span></div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* ── Desktop: tabela completa (A-03) ── */
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    <th className="px-4 py-2.5 pl-6 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">#</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Produto</th>
                    {([
                      ["spend", "Gasto"],
                      ["clicks", "Cliques"],
                      ["ctr", "CTR"],
                      ["attributed_orders", "Pedidos"],
                      ["attributed_revenue", "Receita ADS"],
                      ["roas", "ROAS"],
                    ] as const).map(([key, label]) => (
                      <th
                        key={key}
                        onClick={() => toggleSort(key)}
                        className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground"
                      >
                        <span className="inline-flex items-center gap-1">
                          {label} <SortIcon k={key} />
                        </span>
                      </th>
                    ))}
                    <th
                      onClick={() => toggleSort("cvr")}
                      className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground"
                    >
                      <span className="inline-flex items-center gap-1">CVR <SortIcon k="cvr" /></span>
                    </th>
                    <th
                      onClick={() => toggleSort("acos")}
                      className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground"
                    >
                      <span className="inline-flex items-center gap-1">ACoS <SortIcon k="acos" /></span>
                    </th>
                    <th
                      onClick={() => toggleSort("spend_share_pct")}
                      className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground"
                    >
                      {/* Fase 213 (AV-10): gasto do produto ÷ receita da LOJA — não é
                          TACoS (métrica global, KPI do topo). Nome e semáforo trocados. */}
                      <span className="inline-flex items-center gap-1">Share Gasto <SortIcon k="spend_share_pct" /></span>
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">Mg. Pós-Ads</th>
                    {/* Rótulo distinto de "Share Gasto" acima — mesma régua (participação
                        nos pedidos atribuídos a ads), evita duas colunas chamadas "share". */}
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">Part. Pedidos</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">ACoS BE</th>
                    <th
                      onClick={() => toggleSort("stock")}
                      className="px-4 py-2.5 pr-6 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground"
                    >
                      <span className="inline-flex items-center gap-1">Estoque <SortIcon k="stock" /></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.length === 0 && (
                    <tr>
                      <td colSpan={15} className="px-6 py-8 text-center text-sm text-muted-foreground">
                        Nenhum produto patrocinado encontrado.
                      </td>
                    </tr>
                  )}
                  {pagedProducts.map((p, i) => (
                    <tr
                      key={p.item_id}
                      className={`border-b border-border/40 transition-colors hover:bg-muted/20 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    >
                      <td className="px-4 py-3 pl-6 text-muted-foreground font-mono text-xs">{pageStart + i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-[200px]">
                          {p.thumbnail && (
                            <img src={p.thumbnail} alt={p.title} loading="lazy" decoding="async" className="h-9 w-9 rounded-md object-cover shrink-0 border border-border/50" />
                          )}
                          <div>
                            <p className="font-medium leading-tight line-clamp-1 max-w-[200px]">{p.title}</p>
                            <p className="text-[11px] text-muted-foreground font-mono">{p.item_id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums font-medium">{currFmt(p.spend)}</td>
                      <td className="px-4 py-3 tabular-nums">{numFmt(p.clicks)}</td>
                      <td className="px-4 py-3 tabular-nums">{pctFmt(p.ctr)}</td>
                      <td className="px-4 py-3 tabular-nums">{numFmt(p.attributed_orders)}</td>
                      <td className="px-4 py-3 tabular-nums">{currFmt(p.attributed_revenue)}</td>
                      <td className="px-4 py-3">{roasBadge(p.roas)}</td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums">
                        {p.cvr != null ? pctFmt(p.cvr) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums">
                        {p.acos != null ? (
                          <span className={p.acos_breakeven != null && p.acos > p.acos_breakeven ? "text-red-500 font-semibold" : ""}>
                            {pctFmt(p.acos)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                        {/* Sem semáforo: o corte de 8% é a régua do TACoS GLOBAL (KPI do
                            topo), não faz sentido aplicada a um share por item (AV-10). */}
                        {p.spend_share_pct != null ? pctFmt(p.spend_share_pct) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums">
                        {(() => {
                          const m = marginMap?.get(p.item_id);
                          if (m == null) return <span className="text-muted-foreground">—</span>;
                          return (
                            <span className={m >= 0 ? "text-emerald-500 font-semibold" : "text-red-500 font-semibold"}>
                              {m.toFixed(1)}%
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                        {p.share_ads_pct != null ? pctFmt(p.share_ads_pct) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                        {p.acos_breakeven != null ? pctFmt(p.acos_breakeven) : "—"}
                      </td>
                      <td className="px-4 py-3 pr-6 tabular-nums">
                        {(() => {
                          const stock = stockByItem.get(p.item_id);
                          if (stock === undefined) return <span className="text-muted-foreground">—</span>;
                          if (stock === 0) return <span className="text-red-600 font-medium">0</span>;
                          if (stock < 5) return <span className="text-amber-600 font-medium">{numFmt(stock)}</span>;
                          return numFmt(stock);
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sortedProducts.length > 0 && (
            <div className="border-t border-border/60 bg-muted/20 px-6 py-2.5 flex items-center justify-between flex-wrap gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>
                  {pageStart + 1}–{Math.min(pageStart + productPageSize, sortedProducts.length)} de{" "}
                  <strong className="text-foreground tabular-nums">{sortedProducts.length}</strong>
                </span>
                <span className="hidden sm:inline">·</span>
                <label className="hidden sm:inline-flex items-center gap-1.5">
                  Por página:
                  <select
                    value={productPageSize}
                    onChange={(e) => setProductPageSize(Number(e.target.value))}
                    className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
                  >
                    {[10, 20, 50, 100].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={productPageSafe <= 1} onClick={() => setProductPage(1)}>« Início</Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={productPageSafe <= 1} onClick={() => setProductPage((p) => Math.max(1, p - 1))}>‹ Anterior</Button>
                <span className="px-2 tabular-nums text-foreground">
                  {productPageSafe} / {productTotalPages}
                </span>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={productPageSafe >= productTotalPages} onClick={() => setProductPage((p) => Math.min(productTotalPages, p + 1))}>Próxima ›</Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={productPageSafe >= productTotalPages} onClick={() => setProductPage(productTotalPages)}>Fim »</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Low ROAS warning ── */}
      {(() => {
        const lowRoas = campaigns.filter((c) => c.status === "active" && c.roas < 1);
        if (lowRoas.length === 0) return null;
        return (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="flex items-start gap-3 py-3 px-4">
              <TrendingDown className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm">
                <span className="font-semibold text-amber-700">{lowRoas.length} campanha{lowRoas.length > 1 ? "s" : ""} com ROAS abaixo de 1x: </span>
                <span className="text-amber-600">{lowRoas.map((c) => c.name).join(", ")}. </span>
                <span className="text-muted-foreground">Você está gastando mais do que retornando. Considere pausar ou ajustar os lances.</span>
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
