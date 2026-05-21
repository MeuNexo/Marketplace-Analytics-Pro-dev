import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import type { BrandMarkupSeries } from "@/hooks/useMLOrdersByBrand";
import { BRAND_COLORS } from "@/hooks/useMLOrdersByBrand";

interface BrandMarkupChartProps {
  data: BrandMarkupSeries[];
  topBrands: string[];
  loading?: boolean;
}

export function BrandMarkupChart({ data, topBrands, loading }: BrandMarkupChartProps) {
  const chartConfig = Object.fromEntries(
    topBrands.map((brand, i) => [
      brand,
      { label: brand, color: BRAND_COLORS[i % BRAND_COLORS.length] },
    ]),
  );

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Markup por Marca</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] bg-muted/20 animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  const hasMarkupData = data.some((d) =>
    topBrands.some((b) => d[b] != null && Number(d[b]) > 0),
  );

  if (!data.length || !topBrands.length || !hasMarkupData) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Markup por Marca</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center text-xs text-muted-foreground">
            {!data.length ? "Sem dados de marca para o período." : "Requer custo cadastrado nos anúncios."}
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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Markup por Marca</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[280px]">
          <LineChart data={formattedData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v.toFixed(1)}x`}
              width={40}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-lg border bg-background p-2 shadow-md min-w-[160px]">
                    <p className="text-xs font-medium text-foreground mb-1.5">{label}</p>
                    {payload.map((entry: any, i: number) => (
                      <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full shrink-0" style={{ background: entry.color }} />
                          <span className="text-muted-foreground">{entry.name}</span>
                        </div>
                        <span className="font-mono font-medium text-foreground">{Number(entry.value).toFixed(2)}x</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {topBrands.map((brand, i) => (
              <Line
                key={brand}
                type="monotone"
                dataKey={brand}
                stroke={BRAND_COLORS[i % BRAND_COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
