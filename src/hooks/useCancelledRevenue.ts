// ============================================================================
// useCancelledRevenue — Phase 96 Plan 04, Task 3 (C1-backend)
//
// Consome a RPC de receita cancelada (migration 20260715120000), que soma a
// receita dos pedidos cancelados + reembolsados no mesmo eixo do
// get_cost_waterfall (mesmo range de data_pedido, mesmo fallback de receita,
// mesmo escopo de lojas), somando o COMPLEMENTO de status:
// cancelled + partially_refunded.
//
// Decisão do dono (Wesley, 2026-07-15, 96-CONTEXT.md §3 [C1]):
//   "reembolso fica de fora da receita e e considerado como cancelamento"
// → o valor devolvido alimenta os DOIS lados da composição do card:
//   Receita bruta      = paid_revenue + cancelledRevenue   (261.666,41 em maio)
//   (−) Cancelamentos  = cancelledRevenue                  (−14.450,29)
//   = Receita líquida  = paid_revenue                      (247.216,12, inalterada)
//
// 🚨 get_cost_waterfall.paid_revenue NÃO é tocada por esta phase — ela tem 6
// consumidores (/financeiro, MCO, GoalsCard, Nexo, useAutoRecalc, o card).
// A composição da receita bruta acontece NO CARD (96-05), nunca na RPC grande.
//
// Padrão de escopo (lojas + range) clonado de useMLCostWaterfall.ts.
// Este hook NÃO é consumido ainda — a fiação é do plano 96-05.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export interface CancelledRevenueData {
  /** SUM(COALESCE(receita_bruta, preco_unit * quantidade, 0)) dos pedidos cancelled + partially_refunded */
  cancelledRevenue: number;
  /** COUNT(*) dos pedidos cancelled + partially_refunded */
  cancelledOrders: number;
}

/**
 * Receita cancelada (cancelamento + reembolso) do período, no mesmo eixo do
 * waterfall.
 *
 * @param from Data inicial "YYYY-MM-DD" (ou ISO — só os 10 primeiros chars são usados).
 * @param to   Data final "YYYY-MM-DD" (idem).
 *
 * Um mês sem cancelamento é um estado VÁLIDO: devolve sempre um objeto com
 * `cancelledRevenue: 0`, nunca nulo. O card precisa somar 0, não travar — por
 * isso este hook deliberadamente NÃO copia o guard de receita-zero que
 * useMLCostWaterfall.ts aplica (lá, receita paga zerada anula o waterfall
 * inteiro; aqui, cancelamento zerado é apenas um mês limpo).
 */
export function useCancelledRevenue(from: string, to: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<CancelledRevenueData>({
    queryKey: ["ml", "cancelled-revenue", orgId, resolvedMLUserIds, from, to] as const,
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!from && !!to,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CancelledRevenueData> => {
      if (!orgId || resolvedMLUserIds.length === 0) {
        return { cancelledRevenue: 0, cancelledOrders: 0 };
      }

      const { data, error } = await supabase.rpc("get_cancelled_revenue", {
        p_org_id: orgId,
        p_user_ids: resolvedMLUserIds,
        p_from: from.substring(0, 10),
        p_to: to.substring(0, 10),
      });

      if (error) throw error;

      // Ausência de linha = mês sem cancelamento → zero, não null.
      const r = (data as any)?.[0];
      const cancelledRevenue = Number(r?.cancelled_revenue ?? 0);
      const cancelledOrders = Number(r?.cancelled_orders ?? 0);

      return {
        cancelledRevenue: Math.round(cancelledRevenue * 100) / 100,
        cancelledOrders,
      };
    },
  });
}
