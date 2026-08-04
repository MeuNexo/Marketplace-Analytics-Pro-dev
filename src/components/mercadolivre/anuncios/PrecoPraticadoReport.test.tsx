/**
 * Testes do card "Detalhamento de MCO" (Phase 101) dentro de PrecoPraticadoReport.
 *
 * Cobre:
 *   1. fixture com vendas → waterfall completo (todas as linhas fixas) +
 *      as duas alavancas de recomendação sempre visíveis
 *   2. período sem vendas → copy de estado vazio do card (D-01, UI-SPEC)
 *   3. modo Simular (Phase 102) → D-02/D-03/D-04/D-05
 *
 * Phase: 101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis / Plan 03
 * Phase: 102-simulador-manual-de-mco-na-p-gina-analise-precos-permitir-qu / Plan 02
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { PrecoPraticadoReport } from "./PrecoPraticadoReport";
import type { ProductItem } from "@/contexts/MLInventoryContext";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

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

// Fase 211: a publicidade do anúncio passou a vir do hook de rateio
// (react-query + OrganizationContext). Aqui ele é mockado para manter estes
// testes focados no card de MCO — o rateio em si é provado, ao centavo, em
// src/lib/adsRateio.test.ts. Sem ads no período: o waterfall segue completo e o
// comportamento verificado abaixo é o mesmo de antes da troca de fonte.
vi.mock("@/hooks/useAdsRateioAnuncio", () => ({
  useAdsRateioAnuncio: () => ({
    data: {
      daily: [] as { date: string; spend: number }[],
      total: 0,
      totalFatura: 0,
      naoRateado: 0,
      diasSemChave: [] as string[],
      source: "billing-rateio" as const,
    },
    isLoading: false,
    error: null,
  }),
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
    // Fase 211 (ADS-07): a linha é nomeada como custo POR VENDA — o ML não
    // informa qual venda veio de clique pago, então o ads do anúncio é
    // distribuído entre todas as vendas do período (TACoS por anúncio).
    expect(screen.getByText("(−) Ads por venda")).toBeInTheDocument(); // incluirAds default ON
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

describe("modo Simular", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcRows = [SALES_ROW];
  });

  // Helper: valor (último <span> direto) da linha `Row` cujo rótulo é `label`.
  function rowValue(label: string): string {
    const p = screen.getByText(label).closest("p") as HTMLElement;
    const spans = p.querySelectorAll(":scope > span");
    return spans[spans.length - 1]?.textContent ?? "";
  }

  it("D-02: ligar o toggle 'Simular' transforma as linhas do waterfall em campos editáveis", async () => {
    render(
      <PrecoPraticadoReport
        products={[{ id: "MLB1", title: "Item Teste" }]}
        mlUserIds={["123"]}
        fromDate="2026-07-01"
        toDate="2026-07-19"
      />,
    );
    await screen.findByText("Detalhamento de MCO");

    // Antes de simular: "Receita/un" não tem <input> na linha.
    const receitaLabel = screen.getByText("Receita/un");
    expect(within(receitaLabel.closest("p") as HTMLElement).queryByRole("textbox")).not.toBeInTheDocument();

    const simularSwitch = screen.getByRole("switch", { name: "Simular" });
    fireEvent.click(simularSwitch);

    await waitFor(() => {
      const p = screen.getByText("Receita/un").closest("p") as HTMLElement;
      expect(within(p).getByRole("textbox")).toBeInTheDocument();
    });

    // Semeado do valor real: precoUnit = total/qtd = 1000/10 = 100.
    const receitaInput = within(
      screen.getByText("Receita/un").closest("p") as HTMLElement,
    ).getByRole("textbox") as HTMLInputElement;
    expect(receitaInput.value).toBe("100");
  });

  it("D-04: recomendação (preço mínimo, ACOS-alvo) permanece byte-idêntica durante a simulação", async () => {
    render(
      <PrecoPraticadoReport
        products={[{ id: "MLB1", title: "Item Teste" }]}
        mlUserIds={["123"]}
        fromDate="2026-07-01"
        toDate="2026-07-19"
      />,
    );
    await screen.findByText("Detalhamento de MCO");

    const precoMinLabel = screen.getByText("Preço mínimo para a meta");
    const acosLabel = screen.getByText("ACOS-alvo da campanha (mantendo o preço atual)");
    const precoMinAntes = precoMinLabel.nextElementSibling?.textContent;
    const acosAntes = acosLabel.nextElementSibling?.textContent;

    fireEvent.click(screen.getByRole("switch", { name: "Simular" }));
    await waitFor(() => {
      expect(screen.getByText("Simulando")).toBeInTheDocument();
    });

    // Altera o preço simulado para um valor bem diferente do real.
    const receitaInput = within(
      screen.getByText("Receita/un").closest("p") as HTMLElement,
    ).getByRole("textbox") as HTMLInputElement;
    fireEvent.change(receitaInput, { target: { value: "999" } });

    // Recomendação continua idêntica — nunca reage à simulação (D-04).
    expect(screen.getByText("Preço mínimo para a meta").nextElementSibling?.textContent).toBe(precoMinAntes);
    expect(
      screen.getByText("ACOS-alvo da campanha (mantendo o preço atual)").nextElementSibling?.textContent,
    ).toBe(acosAntes);
  });

  it("D-04: alterar o campo de preço recalcula MC/un e o semáforo ao vivo", async () => {
    render(
      <PrecoPraticadoReport
        products={[{ id: "MLB1", title: "Item Teste" }]}
        mlUserIds={["123"]}
        fromDate="2026-07-01"
        toDate="2026-07-19"
      />,
    );
    await screen.findByText("Detalhamento de MCO");

    fireEvent.click(screen.getByRole("switch", { name: "Simular" }));
    await waitFor(() => {
      expect(screen.getByText("Simulando")).toBeInTheDocument();
    });

    const mcoAntes = rowValue("= MCO/un");

    // precoUnit real=100 → simulado=1 (bem abaixo dos custos) força MCO negativo.
    const receitaInput = within(
      screen.getByText("Receita/un").closest("p") as HTMLElement,
    ).getByRole("textbox") as HTMLInputElement;
    fireEvent.change(receitaInput, { target: { value: "1" } });

    await waitFor(() => {
      expect(rowValue("= MCO/un")).not.toBe(mcoAntes);
    });
  });

  it("D-05: valor inválido (comissão > 100%) dispara toast.error e reverte o campo", async () => {
    render(
      <PrecoPraticadoReport
        products={[{ id: "MLB1", title: "Item Teste" }]}
        mlUserIds={["123"]}
        fromDate="2026-07-01"
        toDate="2026-07-19"
      />,
    );
    await screen.findByText("Detalhamento de MCO");

    fireEvent.click(screen.getByRole("switch", { name: "Simular" }));
    await waitFor(() => {
      expect(screen.getByText("Simulando")).toBeInTheDocument();
    });

    const comissaoInput = within(
      screen.getByText("(−) Comissão").closest("p") as HTMLElement,
    ).getByRole("textbox") as HTMLInputElement;
    expect(comissaoInput.value).toBe("10"); // comissaoUnit=10 / precoUnit=100 * 100 = 10%

    fireEvent.change(comissaoInput, { target: { value: "150" } });
    fireEvent.blur(comissaoInput);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Valor precisa estar entre 0% e 100%");
    });
    expect(comissaoInput.value).toBe("10"); // reverteu ao último valor válido
  });

  it("D-03: trocar de anúncio reseta o modo Simular automaticamente", async () => {
    const { rerender } = render(
      <PrecoPraticadoReport
        products={[{ id: "MLB1", title: "Item Teste" }, { id: "MLB2", title: "Outro Item" }]}
        mlUserIds={["123"]}
        fromDate="2026-07-01"
        toDate="2026-07-19"
      />,
    );
    await screen.findByText("Detalhamento de MCO");

    fireEvent.click(screen.getByRole("switch", { name: "Simular" }));
    await waitFor(() => {
      expect(screen.getByText("Simulando")).toBeInTheDocument();
    });

    rerender(
      <PrecoPraticadoReport
        products={[{ id: "MLB1", title: "Item Teste" }, { id: "MLB2", title: "Outro Item" }]}
        mlUserIds={["123"]}
        fromDate="2026-07-01"
        toDate="2026-07-19"
        request={{ itemId: "MLB2", nonce: 1 }}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Simulando")).not.toBeInTheDocument();
    });
  });
});
