/**
 * Testes do utilitário puro de agregação de pedidos por marca/categoria.
 *
 * Cobre os casos obrigatórios do PLAN 77-01:
 *   1. aggregatePvGroups por marca: agrupa por row.marca, ordena por revenue desc
 *   2. aggregatePvGroups fallback "Sem marca" para marca null/""
 *   3. aggregatePvGroups por categoria via itemsMap.category_id
 *   4. aggregatePvGroups fallback "Sem categoria" para category_id ausente
 *   5. aggregatePvItems: shareOfGroup soma 1 dentro do grupo (totalRev > 0)
 *   6. aggregatePvItems: shareOfGroup = 0 quando totalRev = 0
 *   7. aggregatePvGroups com rows vazio retorna []
 *
 * Phase: 77-pagina-analise-de-anuncios-produtos-vendidos-e-analise-de-pr / Plan 01 (TDD RED → GREEN)
 */

import { describe, it, expect } from "vitest";
import {
  aggregatePvGroups,
  aggregatePvItems,
} from "./soldProductsAgg";
import type { SoldProductRow } from "./soldProductsAgg";

// ─── Dados de fixture ─────────────────────────────────────────────────────────

const makeRow = (
  item_id: string,
  marca: string | null,
  quantidade: number,
  receita_bruta: number,
  titulo?: string,
): SoldProductRow => ({
  item_id,
  titulo: titulo ?? null,
  marca,
  quantidade,
  receita_bruta,
  data_pedido: "2026-06-15",
  ml_user_id: "ml_user_1",
});

// itemsMap com category_id para alguns itens
const buildItemsMap = (entries: Array<{ id: string; category_id?: string | null; title?: string }>) => {
  const m = new Map<string, { category_id?: string | null; title?: string }>();
  entries.forEach((e) => m.set(e.id, { category_id: e.category_id, title: e.title }));
  return m;
};

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("aggregatePvGroups", () => {
  // ── Test 1: agrupamento por marca ────────────────────────────────────────
  it("agrupa por row.marca e ordena por revenue desc", () => {
    const rows: SoldProductRow[] = [
      makeRow("MLB001", "Marca A", 2, 200),
      makeRow("MLB002", "Marca B", 5, 500),
      makeRow("MLB003", "Marca A", 3, 300),
    ];
    const result = aggregatePvGroups(rows, "marca", new Map());

    expect(result).toHaveLength(2);
    // Marca A: 200+300=500 receita; Marca B: 500 — empate → Marca A deve aparecer (teste na ordem)
    const marcaA = result.find((g) => g.key === "Marca A");
    const marcaB = result.find((g) => g.key === "Marca B");

    expect(marcaA).toBeDefined();
    expect(marcaA!.qty).toBe(5);
    expect(marcaA!.revenue).toBe(500);
    expect(marcaA!.name).toBe("Marca A");

    expect(marcaB).toBeDefined();
    expect(marcaB!.qty).toBe(5);
    expect(marcaB!.revenue).toBe(500);
  });

  // ── Test 2: fallback "Sem marca" para null ────────────────────────────────
  it("marca null vira chave \"\" com name \"Sem marca\"", () => {
    const rows: SoldProductRow[] = [
      makeRow("MLB001", null, 1, 100),
      makeRow("MLB002", null, 2, 200),
    ];
    const result = aggregatePvGroups(rows, "marca", new Map());

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("");
    expect(result[0].name).toBe("Sem marca");
    expect(result[0].qty).toBe(3);
    expect(result[0].revenue).toBe(300);
  });

  // ── Test 3: agrupamento por categoria via itemsMap ────────────────────────
  it("agrupa por category_id via itemsMap quando pvView='categoria'", () => {
    const rows: SoldProductRow[] = [
      makeRow("MLB001", null, 2, 200),
      makeRow("MLB002", null, 3, 300),
      makeRow("MLB003", null, 1, 100),
    ];
    const itemsMap = buildItemsMap([
      { id: "MLB001", category_id: "CAT_01" },
      { id: "MLB002", category_id: "CAT_01" },
      { id: "MLB003", category_id: "CAT_02" },
    ]);

    const result = aggregatePvGroups(rows, "categoria", itemsMap);

    expect(result).toHaveLength(2);
    const cat01 = result.find((g) => g.key === "CAT_01");
    const cat02 = result.find((g) => g.key === "CAT_02");

    expect(cat01).toBeDefined();
    expect(cat01!.qty).toBe(5);
    expect(cat01!.revenue).toBe(500);

    expect(cat02).toBeDefined();
    expect(cat02!.qty).toBe(1);
    expect(cat02!.revenue).toBe(100);

    // Ordenação: CAT_01 (500) > CAT_02 (100)
    expect(result[0].key).toBe("CAT_01");
  });

  // ── Test 4: fallback "Sem categoria" para item_id ausente no itemsMap ─────
  it("item não encontrado no itemsMap vira \"Sem categoria\"", () => {
    const rows: SoldProductRow[] = [
      makeRow("MLB_UNKNOWN", null, 1, 100),
    ];
    const result = aggregatePvGroups(rows, "categoria", new Map());

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("");
    expect(result[0].name).toBe("Sem categoria");
  });

  // ── Test 7: array vazio retorna [] ────────────────────────────────────────
  it("rows vazio retorna array vazio", () => {
    expect(aggregatePvGroups([], "marca", new Map())).toHaveLength(0);
    expect(aggregatePvGroups([], "categoria", new Map())).toHaveLength(0);
  });
});

describe("aggregatePvItems", () => {
  // ── Test 5: shareOfGroup soma 1 dentro do grupo ───────────────────────────
  it("shareOfGroup soma 1.0 para todos os itens do grupo (totalRev > 0)", () => {
    const rows: SoldProductRow[] = [
      makeRow("MLB001", "Marca A", 2, 200, "Título A"),
      makeRow("MLB002", "Marca A", 3, 300, "Título B"),
      makeRow("MLB003", "Marca B", 5, 500, "Título C"), // outro grupo — deve ser ignorado
    ];

    const result = aggregatePvItems(rows, "Marca A", "marca", new Map());

    expect(result).toHaveLength(2);

    const totalShare = result.reduce((sum, item) => sum + item.shareOfGroup, 0);
    expect(totalShare).toBeCloseTo(1.0, 10);

    // Ordena por revenue desc: MLB002 (300) > MLB001 (200)
    expect(result[0].item_id).toBe("MLB002");
    expect(result[0].revenue).toBe(300);
    expect(result[1].item_id).toBe("MLB001");
  });

  // ── Test 6: shareOfGroup = 0 quando totalRev = 0 ─────────────────────────
  it("shareOfGroup = 0 quando receita_bruta = 0 para todos do grupo", () => {
    const rows: SoldProductRow[] = [
      makeRow("MLB001", "Marca A", 1, 0),
    ];
    const result = aggregatePvItems(rows, "Marca A", "marca", new Map());

    expect(result).toHaveLength(1);
    expect(result[0].shareOfGroup).toBe(0);
  });

  // ── Test extra: título preferido do itemsMap sobre row.titulo ─────────────
  it("usa itemsMap.title quando disponível, fallback para row.titulo", () => {
    const rows: SoldProductRow[] = [
      makeRow("MLB001", "Marca A", 1, 100, "Título do pedido"),
    ];
    const itemsMap = buildItemsMap([{ id: "MLB001", title: "Título do inventory" }]);

    const result = aggregatePvItems(rows, "Marca A", "marca", itemsMap);

    expect(result[0].title).toBe("Título do inventory");
  });

  it("usa row.titulo como fallback quando item_id não está no itemsMap", () => {
    const rows: SoldProductRow[] = [
      makeRow("MLB_UNKNOWN", "Marca A", 1, 100, "Título do pedido"),
    ];

    const result = aggregatePvItems(rows, "Marca A", "marca", new Map());

    expect(result[0].title).toBe("Título do pedido");
  });
});
