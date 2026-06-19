import { KPICard } from "@/components/dashboard/KPICard";
import { DollarSign, ShoppingCart, Tag, Eye, Percent, TrendingUp, Wallet, Users, Package, Receipt } from "lucide-react";
import type { MLKPISummary } from "@/hooks/useMLKPISummary";
import { KPI_GLOSSARY } from "@/lib/kpi-glossary";

const tip = (key: keyof typeof KPI_GLOSSARY): string => {
  const e = KPI_GLOSSARY[key];
  return e.example ? `${e.definition} ${e.example}` : e.definition;
};

const currencyFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Metrics {
  total_revenue: number;
  units_sold: number;
  avg_ticket: number;
  unique_visits: number;
  conversion_rate: number;
  total_orders: number;
  unique_buyers: number;
}

interface MLKPIGridProps {
  metrics: Metrics | null;
  previousMetrics: Metrics | null;
  loading: boolean;
  syncing: boolean;
  hasSyncProgress: boolean;
  kpiSummary?: MLKPISummary | null;
  kpiSummaryLoading?: boolean;
  adsTotalForPeriod?: number;
}

function calcDelta(current: number, previous: number | undefined) {
  if (previous === undefined || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

export function MLKPIGrid({
  metrics,
  previousMetrics,
  loading,
  syncing,
  hasSyncProgress,
  kpiSummary,
  kpiSummaryLoading,
  adsTotalForPeriod = 0,
}: MLKPIGridProps) {
  const refreshing = syncing && !hasSyncProgress;
  const summaryLoading = loading || (kpiSummaryLoading ?? false);

  const markupValue = (() => {
    if (!kpiSummary) return "—";
    if (!kpiSummary.markup_has_cost) return "s/ custo";
    if (kpiSummary.markup_ratio == null) return "—";
    return `${kpiSummary.markup_ratio.toFixed(2)}x`;
  })();

  const custoTotal = kpiSummary
    ? (kpiSummary.custo_plataforma ?? 0) + adsTotalForPeriod
    : null;
  const custoOpValue = custoTotal != null ? currencyFmt(custoTotal) : "—";
  const custoOpSubtitle = custoTotal != null && kpiSummary && kpiSummary.gross_revenue > 0
    ? `${((custoTotal / kpiSummary.gross_revenue) * 100).toFixed(1)}% da receita`
    : undefined;

  const impostosValue = (() => {
    if (!kpiSummary) return "—";
    if (!kpiSummary.has_tax_data) return "s/ dados";
    if (kpiSummary.total_tax == null) return "—";
    return currencyFmt(kpiSummary.total_tax);
  })();

  const impostosSubtitle = (() => {
    if (!kpiSummary?.has_tax_data || kpiSummary.total_tax == null) return undefined;
    if (!kpiSummary.gross_revenue || kpiSummary.gross_revenue === 0) return undefined;
    return `${((kpiSummary.total_tax / kpiSummary.gross_revenue) * 100).toFixed(1)}% da receita`;
  })();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      <KPICard
        title="Receita Total"
        value={metrics ? currencyFmt(metrics.total_revenue) : "—"}
        icon={<DollarSign className="w-4 h-4" />}
        variant="minimal"
        iconClassName="bg-accent/10 text-accent"
        loading={loading}
        refreshing={refreshing}
        delta={metrics && previousMetrics ? calcDelta(metrics.total_revenue, previousMetrics.total_revenue) : undefined}
        tooltip={tip("receita_total")}
      />
      <KPICard
        title="Pedidos"
        value={metrics ? String(metrics.total_orders) : "—"}
        icon={<ShoppingCart className="w-4 h-4" />}
        variant="minimal"
        iconClassName="bg-[hsl(270,70%,50%)]/10 text-[hsl(270,70%,50%)]"
        loading={loading}
        refreshing={refreshing}
        delta={metrics && previousMetrics ? calcDelta(metrics.total_orders, previousMetrics.total_orders) : undefined}
        tooltip={tip("pedidos")}
      />
      <KPICard
        title="Ticket Médio"
        value={
          metrics
            ? metrics.avg_ticket.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })
            : "—"
        }
        icon={<Tag className="w-4 h-4" />}
        variant="minimal"
        iconClassName="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]"
        loading={loading}
        refreshing={refreshing}
        delta={metrics && previousMetrics ? calcDelta(metrics.avg_ticket, previousMetrics.avg_ticket) : undefined}
        tooltip={tip("ticket_medio")}
      />
      <KPICard
        title="Visitas"
        value={metrics ? metrics.unique_visits.toLocaleString("pt-BR") : "—"}
        icon={<Eye className="w-4 h-4" />}
        variant="minimal"
        iconClassName="bg-accent/10 text-accent"
        loading={loading}
        refreshing={refreshing}
        delta={metrics && previousMetrics ? calcDelta(metrics.unique_visits, previousMetrics.unique_visits) : undefined}
        tooltip={tip("visitas")}
      />
      <KPICard
        title="Conversão"
        value={metrics ? `${metrics.conversion_rate.toFixed(2)}%` : "—"}
        icon={<Percent className="w-4 h-4" />}
        variant="minimal"
        iconClassName="bg-success/10 text-success"
        loading={loading}
        refreshing={refreshing}
        delta={metrics && previousMetrics ? calcDelta(metrics.conversion_rate, previousMetrics.conversion_rate) : undefined}
        tooltip={tip("conversao")}
      />
      <KPICard
        title="Compradores"
        value={metrics ? metrics.unique_buyers.toLocaleString("pt-BR") : "—"}
        icon={<Users className="w-4 h-4" />}
        variant="minimal"
        iconClassName="bg-sky-500/10 text-sky-500"
        loading={loading}
        refreshing={refreshing}
        delta={metrics && previousMetrics ? calcDelta(metrics.unique_buyers, previousMetrics.unique_buyers) : undefined}
        tooltip={tip("compradores")}
      />
      <KPICard
        title="Unidades Vendidas"
        value={metrics ? metrics.units_sold.toLocaleString("pt-BR") : "—"}
        icon={<Package className="w-4 h-4" />}
        variant="minimal"
        iconClassName="bg-violet-500/10 text-violet-500"
        loading={loading}
        refreshing={refreshing}
        delta={metrics && previousMetrics ? calcDelta(metrics.units_sold, previousMetrics.units_sold) : undefined}
        tooltip={tip("unidades_vendidas")}
      />
      <KPICard
        title="Markup das Vendas"
        value={markupValue}
        subtitle={
          kpiSummary?.markup_has_cost && kpiSummary.markup_ratio != null
            ? "preço / custo produto"
            : undefined
        }
        icon={<TrendingUp className="w-4 h-4" />}
        variant="minimal"
        iconClassName="bg-emerald-500/10 text-emerald-500"
        loading={summaryLoading}
        refreshing={refreshing}
        tooltip={tip("markup")}
      />
      <KPICard
        title="Custo Operacional"
        value={custoOpValue}
        subtitle={custoOpSubtitle}
        icon={<Wallet className="w-4 h-4" />}
        variant="minimal"
        iconClassName="bg-orange-500/10 text-orange-500"
        loading={summaryLoading}
        refreshing={refreshing}
        tooltip={tip("custo_operacional")}
      />
      <KPICard
        title="Impostos"
        value={impostosValue}
        subtitle={impostosSubtitle}
        icon={<Receipt className="w-4 h-4" />}
        variant="minimal"
        iconClassName="bg-red-500/10 text-red-500"
        loading={summaryLoading}
        refreshing={refreshing}
        tooltip={tip("impostos")}
      />
    </div>
  );
}
