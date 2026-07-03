import { describe, it, expect } from "vitest";
import { resumoVariacoes, estoqueDaVariacao } from "./variacoesResumo";
import type { ProductVariation } from "@/contexts/MLInventoryContext";

// Helper: variação mínima com os campos que o util usa.
function variacao(overrides: Partial<ProductVariation>): ProductVariation {
  return {
    variation_id: "vid-default",
    attribute_combinations: [],
    available_quantity: 0,
    sold_quantity: 0,
    price: 0,
    picture_id: null,
    seller_custom_field: null,
    ...overrides,
  };
}

describe("resumoVariacoes", () => {
  it("conta total/esgotadas sobre TODAS as variações e omite variações sem SKU das opções", () => {
    const esgotada = variacao({
      variation_id: "v1",
      seller_custom_field: "SKU-ESGOTADA",
      available_quantity: 0,
      attribute_combinations: [{ id: "a", name: "Tamanho", value: "M" }],
    });
    const comEstoque = variacao({
      variation_id: "v2",
      seller_custom_field: "SKU-COM-ESTOQUE",
      available_quantity: 19,
      attribute_combinations: [{ id: "a", name: "Tamanho", value: "G" }],
    });
    const semSku = variacao({
      variation_id: "v3",
      seller_custom_field: null,
      available_quantity: 5,
    });

    const r = resumoVariacoes([esgotada, comEstoque, semSku]);

    expect(r.total).toBe(3);
    expect(r.esgotadas).toBe(1);
    expect(r.opcoes).toHaveLength(2);
    expect(r.opcoes.every((o) => o.sku !== "")).toBe(true);
  });

  it("label inclui atributo legível + SKU + 'N und', fallback 'Variação' sem atributos", () => {
    const comAtributo = variacao({
      variation_id: "v1",
      seller_custom_field: "SKU-A",
      available_quantity: 10,
      attribute_combinations: [{ id: "a", name: "Tamanho", value: "M" }],
    });
    const semAtributo = variacao({
      variation_id: "v2",
      seller_custom_field: "SKU-B",
      available_quantity: 3,
      attribute_combinations: [],
    });

    const r = resumoVariacoes([comAtributo, semAtributo]);
    const opA = r.opcoes.find((o) => o.sku === "SKU-A");
    const opB = r.opcoes.find((o) => o.sku === "SKU-B");

    expect(opA?.label).toBe("M · SKU-A · 10 und");
    expect(opB?.label).toBe("Variação · SKU-B · 3 und");
  });

  it("ordena opções por estoque desc", () => {
    const baixo = variacao({ variation_id: "v1", seller_custom_field: "SKU-LOW", available_quantity: 2 });
    const alto = variacao({ variation_id: "v2", seller_custom_field: "SKU-HIGH", available_quantity: 50 });

    const r = resumoVariacoes([baixo, alto]);

    expect(r.opcoes[0].sku).toBe("SKU-HIGH");
    expect(r.opcoes[1].sku).toBe("SKU-LOW");
  });

  it("array vazio → total 0, esgotadas 0, opcoes []", () => {
    const r = resumoVariacoes([]);
    expect(r).toEqual({ total: 0, esgotadas: 0, opcoes: [] });
  });
});

describe("estoqueDaVariacao", () => {
  const variations: ProductVariation[] = [
    variacao({ variation_id: "v1", seller_custom_field: "SA025132197AABPCN420603", available_quantity: 19 }),
    variacao({ variation_id: "v2", seller_custom_field: "OUTRO-SKU", available_quantity: 7 }),
  ];

  it("caso-prova real: SKU …420603 estoque 19", () => {
    expect(estoqueDaVariacao(variations, "SA025132197AABPCN420603")).toBe(19);
  });

  it("SKU inexistente → null (nunca inventar 0)", () => {
    expect(estoqueDaVariacao(variations, "SKU-INEXISTENTE")).toBeNull();
  });

  it("sku null → null", () => {
    expect(estoqueDaVariacao(variations, null)).toBeNull();
  });

  it("sku vazio → null", () => {
    expect(estoqueDaVariacao(variations, "")).toBeNull();
  });
});
