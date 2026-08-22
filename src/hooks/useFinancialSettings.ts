// ============================================================================
// useFinancialSettings — lê financial_settings da organização corrente
// 1 linha por org (select direto é seguro: sem risco de truncamento PostgREST)
// CASH-06
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface FinancialSettings {
  initial_balance: number;
  operational_cost_rate: number;
  safety_margin: number;
  alert_threshold: number;  // D-10 — limite configurável de alerta de saldo
  /**
   * CX-06 — data do último ajuste manual de saldo. `null` quando ausente:
   * nunca coalescer para uma data aqui — a régua (`saldoConfiabilidade.ts`)
   * é quem decide o que ausência significa, a mesma disciplina de
   * `useEstornoDeflator.ts`.
   */
  created_at: string | null;
  updated_at: string | null;
}

const DEFAULTS: FinancialSettings = {
  initial_balance: 0,
  operational_cost_rate: 0.22,
  safety_margin: 10000,
  alert_threshold: 30000,
  created_at: null,
  updated_at: null,
};

export function useFinancialSettings() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<FinancialSettings | null>({
    queryKey: ["financial_settings", orgId] as const,
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<FinancialSettings> => {
      if (!orgId) return DEFAULTS;

      // Select direto é seguro aqui: financial_settings tem 1 linha por org
      // (chave única por organization_id — sem risco de truncamento PostgREST)
      const { data, error } = await supabase
        .from("financial_settings")
        .select("initial_balance, operational_cost_rate, safety_margin, alert_threshold, created_at, updated_at")
        .eq("organization_id", orgId)
        .maybeSingle();

      if (error) throw error;

      if (!data) return DEFAULTS;

      return {
        initial_balance:       Number(data.initial_balance       ?? 0),
        operational_cost_rate: Number(data.operational_cost_rate ?? 0.22),
        safety_margin:         Number(data.safety_margin         ?? 10000),
        alert_threshold:       Number(data.alert_threshold       ?? 30000),
        // Ausência vai como null para a tela — nunca coalescer para uma data.
        created_at:            data.created_at ?? null,
        updated_at:            data.updated_at ?? null,
      };
    },
  });
}
