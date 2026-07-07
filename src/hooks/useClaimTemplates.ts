import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

// ─── Row type matching ml_claim_templates table (Phase 90-02) ────────────────

export interface ClaimTemplate {
  id: string;
  organization_id: string;
  title: string;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const QUERY_KEY = "claim_templates";

/**
 * Org-scoped "mensagens rápidas" templates (ml_claim_templates).
 *
 * CRUD happens directly through the authenticated Supabase client — RLS
 * (org-first, Plan 90-02) is the only guard, so `organization_id` is ALWAYS
 * taken from the current org context (never a client argument) and
 * `created_by` is ALWAYS the authenticated user id from the session
 * (anti-IDOR — T-90-11). Reads/updates/deletes additionally filter by
 * organization_id so a stale id from another org can never match a row here.
 */
export function useClaimTemplates() {
  const { currentOrg } = useOrganization();
  const { user } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery<ClaimTemplate[]>({
    queryKey: [QUERY_KEY, orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<ClaimTemplate[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("ml_claim_templates")
        .select("*")
        .eq("organization_id", orgId)
        .order("title");
      if (error) throw error;
      return (data ?? []) as ClaimTemplate[];
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: [QUERY_KEY, orgId] });
  }

  const createMutation = useMutation({
    mutationFn: async ({ title, body }: { title: string; body: string }) => {
      if (!orgId) throw new Error("Sem organização selecionada");
      if (!user?.id) throw new Error("Sem usuário autenticado");
      const { error } = await supabase.from("ml_claim_templates").insert({
        organization_id: orgId,
        title: title.trim(),
        body,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, title, body }: { id: string; title: string; body: string }) => {
      if (!orgId) throw new Error("Sem organização selecionada");
      const { error } = await supabase
        .from("ml_claim_templates")
        .update({ title: title.trim(), body, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!orgId) throw new Error("Sem organização selecionada");
      const { error } = await supabase
        .from("ml_claim_templates")
        .delete()
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    templates: query.data ?? [],
    isLoading: query.isLoading,
    create: (title: string, body: string) => createMutation.mutateAsync({ title, body }),
    update: (id: string, title: string, body: string) => updateMutation.mutateAsync({ id, title, body }),
    remove: (id: string) => deleteMutation.mutateAsync(id),
    isMutating: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
  };
}
