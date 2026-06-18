import { computeMco } from "./mco";

describe("computeMco", () => {
  it("calcula MCO em R$ e % corretamente com componentes típicos", () => {
    // grossRevenue 10000, cmv 3000, platformCost 2000, ads 1000, tax 500
    // mco = 10000 - 3000 - 2000 - 1000 - 500 = 3500
    // pct = 3500 / 10000 * 100 = 35
    const result = computeMco({
      grossRevenue: 10000,
      cmv: 3000,
      platformCost: 2000,
      ads: 1000,
      tax: 500,
    });
    expect(result.mco).toBe(3500);
    expect(result.pct).toBeCloseTo(35, 5);
  });

  it("retorna MCO negativo quando custos superam a receita", () => {
    // grossRevenue 1000, cmv 800, platformCost 300, ads 100, tax 50
    // mco = 1000 - 800 - 300 - 100 - 50 = -250
    // pct = -250 / 1000 * 100 = -25
    const result = computeMco({
      grossRevenue: 1000,
      cmv: 800,
      platformCost: 300,
      ads: 100,
      tax: 50,
    });
    expect(result.mco).toBe(-250);
    expect(result.pct).toBeCloseTo(-25, 5);
  });

  it("retorna pct = null (sem NaN) quando grossRevenue = 0", () => {
    // Receita zero: pct deve ser null, mco é negativo (soma dos custos)
    const result = computeMco({
      grossRevenue: 0,
      cmv: 500,
      platformCost: 200,
      ads: 100,
      tax: 50,
    });
    expect(result.pct).toBeNull();
    expect(result.mco).toBe(-850);
    expect(Number.isNaN(result.mco)).toBe(false);
  });

  it("ads é contabilizado exatamente uma vez (diff entre ads=0 e ads=N é exatamente N)", () => {
    const base = {
      grossRevenue: 5000,
      cmv: 1000,
      platformCost: 800,
      tax: 200,
    };
    const resultSemAds = computeMco({ ...base, ads: 0 });
    const resultComAds = computeMco({ ...base, ads: 300 });

    // A diferença deve ser exatamente 300 — ads somado uma vez, nunca 2×
    expect(resultSemAds.mco - resultComAds.mco).toBeCloseTo(300, 10);
  });
});
