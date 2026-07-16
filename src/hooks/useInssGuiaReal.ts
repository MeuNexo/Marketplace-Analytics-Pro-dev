// ============================================================================
// useInssGuiaReal — Phase 98 Plan 02, Task 2
//
// Mirror 1:1 de useImpostoGuiaReal (src/hooks/useImpostoGuiaReal.ts): busca a
// guia real de INSS de folha em `p_competence = monthPlusOne(saleMonth)` — o
// mesmo deslocamento M+1 já usado para ICMS/PIS/COFINS (a guia de INSS de M
// sai/vence em M+1). Chama a RPC dedicada de INSS (clone da RPC de imposto
// de venda `get_imposto_guia_by_competence`, mas filtrando 1 categoria só —
// "Pessoal - INSS", ver src/lib/dreInss.ts INSS_FOLHA_CATEGORY). A RPC é
// SECURITY INVOKER, protegida por RLS org-first (mesmo padrão já provado nas
// Phases 87/94/96) — nenhum novo trust boundary.
//
// NÃO clona `useImpostoGuiaNudge` — o empurrãozinho de 3 sinais está fora de
// escopo desta phase (CONTEXT.md <deferred>). Sem `.test.ts` companion, mesmo
// padrão do hook irmão (só hooks com mapeamento mais complexo, como
// useDreOperational, têm teste próprio).
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { monthPlusOne } from "@/lib/dreRegime";
import type { GuiaRealCategoryTotal } from "@/lib/dreRegime";

/**
 * A fonte M+1 do INSS de folha real para o bloco Pessoal.
 *
 * @param saleMonth "YYYY-MM-01" — o mês de venda M exibido. A RPC é chamada
 *        em p_competence = monthPlusOne(saleMonth) (M+1).
 */
export function useInssGuiaReal(saleMonth: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const pCompetence = saleMonth ? monthPlusOne(saleMonth) : null;

  return useQuery<GuiaRealCategoryTotal[]>({
    queryKey: ["dre", "inss-guia", orgId, pCompetence] as const,
    enabled: !!orgId && !!saleMonth,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<GuiaRealCategoryTotal[]> => {
      if (!orgId || !pCompetence) return [];

      const { data, error } = await supabase.rpc("get_inss_guia_by_competence", {
        p_org_id: orgId,
        p_competence: pCompetence,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        category: String(r.category),
        total: Number(r.total ?? 0),
        status: String(r.status ?? ""),
      }));
    },
  });
}
