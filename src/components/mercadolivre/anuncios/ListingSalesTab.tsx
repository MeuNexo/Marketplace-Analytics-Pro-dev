/**
 * Aba "Vendas" do modal de detalhe do anúncio ML.
 *
 * - Gráfico recharts: barras para unidades, área/linha para receita.
 * - Toggle métrica: "Unidades" vs "Receita (R$)".
 * - Seletor janela: 30 dias / 90 dias (refaz a consulta ao trocar).
 * - Estados: loading (skeleton), empty, error, success.
 *
 * Phase: 73-aba-vendas / Plan 01
 */

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";
import type { ProductItem } from "@/contexts/MLInventoryContext";
import { currencyFmt } from "./listingHelpers";
import { useMLListingSales } from "./useMLListingSales";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ListingSalesTabProps {
  item: ProductItem;
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

type Metric = "unidades" | "receita";
type Window = 30 | 90;

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * Renderiza o conteúdo da aba Vendas.
 * Nunca lança erro fora do componente — todos os estados são tratados inline.
 */
export function ListingSalesTab({ item }: ListingSalesTabProps) {
  const [metric, setMetric]   = useState<Metric>("unidades");
  const [window, setWindow]   = useState<Window>(30);

  const { status, points } = useMLListingSales(item, window);

  return (
    <div className="space-y-3">
      {/* ── Controles ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Toggle métrica */}
        <ToggleGroup
          type="single"
          value={metric}
          onValueChange={(v) => { if (v) setMetric(v as Metric); }}
          className="border rounded-md"
          aria-label="Métrica do gráfico"
        >
          <ToggleGroupItem value="unidades" className="text-xs h-7 px-3">
            Unidades
          </ToggleGroupItem>
          <ToggleGroupItem value="receita" className="text-xs h-7 px-3">
            Receita (R$)
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Seletor de janela */}
        <ToggleGroup
          type="single"
          value={String(window)}
          onValueChange={(v) => { if (v) setWindow(Number(v) as Window); }}
          className="border rounded-md"
          aria-label="Janela de tempo"
        >
          <ToggleGroupItem value="30" className="text-xs h-7 px-3">
            30 dias
          </ToggleGroupItem>
          <ToggleGroupItem value="90" className="text-xs h-7 px-3">
            90 dias
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* ── Estados ────────────────────────────────────────────────────── */}

      {status === "loading" && (
        <div
          aria-label="Carregando vendas do anúncio"
          className="space-y-2 pt-1"
        >
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-[220px] w-full rounded-md" />
        </div>
      )}

      {status === "empty" && (
        <div className="flex items-center justify-center h-[220px] rounded-md border border-dashed border-border bg-muted/30">
          <p className="text-sm text-muted-foreground">
            Sem vendas no período
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="flex items-center gap-2 text-destructive pt-1">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p className="text-sm">Não foi possível carregar as vendas</p>
        </div>
      )}

      {status === "success" && (
        <SalesChart points={points} metric={metric} />
      )}
    </div>
  );
}

// ─── Subcomponente de gráfico ─────────────────────────────────────────────────

interface SalesChartProps {
  points: { date: string; label: string; unidades: number; receita: number }[];
  metric: Metric;
}

function SalesChart({ points, metric }: SalesChartProps) {
  // Intervalo adaptativo no eixo X para evitar sobreposição de labels
  const tickInterval = points.length > 30 ? 8 : 4;

  if (metric === "unidades") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={points}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.3}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            stroke="hsl(var(--muted-foreground))"
            interval={tickInterval}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            stroke="hsl(var(--muted-foreground))"
          />
          <RechartsTooltip
            formatter={(value: number) => [value, "Unidades"]}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid hsl(var(--border))",
              backgroundColor: "hsl(var(--card))",
              color: "hsl(var(--card-foreground))",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            }}
          />
          <Bar
            dataKey="unidades"
            fill="hsl(var(--primary))"
            radius={[4, 4, 0, 0]}
            maxBarSize={20}
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  // metric === "receita" — Area/Line
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={points}>
        <defs>
          <linearGradient id="salesRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="hsl(var(--accent))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          opacity={0.3}
        />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          stroke="hsl(var(--muted-foreground))"
          interval={tickInterval}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          stroke="hsl(var(--muted-foreground))"
          tickFormatter={(v) => currencyFmt(v).replace("R$ ", "R$")}
        />
        <RechartsTooltip
          formatter={(value: number) => [currencyFmt(value), "Receita"]}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid hsl(var(--border))",
            backgroundColor: "hsl(var(--card))",
            color: "hsl(var(--card-foreground))",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        />
        <Area
          type="monotone"
          dataKey="receita"
          stroke="hsl(var(--accent))"
          fill="url(#salesRevenue)"
          strokeWidth={2}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
