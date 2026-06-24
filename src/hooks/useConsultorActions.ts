import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { InsightRow } from "@/hooks/useConsultorInsights";
import {
  buildActionFromInsight,
  type ProposedValue,
} from "@/lib/consultor/actionMapping";

// ─── Row type from generated types (Phase 52 — proposed_actions) ─────────────

export type ProposedActionRow =
  Database["public"]["Tables"]["proposed_actions"]["Row"];

const QUEUE_STATUSES = ["proposed", "approved"];
const HISTORY_STATUSES = ["done", "failed"];
const HISTORY_PAGE_SIZE = 50;

const QUEUE_KEY = "consultor_actions";
const HISTORY_KEY = "consultor_actions_history";

/**
 * Frontend data layer for the action queue (Plan 54-02).
 *
 * Org-scoped, mirrors `useConsultorInsights` (TanStack Query v5).
 *
 *  - `queue` / `pendingCount` — rows with status IN ('proposed','approved') (ACT-02).
 *  - `propose(insight, proposedValue)` — INSERT a proposed action (ACT-01). The
 *    Insert is built by `buildActionFromInsight`; RLS (Phase 52) re-forces
 *    status='proposed' + proposed_by=auth.uid() + org membership.
 *  - `dryRun(actionId)` — invokes the `consultor-actions` EF with dry_run:true to
 *    fetch the diff preview (ACT-01). Returns `{ data, error }`.
 *  - `approve(actionId)` — UPDATE status='approved' (RLS owner-only) THEN invokes
 *    the `consultor-actions` EF with dry_run:false to execute (ACT-03).
 *  - `reject(actionId)` — UPDATE status='rejected' (ACT-03).
 *  - `history` — rows with status IN ('done','failed'), paginated via .range() (ACT-08).
 */
export function useConsultorActions() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const queryClient = useQueryClient();

  // ── Queue (proposed + approved) → pendingCount badge (ACT-02) ──────────────

  const queueQuery = useQuery<ProposedActionRow[]>({
    queryKey: [QUEUE_KEY, orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<ProposedActionRow[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("proposed_actions")
        .select("*")
        .eq("organization_id", orgId)
        .in("status", QUEUE_STATUSES)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProposedActionRow[];
    },
  });

  const queue = queueQuery.data ?? [];
  const pendingCount = queue.length;

  // ── History (done + failed), paginated with .range() (ACT-08) ──────────────

  const historyQuery = useQuery<ProposedActionRow[]>({
    queryKey: [HISTORY_KEY, orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<ProposedActionRow[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("proposed_actions")
        .select("*")
        .eq("organization_id", orgId)
        .in("status", HISTORY_STATUSES)
        .order("executed_at", { ascending: false, nullsFirst: false })
        .range(0, HISTORY_PAGE_SIZE - 1);
      if (error) throw error;
      return (data ?? []) as ProposedActionRow[];
    },
  });

  const history = historyQuery.data ?? [];

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function currentUserId(): Promise<string> {
    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (!userId) throw new Error("Sem usuário autenticado");
    return userId;
  }

  function invalidateQueue() {
    queryClient.invalidateQueries({ queryKey: [QUEUE_KEY, orgId] });
  }

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: [QUEUE_KEY, orgId] });
    queryClient.invalidateQueries({ queryKey: [HISTORY_KEY, orgId] });
  }

  // ── propose() — INSERT proposed action (ACT-01) ────────────────────────────

  const proposeMutation = useMutation({
    mutationFn: async ({
      insight,
      proposedValue,
    }: {
      insight: InsightRow;
      proposedValue: ProposedValue;
    }) => {
      if (!orgId) throw new Error("Sem organização selecionada");
      const userId = await currentUserId();
      const row = buildActionFromInsight(insight, orgId, userId, proposedValue);
      const { error } = await supabase.from("proposed_actions").insert(row);
      if (error) throw error;
    },
    onSuccess: invalidateQueue,
  });

  // ── dryRun() — EF diff preview (ACT-01) ────────────────────────────────────

  const dryRun = (actionId: string) =>
    supabase.functions.invoke("consultor-actions", {
      body: { action_id: actionId, dry_run: true },
    });

  // ── approve() — UPDATE approved + invoke executor (ACT-03) ─────────────────

  const approveMutation = useMutation({
    mutationFn: async (actionId: string) => {
      if (!orgId) throw new Error("Sem organização selecionada");
      const userId = await currentUserId();
      const { error } = await supabase
        .from("proposed_actions")
        .update({
          status: "approved",
          approved_by: userId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", actionId)
        .eq("organization_id", orgId);
      if (error) throw error;

      const { error: invokeError } = await supabase.functions.invoke(
        "consultor-actions",
        { body: { action_id: actionId, dry_run: false } },
      );
      if (invokeError) throw invokeError;
    },
    onSuccess: invalidateAll,
  });

  // ── reject() — UPDATE rejected (ACT-03) ────────────────────────────────────

  const rejectMutation = useMutation({
    mutationFn: async (actionId: string) => {
      if (!orgId) throw new Error("Sem organização selecionada");
      const { error } = await supabase
        .from("proposed_actions")
        .update({ status: "rejected" })
        .eq("id", actionId)
        .eq("organization_id", orgId);
      if (error) throw error;
    },
    onSuccess: invalidateQueue,
  });

  // ── Return ──────────────────────────────────────────────────────────────────

  return {
    queue,
    pendingCount,
    history,
    loading: queueQuery.isLoading || historyQuery.isLoading,
    propose: (insight: InsightRow, proposedValue: ProposedValue) =>
      proposeMutation.mutateAsync({ insight, proposedValue }),
    dryRun,
    approve: (actionId: string) => approveMutation.mutateAsync(actionId),
    reject: (actionId: string) => rejectMutation.mutateAsync(actionId),
  };
}
