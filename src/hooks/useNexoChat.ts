import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * useNexoChat — estado efêmero do chat conversacional do Nexo (NEXO-01 / NEXO-04).
 *
 * O histórico vive APENAS no estado React deste hook e é reenviado INTEIRO à EF
 * `nexo-chat` a cada turno (formato Gemini `contents`: { role, parts:[{text}] }).
 * Não há tabela, não há localStorage de mensagens — conversa efêmera, client-held.
 *
 * Fluxo de `send(text)`:
 *  1. monta nextMessages = [...messages, { role:'user', parts:[{text}] }]
 *  2. setMessages(nextMessages) — o user já aparece na UI imediatamente
 *  3. invoca nexo-chat com { org_id, messages: nextMessages } (JWT anexado pelo SDK)
 *  4. se a resposta tem `disabled` (kill-switch, NEXO-06) → não faz append
 *     senão → append da reply como { role:'model', parts:[{text: reply}] }
 *
 * Read-only: o painel é só conversa; nenhuma mutação no ML é disparada daqui.
 */

export interface ChatPart {
  text: string;
}

export interface ChatMsg {
  role: "user" | "model";
  parts: ChatPart[];
}

interface NexoChatResponse {
  reply?: string;
  used_tools?: string[];
  fallback?: boolean;
  disabled?: boolean;
}

export function useNexoChat() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  // Histórico efêmero — só em memória (NEXO-04). Sem persistência.
  const [messages, setMessages] = useState<ChatMsg[]>([]);

  const mutation = useMutation<NexoChatResponse, Error, string>({
    mutationFn: async (text: string): Promise<NexoChatResponse> => {
      if (!orgId) throw new Error("Nenhuma organização selecionada");

      // Acumula a mensagem do user e a exibe imediatamente.
      const nextMessages: ChatMsg[] = [
        ...messages,
        { role: "user", parts: [{ text }] },
      ];
      setMessages(nextMessages);

      const { data, error } = await supabase.functions.invoke("nexo-chat", {
        body: { org_id: orgId, messages: nextMessages },
      });
      if (error) throw error;

      const resp = (data ?? {}) as NexoChatResponse;

      // Kill-switch (NEXO-06): EF respondeu desligada → não há reply para anexar.
      if (resp.disabled) return resp;

      const reply = resp.reply ?? "";
      setMessages((prev) => [...prev, { role: "model", parts: [{ text: reply }] }]);
      return resp;
    },
  });

  const send = (text: string) => mutation.mutateAsync(text);

  const reset = () => setMessages([]);

  return {
    messages,
    send,
    reset,
    loading: mutation.isPending,
    error: mutation.error ?? null,
  };
}
