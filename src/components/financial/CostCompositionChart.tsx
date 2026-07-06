// ============================================================================
// CostCompositionChart — Composição de Custos por Mês (barras empilhadas)
// Consome useCostByMonth; pivot/ranking/fold em src/lib/costCompositionData.
// Cor por ÍNDICE a partir de paleta categórica CVD-safe (skill dataviz),
// não por casamento de rótulo literal — categorias novas do Tiny recebem cor
// automaticamente. TESO-02 / D-12 / Phase 85.
// ============================================================================

import { useMemo } from "react";
import { useTheme } from "next-themes";
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
import { useCostByMonth } from "@/hooks/useCostByMonth";
import {
  buildCostComposition,
  OTHER_LABEL,
} from "@/lib/costCompositionData";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ─── Paleta categórica CVD-safe (skill dataviz — validada com validate_palette) ─
// Slots em ordem FIXA (a ordem é o mecanismo de separação CVD, não cosmética).
// Ambos os modos validam: light worst adjacent ΔE 24.2 · dark 10.3 (floor band,
// legalizado pelo gap de superfície entre segmentos). O balde "Outros" é cinza
// neutro de propósito — catch-all, nunca uma hue.
const SERIES_LIGHT = [
  "#2a78d6", // blue
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
];
const SERIES_DARK = [
  "#3987e5",
  "#199e70",
  "#c98500",
  "#008300",
  "#9085e9",
  "#e66767",
];
const OTHER_COLOR = "#898781"; // cinza neutro, mesmo em ambos os modos

// ─── Componente ───────────────────────────────────────────────────────────────

export function CostCompositionChart() {
  const { data: rawData = [], isLoading } = useCostByMonth(9);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const series = isDark ? SERIES_DARK : SERIES_LIGHT;

  const { wideData, orderedCategories } = useMemo(
    () => buildCostComposition(rawData),
    [rawData]
  );

  // Cor por índice: cada categoria mantida pega a slot i; "Outros" pega o cinza.
  const colorFor = (cat: string, i: number): string =>
    cat === OTHER_LABEL ? OTHER_COLOR : series[i] ?? OTHER_COLOR;

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

  if (wideData.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Composição de Custos por Mês
          </p>
          <p className="text-sm text-muted-foreground text-center py-12">
            Sem dados de custos disponíveis.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Composição de Custos por Mês
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={wideData}
            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={54}
            />
            <RechartsTooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(v: unknown) => currFmt(Number(v))}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {orderedCategories.map((cat, i) => (
              <Bar
                key={cat}
                dataKey={cat}
                stackId="stack"
                fill={colorFor(cat, i)}
                // Gap de superfície entre segmentos empilhados (skill dataviz):
                // hairline da cor do card → separa faixas adjacentes e serve de
                // encoding secundário que legaliza a banda CVD 8–12 no dark.
                stroke="hsl(var(--card))"
                strokeWidth={1.5}
                maxBarSize={40}
                radius={
                  i === orderedCategories.length - 1
                    ? [3, 3, 0, 0]
                    : [0, 0, 0, 0]
                }
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
