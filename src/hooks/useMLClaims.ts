import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

// ─── Row type matching ml_claims table ───────────────────────────────────────

export interface MLClaimRow {
  id: string;
  organization_id: string;
  ml_user_id: string;
  claim_id: string;
  order_id: string | null;
  tipo: string | null; // "mediations" | "returns"
  status: string | null; // "opened" | "closed" | etc.
  motivo: string | null;
  descricao: string | null;
  item_id: string | null;
  item_title: string | null;
  valor: number | null;
  data_abertura: string | null;
  data_fechamento: string | null;
  synced_at: string | null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Reads ml_claims for the current org + resolved ML user IDs (CR-01 multi-loja).
 * Ordered by data_abertura descending (newest first).
 * Optional status filter (e.g. "opened" | "closed").
 * Page-level tipo filtering is done via client-side useMemo (D-09).
 * Returns [] (not undefined) when disabled; staleTime 2min.
 */
export function useMLClaims(status?: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<MLClaimRow[]>({
    queryKey: ["ml_claims", orgId, resolvedMLUserIds, status],
    enabled: !!orgId && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000, // 2 min — cron runs every 30 min
    queryFn: async (): Promise<MLClaimRow[]> => {
      if (!orgId || resolvedMLUserIds.length === 0) return [];

      let q = supabase
        .from("ml_claims")
        .select("*")
        .eq("organization_id", orgId)
        .in("ml_user_id", resolvedMLUserIds) // CR-01 multi-loja merge
        .order("data_abertura", { ascending: false })
        .limit(200);

      if (status) q = q.eq("status", status);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as MLClaimRow[];
    },
  });
}
