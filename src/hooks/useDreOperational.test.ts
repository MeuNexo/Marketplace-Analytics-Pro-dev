/**
 * Test scaffold for useDreOperational hook.
 *
 * Phase: 88-dre-frontend-resultado-completo-vendas / Plan 01
 * Follows the useMLClaims.test.ts scaffold: mock supabase.rpc + OrganizationContext,
 * wrap renderHook in a QueryClientProvider.
 */

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

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: vi.fn(() => ({
    currentOrg: { id: "org-uuid-test-1234" },
  })),
}));

import { useDreOperational } from "@/hooks/useDreOperational";

describe("useDreOperational", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({
      currentOrg: { id: "org-uuid-test-1234" },
    });
  });

  it("calls the RPC with p_org_id from session-derived org and p_month === the passed month string", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], error: null });

    renderHook(() => useDreOperational("2026-06-01"), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("get_dre_operational_by_competence", {
        p_org_id: "org-uuid-test-1234",
        p_month: "2026-06-01",
      });
    });
  });

  it("is disabled (isLoading false, data undefined, rpc not called) when orgId is null", async () => {
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({ currentOrg: null });
    const { supabase } = await import("@/integrations/supabase/client");

    const { result } = renderHook(() => useDreOperational("2026-06-01"), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("is disabled when month is null", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    const { result } = renderHook(() => useDreOperational(null), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("aggregates mixed RPC rows: pessoal + approximate financeiro, excluding impostos_venda/excluido", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { bloco: "pessoal", category: "Salários", total: 27852, n: 3, financeiro_is_approximate: false },
        { bloco: "financeiro", category: "Empréstimo", total: 20027, n: 1, financeiro_is_approximate: true },
        { bloco: "servicos", category: "Contabilidade", total: 1953, n: 1, financeiro_is_approximate: false },
        { bloco: "outros_operacionais", category: "Outros", total: 150, n: 1, financeiro_is_approximate: false },
        { bloco: "impostos_venda", category: "ICMS", total: 53000, n: 5, financeiro_is_approximate: false },
        { bloco: "excluido", category: "Fornecedores", total: 9000, n: 2, financeiro_is_approximate: false },
      ],
      error: null,
    });

    const { result } = renderHook(() => useDreOperational("2026-06-01"), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data).toEqual({
      pessoal: 27852,
      estrutura: 0,
      servicos: 1953,
      outros_operacionais: 150,
      financeiro: 20027,
      financeiro_is_approximate: true,
    });
  });
});
