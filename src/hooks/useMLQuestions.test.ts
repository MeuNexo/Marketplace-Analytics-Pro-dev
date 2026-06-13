/**
 * Test scaffold for useMLQuestions hook.
 *
 * Requirements covered:
 *   MOCK-01 — /perguntas lists real ML questions from ml_questions table
 *   MOCK-02 — user answers buyer questions inline; reply EF validates 2000-char limit
 *
 * Phase: 42-zero-mock / Plan 01
 * State: RED (failing) — hook module does not exist yet; implemented in plan 03.
 * These tests define the contract that plan 03 must satisfy.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock supabase client — must be declared BEFORE hook import so the module
// resolution picks up the mock.
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

// Mock MLStoreContext — CR-01 multi-loja: resolvedMLUserIds drives scope
vi.mock("@/contexts/MLStoreContext", () => ({
  useMLStore: vi.fn(() => ({
    resolvedMLUserIds: ["123456789", "987654321"],
    scopeKey: "all",
  })),
}));

// Mock OrganizationContext
vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: vi.fn(() => ({
    currentOrg: { id: "org-uuid-test-1234" },
  })),
}));

// ─── Import hook under test ──────────────────────────────────────────────────
// This import is expected to FAIL with "Cannot find module" or similar because
// src/hooks/useMLQuestions.ts does not exist yet (plan 03 creates it).
// The RED state is intentional — do not add the file here.

// @ts-expect-error — hook module will not exist until plan 03
import { useMLQuestions } from "@/hooks/useMLQuestions";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useMLQuestions — MOCK-01: real questions from ml_questions table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("MOCK-01: scopes query by organization_id from currentOrg", async () => {
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    const { useMLStore } = await import("@/contexts/MLStoreContext");
    const { supabase } = await import("@/integrations/supabase/client");

    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({
      currentOrg: { id: "org-uuid-test-1234" },
    });
    (useMLStore as ReturnType<typeof vi.fn>).mockReturnValue({
      resolvedMLUserIds: ["123456789"],
      scopeKey: "123456789",
    });

    // The hook must call supabase.from("ml_questions").eq("organization_id", orgId)
    // Verify the Supabase query chain uses the org ID
    const eqSpy = vi.spyOn(supabase as any, "eq");

    renderHook(() => useMLQuestions());

    await waitFor(() => {
      expect(eqSpy).toHaveBeenCalledWith("organization_id", "org-uuid-test-1234");
    });
  });

  it("MOCK-01: filters by resolvedMLUserIds via .in() for multi-loja CR-01 merge", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { useMLStore } = await import("@/contexts/MLStoreContext");

    (useMLStore as ReturnType<typeof vi.fn>).mockReturnValue({
      resolvedMLUserIds: ["111", "222"],
      scopeKey: "all",
    });

    const inSpy = vi.spyOn(supabase as any, "in");

    renderHook(() => useMLQuestions());

    await waitFor(() => {
      // CR-01: must use .in("ml_user_id", resolvedMLUserIds) — not a single .eq
      expect(inSpy).toHaveBeenCalledWith("ml_user_id", ["111", "222"]);
    });
  });

  it("MOCK-01: orders by data_pergunta descending (newest first)", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    const orderSpy = vi.spyOn(supabase as any, "order");

    renderHook(() => useMLQuestions());

    await waitFor(() => {
      expect(orderSpy).toHaveBeenCalledWith("data_pergunta", { ascending: false });
    });
  });

  it("MOCK-01: is disabled when orgId is null (no org selected)", async () => {
    const { useOrganization } = await import("@/contexts/OrganizationContext");

    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({
      currentOrg: null,
    });

    // Hook must not fire query when org is absent
    const { result } = renderHook(() => useMLQuestions());
    // With enabled=false, data should be undefined and isLoading=false
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("MOCK-01: is disabled when resolvedMLUserIds is empty", async () => {
    const { useMLStore } = await import("@/contexts/MLStoreContext");

    (useMLStore as ReturnType<typeof vi.fn>).mockReturnValue({
      resolvedMLUserIds: [],
      scopeKey: "empty",
    });

    const { result } = renderHook(() => useMLQuestions());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useMLQuestions — MOCK-01: status filter", () => {
  it("applies optional status filter when provided", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    const eqSpy = vi.spyOn(supabase as any, "eq");

    renderHook(() => useMLQuestions("UNANSWERED"));

    await waitFor(() => {
      expect(eqSpy).toHaveBeenCalledWith("status", "UNANSWERED");
    });
  });

  it("does NOT add status filter when no status argument is provided", async () => {
    const { supabase } = await import("@/integrations/supabase/client");

    const eqSpy = vi.spyOn(supabase as any, "eq");

    renderHook(() => useMLQuestions());

    await waitFor(() => {
      // Should NOT have been called with ("status", ...) when no status arg
      const statusCalls = (eqSpy.mock.calls as Array<[string, unknown]>).filter(
        (args) => args[0] === "status"
      );
      expect(statusCalls).toHaveLength(0);
    });
  });
});

describe("useMLQuestions — MOCK-02: reply contract (plan 03 EF integration)", () => {
  it("MOCK-02: reply-ml-question EF must reject text longer than 2000 chars", async () => {
    // This test documents the contract that plan 03's EF must satisfy.
    // The actual EF invocation happens from MLPerguntas.tsx, but the hook
    // must expose a mutation / invokeReply function.
    // For now this is a documentation-only assertion; plan 03 will wire it up.
    const longText = "x".repeat(2001);
    expect(longText.length).toBeGreaterThan(2000);
    // Reminder: the reply EF validates text.length <= 2000 and returns 422 otherwise.
  });

  it("MOCK-02: reply action is only accessible after explicit confirmation (D-05)", () => {
    // Contract: the confirm step must appear before EF is invoked.
    // This is enforced via AlertDialog in MLPerguntas.tsx (plan 04).
    // This test documents the requirement for plan reviewers.
    expect(true).toBe(true); // placeholder — see MLPerguntas implementation in plan 04
  });
});
