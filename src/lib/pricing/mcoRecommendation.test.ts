import { computeMcoRecommendation } from "./mcoRecommendation";
import type { WaterfallCard } from "@/lib/precoMcoSeries";

/**
 * Card base para os testes — item saudável com margem antes de ads de 24%
 * (precoUnit=100, cmvUnit=50, comissaoUnit=12 (12%), impostoUnit=6 (6%),
 * freteUnit=8, adsUnit=4 → mcUnit=24, mcBeforeAdsPct=24).
 */
function card(overrides: Partial<WaterfallCard> = {}): WaterfallCard {
  return {
    precoUnit: 100,
    cmvUnit: 50,
    comissaoUnit: 12,
    freteUnit: 8,
    adsUnit: 4,
    impostoUnit: 6,
    mcUnit: 24,
    mcoUnit: 20,
    mcoPct: 20,
    mcBeforeAdsPct: 24,
    custoAusente: false,
    impostoAusente: false,
    ...overrides,
  };
}

describe("computeMcoRecommendation", () => {
  it("item saudável, target 25%: precoMinimo finito, maior que precoUnit, e diferente da soma naive de break-even (Pitfall 1)", () => {
    const rec = computeMcoRecommendation(card(), 25);

    expect(rec.precoMinimo).not.toBeNull();
    expect(Number.isFinite(rec.precoMinimo as number)).toBe(true);
    expect(rec.precoMinimo as number).toBeGreaterThan(card().precoUnit);

    // Guarda anti-Pitfall-1: precoMinimo NÃO pode ser a soma naive de
    // break-even (cmv+comissao+frete+imposto+ads), que ignora a álgebra
    // proporcional de reversePrice.
    const naiveBreakeven =
      card().cmvUnit + card().comissaoUnit + card().freteUnit + card().impostoUnit + card().adsUnit;
    expect(rec.precoMinimo).not.toBeCloseTo(naiveBreakeven, 5);

    expect(rec.metaImpraticavel).toBe(false);
  });

  it("target inatingível (comissão+imposto+target ≥ 100%): precoMinimo null + metaImpraticavel true", () => {
    const rec = computeMcoRecommendation(card(), 90);

    expect(rec.precoMinimo).toBeNull();
    expect(rec.metaImpraticavel).toBe(true);
  });

  it("acosMeta positivo quando mcBeforeAdsPct > target", () => {
    const rec = computeMcoRecommendation(card(), 9);

    expect(rec.acosMeta).not.toBeNull();
    expect(rec.acosMeta as number).toBeCloseTo(24 - 9, 5);
    expect(rec.acosMeta as number).toBeGreaterThan(0);
    expect(rec.acosInatingivel).toBe(false);
  });

  it("acosMeta <= 0 quando target ≥ mcBeforeAdsPct: acosInatingivel true", () => {
    const rec = computeMcoRecommendation(card(), 30);

    expect(rec.acosInatingivel).toBe(true);
    expect(rec.acosMeta as number).toBeLessThanOrEqual(0);
  });

  it("precoUnit=0: ambas as alavancas degradam para null, sem lançar exceção", () => {
    expect(() => {
      const rec = computeMcoRecommendation(
        card({ precoUnit: 0, cmvUnit: 0, comissaoUnit: 0, freteUnit: 0, adsUnit: 0, impostoUnit: 0, mcUnit: 0, mcoUnit: 0, mcoPct: null, mcBeforeAdsPct: null }),
        9,
      );
      expect(rec.precoMinimo).toBeNull();
      expect(rec.acosMeta).toBeNull();
    }).not.toThrow();
  });
});
