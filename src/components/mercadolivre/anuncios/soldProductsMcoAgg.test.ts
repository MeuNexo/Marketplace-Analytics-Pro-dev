/**
 * Testes do utilitário puro de agregação pós-ads (MCO) por marca/categoria e por anúncio.
 *
 * Cobre os casos obrigatórios do PLAN 83-01:
 *   1. aggregateMcoGroups por marca: agrupa por row.marca, ordena por revenue desc
 *   2. aggregateMcoGroups por categoria via itemsMap.category_id
 *   3. mcoPct do grupo = Σlucro_pos_ads ÷ Σreceita × 100 (não média de %)
 *   4. redCount conta anúncios do grupo com saúde 'vermelho'
 *   5. hasMissingCost = true quando algum anúncio do grupo tem has_cmv=false
 *   6. aggregateMcoItems: has_cmv=false → health='indefinido'
 *   7. aggregateMcoItems: acosPct null quando receita=0
 *   8. aggregateMcoItems: shareOfGroup soma 1 dentro do grupo
 *   9. aggregateMcoItems: ordenação por revenue desc
 *   10. PvMcoItem repassa fielmente os 6 campos do tooltip (cmv, comissao, frete, impostos, adsSpend, mcoReais)
 *
 * Phase: 83-produtos-vendidos-mco-redesign / Plan 01 (TDD RED → GREEN)
 */

import { describe, it, expect } from "vitest";
import { aggregateMcoGroups, aggregateMcoItems } from "./soldProductsMcoAgg";
import type { McoProductRow } from "./soldProductsMcoAgg";

// ─── Dados de fixture ─────────────────────────────────────────────────────────

const makeRow = (overrides: Partial<McoProductRow> & { item_id: string }): McoProductRow => ({
  titulo: null,
  marca: null,
  receita: 0,
  unidades: 0,
  cmv: 0,
  comissao: 0,
  frete: 0,
  impostos: 0,
  ads_spend: 0,
  lucro_pos_ads: 0,
  lucro_pct_pos_ads: null,
  has_cmv: true,
  ...overrides,
});

const buildItemsMap = (entries: Array<{ id: string; category_id?: string | null; title?: string }>) => {
  const m = new Map<string, { category_id?: string | null; title?: string }>();
  entries.forEach((e) => m.set(e.id, { category_id: e.category_id, title: e.title }));
  return m;
};

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("aggregateMcoGroups", () => {
  it("agrupa por row.marca e ordena por revenue desc", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 2, lucro_pos_ads: 3, lucro_pct_pos_ads: 3 }),
      makeRow({ item_id: "MLB002", marca: "Marca B", receita: 500, unidades: 5, lucro_pos_ads: 50, lucro_pct_pos_ads: 10 }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("Marca B");
    expect(result[0].revenue).toBe(500);
    expect(result[1].key).toBe("Marca A");
  });

  it("marca null vira chave \"\" com name \"Sem marca\"", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: null, receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10 }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result[0].key).toBe("");
    expect(result[0].name).toBe("Sem marca");
  });

  it("agrupa por category_id via itemsMap quando pvView='categoria'", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", receita: 200, unidades: 2, lucro_pos_ads: 20, lucro_pct_pos_ads: 10 }),
      makeRow({ item_id: "MLB002", receita: 300, unidades: 3, lucro_pos_ads: 30, lucro_pct_pos_ads: 10 }),
    ];
    const itemsMap = buildItemsMap([
      { id: "MLB001", category_id: "CAT_01" },
      { id: "MLB002", category_id: "CAT_02" },
    ]);

    const result = aggregateMcoGroups(rows, "categoria", itemsMap);

    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("CAT_02");
    expect(result[1].key).toBe("CAT_01");
  });

  it("item não encontrado no itemsMap vira \"Sem categoria\"", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB_UNKNOWN", receita: 100, unidades: 1, lucro_pos_ads: 5, lucro_pct_pos_ads: 5 }),
    ];
    const result = aggregateMcoGroups(rows, "categoria", new Map());

    expect(result[0].key).toBe("");
    expect(result[0].name).toBe("Sem categoria");
  });

  it("mcoPct do grupo = Σlucro_pos_ads ÷ Σreceita × 100 (não média de %)", () => {
    // item1: receita 100, lucro_pos_ads 3 (pct=3%, vermelho)
    // item2: receita 200, lucro_pos_ads 30 (pct=15%, verde)
    // mcoPct grupo = (3+30)/(100+200)*100 = 11 (NÃO a média simples (3+15)/2=9)
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 3, lucro_pct_pos_ads: 3 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 200, unidades: 1, lucro_pos_ads: 30, lucro_pct_pos_ads: 15 }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result).toHaveLength(1);
    expect(result[0].mcoPct).toBeCloseTo(11, 5);
  });

  it("mcoPct do grupo é null quando receita total = 0", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 0, unidades: 0, lucro_pos_ads: 0, lucro_pct_pos_ads: null }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result[0].mcoPct).toBeNull();
  });

  it("redCount conta anúncios do grupo com saúde vermelho", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 3, lucro_pct_pos_ads: 3 }), // vermelho (<=5)
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 200, unidades: 1, lucro_pos_ads: 30, lucro_pct_pos_ads: 15 }), // verde
      makeRow({ item_id: "MLB003", marca: "Marca A", receita: 50, unidades: 1, lucro_pos_ads: 1, lucro_pct_pos_ads: 2 }), // vermelho (<=5)
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result[0].redCount).toBe(2);
  });

  it("hasMissingCost = true quando algum anúncio do grupo tem has_cmv=false", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10, has_cmv: true }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 200, unidades: 1, lucro_pos_ads: 20, lucro_pct_pos_ads: 10, has_cmv: false }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result[0].hasMissingCost).toBe(true);
  });

  it("hasMissingCost = false quando todos os anúncios do grupo têm has_cmv=true", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10, has_cmv: true }),
    ];
    const result = aggregateMcoGroups(rows, "marca", new Map());

    expect(result[0].hasMissingCost).toBe(false);
  });

  it("rows vazio retorna array vazio", () => {
    expect(aggregateMcoGroups([], "marca", new Map())).toHaveLength(0);
  });
});

describe("aggregateMcoItems", () => {
  it("mcoPct do item = lucro_pct_pos_ads (repassado do row)", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 12, lucro_pct_pos_ads: 12.34 }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(result[0].mcoPct).toBe(12.34);
    expect(result[0].mcoReais).toBe(12);
  });

  it("acosPct = ads_spend/receita*100; null quando receita=0", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 200, unidades: 1, ads_spend: 20, lucro_pos_ads: 10, lucro_pct_pos_ads: 5 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 0, unidades: 0, ads_spend: 10, lucro_pos_ads: -10, lucro_pct_pos_ads: null }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    const item1 = result.find((r) => r.item_id === "MLB001")!;
    const item2 = result.find((r) => r.item_id === "MLB002")!;

    expect(item1.acosPct).toBeCloseTo(10, 5);
    expect(item2.acosPct).toBeNull();
  });

  it("has_cmv=false → health='indefinido' (nunca zerar/inventar número)", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10, has_cmv: false }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(result[0].health).toBe("indefinido");
    expect(result[0].hasCmv).toBe(false);
  });

  it("has_cmv=true classifica saúde via classifyMcoHealth", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 3, lucro_pct_pos_ads: 3, has_cmv: true }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 100, unidades: 1, lucro_pos_ads: 12, lucro_pct_pos_ads: 12, has_cmv: true }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    const vermelho = result.find((r) => r.item_id === "MLB001")!;
    const verde = result.find((r) => r.item_id === "MLB002")!;

    expect(vermelho.health).toBe("vermelho");
    expect(verde.health).toBe("verde");
  });

  it("shareOfGroup soma 1.0 dentro do grupo (totalRevenue > 0)", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 200, unidades: 2, lucro_pos_ads: 20, lucro_pct_pos_ads: 10 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", receita: 300, unidades: 3, lucro_pos_ads: 30, lucro_pct_pos_ads: 10 }),
      makeRow({ item_id: "MLB003", marca: "Marca B", receita: 500, unidades: 5, lucro_pos_ads: 50, lucro_pct_pos_ads: 10 }), // outro grupo
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(result).toHaveLength(2);
    const totalShare = result.reduce((sum, item) => sum + item.shareOfGroup, 0);
    expect(totalShare).toBeCloseTo(1.0, 10);

    // Ordenação por revenue desc: MLB002 (300) > MLB001 (200)
    expect(result[0].item_id).toBe("MLB002");
    expect(result[1].item_id).toBe("MLB001");
  });

  it("shareOfGroup = 0 quando totalRevenue = 0", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", receita: 0, unidades: 0, lucro_pos_ads: 0, lucro_pct_pos_ads: null }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(result[0].shareOfGroup).toBe(0);
  });

  it("título preferindo itemsMap.title, fallback row.titulo, fallback item_id", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", marca: "Marca A", titulo: "Título do row", receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10 }),
      makeRow({ item_id: "MLB002", marca: "Marca A", titulo: null, receita: 50, unidades: 1, lucro_pos_ads: 5, lucro_pct_pos_ads: 5 }),
    ];
    const itemsMap = buildItemsMap([{ id: "MLB001", title: "Título do inventory" }]);

    const result = aggregateMcoItems(rows, "Marca A", "marca", itemsMap);

    const item1 = result.find((r) => r.item_id === "MLB001")!;
    const item2 = result.find((r) => r.item_id === "MLB002")!;

    expect(item1.title).toBe("Título do inventory");
    expect(item2.title).toBe("MLB002"); // fallback item_id (titulo null)
  });

  it("repassa fielmente os 6 campos do tooltip (cmv, comissao, frete, impostos, adsSpend, mcoReais)", () => {
    const rows: McoProductRow[] = [
      makeRow({
        item_id: "MLB001",
        marca: "Marca A",
        receita: 100,
        unidades: 1,
        cmv: 30,
        comissao: 12,
        frete: 6.5,
        impostos: 9,
        ads_spend: 8.1,
        lucro_pos_ads: 34.4,
        lucro_pct_pos_ads: 34.4,
      }),
    ];
    const result = aggregateMcoItems(rows, "Marca A", "marca", new Map());

    expect(result[0].cmv).toBe(30);
    expect(result[0].comissao).toBe(12);
    expect(result[0].frete).toBe(6.5);
    expect(result[0].impostos).toBe(9);
    expect(result[0].adsSpend).toBe(8.1);
    expect(result[0].mcoReais).toBe(34.4);
  });

  it("filtra por categoria quando pvView='categoria'", () => {
    const rows: McoProductRow[] = [
      makeRow({ item_id: "MLB001", receita: 100, unidades: 1, lucro_pos_ads: 10, lucro_pct_pos_ads: 10 }),
      makeRow({ item_id: "MLB002", receita: 200, unidades: 1, lucro_pos_ads: 20, lucro_pct_pos_ads: 10 }),
    ];
    const itemsMap = buildItemsMap([
      { id: "MLB001", category_id: "CAT_01" },
      { id: "MLB002", category_id: "CAT_02" },
    ]);

    const result = aggregateMcoItems(rows, "CAT_01", "categoria", itemsMap);

    expect(result).toHaveLength(1);
    expect(result[0].item_id).toBe("MLB001");
  });
});
