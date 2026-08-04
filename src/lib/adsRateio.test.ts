// ============================================================================
// adsRateio.test.ts — Fase 211, Plano 03, Task 1
//
// Prova do fechamento ao centavo (ADS-06), do dia sem chave de rateio e do
// custo de ads por venda do anúncio (ADS-07 / D-04).
// ============================================================================

import { describe, it, expect } from "vitest";
import { distribuirCentavos, ratearAdsDaCarteira, ratearAdsDoAnuncio } from "./adsRateio";
import type { AdsBillingSpend, AdsSpendDailyRow } from "./adsBillingSpend";
import { computeWaterfallCard, type PrecoSeriesRow } from "./precoMcoSeries";

/** Fatura sintética no formato que `aggregateAdsBillingSpend` já devolve. */
function fatura(daily: AdsSpendDailyRow[]): AdsBillingSpend {
  const total = Math.round(daily.reduce((s, d) => s + d.spend, 0) * 100) / 100;
  return {
    daily,
    total,
    rowCount: daily.length,
    coverageFrom: daily[0]?.date ?? null,
    coverageTo: daily[daily.length - 1]?.date ?? null,
  };
}

const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);
const somaSpend = (v: AdsSpendDailyRow[]) =>
  Math.round(v.reduce((a, b) => a + b.spend, 0) * 100) / 100;

// ─── distribuirCentavos ──────────────────────────────────────────────────────

describe("distribuirCentavos", () => {
  it("Test 1: 100 centavos em três pesos iguais devolve inteiros que somam EXATAMENTE 100", () => {
    const fatias = distribuirCentavos(100, [1, 1, 1]);

    expect(fatias).toHaveLength(3);
    expect(fatias.every((f) => Number.isInteger(f))).toBe(true);
    expect(soma(fatias)).toBe(100);
    // Método do maior resto: o centavo que sobra vai para o menor índice no empate
    expect(fatias).toEqual([34, 33, 33]);
  });

  it("Test 2: todos os pesos zero devolve zeros — o chamador trata como dia sem chave de rateio", () => {
    expect(distribuirCentavos(29424, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(distribuirCentavos(29424, [])).toEqual([]);
  });

  it("Test 3: total negativo (estorno maior que a cobrança) soma exatamente o total negativo", () => {
    const fatias = distribuirCentavos(-100, [1, 1, 1]);

    expect(soma(fatias)).toBe(-100);
    expect(fatias).toEqual([-34, -33, -33]);
  });

  it("Test 4: pesos assimétricos — a fatia de cada um é a proporção, e a soma continua exata", () => {
    // 945606 centavos (R$ 9.456,06) distribuídos em 12% / 30% / 58%
    const fatias = distribuirCentavos(945606, [12, 30, 58]);

    expect(soma(fatias)).toBe(945606);
    expect(fatias[0]).toBe(113473); // R$ 1.134,73 — ~12% da fatura
  });

  it("Test 5: PROPRIEDADE — para dezenas de combinações determinísticas, a soma é sempre exatamente o total", () => {
    const totais = [0, 1, 7, 100, 101, 999, 29424, 945606, -1, -333, -945606];
    const conjuntosDePesos: number[][] = [
      [1],
      [1, 1],
      [1, 2],
      [1, 1, 1],
      [1, 2, 3],
      [7, 11, 13, 17],
      [1, 0, 0, 5],
      [0.5, 0.25, 0.25],
      [1195.88, 143.51, 12.03, 0.01],
      Array.from({ length: 37 }, (_, i) => i + 1),
    ];

    for (const total of totais) {
      for (const pesos of conjuntosDePesos) {
        const fatias = distribuirCentavos(total, pesos);
        expect(fatias).toHaveLength(pesos.length);
        // É ISTO que faz "fecha ao centavo" ser verdade, e não aproximadamente verdade
        expect(soma(fatias)).toBe(total);
      }
    }
  });

  it("Test 6: ADS-06 — distribuir a fatura de um dia entre 37 anúncios devolve a fatura inteira, sem sobrar nem faltar centavo", () => {
    const totalDaFaturaEmCentavos = 29424; // 30/07 medido: R$ 294,24
    const pesos = Array.from({ length: 37 }, (_, i) => (i * 7919) % 331); // determinístico

    const fatias = distribuirCentavos(totalDaFaturaEmCentavos, pesos);

    expect(soma(fatias)).toBe(totalDaFaturaEmCentavos);
  });
});

// ─── ratearAdsDoAnuncio ──────────────────────────────────────────────────────

describe("ratearAdsDoAnuncio", () => {
  it("Test 7: fatura de 2 dias e cache de 2 anúncios — o anúncio recebe a fração do total da fatura proporcional ao gasto dele no cache", () => {
    const resultado = ratearAdsDoAnuncio({
      fatura: fatura([
        { date: "2026-07-01", spend: 100 },
        { date: "2026-07-02", spend: 50 },
      ]),
      itemDaily: [
        { date: "2026-07-01", spend: 3 },
        { date: "2026-07-02", spend: 1 },
      ],
      totalCacheDaily: [
        { date: "2026-07-01", spend: 4 },
        { date: "2026-07-02", spend: 4 },
      ],
    });

    // 3/4 de 100,00 e 1/4 de 50,00
    expect(resultado.daily).toEqual([
      { date: "2026-07-01", spend: 75 },
      { date: "2026-07-02", spend: 12.5 },
    ]);
    expect(resultado.total).toBe(87.5);
    expect(resultado.totalFatura).toBe(150);
    expect(resultado.source).toBe("billing-rateio");
    expect(resultado.naoRateado).toBe(0);
    expect(resultado.diasSemChave).toEqual([]);
  });

  it("Test 8: FECHAMENTO — ratear todos os anúncios e somar devolve o total da fatura, com o não rateado incluído", () => {
    const faturaDoPeriodo = fatura([
      { date: "2026-07-01", spend: 100 },
      { date: "2026-07-02", spend: 50 },
      { date: "2026-07-03", spend: 30 }, // dia sem nenhum gasto no cache
    ]);
    const totalCacheDaily: AdsSpendDailyRow[] = [
      { date: "2026-07-01", spend: 4 },
      { date: "2026-07-02", spend: 4 },
    ];

    const anuncioA = ratearAdsDoAnuncio({
      fatura: faturaDoPeriodo,
      itemDaily: [
        { date: "2026-07-01", spend: 3 },
        { date: "2026-07-02", spend: 1 },
      ],
      totalCacheDaily,
    });
    const anuncioB = ratearAdsDoAnuncio({
      fatura: faturaDoPeriodo,
      itemDaily: [
        { date: "2026-07-01", spend: 1 },
        { date: "2026-07-02", spend: 3 },
      ],
      totalCacheDaily,
    });

    expect(anuncioA.total).toBe(87.5);
    expect(anuncioB.total).toBe(62.5);
    // Somar o rateado de todos + o não rateado devolve EXATAMENTE o total da fatura
    expect(anuncioA.total + anuncioB.total + anuncioA.naoRateado).toBe(180);
    expect(anuncioA.totalFatura).toBe(180);
    expect(anuncioA.naoRateado).toBe(anuncioB.naoRateado);
  });

  it("Test 9: dia em que o cache soma zero não faz a fatura daquele dia desaparecer — vai para naoRateado e diasSemChave", () => {
    const resultado = ratearAdsDoAnuncio({
      fatura: fatura([
        { date: "2026-07-01", spend: 100 },
        { date: "2026-07-02", spend: 30 }, // cache zerado
        { date: "2026-07-03", spend: 20 }, // cache ausente
      ]),
      itemDaily: [{ date: "2026-07-01", spend: 4 }],
      totalCacheDaily: [
        { date: "2026-07-01", spend: 4 },
        { date: "2026-07-02", spend: 0 },
      ],
    });

    expect(resultado.diasSemChave).toEqual(["2026-07-02", "2026-07-03"]);
    expect(resultado.naoRateado).toBe(50);
    expect(resultado.total).toBe(100);
    expect(resultado.total + resultado.naoRateado).toBe(resultado.totalFatura);
    // Nada some em silêncio
    expect(resultado.totalFatura).toBe(150);
  });

  it("Test 10: fatura null devolve source de cache com a série do cache do anúncio — nunca zeros", () => {
    const resultado = ratearAdsDoAnuncio({
      fatura: null,
      itemDaily: [
        { date: "2026-07-01", spend: 12.5 },
        { date: "2026-07-02", spend: 7.5 },
      ],
      totalCacheDaily: [{ date: "2026-07-01", spend: 100 }],
    });

    expect(resultado.source).toBe("cache");
    expect(resultado.total).toBe(20);
    expect(resultado.total).not.toBe(0);
    expect(resultado.daily).toEqual([
      { date: "2026-07-01", spend: 12.5 },
      { date: "2026-07-02", spend: 7.5 },
    ]);
    expect(resultado.totalFatura).toBe(0);
    expect(resultado.naoRateado).toBe(0);
    expect(resultado.diasSemChave).toEqual([]);
  });

  it("Test 11: fatura com rowCount zero cai no mesmo ramo de cache — zerar publicidade inflaria o MCO em silêncio", () => {
    const resultado = ratearAdsDoAnuncio({
      fatura: { daily: [], total: 0, rowCount: 0, coverageFrom: null, coverageTo: null },
      itemDaily: [{ date: "2026-08-04", spend: 79.26 }],
      totalCacheDaily: [{ date: "2026-08-04", spend: 79.26 }],
    });

    expect(resultado.source).toBe("cache");
    expect(resultado.total).toBe(79.26);
  });

  it("Test 12: caso medido de julho (Pé Vermeio) — o total rateado do período é o da FATURA (9.456,06), não o do cache (1.195,88)", () => {
    const resultado = ratearAdsDoAnuncio({
      fatura: fatura([
        { date: "2026-07-01", spend: 5000 },
        { date: "2026-07-02", spend: 4456.06 },
      ]),
      // Anúncio único da loja: o cache dele É o cache total
      itemDaily: [
        { date: "2026-07-01", spend: 600 },
        { date: "2026-07-02", spend: 595.88 },
      ],
      totalCacheDaily: [
        { date: "2026-07-01", spend: 600 },
        { date: "2026-07-02", spend: 595.88 },
      ],
    });

    expect(resultado.total).toBe(9456.06);
    expect(resultado.total).not.toBe(1195.88);
    expect(resultado.source).toBe("billing-rateio");
    expect(somaSpend(resultado.daily)).toBe(9456.06);
  });

  it("Test 13: daily sai ordenado por data e sem os dias de fatia zero", () => {
    const resultado = ratearAdsDoAnuncio({
      fatura: fatura([
        { date: "2026-07-03", spend: 30 },
        { date: "2026-07-01", spend: 100 },
        { date: "2026-07-02", spend: 50 },
      ]),
      // O anúncio só teve gasto no dia 01 e no dia 03
      itemDaily: [
        { date: "2026-07-01", spend: 4 },
        { date: "2026-07-03", spend: 2 },
      ],
      totalCacheDaily: [
        { date: "2026-07-01", spend: 4 },
        { date: "2026-07-02", spend: 4 },
        { date: "2026-07-03", spend: 4 },
      ],
    });

    expect(resultado.daily.map((d) => d.date)).toEqual(["2026-07-01", "2026-07-03"]);
    expect(resultado.daily.map((d) => d.spend)).toEqual([100, 15]);
    expect(resultado.total).toBe(115);
  });

  it("Test 14: estorno integral do dia (fatura negativa) é rateado com o sinal preservado", () => {
    const resultado = ratearAdsDoAnuncio({
      fatura: fatura([{ date: "2026-07-10", spend: -12.53 }]),
      itemDaily: [{ date: "2026-07-10", spend: 1 }],
      totalCacheDaily: [{ date: "2026-07-10", spend: 2 }],
    });

    expect(resultado.daily).toEqual([{ date: "2026-07-10", spend: -6.27 }]);
    expect(resultado.total).toBe(-6.27);
  });
});

// ─── Composição com o waterfall (ADS-07 / D-04) ──────────────────────────────

describe("custo de ads POR VENDA do anúncio (ADS-07 / D-04)", () => {
  it("Test 15: o adsUnit do waterfall é o ads rateado do anúncio dividido pelas unidades vendidas do anúncio no período", () => {
    // Fatura do dia: R$ 900,00. O anúncio responde por 12% do cache daquele dia.
    const rateio = ratearAdsDoAnuncio({
      fatura: fatura([{ date: "2026-07-01", spend: 900 }]),
      itemDaily: [{ date: "2026-07-01", spend: 12 }],
      totalCacheDaily: [{ date: "2026-07-01", spend: 100 }],
    });

    expect(rateio.total).toBe(108); // 12% de 900,00

    const rows: PrecoSeriesRow[] = [
      {
        bucket: "2026-07-01",
        qtd: 12,
        total: 3600,
        cmv: 1200,
        comissao: 400,
        frete: 200,
        qtd_sem_custo: 0,
        impostos: 300,
        qtd_sem_imposto: 0,
      },
    ];

    const card = computeWaterfallCard(rows, {
      adsDaily: rateio.daily,
      incluirAds: true,
      granularity: "day",
    });

    // ADS-07: ads rateado do MLB no período ÷ unidades vendidas do MLB no período
    expect(card.adsUnit).toBeCloseTo(rateio.total / 12, 10);
    expect(card.adsUnit).toBe(9);
  });

  it("Test 16: com o toggle de publicidade desligado o ads por venda é zero — a régua nova não muda esse contrato", () => {
    const rateio = ratearAdsDoAnuncio({
      fatura: fatura([{ date: "2026-07-01", spend: 900 }]),
      itemDaily: [{ date: "2026-07-01", spend: 12 }],
      totalCacheDaily: [{ date: "2026-07-01", spend: 100 }],
    });

    const rows: PrecoSeriesRow[] = [
      {
        bucket: "2026-07-01",
        qtd: 12,
        total: 3600,
        cmv: 1200,
        comissao: 400,
        frete: 200,
        qtd_sem_custo: 0,
        impostos: 300,
        qtd_sem_imposto: 0,
      },
    ];

    const card = computeWaterfallCard(rows, {
      adsDaily: rateio.daily,
      incluirAds: false,
      granularity: "day",
    });

    expect(card.adsUnit).toBe(0);
  });
});

// ============================================================================
// ratearAdsDaCarteira — Fase 212
//
// A mesma régua da fase 211, aplicada à CARTEIRA inteira de anúncios do período
// (Produtos Vendidos, Catálogo de Anúncios, Margem): o total da fatura é a
// verdade, o cache é só a proporção. Aqui a chave é o gasto do PERÍODO por
// anúncio — que é o que a RPC `get_margin_with_ads_by_product` já devolve.
// ============================================================================

describe("ratearAdsDaCarteira", () => {
  /** Fatura sintética só com o total (o rateio da carteira não usa a série diária). */
  function faturaTotal(total: number, rowCount = 1): AdsBillingSpend {
    return {
      daily: [{ date: "2026-07-05", spend: total }],
      total,
      rowCount,
      coverageFrom: "2026-07-05",
      coverageTo: "2026-07-05",
    };
  }

  it("reproduz o caso medido no banco: 751,88 de cache viram 481,64 rateados", () => {
    // Pé Vermeio, MLB7060842760, 05/07 a 04/08/2026 — medido em produção:
    // fatura PADS+BPAD 9.474,36 · cache do período 14.790,21 · item 751,88.
    const r = ratearAdsDaCarteira(faturaTotal(9474.36), [
      { itemId: "MLB7060842760", cacheSpend: 751.88 },
      { itemId: "OUTROS", cacheSpend: 14790.21 - 751.88 },
    ]);

    expect(r.source).toBe("billing-rateio");
    expect(r.porItem.get("MLB7060842760")).toBe(481.64);
    expect(r.totalFatura).toBe(9474.36);
    expect(r.naoRateado).toBe(0);
  });

  it("fecha ao centavo: a soma do rateado é exatamente o total da fatura", () => {
    // Pesos propositalmente feios, para o maior resto ter trabalho.
    const itens = [
      { itemId: "A", cacheSpend: 33.33 },
      { itemId: "B", cacheSpend: 33.33 },
      { itemId: "C", cacheSpend: 33.34 },
      { itemId: "D", cacheSpend: 0.01 },
    ];
    const r = ratearAdsDaCarteira(faturaTotal(1000.01), itens);

    const soma = [...r.porItem.values()].reduce((s, v) => s + v, 0);
    expect(Math.round(soma * 100)).toBe(Math.round(1000.01 * 100));
    expect(r.totalRateado).toBe(1000.01);
  });

  it("nunca soma as duas fontes: o total é o da fatura, não fatura + cache", () => {
    const r = ratearAdsDaCarteira(faturaTotal(100), [
      { itemId: "A", cacheSpend: 40 },
      { itemId: "B", cacheSpend: 10 },
    ]);

    const soma = [...r.porItem.values()].reduce((s, v) => s + v, 0);
    expect(soma).toBe(100); // e não 150
    expect(r.porItem.get("A")).toBe(80);
    expect(r.porItem.get("B")).toBe(20);
  });

  it("sem fatura no período, cai para o cache com a origem rotulada", () => {
    const itens = [
      { itemId: "A", cacheSpend: 12.5 },
      { itemId: "B", cacheSpend: 7.25 },
    ];

    for (const semFatura of [null, faturaTotal(0, 0)]) {
      const r = ratearAdsDaCarteira(semFatura, itens);
      expect(r.source).toBe("cache");
      expect(r.porItem.get("A")).toBe(12.5);
      expect(r.porItem.get("B")).toBe(7.25);
      expect(r.totalFatura).toBe(0);
      expect(r.naoRateado).toBe(0);
    }
  });

  it("fatura sem chave de rateio nenhuma: declara o não rateado, não inventa dono", () => {
    const r = ratearAdsDaCarteira(faturaTotal(250.75), [
      { itemId: "A", cacheSpend: 0 },
      { itemId: "B", cacheSpend: 0 },
    ]);

    expect(r.source).toBe("billing-rateio");
    expect(r.porItem.get("A")).toBe(0);
    expect(r.porItem.get("B")).toBe(0);
    expect(r.naoRateado).toBe(250.75);
    expect(r.totalRateado).toBe(0);
  });

  it("item repetido soma o peso uma vez só (defesa contra linha duplicada)", () => {
    const r = ratearAdsDaCarteira(faturaTotal(90), [
      { itemId: "A", cacheSpend: 10 },
      { itemId: "A", cacheSpend: 10 },
      { itemId: "B", cacheSpend: 10 },
    ]);

    expect(r.porItem.size).toBe(2);
    expect(r.porItem.get("A")).toBe(60);
    expect(r.porItem.get("B")).toBe(30);
  });

  it("peso negativo ou não finito conta como zero, nunca como crédito", () => {
    const r = ratearAdsDaCarteira(faturaTotal(100), [
      { itemId: "A", cacheSpend: -50 },
      { itemId: "B", cacheSpend: Number.NaN },
      { itemId: "C", cacheSpend: 10 },
    ]);

    expect(r.porItem.get("A")).toBe(0);
    expect(r.porItem.get("B")).toBe(0);
    expect(r.porItem.get("C")).toBe(100);
  });

  it("carteira vazia com fatura: tudo vira não rateado", () => {
    const r = ratearAdsDaCarteira(faturaTotal(42.42), []);
    expect(r.porItem.size).toBe(0);
    expect(r.naoRateado).toBe(42.42);
  });
});
