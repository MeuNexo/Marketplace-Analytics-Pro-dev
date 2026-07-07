// ============================================================================
// useImpostoGuia — react-query hook para get_imposto_guia_by_competence.
// Consulta a guia de imposto (ICMS/PIS/COFINS) por competência e aplica
// evaluateGuiaReal() para decidir se aquela competência é "real apurada".
//
// Régua (Phase 90 / Plan 03): a competência a passar é a competência da
// GUIA (S+1 em relação ao mês de venda exibido S) — quem calcula o
// deslocamento S+1 é o caller (Plan 90-04), este hook apenas consulta a
// competência recebida.
//
// A RPC get_imposto_guia_by_competence não está em types.ts — mesmo padrão
// já usado por useDreOperational com get_dre_operational_by_competence
// (chamada por nome via supabase.rpc + mapeamento com `any`).
//
// Phase: 90-dre-imposto-real-cmv-fechamento / Plan 03
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { evaluateGuiaReal, type GuiaRealResult, type ImpostoGuiaRow } from "@/lib/dreOperational";

const EMPTY_GUIA: GuiaRealResult = { hasGuiaReal: false, totalReal: 0 };

export function useImpostoGuia(competenceMonth: string | null) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<GuiaRealResult>({
    queryKey: ["dre", "imposto-guia", orgId, competenceMonth] as const,
    enabled: !!orgId && !!competenceMonth,
    staleTime: 3 * 60 * 1000,
    queryFn: async (): Promise<GuiaRealResult> => {
      if (!orgId || !competenceMonth) return EMPTY_GUIA;

      const { data, error } = await supabase.rpc("get_imposto_guia_by_competence", {
        p_org_id: orgId,
        p_competence: competenceMonth,
      });

      if (error) throw error;
      const rows: ImpostoGuiaRow[] = (data ?? []).map((r: any) => ({
        category: String(r.category),
        total: Number(r.total ?? 0),
        status: String(r.status),
      }));

      return evaluateGuiaReal(rows);
    },
  });
}
