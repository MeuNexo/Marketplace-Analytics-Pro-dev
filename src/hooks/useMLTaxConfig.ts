import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { OrderTaxConfig } from "@/lib/tax/perOrder";
import type { TaxRegime } from "@/lib/tax";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MLTaxConfigEntry extends OrderTaxConfig {
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
        .select("*")
        .in("ml_user_id", mlUserIds)
        .eq("organization_id", orgId);

      if (error) throw error;

      const map = new Map<string, MLTaxConfigEntry>();
      for (const row of (data ?? []) as any[]) {
        map.set(row.ml_user_id, {
          regime: row.regime as TaxRegime,
          uf_origem: row.uf_origem ?? null,
          sn_aliquota_efetiva: row.sn_aliquota_efetiva ?? null,
          lp_pis: row.lp_pis ?? null,
          lp_cofins: row.lp_cofins ?? null,
          lp_irpj: row.lp_irpj ?? null,
          lp_csll: row.lp_csll ?? null,
          lr_pis_debito: row.lr_pis_debito ?? null,
          lr_pis_credito: row.lr_pis_credito ?? null,
          lr_cofins_debito: row.lr_cofins_debito ?? null,
          lr_cofins_credito: row.lr_cofins_credito ?? null,
          lr_icms_debito: row.lr_icms_debito ?? null,
          lr_icms_credito: row.lr_icms_credito ?? null,
          lr_icms_aliquota_intra: row.lr_icms_aliquota_intra ?? null,
          lr_icms_aliquota_inter_sul_sudeste: row.lr_icms_aliquota_inter_sul_sudeste ?? null,
          lr_icms_aliquota_inter_norte_nordeste: row.lr_icms_aliquota_inter_norte_nordeste ?? null,
          effective_rate: Number(row.effective_rate),
        });
      }
      return map;
    },
    enabled: !!user && mlUserIds.length > 0 && !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}
