import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";

/**
 * Retorna o synced_at mais recente do ml_sync_log para a org/lojas atuais.
 * Fonte de verdade para o indicador "Última atualização" — reflete quando o
 * cron (source='auto') ou o botão Atualizar (source='manual') realmente rodaram.
 *
 * staleTime: 2min | refetchInterval: 5min (polling leve; atualiza quando cron roda)
 */
export function useMLLastSync() {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  return useQuery({
    queryKey: ["ml_last_sync", currentOrg?.id, resolvedMLUserIds] as const,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("ml_sync_log")
        .select("synced_at")
        .eq("organization_id", currentOrg!.id)
        .in("ml_user_id", resolvedMLUserIds)
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.synced_at ?? null;
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
