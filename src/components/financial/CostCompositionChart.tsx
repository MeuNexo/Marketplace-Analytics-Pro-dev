// ============================================================================
// CostCompositionChart — Composição de Custos por Mês (barras empilhadas)
// Consome useCostByMonth, pivot long→wide com useMemo, categorias dinâmicas
// TESO-02 / D-12
// ============================================================================

import { useMemo } from "react";
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ─── Categoria color map (dinâmico — categorias novas recebem fallback) ───────

const CATEGORY_COLORS: Record<string, string> = {
  "Fornecedores":         "#64748b",
  "Salários":             "#10b981",
  "Impostos/taxas":       "#8b5cf6",
  "Aluguéis/condomínio":  "#f59e0b",
  "Contabilidade":        "#3b82f6",
  "Cartão de crédito":    "#f43f5e",
  "Água/luz":             "#06b6d4",
  "Serviços gerais":      "#f97316",
  "Empréstimo":           "#a855f7",
  "Outros":               "hsl(220, 10%, 60%)",
};

// ─── Componente ───────────────────────────────────────────────────────────────

export function CostCompositionChart() {
  const { data: rawData = [], isLoading } = useCostByMonth(9);

  // Pivot long→wide para recharts BarChart empilhado
  const { wideData, allCategories } = useMemo(() => {
    const monthMap = new Map<string, Record<string, number | string>>();

    for (const row of rawData) {
      if (!monthMap.has(row.month)) {
        // Display label: "2026-04" → "abr./26" → normalizado para "Abr/26"
        const [y, m] = row.month.split("-");
        const raw = new Date(Number(y), Number(m) - 1).toLocaleString("pt-BR", {
          month: "short",
          year: "2-digit",
        });
        // Normalizar: "abr. de 26" / "abr./26" / "abr. 26" → "Abr/26"
        const label = raw
          .replace(/\.\s*de\s*/gi, "/")
          .replace(/\./g, "")
          .replace(/\s+/g, "/")
          .replace(/^(\w)/, (c) => c.toUpperCase());
        monthMap.set(row.month, { month: label, _sort: row.month });
      }
      (monthMap.get(row.month) as Record<string, number | string>)[row.category] = row.total;
    }

    const wideData = [...monthMap.values()].sort((a, b) =>
      String(a._sort).localeCompare(String(b._sort))
    );

    const allCategories = [...new Set(rawData.map((r) => r.category))];

    return { wideData, allCategories };
  }, [rawData]);

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
            {allCategories.map((cat, i) => (
              <Bar
                key={cat}
                dataKey={cat}
                stackId="stack"
                fill={CATEGORY_COLORS[cat] ?? "#94a3b8"}
                maxBarSize={40}
                radius={i === allCategories.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
