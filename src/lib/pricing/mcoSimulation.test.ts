import { computeSimulatedWaterfall } from "./mcoSimulation";

describe("computeSimulatedWaterfall", () => {
  it("caso normal: deriva comissaoUnit/impostoUnit de %, mcUnit exclui ads, mcoUnit inclui ads", () => {
    // precoUnit=100, cmvUnit=30, comissaoPct=12, freteUnit=5, impostoPct=8, adsUnit=4
    // comissaoUnit = 100 * 12 / 100 = 12
    // impostoUnit = 100 * 8 / 100 = 8
    // mcUnit = 100 - 30 - 12 - 5 - 8 = 45
    // mcoUnit = mcUnit - adsUnit = 45 - 4 = 41
    // mcoPct = 41 / 100 * 100 = 41
    const result = computeSimulatedWaterfall({
      precoUnit: 100,
      cmvUnit: 30,
      comissaoPct: 12,
      freteUnit: 5,
      impostoPct: 8,
      adsUnit: 4,
    });

    expect(result.comissaoUnit).toBeCloseTo(12, 5);
    expect(result.impostoUnit).toBeCloseTo(8, 5);
    expect(result.mcUnit).toBeCloseTo(45, 5);
    expect(result.mcoUnit).toBeCloseTo(41, 5);
    expect(result.mcoPct).toBeCloseTo(41, 5);
  });

  it("mcUnit exclui ads e mcoUnit inclui ads: mcUnit - adsUnit === mcoUnit", () => {
    const result = computeSimulatedWaterfall({
      precoUnit: 200,
      cmvUnit: 60,
      comissaoPct: 15,
      freteUnit: 10,
      impostoPct: 6,
      adsUnit: 20,
    });

    expect(result.mcUnit - result.adsUnit).toBeCloseTo(result.mcoUnit, 10);
  });

  it("precoUnit=0: mcoPct === null (nunca NaN), comissaoUnit e impostoUnit === 0 (guard de divisão)", () => {
    const result = computeSimulatedWaterfall({
      precoUnit: 0,
      cmvUnit: 10,
      comissaoPct: 12,
      freteUnit: 5,
      impostoPct: 8,
      adsUnit: 4,
    });

    expect(result.mcoPct).toBeNull();
    expect(result.comissaoUnit).toBe(0);
    expect(result.impostoUnit).toBe(0);
    expect(Number.isNaN(result.mcoUnit)).toBe(false);
    expect(Number.isNaN(result.mcUnit)).toBe(false);
  });

  it("fronteira %: comissaoPct=0 e impostoPct=0 → comissaoUnit=0, impostoUnit=0", () => {
    const result = computeSimulatedWaterfall({
      precoUnit: 100,
      cmvUnit: 30,
      comissaoPct: 0,
      freteUnit: 5,
      impostoPct: 0,
      adsUnit: 4,
    });

    expect(result.comissaoUnit).toBe(0);
    expect(result.impostoUnit).toBe(0);
  });

  it("fronteira %: comissaoPct=100 sobre precoUnit=100 → comissaoUnit=100", () => {
    const result = computeSimulatedWaterfall({
      precoUnit: 100,
      cmvUnit: 30,
      comissaoPct: 100,
      freteUnit: 5,
      impostoPct: 8,
      adsUnit: 4,
    });

    expect(result.comissaoUnit).toBeCloseTo(100, 5);
  });

  it("passthrough de negativo: cmvUnit negativo propaga aritmeticamente sem throw", () => {
    expect(() => {
      const result = computeSimulatedWaterfall({
        precoUnit: 100,
        cmvUnit: -20,
        comissaoPct: 12,
        freteUnit: 5,
        impostoPct: 8,
        adsUnit: 4,
      });

      // mcUnit = 100 - (-20) - 12 - 5 - 8 = 95
      expect(result.mcUnit).toBeCloseTo(95, 5);
    }).not.toThrow();
  });
});
