import { describe, it, expect } from "vitest";
import {
  niceStep, computePrecoFaixas, classificarSaude, computeVeredicto, MCO_SAUDAVEL_PCT,
  computeGiroFaixa, computeCoberturaFaixa, MIN_DIAS_CONFIANCA, COBERTURA_RISCO_DIAS,
} from "./precoFaixas";
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

describe("computeGiroFaixa", () => {
  it("retorna unidades/diasNaFaixa quando há dias-com-venda", () => {
    expect(computeGiroFaixa(200, 2)).toBe(100);
    expect(computeGiroFaixa(30, 2)).toBe(15);
  });
  it("retorna null quando diasNaFaixa é 0 (faixa sem dados de dia)", () => {
    expect(computeGiroFaixa(0, 0)).toBeNull();
  });
});

describe("computeCoberturaFaixa", () => {
  it("estoqueAtual null → cobertura null (sem dado de estoque)", () => {
    expect(computeCoberturaFaixa(null, 15)).toBeNull();
  });
  it("estoqueAtual <= 0 → cobertura 0, mesmo com giro válido", () => {
    expect(computeCoberturaFaixa(0, 15)).toBe(0);
    expect(computeCoberturaFaixa(-5, 15)).toBe(0);
  });
  it("giro null ou <= 0 → cobertura null", () => {
    expect(computeCoberturaFaixa(30, null)).toBeNull();
    expect(computeCoberturaFaixa(30, 0)).toBeNull();
    expect(computeCoberturaFaixa(30, -1)).toBeNull();
  });
  it("estoque menor que o giro → floor 0 ('<1d' na UI), distinto do null de 'sem giro'", () => {
    expect(computeCoberturaFaixa(5, 15)).toBe(0);
  });
  it("caso do Wesley: giro 15/dia, estoque 30 → cobertura 2 dias", () => {
    expect(computeCoberturaFaixa(30, 15)).toBe(2);
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
    expect(r.estoqueAtual).toBeNull();
  });
});

describe("computePrecoFaixas — giro, cobertura e baixa confiança", () => {
  it("conta dias-com-venda por faixa (inclusive datas não contíguas) e calcula giroDia", () => {
    const daily = [
      pt("2026-06-01", 56, 100, 800), // faixa 55–60
      pt("2026-06-20", 58, 100, 900), // mesma faixa, data não contígua (salto de 19 dias)
      pt("2026-06-03", 62, 50, 700),  // faixa 60–65 (garante largura de bucket 5, como no teste base)
    ];
    const r = computePrecoFaixas(daily, { mode: "unidades" });
    const f = r.faixas.find((x) => x.min === 55)!;
    expect(f.diasNaFaixa).toBe(2);
    expect(f.giroDia).toBe(100); // 200 unidades / 2 dias
  });

  it("injeta estoqueAtual em opts e calcula coberturaDias da faixa do preço vigente", () => {
    const daily = [
      pt("2026-06-01", 56, 15, 300),
      pt("2026-06-02", 56, 15, 300), // faixa 55–60, 30 unidades / 2 dias = giro 15
    ];
    const r = computePrecoFaixas(daily, { mode: "unidades", estoqueAtual: 30 });
    expect(r.estoqueAtual).toBe(30);
    const atual = r.faixas.find((x) => x.isPrecoAtual)!;
    expect(atual.giroDia).toBe(15);
    expect(atual.coberturaDias).toBe(2); // caso do Wesley: giro 15, estoque 30 → 2 dias
  });

  it("estoqueAtual 0 → coberturaDias 0 mesmo com giro > 0", () => {
    const daily = [pt("2026-06-01", 56, 15, 300)];
    const r = computePrecoFaixas(daily, { mode: "unidades", estoqueAtual: 0 });
    const atual = r.faixas.find((x) => x.isPrecoAtual)!;
    expect(atual.coberturaDias).toBe(0);
  });

  it("estoqueAtual omitido/null → coberturaDias null", () => {
    const daily = [pt("2026-06-01", 56, 15, 300)];
    const r = computePrecoFaixas(daily, { mode: "unidades" });
    expect(r.estoqueAtual).toBeNull();
    const atual = r.faixas.find((x) => x.isPrecoAtual)!;
    expect(atual.coberturaDias).toBeNull();
  });

  it("estoque menor que o giro → coberturaDias 0 ('<1d' na UI)", () => {
    const daily = [pt("2026-06-01", 56, 15, 300)]; // giro 15
    const r = computePrecoFaixas(daily, { mode: "unidades", estoqueAtual: 5 });
    const atual = r.faixas.find((x) => x.isPrecoAtual)!;
    expect(atual.coberturaDias).toBe(0);
  });

  it("limiar de baixa confiança: < 3 dias = true, >= 3 dias = false", () => {
    const daily = [
      pt("2026-06-01", 56, 100, 800), // faixa 55–60: dia 1
      pt("2026-06-02", 58, 100, 900), // faixa 55–60: dia 2 → baixa confiança
      pt("2026-06-03", 62, 50, 700),  // faixa 60–65: dia 1
      pt("2026-06-04", 63, 50, 700),  // faixa 60–65: dia 2
      pt("2026-06-05", 64, 50, 700),  // faixa 60–65: dia 3 → confiança ok
    ];
    const r = computePrecoFaixas(daily, { mode: "unidades" });
    const f5560 = r.faixas.find((x) => x.min === 55)!;
    const f6065 = r.faixas.find((x) => x.min === 60)!;
    expect(f5560.diasNaFaixa).toBe(2);
    expect(f5560.baixaConfianca).toBe(true);
    expect(f6065.diasNaFaixa).toBe(3);
    expect(f6065.baixaConfianca).toBe(false);
    expect(MIN_DIAS_CONFIANCA).toBe(3);
  });

  it("faixa vazia (0 dias) não é marcada como baixa confiança", () => {
    const daily = [
      ...Array.from({ length: 10 }, (_, i) => pt(`2026-06-${10 + i}`, 56 + (i % 3), 100, 500)),
      pt("2026-06-25", 300, 1, 100), // outlier isolado — cria faixas regulares vazias no meio
    ];
    const r = computePrecoFaixas(daily, { mode: "unidades" });
    const vazias = r.faixas.filter((f) => f.diasNaFaixa === 0);
    for (const f of vazias) {
      expect(f.baixaConfianca).toBe(false);
      expect(f.giroDia).toBeNull();
      expect(f.coberturaDias).toBeNull();
    }
  });

  it("COBERTURA_RISCO_DIAS é a constante de risco de ruptura (7 dias)", () => {
    expect(COBERTURA_RISCO_DIAS).toBe(7);
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

describe("computeVeredicto — coberturaTexto", () => {
  const faixaAtual = {
    min: 55, max: 60, label: "R$55–60", unidades: 200, mcoRsTotal: 1700, receita: 11400,
    precoMedio: 57, mcoPctMedio: 0.15, isOutlierBucket: false, isPrecoAtual: true, altura: 200,
    diasNaFaixa: 3, giroDia: 15, coberturaDias: 2, baixaConfianca: false,
  };
  const base = {
    faixas: [faixaAtual], larguraBucket: 5, faixaOtima: faixaAtual,
    precoRecente: 57, margemRecentePct: 0.15, totalUnidades: 200, totalMcoRs: 1700,
  };

  it("com estoque e faixa atual, retorna frase determinística citando os dias de cobertura", () => {
    const r: any = { ...base, estoqueAtual: 30 };
    const v = computeVeredicto(r, "unidades");
    expect(v.coberturaTexto).not.toBeNull();
    expect(v.coberturaTexto).toContain("2");
    expect(v.coberturaTexto).toContain("30");
  });

  it("sem faixa do preço atual retorna coberturaTexto null", () => {
    const r: any = { ...base, faixas: [], faixaOtima: null, precoRecente: null, margemRecentePct: null, estoqueAtual: 30 };
    expect(computeVeredicto(r, "unidades").coberturaTexto).toBeNull();
  });

  it("estoqueAtual null retorna coberturaTexto null mesmo com faixa atual", () => {
    const r: any = { ...base, estoqueAtual: null };
    expect(computeVeredicto(r, "unidades").coberturaTexto).toBeNull();
  });

  it("estoqueAtual 0 → frase de estoque zerado", () => {
    const r: any = { ...base, estoqueAtual: 0 };
    const v = computeVeredicto(r, "unidades");
    expect(v.coberturaTexto).not.toBeNull();
    expect(v.coberturaTexto).toMatch(/zerado/i);
  });

  it("coberturaDias 0 com estoque > 0 → frase de menos de 1 dia", () => {
    const faixaSemFolego = { ...faixaAtual, coberturaDias: 0 };
    const r: any = { ...base, faixas: [faixaSemFolego], faixaOtima: faixaSemFolego, estoqueAtual: 5 };
    const v = computeVeredicto(r, "unidades");
    expect(v.coberturaTexto).toMatch(/menos de 1 dia/i);
  });

  it("coberturaDias null (giro indisponível) com estoque > 0 → coberturaTexto null", () => {
    const faixaSemGiro = { ...faixaAtual, giroDia: null, coberturaDias: null };
    const r: any = { ...base, faixas: [faixaSemGiro], faixaOtima: faixaSemGiro, estoqueAtual: 30 };
    expect(computeVeredicto(r, "unidades").coberturaTexto).toBeNull();
  });
});
