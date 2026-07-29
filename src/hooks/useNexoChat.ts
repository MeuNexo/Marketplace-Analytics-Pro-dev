import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * useNexoChat — conversa do Nexo, agora PERSISTIDA (Phase 106).
 *
 * Revê a decisão NEXO-04 (Phase 57), que mantinha o histórico só no estado React:
 * o F5 apagava a conversa e cada sessão começava do zero.
 *
 * Agora:
 *  - o servidor é a autoridade do histórico. `send()` manda apenas
 *    { org_id, conversation_id, message } — nunca a conversa inteira (que crescia
 *    sem limite e era superfície de injeção).
 *  - a EF cria a conversa no 1º turno e devolve `conversation_id`.
 *  - o estado React vira CACHE do servidor, não a fonte da verdade.
 *
 * Read-only: o painel é conversa; nenhuma mutação no ML é disparada daqui.
 */

export interface ChatPart {
  text: string;
}

export interface ChatMsg {
  role: "user" | "model";
  parts: ChatPart[];
}

export interface NexoConversation {
  id: string;
  title: string;
  updated_at: string;
}

interface NexoChatResponse {
  reply?: string;
  used_tools?: string[];
  fallback?: boolean;
  disabled?: boolean;
  conversation_id?: string | null;
  memories_used?: number;
}

export function useNexoChat() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);

  /** Conversas do usuário nesta org (as arquivadas ficam de fora). */
  const conversations = useQuery({
    queryKey: ["nexo-conversations", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<NexoConversation[]> => {
      const { data, error } = await supabase
        .from("nexo_conversations")
        .select("id, title, updated_at")
        .eq("organization_id", orgId!)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as NexoConversation[];
    },
  });

  const mutation = useMutation<NexoChatResponse, Error, string>({
    mutationFn: async (text: string): Promise<NexoChatResponse> => {
      if (!orgId) throw new Error("Nenhuma organização selecionada");

      // otimista: a pergunta aparece na hora
      const otimista: ChatMsg[] = [...messages, { role: "user", parts: [{ text }] }];
      setMessages(otimista);

      const { data, error } = await supabase.functions.invoke("nexo-chat", {
        body: { org_id: orgId, conversation_id: conversationId, message: text },
      });
      if (error) {
        // rollback: sem resposta, a pergunta não fica órfã na tela
        setMessages(messages);
        throw error;
      }

      const resp = (data ?? {}) as NexoChatResponse;
      if (resp.disabled) return resp;

      if (resp.conversation_id && resp.conversation_id !== conversationId) {
        setConversationId(resp.conversation_id);
        void queryClient.invalidateQueries({ queryKey: ["nexo-conversations", orgId] });
      }
      // a proposta de memória pode ter nascido neste turno
      void queryClient.invalidateQueries({ queryKey: ["nexo-memories", orgId] });

      setMessages((prev) => [...prev, { role: "model", parts: [{ text: resp.reply ?? "" }] }]);
      return resp;
    },
  });

  const send = (text: string) => mutation.mutateAsync(text);

  /** Abre uma conversa salva, recarregando as mensagens do banco. */
  const openConversation = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("nexo_messages")
      .select("role, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    setConversationId(id);
    setMessages(
      ((data ?? []) as Array<{ role: "user" | "model"; content: string }>).map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      })),
    );
  }, []);

  /** Começa uma conversa nova (a anterior continua salva). */
  const newConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
  }, []);

  const archiveConversation = useCallback(
    async (id: string) => {
      await supabase
        .from("nexo_conversations")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (id === conversationId) newConversation();
      void queryClient.invalidateQueries({ queryKey: ["nexo-conversations", orgId] });
    },
    [conversationId, newConversation, queryClient, orgId],
  );

  /** compat: limpa a tela sem apagar nada no banco. */
  const reset = newConversation;

  return {
    messages,
    conversationId,
    conversations: conversations.data ?? [],
    send,
    openConversation,
    newConversation,
    archiveConversation,
    reset,
    loading: mutation.isPending,
    error: mutation.error ?? null,
  };
}
