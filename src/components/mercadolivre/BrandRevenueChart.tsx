import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import type { BrandTimeSeries } from "@/hooks/useMLOrdersByBrand";
import { BRAND_COLORS } from "@/hooks/useMLOrdersByBrand";

interface BrandRevenueChartProps {
  data: BrandTimeSeries[];
  topBrands: string[];
  loading?: boolean;
}

const currencyFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function BrandRevenueChart({ data, topBrands, loading }: BrandRevenueChartProps) {
  const hasOutros = data[0]?.["Outros"] !== undefined;
  const chartConfig = {
    ...Object.fromEntries(
      topBrands.map((brand, i) => [
        brand,
        { label: brand, color: BRAND_COLORS[i % BRAND_COLORS.length] },
      ]),
    ),
    ...(hasOutros ? { Outros: { label: "Outros", color: "hsl(220, 10%, 60%)" } } : {}),
  };

  if (loading) {
    return (
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Faturamento por Marca</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] bg-muted/20 animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  if (!data.length || !topBrands.length) {
    return (
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Faturamento por Marca</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center text-xs text-muted-foreground">
            Sem dados de marca para o período. Sincronize orders para popular.
          </div>
        </CardContent>
      </Card>
    );
  }

  const formattedData = data.map((d) => ({
    ...d,
    label: d.date.slice(5).replace("-", "/"),
  }));

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Faturamento por Marca</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[280px] w-full aspect-auto">
          <AreaChart data={formattedData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-lg border bg-background p-2 shadow-md min-w-[180px]">
                    <p className="text-xs font-medium text-foreground mb-1.5">{label}</p>
                    {payload.map((entry: any, i: number) => (
                      <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full shrink-0" style={{ background: entry.color }} />
                          <span className="text-muted-foreground">{entry.name}</span>
                        </div>
                        <span className="font-mono font-medium text-foreground">{currencyFmt(Number(entry.value))}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {topBrands.map((brand, i) => (
              <Area
                key={brand}
                type="monotone"
                dataKey={brand}
                stackId="1"
                stroke={BRAND_COLORS[i % BRAND_COLORS.length]}
                fill={BRAND_COLORS[i % BRAND_COLORS.length]}
                fillOpacity={0.6}
              />
            ))}
            {hasOutros && (
              <Area
                key="Outros"
                type="monotone"
                dataKey="Outros"
                stackId="1"
                stroke="hsl(220, 10%, 60%)"
                fill="hsl(220, 10%, 60%)"
                fillOpacity={0.4}
              />
            )}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
