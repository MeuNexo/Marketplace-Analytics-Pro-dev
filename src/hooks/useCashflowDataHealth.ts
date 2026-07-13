// ============================================================================
// useCashflowDataHealth — faixa de saúde dos dados via RPC get_cashflow_data_health
// Retorna 6 escalares: tinyHoursAgo/tinyStale, mpHoursAgo/mpStale,
// anchorDaysAgo/anchorStale. Molde: useTreasuryPanel.ts (RPC escalar única).
// CASH-95-05 / CASH-95-06
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface CashflowDataHealth {
  tinyHoursAgo:   number;
  tinyStale:      boolean;
  mpHoursAgo:     number;
  mpStale:        boolean;
  anchorDaysAgo:  number;
  anchorStale:    boolean;
}

export function useCashflowDataHealth() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<CashflowDataHealth | null>({
    queryKey: ["cashflow", "data_health", orgId] as const,
    enabled: !!orgId,
    staleTime: 3 * 60 * 1000, // mesmo staleTime das outras RPCs de caixa
    queryFn: async (): Promise<CashflowDataHealth | null> => {
      if (!orgId) return null;

      const { data, error } = await supabase.rpc("get_cashflow_data_health", {
        p_org_id: orgId,
      });

      if (error) throw error;

      const r = (data as any)?.[0];
      if (!r) return null;

      return {
        tinyHoursAgo:  Number(r.tiny_hours_ago    ?? 0),
        tinyStale:     Boolean(r.tiny_stale       === true || r.tiny_stale === "true"),
        mpHoursAgo:    Number(r.mp_hours_ago      ?? 0),
        mpStale:       Boolean(r.mp_stale         === true || r.mp_stale === "true"),
        anchorDaysAgo: Number(r.anchor_days_ago   ?? 0),
        anchorStale:   Boolean(r.anchor_stale     === true || r.anchor_stale === "true"),
      };
    },
  });
}
