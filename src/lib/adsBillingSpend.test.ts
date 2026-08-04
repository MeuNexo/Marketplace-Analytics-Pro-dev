import {
  ADS_BILLING_CHARGE_TYPES,
  aggregateAdsBillingSpend,
  resolveAdsSpend,
  type AdsBillingChargeRow,
} from "./adsBillingSpend";
import { computeMco } from "./mco";

describe("ADS_BILLING_CHARGE_TYPES", () => {
  it("contém exatamente os dois códigos de cobrança de publicidade da fatura do ML", () => {
    expect([...ADS_BILLING_CHARGE_TYPES]).toEqual(["PADS", "BPAD"]);
  });
});

describe("aggregateAdsBillingSpend", () => {
  it("Test 1: duas linhas PADS no mesmo dia somam num único ponto de daily", () => {
    const rows: AdsBillingChargeRow[] = [
      { charge_date: "2026-07-10", charge_type: "PADS", amount: 100.5 },
      { charge_date: "2026-07-10", charge_type: "PADS", amount: 49.5 },
    ];

    const result = aggregateAdsBillingSpend(rows);

    expect(result.daily).toHaveLength(1);
    expect(result.daily[0]).toEqual({ date: "2026-07-10", spend: 150 });
    expect(result.total).toBe(150);
    expect(result.rowCount).toBe(2);
  });

  it("Test 2: BPAD com amount negativo ABATE o total — PADS 2000,00 + BPAD −12,53 ⇒ 1987.47", () => {
    const rows: AdsBillingChargeRow[] = [
      { charge_date: "2026-07-01", charge_type: "PADS", amount: 2000.0 },
      { charge_date: "2026-07-02", charge_type: "BPAD", amount: -12.53 },
    ];

    const result = aggregateAdsBillingSpend(rows);

    // Estorno entra com o próprio sinal — nenhuma inversão em lugar nenhum (D-01)
    expect(result.total).toBe(1987.47);
    expect(result.daily).toEqual([
      { date: "2026-07-01", spend: 2000 },
      { date: "2026-07-02", spend: -12.53 },
    ]);
  });

  it("Test 3: linhas de charge_type que não são publicidade (CVVML, CFFE, CFONPN) são ignoradas", () => {
    const rows: AdsBillingChargeRow[] = [
      { charge_date: "2026-07-05", charge_type: "PADS", amount: 80 },
      { charge_date: "2026-07-05", charge_type: "CVVML", amount: 5000 },
      { charge_date: "2026-07-06", charge_type: "CFFE", amount: 1234.56 },
      { charge_date: "2026-07-07", charge_type: "CFONPN", amount: 99.99 },
    ];

    const result = aggregateAdsBillingSpend(rows);

    expect(result.total).toBe(80);
    expect(result.rowCount).toBe(1);
    expect(result.daily).toEqual([{ date: "2026-07-05", spend: 80 }]);
    expect(result.daily.map((d) => d.date)).not.toContain("2026-07-06");
    expect(result.daily.map((d) => d.date)).not.toContain("2026-07-07");
  });

  it("Test 4: amount em string (numeric do Postgres) é convertido; valor não numérico conta como 0", () => {
    const rows: AdsBillingChargeRow[] = [
      { charge_date: "2026-07-11", charge_type: "PADS", amount: "150.25" },
      { charge_date: "2026-07-12", charge_type: "PADS", amount: "nao-numerico" },
      { charge_date: "2026-07-13", charge_type: "BPAD", amount: "-0.25" },
    ];

    const result = aggregateAdsBillingSpend(rows);

    expect(result.daily).toEqual([
      { date: "2026-07-11", spend: 150.25 },
      { date: "2026-07-12", spend: 0 },
      { date: "2026-07-13", spend: -0.25 },
    ]);
    expect(result.total).toBe(150);
    expect(Number.isNaN(result.total)).toBe(false);
  });

  it("Test 5: daily sai ordenado por data ascendente", () => {
    const rows: AdsBillingChargeRow[] = [
      { charge_date: "2026-07-31", charge_type: "PADS", amount: 3 },
      { charge_date: "2026-07-01", charge_type: "PADS", amount: 1 },
      { charge_date: "2026-07-15", charge_type: "PADS", amount: 2 },
    ];

    const result = aggregateAdsBillingSpend(rows);

    expect(result.daily.map((d) => d.date)).toEqual([
      "2026-07-01",
      "2026-07-15",
      "2026-07-31",
    ]);
  });

  it("Test 6: total é exatamente a soma dos spend de daily (sem deriva de arredondamento)", () => {
    const rows: AdsBillingChargeRow[] = [
      { charge_date: "2026-07-01", charge_type: "PADS", amount: 0.1 },
      { charge_date: "2026-07-02", charge_type: "PADS", amount: 0.2 },
      { charge_date: "2026-07-03", charge_type: "PADS", amount: 0.3 },
      { charge_date: "2026-07-04", charge_type: "PADS", amount: 0.7 },
    ];

    const result = aggregateAdsBillingSpend(rows);
    const somaDoGrafico =
      Math.round(result.daily.reduce((acc, d) => acc + d.spend, 0) * 100) / 100;

    // O KPI e o gráfico não podem divergir por centavo
    expect(result.total).toBe(somaDoGrafico);
    expect(result.total).toBe(1.3);
  });

  it("Test 7: entrada vazia devolve o objeto neutro", () => {
    expect(aggregateAdsBillingSpend([])).toEqual({
      daily: [],
      total: 0,
      rowCount: 0,
      coverageFrom: null,
      coverageTo: null,
    });
  });

  it("Test 8: coverageFrom/coverageTo são a menor e a maior data CONSIDERADA", () => {
    const rows: AdsBillingChargeRow[] = [
      // linha fora de publicidade em data extrema não pode alargar a cobertura
      { charge_date: "2026-01-01", charge_type: "CVVML", amount: 10 },
      { charge_date: "2026-07-20", charge_type: "PADS", amount: 10 },
      { charge_date: "2026-07-05", charge_type: "BPAD", amount: -1 },
      { charge_date: "2026-12-31", charge_type: "CFFE", amount: 10 },
      // linha sem data é descartada
      { charge_date: "", charge_type: "PADS", amount: 999 },
    ];

    const result = aggregateAdsBillingSpend(rows);

    expect(result.coverageFrom).toBe("2026-07-05");
    expect(result.coverageTo).toBe("2026-07-20");
    expect(result.rowCount).toBe(2);
    expect(result.total).toBe(9);
  });
});

describe("resolveAdsSpend", () => {
  const fatura = {
    daily: [{ date: "2026-07-10", spend: 1987.47 }],
    total: 1987.47,
    rowCount: 12,
    coverageFrom: "2026-07-01",
    coverageTo: "2026-07-31",
  };
  const cache = {
    daily: [{ date: "2026-07-10", spend: 189.1 }],
    total: 189.1,
  };

  it("Test 9: com rowCount > 0 devolve os valores da fatura e source === 'billing'", () => {
    const result = resolveAdsSpend(fatura, cache);

    expect(result.source).toBe("billing");
    expect(result.total).toBe(1987.47);
    expect(result.daily).toEqual(fatura.daily);
    expect(result.coverageFrom).toBe("2026-07-01");
    expect(result.coverageTo).toBe("2026-07-31");
  });

  it("Test 10: com rowCount === 0 devolve o cache e source === 'cache' — ads NÃO fica zerado", () => {
    const semLinhas = {
      daily: [],
      total: 0,
      rowCount: 0,
      coverageFrom: null,
      coverageTo: null,
    };

    const result = resolveAdsSpend(semLinhas, cache);

    expect(result.source).toBe("cache");
    expect(result.total).toBe(189.1);
    expect(result.total).not.toBe(0);
    expect(result.daily).toEqual(cache.daily);
    expect(result.coverageFrom).toBeNull();
    expect(result.coverageTo).toBeNull();
  });

  it("Test 11: argumento de fatura null (ou undefined) devolve o cache e source === 'cache'", () => {
    expect(resolveAdsSpend(null, cache).source).toBe("cache");
    expect(resolveAdsSpend(null, cache).total).toBe(189.1);
    expect(resolveAdsSpend(undefined, cache).source).toBe("cache");
    expect(resolveAdsSpend(undefined, cache).total).toBe(189.1);
  });

  it("Test 12: ANTI-SOMA-DUPLA — fatura 1987,47 + cache 189,10 resolve em 1987,47, nunca 2176,57", () => {
    const result = resolveAdsSpend(fatura, cache);

    expect(result.total).toBe(1987.47);
    expect(result.total).not.toBe(2176.57);
    expect(result.total).not.toBe(189.1);
    // A soma diária também não pode combinar as duas origens
    const somaDiaria = result.daily.reduce((acc, d) => acc + d.spend, 0);
    expect(Math.round(somaDiaria * 100) / 100).toBe(1987.47);
  });
});

describe("efeito medido no MCO (org Wesley, 2026-08-04)", () => {
  it("Test 13: trocar ads de 189,10 (cache) por 1.987,47 (fatura) derruba o MCO de 13,31% para 12,14%", () => {
    const receita = 153197.08;
    const adsCache = 189.1;
    const adsBilling = 1987.47;
    // Demais componentes do período, fixos: receita − MCO(cache) − ads(cache)
    const demaisComponentes = receita - 20390.34 - adsCache;

    const comCache = computeMco({
      grossRevenue: receita,
      cmv: demaisComponentes,
      platformCost: 0,
      ads: adsCache,
      tax: 0,
    });
    const comBilling = computeMco({
      grossRevenue: receita,
      cmv: demaisComponentes,
      platformCost: 0,
      ads: adsBilling,
      tax: 0,
    });

    expect(comCache.mco).toBeCloseTo(20390.34, 2);
    expect(comBilling.mco).toBeCloseTo(18591.97, 2);
    expect((comCache.pct as number).toFixed(2)).toBe("13.31");
    expect((comBilling.pct as number).toFixed(2)).toBe("12.14");
    // Diferença medida: R$ 1.798,37 e 1,17 p.p.
    expect(comCache.mco - comBilling.mco).toBeCloseTo(adsBilling - adsCache, 2);
  });
});
