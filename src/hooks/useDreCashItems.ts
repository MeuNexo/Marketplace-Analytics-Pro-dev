// ============================================================================
// useDreCashItems — Phase 99 Plan 02, Task 2
// Hook TanStack Query que consome a RPC get_dre_cash_items (Plano 99-01) —
// drill-down de lançamentos individuais de um bloco, sob demanda (só dispara
// quando o usuário clica em um bloco da cascata, spec seção 6.3).
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

/** Lançamento individual de cash_outflows retornado pelo drill-down. */
export interface DreCashItem {
  outflow_date: string;
  supplier: string | null;
  category: string | null;
  amount: number;
  document_number: string | null;
}

/**
 * Busca os lançamentos individuais de um bloco da cascata (drill-down).
 *
 * @param pMonth "YYYY-MM-01" — mesma regra de useDreCash.
 * @param bloco Bloco selecionado pelo clique do usuário; null = drill-down
 *        fechado (hook não dispara).
 */
export function useDreCashItems(pMonth: string, bloco: string | null) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<DreCashItem[]>({
    queryKey: ["dre-cash-items", orgId, pMonth, bloco] as const,
    enabled: !!orgId && !!pMonth && !!bloco,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DreCashItem[]> => {
      if (!orgId || !bloco) return [];

      const { data, error } = await supabase.rpc("get_dre_cash_items", {
        p_org_id: orgId,
        p_month: pMonth,
        p_bloco: bloco,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        outflow_date: String(r.outflow_date),
        supplier: r.supplier === null || r.supplier === undefined ? null : String(r.supplier),
        category: r.category === null || r.category === undefined ? null : String(r.category),
        amount: Number(r.amount ?? 0),
        document_number:
          r.document_number === null || r.document_number === undefined
            ? null
            : String(r.document_number),
      }));
    },
  });
}
