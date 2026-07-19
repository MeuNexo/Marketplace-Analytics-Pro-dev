import {
  bucketKeyForDate,
  computePrecoMcoSeries,
  computePreviousWindow,
  computePriceKpis,
  computeWaterfallCard,
  percentDelta,
  pointDelta,
  type AdsDailyRow,
  type PrecoSeriesRow,
} from "./precoMcoSeries";

/** Row base para os testes — bucket com todos os componentes preenchidos. */
function row(overrides: Partial<PrecoSeriesRow> = {}): PrecoSeriesRow {
  return {
    bucket: "2026-06-01",
    qtd: 10,
    total: 1000,
    cmv: 300,
    comissao: 120,
    frete: 80,
    qtd_sem_custo: 0,
    impostos: 60,
    qtd_sem_imposto: 0,
    ...overrides,
  };
}

describe("bucketKeyForDate", () => {
  it("dia: retorna a própria data", () => {
    expect(bucketKeyForDate("2026-06-03", "day")).toBe("2026-06-03");
  });

  it("semana: trunca para a segunda-feira (weekStartsOn=1, igual ao date_trunc('week') do Postgres)", () => {
    // 2026-06-01 é segunda-feira; 02 (ter) e 04 (qui) caem na mesma semana
    expect(bucketKeyForDate("2026-06-02", "week")).toBe("2026-06-01");
    expect(bucketKeyForDate("2026-06-04", "week")).toBe("2026-06-01");
    // A própria segunda permanece nela mesma
    expect(bucketKeyForDate("2026-06-01", "week")).toBe("2026-06-01");
    // Domingo 2026-06-07 pertence à semana iniciada em 2026-06-01 (não à seguinte)
    expect(bucketKeyForDate("2026-06-07", "week")).toBe("2026-06-01");
  });

  it("mês: trunca para o dia 1", () => {
    expect(bucketKeyForDate("2026-06-20", "month")).toBe("2026-06-01");
    expect(bucketKeyForDate("2026-06-01", "month")).toBe("2026-06-01");
  });
});

describe("computePrecoMcoSeries", () => {
  it("composição típica: mco/mcoPct/breakevenUnit corretos reusando computeMco", () => {
    // qtd 10, total 1000, cmv 300, comissao 120, frete 80, impostos 60, ads 40
    // mco = 1000 - 300 - (120+80) - 40 - 60 = 400 ; mcoPct = 400/1000*100 = 40
    // precoUnit = 1000/10 = 100
    // breakevenUnit = (300+120+80+40+60)/10 = 600/10 = 60
    // unidades: cmv 30, comissao 12, frete 8, ads 4, imposto 6
    const adsDaily: AdsDailyRow[] = [{ date: "2026-06-01", spend: 40 }];
    const [p] = computePrecoMcoSeries([row()], {
      adsDaily,
      incluirAds: true,
      granularity: "day",
    });

    expect(p.bucket).toBe("2026-06-01");
    expect(p.qtd).toBe(10);
    expect(p.ads).toBe(40);
    expect(p.mco).toBe(400);
    expect(p.mcoPct).toBeCloseTo(40, 5);
    expect(p.precoUnit).toBeCloseTo(100, 5);
    expect(p.breakevenUnit).toBeCloseTo(60, 5);
    expect(p.cmvUnit).toBeCloseTo(30, 5);
    expect(p.comissaoUnit).toBeCloseTo(12, 5);
    expect(p.freteUnit).toBeCloseTo(8, 5);
    expect(p.adsUnit).toBeCloseTo(4, 5);
    expect(p.impostoUnit).toBeCloseTo(6, 5);
  });

  it("bandas gain/loss são mutuamente exclusivas e base = min(preco, breakeven)", () => {
    // Bucket A: preco 100 >= breakeven (300+100+100)/10 = 50 → gain 50, loss 0
    // Bucket B: preco 50 < breakeven (600+100+100)/10 = 80 → loss 30, gain 0
    const rows: PrecoSeriesRow[] = [
      row({ bucket: "2026-06-01", total: 1000, cmv: 300, comissao: 100, frete: 100, impostos: 0 }),
      row({ bucket: "2026-06-02", total: 500, cmv: 600, comissao: 100, frete: 100, impostos: 0 }),
    ];
    const [a, b] = computePrecoMcoSeries(rows, {
      adsDaily: [],
      incluirAds: true,
      granularity: "day",
    });

    expect(a.gainBand).toBeCloseTo(50, 5);
    expect(a.lossBand).toBe(0);
    expect(a.base).toBeCloseTo(50, 5); // min(100, 50)

    expect(b.lossBand).toBeCloseTo(30, 5);
    expect(b.gainBand).toBe(0);
    expect(b.base).toBeCloseTo(50, 5); // min(50, 80)

    // Exclusão mútua: nunca as duas bandas > 0 no mesmo ponto
    for (const p of [a, b]) {
      expect(p.gainBand === 0 || p.lossBand === 0).toBe(true);
    }
  });

  it("custoAusente/impostoAusente refletem qtd_sem_custo>0 / qtd_sem_imposto>0", () => {
    const rows: PrecoSeriesRow[] = [
      row({ bucket: "2026-06-01", qtd_sem_custo: 3, qtd_sem_imposto: 0 }),
      row({ bucket: "2026-06-02", qtd_sem_custo: 0, qtd_sem_imposto: 5 }),
      row({ bucket: "2026-06-03", qtd_sem_custo: 0, qtd_sem_imposto: 0 }),
    ];
    const [a, b, c] = computePrecoMcoSeries(rows, {
      adsDaily: [],
      incluirAds: true,
      granularity: "day",
    });

    expect(a.custoAusente).toBe(true);
    expect(a.impostoAusente).toBe(false);
    expect(b.custoAusente).toBe(false);
    expect(b.impostoAusente).toBe(true);
    expect(c.custoAusente).toBe(false);
    expect(c.impostoAusente).toBe(false);
  });

  it("toggle incluirAds=false zera ads/adsUnit em todos os buckets e reduz o break-even", () => {
    const rows: PrecoSeriesRow[] = [
      row({ bucket: "2026-06-01" }),
      row({ bucket: "2026-06-02" }),
    ];
    const adsDaily: AdsDailyRow[] = [
      { date: "2026-06-01", spend: 40 },
      { date: "2026-06-02", spend: 25 },
    ];

    const comAds = computePrecoMcoSeries(rows, { adsDaily, incluirAds: true, granularity: "day" });
    const semAds = computePrecoMcoSeries(rows, { adsDaily, incluirAds: false, granularity: "day" });

    for (const p of semAds) {
      expect(p.ads).toBe(0);
      expect(p.adsUnit).toBe(0);
    }
    // Break-even sem a parcela de ads é estritamente menor onde havia spend
    expect(semAds[0].breakevenUnit).toBeLessThan(comAds[0].breakevenUnit);
    expect(semAds[1].breakevenUnit).toBeLessThan(comAds[1].breakevenUnit);
    // Diferença exata: 40/10 = 4 e 25/10 = 2.5 por unidade
    expect(comAds[0].breakevenUnit - semAds[0].breakevenUnit).toBeCloseTo(4, 5);
    expect(comAds[1].breakevenUnit - semAds[1].breakevenUnit).toBeCloseTo(2.5, 5);
  });

  it("bucketiza ads diário pela mesma truncagem da RPC (dia, semana e mês)", () => {
    // DIA: cada data cai no seu próprio bucket
    const dia = computePrecoMcoSeries(
      [row({ bucket: "2026-06-03" }), row({ bucket: "2026-06-04" })],
      {
        adsDaily: [
          { date: "2026-06-03", spend: 10 },
          { date: "2026-06-04", spend: 15 },
        ],
        incluirAds: true,
        granularity: "day",
      },
    );
    expect(dia[0].ads).toBe(10);
    expect(dia[1].ads).toBe(15);

    // SEMANA: 02 (ter) e 04 (qui) somam no bucket da segunda 2026-06-01
    const semana = computePrecoMcoSeries([row({ bucket: "2026-06-01" })], {
      adsDaily: [
        { date: "2026-06-02", spend: 10 },
        { date: "2026-06-04", spend: 15 },
      ],
      incluirAds: true,
      granularity: "week",
    });
    expect(semana[0].ads).toBe(25);

    // MÊS: 05 e 20 somam no bucket do dia 1
    const mes = computePrecoMcoSeries([row({ bucket: "2026-06-01" })], {
      adsDaily: [
        { date: "2026-06-05", spend: 7 },
        { date: "2026-06-20", spend: 13 },
      ],
      incluirAds: true,
      granularity: "month",
    });
    expect(mes[0].ads).toBe(20);
  });

  it("qtd=0 nunca produz NaN/Infinity; mcoPct null quando total=0", () => {
    const [p] = computePrecoMcoSeries(
      [row({ qtd: 0, total: 0, cmv: 0, comissao: 0, frete: 0, impostos: 0 })],
      { adsDaily: [{ date: "2026-06-01", spend: 40 }], incluirAds: true, granularity: "day" },
    );

    expect(p.precoUnit).toBe(0);
    expect(p.breakevenUnit).toBe(0);
    expect(p.mcoPct).toBeNull();
    for (const v of [
      p.precoUnit, p.breakevenUnit, p.cmvUnit, p.comissaoUnit, p.freteUnit,
      p.adsUnit, p.impostoUnit, p.ads, p.mco, p.base, p.gainBand, p.lossBand,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("computePreviousWindow", () => {
  it("janela de 7 dias: retorna os 7 dias imediatamente anteriores", () => {
    expect(computePreviousWindow("2026-06-08", "2026-06-14")).toEqual({
      from: "2026-06-01",
      to: "2026-06-07",
    });
  });

  it("um único dia (from===to): janela anterior é o dia anterior", () => {
    expect(computePreviousWindow("2026-06-14", "2026-06-14")).toEqual({
      from: "2026-06-13",
      to: "2026-06-13",
    });
  });

  it("from ou to null: retorna null", () => {
    expect(computePreviousWindow(null, "2026-06-14")).toBeNull();
    expect(computePreviousWindow("2026-06-08", null)).toBeNull();
    expect(computePreviousWindow(null, null)).toBeNull();
  });
});

describe("computePriceKpis", () => {
  it("caso típico: reconcilia com a lógica do componente (ads no mesmo dia)", () => {
    const adsDaily: AdsDailyRow[] = [{ date: "2026-06-01", spend: 40 }];
    const kpis = computePriceKpis([row()], {
      adsDaily,
      incluirAds: true,
      granularity: "day",
    });

    expect(kpis.qtd).toBe(10);
    expect(kpis.receita).toBe(1000);
    expect(kpis.precoMedio).toBeCloseTo(100, 5);
    expect(kpis.breakevenMedio).toBeCloseTo(60, 5);
    expect(kpis.mco).toBe(400);
    expect(kpis.mcoPct).toBeCloseTo(40, 5);
  });

  it("qtd=0 / total=0: precoMedio e breakevenMedio zerados, mcoPct null", () => {
    const kpis = computePriceKpis(
      [row({ qtd: 0, total: 0, cmv: 0, comissao: 0, frete: 0, impostos: 0 })],
      { adsDaily: [], incluirAds: true, granularity: "day" },
    );

    expect(kpis.precoMedio).toBe(0);
    expect(kpis.breakevenMedio).toBe(0);
    expect(kpis.mcoPct).toBeNull();
  });
});

describe("computeWaterfallCard", () => {
  it("período normal com 2 buckets: cada campo por unidade é a soma dos totais dividida pela soma de qtd", () => {
    // Row 1: qtd 10, total 1000, cmv 300, comissao 120, frete 80, impostos 60, ads 40
    // Row 2: qtd 5,  total 600,  cmv 150, comissao 60,  frete 40, impostos 30, ads 20
    // Σqtd=15, Σtotal=1600, Σcmv=450, Σcomissao=180, Σfrete=120, Σimpostos=90, Σads=60
    const rows: PrecoSeriesRow[] = [
      row({ bucket: "2026-06-01", qtd: 10, total: 1000, cmv: 300, comissao: 120, frete: 80, impostos: 60 }),
      row({ bucket: "2026-06-02", qtd: 5, total: 600, cmv: 150, comissao: 60, frete: 40, impostos: 30 }),
    ];
    const adsDaily: AdsDailyRow[] = [
      { date: "2026-06-01", spend: 40 },
      { date: "2026-06-02", spend: 20 },
    ];

    const card = computeWaterfallCard(rows, { adsDaily, incluirAds: true, granularity: "day" });

    expect(card.precoUnit).toBeCloseTo(1600 / 15, 5);
    expect(card.cmvUnit).toBeCloseTo(450 / 15, 5);
    expect(card.comissaoUnit).toBeCloseTo(180 / 15, 5);
    expect(card.freteUnit).toBeCloseTo(120 / 15, 5);
    expect(card.adsUnit).toBeCloseTo(60 / 15, 5);
    expect(card.impostoUnit).toBeCloseTo(90 / 15, 5);
    // mcUnit (margem antes de ads) = (1600-450-180-120-90)/15 = 760/15
    expect(card.mcUnit).toBeCloseTo(760 / 15, 5);
    // mco (via computeMco) = 1600-450-(180+120)-60-90 = 700 ; mcoUnit = 700/15
    expect(card.mcoUnit).toBeCloseTo(700 / 15, 5);
    expect(card.mcoPct).toBeCloseTo(43.75, 5);
    // mcBeforeAdsPct = mcUnit/precoUnit*100 = 760/1600*100 = 47.5
    expect(card.mcBeforeAdsPct).toBeCloseTo(47.5, 5);
    expect(card.custoAusente).toBe(false);
    expect(card.impostoAusente).toBe(false);
  });

  it("qtd=0 (sem vendas no período): todos os campos por unidade são 0, sem NaN/Infinity", () => {
    const rows: PrecoSeriesRow[] = [
      row({ qtd: 0, total: 0, cmv: 0, comissao: 0, frete: 0, impostos: 0 }),
    ];
    const card = computeWaterfallCard(rows, {
      adsDaily: [{ date: "2026-06-01", spend: 40 }],
      incluirAds: true,
      granularity: "day",
    });

    expect(card.precoUnit).toBe(0);
    expect(card.cmvUnit).toBe(0);
    expect(card.comissaoUnit).toBe(0);
    expect(card.freteUnit).toBe(0);
    expect(card.adsUnit).toBe(0);
    expect(card.impostoUnit).toBe(0);
    expect(card.mcUnit).toBe(0);
    expect(card.mcoUnit).toBe(0);
    expect(card.mcoPct).toBeNull();
    expect(card.mcBeforeAdsPct).toBeNull();
    for (const v of [
      card.precoUnit, card.cmvUnit, card.comissaoUnit, card.freteUnit,
      card.adsUnit, card.impostoUnit, card.mcUnit, card.mcoUnit,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("custoAusente = true quando qualquer row tem qtd_sem_custo > 0", () => {
    const rows: PrecoSeriesRow[] = [
      row({ bucket: "2026-06-01", qtd_sem_custo: 3 }),
      row({ bucket: "2026-06-02", qtd_sem_custo: 0 }),
    ];
    const card = computeWaterfallCard(rows, { adsDaily: [], incluirAds: true, granularity: "day" });
    expect(card.custoAusente).toBe(true);
    expect(card.impostoAusente).toBe(false);
  });

  it("impostoAusente = true quando qualquer row tem qtd_sem_imposto > 0", () => {
    const rows: PrecoSeriesRow[] = [
      row({ bucket: "2026-06-01", qtd_sem_imposto: 0 }),
      row({ bucket: "2026-06-02", qtd_sem_imposto: 5 }),
    ];
    const card = computeWaterfallCard(rows, { adsDaily: [], incluirAds: true, granularity: "day" });
    expect(card.impostoAusente).toBe(true);
    expect(card.custoAusente).toBe(false);
  });

  it("incluirAds=false: adsUnit=0 e mcoUnit == mcUnit (sem ads, MCO coincide com a margem antes de ads)", () => {
    const rows: PrecoSeriesRow[] = [row({ bucket: "2026-06-01" })];
    const adsDaily: AdsDailyRow[] = [{ date: "2026-06-01", spend: 40 }];

    const card = computeWaterfallCard(rows, { adsDaily, incluirAds: false, granularity: "day" });

    expect(card.adsUnit).toBe(0);
    expect(card.mcoUnit).toBeCloseTo(card.mcUnit, 5);
  });
});

describe("percentDelta / pointDelta", () => {
  it("percentDelta: variação percentual com sinal correto", () => {
    expect(percentDelta(110, 100)).toBeCloseTo(10, 5);
    expect(percentDelta(90, 100)).toBeCloseTo(-10, 5);
    expect(percentDelta(50, 0)).toBeNull();
  });

  it("pointDelta: diferença absoluta em pontos; null se qualquer argumento for null", () => {
    expect(pointDelta(41.3, 40)).toBeCloseTo(1.3, 5);
    expect(pointDelta(null, 40)).toBeNull();
    expect(pointDelta(40, null)).toBeNull();
    expect(pointDelta(null, null)).toBeNull();
  });
});
