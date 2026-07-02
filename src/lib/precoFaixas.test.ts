import { describe, it, expect } from "vitest";
import { niceStep, computePrecoFaixas, classificarSaude, computeVeredicto, MCO_SAUDAVEL_PCT } from "./precoFaixas";
import type { McoSeriesPoint } from "./precoMcoSeries";

describe("niceStep", () => {
  it("snaps para passos redondos da série 1/2/5", () => {
    expect(niceStep(0.3)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(23)).toBe(50);
  });
  it("nunca retorna 0 ou negativo", () => {
    expect(niceStep(0)).toBeGreaterThan(0);
    expect(niceStep(-5)).toBeGreaterThan(0);
  });
});

// Helper: ponto diário mínimo com os campos que o util usa.
function pt(bucket: string, precoUnit: number, qtd: number, mco: number): McoSeriesPoint {
  const receita = precoUnit * qtd;
  return {
    bucket, qtd, precoUnit,
    breakevenUnit: 0, cmvUnit: 0, comissaoUnit: 0, freteUnit: 0, adsUnit: 0, impostoUnit: 0,
    ads: 0, mco, mcoPct: receita > 0 ? mco / receita : null,
    base: 0, gainBand: 0, lossBand: 0, custoAusente: false, impostoAusente: false,
  };
}

describe("computePrecoFaixas", () => {
  it("agrupa dias por faixa de preço somando unidades e MCO", () => {
    const daily = [
      pt("2026-06-01", 56, 100, 800),   // faixa 55–60
      pt("2026-06-02", 58, 100, 900),   // faixa 55–60
      pt("2026-06-03", 62, 50, 700),    // faixa 60–65
    ];
    const r = computePrecoFaixas(daily, { mode: "unidades" });
    const f5560 = r.faixas.find((f) => f.min === 55)!;
    expect(f5560.unidades).toBe(200);
    expect(f5560.mcoRsTotal).toBe(1700);
    expect(r.totalUnidades).toBe(250);
    expect(r.totalMcoRs).toBe(2400);
  });

  it("faixaOtima em modo unidades é a de mais unidades; em modo lucro é a de mais MCO R$", () => {
    const daily = [
      pt("2026-06-01", 55, 300, 300),  // muitas unidades, pouco lucro
      pt("2026-06-02", 62, 100, 900),  // poucas unidades, muito lucro
    ];
    expect(computePrecoFaixas(daily, { mode: "unidades" }).faixaOtima!.min).toBe(55);
    expect(computePrecoFaixas(daily, { mode: "lucro" }).faixaOtima!.min).toBe(60);
  });

  it("agrega outliers de preço alto num único bucket +R$X", () => {
    const daily = [
      ...Array.from({ length: 10 }, (_, i) => pt(`2026-06-${10 + i}`, 56 + (i % 3), 100, 500)),
      pt("2026-06-25", 300, 1, 100), // outlier isolado
    ];
    const r = computePrecoFaixas(daily, { mode: "unidades" });
    const outlier = r.faixas.find((f) => f.isOutlierBucket)!;
    expect(outlier).toBeTruthy();
    expect(outlier.label.startsWith("+R$")).toBe(true);
    expect(outlier.unidades).toBe(1);
    // não deve haver dezenas de faixas vazias entre 65 e 300
    expect(r.faixas.length).toBeLessThan(12);
  });

  it("marca a faixa do preço recente (ponto de data máxima) e sua margem", () => {
    const daily = [
      pt("2026-06-01", 56, 100, 800),
      pt("2026-06-05", 63, 100, 1200), // data máxima → preço recente 63
    ];
    const r = computePrecoFaixas(daily, { mode: "unidades" });
    expect(r.precoRecente).toBe(63);
    const atual = r.faixas.find((f) => f.isPrecoAtual)!;
    expect(atual.min).toBe(60);
    expect(r.margemRecentePct).toBeCloseTo(1200 / 6300, 5);
  });

  it("é defensivo: entrada vazia não quebra", () => {
    const r = computePrecoFaixas([], { mode: "unidades" });
    expect(r.faixas).toEqual([]);
    expect(r.faixaOtima).toBeNull();
    expect(r.precoRecente).toBeNull();
  });
});

describe("classificarSaude", () => {
  it("prejuízo < 0, apertada [0, threshold), saudável >= threshold", () => {
    expect(classificarSaude(-0.01)).toBe("prejuizo");
    expect(classificarSaude(0.02)).toBe("apertada");
    expect(classificarSaude(MCO_SAUDAVEL_PCT / 100)).toBe("saudavel");
    expect(classificarSaude(null)).toBe("sem-dados");
  });
});

describe("computeVeredicto", () => {
  const base = {
    faixas: [], larguraBucket: 5, precoRecente: 60, margemRecentePct: 0.17,
    totalUnidades: 250, totalMcoRs: 2400,
  };
  it("frase de saúde cita preço recente e margem", () => {
    const r: any = { ...base, faixaOtima: { label: "R$58–62", unidades: 200, mcoRsTotal: 1700, precoMedio: 59 } };
    const v = computeVeredicto(r, "unidades");
    expect(v.saude).toBe("saudavel");
    expect(v.saudeTexto).toContain("60");
    expect(v.saudeTexto).toContain("17");
  });
  it("modo unidades fala de volume; modo lucro fala de R$", () => {
    const r: any = { ...base, faixaOtima: { label: "R$58–62", unidades: 200, mcoRsTotal: 1700, precoMedio: 59 } };
    expect(computeVeredicto(r, "unidades").otimoTexto).toMatch(/unidade/i);
    expect(computeVeredicto(r, "lucro").otimoTexto).toMatch(/R\$/);
  });
  it("sem faixa ótima degrada com transparência", () => {
    const r: any = { ...base, faixaOtima: null, precoRecente: null, margemRecentePct: null };
    const v = computeVeredicto(r, "unidades");
    expect(v.saude).toBe("sem-dados");
    expect(v.otimoTexto.length).toBeGreaterThan(0);
  });
});
