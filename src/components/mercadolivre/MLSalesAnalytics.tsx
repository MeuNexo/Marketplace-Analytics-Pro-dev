import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Clock3, TrendingUp, MapPin, GitMerge, Info, ShoppingCart, DollarSign, Eye, Users, Percent, Tag, Clock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { BrazilHeatMap } from "@/components/mercadolivre/BrazilHeatMap";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLStateQuery } from "@/hooks/useMLQueries";
import { KPICard } from "@/components/dashboard/KPICard";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";

// ─── Helpers ────────────────────────────────────────────────────────────────

const currencyFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const pctFmt = (v: number) => `${v.toFixed(1)}%`;

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid hsl(var(--border))",
  backgroundColor: "hsl(var(--card))",
  color: "hsl(var(--card-foreground))",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  fontSize: 12,
};

const BRAND_COLORS = {
  primary: "#e6b422",
  blue: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
  purple: "#a855f7",
  orange: "#f97316",
  cyan: "#06b6d4",
};

// Fallback UF → state name map (used when API didn't return state.name for some reason)
const UF_NAME_FALLBACK: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};

// ─── Tab: Venda por Hora ──────────────────────────────────────────────────────

function TabHorario({ from, to }: { from: string; to: string }) {
  const { salesCache } = useMLStore();
  const { hourly, daily } = salesCache;

  // Filter hourly rows by the selected date range (MLSalesHourly has a date field)
  const filteredHourly = useMemo(
    () => hourly.filter((h) => h.date >= from && h.date <= to),
    [hourly, from, to]
  );

  // Filter daily rows for the same range (used for revenue/orders totals when hourly unavailable)
  const filteredDaily = useMemo(
    () => daily.filter((d) => d.date >= from && d.date <= to),
    [daily, from, to]
  );

  const { hourlyAgg, peakHour, totalRevenue } = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({
      label: `${String(h).padStart(2, "0")}h`,
      hour: h,
      receita: 0,
      pedidos: 0,
    }));

    filteredHourly.forEach((r) => {
      const b = buckets[r.hour];
      if (!b) return;
      b.receita += r.total;
      b.pedidos += r.qty;
    });

    const totalRevenue = buckets.reduce((s, b) => s + b.receita, 0);
    const peak = buckets.reduce((best, b) => (b.receita > best.receita ? b : best), buckets[0]);
    return { hourlyAgg: buckets, peakHour: peak, totalRevenue };
  }, [filteredHourly]);

  if (filteredHourly.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="Nenhuma venda por hora"
        description="Selecione o período 'Hoje' ou um dia específico para ver as vendas por hora."
        size="compact"
      />
    );
  }

  const totalPedidos = hourlyAgg.reduce((s, b) => s + b.pedidos, 0);

  const topHours = [...hourlyAgg]
    .filter((b) => b.pedidos > 0)
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* KPI chips */}
      <div className="grid grid-cols-3 gap-3">
        <KPICard
          title="Pico de receita"
          value={peakHour.label}
          subtitle={currencyFmt(peakHour.receita)}
          icon={<Clock3 className="w-4 h-4" />}
          variant="minimal"
          iconClassName="bg-accent/10 text-accent"
          size="compact"
        />
        <KPICard
          title="Total pedidos"
          value={totalPedidos.toLocaleString("pt-BR")}
          icon={<ShoppingCart className="w-4 h-4" />}
          variant="minimal"
          iconClassName="bg-[hsl(270,70%,50%)]/10 text-[hsl(270,70%,50%)]"
          size="compact"
        />
        <KPICard
          title="Receita total"
          value={currencyFmt(totalRevenue)}
          icon={<DollarSign className="w-4 h-4" />}
          variant="minimal"
          iconClassName="bg-success/10 text-success"
          size="compact"
        />
      </div>

      {/* Bar chart — Receita */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium text-foreground">Receita por hora do dia</span>
        </div>
        <CardContent className="px-4 pb-2 pt-0">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourlyAgg} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" interval={2} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} width={48} />
              <Tooltip
                formatter={(value: number) => [currencyFmt(value), "Receita"]}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="receita" name="Receita" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Bar chart — Pedidos */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium text-foreground">Pedidos por hora</span>
        </div>
        <CardContent className="px-4 pb-2 pt-0">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourlyAgg} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" interval={2} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" width={32} />
              <Tooltip
                formatter={(value: number) => [value, "Pedidos"]}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="pedidos" name="Pedidos" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top 5 hours */}
      {topHours.length > 0 && (
        <Card>
          <div className="px-4 pt-4 pb-3">
            <span className="text-sm font-medium text-foreground">Top horários</span>
          </div>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="space-y-2">
              {topHours.map((h, i) => {
                const pct = totalRevenue > 0 ? (h.receita / totalRevenue) * 100 : 0;
                return (
                  <div key={h.hour} className="flex items-center gap-3">
                    <span className="text-xs font-medium w-5 text-muted-foreground">#{i + 1}</span>
                    <span className="text-sm font-semibold w-10">{h.label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground w-10 text-right">{pctFmt(pct)}</span>
                    <span className="text-xs font-medium w-24 text-right">{currencyFmt(h.receita)}</span>
                    <span className="text-xs text-muted-foreground">{h.pedidos} ped.</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab: Ticket Médio ────────────────────────────────────────────────────────

function TabTicket({ from, to }: { from: string; to: string }) {
  const { salesCache } = useMLStore();

  const filteredDaily = useMemo(
    () => salesCache.daily.filter((d) => d.date >= from && d.date <= to),
    [salesCache.daily, from, to]
  );

  const chartData = useMemo(() => {
    return [...filteredDaily]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date.slice(5),
        ticket: d.qty > 0 ? Math.round(d.approved / d.qty) : 0,
        pedidos: d.qty,
        receita: d.approved,
      }))
      .filter((d) => d.pedidos > 0);
  }, [filteredDaily]);

  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    const tickets = chartData.map((d) => d.ticket);
    const avg = tickets.reduce((s, v) => s + v, 0) / tickets.length;
    const max = Math.max(...tickets);
    const min = Math.min(...tickets);
    const bestDay = chartData.find((d) => d.ticket === max);
    const worstDay = chartData.find((d) => d.ticket === min);
    const n = chartData.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = tickets.reduce((s, v) => s + v, 0);
    const sumXY = tickets.reduce((s, v, i) => s + i * v, 0);
    const sumX2 = tickets.reduce((s, _, i) => s + i * i, 0);
    const slope = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0;
    return { avg, max, min, bestDay, worstDay, trend: slope };
  }, [chartData]);

  if (filteredDaily.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Sem dados de vendas"
        description="Nenhum dado de vendas para o período. Ajuste o filtro de período ou sincronize."
        size="compact"
      />
    );
  }

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard
            title="Ticket médio"
            value={currencyFmt(stats.avg)}
            icon={<Tag className="w-4 h-4" />}
            variant="minimal"
            iconClassName="bg-accent/10 text-accent"
            size="compact"
          />
          <KPICard
            title="Melhor dia"
            value={currencyFmt(stats.max)}
            subtitle={stats.bestDay?.date}
            icon={<TrendingUp className="w-4 h-4" />}
            variant="minimal"
            iconClassName="bg-success/10 text-success"
            size="compact"
          />
          <KPICard
            title="Pior dia"
            value={currencyFmt(stats.min)}
            subtitle={stats.worstDay?.date}
            icon={<TrendingUp className="w-4 h-4" />}
            variant="minimal"
            iconClassName="bg-destructive/10 text-destructive"
            size="compact"
          />
          <KPICard
            title="Tendência"
            value={stats.trend > 0 ? `+${currencyFmt(stats.trend)}/dia` : `${currencyFmt(stats.trend)}/dia`}
            icon={<TrendingUp className="w-4 h-4" />}
            variant="minimal"
            iconClassName={stats.trend >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}
            size="compact"
          />
        </div>
      )}

      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium text-foreground">Evolução do ticket médio</span>
        </div>
        <CardContent className="px-4 pb-2 pt-0">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <defs>
                <linearGradient id="ticketGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `R$${v}`} width={56} />
              <Tooltip
                formatter={(v: any) => [currencyFmt(v), "Ticket médio"]}
                labelFormatter={(l) => `Data: ${l}`}
                contentStyle={tooltipStyle}
              />
              <Area
                type="monotone"
                dataKey="ticket"
                stroke="hsl(var(--accent))"
                strokeWidth={2}
                fill="url(#ticketGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium text-foreground">Receita aprovada por dia</span>
        </div>
        <CardContent className="px-4 pb-2 pt-0">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} width={48} />
              <Tooltip
                formatter={(value: number) => [currencyFmt(value), "Receita"]}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="receita" name="Receita" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab: Venda por Estado ────────────────────────────────────────────────────

function TabEstado({ from, to }: { from: string; to: string }) {
  const { salesCache } = useMLStore();
  const { daily } = salesCache;

  // Use from/to props directly — no need to derive from salesCache
  const { data: stateRows = [], isLoading } = useMLStateQuery(from, to);

  const stateData = useMemo(() => {
    const agg: Record<string, { uf: string; name: string; revenue: number; orders: number }> = {};
    for (const r of stateRows) {
      if (!r.uf) continue;
      if (!agg[r.uf]) {
        agg[r.uf] = {
          uf: r.uf,
          name: r.state_name || UF_NAME_FALLBACK[r.uf] || r.uf,
          revenue: 0,
          orders: 0,
        };
      }
      agg[r.uf].revenue += Number(r.approved_revenue || 0) || Number(r.revenue || 0);
      agg[r.uf].orders += Number(r.qty_orders || 0);
    }
    const totalRevenue = Object.values(agg).reduce((s, v) => s + v.revenue, 0);
    return Object.values(agg)
      .map((s) => ({
        uf: s.uf,
        name: s.name,
        revenue: s.revenue,
        orders: s.orders,
        avgTicket: s.orders > 0 ? s.revenue / s.orders : 0,
        pct: totalRevenue > 0 ? (s.revenue / totalRevenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [stateRows]);

  // Filter daily to the selected range for the "has sales" check
  const filteredDaily = useMemo(
    () => daily.filter((d) => d.date >= from && d.date <= to),
    [daily, from, to]
  );
  const dailyHasSales = filteredDaily.some((d) => d.approved > 0 || d.qty > 0);

  if (isLoading && stateData.length === 0) {
    return (
      <EmptyState
        icon={MapPin}
        title="Carregando dados..."
        description="Buscando dados de estado para o período selecionado."
        size="compact"
      />
    );
  }

  if (stateData.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            {dailyHasSales
              ? "Sem dados de estado para o período. Execute uma sincronização para carregar pedidos com endereço de entrega."
              : "Sem dados de estado para o período. Sincronize para carregar pedidos com endereço de entrega."}
          </span>
        </div>
      </div>
    );
  }

  const top10 = stateData.slice(0, 10);
  const maxPct = top10[0]?.pct || 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <div className="px-4 pt-4 pb-3">
            <span className="text-sm font-medium text-foreground">Mapa do Brasil</span>
          </div>
          <CardContent className="px-4 pb-4 pt-0">
            <BrazilHeatMap data={stateData} />
          </CardContent>
        </Card>

        <Card>
          <div className="px-4 pt-4 pb-3">
            <span className="text-sm font-medium text-foreground">Top 10 estados por receita</span>
          </div>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="space-y-2">
              {top10.map((s, i) => (
                <div key={s.uf} className="flex items-center gap-2">
                  <span className="text-[10px] font-medium w-4 text-muted-foreground text-right">{i + 1}</span>
                  <Badge variant="outline" className="text-[10px] w-8 justify-center font-mono font-semibold">{s.uf}</Badge>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(s.pct / maxPct) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground w-8 text-right">{pctFmt(s.pct)}</span>
                  <span className="text-xs font-medium w-24 text-right">{currencyFmt(s.revenue)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium text-foreground">Receita por estado — top 10</span>
        </div>
        <CardContent className="px-4 pb-2 pt-0">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={top10.map((s) => ({ name: s.uf, receita: Math.round(s.revenue), pedidos: s.orders }))}
              margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} width={48} />
              <Tooltip
                formatter={(value: number, name: string) => [currencyFmt(value), "Receita"]}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="receita" name="Receita" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab: Funil de Conversão ──────────────────────────────────────────────────

function TabFunil({ from, to }: { from: string; to: string }) {
  const { salesCache } = useMLStore();

  const filteredDaily = useMemo(
    () => salesCache.daily.filter((d) => d.date >= from && d.date <= to),
    [salesCache.daily, from, to]
  );

  const { funnelData, conversionStats } = useMemo(() => {
    const visits = filteredDaily.reduce((s, d) => s + d.unique_visits, 0);
    const buyers = filteredDaily.reduce((s, d) => s + d.unique_buyers, 0);
    const orders = filteredDaily.reduce((s, d) => s + d.qty, 0);
    const revenue = filteredDaily.reduce((s, d) => s + d.approved, 0);

    const funnelData = [
      { name: "Visitas únicas",    value: visits,  fill: "hsl(var(--primary))" },
      { name: "Compradores únicos",value: buyers,  fill: "hsl(var(--accent))" },
      { name: "Pedidos",           value: orders,  fill: "hsl(var(--success))" },
    ].filter((f) => f.value > 0);

    const conversionStats = {
      visitToBuyer: visits > 0 ? (buyers / visits) * 100 : 0,
      buyerToOrder: buyers > 0 ? (orders / buyers) * 100 : 0,
      visitToOrder: visits > 0 ? (orders / visits) * 100 : 0,
      avgTicket:    orders > 0 ? revenue / orders : 0,
      revenue,
    };

    return { funnelData, conversionStats };
  }, [filteredDaily]);

  // Daily conversion rate chart
  const dailyConv = useMemo(() =>
    [...filteredDaily]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date.slice(5),
        taxa: d.unique_visits > 0 ? parseFloat(((d.unique_buyers / d.unique_visits) * 100).toFixed(2)) : 0,
        visitas: d.unique_visits,
      }))
      .filter((d) => d.visitas > 0),
    [filteredDaily]);

  const hasAny = filteredDaily.some((d) => d.unique_visits > 0 || d.qty > 0);

  if (!hasAny) {
    return (
      <EmptyState
        icon={Percent}
        title="Sem dados de conversão"
        description="Nenhum dado de conversão disponível. Requer visitas e vendas no período."
        size="compact"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Visita → Comprador"
          value={pctFmt(conversionStats.visitToBuyer)}
          icon={<Eye className="w-4 h-4" />}
          variant="minimal"
          iconClassName="bg-primary/10 text-primary"
          size="compact"
        />
        <KPICard
          title="Comprador → Pedido"
          value={pctFmt(conversionStats.buyerToOrder)}
          icon={<Users className="w-4 h-4" />}
          variant="minimal"
          iconClassName="bg-accent/10 text-accent"
          size="compact"
        />
        <KPICard
          title="Tx. geral"
          value={pctFmt(conversionStats.visitToOrder)}
          icon={<Percent className="w-4 h-4" />}
          variant="minimal"
          iconClassName="bg-success/10 text-success"
          size="compact"
        />
        <KPICard
          title="Ticket médio"
          value={currencyFmt(conversionStats.avgTicket)}
          icon={<Tag className="w-4 h-4" />}
          variant="minimal"
          iconClassName="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]"
          size="compact"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Funnel */}
        {funnelData.length > 0 && (
          <Card>
            <div className="px-4 pt-4 pb-3">
              <span className="text-sm font-medium text-foreground">Funil de conversão</span>
            </div>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="space-y-3 py-2">
                {funnelData.map((step, i) => {
                  const pct = i === 0 ? 100 : (step.value / funnelData[0].value) * 100;
                  return (
                    <div key={step.name} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium">{step.name}</span>
                        <span className="font-bold">{step.value.toLocaleString("pt-BR")}</span>
                      </div>
                      <div className="h-7 rounded-lg overflow-hidden bg-muted flex items-center">
                        <div
                          className="h-full rounded-lg flex items-center justify-end pr-2 transition-all"
                          style={{ width: `${Math.max(pct, 4)}%`, background: step.fill }}
                        >
                          {pct > 15 && <span className="text-[10px] text-white font-medium">{pctFmt(pct)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Daily conversion rate */}
        <Card>
          <div className="px-4 pt-4 pb-3">
            <span className="text-sm font-medium text-foreground">Taxa de conversão diária</span>
            <p className="text-xs text-muted-foreground mt-0.5">Compradores únicos / Visitas únicas</p>
          </div>
          <CardContent className="px-4 pb-2 pt-0">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyConv} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <defs>
                  <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v}%`} width={36} />
                <Tooltip
                  formatter={(v: any) => [`${v}%`, "Taxa de conversão"]}
                  contentStyle={tooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="taxa"
                  stroke="hsl(var(--success))"
                  strokeWidth={2}
                  fill="url(#convGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── MLSalesAnalytics ─────────────────────────────────────────────────────────

interface MLSalesAnalyticsProps {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export function MLSalesAnalytics({ from, to }: MLSalesAnalyticsProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider px-1 pb-1">
        Análises Detalhadas
      </p>
      <Accordion type="multiple" defaultValue={["horario", "ticket", "estado", "funil"]} className="space-y-2">
        <AccordionItem value="horario" className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
            <span className="flex items-center gap-2">
              <Clock3 className="w-4 h-4 text-muted-foreground" />
              Venda por Hora
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <TabHorario from={from} to={to} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="ticket" className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
            <span className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              Ticket Médio
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <TabTicket from={from} to={to} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="estado" className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
            <span className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              Vendas por Estado
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <TabEstado from={from} to={to} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="funil" className="border rounded-lg px-3">
          <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
            <span className="flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-muted-foreground" />
              Funil de Conversão
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <TabFunil from={from} to={to} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
