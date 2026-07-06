import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MLClaimMessage {
  sender_role: string | null;    // "mediator" | "complainant" | "respondent"
  receiver_role: string | null;
  message: string | null;        // HTML
  date_created: string | null;
  message_date: string | null;
  stage: string | null;
  attachments?: unknown[];
}

/**
 * Thread de mensagens de uma reclamação, buscada ao vivo no ML via a EF
 * ml-claim-detail (JWT + anti-IDOR). Só habilita quando há claim selecionada.
 */
export function useMLClaimMessages(claimId: string | null, mlUserId: string | null) {
  return useQuery<MLClaimMessage[]>({
    queryKey: ["ml-claim-messages", claimId, mlUserId],
    enabled: !!claimId && !!mlUserId,
    staleTime: 15_000,
    queryFn: async (): Promise<MLClaimMessage[]> => {
      const { data, error } = await supabase.functions.invoke("ml-claim-detail", {
        body: { claim_id: claimId, ml_user_id: mlUserId },
      });
      if (error) throw error;
      const msgs = (data?.messages ?? []) as MLClaimMessage[];
      // Ordena da mais antiga para a mais recente (leitura de conversa top→bottom).
      return [...msgs].sort((a, b) => {
        const ta = new Date(a.message_date ?? a.date_created ?? 0).getTime();
        const tb = new Date(b.message_date ?? b.date_created ?? 0).getTime();
        return ta - tb;
      });
    },
  });
}
