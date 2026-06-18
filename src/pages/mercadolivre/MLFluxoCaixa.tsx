// ============================================================================
// MLFluxoCaixa — /fluxo-de-caixa
// Página: header + 3 cards (Caixa Hoje, Projeção Futura, Capacidade de Compra)
//         + gráfico "Como meu dinheiro vai evoluir?" (120 dias à frente)
// CASH-04
// ============================================================================

import { useMemo } from "react";
import { format, addDays, subDays } from "date-fns";
import { Banknote } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { TodayBalanceCard } from "@/components/financial/TodayBalanceCard";
import { ProjectedBalanceCard } from "@/components/financial/ProjectedBalanceCard";
import { CapacityCard } from "@/components/financial/CapacityCard";
import { CashFlowChart } from "@/components/financial/CashFlowChart";
import { useCashFlowData } from "@/hooks/useCashFlowData";
import { useOrganization } from "@/contexts/OrganizationContext";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HISTORY_DAYS = 90;  // dias históricos mostrados antes de hoje
const FUTURE_DAYS  = 120; // dias de projeção à frente

// ─── Empty state ───────────────────────────────────────────────────────────────

function CashFlowEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 border border-dashed border-border/50 rounded-xl bg-muted/20">
      <Banknote className="w-12 h-12 text-muted-foreground/30" />
      <p className="text-sm font-medium text-muted-foreground">
        Dados de caixa não encontrados
      </p>
      <p className="text-xs text-muted-foreground/70 text-center max-w-xs">
        Sincronize o Mercado Pago (entradas) e o Tiny ERP (saídas) para ver
        o fluxo de caixa real da sua operação.
      </p>
    </div>
  );
}

// ─── Página ────────────────────────────────────────────────────────────────────

export default function MLFluxoCaixa() {
  const { currentOrg } = useOrganization();

  // Período: 90 dias de histórico → hoje → 120 dias de projeção
  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    return {
      startDate: format(subDays(today, HISTORY_DAYS), "yyyy-MM-dd"),
      endDate:   format(addDays(today, FUTURE_DAYS),  "yyyy-MM-dd"),
    };
  }, []);

  // Série para o gráfico (real + projetada)
  const { data: cashFlowData, isLoading: chartLoading } = useCashFlowData(
    startDate,
    endDate,
  );

  // Loading state da página inteira (antes de ter org)
  const isPageLoading = !currentOrg;

  if (isPageLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-56" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const hasData =
    cashFlowData &&
    cashFlowData.length > 0 &&
    cashFlowData.some((p) => p.daily_income > 0 || p.daily_expense > 0);

  return (
    <div className="space-y-6">

      {/* ── Header sticky ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <MLPageHeader title="Fluxo de Caixa" />
      </div>

      {/* ── Grid 3 cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TodayBalanceCard />
        <ProjectedBalanceCard />
        <CapacityCard />
      </div>

      {/* ── Gráfico: Como meu dinheiro vai evoluir? ── */}
      {chartLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : hasData ? (
        <CashFlowChart data={cashFlowData} isLoading={false} />
      ) : (
        <CashFlowEmptyState />
      )}

    </div>
  );
}
