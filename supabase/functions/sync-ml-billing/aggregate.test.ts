/**
 * aggregate.test.ts — unit do core puro de agregação por competência (Phase 84,
 * Plan 84-02). Importa de `./aggregate.ts` (nunca de `./index.ts`, que tem
 * imports `https://deno.land/...` inválidos para o resolvedor ESM do Node —
 * mesmo padrão já estabelecido em `nexo-chat/prompt.test.ts`/`tools.test.ts`).
 *
 * Prova: competência da venda (saleDate ?? charge_date), remoção do `within`
 * (estorno de venda fora da janela conta, sempre negativo), fallback para
 * charge_date quando não há saleDate, grão novo (competence_date distinto gera
 * linha distinta mesmo com mesmo charge_date+charge_type), guard de campos
 * ausentes, e arredondamento final.
 */
import { describe, it, expect } from "vitest";
import { aggregateMoves, type RawMove } from "./aggregate";

function move(overrides: Partial<RawMove>): RawMove {
  return {
    detailId: 1,
    date: "2026-07-03",
    type: "CVVML",
    label: "Comissão por venda",
    amount: 10,
    isBonus: false,
    saleDate: null,
    ...overrides,
  };
}

describe("aggregateMoves — regime de competência (Phase 84)", () => {
  it("movimento não-bonus: competence_date = saleDate, amount positivo, agrupado sob a competência da venda", () => {
    const rows = aggregateMoves([
      move({ detailId: 1, date: "2026-07-03", saleDate: "2026-06-10", amount: 25, isBonus: false }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      competence_date: "2026-06-10",
      charge_date: "2026-07-03",
      amount: 25,
    });
  });

  it("bonus (estorno) de venda FORA da janela da fatura: within removido — conta, amount NEGATIVO", () => {
    // saleDate=2026-05-20 é uma venda antiga, fora da janela de uma fatura de
    // julho (que hoje seria excluída pelo `within`); a trilha de competência
    // não tem mais essa exclusão.
    const rows = aggregateMoves([
      move({ detailId: 2, date: "2026-07-03", saleDate: "2026-05-20", amount: 15, isBonus: true }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      competence_date: "2026-05-20",
      charge_date: "2026-07-03",
      amount: -15,
    });
  });

  it("movimento sem saleDate (null) — ex. PADS/mensalidade: competence_date = charge_date (fallback)", () => {
    const rows = aggregateMoves([
      move({ detailId: 3, date: "2026-07-01", type: "PADS", saleDate: null, amount: 99.9, isBonus: false }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ competence_date: "2026-07-01", charge_date: "2026-07-01" });
  });

  it("dois movimentos mesmo charge_date+charge_type mas competence_date diferente → DUAS linhas distintas", () => {
    const rows = aggregateMoves([
      move({ detailId: 4, date: "2026-07-03", type: "CVVML", saleDate: "2026-06-10", amount: 10, isBonus: false }),
      move({ detailId: 5, date: "2026-07-03", type: "CVVML", saleDate: "2026-06-20", amount: 20, isBonus: false }),
    ]);
    expect(rows).toHaveLength(2);
    const byCompetence = Object.fromEntries(rows.map((r) => [r.competence_date, r.amount]));
    expect(byCompetence["2026-06-10"]).toBe(10);
    expect(byCompetence["2026-06-20"]).toBe(20);
  });

  it("movimento sem date ou sem type é ignorado (guard pré-existente)", () => {
    const rows = aggregateMoves([
      move({ detailId: 6, date: "", type: "CVVML" }),
      move({ detailId: 7, date: "2026-07-03", type: "" }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("arredondamento final: amount = Math.round(x*100)/100", () => {
    const rows = aggregateMoves([
      move({ detailId: 8, date: "2026-07-03", type: "CVVML", saleDate: "2026-06-01", amount: 10.001, isBonus: false }),
      move({ detailId: 9, date: "2026-07-03", type: "CVVML", saleDate: "2026-06-01", amount: 0.0049, isBonus: false }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(10.01);
  });

  it("mesmo (competence_date, charge_date, charge_type) acumula amount", () => {
    const rows = aggregateMoves([
      move({ detailId: 10, date: "2026-07-03", type: "CVVML", saleDate: "2026-06-10", amount: 10, isBonus: false }),
      move({ detailId: 11, date: "2026-07-03", type: "CVVML", saleDate: "2026-06-10", amount: 5, isBonus: false }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(15);
  });
});
