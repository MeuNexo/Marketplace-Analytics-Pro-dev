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
  Megaphone,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { KPI_GLOSSARY } from "@/lib/kpi-glossary";
import { EmptyState } from "@/components/ui/empty-state";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { useOrdersFreshness } from "@/hooks/useOrdersFreshness";
import { AvisoFrescorPedidos } from "@/components/mercadolivre/AvisoFrescorPedidos";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { KPICard } from "@/components/dashboard/KPICard";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useMLFilters } from "@/hooks/useMLFilters";
import { useMLSync } from "@/hooks/useMLSync";
import { useMLMarginAnalysis } from "@/hooks/useMLMarginAnalysis";
import { useMLCostWaterfall } from "@/hooks/useMLCostWaterfall";
import { useMLDifalSummary } from "@/hooks/useMLDifalSummary";
import { resolveDifalCenario } from "@/lib/mcoCenarios";
import { useMLAds } from "@/hooks/useMLAds";
import { useMLAdsBillingSpend } from "@/hooks/useMLAdsBillingSpend";
import { resolveAdsSpend } from "@/lib/adsBillingSpend";
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
    <EmptyState
      icon={Plug}
      title="Mercado Livre não conectado"
      description="Conecte sua conta para visualizar a análise financeira da sua loja."
      actionLabel="Ir para Integrações"
      actionHref="/integracoes"
    />
  );
}

// ─── Glossary tip helper ──────────────────────────────────────────────────────

const tip = (key: keyof typeof KPI_GLOSSARY) => {
  const e = KPI_GLOSSARY[key];
  return e.example ? `${e.definition} ${e.example}` : e.definition;
};

// ─── Pagination helper ────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MLFinanceiro() {
  const { stores, loading: storeLoading } = useMLStore();
  const { currentOrg } = useOrganization();
  const queryClient = useQueryClient();
  const connected = stores.length > 0;
  const isMobile = useIsMobile();

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
  const daily = marginData?.daily ?? [];
  const byProduct = marginData?.byProduct ?? [];
  const byBrand = marginData?.byBrand ?? [];
  const byEstado = marginData?.byEstado ?? [];

  // ── KPI totais: usar useMLCostWaterfall (mesma fonte da página Vendas)
  const { data: waterfall, isLoading: waterfallLoading } = useMLCostWaterfall(currentFrom, currentTo);
  const { data: frescorPedidos } = useOrdersFreshness();
  const kpiReceita    = waterfall?.paid_revenue    ?? 0;
  const kpiCmv        = waterfall?.cmv             ?? 0;
  const kpiComissao   = waterfall?.total_comissao  ?? 0;
  const kpiFrete      = waterfall?.total_frete     ?? 0;
  const kpiImpostos   = waterfall?.total_tax       ?? 0;

  // ── DIFAL — o mesmo cenário "com DIFAL" da tela Vendas (Fase 222, 222-07):
  // mesma janela (currentFrom/currentTo), que a página já calcula para o
  // resto do KPI row acima. O valor principal do card continua o de hoje;
  // o subtítulo ganha o cenário com DIFAL e a advertência de indefinidos.
  const { data: difalSummary, isLoading: difalSummaryLoading } = useMLDifalSummary(
    currentFrom,
    currentTo,
  );
  const difalCenario = resolveDifalCenario(difalSummary ?? null);
  const kpiImpostosComDifal =
    difalCenario.difalAplicado != null ? kpiImpostos + difalCenario.difalAplicado : null;

  // ── Publicidade [Fase 210, prioridade invertida na Fase 219 — D-219-01]:
  // fonte RESOLVIDA do período — o cache de ads (`ml_ads_daily_cache`), o
  // PAINEL do Mercado Livre, consertado pela Fase 219 (ADS-08/ADS-09) e
  // batendo ao centavo com o que o Wesley vê na tela do ML. Como rede de
  // proteção, a fatura (`ml_billing_daily`, PADS+BPAD) entra quando o cache do
  // período ainda não sincronizou — e continua sendo a fonte da DRE. Nunca as
  // duas somadas. É a MESMA régua da tela Vendas — o Lucro Bruto daqui é o
  // MCO de lá com outro nome. O ramo de fatura existe porque zerar
  // publicidade inflaria o lucro em silêncio.
  const { daily: adsDaily, loading: adsCacheLoading } = useMLAds({ dateFrom: currentFrom, dateTo: currentTo });
  const adsBilling = useMLAdsBillingSpend(currentFrom, currentTo);
  // Ponto ÚNICO de decisão de fonte desta tela.
  const adsResolved = useMemo(
    () =>
      resolveAdsSpend(adsBilling.data ?? null, {
        daily: adsDaily.map((d) => ({ date: d.date, spend: d.spend })),
        total: adsDaily.reduce((s, d) => s + d.spend, 0),
      }),
    [adsBilling.data, adsDaily],
  );
  const adsLoading = adsCacheLoading || adsBilling.isLoading;
  const kpiPublicidade = useMemo(
    () => Math.round(adsResolved.total * 100) / 100,
    [adsResolved],
  );

  // ── Lucro Bruto = Receita - CMV - Comissão - Frete - Impostos - Publicidade
  const kpiLucro = kpiReceita - kpiCmv - kpiComissao - kpiFrete - kpiImpostos - kpiPublicidade;
  const kpiLucroPct = kpiReceita > 0 ? Math.round((kpiLucro / kpiReceita) * 10000) / 100 : null;

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

  // ── Chart data (merge ads daily para publicidade por dia)
  const adsDailyByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of adsResolved.daily) m.set(d.date, (m.get(d.date) ?? 0) + d.spend);
    return m;
  }, [adsResolved]);

  const chartData = useMemo(
    () =>
      daily.map((d) => {
        const pub = adsDailyByDate.get(d.date) ?? 0;
        const lucroAjustado = d.lucro - pub;
        const receitaDia = d.receita > 0 ? d.receita : 1;
        return {
          label: format(parseISO(d.date), "dd/MM", { locale: ptBR }),
          "Lucro Bruto": Math.max(0, lucroAjustado),
          CMV: d.cmv,
          "Comissão": d.comissao,
          Frete: d.frete,
          Impostos: d.impostos,
          Publicidade: pub,
          "Margem %": d.receita > 0 ? Math.round((lucroAjustado / receitaDia) * 10000) / 100 : 0,
        };
      }),
    [daily, adsDailyByDate],
  );

  const trendData = useMemo(
    () =>
      daily.map((d) => {
        const pub = adsDailyByDate.get(d.date) ?? 0;
        const lucroAjustado = d.lucro - pub;
        const pct = d.receita > 0 ? Math.round((lucroAjustado / d.receita) * 10000) / 100 : 0;
        return {
          label: format(parseISO(d.date), "dd/MM", { locale: ptBR }),
          "Lucro %": pct,
          zero: 0,
        };
      }),
    [daily, adsDailyByDate],
  );

  const waterfallData = useMemo(
    () => [
      { key: "receita",     label: "Receita Bruta",   value: kpiReceita },
      { key: "cmv",         label: "(-) CMV",         value: -kpiCmv },
      { key: "comissao",    label: "(-) Comissão ML", value: -kpiComissao },
      { key: "frete",       label: "(-) Frete",       value: -kpiFrete },
      { key: "impostos",    label: "(-) Impostos",    value: -kpiImpostos },
      { key: "publicidade", label: "(-) Publicidade", value: -kpiPublicidade },
      { key: "lucro",       label: "= Lucro Bruto",   value: kpiLucro },
    ],
    [kpiReceita, kpiCmv, kpiComissao, kpiFrete, kpiImpostos, kpiPublicidade, kpiLucro],
  );

  // ── Guards
  if (!storeLoading && !connected) return <NotConnected />;

  if (storeLoading || dataLoading || waterfallLoading) {
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

      {/* Ate que horas este numero vale (04/08: 19k reais vs 13-14k na tela) */}
      <AvisoFrescorPedidos
        frescor={frescorPedidos}
        dateFrom={currentFrom}
        dateTo={currentTo}
      />

      {/* ── KPI Row — 8 cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <KPICard
          title="Receita Bruta"
          value={currFmt(kpiReceita)}
          icon={<DollarSign className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-blue-500/10 text-blue-500"
          tooltip={tip("receita_bruta")}
        />
        <KPICard
          title="CMV"
          value={currFmt(kpiCmv)}
          icon={<Package className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-slate-500/10 text-slate-500"
          tooltip={tip("cmv")}
        />
        <KPICard
          title="Comissão ML"
          value={currFmt(kpiComissao)}
          icon={<Receipt className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-orange-500/10 text-orange-500"
          tooltip={tip("comissao_ml")}
        />
        <KPICard
          title="Frete"
          value={currFmt(kpiFrete)}
          icon={<Truck className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-sky-500/10 text-sky-500"
          tooltip={tip("cffe")}
        />
        <KPICard
          title="Impostos"
          value={currFmt(kpiImpostos)}
          icon={<Percent className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-purple-500/10 text-purple-500"
          tooltip={tip("impostos")}
          // [Fase 222/222-07] Subtítulo ganha o cenário com DIFAL (D-02) —
          // nunca some no lugar de zero: "não carregou" quando indisponível,
          // e a contagem de pedidos fora da conta quando houver.
          subtitle={
            difalSummaryLoading
              ? undefined
              : difalCenario.procedencia === "indisponivel"
              ? "com DIFAL: não carregou"
              : `com DIFAL: ${currFmt(kpiImpostosComDifal ?? kpiImpostos)}${
                  difalCenario.pedidosIndefinidos > 0
                    ? ` · ${difalCenario.pedidosIndefinidos} pedido(s) fora da conta`
                    : ""
                }`
          }
        />
        <KPICard
          title="Publicidade"
          value={adsLoading ? "..." : currFmt(kpiPublicidade)}
          // [D-04] A origem do número fica visível no próprio card: quem lê o
          // Lucro Bruto sabe qual régua de publicidade está valendo.
          subtitle={
            adsResolved.source === "billing"
              ? "fatura do Mercado Livre"
              : "cache de publicidade"
          }
          icon={<Megaphone className="w-4 h-4" />}
          variant="minimal"
          size="compact"
          iconClassName="bg-rose-500/10 text-rose-500"
          tooltip={tip("publicidade")}
        />
        <KPICard
          title="Lucro Bruto"
          value={currFmt(kpiLucro)}
          icon={<TrendingUp className="w-4 h-4" />}
          variant={kpiLucro >= 0 ? "success" : "danger"}
          size="compact"
          iconClassName={
            kpiLucro >= 0
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-red-500/10 text-red-500"
          }
          tooltip={tip("lucro_bruto")}
        />
        <KPICard
          title="Lucro Bruto %"
          value={kpiLucroPct != null ? pctFmt(kpiLucroPct) : "—"}
          icon={<Percent className="w-4 h-4" />}
          variant={
            kpiLucroPct == null
              ? "minimal"
              : kpiLucroPct >= 15
              ? "success"
              : kpiLucroPct >= 5
              ? "warning"
              : "danger"
          }
          size="compact"
          iconClassName={
            (kpiLucroPct ?? 0) >= 15
              ? "bg-emerald-500/10 text-emerald-500"
              : (kpiLucroPct ?? 0) >= 5
              ? "bg-amber-500/10 text-amber-500"
              : "bg-red-500/10 text-red-500"
          }
          tooltip={tip("margem_bruta")}
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
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
                Publicidade
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
              margin={{ top: 4, right: isMobile ? 4 : 48, left: 0, bottom: 0 }}
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
                maxBarSize={32}
              />
              <Bar
                yAxisId="brl"
                dataKey="Publicidade"
                stackId="a"
                fill="#f43f5e"
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
            const maxVal = kpiReceita > 0 ? kpiReceita : 1;
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
                  {kpiReceita > 0
                    ? pctFmt((Math.abs(step.value) / kpiReceita) * 100)
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
          ) : isMobile ? (
            /* ── Mobile: stacked cards (D-06) ── */
            <div className="space-y-2 p-2">
              {pagedProducts.map((p) => (
                <div key={p.item_id} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                  <p className="text-xs font-medium line-clamp-2">{p.titulo}</p>
                  {p.sku && <p className="text-[11px] font-mono text-muted-foreground">{p.sku}</p>}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {([
                      ["Receita",  currFmt(p.receita)],
                      ["Comissão", currFmt(p.comissao)],
                      ["Frete",    currFmt(p.frete)],
                      ["Lucro R$", currFmt(p.lucro)],
                      ["Lucro %",  p.lucro_pct != null ? pctFmt(p.lucro_pct) : "—"],
                    ] as [string, string][]).map(([label, val]) => (
                      <div key={label}>
                        <span className="text-muted-foreground">{label} </span>
                        <span className={`font-mono tabular-nums ${
                          (label === "Lucro R$" || label === "Lucro %")
                            ? p.lucro >= 0 ? "text-kpi-positive" : "text-kpi-negative"
                            : ""
                        }`}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ── Desktop: table (D-07) ── */
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
                            p.lucro >= 0 ? "text-kpi-positive" : "text-kpi-negative"
                          }`}
                        >
                          {currFmt(p.lucro)}
                        </td>
                        <td
                          className={`px-3 py-2.5 tabular-nums text-xs whitespace-nowrap ${
                            (p.lucro_pct ?? 0) >= 15
                              ? "text-kpi-positive font-semibold"
                              : (p.lucro_pct ?? 0) < 0
                              ? "text-kpi-negative"
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
            {isMobile ? (
              /* ── Mobile: cards (A-04) ── */
              <div className="space-y-2 p-3">
                {byBrand.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">Sem dados no período</p>
                ) : (
                  byBrand.map((b) => (
                    <div key={b.marca} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                      <p className="text-xs font-medium">{b.marca}</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div><span className="text-muted-foreground">Receita </span><span className="font-mono tabular-nums">{currFmt(b.receita)}</span></div>
                        <div><span className="text-muted-foreground">Pedidos </span><span className="tabular-nums">{b.pedidos}</span></div>
                        <div><span className="text-muted-foreground">Lucro R$ </span><span className={`font-mono tabular-nums font-semibold ${b.lucro >= 0 ? "text-kpi-positive" : "text-kpi-negative"}`}>{currFmt(b.lucro)}</span></div>
                        <div><span className="text-muted-foreground">Lucro % </span><span className={`font-mono tabular-nums ${(b.lucro_pct ?? 0) >= 15 ? "text-kpi-positive font-semibold" : (b.lucro_pct ?? 0) < 0 ? "text-kpi-negative" : ""}`}>{b.lucro_pct != null ? pctFmt(b.lucro_pct) : "—"}</span></div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* ── Desktop: tabela completa (A-04) ── */
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
                              b.lucro >= 0 ? "text-kpi-positive" : "text-kpi-negative"
                            }`}
                          >
                            {currFmt(b.lucro)}
                          </td>
                          <td
                            className={`px-3 py-2.5 pr-5 tabular-nums text-xs whitespace-nowrap ${
                              (b.lucro_pct ?? 0) >= 15
                                ? "text-kpi-positive font-semibold"
                                : (b.lucro_pct ?? 0) < 0
                                ? "text-kpi-negative"
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
            )}
          </CardContent>
        </Card>

        {/* Lucro por Estado */}
        <Card>
          <div className="px-4 pt-4 pb-3">
            <span className="text-sm font-medium">Lucro por Estado</span>
          </div>
          <CardContent className="p-0">
            {isMobile ? (
              /* ── Mobile: cards (A-04) ── */
              <div className="space-y-2 p-3">
                {byEstado.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">Sem dados no período</p>
                ) : (
                  byEstado.slice(0, 15).map((e) => (
                    <div key={e.estado} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                      <p className="text-xs font-medium">{e.estado}</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div><span className="text-muted-foreground">Pedidos </span><span className="tabular-nums">{e.pedidos}</span></div>
                        <div><span className="text-muted-foreground">Receita </span><span className="font-mono tabular-nums">{currFmt(e.receita)}</span></div>
                        <div><span className="text-muted-foreground">Lucro R$ </span><span className={`font-mono tabular-nums font-semibold ${e.lucro >= 0 ? "text-kpi-positive" : "text-kpi-negative"}`}>{currFmt(e.lucro)}</span></div>
                        <div><span className="text-muted-foreground">Lucro % </span><span className={`font-mono tabular-nums ${(e.lucro_pct ?? 0) >= 15 ? "text-kpi-positive font-semibold" : ""}`}>{e.lucro_pct != null ? pctFmt(e.lucro_pct) : "—"}</span></div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* ── Desktop: tabela completa (A-04) ── */
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
                              e.lucro >= 0 ? "text-kpi-positive" : "text-kpi-negative"
                            }`}
                          >
                            {currFmt(e.lucro)}
                          </td>
                          <td
                            className={`px-3 py-2.5 pr-5 tabular-nums text-xs whitespace-nowrap ${
                              (e.lucro_pct ?? 0) >= 15
                                ? "text-kpi-positive font-semibold"
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
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
