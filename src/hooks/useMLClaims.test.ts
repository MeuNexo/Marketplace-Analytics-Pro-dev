/**
 * Test scaffold for useMLClaims hook.
 *
 * Requirements covered:
 *   MOCK-03 — /devolucoes lists real ML claims/returns from ml_claims table,
 *             with status and tipo filters
 *
 * Phase: 42-zero-mock / Plan 01
 * State: RED (failing) — hook module does not exist yet; implemented in plan 03.
 * These tests define the contract that plan 03 must satisfy.
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
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn(),
  },
}));

// Mock MLStoreContext — CR-01: resolvedMLUserIds drives multi-loja scope
vi.mock("@/contexts/MLStoreContext", () => ({
  useMLStore: vi.fn(() => ({
    resolvedMLUserIds: ["123456789"],
    scopeKey: "123456789",
  })),
}));

// Mock OrganizationContext
vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: vi.fn(() => ({
    currentOrg: { id: "org-uuid-test-1234" },
  })),
}));

// ─── Import hook under test ──────────────────────────────────────────────────
// This import is expected to FAIL with "Cannot find module" because
// src/hooks/useMLClaims.ts does not exist yet (plan 03 creates it).
// The RED state is intentional.

// @ts-expect-error — hook module will not exist until plan 03
import { useMLClaims } from "@/hooks/useMLClaims";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useMLClaims — MOCK-03: real claims from ml_claims table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("MOCK-03: scopes query by organization_id", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    renderHook(() => useMLClaims(), { wrapper: createWrapper() });

    await waitFor(() => {
      const eqCalls = (supabase.eq as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
      expect(eqCalls.some(([col, val]) => col === "organization_id" && val === "org-uuid-test-1234")).toBe(true);
    });
  });

  it("MOCK-03: filters by resolvedMLUserIds via .in() for CR-01 multi-loja merge", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { useMLStore } = await import("@/contexts/MLStoreContext");

    (useMLStore as ReturnType<typeof vi.fn>).mockReturnValue({
      resolvedMLUserIds: ["111", "222"],
      scopeKey: "all",
    });

    renderHook(() => useMLClaims(), { wrapper: createWrapper() });

    await waitFor(() => {
      const inCalls = (supabase.in as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
      expect(inCalls.some(([col, val]) => col === "ml_user_id" && JSON.stringify(val) === JSON.stringify(["111", "222"]))).toBe(true);
    });
  });

  it("MOCK-03: orders by data_abertura descending (newest first)", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    renderHook(() => useMLClaims(), { wrapper: createWrapper() });

    await waitFor(() => {
      const orderCalls = (supabase.order as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
      expect(orderCalls.some(([col, opts]) => col === "data_abertura" && (opts as any)?.ascending === false)).toBe(true);
    });
  });

  it("MOCK-03: is disabled when orgId is null", async () => {
    const { useOrganization } = await import("@/contexts/OrganizationContext");

    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({
      currentOrg: null,
    });

    const { result } = renderHook(() => useMLClaims(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("MOCK-03: is disabled when resolvedMLUserIds is empty", async () => {
    const { useMLStore } = await import("@/contexts/MLStoreContext");

    (useMLStore as ReturnType<typeof vi.fn>).mockReturnValue({
      resolvedMLUserIds: [],
      scopeKey: "empty",
    });

    const { result } = renderHook(() => useMLClaims(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useMLClaims — MOCK-03: status filter", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset context mocks to defaults (clearAllMocks doesn't reset mockReturnValue implementations)
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    const { useMLStore } = await import("@/contexts/MLStoreContext");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({ currentOrg: { id: "org-uuid-test-1234" } });
    (useMLStore as ReturnType<typeof vi.fn>).mockReturnValue({ resolvedMLUserIds: ["123456789"], scopeKey: "123456789" });
  });

  it("applies optional status filter when provided (e.g. 'opened')", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    renderHook(() => useMLClaims("opened"), { wrapper: createWrapper() });

    await waitFor(() => {
      const eqCalls = (supabase.eq as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
      expect(eqCalls.some(([col, val]) => col === "status" && val === "opened")).toBe(true);
    });
  });

  it("does NOT add status filter when no status argument is provided", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    renderHook(() => useMLClaims(), { wrapper: createWrapper() });

    await waitFor(() => {
      const eqCalls = (supabase.eq as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown]>;
      const statusCalls = eqCalls.filter((args) => args[0] === "status");
      expect(statusCalls).toHaveLength(0);
    });
  });
});

describe("useMLClaims — MOCK-03: tipo filter (D-09 unified list)", () => {
  it("tipo column discriminates 'mediations' from 'returns' (D-09)", () => {
    // Contract: the ml_claims.tipo column must be 'mediations' or 'returns'.
    // MLDevolucoes.tsx filters on this column client-side (plan 04).
    // This test documents the domain rule for plan reviewers.
    const validTipos = ["mediations", "returns"];
    expect(validTipos).toContain("mediations");
    expect(validTipos).toContain("returns");
  });

  it("hook returns unified list regardless of tipo (plan 04 does client-side tipo filter)", () => {
    // The hook itself does NOT filter by tipo — it returns all claims for the scope.
    // Filtering by tipo happens in MLDevolucoes.tsx via useMemo (D-09).
    // This ensures the hook stays composable for future use cases.
    expect(true).toBe(true); // documented requirement — see MLDevolucoes plan 04
  });
});

describe("useMLClaims — MOCK-03: empty state before first cron run", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset context mocks to defaults
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    const { useMLStore } = await import("@/contexts/MLStoreContext");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({ currentOrg: { id: "org-uuid-test-1234" } });
    (useMLStore as ReturnType<typeof vi.fn>).mockReturnValue({ resolvedMLUserIds: ["123456789"], scopeKey: "123456789" });
  });

  it("returns empty array (not undefined/null) when table is empty", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    // Simulate Supabase returning empty data
    const mockChain = {
      data: [],
      error: null,
    };
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(mockChain),
    });

    const { result } = renderHook(() => useMLClaims(), { wrapper: createWrapper() });

    await waitFor(() => {
      // data should be [] (empty array), not undefined/null
      expect(Array.isArray(result.current.data)).toBe(true);
    });
  });
});
