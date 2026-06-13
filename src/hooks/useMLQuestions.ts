import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

// ─── Row type matching ml_questions table ────────────────────────────────────

export interface MLQuestionRow {
  id: string;
  organization_id: string;
  ml_user_id: string;
  question_id: number;
  item_id: string | null;
  item_title: string | null;
  texto: string | null;
  status: string | null;
  resposta: string | null;
  data_pergunta: string | null;
  data_resposta: string | null;
  synced_at: string | null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Reads ml_questions for the current org + resolved ML user IDs (CR-01 multi-loja).
 * Ordered by data_pergunta descending (newest first).
 * Optional status filter: "UNANSWERED" | "ANSWERED" | "CLOSED".
 * Returns [] (not undefined) when disabled; staleTime 2min.
 */
export function useMLQuestions(status?: "UNANSWERED" | "ANSWERED" | "CLOSED") {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<MLQuestionRow[]>({
    queryKey: ["ml_questions", orgId, resolvedMLUserIds, status],
    enabled: !!orgId && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000, // 2 min — cron runs every 15 min
    queryFn: async (): Promise<MLQuestionRow[]> => {
      if (!orgId || resolvedMLUserIds.length === 0) return [];

      let q = supabase
        .from("ml_questions")
        .select("*")
        .eq("organization_id", orgId)
        .in("ml_user_id", resolvedMLUserIds) // CR-01 multi-loja merge
        .order("data_pergunta", { ascending: false })
        .limit(200);

      if (status) q = q.eq("status", status);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as MLQuestionRow[];
    },
  });
}
