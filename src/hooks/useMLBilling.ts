import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export interface MLBillingData {
  /** Frete Full — substitui total_frete de orders quando disponível */
  cffe: number;
  /** Parcelamento sem juros (CFONPN) */
  cfonpn: number;
  charges: Array<{ type: string; label: string; amount: number }>;
  resumo: { cffe: number; cfonpn: number; total_charges?: number; synced_at?: string };
  synced_at: string;
}

/**
 * Lê ml_billing_monthly para o período YYYY-MM especificado.
 * Retorna null quando não há dados (conta sem Full ou ainda não sincronizado).
 */
export function useMLBilling(periodMonth: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<MLBillingData | null>({
    queryKey: ["ml", "billing", orgId, resolvedMLUserIds, periodMonth],
    queryFn: async (): Promise<MLBillingData | null> => {
      if (!orgId || resolvedMLUserIds.length === 0) return null;

      const { data, error } = await supabase
        .from("ml_billing_monthly")
        .select("*")
        .eq("organization_id", orgId)
        .in("ml_user_id", resolvedMLUserIds)
        .eq("period_month", periodMonth)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const resumo = (data.resumo ?? {}) as Record<string, unknown>;

      return {
        cffe:      Number(resumo.cffe ?? 0),
        cfonpn:    Number(resumo.cfonpn ?? 0),
        charges:   (data.charges as Array<{ type: string; label: string; amount: number }>) ?? [],
        resumo: {
          cffe:          Number(resumo.cffe ?? 0),
          cfonpn:        Number(resumo.cfonpn ?? 0),
          total_charges: resumo.total_charges != null ? Number(resumo.total_charges) : undefined,
          synced_at:     resumo.synced_at != null ? String(resumo.synced_at) : undefined,
        },
        synced_at: data.synced_at ?? new Date().toISOString(),
      };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!periodMonth,
    staleTime: 30 * 60 * 1000, // billing data changes at most once per day
  });
}
