/**
 * Unit test for useNexoChat — estado efêmero + invoke da EF nexo-chat (NEXO-04).
 *
 * Mocks @/integrations/supabase/client (functions.invoke) e useOrganization.
 * Prova:
 *  - após send("oi"), o body do invoke contém messages com a msg do user;
 *  - após resolver com {reply:"olá"}, messages tem 2 itens (user+model);
 *  - um segundo send reenvia o histórico acumulado (array de 3 → invoke recebe 3);
 *  - kill-switch ({disabled:true}) não faz append da reply;
 *  - nenhum acesso a localStorage de mensagens (efêmero, client-held).
 *
 * Phase: 57-nexo-conversacional-chat-consultor / Plan 03
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

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
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
  const [, opts] = calls[calls.length - 1] as [string, { body: { org_id: string; messages: unknown[] } }];
  return opts.body;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useNexoChat — NEXO-04 histórico efêmero reenviado a cada turno", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invoca nexo-chat com a msg do user e org_id; acumula user+model na resposta", async () => {
    invokeMock.mockResolvedValueOnce({ data: { reply: "olá", used_tools: [] }, error: null });

    const { result } = renderHook(() => useNexoChat(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("oi");
    });

    // alvo do invoke é a EF nexo-chat com org_id + messages contendo a msg do user
    expect(invokeMock).toHaveBeenCalledWith("nexo-chat", expect.anything());
    const body = lastInvokeBody();
    expect(body.org_id).toBe("org-1");
    expect(body.messages).toEqual([{ role: "user", parts: [{ text: "oi" }] }]);

    // histórico = user + model
    await waitFor(() => {
      expect(result.current.messages).toEqual([
        { role: "user", parts: [{ text: "oi" }] },
        { role: "model", parts: [{ text: "olá" }] },
      ]);
    });
  });

  it("reenvia o histórico acumulado a cada turno (3 mensagens no 2º send)", async () => {
    invokeMock
      .mockResolvedValueOnce({ data: { reply: "r1", used_tools: [] }, error: null })
      .mockResolvedValueOnce({ data: { reply: "r2", used_tools: [] }, error: null });

    const { result } = renderHook(() => useNexoChat(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("primeira");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    await act(async () => {
      await result.current.send("segunda");
    });

    // O 2º invoke recebe [user1, model1, user2] = 3 mensagens (histórico acumulado)
    const body = lastInvokeBody();
    expect(body.messages).toEqual([
      { role: "user", parts: [{ text: "primeira" }] },
      { role: "model", parts: [{ text: "r1" }] },
      { role: "user", parts: [{ text: "segunda" }] },
    ]);

    await waitFor(() => expect(result.current.messages).toHaveLength(4));
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
