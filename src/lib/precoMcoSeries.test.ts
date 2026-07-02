import {
  bucketKeyForDate,
  computePrecoMcoSeries,
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
