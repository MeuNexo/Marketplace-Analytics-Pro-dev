// ============================================================================
// useCashFlowData — série diária futura para o gráfico de fluxo de caixa
// Modelo "futuro-only" (2026-06-18):
//   - Chama get_cashflow(org, hoje, hoje+90)
//   - accumulated_balance já é o saldo projetado dia a dia (vem do RPC)
//   - NÃO há mais passado, SMA separada ou get_projected_balance_summary
//   - Ponto de partida = financial_settings.initial_balance (editável pelo lojista)
// CASH-04
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface CashFlowDataPoint {
  /** Data formatada dd/MM para exibição */
  date: string;
  /** Data completa yyyy-MM-dd para lookup */
  fullDate: string;
  daily_income: number;
  daily_expense: number;
  /** Entrada média projetada do dia (v_sma = média de recebimento 15d). Usada na "+ Previsão" do tooltip. */
  daily_projection: number;
  daily_balance: number;
  /**
   * Saldo projetado acumulado (CONFIRMADO) retornado pelo RPC get_cashflow.
   * Parte do initial_balance e acumula entradas confirmadas (MP) - saídas.
   */
  accumulated_balance: number;
  /**
   * Saldo projetado acumulado (linha âmbar) — regra combinada (CASHFIX-01):
   * - Dias 1-7 a partir de hoje(BRT): usa apenas o recebimento CONFIRMADO do dia (d.inc),
   *   sem aplicar média — a venda de hoje já consta nos recebimentos agendados pelo MP.
   * - A partir do 8º dia: usa o confirmado nos dias COM recebimento (d.inc > 0);
   *   aplica a média de recebimento dos últimos 15 dias (v_sma) SOMENTE nos dias SEM
   *   recebimento confirmado (d.inc = 0), preenchendo os "buracos" futuros.
   * Saídas reais (d.exp) são subtraídas em todos os casos. Cenário "se mantiver a média nos dias vazios".
   */
  accumulated_balance_sma: number;
  /** true se saldo projetado CONFIRMADO neste dia for negativo */
  isNegative: boolean;
}

export function useCashFlowData(startDate: string, endDate: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<CashFlowDataPoint[]>({
    queryKey: ["cashflow", "series", orgId, startDate, endDate] as const,
    enabled: !!orgId && !!startDate && !!endDate,
    staleTime: 3 * 60 * 1000,
    queryFn: async (): Promise<CashFlowDataPoint[]> => {
      if (!orgId) return [];

      const start = startDate.substring(0, 10);
      const end   = endDate.substring(0, 10);

      const { data: rpcSeries, error: seriesError } = await supabase.rpc("get_cashflow", {
        p_org_id:     orgId,
        p_start_date: start,
        p_end_date:   end,
      });

      if (seriesError) throw seriesError;

      const rows: Array<{
        date: string;
        daily_income: number;
        daily_expense: number;
        daily_projection: number;
        daily_balance: number;
        accumulated_balance: number;
        accumulated_balance_sma: number;
      }> = (rpcSeries ?? []).map((r: any) => ({
        date:                    String(r.date ?? "").substring(0, 10),
        daily_income:            Number(r.daily_income            ?? 0),
        daily_expense:           Number(r.daily_expense           ?? 0),
        daily_projection:        Number(r.daily_projection        ?? 0),
        daily_balance:           Number(r.daily_balance           ?? 0),
        accumulated_balance:     Number(r.accumulated_balance     ?? 0),
        accumulated_balance_sma: Number(r.accumulated_balance_sma ?? 0),
      }));

      return rows.map((row) => {
        const dateFormatted = `${row.date.substring(8, 10)}/${row.date.substring(5, 7)}`;
        return {
          date:               dateFormatted,
          fullDate:           row.date,
          daily_income:       row.daily_income,
          daily_expense:      row.daily_expense,
          daily_projection:   row.daily_projection,
          daily_balance:      row.daily_balance,
          accumulated_balance: row.accumulated_balance,
          accumulated_balance_sma: row.accumulated_balance_sma,
          isNegative:         row.accumulated_balance < 0,
        };
      });
    },
  });
}
