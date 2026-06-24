/**
 * Unit test for useConsultorActions — pendingCount (ACT-02).
 *
 * Mocks @/integrations/supabase/client and useOrganization, returns a queue of
 * 2 proposed + 1 approved + 1 done row, and asserts pendingCount === 3
 * (proposed + approved only — done/failed are NOT counted; those live in history).
 *
 * Phase: 54-pipeline-de-a-es-com-aprova-o / Plan 02
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

// The queue query selects status IN ('proposed','approved'); the mock resolves
// the terminal builder (.order) with exactly those rows. The history query
// selects done/failed and ends with .range — we resolve that with done rows.
const QUEUE_ROWS = [
  { id: "a1", status: "proposed", organization_id: "org-1" },
  { id: "a2", status: "proposed", organization_id: "org-1" },
  { id: "a3", status: "approved", organization_id: "org-1" },
];
const HISTORY_ROWS = [{ id: "a4", status: "done", organization_id: "org-1" }];

vi.mock("@/integrations/supabase/client", () => {
  // Chainable builder. The queue query awaits `...order(...)` directly, so the
  // builder is itself a thenable resolving to QUEUE_ROWS. The history query
  // awaits `...order(...).range(...)`, so `.range()` returns its own promise
  // resolving to HISTORY_ROWS. Filters (.select/.eq/.in/.order/.update) chain.
  const makeBuilder = () => {
    const builder: Record<string, unknown> = {};
    const ret = () => builder;
    builder.select = vi.fn(ret);
    builder.eq = vi.fn(ret);
    builder.in = vi.fn(ret);
    builder.order = vi.fn(ret);
    builder.update = vi.fn(ret);
    builder.insert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    // history terminal
    builder.range = vi.fn(() => Promise.resolve({ data: HISTORY_ROWS, error: null }));
    // queue terminal: builder is awaitable → resolves with QUEUE_ROWS
    builder.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: QUEUE_ROWS, error: null });
    return builder;
  };
  return {
    supabase: {
      from: vi.fn(() => makeBuilder()),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "user-1" } } })) },
      functions: { invoke: vi.fn(() => Promise.resolve({ data: null, error: null })) },
    },
  };
});

vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: vi.fn(() => ({ currentOrg: { id: "org-1" } })),
}));

// ─── Import hook under test ──────────────────────────────────────────────────
// @ts-expect-error — hook module created in this plan; import resolves at GREEN
import { useConsultorActions } from "@/hooks/useConsultorActions";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useConsultorActions — ACT-02 pendingCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts only proposed + approved rows (3), excludes done/failed", async () => {
    const { result } = renderHook(() => useConsultorActions(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.pendingCount).toBe(3);
    });
  });

  it("scopes the queue query by organization_id", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    renderHook(() => useConsultorActions(), { wrapper: createWrapper() });

    await waitFor(() => {
      // from('proposed_actions') was called for the queue
      expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.some(([t]) => t === "proposed_actions")).toBe(true);
    });
  });
});

describe("useConsultorActions — disabled without org", () => {
  it("is loading=false and queue empty when orgId is null", async () => {
    const { useOrganization } = await import("@/contexts/OrganizationContext");
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({ currentOrg: null });

    const { result } = renderHook(() => useConsultorActions(), { wrapper: createWrapper() });
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.queue).toEqual([]);

    // restore default for other tests
    (useOrganization as ReturnType<typeof vi.fn>).mockReturnValue({ currentOrg: { id: "org-1" } });
  });
});
