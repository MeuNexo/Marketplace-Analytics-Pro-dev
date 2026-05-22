import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, Truck, Megaphone, Package, TrendingDown, TrendingUp } from "lucide-react";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const pct = (v: number, base: number) =>
  base > 0 ? `${((v / base) * 100).toFixed(1)}%` : "—";

interface WaterfallLine {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  /** valor exibido quando value === null */
  nullLabel?: string;
  base: number;
  color: string;
}

interface CostWaterfallCardProps {
  /** Receita bruta (de ml_daily_cache ou orders) */
  gross_revenue: number;
  /** Receita de pedidos cancelados/devolvidos — 0 se nenhum */
  cancelled_revenue: number;
  /** Receita de pedidos pagos (orders filtrado por PAID_STATUSES) — denominador real do Lucro % */
  paid_revenue?: number;
  comissao: number;
  frete: number;
  publicidade: number;
  /** SUM(custo_unit × quantidade) — null = sem custo cadastrado */
  cmv: number | null;
  /** SUM(receita × effective_rate/100) por loja — null = sem config fiscal */
  impostos: number | null;
  loading?: boolean;
}

export function MLCostCard({
  gross_revenue,
  cancelled_revenue,
  paid_revenue,
  comissao,
  frete,
  publicidade,
  cmv,
  impostos,
  loading,
}: CostWaterfallCardProps) {
  const lines: WaterfallLine[] = [
    ...(cancelled_revenue > 0
      ? [{
          icon: <TrendingDown className="w-3.5 h-3.5 text-rose-400" />,
          label: "Cancelamentos",
          value: cancelled_revenue,
          nullLabel: undefined,
          base: gross_revenue,
          color: "text-rose-400",
        }]
      : []),
    {
      icon: <DollarSign className="w-3.5 h-3.5 text-orange-400" />,
      label: "Comissão ML",
      value: comissao,
      base: gross_revenue,
      color: "text-foreground",
    },
    {
      icon: <Truck className="w-3.5 h-3.5 text-blue-400" />,
      label: "Frete",
      value: frete,
      base: gross_revenue,
      color: "text-foreground",
    },
    {
      icon: <Megaphone className="w-3.5 h-3.5 text-purple-400" />,
      label: "Publicidade",
      value: publicidade,
      base: gross_revenue,
      color: "text-foreground",
    },
    {
      icon: <Package className="w-3.5 h-3.5 text-emerald-400" />,
      label: "CMV",
      value: cmv,
      nullLabel: "s/ custo",
      base: gross_revenue,
      color: "text-foreground",
    },
    {
      icon: <DollarSign className="w-3.5 h-3.5 text-amber-400" />,
      label: "Impostos",
      value: impostos,
      nullLabel: "s/ config",
      base: gross_revenue,
      color: "text-foreground",
    },
  ];

  const effectivePaid =
    (paid_revenue ?? 0) > 0
      ? paid_revenue!
      : gross_revenue - cancelled_revenue;

  const operationalCosts = comissao + frete + publicidade + (cmv ?? 0) + (impostos ?? 0);
  const totalDeductions = cancelled_revenue + operationalCosts;
  const lucro = effectivePaid - operationalCosts;
  const lucroPositivo = lucro >= 0;
  const paidRevenue = effectivePaid;

  return (
    <motion.div
      className="lg:col-span-2"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="h-full relative overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Custos</span>
        </div>
        <CardContent className="px-4 pb-4">
          {loading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-5 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* Receita bruta */}
              <div className="flex items-end justify-between pb-2 mb-1.5 border-b border-border">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Receita Bruta</p>
                  <p className="text-xl font-bold tabular-nums text-foreground">{fmt(gross_revenue)}</p>
                </div>
              </div>

              {/* Linhas do waterfall */}
              {lines.map((line) => (
                <div key={line.label} className="flex items-center justify-between text-xs py-1">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    {line.icon}
                    {line.label}
                  </span>
                  <div className="flex items-center gap-2">
                    {line.value != null ? (
                      <>
                        <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                          {pct(line.value, line.base)}
                        </span>
                        <span className="font-semibold tabular-nums w-24 text-right">
                          - {fmt(line.value)}
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] italic text-muted-foreground">
                        {line.nullLabel ?? "—"}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {/* Lucro bruto */}
              <div className="flex items-center justify-between text-xs pt-2.5 mt-1.5 border-t-2 border-border">
                <span className="flex items-center gap-1.5 font-semibold text-foreground">
                  {lucroPositivo
                    ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                    : <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
                  Lucro Bruto
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                    {pct(Math.abs(lucro), paidRevenue > 0 ? paidRevenue : gross_revenue)}
                  </span>
                  <span
                    className={`text-base font-bold tabular-nums w-24 text-right ${
                      lucroPositivo ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {fmt(lucro)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
