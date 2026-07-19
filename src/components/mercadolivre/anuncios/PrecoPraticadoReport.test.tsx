/**
 * Testes do card "Detalhamento de MCO" (Phase 101) dentro de PrecoPraticadoReport.
 *
 * Cobre:
 *   1. fixture com vendas → waterfall completo (todas as linhas fixas) +
 *      as duas alavancas de recomendação sempre visíveis
 *   2. período sem vendas → copy de estado vazio do card (D-01, UI-SPEC)
 *
 * Phase: 101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis / Plan 03
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PrecoPraticadoReport } from "./PrecoPraticadoReport";
import type { ProductItem } from "@/contexts/MLInventoryContext";

// jsdom não implementa ResizeObserver (recharts ResponsiveContainer usa via
// effect) — polyfill mínimo local, não altera o setup global do projeto.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error — polyfill de teste, jsdom não define este global
global.ResizeObserver = ResizeObserverMock;

// ─── Mocks ──────────────────────────────────────────────────────────────────

const SALES_ROW = {
  bucket: "2026-07-01",
  qtd: 10,
  total: 1000,
  cmv: 300,
  comissao: 100,
  frete: 50,
  qtd_sem_custo: 0,
  impostos: 50,
  qtd_sem_imposto: 0,
};

// Controla o payload devolvido pela RPC orders_price_timeseries entre testes.
let rpcRows: unknown[] = [SALES_ROW];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockImplementation(() => Promise.resolve({ data: rpcRows, error: null })),
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    }),
  },
}));

vi.mock("@/contexts/MLInventoryContext", () => ({
  useMLInventory: () => ({ items: [] as ProductItem[] }),
}));

const upsertMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/useMcoTargets", () => ({
  useMcoTargets: () => ({
    targets: new Map<string, number>(),
    keyOf: (itemId: string, sku: string | null) => `${itemId}::${sku ?? ""}`,
    upsert: upsertMock,
    refetch: vi.fn(),
  }),
}));

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("PrecoPraticadoReport — card Detalhamento de MCO", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcRows = [SALES_ROW];
  });

  it("fixture com vendas: renderiza o waterfall completo e as duas alavancas de recomendação", async () => {
    render(
      <PrecoPraticadoReport
        products={[{ id: "MLB1", title: "Item Teste" }]}
        mlUserIds={["123"]}
        fromDate="2026-07-01"
        toDate="2026-07-19"
      />,
    );

    expect(await screen.findByText("Detalhamento de MCO")).toBeInTheDocument();

    // Waterfall — ordem fixa (D-02)
    expect(screen.getByText("Receita/un")).toBeInTheDocument();
    expect(screen.getByText("(−) CMV")).toBeInTheDocument();
    expect(screen.getByText("(−) Comissão")).toBeInTheDocument();
    expect(screen.getByText("(−) Frete")).toBeInTheDocument();
    expect(screen.getByText("(−) Impostos")).toBeInTheDocument();
    expect(screen.getByText("= Margem de Contribuição/un")).toBeInTheDocument();
    expect(screen.getByText("(−) Ads")).toBeInTheDocument(); // incluirAds default ON
    expect(screen.getByText("= MCO/un")).toBeInTheDocument();

    // Meta MCO% + recomendação sempre visível (D-08)
    expect(screen.getByText("Meta MCO%:")).toBeInTheDocument();
    expect(screen.getByText("Preço mínimo para a meta")).toBeInTheDocument();
    expect(screen.getByText("ACOS-alvo da campanha (mantendo o preço atual)")).toBeInTheDocument();
  });

  it("período sem vendas: mostra o estado vazio do card (não o waterfall)", async () => {
    rpcRows = [];

    render(
      <PrecoPraticadoReport
        products={[{ id: "MLB1", title: "Item Teste" }]}
        mlUserIds={["123"]}
        fromDate="2026-07-01"
        toDate="2026-07-19"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Sem vendas no período selecionado")).toBeInTheDocument();
    });
    expect(screen.queryByText("Detalhamento de MCO")).not.toBeInTheDocument();
  });
});
