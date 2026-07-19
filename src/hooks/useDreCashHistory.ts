// ============================================================================
// useDreCashHistory — Phase 99 Plan 02, Task 2
// Hook TanStack Query que consome a RPC get_dre_cash_history (Plano 99-01) —
// série de até 12 meses (entradas × saídas × resultado) para o gráfico de
// evolução e a tabela histórico da página.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

/** Linha agregada de um mês do histórico. */
export interface DreCashHistoryRow {
  mes: string;
  entradas: number;
  saidas: number;
  resultado: number;
}

/**
 * Busca a série histórica de entradas/saídas/resultado por mês.
 *
 * @param months Quantidade de meses a buscar (default 12).
 */
export function useDreCashHistory(months: number = 12) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<DreCashHistoryRow[]>({
    queryKey: ["dre-cash-history", orgId, months] as const,
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DreCashHistoryRow[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase.rpc("get_dre_cash_history", {
        p_org_id: orgId,
        p_months: months,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        mes: String(r.mes),
        entradas: Number(r.entradas ?? 0),
        saidas: Number(r.saidas ?? 0),
        resultado: Number(r.resultado ?? 0),
      }));
    },
  });
}
