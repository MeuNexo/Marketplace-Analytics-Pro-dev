// ============================================================================
// coberturaVendas.test.ts — Fase 213, Plano 01, Task 1
//
// Prova do dedupe por (loja, dia, item) e da soma de vendas dentro da janela
// que alimenta a classe de cobertura (CR-03 / CR-04).
// ============================================================================

import { describe, it, expect } from "vitest";
import { addDays, format } from "date-fns";
import { dedupeVendasDiarias, somarVendasPorItem, type VendaDiariaRow } from "./coberturaVendas";

/** dia(0) = 2026-07-01, dia(29) = 2026-07-30 — 30 dias sequenciais para o caso medido. */
const dia = (offset: number) => format(addDays(new Date("2026-07-01T00:00:00"), offset), "yyyy-MM-dd");

describe("dedupeVendasDiarias", () => {
  it("Test 1: duas linhas de mesma loja, mesmo dia e mesmo item mantém uma só", () => {
    const linhas: VendaDiariaRow[] = [
      { item_id: "MLB1", date: "2026-08-01", qty_sold: 3, ml_user_id: "111" },
      { item_id: "MLB1", date: "2026-08-01", qty_sold: 3, ml_user_id: "111" },
    ];

    expect(dedupeVendasDiarias(linhas)).toHaveLength(1);
  });

  it("Test 2: mesmo dia e mesmo item em lojas diferentes mantém as duas — são vendas distintas", () => {
    const linhas: VendaDiariaRow[] = [
      { item_id: "MLB1", date: "2026-08-01", qty_sold: 3, ml_user_id: "111" },
      { item_id: "MLB1", date: "2026-08-01", qty_sold: 5, ml_user_id: "222" },
    ];

    expect(dedupeVendasDiarias(linhas)).toHaveLength(2);
  });

  it("Test 3: ml_user_id nulo em ambas as linhas trata nulo como chave estável, sem colapsar itens diferentes", () => {
    const linhas: VendaDiariaRow[] = [
      { item_id: "MLB1", date: "2026-08-01", qty_sold: 3, ml_user_id: null },
      { item_id: "MLB2", date: "2026-08-01", qty_sold: 5, ml_user_id: null },
      { item_id: "MLB1", date: "2026-08-01", qty_sold: 3, ml_user_id: null }, // duplicata verdadeira da 1ª linha
    ];

    const result = dedupeVendasDiarias(linhas);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.item_id).sort()).toEqual(["MLB1", "MLB2"]);
  });
});

describe("somarVendasPorItem", () => {
  it("Test 4: soma apenas as linhas com data maior ou igual ao corte", () => {
    const linhas: VendaDiariaRow[] = [
      { item_id: "MLB1", date: "2026-07-30", qty_sold: 10 },
      { item_id: "MLB1", date: "2026-08-01", qty_sold: 4 },
      { item_id: "MLB1", date: "2026-08-02", qty_sold: 6 },
    ];

    const soma = somarVendasPorItem(linhas, "2026-08-01");

    expect(soma.get("MLB1")).toBe(10); // 4 + 6 — exclui a linha de 30/07
  });

  it("Test 5: devolve mapa vazio para lista vazia, e nunca devolve NaN quando qty_sold vem nulo", () => {
    expect(somarVendasPorItem([], "2026-08-01").size).toBe(0);

    const linhas: VendaDiariaRow[] = [
      { item_id: "MLB1", date: "2026-08-01", qty_sold: null },
      { item_id: "MLB1", date: "2026-08-02", qty_sold: 5 },
    ];
    const soma = somarVendasPorItem(linhas, "2026-08-01");

    expect(soma.get("MLB1")).toBe(5);
    expect(Number.isNaN(soma.get("MLB1"))).toBe(false);
  });

  it("Test 6 (caso medido CR-03): 30 linhas de um item, uma por dia — janela de 30 dias soma o total das 30, janela de 7 soma só as 7 mais recentes", () => {
    // dia(0) é o mais antigo, dia(29) o mais recente; qty_sold cresce com o índice
    // para que a soma prove QUAIS 7 dias entraram, não só quantos.
    const linhas: VendaDiariaRow[] = Array.from({ length: 30 }, (_, i) => ({
      item_id: "MLB999",
      date: dia(i),
      qty_sold: i + 1, // dia(0) = 1 ... dia(29) = 30
    }));

    const somaJanela30 = somarVendasPorItem(linhas, dia(0));
    expect(somaJanela30.get("MLB999")).toBe(465); // soma de 1..30

    const somaJanela7 = somarVendasPorItem(linhas, dia(23)); // últimos 7 dias: dia(23)..dia(29)
    expect(somaJanela7.get("MLB999")).toBe(24 + 25 + 26 + 27 + 28 + 29 + 30); // = 189
  });
});
