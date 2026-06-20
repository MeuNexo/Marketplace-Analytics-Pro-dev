// ============================================================================
// useTreasuryPanel — painel de tesouraria via RPC get_treasury_panel
// Retorna 11 escalares: burn_rate, alert_threshold, alert_date, min_balance_date,
// min_balance, entrada_real_30d, saida_real_30d, fornec_30d/60d/90d, total_exposicao
// TESO-01 / TESO-03
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface TreasuryPanelData {
  burn_rate:        number;
  alert_threshold:  number;
  alert_date:       string | null;   // ISO date or null
  min_balance_date: string | null;   // date of minimum balance in 30d horizon
  min_balance:      number;          // value of minimum balance (same model/horizon as date)
  entrada_real_30d: number;
  saida_real_30d:   number;
  fornec_30d:       number;
  fornec_60d:       number;
  fornec_90d:       number;
  total_exposicao:  number;
}

export function useTreasuryPanel() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<TreasuryPanelData | null>({
    queryKey: ["cashflow", "treasury_panel", orgId] as const,
    enabled: !!orgId,
    staleTime: 3 * 60 * 1000,
    queryFn: async (): Promise<TreasuryPanelData | null> => {
      if (!orgId) return null;

      const { data, error } = await supabase.rpc("get_treasury_panel", {
        p_org_id: orgId,
      });

      if (error) throw error;

      const r = (data as any)?.[0];
      if (!r) return null;

      return {
        burn_rate:        Number(r.burn_rate        ?? 0),
        alert_threshold:  Number(r.alert_threshold  ?? 30000),
        alert_date:       r.alert_date       ? String(r.alert_date)       : null,
        min_balance_date: r.min_balance_date ? String(r.min_balance_date) : null,
        min_balance:      Number(r.min_balance      ?? 0),
        entrada_real_30d: Number(r.entrada_real_30d ?? 0),
        saida_real_30d:   Number(r.saida_real_30d   ?? 0),
        fornec_30d:       Number(r.fornec_30d        ?? 0),
        fornec_60d:       Number(r.fornec_60d        ?? 0),
        fornec_90d:       Number(r.fornec_90d        ?? 0),
        total_exposicao:  Number(r.total_exposicao   ?? 0),
      };
    },
  });
}
