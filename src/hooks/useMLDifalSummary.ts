import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import type { DifalSummaryInput } from "@/lib/mcoCenarios";

/**
 * Resposta completa de `get_difal_summary` (Fase 222, 222-07): os campos que
 * `computeMcoCenarios`/`resolveDifalCenario` consomem (`DifalSummaryInput`)
 * mais `difal_previsto_nas_ufs_cobradas`, que é só informativo — serve para
 * a tela calibrar a fórmula contra a fatura do ML, nunca para somar.
 */
export interface MLDifalSummary extends DifalSummaryInput {
  difal_previsto_nas_ufs_cobradas: number;
  fcp_calculado: number;
  pedidos_com_difal: number;
  pedidos_nao_conciliados: number;
}

/**
 * Hook de leitura de `get_difal_summary`, no mesmo padrão TanStack Query de
 * `useMLKPISummary`: mesma janela (`from`/`to`), mesmas lojas resolvidas
 * (`resolvedMLUserIds`), habilitado só com organização e lojas presentes,
 * mesmo `staleTime` — os dois números (KPI e DIFAL) precisam ficar frescos
 * juntos, senão deixam de ser do mesmo conjunto de pedidos.
 */
export function useMLDifalSummary(from: string, to: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<MLDifalSummary | null>({
    queryKey: ["ml", "difal-summary", orgId, resolvedMLUserIds, from, to],
    queryFn: async (): Promise<MLDifalSummary | null> => {
      if (!orgId || resolvedMLUserIds.length === 0) return null;

      const { data, error } = await supabase.rpc("get_difal_summary", {
        p_org_id: orgId,
        p_user_ids: resolvedMLUserIds,
        p_from: from.slice(0, 10),
        p_to: to.slice(0, 10),
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;

      // Conversão numérica explícita — o driver Postgres/PostgREST costuma
      // devolver `numeric` como string para não perder precisão (mesma nota
      // de `tabelaUf.ts`, 222-05).
      return {
        difal_calculado: Number(row.difal_calculado) || 0,
        fcp_calculado: Number(row.fcp_calculado) || 0,
        difal_recolhido_pela_loja: Number(row.difal_recolhido_pela_loja) || 0,
        difal_cobrado_ml: Number(row.difal_cobrado_ml) || 0,
        difal_previsto_nas_ufs_cobradas: Number(row.difal_previsto_nas_ufs_cobradas) || 0,
        // [222-07-R / D-10.1] Redução de PIS/COFINS causada pelo DIFAL. `|| 0`
        // cobre tanto a RPC antiga (campo ausente) quanto o valor zero — aqui
        // os dois significam a mesma coisa para a conta: nada a descontar.
        reducao_pc_por_difal: Number(row.reducao_pc_por_difal) || 0,
        pedidos_com_difal: Number(row.pedidos_com_difal) || 0,
        pedidos_difal_indefinido: Number(row.pedidos_difal_indefinido) || 0,
        pedidos_nao_conciliados: Number(row.pedidos_nao_conciliados) || 0,
        regua_recolhimento_configurada: Boolean(row.regua_recolhimento_configurada),
        regua_cobranca_configurada: Boolean(row.regua_cobranca_configurada),
      };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 5 * 60 * 1000,
  });
}
