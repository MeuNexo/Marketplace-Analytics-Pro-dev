// ============================================================================
// useDreMonthClose — Phase 94 Plan 02, Task 3
//
// Reads presence of a `dre_month_close` row for (org, competenceMonth) — the
// single DB source of truth for PREVISÃO (no row) vs APURAÇÃO (row present),
// created in Plan 94-01. Exposes owner close()/reopen() mutations via direct
// `supabase.from("dre_month_close")` calls — RLS (org-first, owner-only
// INSERT/DELETE, member SELECT) is the SOLE authority, matching this repo's
// established convention (ml_tax_config, ml_claim_templates,
// replenishment_params — no Edge Function, RLS is the only guard). The
// frontend owner-gate in Plan 94-03 is UX-only.
//
// Reopen = DELETE the row (no UPDATE policy exists — Plan 94-01), matching
// the locked "mês SEM registro → previsão" presence semantics.
//
// competenceMonth MUST be "YYYY-MM-01" — NEVER "YYYY-MM" (Pitfall 3, see
// useDreOperational.ts's own doc comment for the same footgun).
// ============================================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface DreMonthCloseState {
  isClosed: boolean;
  closedAt: string | null;
}

const QUERY_KEY = "month-close";

/**
 * @param competenceMonth Sale-month S as "YYYY-MM-01" (NEVER the guia's M+1 —
 *        the M+1 shift lives in useImpostoGuiaReal, not here).
 */
export function useDreMonthClose(competenceMonth: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const queryClient = useQueryClient();

  const queryKey = ["dre", QUERY_KEY, orgId, competenceMonth] as const;

  const query = useQuery<DreMonthCloseState>({
    queryKey,
    enabled: !!orgId && !!competenceMonth,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DreMonthCloseState> => {
      if (!orgId || !competenceMonth) return { isClosed: false, closedAt: null };

      const { data, error } = await supabase
        .from("dre_month_close")
        .select("closed_at")
        .eq("organization_id", orgId)
        .eq("competence_month", competenceMonth)
        .maybeSingle();

      if (error) throw error;

      return {
        isClosed: !!data,
        closedAt: data ? String((data as { closed_at: string }).closed_at) : null,
      };
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey });
  }

  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Sem organização selecionada");
      if (!competenceMonth) throw new Error("Sem mês de competência");

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;

      const { error } = await supabase.from("dre_month_close").insert({
        organization_id: orgId,
        competence_month: competenceMonth,
        closed_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reopenMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Sem organização selecionada");
      if (!competenceMonth) throw new Error("Sem mês de competência");

      const { error } = await supabase
        .from("dre_month_close")
        .delete()
        .eq("organization_id", orgId)
        .eq("competence_month", competenceMonth);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    isClosed: query.data?.isClosed ?? false,
    closedAt: query.data?.closedAt ?? null,
    isLoading: query.isLoading,
    close: () => closeMutation.mutateAsync(),
    reopen: () => reopenMutation.mutateAsync(),
    isMutating: closeMutation.isPending || reopenMutation.isPending,
  };
}
