import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClaimAttachmentMeta } from "@/lib/claimAttachments";

export interface MLClaimMessage {
  sender_role: string | null;    // "mediator" | "complainant" | "respondent"
  receiver_role: string | null;
  message: string | null;        // HTML
  date_created: string | null;
  message_date: string | null;
  stage: string | null;
  attachments?: ClaimAttachmentMeta[];  // normalizado pela EF ml-claim-detail (Phase 92)
}

export interface MLClaimReason {
  code: string | null;
  name: string | null;
  detail: string | null;         // texto legível em PT-BR
}

export interface MLClaimDetail {
  messages: MLClaimMessage[];
  reason: MLClaimReason | null;
  available_actions: string[];   // ações do vendedor: refund | open_dispute | send_message_to_complainant
  stage: string | null;
  type: string | null;
  status: string | null;
  buyer_first_name: string | null; // Phase 90-02: capitalizado; null → "cliente" no frontend
}

/**
 * Detalhe ao vivo de uma reclamação (mensagens + motivo traduzido + ações do
 * vendedor) via a EF ml-claim-detail (JWT + anti-IDOR). Só habilita quando há
 * claim selecionada.
 */
export function useMLClaimDetail(claimId: string | null, mlUserId: string | null) {
  return useQuery<MLClaimDetail>({
    queryKey: ["ml-claim-detail", claimId, mlUserId],
    enabled: !!claimId && !!mlUserId,
    staleTime: 15_000,
    queryFn: async (): Promise<MLClaimDetail> => {
      const { data, error } = await supabase.functions.invoke("ml-claim-detail", {
        body: { claim_id: claimId, ml_user_id: mlUserId },
      });
      if (error) throw error;
      const msgs = (data?.messages ?? []) as MLClaimMessage[];
      const sorted = [...msgs].sort((a, b) => {
        const ta = new Date(a.message_date ?? a.date_created ?? 0).getTime();
        const tb = new Date(b.message_date ?? b.date_created ?? 0).getTime();
        return ta - tb;
      });
      return {
        messages: sorted,
        reason: (data?.reason ?? null) as MLClaimReason | null,
        available_actions: (data?.available_actions ?? []) as string[],
        stage: data?.stage ?? null,
        type: data?.type ?? null,
        status: data?.status ?? null,
        buyer_first_name: data?.buyer_first_name ?? null,
      };
    },
  });
}
