import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * useNexoMemory — memória de longo prazo do Consultor (Phase 106).
 *
 * Regra travada por Wesley: o Nexo PROPÕE, o humano APROVA. Nada entra na memória
 * (status 'active', o único que a EF injeta no prompt) sem clique.
 *
 * Escrita direta na tabela sob RLS — mesmo padrão de config simples do projeto
 * (ml_mco_targets, replenishment_params), sem RPC.
 */

export type MemoryType = "decision" | "preference" | "context" | "reference";
export type MemoryStatus = "pending" | "active" | "archived";

export interface NexoMemory {
  id: string;
  scope: "org" | "user";
  type: MemoryType;
  title: string;
  body: string;
  has_numbers: boolean;
  status: MemoryStatus;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  decision: "Decisão travada",
  preference: "Preferência",
  context: "Contexto do negócio",
  reference: "Referência",
};

export function useNexoMemory() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["nexo-memories", orgId] });

  const memories = useQuery({
    queryKey: ["nexo-memories", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<NexoMemory[]> => {
      const { data, error } = await supabase
        .from("nexo_memories")
        .select("id, scope, type, title, body, has_numbers, status, source_conversation_id, created_at, updated_at")
        .eq("organization_id", orgId!)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as NexoMemory[];
    },
  });

  const all = memories.data ?? [];

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("nexo_memories")
        .update({
          status: "active",
          approved_by: u?.user?.id ?? null,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const discard = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("nexo_memories")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const edit = useMutation({
    mutationFn: async (p: { id: string; title: string; body: string; has_numbers?: boolean }) => {
      const { error } = await supabase
        .from("nexo_memories")
        .update({
          title: p.title,
          body: p.body,
          ...(p.has_numbers === undefined ? {} : { has_numbers: p.has_numbers }),
          updated_at: new Date().toISOString(),
        })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /** Criação manual pelo usuário já nasce ativa — ele é a autoridade. */
  const create = useMutation({
    mutationFn: async (p: { title: string; body: string; type: MemoryType; has_numbers: boolean }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("nexo_memories").insert({
        organization_id: orgId,
        scope: "org",
        type: p.type,
        title: p.title,
        body: p.body,
        has_numbers: p.has_numbers,
        status: "active",
        created_by: u?.user?.id ?? null,
        approved_by: u?.user?.id ?? null,
        approved_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    memories: all,
    pending: all.filter((m) => m.status === "pending"),
    active: all.filter((m) => m.status === "active"),
    archived: all.filter((m) => m.status === "archived"),
    loading: memories.isLoading,
    approve: (id: string) => approve.mutateAsync(id),
    discard: (id: string) => discard.mutateAsync(id),
    edit: (p: { id: string; title: string; body: string; has_numbers?: boolean }) => edit.mutateAsync(p),
    create: (p: { title: string; body: string; type: MemoryType; has_numbers: boolean }) =>
      create.mutateAsync(p),
  };
}
