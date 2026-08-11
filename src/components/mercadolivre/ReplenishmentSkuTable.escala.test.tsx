/**
 * Teste de ESCALA — reproduz a proporção real do dataset de produção da
 * Pé Vermeio na tela /compras: 781 linhas, das quais 503 são SKUs só-Tiny
 * (`item_id: null`, D-1 "só sinalizar") contra 99 grupos com anúncio ML.
 *
 * Os testes de regressão em `ReplenishmentSkuTable.test.tsx` provam o
 * comportamento com 2-3 fixtures. Este prova que o mesmo vale no volume em
 * que o Wesley viu o bug — 503 keys colidindo é um regime diferente de 2.
 *
 * Ver .planning/debug/compras-grupos-key-nula.md
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReplenishmentSkuTable } from "./ReplenishmentSkuTable";
import type {
  GroupedReplenishmentRow,
  ReplenishmentSkuRow,
} from "@/hooks/useReplenishmentBySku";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function sku(over: Partial<ReplenishmentSkuRow>): ReplenishmentSkuRow {
  return {
    item_id: null,
    variation_id: null,
    title: null,
    brand: null,
    sku_code: null,
    attribute_combinations: null,
    attribute_combinations_label: "",
    logistic_type: null,
    sku_stock: 0,
    estoque_full: 0,
    estoque_cd: 0,
    estoque_centro: 0,
    tem_anuncio_ativo: true,
    origem_catalogo: "tiny",
    divergencia_full: null,
    venda_dia: 0,
    cobertura_atual: null,
    ponto_reposicao: 0,
    alvo: 0,
    compra_sugerida: 0,
    valor_estimado: null,
    custo_ausente: false,
    sem_giro: false,
    gatilho_ativo: false,
    param_lead_time: 7,
    param_cobertura: 15,
    param_safety: 3,
    param_moq: 1,
    param_pack: 1,
    param_origem: "global",
    qtd_a_caminho: 0,
    data_proxima_chegada: null,
    venda_dia_origem: "simples",
    lead_time_origem: "param",
    tendencia: "~",
    fator_sazonal: null,
    lead_time_real: null,
    venda_simples: 0,
    venda_inteligente: null,
    status_esgotado: "com_giro",
    ...over,
  };
}

function grupo(
  skus: ReplenishmentSkuRow[],
  over: Partial<GroupedReplenishmentRow> = {},
): GroupedReplenishmentRow {
  return {
    item_id: skus[0]?.item_id ?? null,
    title: skus[0]?.title ?? null,
    brand: skus[0]?.brand ?? null,
    logistic_type: null,
    skus,
    total_compra_sugerida: skus.reduce((s, r) => s + r.compra_sugerida, 0),
    total_valor_estimado: null,
    any_gatilho_ativo: skus.some((s) => s.gatilho_ativo),
    any_custo_ausente: skus.some((s) => s.custo_ausente),
    total_a_caminho: 0,
    ...over,
  };
}

/**
 * 503 grupos só-Tiny (item_id null) + 99 grupos com anúncio ML.
 * Metade dos só-Tiny recebe 2 variações para exercitar o Collapsible —
 * é aí que a identidade de expansão colidia.
 */
function datasetProducao() {
  const soTiny = Array.from({ length: 503 }, (_, i) =>
    grupo(
      i % 2 === 0
        ? [
            sku({ sku_code: `TINY-${i}-A`, attribute_combinations_label: `Cor${i} / P`, title: `Produto Tiny ${i}`, brand: null }),
            sku({ sku_code: `TINY-${i}-B`, attribute_combinations_label: `Cor${i} / M`, title: `Produto Tiny ${i}`, brand: null }),
          ]
        : [sku({ sku_code: `TINY-${i}-U`, title: `Produto Tiny ${i}`, brand: null })],
      { title: `Produto Tiny ${i}`, brand: null },
    ),
  );

  const comAnuncio = Array.from({ length: 99 }, (_, i) =>
    grupo(
      [
        sku({ item_id: `MLB${i}`, variation_id: `v${i}a`, sku_code: `ML-${i}-A`, attribute_combinations_label: `Preto / ${38 + i}`, title: `Anúncio ML ${i}`, brand: `Marca ${i % 5}` }),
        sku({ item_id: `MLB${i}`, variation_id: `v${i}b`, sku_code: `ML-${i}-B`, attribute_combinations_label: `Branco / ${38 + i}`, title: `Anúncio ML ${i}`, brand: `Marca ${i % 5}` }),
      ],
      { item_id: `MLB${i}`, title: `Anúncio ML ${i}`, brand: `Marca ${i % 5}` },
    ),
  );

  return [...soTiny, ...comAnuncio];
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("ReplenishmentSkuTable — escala de produção (602 grupos / 781 SKUs)", { timeout: 60000 }, () => {
  it("não dispara aviso de key duplicada com 503 grupos sem item_id", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<ReplenishmentSkuTable grouped={datasetProducao()} />);

    const avisos = spy.mock.calls
      .map((c) => String(c[0] ?? ""))
      .filter((m) => /same key|duplicate key|unique "key"/i.test(m));

    spy.mockRestore();
    expect(avisos).toEqual([]);
  });

  it("expandir um grupo sem anúncio não expande nenhum dos outros 502", () => {
    render(<ReplenishmentSkuTable grouped={datasetProducao()} />);

    // Grupo 0 e grupo 2 são ambos só-Tiny com 2 variações (item_id null nos dois).
    const botoes = screen.getAllByLabelText("Expandir variações");
    fireEvent.click(botoes[0]);

    // A variação do grupo 0 aparece...
    expect(screen.getByText("Cor0 / P")).toBeInTheDocument();
    // ...e a de nenhum outro grupo só-Tiny aparece junto.
    expect(screen.queryByText("Cor2 / P")).not.toBeInTheDocument();
    expect(screen.queryByText("Cor4 / P")).not.toBeInTheDocument();
    expect(screen.queryByText("Cor500 / P")).not.toBeInTheDocument();
  });

  it("filtrar (trocar o conjunto exibido) não herda expansão para um grupo nunca clicado", () => {
    const todos = datasetProducao();
    const { rerender } = render(<ReplenishmentSkuTable grouped={todos} />);

    // Expande o primeiro grupo só-Tiny.
    fireEvent.click(screen.getAllByLabelText("Expandir variações")[0]);
    expect(screen.getByText("Cor0 / P")).toBeInTheDocument();

    // Simula o filtro de Marca do MLCompras: só os grupos com anúncio sobram.
    rerender(<ReplenishmentSkuTable grouped={todos.filter((g) => g.item_id !== null)} />);

    // Nenhum grupo remanescente pode nascer expandido — nenhum foi clicado.
    expect(screen.queryByText("Preto / 38")).not.toBeInTheDocument();
    expect(screen.queryByText("Cor0 / P")).not.toBeInTheDocument();
    // E o filtro de fato reduziu a lista para os 99 com anúncio.
    expect(screen.getByText("Anúncio ML 0")).toBeInTheDocument();
    expect(screen.queryByText("Produto Tiny 0")).not.toBeInTheDocument();
  });
});
