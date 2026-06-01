import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CostWaterfallData } from "./useMLCostWaterfall";

/**
 * Dispara recalc-order-costs silencioso quando CMV ou impostos estão ausentes
 * no waterfall, mas a configuração existe no banco. Invalida a query do waterfall
 * após completar para forçar re-fetch com os valores calculados.
 */
export function useAutoRecalc(
  costWaterfall: CostWaterfallData | null | undefined,
  orgId: string | null,
  mlUserIds: string[],
  from: string,
  to: string,
) {
  const queryClient = useQueryClient();
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!costWaterfall || !orgId || !mlUserIds.length) return;
    if (costWaterfall.has_cmv && costWaterfall.has_tax_data) return;

    const key = `${orgId}|${mlUserIds.join(",")}|${from}|${to}`;
    if (firedRef.current.has(key)) return;
    firedRef.current.add(key);

    supabase.functions
      .invoke("recalc-order-costs", {
        body: { ml_user_ids: mlUserIds, organization_id: orgId, date_from: from, date_to: to, only_missing: true },
      })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["ml", "cost-waterfall"] });
      });
  }, [costWaterfall, orgId, mlUserIds, from, to, queryClient]);
}
