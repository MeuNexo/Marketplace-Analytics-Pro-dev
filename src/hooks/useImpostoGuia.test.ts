/**
 * Test scaffold for useImpostoGuia hook.
 *
 * Segue o padrão de useDreOperational.test.ts: mock supabase.rpc +
 * OrganizationContext, wrap renderHook em QueryClientProvider.
 *
 * Phase: 90-dre-imposto-real-cmv-fechamento / Plan 03
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

import { useImpostoGuia } from "@/hooks/useImpostoGuia";

describe("useImpostoGuia", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({
      currentOrg: { id: "org-uuid-test-1234" },
    });
  });

  it("calls the RPC with p_org_id from session-derived org and p_competence === the passed competence string", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], error: null });

    renderHook(() => useImpostoGuia("2026-05-01"), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("get_imposto_guia_by_competence", {
        p_org_id: "org-uuid-test-1234",
        p_competence: "2026-05-01",
      });
    });
  });

  it("is disabled (isLoading false, data undefined, rpc not called) when orgId is null", async () => {
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({ currentOrg: null });
    const { supabase } = await import("@/integrations/supabase/client");

    const { result } = renderHook(() => useImpostoGuia("2026-05-01"), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("is disabled when competenceMonth is null", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    const { result } = renderHook(() => useImpostoGuia(null), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("Maio (guia de competência S+1): 3 categorias paid > R$1 → hasGuiaReal true, totalReal ~16015.06", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { category: "ICMS", total: 12000, status: "paid" },
        { category: "PIS", total: 716.19, status: "paid" },
        { category: "COFINS", total: 3298.87, status: "paid" },
      ],
      error: null,
    });

    const { result } = renderHook(() => useImpostoGuia("2026-05-01"), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data?.hasGuiaReal).toBe(true);
    expect(Math.round((result.current.data?.totalReal ?? 0) * 100) / 100).toBe(16015.06);
  });

  it("Junho (placeholder): ICMS 4793.21 paid + PIS 0.01 paid + COFINS 0.01 paid → hasGuiaReal false", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { category: "ICMS", total: 4793.21, status: "paid" },
        { category: "PIS", total: 0.01, status: "paid" },
        { category: "COFINS", total: 0.01, status: "paid" },
      ],
      error: null,
    });

    const { result } = renderHook(() => useImpostoGuia("2026-06-01"), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data?.hasGuiaReal).toBe(false);
    expect(result.current.data?.totalReal).toBe(0);
  });

  it("Jul (previsão): 3 linhas pending de 16015.06 → hasGuiaReal false", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { category: "ICMS", total: 12000, status: "pending" },
        { category: "PIS", total: 716.19, status: "pending" },
        { category: "COFINS", total: 3298.87, status: "pending" },
      ],
      error: null,
    });

    const { result } = renderHook(() => useImpostoGuia("2026-08-01"), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data?.hasGuiaReal).toBe(false);
    expect(result.current.data?.totalReal).toBe(0);
  });
});
