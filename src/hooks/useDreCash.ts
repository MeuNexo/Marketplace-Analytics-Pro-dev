// ============================================================================
// useDreCash — Phase 99 Plan 02, Task 2
// Hook TanStack Query que consome a RPC get_dre_cash (Plano 99-01), escopado
// por org (currentOrg.id do OrganizationContext).
//
// Padrão clonado de useDreOperational.ts (RPC + useOrganization + useQuery).
// Anti-IDOR é garantido server-side (RPC SECURITY INVOKER + RLS is_org_member).
// O frontend só passa a org do contexto — não re-filtra.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { DreCashRow } from "@/lib/dreCashCascade";

/**
 * Busca as linhas cruas (entrada/saida/previsao) do DRE Caixa do mês.
 *
 * @param pMonth DEVE ser uma string de primeiro-dia-do-mês ("YYYY-MM-01") —
 *        NUNCA "YYYY-MM" (o cast para `date` do Postgres falha). Mesma regra
 *        de useDreOperational.
 */
export function useDreCash(pMonth: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<DreCashRow[]>({
    queryKey: ["dre-cash", orgId, pMonth] as const,
    enabled: !!orgId && !!pMonth,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DreCashRow[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase.rpc("get_dre_cash", {
        p_org_id: orgId,
        p_month: pMonth,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        secao: String(r.secao),
        bloco: r.bloco === null || r.bloco === undefined ? null : String(r.bloco),
        categoria: String(r.categoria),
        // numeric do Postgres pode chegar como string em alguns drivers —
        // normalizar, preservando null (previsão sem dado suficiente).
        total: r.total === null || r.total === undefined ? null : Number(r.total),
        n: Number(r.n ?? 0),
      }));
    },
  });
}
