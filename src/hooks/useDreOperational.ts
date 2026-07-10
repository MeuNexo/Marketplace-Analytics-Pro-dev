// ============================================================================
// useDreOperational — Phase 88 Plan 01, Task 2
// Hook TanStack Query que consome a RPC 87 get_dre_operational_by_competence,
// escopado por org (currentOrg.id do OrganizationContext).
//
// Padrão clonado de useCostByMonth.ts (RPC + useOrganization + useQuery).
// Anti-IDOR é garantido server-side (RPC SECURITY INVOKER + RLS is_org_member,
// provado na Phase 87). O frontend só passa a org do contexto — não re-filtra.
//
// Os tipos DreBloco/DreOperationalRow são a fonte única em src/lib/dreCascade.ts
// e re-exportados aqui para os consumidores do hook.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { DreBloco, DreOperationalRow } from "@/lib/dreCascade";

export type { DreBloco, DreOperationalRow };

/**
 * Busca as linhas operacionais/financeiras do DRE por competência.
 *
 * @param pMonth DEVE ser uma string de primeiro-dia-do-mês ("YYYY-MM-01") —
 *        NUNCA "YYYY-MM" (Pitfall 3: o cast para `date` do Postgres falha).
 *        Use `billingMonthFrom`/`monthlyFrom` já derivados em MercadoLivre.tsx.
 */
export function useDreOperational(pMonth: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<DreOperationalRow[]>({
    queryKey: ["dre", "operational", orgId, pMonth] as const,
    enabled: !!orgId && !!pMonth,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DreOperationalRow[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase.rpc("get_dre_operational_by_competence", {
        p_org_id: orgId,
        p_month: pMonth,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        bloco: r.bloco as DreBloco,
        category: String(r.category),
        total: Number(r.total ?? 0),
        n: Number(r.n ?? 0),
        double_count_risk: Boolean(r.double_count_risk),
      }));
    },
  });
}
