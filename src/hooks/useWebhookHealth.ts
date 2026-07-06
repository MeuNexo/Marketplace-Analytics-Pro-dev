import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Último evento de webhook recebido pela org do usuário logado (RLS filtra por org).
 * Alimenta o badge "Tempo real ativo · há X". Refetch a cada 60s.
 */
export function useWebhookHealth() {
  const { data, isLoading } = useQuery({
    queryKey: ["webhook-health"],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("ml_webhook_events")
        .select("received_at")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return (data?.received_at as string | undefined) ?? null;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return { lastEventIso: data ?? null, isLoading };
}
