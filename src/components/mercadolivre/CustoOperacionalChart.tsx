import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import type { CustoOperacionalSeries } from "@/hooks/useMLOrdersByBrand";

interface CustoOperacionalChartProps {
  custoSeries: CustoOperacionalSeries[];
  adsDaily: Array<{ date: string; spend: number }>;
  loading?: boolean;
}

const currencyFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const chartConfig = {
  custo_total: { label: "Custo Operacional", color: "hsl(25, 95%, 53%)" },
};

export function CustoOperacionalChart({
  custoSeries,
  adsDaily,
  loading,
}: CustoOperacionalChartProps) {
  if (loading) {
    return (
      <Card>
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
      <Card>
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
  const chartData = custoSeries.map((d) => ({
    label: d.date.slice(5).replace("-", "/"),
    custo_total: Math.round((d.custo_plataforma + (adsMap.get(d.date) ?? 0)) * 100) / 100,
  }));

  return (
    <Card>
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
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              width={48}
            />
            <Tooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => [currencyFmt(Number(value)), "Custo Operacional"]}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="custo_total"
              stroke="hsl(25, 95%, 53%)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
