import { useState, useMemo, useEffect, useCallback } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DollarSign,
  TrendingUp,
  Truck,
  Percent,
  Receipt,
  Plug,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { KPICard } from "@/components/dashboard/KPICard";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useMLFilters } from "@/hooks/useMLFilters";
import { useMLSync } from "@/hooks/useMLSync";
import { useMLMarginAnalysis } from "@/hooks/useMLMarginAnalysis";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pctFmt = (v: number) => `${v.toFixed(1)}%`;

// ─── Custom Tooltip for stacked bar chart ────────────────────────────────────

const StackedTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-xs space-y-1.5 min-w-[180px]">
      <p className="font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p: any) => {
        if (p.dataKey === "Margem %") {
          return (
            <div key={p.dataKey} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: p.stroke }} />
                <span className="text-muted-foreground">{p.name}</span>
              </span>
              <span className="font-medium tabular-nums">{pctFmt(p.value)}</span>
            </div>
          );
        }
        return (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-sm shrink-0"
                style={{ background: p.fill ?? p.color }}
              />
              <span className="text-muted-foreground">{p.name}</span>
            </span>
            <span className="font-medium tabular-nums">{currFmt(p.value)}</span>
          </div>
        );
      })}
    </div>
  );
};

// ─── Not connected ────────────────────────────────────────────────────────────

function NotConnected() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Plug className="w-16 h-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Mercado Livre não conectado</h2>
        <p className="text-muted-foreground text-sm">
          Conecte sua conta para visualizar a análise financeira.
        </p>
        <Button asChild>
          <Link to="/integracoes">Ir para Integrações</Link>
        </Button>
      </div>
    </div>
  );
}

// ─── Pagination helper ────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MLFinanceiro() {
  const { stores, loading: storeLoading } = useMLStore();
  const { currentOrg } = useOrganization();
  const queryClient = useQueryClient();
  const connected = stores.length > 0;

  // ── Período
  const filters = useMLFilters(30);
  const {
    period,
    setPeriod,
    customRange,
    setCustomRange,
    periodLabel,
    currentFrom,
    currentTo,
  } = filters;

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

  // ── Sync (real signature: needs customRange + period + setSellerReputation)
  const [, setSellerReputation] = useState<unknown>(null);
  const { syncing, lastSyncedAt, syncFromAPI } = useMLSync({
    customRange,
    period,
    setSellerReputation,
  });
  const lastUpdated = lastSyncedAt ? new Date(lastSyncedAt) : null;

  // ── Dados reais
  const { data: marginData, isLoading: dataLoading } = useMLMarginAnalysis(
    currentFrom,
    currentTo,
  );
  const summary = marginData?.summary;
  const daily = marginData?.daily ?? [];
  const byProduct = marginData?.byProduct ?? [];
  const byBrand = marginData?.byBrand ?? [];
  const byEstado = marginData?.byEstado ?? [];

  // ── Supabase Realtime em orders
  useEffect(() => {
    if (!currentOrg?.id) return;
    const ch = supabase
      .channel("orders_changes_financeiro_" + currentOrg.id)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: "organization_id=eq." + currentOrg.id,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["ml_margin_analysis"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentOrg?.id, queryClient]);

  // ── Tabela de produtos: filtro + busca + paginação
  const [abcFilter, setAbcFilter] = useState<"all" | "A" | "B" | "C">("all");
  const [productSearch, setProductSearch] = useState("");
  const [productPage, setProductPage] = useState(1);

  const filteredProducts = useMemo(() => {
    let list = byProduct;
    if (abcFilter !== "all") list = list.filter((p) => p.curva === abcFilter);
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      list = list.filter(
        (p) =>
          p.titulo.toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [byProduct, abcFilter, productSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(productPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagedProducts = filteredProducts.slice(pageStart, pageStart + PAGE_SIZE);

  // Reset page when filter/search changes
  useEffect(() => {
    setProductPage(1);
  }, [abcFilter, productSearch]);

  // ── Chart data
  const chartData = useMemo(
    () =>
      daily.map((d) => ({
        label: format(parseISO(d.date), "dd/MM", { locale: ptBR }),
        "Lucro Bruto": Math.max(0, d.lucro),
        CMV: d.cmv,
        "Comissão": d.comissao,
        Frete: d.frete,
        Impostos: d.impostos,
        "Margem %": d.lucro_pct ?? 0,
      })),
    [daily],
  );

  const trendData = useMemo(
    () =>
      daily.map((d) => ({
        label: format(parseISO(d.date), "dd/MM", { locale: ptBR }),
        "Lucro %": d.lucro_pct ?? 0,
        zero: 0,
      })),
    [daily],
  );

  const waterfallData = useMemo(
    () => [
      { key: "receita", label: "Receita Bruta", value: summary?.receita ?? 0 },
      { key: "cmv", label: "(-) CMV", value: -(summary?.cmv ?? 0) },
      { key: "comissao", label: "(-) Comissão ML", value: -(summary?.comissao ?? 0) },
      { key: "frete", label: "(-) Frete", value: -(summary?.frete ?? 0) },
      { key: "impostos", label: "(-) Impostos", value: -(summary?.impostos ?? 0) },
      { key: "lucro", label: "= Lucro Bruto", value: summary?.lucro ?? 0 },
    ],
    [summary],
  );

  // ── Guards
  if (!storeLoading && !connected) return <NotConnected />;

  if (storeLoading || dataLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const chartInterval =
    chartData.length <= 7 ? 0 : chartData.length <= 15 ? 1 : Math.floor(chartData.length / 7);

  return (
    <div className="space-y-6">

      {/* ── Header sticky ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
          <MLPageHeader title="Financeiro" lastUpdated={lastUpdated} />
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
              onClick={() => syncFromAPI()}
              disabled={syncing}
              className="h-8 gap-1.5 px-2.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">
                {syncing ? "Sincronizando..." : "Atualizar"}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* ── KPI Row — 7 cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <KPICard
          title="Receita Bruta"
          value={currFmt(summary?.receita ?? 0)}
          icon={<DollarSign className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-blue-500/10 text-blue-500"
        />
        <KPICard
          title="CMV"
          value={currFmt(summary?.cmv ?? 0)}
          icon={<Package className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-slate-500/10 text-slate-500"
        />
        <KPICard
          title="Comissão ML"
          value={currFmt(summary?.comissao ?? 0)}
          icon={<Receipt className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-orange-500/10 text-orange-500"
        />
        <KPICard
          title="Frete"
          value={currFmt(summary?.frete ?? 0)}
          icon={<Truck className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-sky-500/10 text-sky-500"
        />
        <KPICard
          title="Impostos"
          value={currFmt(summary?.impostos ?? 0)}
          icon={<Percent className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-purple-500/10 text-purple-500"
        />
        <KPICard
          title="Lucro Bruto"
          value={currFmt(summary?.lucro ?? 0)}
          icon={<TrendingUp className="w-4 h-4" />}
          variant={(summary?.lucro ?? 0) >= 0 ? "success" : "danger"}
          size="compact"
          iconClassName={
            (summary?.lucro ?? 0) >= 0
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-red-500/10 text-red-500"
          }
        />
        <KPICard
          title="Lucro Bruto %"
          value={summary?.lucro_pct != null ? pctFmt(summary.lucro_pct) : "—"}
          icon={<Percent className="w-4 h-4" />}
          variant={
            summary?.lucro_pct == null
              ? "minimal"
              : summary.lucro_pct >= 15
              ? "success"
              : summary.lucro_pct >= 5
              ? "warning"
              : "danger"
          }
          size="compact"
          iconClassName={
            (summary?.lucro_pct ?? 0) >= 15
              ? "bg-emerald-500/10 text-emerald-500"
              : (summary?.lucro_pct ?? 0) >= 5
              ? "bg-amber-500/10 text-amber-500"
              : "bg-red-500/10 text-red-500"
          }
        />
      </div>

      {/* ── Gráfico Composição da Receita por Dia ── */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              Composição da Receita por Dia — {periodLabel}
            </span>
            <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                Lucro Bruto
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-500" />
                CMV
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
                Comissão
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
                Frete
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-purple-500" />
                Impostos
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-cyan-500" />
                Margem %
              </span>
            </div>
          </div>
        </div>
        <CardContent className="px-4 pb-2 pt-0">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart
              data={chartData}
              margin={{ top: 4, right: 48, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                strokeOpacity={0.5}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval={chartInterval}
              />
              <YAxis
                yAxisId="brl"
                tickFormatter={(v) =>
                  `R$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`
                }
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={54}
              />
              <YAxis
                yAxisId="pct"
                orientation="right"
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <RechartsTooltip content={<StackedTooltip />} />
              <Bar
                yAxisId="brl"
                dataKey="Lucro Bruto"
                stackId="a"
                fill="#10b981"
                maxBarSize={32}
              />
              <Bar
                yAxisId="brl"
                dataKey="CMV"
                stackId="a"
                fill="#64748b"
                maxBarSize={32}
              />
              <Bar
                yAxisId="brl"
                dataKey="Comissão"
                stackId="a"
                fill="#f59e0b"
                maxBarSize={32}
              />
              <Bar
                yAxisId="brl"
                dataKey="Frete"
                stackId="a"
                fill="#3b82f6"
                maxBarSize={32}
              />
              <Bar
                yAxisId="brl"
                dataKey="Impostos"
                stackId="a"
                fill="#8b5cf6"
                radius={[3, 3, 0, 0]}
                maxBarSize={32}
              />
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="Margem %"
                stroke="#06b6d4"
                strokeWidth={2}
                dot={false}
                strokeDasharray="4 2"
                name="Margem %"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Waterfall de Margem ── */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium">
            Waterfall de Margem — {periodLabel}
          </span>
        </div>
        <CardContent className="px-4 pb-4 pt-0">
          {waterfallData.map((step) => {
            const isStart = step.key === "receita";
            const isEnd = step.key === "lucro";
            const color = isStart
              ? "#3b82f6"
              : isEnd
              ? step.value >= 0
                ? "#10b981"
                : "#ef4444"
              : "#ef4444";
            const maxVal = summary?.receita ?? 1;
            const widthPct =
              maxVal > 0 ? (Math.abs(step.value) / maxVal) * 100 : 0;
            return (
              <div
                key={step.key}
                className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0"
              >
                <span className="w-32 text-xs text-muted-foreground shrink-0 text-right">
                  {step.label}
                </span>
                <div className="flex-1 flex items-center gap-2">
                  <div
                    className="h-5 rounded"
                    style={{
                      width: `${Math.max(widthPct, 1)}%`,
                      background: color,
                      opacity: isStart ? 1 : 0.75,
                    }}
                  />
                  <span
                    className="text-xs font-semibold tabular-nums whitespace-nowrap"
                    style={{ color }}
                  >
                    {isStart ? "" : step.value >= 0 ? "+" : ""}
                    {currFmt(step.value)}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums w-14 text-right shrink-0">
                  {summary?.receita
                    ? pctFmt((Math.abs(step.value) / summary.receita) * 100)
                    : "—"}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Tendência de Lucro Bruto % ── */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium">
            Tendência de Lucro Bruto % — {periodLabel}
          </span>
        </div>
        <CardContent className="px-4 pb-2 pt-0">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart
              data={trendData}
              margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                strokeOpacity={0.5}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval={chartInterval}
              />
              <YAxis
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <RechartsTooltip
                formatter={(v: number) => [`${v.toFixed(1)}%`, "Lucro %"]}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Line
                type="monotone"
                dataKey="zero"
                stroke="hsl(var(--border))"
                strokeWidth={1}
                dot={false}
                strokeDasharray="2 4"
              />
              <Line
                type="monotone"
                dataKey="Lucro %"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Tabela Lucro por Produto + Curva ABC ── */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <span className="text-sm font-medium">
              Lucro por Produto ({filteredProducts.length})
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Chips ABC */}
              {(["all", "A", "B", "C"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setAbcFilter(k)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    abcFilter === k
                      ? k === "A"
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : k === "B"
                        ? "bg-amber-500 text-white border-amber-500"
                        : k === "C"
                        ? "bg-slate-500 text-white border-slate-500"
                        : "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {k === "all" ? "Todos" : `Curva ${k}`}
                </button>
              ))}
              {/* Search */}
              <div className="relative w-40">
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
        </div>
        <CardContent className="p-0">
          {byProduct.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <TrendingUp className="w-12 h-12 text-muted-foreground/30" />
              <p className="text-muted-foreground text-sm">
                Nenhum pedido encontrado no período selecionado.
              </p>
              <p className="text-xs text-muted-foreground/70">
                Sincronize os pedidos ou ajuste o período.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/30">
                      {[
                        "#",
                        "Produto",
                        "Receita",
                        "CMV",
                        "Comissão",
                        "Frete",
                        "Impostos",
                        "Lucro R$",
                        "Lucro %",
                        "Curva",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground first:pl-5 last:pr-5 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedProducts.map((p, i) => (
                      <tr
                        key={p.item_id}
                        className={`border-b border-border/40 last:border-0 ${
                          i % 2 === 0 ? "" : "bg-muted/10"
                        }`}
                      >
                        <td className="px-3 py-2.5 pl-5 text-xs text-muted-foreground tabular-nums">
                          {pageStart + i + 1}
                        </td>
                        <td className="px-3 py-2.5">
                          <div>
                            <p className="font-medium line-clamp-1 max-w-[220px]">
                              {p.titulo}
                            </p>
                            {p.sku && (
                              <p className="text-[11px] font-mono text-muted-foreground">
                                {p.sku}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap">
                          {currFmt(p.receita)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap text-muted-foreground">
                          {p.has_cmv ? (
                            currFmt(p.cmv)
                          ) : (
                            <span className="italic text-muted-foreground/60">sem CMV</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap">
                          {currFmt(p.comissao)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap">
                          {currFmt(p.frete)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap">
                          {p.impostos > 0 ? currFmt(p.impostos) : "—"}
                        </td>
                        <td
                          className={`px-3 py-2.5 tabular-nums text-xs whitespace-nowrap font-semibold ${
                            p.lucro >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {currFmt(p.lucro)}
                        </td>
                        <td
                          className={`px-3 py-2.5 tabular-nums text-xs whitespace-nowrap ${
                            (p.lucro_pct ?? 0) >= 15
                              ? "text-emerald-600 font-semibold"
                              : (p.lucro_pct ?? 0) < 0
                              ? "text-red-600"
                              : ""
                          }`}
                        >
                          {p.lucro_pct != null ? pctFmt(p.lucro_pct) : "—"}
                        </td>
                        <td className="px-3 py-2.5 pr-5">
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded ${
                              p.curva === "A"
                                ? "bg-emerald-500/15 text-emerald-700"
                                : p.curva === "B"
                                ? "bg-amber-500/15 text-amber-700"
                                : "bg-slate-500/15 text-slate-600"
                            }`}
                          >
                            {p.curva}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Paginação */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-border/60">
                  <span className="text-xs text-muted-foreground">
                    {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredProducts.length)} de{" "}
                    {filteredProducts.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={safePage <= 1}
                      onClick={() => setProductPage((p) => p - 1)}
                    >
                      Anterior
                    </Button>
                    <span className="text-xs text-muted-foreground px-2">
                      {safePage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={safePage >= totalPages}
                      onClick={() => setProductPage((p) => p + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Grid 2 colunas: Lucro por Marca + Lucro por Estado ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Lucro por Marca */}
        <Card>
          <div className="px-4 pt-4 pb-3">
            <span className="text-sm font-medium">Lucro por Marca</span>
          </div>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    {[
                      "Marca",
                      "Pedidos",
                      "Receita",
                      "CMV",
                      "Comissão",
                      "Frete",
                      "Impostos",
                      "Lucro R$",
                      "Lucro %",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground first:pl-5 last:pr-5 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byBrand.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-5 py-8 text-center text-xs text-muted-foreground"
                      >
                        Sem dados no período
                      </td>
                    </tr>
                  ) : (
                    byBrand.map((b, i) => (
                      <tr
                        key={b.marca}
                        className={`border-b border-border/40 last:border-0 ${
                          i % 2 === 0 ? "" : "bg-muted/10"
                        }`}
                      >
                        <td className="px-3 py-2.5 pl-5 font-medium text-xs">
                          {b.marca}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs">{b.pedidos}</td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap">
                          {currFmt(b.receita)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap text-muted-foreground">
                          {b.has_cmv ? currFmt(b.cmv) : "—"}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap text-amber-600">
                          {currFmt(b.comissao)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap text-sky-600">
                          {currFmt(b.frete)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap text-purple-600">
                          {b.impostos > 0 ? currFmt(b.impostos) : "—"}
                        </td>
                        <td
                          className={`px-3 py-2.5 tabular-nums text-xs whitespace-nowrap font-semibold ${
                            b.lucro >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {currFmt(b.lucro)}
                        </td>
                        <td
                          className={`px-3 py-2.5 pr-5 tabular-nums text-xs whitespace-nowrap ${
                            (b.lucro_pct ?? 0) >= 15
                              ? "text-emerald-600 font-semibold"
                              : (b.lucro_pct ?? 0) < 0
                              ? "text-red-600"
                              : ""
                          }`}
                        >
                          {b.lucro_pct != null ? pctFmt(b.lucro_pct) : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Lucro por Estado */}
        <Card>
          <div className="px-4 pt-4 pb-3">
            <span className="text-sm font-medium">Lucro por Estado</span>
          </div>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    {["Estado", "Pedidos", "Receita", "Lucro R$", "Lucro %"].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground first:pl-5 last:pr-5 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byEstado.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-5 py-8 text-center text-xs text-muted-foreground"
                      >
                        Sem dados no período
                      </td>
                    </tr>
                  ) : (
                    byEstado.slice(0, 15).map((e, i) => (
                      <tr
                        key={e.estado}
                        className={`border-b border-border/40 last:border-0 ${
                          i % 2 === 0 ? "" : "bg-muted/10"
                        }`}
                      >
                        <td className="px-3 py-2.5 pl-5 font-medium text-xs">
                          {e.estado}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs">{e.pedidos}</td>
                        <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap">
                          {currFmt(e.receita)}
                        </td>
                        <td
                          className={`px-3 py-2.5 tabular-nums text-xs whitespace-nowrap font-semibold ${
                            e.lucro >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {currFmt(e.lucro)}
                        </td>
                        <td
                          className={`px-3 py-2.5 pr-5 tabular-nums text-xs whitespace-nowrap ${
                            (e.lucro_pct ?? 0) >= 15
                              ? "text-emerald-600 font-semibold"
                              : ""
                          }`}
                        >
                          {e.lucro_pct != null ? pctFmt(e.lucro_pct) : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
