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
    daily: [
      { date: "2026-07-09", spend: 100.5 },
      { date: "2026-07-10", spend: 98.02 },
    ],
    total: 198.52,
  };

  it("Test 9 (D-219-01): cache com daily.length > 0 devolve os valores do CACHE e source === 'cache' — mesmo com fatura tendo rowCount > 0", () => {
    const result = resolveAdsSpend(fatura, cache);

    expect(result.source).toBe("cache");
    expect(result.total).toBe(198.52);
    expect(result.daily).toEqual(cache.daily);
    // coverageFrom/coverageTo vêm do MENOR/MAIOR date de cache.daily, não da fatura
    expect(result.coverageFrom).toBe("2026-07-09");
    expect(result.coverageTo).toBe("2026-07-10");
  });

  it("Test 10 (D-219-01): cache VAZIO e fatura com rowCount > 0 devolve os valores da FATURA e source === 'billing' — fallback simétrico", () => {
    const cacheVazio = { daily: [], total: 0 };

    const result = resolveAdsSpend(fatura, cacheVazio);

    expect(result.source).toBe("billing");
    expect(result.total).toBe(1987.47);
    expect(result.daily).toEqual(fatura.daily);
    expect(result.coverageFrom).toBe("2026-07-01");
    expect(result.coverageTo).toBe("2026-07-31");
  });

  it("Test 11 (D-219-01): cache vazio e fatura null/rowCount === 0 devolve o objeto neutro com source === 'cache'", () => {
    const cacheVazio = { daily: [], total: 0 };
    const faturaSemLinhas = {
      daily: [],
      total: 0,
      rowCount: 0,
      coverageFrom: null,
      coverageTo: null,
    };

    const semFatura = resolveAdsSpend(null, cacheVazio);
    expect(semFatura.source).toBe("cache");
    expect(semFatura.total).toBe(0);
    expect(semFatura.daily).toEqual([]);
    expect(semFatura.coverageFrom).toBeNull();
    expect(semFatura.coverageTo).toBeNull();

    const undefinedFatura = resolveAdsSpend(undefined, cacheVazio);
    expect(undefinedFatura.source).toBe("cache");
    expect(undefinedFatura.total).toBe(0);

    const rowCountZero = resolveAdsSpend(faturaSemLinhas, cacheVazio);
    expect(rowCountZero.source).toBe("cache");
    expect(rowCountZero.total).toBe(0);
  });

  it("Test 12 (ANTI-SOMA-DUPLA): cache com dado e fatura com dado NUNCA somam — resultado é exatamente o total do cache, nunca cache.total + billing.total", () => {
    const result = resolveAdsSpend(fatura, cache);

    expect(result.total).toBe(198.52);
    expect(result.total).not.toBe(fatura.total + cache.total);
    expect(result.total).not.toBe(1987.47);
    // A soma diária também não pode combinar as duas origens
    const somaDiaria = result.daily.reduce((acc, d) => acc + d.spend, 0);
    expect(Math.round(somaDiaria * 100) / 100).toBe(198.52);
  });

  it("Test novo: quando source === 'cache', coverageFrom/coverageTo vêm de cache.daily, nunca null quando há dado", () => {
    const cacheUmDia = { daily: [{ date: "2026-08-05", spend: 198.27 }], total: 198.27 };

    const result = resolveAdsSpend(null, cacheUmDia);

    expect(result.source).toBe("cache");
    expect(result.coverageFrom).toBe("2026-08-05");
    expect(result.coverageTo).toBe("2026-08-05");
  });
});

describe("efeito medido no MCO — cache ANTES do conserto da 219-01 (inflado) vs DEPOIS (bate com o painel)", () => {
  it("Test 13 (D-219-01, 219-PROVA.md): reapontar para o cache ANTES do conserto (277,01, inflado 1,397x) seria pior que a fatura; DEPOIS (198,27) bate com o painel — prova por que a ordem 'conserta primeiro, reaponta depois' importa", () => {
    // Números reais medidos em 219-PROVA.md (Pé Vermeio, 05/08/2026, conta 1639558873):
    // cache ANTES do conserto (duplicado): R$ 277,01 — 1,397x inflado
    // cache DEPOIS do conserto (metrics_summary + dedup): R$ 198,27 — bate ao centavo com o painel do ML
    const receita = 153197.08;
    const adsCacheAntes = 277.01;
    const adsCacheDepois = 198.27;
    // Demais componentes do período, fixos: receita − MCO(cache antes) − ads(cache antes)
    const demaisComponentes = receita - 20390.34 - adsCacheAntes;

    const comCacheAntes = computeMco({
      grossRevenue: receita,
      cmv: demaisComponentes,
      platformCost: 0,
      ads: adsCacheAntes,
      tax: 0,
    });
    const comCacheDepois = computeMco({
      grossRevenue: receita,
      cmv: demaisComponentes,
      platformCost: 0,
      ads: adsCacheDepois,
      tax: 0,
    });

    // Reapontar para o cache ANTES do conserto teria dado um MCO MENOR (mais
    // gasto de ads embutido) do que o real — pior do que ficar na fatura.
    expect(comCacheAntes.mco).toBeCloseTo(20390.34, 2);
    // Depois do conserto, o cache reflete o gasto real (menor), e o MCO sobe
    // na exata diferença entre os dois números do cache.
    expect(comCacheDepois.mco - comCacheAntes.mco).toBeCloseTo(
      adsCacheAntes - adsCacheDepois,
      2,
    );
    expect(comCacheDepois.mco).toBeGreaterThan(comCacheAntes.mco);
  });
});
