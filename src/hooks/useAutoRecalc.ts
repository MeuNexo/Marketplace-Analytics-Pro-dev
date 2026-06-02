import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CostWaterfallData } from "./useMLCostWaterfall";

const today = () => new Date().toISOString().substring(0, 10);

/**
 * 1. Se costWaterfall é null E o período inclui hoje → sincroniza orders do dia
 *    via bulk-dispatch-sync-jobs e depois dispara recalc.
 * 2. Se costWaterfall existe mas sem CMV/impostos → dispara recalc diretamente.
 * Em ambos os casos invalida a query do waterfall ao concluir.
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
    if (!orgId || !mlUserIds.length) return;

    const key = `${orgId}|${mlUserIds.join(",")}|${from}|${to}`;
    if (firedRef.current.has(key)) return;

    const periodIncludesToday = to.substring(0, 10) >= today();

    // Caso 1: sem orders no período (waterfall null) e inclui hoje → sync de orders primeiro
    if (costWaterfall === null && periodIncludesToday) {
      firedRef.current.add(key);
      const syncAndRecalc = async () => {
        await supabase.functions.invoke("bulk-dispatch-sync-jobs", {
          body: { ml_user_ids: mlUserIds, organization_id: orgId, date_from: from, date_to: to },
        });
        // Aguarda processamento mínimo antes do recalc
        await new Promise((r) => setTimeout(r, 8000));
        await supabase.functions.invoke("recalc-order-costs", {
          body: { ml_user_ids: mlUserIds, organization_id: orgId, date_from: from, date_to: to, only_missing: true },
        });
        queryClient.invalidateQueries({ queryKey: ["ml", "cost-waterfall"] });
      };
      syncAndRecalc().catch(() => {});
      return;
    }

    // Caso 2: waterfall existe mas falta CMV ou imposto → recalc direto
    if (costWaterfall && (!costWaterfall.has_cmv || !costWaterfall.has_tax_data)) {
      firedRef.current.add(key);
      supabase.functions
        .invoke("recalc-order-costs", {
          body: { ml_user_ids: mlUserIds, organization_id: orgId, date_from: from, date_to: to, only_missing: true },
        })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["ml", "cost-waterfall"] });
        })
        .catch(() => {});
    }
  }, [costWaterfall, orgId, mlUserIds, from, to, queryClient]);
}
