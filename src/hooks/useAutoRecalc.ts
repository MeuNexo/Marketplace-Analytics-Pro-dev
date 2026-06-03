import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CostWaterfallData } from "./useMLCostWaterfall";

// Usa data local (BRT) — mesmo critério que useMLFilters.todayUTC
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function invalidateMLQueries(queryClient: ReturnType<typeof useQueryClient>) {
  // Invalida todos os queries ml: cost-waterfall, kpi-summary, orders-by-brand, orders-summary, etc.
  queryClient.invalidateQueries({ queryKey: ["ml"] });
}

/**
 * 1. Se costWaterfall é null E o período inclui hoje → chama sync-ml-orders diretamente
 *    (não via fila de jobs) e depois dispara recalc-order-costs.
 * 2. Se costWaterfall existe mas sem CMV/impostos → dispara recalc diretamente.
 * Em ambos os casos invalida todos os queries ["ml"] ao concluir.
 * Retorna { isRecalcing } para uso como loading indicator nos cards dependentes.
 */
export function useAutoRecalc(
  costWaterfall: CostWaterfallData | null | undefined,
  orgId: string | null,
  mlUserIds: string[],
  from: string,
  to: string,
): { isRecalcing: boolean } {
  const queryClient = useQueryClient();
  const firedRef = useRef<Set<string>>(new Set());
  const [isRecalcing, setIsRecalcing] = useState(false);

  useEffect(() => {
    if (!orgId || !mlUserIds.length) return;

    const key = `${orgId}|${mlUserIds.join(",")}|${from}|${to}`;
    if (firedRef.current.has(key)) return;

    // Compara com data local — mesmo fuso que useMLFilters usa para currentTo
    const periodIncludesToday = to.substring(0, 10) >= todayLocal();

    // Caso 1: sem orders no período (waterfall null) e inclui hoje → sync direto de orders
    if (costWaterfall === null && periodIncludesToday) {
      firedRef.current.add(key);
      setIsRecalcing(true);
      const syncAndRecalc = async () => {
        try {
          const dateFrom = from.slice(0, 10);
          const dateTo   = to.slice(0, 10);

          // sync-ml-orders diretamente (sem fila), 1 chamada por loja em paralelo
          await Promise.all(
            mlUserIds.map((mlUserId) =>
              supabase.functions.invoke("sync-ml-orders", {
                body: { ml_user_id: mlUserId, date_from: dateFrom, date_to: dateTo },
              }),
            ),
          );

          // Recalcula CMV e impostos nos orders recém-sincronizados
          await supabase.functions.invoke("recalc-order-costs", {
            body: {
              ml_user_ids:     mlUserIds,
              organization_id: orgId,
              date_from:       dateFrom,
              date_to:         dateTo,
              only_missing:    true,
            },
          });

          invalidateMLQueries(queryClient);
        } finally {
          setIsRecalcing(false);
        }
      };
      syncAndRecalc().catch(() => setIsRecalcing(false));
      return;
    }

    // Caso 2: waterfall existe mas falta CMV ou imposto → recalc direto (sem sync)
    if (costWaterfall && (!costWaterfall.has_cmv || !costWaterfall.has_tax_data)) {
      firedRef.current.add(key);
      setIsRecalcing(true);
      supabase.functions
        .invoke("recalc-order-costs", {
          body: {
            ml_user_ids:     mlUserIds,
            organization_id: orgId,
            date_from:       from.slice(0, 10),
            date_to:         to.slice(0, 10),
            only_missing:    true,
          },
        })
        .then(() => { invalidateMLQueries(queryClient); })
        .catch(() => {})
        .finally(() => setIsRecalcing(false));
    }
  }, [costWaterfall, orgId, mlUserIds, from, to, queryClient]);

  return { isRecalcing };
}
