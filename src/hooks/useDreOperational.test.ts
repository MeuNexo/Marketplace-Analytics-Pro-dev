// ============================================================================
// useDreOperational.test.ts — Phase 88 Plan 01, Task 2 (TDD)
// Testa o hook que consome a RPC 87 (get_dre_operational_by_competence),
// escopado por org via OrganizationContext.
//
// Estabelece o padrão de mock de `supabase.rpc` no repo (Pitfall 4 do research):
// os testes de hook existentes mockam o chain from/select/eq — este mocka `rpc`.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Padrão RPC: expõe `rpc: vi.fn()` (NÃO o chain from/select/eq — Pitfall 4).
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: vi.fn(() => ({
    currentOrg: { id: "org-uuid-test-1234" },
  })),
}));

import { useDreOperational } from "@/hooks/useDreOperational";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useDreOperational — chamada e mapeamento da RPC", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({
      currentOrg: { id: "org-uuid-test-1234" },
    });
  });

  it("Test 1: chama supabase.rpc com {p_org_id, p_month} corretos e mapeia o shape das linhas", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { bloco: "pessoal", category: "Salários", total: 27852, n: 3, double_count_risk: false },
        { bloco: "operacional", category: "Cartão de crédito", total: 15715, n: 1, double_count_risk: true },
      ],
      error: null,
    });

    const { result } = renderHook(() => useDreOperational("2026-06-01"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // args exatos da chamada rpc
    const rpcCalls = (supabase.rpc as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
    expect(rpcCalls.some(([fn, args]) =>
      fn === "get_dre_operational_by_competence" &&
      JSON.stringify(args) === JSON.stringify({ p_org_id: "org-uuid-test-1234", p_month: "2026-06-01" }),
    )).toBe(true);

    // shape mapeado
    expect(result.current.data).toEqual([
      { bloco: "pessoal", category: "Salários", total: 27852, n: 3, double_count_risk: false },
      { bloco: "operacional", category: "Cartão de crédito", total: 15715, n: 1, double_count_risk: true },
    ]);
  });

  it("coage tipos numéricos/booleanos e trata data null como lista vazia", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { bloco: "financeiro", category: "Empréstimo", total: "20027", n: "2", double_count_risk: "true" },
      ],
      error: null,
    });

    const { result } = renderHook(() => useDreOperational("2026-06-01"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      { bloco: "financeiro", category: "Empréstimo", total: 20027, n: 2, double_count_risk: true },
    ]);
  });

  it("Test 2 (error path): rpc retornando error faz a query entrar em erro", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: "boom", code: "42P01" },
    });

    const { result } = renderHook(() => useDreOperational("2026-06-01"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("Test 3: sem orgId o hook fica disabled (não chama rpc)", async () => {
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    const { supabase } = await import("@/integrations/supabase/client");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({ currentOrg: null });

    const { result } = renderHook(() => useDreOperational("2026-06-01"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect((supabase.rpc as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("sem pMonth o hook fica disabled (não chama rpc)", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    const { result } = renderHook(() => useDreOperational(""), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect((supabase.rpc as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
