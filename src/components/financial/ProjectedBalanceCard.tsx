// ============================================================================
// ProjectedBalanceCard — "Quanto vou ter?"
// Consome useProjectedBalance — card Projeção Futura da página /fluxo-de-caixa
// CASH-05
// ============================================================================

import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectedBalance } from "@/hooks/useProjectedBalance";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const parseDateOnly = (iso: string): Date => {
  const [y, m, d] = iso.substring(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

// ─── Componente ───────────────────────────────────────────────────────────────

export function ProjectedBalanceCard() {
  const { data, isLoading, isError } = useProjectedBalance(120);

  const targetDate = addDays(new Date(), 120);
  const targetLabel = format(targetDate, "dd/MM/yyyy");

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-destructive">Erro ao carregar projeção de saldo.</p>
        </CardContent>
      </Card>
    );
  }

  const pessimistic = data?.pessimistic_balance ?? 0;
  const realistic = data?.realistic_balance ?? 0;
  const criticalDate = data?.critical_date ?? null;

  const isPessimisticPositive = pessimistic >= 0;
  const isRealisticPositive = realistic >= 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Cabeçalho */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
            {isRealisticPositive ? (
              <TrendingUp className="w-4 h-4 text-kpi-positive" />
            ) : (
              <TrendingDown className="w-4 h-4 text-kpi-negative" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
              Quanto vou ter?
            </p>
            <p className="text-[11px] text-muted-foreground/60">
              Projeção até {targetLabel}
            </p>
          </div>
        </div>

        {/* Dois cenários lado a lado */}
        {data ? (
          <div className="grid grid-cols-2 gap-2">
            {/* Pessimista */}
            <div className="space-y-1 p-3 rounded-lg border border-border/60 bg-muted/20">
              <p className="text-[10px] uppercase text-muted-foreground tracking-wide">
                Pessimista
              </p>
              <p
                className={`text-base font-bold tabular-nums leading-tight ${
                  isPessimisticPositive ? "text-kpi-positive" : "text-kpi-negative"
                }`}
              >
                {currFmt(pessimistic)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Só vendas confirmadas
              </p>
            </div>

            {/* Realista */}
            <div className="space-y-1 p-3 rounded-lg border border-primary/30 bg-primary/5">
              <p className="text-[10px] uppercase text-primary/70 tracking-wide">
                Realista
              </p>
              <p
                className={`text-base font-bold tabular-nums leading-tight ${
                  isRealisticPositive ? "text-kpi-positive" : "text-kpi-negative"
                }`}
              >
                {currFmt(realistic)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                + média dos últimos 15 dias
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/70">
            Nenhuma projeção disponível — sincronize Mercado Pago e Tiny para ver o caixa futuro.
          </p>
        )}

        {/* Alerta data crítica — "seu saldo fica negativo em DD/MM" */}
        {criticalDate && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-destructive/40 bg-destructive/5">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
            <p className="text-[11px] text-destructive leading-tight">
              Atenção: saldo fica negativo em{" "}
              <span className="font-semibold">
                {format(parseDateOnly(criticalDate), "dd 'de' MMMM", { locale: ptBR })}
              </span>
              {data?.min_balance !== undefined && (
                <>
                  {" "}(mín. {currFmt(data.min_balance)})
                </>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
