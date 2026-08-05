// ============================================================================
// Fase 214 — trava da armadilha do agrupamento.
//
// SKU que so existe no Tiny tem `item_id = null`. Antes desta fase, o
// agrupamento usava `row.item_id` cru: com 476 itens so-Tiny, TODOS cairiam no
// mesmo balde e virariam UMA linha na tela. A entrega pareceria funcionar e
// estaria errada — por isso este teste existe.
// ============================================================================
import { describe, it, expect } from "vitest";
import { chaveGrupo, type ReplenishmentSkuRow } from "./useReplenishmentBySku";

function linha(over: Partial<ReplenishmentSkuRow>): ReplenishmentSkuRow {
  return {
    item_id: "MLB1", variation_id: null, title: null, brand: null,
    sku_code: "SKU-A", attribute_combinations: null,
    attribute_combinations_label: "", logistic_type: null,
    sku_stock: 0, estoque_full: 0, estoque_cd: 0, estoque_centro: 0,
    tem_anuncio_ativo: true, origem_catalogo: "ml", divergencia_full: null,
    ...over,
  } as ReplenishmentSkuRow;
}

describe("chaveGrupo", () => {
  it("usa o item_id quando existe anuncio", () => {
    expect(chaveGrupo(linha({ item_id: "MLB123", sku_code: "X" }))).toBe("MLB123");
  });

  it("cai para o SKU quando nao ha anuncio", () => {
    expect(chaveGrupo(linha({ item_id: null, sku_code: "BS8991PTO41" })))
      .toBe("sku:BS8991PTO41");
  });

  it("SKUs so-Tiny distintos NAO colapsam na mesma chave", () => {
    const a = chaveGrupo(linha({ item_id: null, sku_code: "SKU-A" }));
    const b = chaveGrupo(linha({ item_id: null, sku_code: "SKU-B" }));
    const c = chaveGrupo(linha({ item_id: null, sku_code: "SKU-C" }));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("nunca produz a string literal 'null' — o bug original", () => {
    expect(chaveGrupo(linha({ item_id: null, sku_code: "Q" }))).not.toBe("null");
  });

  it("um SKU so-Tiny nao colide com um anuncio de mesmo nome", () => {
    expect(chaveGrupo(linha({ item_id: "ABC", sku_code: "Z" })))
      .not.toBe(chaveGrupo(linha({ item_id: null, sku_code: "ABC" })));
  });
});
