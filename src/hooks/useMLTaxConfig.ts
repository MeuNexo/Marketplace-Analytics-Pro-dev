import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MLTaxConfigEntry {
  regime: string;
  effective_rate: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches tax configuration for one or more ML user IDs within a given org.
 *
 * Returns a stable Map keyed by ml_user_id. Callers use:
 *   const { data: taxMap } = useMLTaxConfig(mlUserIds, orgId);
 *   const entry = taxMap?.get(mlUserId);
 *
 * effective_rate is the computed value from the DB trigger (see calculate_effective_rate).
 * For lucro_real the value may be negative when credits exceed debits — clamp at display layer.
 */
export function useMLTaxConfig(mlUserIds: string[], orgId: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["ml", "taxConfig", orgId, mlUserIds] as const,
    queryFn: async (): Promise<Map<string, MLTaxConfigEntry>> => {
      const { data, error } = await supabase
        .from("ml_tax_config")
        .select("ml_user_id, regime, effective_rate")
        .in("ml_user_id", mlUserIds)
        .eq("organization_id", orgId);

      if (error) throw error;

      const map = new Map<string, MLTaxConfigEntry>();
      for (const row of data ?? []) {
        map.set(row.ml_user_id, {
          regime: row.regime,
          effective_rate: Number(row.effective_rate),
        });
      }
      return map;
    },
    enabled: !!user && mlUserIds.length > 0 && !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}
