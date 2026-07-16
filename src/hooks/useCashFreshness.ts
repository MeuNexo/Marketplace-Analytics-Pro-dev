// ============================================================================
// useCashFreshness — Phase 99 Plan 02, Task 2 (DREC-06)
// Frescor de cash_inflows/cash_outflows para o banner "dado velho" da DRE
// Caixa. Query RLS direta (sem RPC nova — recomendação do 99-RESEARCH: leitura
// trivial de 1 coluna/1 linha, mesmo padrão de useMLLastSync.ts).
//
// Expõe as DUAS fontes SEPARADAMENTE (nunca um único "synced_at" combinado):
// lição 2026-07-13 — o token Tiny já morreu silenciosamente antes e travou só
// cash_outflows sem travar cash_inflows; o banner precisa acusar cada fonte
// por si, senão o dado velho de uma fonte fica mascarado pelo dado fresco da
// outra.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface CashFreshness {
  inflowsSyncedAt: string | null;
  outflowsSyncedAt: string | null;
}

/**
 * Busca o `synced_at` mais recente de `cash_inflows` e `cash_outflows`,
 * separadamente, para a org atual.
 */
export function useCashFreshness() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<CashFreshness>({
    queryKey: ["cash-freshness", orgId] as const,
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CashFreshness> => {
      if (!orgId) return { inflowsSyncedAt: null, outflowsSyncedAt: null };

      const [inflows, outflows] = await Promise.all([
        supabase
          .from("cash_inflows")
          .select("synced_at")
          .eq("organization_id", orgId)
          .order("synced_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("cash_outflows")
          .select("synced_at")
          .eq("organization_id", orgId)
          .order("synced_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (inflows.error) throw inflows.error;
      if (outflows.error) throw outflows.error;

      return {
        inflowsSyncedAt: inflows.data?.synced_at ?? null,
        outflowsSyncedAt: outflows.data?.synced_at ?? null,
      };
    },
  });
}
