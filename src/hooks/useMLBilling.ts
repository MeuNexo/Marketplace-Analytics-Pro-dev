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

export interface BillingGroup {
  key: string;
  label: string;
  amount: number;
}

export interface GroupedBillingResult {
  groups: BillingGroup[];
  totalTarifas: number;
}

/**
 * Mapas de types → grupos (conforme plano 41-04).
 * Todos os types não mapeados caem no bucket "Outras tarifas".
 */
const BILLING_GROUP_MAP: Array<{ key: string; label: string; types: Set<string> }> = [
  {
    key: "tarifas_venda",
    label: "Tarifas de venda",
    types: new Set(["CVVML", "CVVPRC", "CVVFNU"]),
  },
  {
    key: "envios_ml",
    label: "Envios Mercado Livre",
    types: new Set(["CFFE", "CXDE", "CFFI", "CXDED"]),
  },
  {
    key: "parcelamento",
    label: "Taxas de parcelamento",
    types: new Set(["CFONPN"]),
  },
  {
    key: "publicidade",
    label: "Campanhas de publicidade",
    types: new Set(["PADS"]),
  },
  {
    key: "tarifas_full",
    label: "Tarifas Full",
    types: new Set(["CFCBE", "CFBA", "CFPB", "CFWA"]),
  },
  {
    key: "difal",
    label: "Impostos cobrados pelo ML (DIFAL)",
    types: new Set(["CDIFAL"]),
  },
  {
    key: "afiliados",
    label: "Afiliados",
    types: new Set(["CVAF"]),
  },
];

const OUTRAS_KEY = "outras";
const OUTRAS_LABEL = "Outras tarifas";

/**
 * Agrupa cobranças de billing em grupos semânticos conforme plano 41-04.
 * Valores somados com sinal (estornos negativos subtraem).
 * Types não mapeados caem no bucket "Outras tarifas" — nunca dropados.
 */
export function groupBillingCharges(
  charges: Array<{ type: string; label: string; amount: number }>,
): GroupedBillingResult {
  // Acumula por grupo
  const accumulators: Record<string, number> = {};
  for (const g of BILLING_GROUP_MAP) accumulators[g.key] = 0;
  accumulators[OUTRAS_KEY] = 0;

  for (const charge of charges) {
    const group = BILLING_GROUP_MAP.find((g) => g.types.has(charge.type));
    if (group) {
      accumulators[group.key] += charge.amount;
    } else {
      accumulators[OUTRAS_KEY] += charge.amount;
    }
  }

  // Monta lista de grupos — inclui "Outras" sempre que houver valor ou types sem mapa
  const groups: BillingGroup[] = BILLING_GROUP_MAP.map((g) => ({
    key: g.key,
    label: g.label,
    amount: accumulators[g.key],
  }));

  // "Afiliados / Outras tarifas" — exibe combinado se ambos tiverem valor,
  // ou apenas "Outras tarifas" se afiliados for zero
  const afiliadosIdx = groups.findIndex((g) => g.key === "afiliados");
  if (afiliadosIdx !== -1) {
    const afiliadosAmt = groups[afiliadosIdx].amount;
    const outrasAmt = accumulators[OUTRAS_KEY];
    groups[afiliadosIdx] = {
      key: "afiliados_outras",
      label: afiliadosAmt !== 0 ? "Afiliados / Outras tarifas" : OUTRAS_LABEL,
      amount: afiliadosAmt + outrasAmt,
    };
  } else {
    groups.push({ key: OUTRAS_KEY, label: OUTRAS_LABEL, amount: accumulators[OUTRAS_KEY] });
  }

  const totalTarifas = groups.reduce((sum, g) => sum + g.amount, 0);

  return { groups, totalTarifas };
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
