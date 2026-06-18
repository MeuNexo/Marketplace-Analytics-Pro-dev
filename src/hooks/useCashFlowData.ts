// ============================================================================
// useCashFlowData — série diária real + projeção derivada para o gráfico
// Chama get_cashflow (dados reais) + get_projected_balance_summary (projeção)
// CASH-04
//
// CONTRATO DA SÉRIE (fixo — não improvise no gráfico):
//
// Passo A: supabase.rpc('get_cashflow', ...) → série real, cada dia tem
//          accumulated_balance (saldo acumulado confirmado).
//
// Passo B: supabase.rpc('get_projected_balance_summary', ...) →
//          pessimistic_balance e realistic_balance.
//
// Passo C: derivar coluna `projected_balance` dia a dia:
//          - incremento_diario_sma = (realistic_balance − pessimistic_balance)
//                                    ÷ (dias_futuros após dia 8)
//            Nota: os primeiros 8 dias pós-hoje usam somente o acumulado real;
//            a SMA entra do dia 9 em diante (comportamento idêntico ao nexointeligence).
//            Se dias futuros = 0, usar 1 para evitar divisão por zero.
//          - data <= hoje: projected_balance = accumulated_balance (sobreposição real)
//          - data > hoje:  projected_balance = último_accumulated_real
//                          + incremento_diario_sma × dias_desde_hoje
//            onde dias_desde_hoje é contado a partir do primeiro dia futuro (= dia 1).
//
// Resultado: array de CashFlowDataPoint com ambas as colunas preenchidas.
// O componente CashFlowChart consome esta série sem lógica de projeção própria.
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
  daily_balance: number;
  /** Saldo acumulado real confirmado (disponível apenas até hoje ou datas com dados) */
  accumulated_balance: number;
  /**
   * Saldo projetado: igual a accumulated_balance nos dias com dados reais;
   * derivado da SMA de get_projected_balance_summary nos dias futuros.
   * CONTRATO: sempre preenchido — o gráfico plota esta coluna sem lógica extra.
   */
  projected_balance: number;
  isNegative: boolean;
  isNegativeProjected: boolean;
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

      // Passo A: buscar série real via get_cashflow
      const { data: rpcSeries, error: seriesError } = await supabase.rpc("get_cashflow", {
        p_org_id:     orgId,
        p_start_date: start,
        p_end_date:   end,
      });

      if (seriesError) throw seriesError;

      const seriesRows: Array<{
        date: string;
        daily_income: number;
        daily_expense: number;
        daily_balance: number;
        accumulated_balance: number;
      }> = (rpcSeries ?? []).map((r: any) => ({
        date:                String(r.date ?? "").substring(0, 10),
        daily_income:        Number(r.daily_income        ?? 0),
        daily_expense:       Number(r.daily_expense       ?? 0),
        daily_balance:       Number(r.daily_balance       ?? 0),
        accumulated_balance: Number(r.accumulated_balance ?? 0),
      }));

      // Passo B: buscar projeção via get_projected_balance_summary
      // Calcula quantos dias futuros há no range para passar ao RPC
      const today      = new Date();
      today.setHours(0, 0, 0, 0);
      const endDateObj = new Date(end + "T00:00:00");
      const futureDays = Math.max(
        1,
        Math.ceil((endDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      );

      const { data: projData, error: projError } = await supabase.rpc(
        "get_projected_balance_summary",
        {
          p_org_id:          orgId,
          p_projection_days: futureDays,
        }
      );

      if (projError) throw projError;

      const proj = projData?.[0];
      const realisticBalance  = Number(proj?.realistic_balance  ?? 0);
      const pessimisticBalance = Number(proj?.pessimistic_balance ?? 0);

      // Passo C: derivar a coluna projected_balance por dia
      //
      // Os primeiros 8 dias após hoje usam apenas o saldo real (sem SMA ainda).
      // A SMA entra nos dias 9+ (dias_futuros_ativos = futureDays − 8, mínimo 1).
      const smaActiveDays = Math.max(1, futureDays - 8);

      // incremento_diario_sma = (realistic − pessimistic) ÷ smaActiveDays
      // Nota: pessimistic_balance é o saldo acumulado confirmado no período futuro
      // (sem SMA), realistic é a projeção com SMA. A diferença dividida pelos dias
      // ativos da SMA dá o ganho líquido diário estimado.
      const incrementoDiarioSma = (realisticBalance - pessimisticBalance) / smaActiveDays;

      // Descobrir o último accumulated_balance real (último dia <= hoje com dados)
      let lastRealAccumulated = 0;
      const todayStr = today.toISOString().substring(0, 10);

      const seriesMap = new Map<string, (typeof seriesRows)[0]>();
      for (const row of seriesRows) {
        seriesMap.set(row.date, row);
        if (row.date <= todayStr) {
          lastRealAccumulated = row.accumulated_balance;
        }
      }

      // Montar todos os dias do range a partir do startDate até o endDate
      const result: CashFlowDataPoint[] = [];
      const cur = new Date(start + "T00:00:00");
      const last = new Date(end + "T00:00:00");
      let futureDayCounter = 0; // conta dias futuros após hoje (dia 1 = primeiro dia futuro)

      while (cur <= last) {
        const dateStr = cur.toISOString().substring(0, 10);
        const row = seriesMap.get(dateStr);

        const daily_income  = Number(row?.daily_income        ?? 0);
        const daily_expense = Number(row?.daily_expense       ?? 0);
        const daily_balance = Number(row?.daily_balance       ?? 0);
        const accum         = Number(row?.accumulated_balance ?? (result.length > 0 ? result[result.length - 1].accumulated_balance : lastRealAccumulated));

        // Formatar data para exibição dd/MM
        const dateFormatted = `${dateStr.substring(8, 10)}/${dateStr.substring(5, 7)}`;

        let projectedBalance: number;

        if (dateStr <= todayStr) {
          // Dias reais (passado + hoje): projected = accumulated real
          projectedBalance = row ? row.accumulated_balance : lastRealAccumulated;
        } else {
          // Dias futuros: projeção derivada da SMA
          futureDayCounter++;

          if (futureDayCounter <= 8) {
            // Primeiros 8 dias futuros: sem SMA — usar só accumulated real (pessimistic)
            projectedBalance = lastRealAccumulated + pessimisticBalance * (futureDayCounter / futureDays);
          } else {
            // Dias 9+: adicionar SMA incremental
            const smaDays = futureDayCounter - 8; // quantos dias de SMA já aplicados
            projectedBalance = lastRealAccumulated + pessimisticBalance * (futureDayCounter / futureDays)
              + incrementoDiarioSma * smaDays;
          }
        }

        result.push({
          date:               dateFormatted,
          fullDate:           dateStr,
          daily_income,
          daily_expense,
          daily_balance,
          accumulated_balance: row ? row.accumulated_balance : (result.length > 0 ? result[result.length - 1].accumulated_balance : 0),
          projected_balance:   projectedBalance,
          isNegative:          (row?.accumulated_balance ?? 0) < 0,
          isNegativeProjected: projectedBalance < 0,
        });

        cur.setDate(cur.getDate() + 1);
      }

      return result;
    },
  });
}
