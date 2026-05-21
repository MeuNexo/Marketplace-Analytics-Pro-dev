import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useSettings } from "@/contexts/SettingsContext";

interface GoalItem {
  label: string;
  current: number;
  target: number;
  format: "currency" | "number" | "percent";
}

interface GoalsCardProps {
  currentRevenue: number;
  currentOrders: number;
  currentTicket: number;
  currentConversion: number;
  currentGrossProfit?: number;
  storeId?: string;
  year?: number;
  month?: number;
}

const formatValue = (value: number, format: GoalItem["format"]) => {
  if (format === "currency")
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  if (format === "percent") return `${value.toFixed(1)}%`;
  return value.toLocaleString("pt-BR");
};

function GoalRow({ label, current, target, format }: GoalItem) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const colorClass =
    pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-red-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{pct.toFixed(0)}%</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", colorClass)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{formatValue(current, format)}</span>
        <span>Meta: {target > 0 ? formatValue(target, format) : "—"}</span>
      </div>
    </div>
  );
}

export function GoalsCard({
  currentRevenue,
  currentOrders,
  currentTicket,
  currentConversion,
  currentGrossProfit = 0,
  storeId,
  year,
  month,
}: GoalsCardProps) {
  const { getTarget } = useSettings();
  const today = new Date();
  const resolvedYear  = year  ?? today.getFullYear();
  const resolvedMonth = month ?? (today.getMonth() + 1);

  const saved = storeId
    ? getTarget(storeId, "mercado-livre", resolvedYear, resolvedMonth)
    : undefined;

  const kpi = saved?.kpiTargets;
  const targetRevenue     = kpi?.revenue      ?? saved?.targetValue ?? 0;
  const targetOrders      = kpi?.orders       ?? 0;
  const targetTicket      = kpi?.ticket       ?? 0;
  const targetConversion  = kpi?.conversion   ?? 0;
  const targetGrossProfit = kpi?.gross_profit ?? 0;

  const grossProfitPct = currentRevenue > 0 ? (currentGrossProfit / currentRevenue) * 100 : 0;

  const allGoals: GoalItem[] = [
    { label: "Receita Mensal", current: currentRevenue,    target: targetRevenue,     format: "currency" },
    { label: "Lucro Bruto",    current: grossProfitPct,    target: targetGrossProfit, format: "percent"  },
    { label: "Pedidos",        current: currentOrders,     target: targetOrders,      format: "number"   },
    { label: "Ticket Médio",   current: currentTicket,     target: targetTicket,      format: "currency" },
    { label: "Conversão",      current: currentConversion, target: targetConversion,  format: "percent"  },
  ];

  const goals = allGoals.filter((g) => g.target > 0);
  const hasTargets = goals.length > 0;

  return (
    <Card className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Metas do Mês</span>
        <Link
          to="/metas"
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
        >
          {hasTargets ? "Editar" : "Definir metas"}
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
      <CardContent className="px-4 pb-4 flex-1 flex flex-col justify-between gap-4">
        {hasTargets ? (
          goals.map((g) => <GoalRow key={g.label} {...g} />)
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-4">
            <p className="text-xs text-muted-foreground">Nenhuma meta definida para este mês.</p>
            <Link
              to="/metas"
              className="text-xs font-medium text-primary hover:underline"
            >
              Clique aqui para definir suas metas
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
