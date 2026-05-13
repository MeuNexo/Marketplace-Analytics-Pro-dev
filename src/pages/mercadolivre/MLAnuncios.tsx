import { useState, useMemo, useCallback } from "react";
import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
  FunnelChart, Funnel, LabelList,
} from "recharts";
import { format, parseISO, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  TrendingUp, TrendingDown, MousePointerClick,
  ShoppingCart, DollarSign, Zap, RefreshCw, Plug, Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { KPICard } from "@/components/dashboard/KPICard";
import { useMLAds, type AdsCampaign } from "@/hooks/useMLAds";
import { useMLFilters } from "@/hooks/useMLFilters";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Placeholder for future Relatórios tab ────────────────────────────────────

function PublicidadeRelatorios() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center text-muted-foreground">
      <TrendingUp className="w-10 h-10 opacity-30" />
      <p className="text-sm">Relatórios de publicidade em breve.</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MLAnuncios() {
  const [productTab, setProductTab]         = useState<"spend" | "roas">("spend");
  const [campaignSearch, setCampaignSearch] = useState("");

  // ── Filters — default 30 days (ads data is not real-time, "Hoje" would be zeros) ──
  const filters = useMLFilters(30);
  const {
    period, setPeriod, customRange, setCustomRange,
    periodLabel, currentFrom, currentTo, prevFrom, prevTo, fetchFrom,
  } = filters;

  // Fetch enough data to cover both current and previous period for delta comparison.
  // fetchFrom already includes the previous window (e.g. 61 days back for a 30d period).
  const { daily, campaigns, products, summary, loading, connected, sync, syncing } =
    useMLAds({ dateFrom: fetchFrom, dateTo: currentTo });

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
    return {
      total_impressions: ti,
      total_clicks: tc,
      total_spend: ts,
      total_attributed_revenue: tr,
      total_attributed_orders: to,
      avg_cpc:  tc > 0 ? Math.round((ts / tc) * 100) / 100 : 0,
      avg_ctr:  ti > 0 ? Math.round((tc / ti) * 10000) / 100 : 0,
      avg_roas: ts > 0 ? Math.round((tr / ts) * 100) / 100 : 0,
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

  // ── Sorted product lists ──
  const topBySpend = useMemo(() => [...products].sort((a, b) => b.spend - a.spend).slice(0, 8),  [products]);
  const topByRoas  = useMemo(() => [...products].filter((p) => p.spend > 0).sort((a, b) => b.roas - a.roas).slice(0, 8), [products]);

  // ── Filtered campaigns ──
  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    return q ? campaigns.filter((c) => c.name.toLowerCase().includes(q)) : campaigns;
  }, [campaigns, campaignSearch]);

  if (!loading && !connected) return <NotConnected />;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="publicidade" className="space-y-5">

      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
          <MLPageHeader title="Publicidade" lastUpdated={null} />
          <div className="flex items-center gap-2 flex-wrap min-w-0">

            {/* Date picker — same component as Vendas page */}
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

            {/* Tabs */}
            <TabsList className="h-8 overflow-x-auto no-scrollbar max-w-full">
              <TabsTrigger value="publicidade" className="text-xs px-3 h-7">Publicidade</TabsTrigger>
              <TabsTrigger value="relatorios"  className="text-xs px-3 h-7">Relatórios</TabsTrigger>
            </TabsList>

            {/* Atualizar */}
            <Button
              variant="ghost"
              size="sm"
              onClick={sync}
              disabled={syncing || !connected}
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
              aria-label="Atualizar"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{syncing ? "Atualizando..." : "Atualizar"}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* ═══════════════════ ABA PUBLICIDADE ═══════════════════ */}
      <TabsContent value="publicidade" className="space-y-6 mt-0 animate-fade-in">

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KPICard
            title="Gasto Total"
            value={currFmt(currentSummary.total_spend)}
            icon={<DollarSign className="w-4 h-4" />}
            delta={delta(currentSummary.total_spend, prevSummaryCalc?.spend)}
            variant="minimal"
            iconClassName="bg-destructive/10 text-destructive"
            size="compact"
          />
          <KPICard
            title="Receita Atribuída"
            value={currFmt(currentSummary.total_attributed_revenue)}
            icon={<TrendingUp className="w-4 h-4" />}
            delta={delta(
              currentSummary.total_attributed_revenue,
              prevSummaryCalc ? prevSummaryCalc.spend * currentSummary.avg_roas : undefined,
            )}
            variant="minimal"
            iconClassName="bg-success/10 text-success"
            size="compact"
          />
          <KPICard
            title="ROAS"
            value={`${currentSummary.avg_roas.toFixed(2)}x`}
            icon={<Zap className="w-4 h-4" />}
            delta={delta(currentSummary.avg_roas, prevSummaryCalc?.roas)}
            variant="minimal"
            iconClassName="bg-accent/10 text-accent"
            size="compact"
          />
          <KPICard
            title="CPC Médio"
            value={currFmt(currentSummary.avg_cpc)}
            icon={<MousePointerClick className="w-4 h-4" />}
            delta={-delta(currentSummary.avg_cpc, prevSummaryCalc?.cpc)}
            variant="minimal"
            iconClassName="bg-primary/10 text-primary"
            size="compact"
          />
          <KPICard
            title="Pedidos via ADS"
            value={numFmt(currentSummary.total_attributed_orders)}
            icon={<ShoppingCart className="w-4 h-4" />}
            delta={delta(currentSummary.total_attributed_orders, prevSummaryCalc?.orders)}
            variant="minimal"
            iconClassName="bg-[hsl(270,70%,50%)]/10 text-[hsl(270,70%,50%)]"
            size="compact"
          />
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
            <CardContent className="space-y-3">
              <ResponsiveContainer width="100%" height={160}>
                <FunnelChart>
                  <Funnel dataKey="value" data={funnelData} isAnimationActive>
                    <LabelList position="center" fill="#fff" fontSize={11} fontWeight={600}
                      formatter={(v: number) => numFmt(v)} />
                  </Funnel>
                  <RechartsTooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number, _: string, props: any) => [numFmt(value), props?.payload?.name]}
                  />
                </FunnelChart>
              </ResponsiveContainer>

              <div className="space-y-2 pt-1">
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
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Total Impressões</span>
                  <span className="font-semibold tabular-nums">{numFmt(currentSummary.total_impressions)}</span>
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
          </div>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    {["Campanha", "Status", "Orçamento/dia", "Gasto", "Impressões", "Cliques", "CTR", "Pedidos", "ROAS"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap first:pl-6 last:pr-6">
                        {h}
                      </th>
                    ))}
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
                      <td className="px-4 py-3 pr-6">{roasBadge(c.roas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border/60 bg-muted/20 px-6 py-2.5 flex items-center gap-8 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filteredCampaigns.length} campanhas</span>
              <span>Gasto total: <strong className="text-foreground tabular-nums">{currFmt(filteredCampaigns.reduce((s, c) => s + c.spend, 0))}</strong></span>
              <span>Impressões: <strong className="text-foreground tabular-nums">{numFmt(filteredCampaigns.reduce((s, c) => s + c.impressions, 0))}</strong></span>
              <span>Pedidos: <strong className="text-foreground tabular-nums">{numFmt(filteredCampaigns.reduce((s, c) => s + c.attributed_orders, 0))}</strong></span>
            </div>
          </CardContent>
        </Card>

        {/* ── Top Products ── */}
        <Card>
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Top Produtos Patrocinados</span>
              <Tabs value={productTab} onValueChange={(v) => setProductTab(v as "spend" | "roas")}>
                <TabsList className="h-7">
                  <TabsTrigger value="spend" className="text-xs px-2.5 h-6">Maior Gasto</TabsTrigger>
                  <TabsTrigger value="roas"  className="text-xs px-2.5 h-6">Maior ROAS</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    {["#", "Produto", "Gasto", "Cliques", "CTR", "Pedidos", "Receita ADS", "ROAS"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap first:pl-6 last:pr-6">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(productTab === "spend" ? topBySpend : topByRoas).map((p, i) => (
                    <tr
                      key={p.item_id}
                      className={`border-b border-border/40 transition-colors hover:bg-muted/20 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    >
                      <td className="px-4 py-3 pl-6 text-muted-foreground font-mono text-xs">{i + 1}</td>
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
                      <td className="px-4 py-3 pr-6">{roasBadge(p.roas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
      </TabsContent>

      {/* ═══════════════════ ABA RELATÓRIOS ═══════════════════ */}
      <TabsContent value="relatorios" className="mt-0 animate-fade-in">
        <PublicidadeRelatorios />
      </TabsContent>

    </Tabs>
  );
}
