// ============================================================================
// useCashflowDataHealth.test.ts — Phase 95 Plan 02, Task 1 (TDD)
// Testa o hook que consome a RPC get_cashflow_data_health, escopado por org
// via OrganizationContext.
//
// Segue o padrão de mock de `supabase.rpc` estabelecido em
// src/hooks/useDreOperational.test.ts (mocka `rpc`, NÃO o chain from/select/eq).
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

// Padrão RPC: expõe `rpc: vi.fn()` (NÃO o chain from/select/eq).
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

import { useCashflowDataHealth } from "@/hooks/useCashflowDataHealth";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useCashflowDataHealth — chamada e mapeamento da RPC", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({
      currentOrg: { id: "org-uuid-test-1234" },
    });
  });

  it("Test 1: chama supabase.rpc('get_cashflow_data_health', { p_org_id }) e mapeia as 6 flags", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          tiny_hours_ago: 2.5,
          tiny_stale: false,
          mp_hours_ago: 1.2,
          mp_stale: false,
          anchor_days_ago: 3,
          anchor_stale: false,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useCashflowDataHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // args exatos da chamada rpc
    const rpcCalls = (supabase.rpc as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
    expect(rpcCalls.some(([fn, args]) =>
      fn === "get_cashflow_data_health" &&
      JSON.stringify(args) === JSON.stringify({ p_org_id: "org-uuid-test-1234" }),
    )).toBe(true);

    // shape mapeado
    expect(result.current.data).toEqual({
      tinyHoursAgo: 2.5,
      tinyStale: false,
      mpHoursAgo: 1.2,
      mpStale: false,
      anchorDaysAgo: 3,
      anchorStale: false,
    });
  });

  it("Test 2: coage tipos numéricos/booleanos (Postgres pode devolver 'true'/'false' string)", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          tiny_hours_ago: "8",
          tiny_stale: "true",
          mp_hours_ago: "1",
          mp_stale: "false",
          anchor_days_ago: "10",
          anchor_stale: "true",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useCashflowDataHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      tinyHoursAgo: 8,
      tinyStale: true,
      mpHoursAgo: 1,
      mpStale: false,
      anchorDaysAgo: 10,
      anchorStale: true,
    });
  });

  it("Test 3 (error path): rpc retornando error faz a query entrar em erro", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: "boom", code: "42P01" },
    });

    const { result } = renderHook(() => useCashflowDataHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("Test 4: sem orgId o hook fica disabled (não chama rpc)", async () => {
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    const { supabase } = await import("@/integrations/supabase/client");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({ currentOrg: null });

    const { result } = renderHook(() => useCashflowDataHealth(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect((supabase.rpc as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("Test 5: data vazio/null → hook retorna null sem quebrar", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(() => useCashflowDataHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
