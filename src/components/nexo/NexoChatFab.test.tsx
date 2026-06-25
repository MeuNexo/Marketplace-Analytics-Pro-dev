/**
 * Unit test for NexoChatFab — gate de visibilidade ML + kill-switch (NEXO-01 / NEXO-06).
 *
 * Mocks useMLStore (hasMLConnection), a query do kill-switch (consultor_config.llm_enabled)
 * e o NexoChatPanel (stub) para isolar o gate.
 *
 * Casos (T-57-14):
 *  (a) hasMLConnection=false → não renderiza o botão;
 *  (b) hasMLConnection=true + llm_enabled=false → não renderiza;
 *  (c) hasMLConnection=true + habilitado → renderiza o botão.
 *
 * Phase: 57-nexo-conversacional-chat-consultor / Plan 03
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

function renderFab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(NexoChatFab),
    ),
  );
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mlStoreMock = vi.fn(() => ({ hasMLConnection: true }));
vi.mock("@/contexts/MLStoreContext", () => ({
  useMLStore: () => mlStoreMock(),
}));

vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: vi.fn(() => ({ currentOrg: { id: "org-1" } })),
}));

// kill-switch query: consultor_config.llm_enabled by org. Chainable builder whose
// terminal `.maybeSingle()` resolves with the configured row.
let configRow: { llm_enabled: boolean } | null = { llm_enabled: true };
vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = () => {
    const builder: Record<string, unknown> = {};
    const ret = () => builder;
    builder.select = vi.fn(ret);
    builder.eq = vi.fn(ret);
    builder.maybeSingle = vi.fn(() => Promise.resolve({ data: configRow, error: null }));
    return builder;
  };
  return {
    supabase: {
      from: vi.fn(() => makeBuilder()),
      functions: { invoke: vi.fn(() => Promise.resolve({ data: null, error: null })) },
    },
  };
});

// Stub do painel — não nos importa o conteúdo, só o gate do FAB.
vi.mock("@/components/nexo/NexoChatPanel", () => ({
  NexoChatPanel: () => null,
}));

// ─── Import component under test ──────────────────────────────────────────────
import { NexoChatFab } from "@/components/nexo/NexoChatFab";

const FAB_LABEL = /abrir nexo/i;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("NexoChatFab — gate de visibilidade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mlStoreMock.mockReturnValue({ hasMLConnection: true });
    configRow = { llm_enabled: true };
  });

  it("(a) não renderiza o botão quando hasMLConnection é false", async () => {
    mlStoreMock.mockReturnValue({ hasMLConnection: false });
    renderFab();
    // Mesmo após o ciclo de query, o botão nunca aparece.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: FAB_LABEL })).toBeNull();
    });
  });

  it("(b) não renderiza quando o kill-switch (llm_enabled) está false", async () => {
    configRow = { llm_enabled: false };
    renderFab();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: FAB_LABEL })).toBeNull();
    });
    // Garante que tivemos tempo de resolver a query (não é um falso-negativo de timing).
    expect(screen.queryByRole("button", { name: FAB_LABEL })).toBeNull();
  });

  it("(c) renderiza o botão quando ML conectado e kill-switch ligado", async () => {
    renderFab();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: FAB_LABEL })).toBeInTheDocument();
    });
  });
});
