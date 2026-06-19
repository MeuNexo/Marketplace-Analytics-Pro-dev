// ============================================================================
// CashFlowChart — "Como meu dinheiro vai evoluir?"
// Modelo futuro-only (2026-06-18):
//   - UMA linha principal "Saldo projetado" (accumulated_balance)
//   - Barras ao fundo: entradas (verde) e saídas (vermelho) por dia
//   - ReferenceLine y=0 + alerta AlertTriangle quando saldo fica negativo
// CASH-04
// ============================================================================

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CashFlowDataPoint } from "@/hooks/useCashFlowData";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const tickFmt = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `R$${(v / 1_000).toFixed(0)}k`;
  return `R$${v.toFixed(0)}`;
};

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;

  const point: CashFlowDataPoint = payload[0]?.payload ?? {};

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-xs space-y-1.5 min-w-[200px]">
      <p className="font-semibold text-foreground mb-2">{label}</p>

      {/* Saldo projetado confirmado — linha principal */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Saldo (piso ~30d):</span>
        <span
          className={`font-semibold tabular-nums ${
            point.accumulated_balance < 0 ? "text-kpi-negative" : "text-kpi-positive"
          }`}
        >
          {currFmt(point.accumulated_balance)}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-0.5">
        só entradas já liberadas pelo MP (~30d)
      </p>

      {/* Saldo projetado pela média de 15 dias */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Saldo (média 15d):</span>
        <span
          className={`font-semibold tabular-nums ${
            point.accumulated_balance_sma < 0 ? "text-kpi-negative" : "text-warning"
          }`}
        >
          {currFmt(point.accumulated_balance_sma)}
        </span>
      </div>

      {/* Entradas / Saídas do dia */}
      {(point.daily_income > 0 || point.daily_expense > 0) && (
        <>
          <div className="border-t border-border/40 my-1" />
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">+ Entradas do dia:</span>
            <span className="font-medium tabular-nums text-kpi-positive">
              {currFmt(point.daily_income)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">- Saídas do dia:</span>
            <span className="font-medium tabular-nums text-kpi-negative">
              {currFmt(point.daily_expense)}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface CashFlowChartProps {
  /** Série diária retornada por useCashFlowData — accumulated_balance já é saldo projetado */
  data: CashFlowDataPoint[] | undefined;
  isLoading?: boolean;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function CashFlowChart({ data, isLoading = false }: CashFlowChartProps) {
  if (isLoading) {
    return (
      <Card>
        <div className="px-4 pt-4 pb-2">
          <Skeleton className="h-5 w-64 mb-1" />
          <Skeleton className="h-3 w-80" />
        </div>
        <CardContent className="px-4 pb-4">
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <div className="px-4 pt-4 pb-2">
          <p className="text-sm font-medium">Como meu dinheiro vai evoluir?</p>
        </div>
        <CardContent className="px-4 pb-8 pt-0 text-center">
          <p className="text-muted-foreground text-sm mt-4">
            Nenhum dado de fluxo de caixa disponível.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasNegative = data.some((p) => p.isNegative);

  // Intervalo de tick para não sobrecarregar o eixo X
  const tickInterval =
    data.length <= 30 ? 2 : data.length <= 60 ? 7 : Math.floor(data.length / 10);

  return (
    <Card>
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-medium">Como meu dinheiro vai evoluir?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Linha verde = piso confirmado (só liberações já agendadas pelo MP, ~30d) &nbsp;|&nbsp;
              Linha âmbar tracejada = projeção pela média de vendas dos últimos 15 dias
            </p>
          </div>

          {/* Alerta visual de saldo negativo */}
          {hasNegative && (
            <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 border border-destructive/40 rounded px-2.5 py-1 shrink-0">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Saldo projetado negativo — risco de caixa</span>
            </div>
          )}
        </div>
      </div>

      <CardContent className="px-4 pb-4 pt-0">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              strokeOpacity={0.5}
            />

            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              interval={tickInterval}
            />

            <YAxis
              tickFormatter={tickFmt}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={64}
            />

            <RechartsTooltip content={<CustomTooltip />} />

            <Legend
              wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
              formatter={(value) => {
                if (value === "accumulated_balance")     return "Saldo confirmado (piso ~30d)";
                if (value === "accumulated_balance_sma") return "Projeção média de vendas 15d";
                return value;
              }}
            />

            {/* ReferenceLine y=0 — guia neutra (cinza) */}
            <ReferenceLine
              y={0}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: "R$0",
                position: "insideTopRight",
                fill: "hsl(var(--muted-foreground))",
                fontSize: 10,
              }}
            />

            {/* LINHA PRINCIPAL — Saldo projetado confirmado (verde) */}
            <Line
              type="monotone"
              dataKey="accumulated_balance"
              name="accumulated_balance"
              stroke="hsl(var(--kpi-positive))"
              strokeWidth={2.5}
              dot={false}
              connectNulls
            />

            {/* LINHA SECUNDÁRIA — Projeção pela média de 15 dias.
                Cor âmbar (warning): exclusiva, não colide com o verde das
                Entradas do dia nem com o azul do Saldo confirmado. */}
            <Line
              type="monotone"
              dataKey="accumulated_balance_sma"
              name="accumulated_balance_sma"
              stroke="hsl(var(--warning))"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
