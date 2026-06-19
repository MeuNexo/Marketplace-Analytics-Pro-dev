// ============================================================================
// useTodayBalance — saldo do dia via RPC get_daily_balance
// CASH-05
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { brToday } from "@/lib/brDate";

export interface TodayBalanceData {
  saldo_inicial: number;
  entradas_hoje: number;
  saidas_hoje: number;
  saldo_final_previsto: number;
}

export function useTodayBalance() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<TodayBalanceData | null>({
    queryKey: ["cashflow", "today_balance", orgId] as const,
    enabled: !!orgId,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<TodayBalanceData | null> => {
      if (!orgId) return null;

      const today = brToday(); // dia BRT — NÃO usar toISOString (UTC adianta o dia à noite)

      const { data, error } = await supabase.rpc("get_daily_balance", {
        p_org_id:      orgId,
        p_target_date: today,
      });

      if (error) throw error;

      const r = data?.[0];
      if (!r) return null;

      return {
        saldo_inicial:        Number(r.saldo_inicial        ?? 0),
        entradas_hoje:        Number(r.entradas_hoje        ?? 0),
        saidas_hoje:          Number(r.saidas_hoje          ?? 0),
        saldo_final_previsto: Number(r.saldo_final_previsto ?? 0),
      };
    },
  });
}
