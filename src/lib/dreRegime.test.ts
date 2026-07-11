// ============================================================================
// dreRegime.test.ts — Phase 94 Plan 02, Task 1 (TDD)
// Proves the never-mix guardrail (SC3), the byte-identical previsão output
// (SC6 — Phase 88 untouched), the junho/2026 apuração reconciliation (SC2),
// and the full 3-signal empurrãozinho OR (LOCKED, display-only).
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  resolveDreRegime,
  shouldNudgeClose,
  monthPlusOne,
  type ResolveDreRegimeInput,
  type NudgeRow,
} from "./dreRegime";

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseInput(overrides: Partial<ResolveDreRegimeInput> = {}): ResolveDreRegimeInput {
  return {
    isClosed: false,
    cmvMedio: 110613.42,
    hasCmv: true,
    cmvCheio: 133264.87,
    hasCmvCheio: true,
    totalTaxEstimado: 53327.05,
    hasTaxData: true,
    guiaReal: null,
    ...overrides,
  };
}

function nudgeRow(overrides: Partial<NudgeRow> = {}): NudgeRow {
  return {
    category: "Imposto Venda - ICMS",
    amount: 5151.56,
    status: "pending",
    outflowDate: "2026-07-21",
    competenceMonth: "2026-07-01",
    ...overrides,
  };
}

// ── monthPlusOne ─────────────────────────────────────────────────────────────

describe("monthPlusOne", () => {
  it("advances within the same year", () => {
    expect(monthPlusOne("2026-06-01")).toBe("2026-07-01");
  });

  it("rolls over December → January of next year", () => {
    expect(monthPlusOne("2026-12-01")).toBe("2027-01-01");
  });
});

// ── Test A: previsão byte-identical ─────────────────────────────────────────

describe("resolveDreRegime — Test A: previsão byte-identical to legacy expression", () => {
  it("no close row → previsão with cmvMedio/totalTaxEstimado, matching the legacy card expression", () => {
    const input = baseInput({ isClosed: false });
    const result = resolveDreRegime(input);

    // Legacy expression (MercadoLivre.tsx lines 262-264):
    // cmvMes = (has_cmv ? cmv : null) ?? null
    // impostosMes = (has_tax_data ? total_tax : null) ?? null
    const legacyCmvMes = (input.hasCmv ? input.cmvMedio : null) ?? null;
    const legacyImpostosMes = (input.hasTaxData ? input.totalTaxEstimado : null) ?? null;

    expect(result.regime).toBe("previsao");
    expect(result.cmvMes).toBe(legacyCmvMes);
    expect(result.impostosMes).toBe(legacyImpostosMes);
    expect(result.cmvMes).toBe(110613.42);
    expect(result.impostosMes).toBe(53327.05);
    expect(result.apuracaoImpostoReal).toBeNull();
  });

  it("previsão with hasCmv=false and hasTaxData=false → both null (legacy guard)", () => {
    const input = baseInput({ isClosed: false, hasCmv: false, hasTaxData: false });
    const result = resolveDreRegime(input);

    expect(result.regime).toBe("previsao");
    expect(result.cmvMes).toBeNull();
    expect(result.impostosMes).toBeNull();
  });
});

// ── Test B: apuração base ───────────────────────────────────────────────────

describe("resolveDreRegime — Test B: apuração base", () => {
  it("closed → apuração with cmv_cheio + sum of guiaReal totals", () => {
    const input = baseInput({
      isClosed: true,
      guiaReal: [
        { category: "Imposto Venda - ICMS", total: 5151.56, status: "paid" },
        { category: "Imposto Venda - PIS", total: 716.19, status: "paid" },
        { category: "Imposto Venda - COFINS", total: 3298.87, status: "paid" },
      ],
    });
    const result = resolveDreRegime(input);

    expect(result.regime).toBe("apuracao");
    expect(result.cmvMes).toBe(133264.87);
    expect(result.impostosMes).toBeCloseTo(9166.62, 2);
    expect(result.apuracaoImpostoReal).toBeCloseTo(9166.62, 2);
  });

  it("closed with hasCmvCheio=false → cmvMes null", () => {
    const input = baseInput({ isClosed: true, hasCmvCheio: false, guiaReal: [] });
    const result = resolveDreRegime(input);

    expect(result.regime).toBe("apuracao");
    expect(result.cmvMes).toBeNull();
  });

  it("closed with guiaReal null/empty → impostosMes null", () => {
    const input = baseInput({ isClosed: true, guiaReal: null });
    const result = resolveDreRegime(input);

    expect(result.regime).toBe("apuracao");
    expect(result.impostosMes).toBeNull();
    expect(result.apuracaoImpostoReal).toBeNull();

    const input2 = baseInput({ isClosed: true, guiaReal: [] });
    expect(resolveDreRegime(input2).impostosMes).toBeNull();
  });
});

// ── Test C: never mix ───────────────────────────────────────────────────────

describe("resolveDreRegime — Test C: never mix médio+guia-real / cheio+estimado", () => {
  it("previsão output never equals cheio value nor guiaReal sum", () => {
    const input = baseInput({
      isClosed: false,
      guiaReal: [
        { category: "Imposto Venda - ICMS", total: 5151.56, status: "paid" },
        { category: "Imposto Venda - PIS", total: 716.19, status: "paid" },
        { category: "Imposto Venda - COFINS", total: 3298.87, status: "paid" },
      ],
    });
    const result = resolveDreRegime(input);

    expect(result.regime).toBe("previsao");
    // Never the cheio value.
    expect(result.cmvMes).not.toBe(input.cmvCheio);
    // Never the guiaReal sum.
    const guiaSum = input.guiaReal!.reduce((s, g) => s + g.total, 0);
    expect(result.impostosMes).not.toBeCloseTo(guiaSum, 2);
    // Confirms it IS the médio/estimado base.
    expect(result.cmvMes).toBe(input.cmvMedio);
    expect(result.impostosMes).toBe(input.totalTaxEstimado);
  });

  it("apuração output never equals médio value nor estimated total_tax", () => {
    const input = baseInput({
      isClosed: true,
      guiaReal: [
        { category: "Imposto Venda - ICMS", total: 5151.56, status: "paid" },
        { category: "Imposto Venda - PIS", total: 716.19, status: "paid" },
        { category: "Imposto Venda - COFINS", total: 3298.87, status: "paid" },
      ],
    });
    const result = resolveDreRegime(input);

    expect(result.regime).toBe("apuracao");
    // Never the médio value.
    expect(result.cmvMes).not.toBe(input.cmvMedio);
    // Never the estimated total_tax.
    expect(result.impostosMes).not.toBe(input.totalTaxEstimado);
    // Confirms it IS the cheio/guia-real base.
    expect(result.cmvMes).toBe(input.cmvCheio);
    expect(result.impostosMes).toBeCloseTo(9166.62, 2);
  });

  it("resolveDreRegime never reads cmvCheio/guiaReal fields in the previsão branch (structural proof)", () => {
    // Poison cmvCheio/guiaReal with values that would ALSO poison cmvMedio/
    // totalTaxEstimado output if accidentally cross-read.
    const input = baseInput({
      isClosed: false,
      cmvCheio: 999999,
      guiaReal: [{ category: "Imposto Venda - ICMS", total: 999999, status: "paid" }],
    });
    const result = resolveDreRegime(input);
    expect(result.cmvMes).not.toBe(999999);
    expect(result.impostosMes).not.toBe(999999);
  });

  it("resolveDreRegime never reads cmvMedio/totalTaxEstimado fields in the apuração branch (structural proof)", () => {
    const input = baseInput({
      isClosed: true,
      cmvMedio: 999999,
      totalTaxEstimado: 999999,
      guiaReal: [{ category: "Imposto Venda - ICMS", total: 5151.56, status: "paid" }],
    });
    const result = resolveDreRegime(input);
    expect(result.cmvMes).not.toBe(999999);
    expect(result.impostosMes).not.toBe(999999);
  });
});

// ── Test D: junho/2026 reconciliation ───────────────────────────────────────

describe("resolveDreRegime — Test D: junho/2026 apuração reconciliation", () => {
  it("cmv_cheio=133264.87 + guia ICMS/PIS/COFINS → cmvMes/impostosMes toBeCloseTo", () => {
    const input = baseInput({
      isClosed: true,
      cmvCheio: 133264.87,
      hasCmvCheio: true,
      guiaReal: [
        { category: "Imposto Venda - ICMS", total: 5151.56, status: "paid" },
        { category: "Imposto Venda - PIS", total: 716.19, status: "paid" },
        { category: "Imposto Venda - COFINS", total: 3298.87, status: "pending" },
      ],
    });
    const result = resolveDreRegime(input);
    const expectedSum = 5151.56 + 716.19 + 3298.87;

    expect(result.regime).toBe("apuracao");
    expect(result.cmvMes).toBeCloseTo(133264.87, 2);
    expect(result.impostosMes).toBeCloseTo(expectedSum, 2);
    expect(result.apuracaoImpostoReal).toBeCloseTo(expectedSum, 2);
  });
});

// ── Test E: nudge — 3-signal OR ─────────────────────────────────────────────

describe("shouldNudgeClose — Test E: 3-signal OR, LOCKED, display-only", () => {
  const targetCompetence = "2026-07-01"; // M+1 for sale-month M=2026-06

  function allThreeCategories(overrides: Partial<NudgeRow> = {}): NudgeRow[] {
    return [
      nudgeRow({ category: "Imposto Venda - ICMS", ...overrides }),
      nudgeRow({ category: "Imposto Venda - PIS", amount: 716.19, ...overrides }),
      nudgeRow({ category: "Imposto Venda - COFINS", amount: 3298.87, ...overrides }),
    ];
  }

  const prevRowsAllDay21Pending = [
    nudgeRow({
      category: "Imposto Venda - ICMS",
      amount: 5151.56,
      status: "pending",
      outflowDate: "2026-06-21",
      competenceMonth: "2026-06-01",
    }),
    nudgeRow({
      category: "Imposto Venda - PIS",
      amount: 716.19,
      status: "pending",
      outflowDate: "2026-06-21",
      competenceMonth: "2026-06-01",
    }),
    nudgeRow({
      category: "Imposto Venda - COFINS",
      amount: 3298.87,
      status: "pending",
      outflowDate: "2026-06-21",
      competenceMonth: "2026-06-01",
    }),
  ];

  it("Signal 1 alone (vencimento≠21) fires independently", () => {
    const rows = [
      ...allThreeCategories({ outflowDate: "2026-07-21", status: "pending" }),
      ...prevRowsAllDay21Pending,
    ];
    // Override just the ICMS row's outflowDate to day 15.
    rows[0] = { ...rows[0], outflowDate: "2026-07-15" };

    expect(shouldNudgeClose({ rows, targetCompetence })).toBe(true);
  });

  it("Signal 2 alone (status='paid') fires independently", () => {
    const rows = [
      ...allThreeCategories({ outflowDate: "2026-07-21", status: "pending" }),
      ...prevRowsAllDay21Pending,
    ];
    rows[0] = { ...rows[0], status: "paid" };

    expect(shouldNudgeClose({ rows, targetCompetence })).toBe(true);
  });

  it("Signal 3 alone (valor≠anterior) fires independently", () => {
    const rows = [
      ...allThreeCategories({ outflowDate: "2026-07-21", status: "pending" }),
      ...prevRowsAllDay21Pending,
    ];
    // ICMS amount changed vs previous competence placeholder (5151.56 → 5300.00).
    rows[0] = { ...rows[0], amount: 5300.0 };

    expect(shouldNudgeClose({ rows, targetCompetence })).toBe(true);
  });

  it("NONE firing (all day=21, all pending, all amounts equal M placeholder) → false", () => {
    const rows = [
      ...allThreeCategories({ outflowDate: "2026-07-21", status: "pending" }),
      ...prevRowsAllDay21Pending,
    ];

    expect(shouldNudgeClose({ rows, targetCompetence })).toBe(false);
  });

  it("missing category → false (even with day≠21 on the present ones)", () => {
    const rows = [
      nudgeRow({
        category: "Imposto Venda - ICMS",
        outflowDate: "2026-07-15",
        status: "paid",
      }),
      nudgeRow({
        category: "Imposto Venda - PIS",
        amount: 716.19,
        outflowDate: "2026-07-15",
        status: "paid",
      }),
      // COFINS missing entirely.
      ...prevRowsAllDay21Pending,
    ];

    expect(shouldNudgeClose({ rows, targetCompetence })).toBe(false);
  });

  it("is display-only — pure function, never mutates or gates resolveDreRegime", () => {
    // Structural proof: shouldNudgeClose takes no isClosed/regime input at all,
    // and resolveDreRegime takes no rows/nudge input at all — they are disjoint
    // signatures, so one cannot gate the other by construction.
    const nudgeResult = shouldNudgeClose({
      rows: [...allThreeCategories({ outflowDate: "2026-07-15", status: "paid" })],
      targetCompetence,
    });
    expect(typeof nudgeResult).toBe("boolean");

    const regimeResult = resolveDreRegime(baseInput({ isClosed: false }));
    expect(regimeResult.regime).toBe("previsao");
  });
});
