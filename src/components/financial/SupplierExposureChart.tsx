// ============================================================================
// SupplierExposureChart — Exposição por Fornecedor (barras agrupadas 30/60/90d)
// Consome useSupplierExposure, 3 Bars sem stackId (agrupado)
// TESO-02 / D-13
// ============================================================================

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupplierExposure } from "@/hooks/useSupplierExposure";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const truncate = (s: string, n = 12): string =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

// ─── Componente ───────────────────────────────────────────────────────────────

export function SupplierExposureChart() {
  const { data: exposureData = [], isLoading } = useSupplierExposure(10);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-[280px] rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (exposureData.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Exposição por Fornecedor
          </p>
          <p className="text-sm text-muted-foreground text-center py-12">
            Sem dados de exposição disponíveis.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Exposição por Fornecedor
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={exposureData}
            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
            barGap={2}
            barCategoryGap="20%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="supplier"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(s) => truncate(s)}
            />
            <YAxis
              tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <RechartsTooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(v: unknown, name: string) => [currFmt(Number(v)), name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="amount_30d" name="≤ 30d" fill="#3b82f6" maxBarSize={20} radius={[3, 3, 0, 0]} />
            <Bar dataKey="amount_60d" name="≤ 60d" fill="#f59e0b" maxBarSize={20} radius={[3, 3, 0, 0]} />
            <Bar dataKey="amount_90d" name="≤ 90d" fill="#ef4444" maxBarSize={20} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
