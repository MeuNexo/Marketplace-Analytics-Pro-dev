// ============================================================================
// TodayBalanceCard — "Quanto tenho hoje?"
// Consome useTodayBalance — card Caixa Hoje da página /fluxo-de-caixa
// CASH-05
// ============================================================================

import { CalendarCheck2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTodayBalance } from "@/hooks/useTodayBalance";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ─── Componente ───────────────────────────────────────────────────────────────

export function TodayBalanceCard() {
  const { data, isLoading, isError } = useTodayBalance();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-destructive">Erro ao carregar saldo do dia.</p>
        </CardContent>
      </Card>
    );
  }

  const saldo = data?.saldo_final_previsto ?? 0;
  const isSaldoPositivo = saldo >= 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Cabeçalho */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
            <CalendarCheck2 className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
              Quanto tenho hoje?
            </p>
            <p className="text-[11px] text-muted-foreground/60">Caixa Hoje</p>
          </div>
        </div>

        {/* Valor principal */}
        <div>
          <p
            className={`text-2xl font-bold tabular-nums leading-none ${
              isSaldoPositivo ? "text-kpi-positive" : "text-kpi-negative"
            }`}
          >
            {data ? currFmt(saldo) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Saldo previsto ao final do dia
          </p>
        </div>

        {/* Breakdown: saldo inicial, entradas, saídas */}
        {data && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40">
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase text-muted-foreground tracking-wide">
                Início
              </p>
              <p className="text-xs font-semibold tabular-nums">
                {currFmt(data.saldo_inicial)}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase text-kpi-positive tracking-wide">
                + Entradas
              </p>
              <p className="text-xs font-semibold tabular-nums text-kpi-positive">
                {currFmt(data.entradas_hoje)}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase text-kpi-negative tracking-wide">
                - Saídas
              </p>
              <p className="text-xs font-semibold tabular-nums text-kpi-negative">
                {currFmt(data.saidas_hoje)}
              </p>
            </div>
          </div>
        )}

        {/* Empty: sem dados ainda */}
        {!data && !isLoading && (
          <p className="text-xs text-muted-foreground/70">
            Nenhum dado disponível — sincronize Mercado Pago e Tiny para ver o caixa do dia.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
