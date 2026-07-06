import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WebhookEventRow {
  id: string;
  topic: string;
  status: string;
  resource: string;
  attempts: number;
  error_msg: string | null;
  received_at: string;
  processed_at: string | null;
}

/** Últimos eventos de webhook da org do usuário logado (RLS filtra por org). */
export function useWebhookEvents(limit = 50) {
  return useQuery({
    queryKey: ["webhook-events", limit],
    queryFn: async (): Promise<WebhookEventRow[]> => {
      const { data, error } = await supabase
        .from("ml_webhook_events")
        .select("id,topic,status,resource,attempts,error_msg,received_at,processed_at")
        .order("received_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as WebhookEventRow[];
    },
    refetchInterval: 30_000,
  });
}
