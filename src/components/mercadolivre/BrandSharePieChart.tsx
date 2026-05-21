import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import type { BrandAggregate } from "@/hooks/useMLOrdersByBrand";

interface BrandSharePieChartProps {
  brandAggregates: BrandAggregate[];
  loading?: boolean;
}

const currencyFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const chartConfig = {};

export function BrandSharePieChart({ brandAggregates, loading }: BrandSharePieChartProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {i === 0 ? "Receita por Marca" : "Volume por Marca"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[260px] bg-muted/20 animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!brandAggregates.length) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {i === 0 ? "Receita por Marca" : "Volume por Marca"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[260px] flex items-center justify-center text-xs text-muted-foreground">
                Sem dados de marca para o período.
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const revData = brandAggregates.map((b) => ({
    name: b.marca,
    value: Math.round(b.receita),
    color: b.color,
  }));

  const volData = brandAggregates.map((b) => ({
    name: b.marca,
    value: b.unidades,
    color: b.color,
  }));

  const totalReceita = revData.reduce((s, d) => s + d.value, 0);
  const totalUnidades = volData.reduce((s, d) => s + d.value, 0);

  const renderCustomLabel = ({
    cx, cy, midAngle, innerRadius, outerRadius, percent,
  }: {
    cx: number;
    cy: number;
    midAngle: number;
    innerRadius: number;
    outerRadius: number;
    percent: number;
  }) => {
    if (percent < 0.04) return null;
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Receita por Marca</CardTitle>
          <p className="text-xs text-muted-foreground">Total: {currencyFmt(totalReceita)}</p>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[260px]">
            <PieChart>
              <Pie
                data={revData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                dataKey="value"
                labelLine={false}
                label={renderCustomLabel}
              >
                {revData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [currencyFmt(Number(value)), name]}
              />
              <Legend
                iconSize={10}
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value) => value}
              />
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Volume por Marca (un.)</CardTitle>
          <p className="text-xs text-muted-foreground">Total: {totalUnidades.toLocaleString("pt-BR")} un.</p>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[260px]">
            <PieChart>
              <Pie
                data={volData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                dataKey="value"
                labelLine={false}
                label={renderCustomLabel}
              >
                {volData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [`${Number(value).toLocaleString("pt-BR")} un.`, name]}
              />
              <Legend
                iconSize={10}
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value) => value}
              />
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
