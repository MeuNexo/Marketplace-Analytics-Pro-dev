// ============================================================================
// useDreCashForecast — Phase 100 Plan 02, Task 2
// Hook TanStack Query que consome a RPC get_dre_cash_forecast (Plano 100-01),
// escopado por org (currentOrg.id do OrganizationContext).
//
// Padrão clonado de useDreCash.ts (RPC + useOrganization + useQuery).
// Anti-IDOR é garantido server-side (RPC SECURITY INVOKER + RLS is_org_member,
// provado no 100-01). O frontend só passa a org do contexto — não re-filtra.
//
// `enabled` existe porque o painel "Fechar o mês" é só do mês corrente — a
// página passa `isCurrentMonth` e o hook nem dispara a query para mês passado.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { DreCashForecastRow } from "@/lib/dreCashForecast";

/**
 * Busca as linhas cruas (saida_prevista/entrada/taxa/ritmo/alerta_recorrencia)
 * do painel "Fechar o mês" do mês corrente.
 *
 * @param pMonth DEVE ser uma string de primeiro-dia-do-mês ("YYYY-MM-01") —
 *        NUNCA "YYYY-MM" (o cast para `date` do Postgres falha). Mesma regra
 *        de useDreCash.
 * @param enabled Passa false para mês passado — o painel de previsão não se
 *        aplica a meses fechados; a query nem dispara.
 */
export function useDreCashForecast(pMonth: string, enabled: boolean) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<DreCashForecastRow[]>({
    queryKey: ["dre-cash-forecast", orgId, pMonth] as const,
    enabled: !!orgId && !!pMonth && enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DreCashForecastRow[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase.rpc("get_dre_cash_forecast", {
        p_org_id: orgId,
        p_month: pMonth,
      });

      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        secao: String(r.secao),
        categoria: String(r.categoria),
        // numeric do Postgres pode chegar como string em alguns drivers —
        // normalizar, preservando null (taxas sem dado suficiente).
        total: r.total === null || r.total === undefined ? null : Number(r.total),
        n: Number(r.n ?? 0),
      }));
    },
  });
}
