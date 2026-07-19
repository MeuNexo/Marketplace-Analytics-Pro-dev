// ============================================================================
// dreInss.test.ts — Phase 98 Plan 02, Task 1 (TDD)
// Prova o deslocamento M+1 do INSS de folha no bloco Pessoal: soma real
// filtrando cancelled (resolveInssReal), remoção da linha crua não-deslocada
// (filterRawInssRow), fusão no bloco Pessoal já montado (applyInssReal) e o
// portão previsão×apuração (resolveInssForCascade). Fixture de abril real
// (98-RESEARCH.md Addendum): competence_date=2026-04-01 com DUAS linhas,
// {1550, cancelled} + {2652.31, paid} → resolve para 2652.31 sem código especial.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  INSS_FOLHA_CATEGORY,
  resolveInssReal,
  filterRawInssRow,
  applyInssReal,
  resolveInssForCascade,
} from "./dreInss";
import { buildDreCascade, type DreOperationalRow, type DreCascade } from "./dreCascade";
import type { GuiaRealCategoryTotal } from "./dreRegime";

// ── Helpers ──────────────────────────────────────────────────────────────────

function row(
  bloco: DreOperationalRow["bloco"],
  total: number,
  opts: { category?: string; n?: number; double_count_risk?: boolean } = {},
): DreOperationalRow {
  return {
    bloco,
    category: opts.category ?? bloco,
    total,
    n: opts.n ?? 1,
    double_count_risk: opts.double_count_risk ?? false,
  };
}

function guia(overrides: Partial<GuiaRealCategoryTotal> = {}): GuiaRealCategoryTotal {
  return { category: INSS_FOLHA_CATEGORY, total: 1550, status: "paid", ...overrides };
}

// ── resolveInssReal ──────────────────────────────────────────────────────────

describe("resolveInssReal", () => {
  it("null → null", () => {
    expect(resolveInssReal(null)).toBeNull();
  });

  it("[] → null", () => {
    expect(resolveInssReal([])).toBeNull();
  });

  it("uma linha paid → soma direta", () => {
    expect(resolveInssReal([guia({ total: 1550, status: "paid" })])).toBe(1550);
  });

  it("abril real: cancelled + paid na mesma competência → só a paid soma (2652.31)", () => {
    const result = resolveInssReal([
      guia({ total: 1550, status: "cancelled" }),
      guia({ total: 2652.31, status: "paid" }),
    ]);
    expect(result).toBe(2652.31);
  });

  it("só cancelled (mês 100% crédito) → 0, NÃO null", () => {
    const result = resolveInssReal([guia({ total: 1550, status: "cancelled" })]);
    expect(result).toBe(0);
    expect(result).not.toBeNull();
  });

  it("pending também soma", () => {
    expect(resolveInssReal([guia({ total: 3852.19, status: "pending" })])).toBe(3852.19);
  });
});

// ── filterRawInssRow ─────────────────────────────────────────────────────────

describe("filterRawInssRow", () => {
  it("remove a linha de categoria Pessoal - INSS, preserva as demais", () => {
    const rows: DreOperationalRow[] = [
      row("pessoal", 24000, { category: "Salários" }),
      row("pessoal", 3852.19, { category: INSS_FOLHA_CATEGORY }),
      row("estrutura", 500),
    ];
    const result = filterRawInssRow(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.category)).toEqual(["Salários", "estrutura"]);
  });

  it("sem nenhuma linha de INSS → no-op (mesmo conteúdo)", () => {
    const rows: DreOperationalRow[] = [
      row("pessoal", 24000, { category: "Salários" }),
      row("estrutura", 500),
    ];
    const result = filterRawInssRow(rows);
    expect(result).toEqual(rows);
  });
});

// ── applyInssReal ────────────────────────────────────────────────────────────

describe("applyInssReal", () => {
  it("bloco pessoal já existente + inssReal → soma no total, propaga delta nos subtotais", () => {
    const cascade = buildDreCascade([row("pessoal", 24000)], 100000);
    const result = applyInssReal(cascade, 3852.19);

    const pessoal = result.operacionalBlocos.find((b) => b.bloco === "pessoal");
    expect(pessoal?.total).toBe(27852.19);
    expect(result.totalOperacionalDeducoes).toBe(cascade.totalOperacionalDeducoes + 3852.19);
    expect(result.resultadoOperacional).toBe(cascade.resultadoOperacional - 3852.19);
    expect(result.resultadoLiquido).toBe(cascade.resultadoLiquido - 3852.19);
  });

  it("inssReal=null → no-op, cascata devolvida sem nenhuma alteração", () => {
    const cascade = buildDreCascade([row("pessoal", 24000)], 100000);
    const result = applyInssReal(cascade, null);
    expect(result).toEqual(cascade);
  });

  it("inssReal=0 SEM bloco pessoal pré-existente → cria a linha (prova == null, nunca falsy)", () => {
    const cascade = buildDreCascade([row("estrutura", 500)], 100000);
    expect(cascade.operacionalBlocos.some((b) => b.bloco === "pessoal")).toBe(false);

    const result = applyInssReal(cascade, 0);
    const pessoal = result.operacionalBlocos.find((b) => b.bloco === "pessoal");
    expect(pessoal).toBeDefined();
    expect(pessoal?.total).toBe(0);
  });

  it("inssReal=0 COM bloco pessoal pré-existente → total inalterado (+0), mas processa", () => {
    const cascade = buildDreCascade([row("pessoal", 24000)], 100000);
    const result = applyInssReal(cascade, 0);
    const pessoal = result.operacionalBlocos.find((b) => b.bloco === "pessoal");
    expect(pessoal?.total).toBe(24000);
  });

  it("cascata SEM bloco pessoal + inssReal → cria a linha na FRENTE, preservando ordem das demais", () => {
    const cascade = buildDreCascade(
      [row("estrutura", 500), row("servicos", 200)],
      100000,
    );
    const result = applyInssReal(cascade, 2652.31);

    expect(result.operacionalBlocos[0]).toEqual({
      bloco: "pessoal",
      label: "Pessoal",
      total: 2652.31,
      doubleCountRisk: false,
    });
    expect(result.operacionalBlocos.map((b) => b.bloco)).toEqual([
      "pessoal",
      "estrutura",
      "servicos",
    ]);
  });
});

// ── resolveInssForCascade ────────────────────────────────────────────────────

describe("resolveInssForCascade", () => {
  it("regime previsão → rows sem alteração, inssReal null, mesmo com guia populada", () => {
    const rows: DreOperationalRow[] = [
      row("pessoal", 24000, { category: "Salários" }),
      row("pessoal", 1550, { category: INSS_FOLHA_CATEGORY }),
    ];
    const guiaReal: GuiaRealCategoryTotal[] = [guia({ total: 2652.31, status: "paid" })];

    const result = resolveInssForCascade({ regime: "previsao", rows, guia: guiaReal });
    expect(result.rows).toEqual(rows);
    expect(result.inssReal).toBeNull();
  });

  it("regime apuração com fixture de abril → rows filtradas, inssReal=2652.31", () => {
    const rows: DreOperationalRow[] = [
      row("pessoal", 24000, { category: "Salários" }),
      row("pessoal", 1550, { category: INSS_FOLHA_CATEGORY }),
    ];
    const guiaReal: GuiaRealCategoryTotal[] = [
      guia({ total: 1550, status: "cancelled" }),
      guia({ total: 2652.31, status: "paid" }),
    ];

    const result = resolveInssForCascade({ regime: "apuracao", rows, guia: guiaReal });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].category).toBe("Salários");
    expect(result.inssReal).toBe(2652.31);
  });

  // ── Integração: resolveInssForCascade → buildDreCascade → applyInssReal ──

  it("integração apuração: total final do bloco pessoal = 24000 + 2652.31 (nunca 24000+1550)", () => {
    const rows: DreOperationalRow[] = [
      row("pessoal", 24000, { category: "Salários" }),
      row("pessoal", 1550, { category: INSS_FOLHA_CATEGORY }),
    ];
    const guiaReal: GuiaRealCategoryTotal[] = [
      guia({ total: 1550, status: "cancelled" }),
      guia({ total: 2652.31, status: "paid" }),
    ];

    const { rows: filteredRows, inssReal } = resolveInssForCascade({
      regime: "apuracao",
      rows,
      guia: guiaReal,
    });
    const cascade: DreCascade = buildDreCascade(filteredRows, 100000);
    const final = applyInssReal(cascade, inssReal);

    const pessoal = final.operacionalBlocos.find((b) => b.bloco === "pessoal");
    expect(pessoal?.total).toBe(26652.31);
    expect(pessoal?.total).not.toBe(25550);
  });

  it("integração previsão: total final do bloco pessoal = 24000 + 1550 (idêntico ao comportamento anterior)", () => {
    const rows: DreOperationalRow[] = [
      row("pessoal", 24000, { category: "Salários" }),
      row("pessoal", 1550, { category: INSS_FOLHA_CATEGORY }),
    ];
    const guiaReal: GuiaRealCategoryTotal[] = [guia({ total: 2652.31, status: "paid" })];

    const { rows: filteredRows, inssReal } = resolveInssForCascade({
      regime: "previsao",
      rows,
      guia: guiaReal,
    });
    const cascade: DreCascade = buildDreCascade(filteredRows, 100000);
    const final = applyInssReal(cascade, inssReal);

    const pessoal = final.operacionalBlocos.find((b) => b.bloco === "pessoal");
    expect(pessoal?.total).toBe(25550);
  });
});
