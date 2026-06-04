import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import type { CustoOperacionalSeries } from "@/hooks/useMLOrdersByBrand";

interface CustoOperacionalChartProps {
  custoSeries: CustoOperacionalSeries[];
  adsDaily: Array<{ date: string; spend: number }>;
  dailyRevenue?: Array<{ date: string; revenue: number }>;
  loading?: boolean;
}

const currencyFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const chartConfig = {
  custo_total: { label: "Custo Operacional", color: "hsl(25, 95%, 53%)" },
  pct_custo: { label: "% da Receita", color: "hsl(220, 70%, 50%)" },
};

export function CustoOperacionalChart({
  custoSeries,
  adsDaily,
  dailyRevenue,
  loading,
}: CustoOperacionalChartProps) {
  if (loading) {
    return (
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Custo Operacional Diário</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] bg-muted/20 animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  if (!custoSeries.length) {
    return (
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Custo Operacional Diário</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
            Sem dados para o período.
          </div>
        </CardContent>
      </Card>
    );
  }

  const adsMap = new Map(adsDaily.map((d) => [d.date, d.spend]));
  const revenueMap = new Map((dailyRevenue ?? []).map((d) => [d.date, d.revenue]));
  const chartData = custoSeries.map((d) => {
    const custo = Math.round((d.custo_plataforma + (adsMap.get(d.date) ?? 0)) * 100) / 100;
    const receita = revenueMap.get(d.date) ?? 0;
    const pct_custo = receita > 0 ? Math.round((custo / receita) * 1000) / 10 : null;
    return {
      label: d.date.slice(5).replace("-", "/"),
      date: d.date,
      custo_total: custo,
      pct_custo,
    };
  });

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Custo Operacional Diário</CardTitle>
        <p className="text-xs text-muted-foreground">Frete + Comissão + Publicidade</p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[220px]">
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`}
              width={52}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
              width={36}
              domain={[0, "auto"]}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const custo = payload.find((p) => p.dataKey === "custo_total");
                const pct = payload.find((p) => p.dataKey === "pct_custo");
                return (
                  <div className="rounded-lg border bg-background p-2 shadow-md min-w-[180px]">
                    <p className="text-xs font-medium text-foreground mb-1.5">{label}</p>
                    {custo && (
                      <div className="flex items-center justify-between gap-4 text-xs">
                        <span className="text-muted-foreground">Custo Operacional</span>
                        <span className="font-mono font-medium text-foreground">{currencyFmt(Number(custo.value))}</span>
                      </div>
                    )}
                    {pct?.value != null && (
                      <div className="flex items-center justify-between gap-4 text-xs">
                        <span className="text-muted-foreground">% da Receita</span>
                        <span className="font-mono font-medium text-foreground">{Number(pct.value).toFixed(1)}%</span>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="custo_total"
              stroke="hsl(25, 95%, 53%)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="pct_custo"
              stroke="hsl(220, 70%, 50%)"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={false}
              connectNulls
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
