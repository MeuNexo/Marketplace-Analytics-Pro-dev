// ============================================================================
// CapacityCard — "Posso comprar mais estoque?"
// Consome useFinancialHealth — status SAFE/DANGER com capacidade de compra
// CASH-05
// ============================================================================

import { TrendingUp, AlertTriangle, Shield } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFinancialHealth } from "@/hooks/useFinancialHealth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ─── Componente ───────────────────────────────────────────────────────────────

export function CapacityCard() {
  const { capacidade, status, message, componentes, isLoading, isError } = useFinancialHealth();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-destructive">Erro ao calcular capacidade de compra.</p>
        </CardContent>
      </Card>
    );
  }

  const isSafe = status === "SAFE";

  return (
    <Card
      className={
        isSafe
          ? "border-kpi-positive/30 bg-kpi-positive/5"
          : "border-kpi-negative/30 bg-kpi-negative/5"
      }
    >
      <CardContent className="p-4 space-y-4">
        {/* Cabeçalho */}
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center ${
              isSafe ? "bg-kpi-positive/10" : "bg-kpi-negative/10"
            }`}
          >
            {isSafe ? (
              <TrendingUp className="w-4 h-4 text-kpi-positive" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-kpi-negative" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
              Posso comprar mais estoque?
            </p>
            <p className="text-[11px] text-muted-foreground/60">Capacidade de Compra</p>
          </div>
        </div>

        {/* Status badge + valor */}
        <div
          className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg ${
            isSafe ? "bg-kpi-positive/10" : "bg-kpi-negative/10"
          }`}
        >
          <span
            className={`text-xs font-bold uppercase tracking-wide ${
              isSafe ? "text-kpi-positive" : "text-kpi-negative"
            }`}
          >
            {isSafe ? "SEGURO" : "ATENÇÃO"}
          </span>
          <span
            className={`text-xl font-bold tabular-nums ${
              isSafe ? "text-kpi-positive" : "text-kpi-negative"
            }`}
          >
            {currFmt(capacidade)}
          </span>
        </div>

        {/* Mensagem leiga */}
        <p
          className={`text-xs leading-relaxed font-medium ${
            isSafe ? "text-kpi-positive" : "text-kpi-negative"
          }`}
        >
          {message}
        </p>

        {/* Breakdown em grid 2×2 */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40">
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wide">
              Saldo atual
            </p>
            <p className="text-xs font-semibold tabular-nums">
              {currFmt(componentes.saldo_atual)}
            </p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wide">
              Entradas (30d)
            </p>
            <p className="text-xs font-semibold tabular-nums text-kpi-positive">
              {currFmt(componentes.confirmed_income)}
            </p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wide">
              Projeção SMA
            </p>
            <p className="text-xs font-semibold tabular-nums text-kpi-positive">
              {currFmt(componentes.sma_23d)}
            </p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wide">
              Saídas (30d)
            </p>
            <p className="text-xs font-semibold tabular-nums text-kpi-negative">
              {currFmt(componentes.total_expenses)}
            </p>
          </div>
        </div>

        {/* Margem de segurança */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Shield className="w-3 h-3 shrink-0" />
          <span>Margem de segurança reservada: {currFmt(componentes.safety_margin)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
