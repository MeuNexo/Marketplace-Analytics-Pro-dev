import { describe, it, expect } from "vitest";
import { calculateEffectiveRate, clampEffectiveRate, computeTaxAmount } from "./index";

// ─── calculateEffectiveRate ───────────────────────────────────────────────────

describe("calculateEffectiveRate", () => {
  // ── Simples Nacional ──────────────────────────────────────────────────────

  describe("simples_nacional", () => {
    it("returns sn_aliquota_efetiva directly", () => {
      expect(calculateEffectiveRate({ regime: "simples_nacional", sn_aliquota_efetiva: 6.0 })).toBe(6.0);
    });

    it("returns 0 when sn_aliquota_efetiva is null", () => {
      expect(calculateEffectiveRate({ regime: "simples_nacional", sn_aliquota_efetiva: null })).toBe(0);
    });

    it("returns 0 when sn_aliquota_efetiva is undefined (field omitted)", () => {
      expect(calculateEffectiveRate({ regime: "simples_nacional" })).toBe(0);
    });

    it("handles the minimum valid rate (0.5)", () => {
      expect(calculateEffectiveRate({ regime: "simples_nacional", sn_aliquota_efetiva: 0.5 })).toBeCloseTo(0.5);
    });

    it("handles the maximum valid rate (19.5)", () => {
      expect(calculateEffectiveRate({ regime: "simples_nacional", sn_aliquota_efetiva: 19.5 })).toBeCloseTo(19.5);
    });
  });

  // ── Lucro Presumido ───────────────────────────────────────────────────────

  describe("lucro_presumido", () => {
    it("sums PIS + COFINS + IRPJ + CSLL (comércio defaults)", () => {
      expect(
        calculateEffectiveRate({
          regime: "lucro_presumido",
          lp_pis: 0.65,
          lp_cofins: 3.0,
          lp_irpj: 1.2,
          lp_csll: 1.08,
        })
      ).toBeCloseTo(5.93);
    });

    it("sums PIS + COFINS + IRPJ + CSLL (serviços defaults)", () => {
      expect(
        calculateEffectiveRate({
          regime: "lucro_presumido",
          lp_pis: 0.65,
          lp_cofins: 3.0,
          lp_irpj: 4.8,
          lp_csll: 2.88,
        })
      ).toBeCloseTo(11.33);
    });

    it("treats null components as 0", () => {
      expect(
        calculateEffectiveRate({
          regime: "lucro_presumido",
          lp_pis: 0.65,
          lp_cofins: 3.0,
          lp_irpj: null,
          lp_csll: null,
        })
      ).toBeCloseTo(3.65);
    });

    it("returns 0 when all components are null (not configured)", () => {
      expect(calculateEffectiveRate({ regime: "lucro_presumido" })).toBe(0);
    });
  });

  // ── Lucro Real ────────────────────────────────────────────────────────────

  describe("lucro_real", () => {
    it("computes debits minus credits (standard case)", () => {
      expect(
        calculateEffectiveRate({
          regime: "lucro_real",
          lr_pis_debito: 1.65,
          lr_cofins_debito: 7.6,
          lr_icms_debito: 0,
          lr_pis_credito: 0.5,
          lr_cofins_credito: 1.0,
          lr_icms_credito: 0,
        })
      ).toBeCloseTo(7.75);
    });

    it("returns negative when credits exceed debits (credit > debit edge case)", () => {
      expect(
        calculateEffectiveRate({
          regime: "lucro_real",
          lr_pis_debito: 1.0,
          lr_cofins_debito: 2.0,
          lr_pis_credito: 2.0,
          lr_cofins_credito: 3.0,
        })
      ).toBeCloseTo(-2.0);
    });

    it("returns 0 when debits equal credits exactly", () => {
      expect(
        calculateEffectiveRate({
          regime: "lucro_real",
          lr_pis_debito: 1.0,
          lr_cofins_debito: 1.0,
          lr_pis_credito: 1.0,
          lr_cofins_credito: 1.0,
        })
      ).toBe(0);
    });

    it("treats null ICMS as 0", () => {
      expect(
        calculateEffectiveRate({
          regime: "lucro_real",
          lr_pis_debito: 1.65,
          lr_cofins_debito: 7.6,
          lr_pis_credito: 0,
          lr_cofins_credito: 0,
          lr_icms_debito: null,
          lr_icms_credito: null,
        })
      ).toBeCloseTo(9.25);
    });

    it("returns 0 when all fields are null (not configured)", () => {
      expect(calculateEffectiveRate({ regime: "lucro_real" })).toBe(0);
    });

    it("handles ICMS debit with no credit", () => {
      expect(
        calculateEffectiveRate({
          regime: "lucro_real",
          lr_pis_debito: 1.65,
          lr_cofins_debito: 7.6,
          lr_icms_debito: 3.0,
          lr_pis_credito: 0,
          lr_cofins_credito: 0,
          lr_icms_credito: 0,
        })
      ).toBeCloseTo(12.25);
    });
  });
});

// ─── clampEffectiveRate ───────────────────────────────────────────────────────

describe("clampEffectiveRate", () => {
  it("returns positive rate unchanged", () => {
    expect(clampEffectiveRate(7.5)).toBe(7.5);
  });

  it("clamps negative rate to 0 (lucro_real credits > debits)", () => {
    expect(clampEffectiveRate(-2.0)).toBe(0);
  });

  it("returns 0 for zero input", () => {
    expect(clampEffectiveRate(0)).toBe(0);
  });

  it("clamps very negative rate to 0", () => {
    expect(clampEffectiveRate(-99.9)).toBe(0);
  });
});

// ─── computeTaxAmount ─────────────────────────────────────────────────────────

describe("computeTaxAmount", () => {
  it("computes price × rate / 100", () => {
    expect(computeTaxAmount(100, 15)).toBeCloseTo(15);
  });

  it("handles fractional rates", () => {
    expect(computeTaxAmount(100, 6.5)).toBeCloseTo(6.5);
  });

  it("returns 0 for zero rate", () => {
    expect(computeTaxAmount(100, 0)).toBe(0);
  });

  it("returns 0 for zero price (kits/bundles)", () => {
    expect(computeTaxAmount(0, 15)).toBe(0);
  });

  it("scales correctly for non-round prices", () => {
    expect(computeTaxAmount(59.9, 5.93)).toBeCloseTo(3.552);
  });
});
