/**
 * Unit test for useNexoChat — conversa PERSISTIDA + invoke da EF nexo-chat.
 *
 * Phase 106 reviu a NEXO-04 (histórico efêmero client-held): o servidor passou a ser
 * a autoridade do histórico. Prova:
 *  - send() manda { org_id, conversation_id, message } — NUNCA a conversa inteira;
 *  - o 2º turno continua mandando só a mensagem nova (não reenvia o histórico);
 *  - o conversation_id devolvido pela EF é reaproveitado no turno seguinte;
 *  - kill-switch ({disabled:true}) não faz append da reply.
 *
 * Phase: 57 (origem) + 106 (persistência)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

const invokeMock = vi.fn();

// builder encadeável para as queries de conversas/mensagens (Phase 106)
function fromStub() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit", "update", "insert"]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: () => fromStub(),
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  },
}));

vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: vi.fn(() => ({ currentOrg: { id: "org-1" } })),
}));

// ─── Import hook under test ──────────────────────────────────────────────────
import { useNexoChat } from "@/hooks/useNexoChat";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lastInvokeBody() {
  const calls = invokeMock.mock.calls;
  const [, opts] = calls[calls.length - 1] as [
    string,
    { body: { org_id: string; message?: string; conversation_id?: string | null; messages?: unknown[] } },
  ];
  return opts.body;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useNexoChat — conversa persistida (Phase 106)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invoca nexo-chat com { org_id, message } — nunca com a conversa inteira", async () => {
    invokeMock.mockResolvedValueOnce({ data: { reply: "olá", used_tools: [], conversation_id: "c1" }, error: null });

    const { result } = renderHook(() => useNexoChat(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("oi");
    });

    expect(invokeMock).toHaveBeenCalledWith("nexo-chat", expect.anything());
    const body = lastInvokeBody();
    expect(body.org_id).toBe("org-1");
    expect(body.message).toBe("oi");
    expect(body.conversation_id).toBeNull();
    // o contrato antigo (conversa inteira a cada turno) não é mais usado
    expect(body.messages).toBeUndefined();

    // histórico = user + model
    await waitFor(() => {
      expect(result.current.messages).toEqual([
        { role: "user", parts: [{ text: "oi" }] },
        { role: "model", parts: [{ text: "olá" }] },
      ]);
    });
  });

  it("2º turno manda só a mensagem nova + o conversation_id devolvido pela EF", async () => {
    invokeMock
      .mockResolvedValueOnce({ data: { reply: "r1", used_tools: [], conversation_id: "c1" }, error: null })
      .mockResolvedValueOnce({ data: { reply: "r2", used_tools: [], conversation_id: "c1" }, error: null });

    const { result } = renderHook(() => useNexoChat(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("primeira");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    await waitFor(() => expect(result.current.conversationId).toBe("c1"));

    await act(async () => {
      await result.current.send("segunda");
    });

    // servidor é a autoridade do histórico: o 2º turno NÃO reenvia a conversa
    const body = lastInvokeBody();
    expect(body.message).toBe("segunda");
    expect(body.conversation_id).toBe("c1");
    expect(body.messages).toBeUndefined();

    await waitFor(() => expect(result.current.messages).toHaveLength(4));
  });

  it("newConversation limpa a tela e zera o conversation_id (a anterior fica salva)", async () => {
    invokeMock.mockResolvedValueOnce({ data: { reply: "r", used_tools: [], conversation_id: "c9" }, error: null });
    const { result } = renderHook(() => useNexoChat(), { wrapper: createWrapper() });

    await act(async () => { await result.current.send("oi"); });
    await waitFor(() => expect(result.current.conversationId).toBe("c9"));

    act(() => { result.current.newConversation(); });
    await waitFor(() => {
      expect(result.current.conversationId).toBeNull();
      expect(result.current.messages).toEqual([]);
    });
  });

  it("kill-switch (disabled:true) não faz append da reply", async () => {
    invokeMock.mockResolvedValueOnce({ data: { disabled: true }, error: null });

    const { result } = renderHook(() => useNexoChat(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("oi");
    });

    // user foi adicionado, mas nenhuma reply do model (kill-switch)
    await waitFor(() => {
      expect(result.current.messages).toEqual([{ role: "user", parts: [{ text: "oi" }] }]);
    });
  });

  it("não persiste o histórico em localStorage (efêmero)", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    invokeMock.mockResolvedValueOnce({ data: { reply: "olá", used_tools: [] }, error: null });

    const { result } = renderHook(() => useNexoChat(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("oi");
    });

    // nenhuma chave de localStorage contendo as mensagens/texto da conversa
    const wroteConversation = setItemSpy.mock.calls.some(
      ([, value]) => typeof value === "string" && (value.includes("oi") || value.includes("olá")),
    );
    expect(wroteConversation).toBe(false);

    setItemSpy.mockRestore();
  });
});
