import {
  simulateCashflow,
  type SimBasePoint,
  type SimEvent,
  type SimParams,
} from "./cashflowSimulation";

// ---------------------------------------------------------------------------
// Baseline determinístico de 10 pontos a partir de 2026-06-19.
// accumulated_balance_sma desenha um "vale" no índice 4 (dia 2026-06-23):
//   30000, 25000, 20000, 18000, 15000, 17000, 19000, 22000, 26000, 30000
// → mínimo do baseline = 15000 no índice 4.
// ---------------------------------------------------------------------------
const DATES = [
  "2026-06-19",
  "2026-06-20",
  "2026-06-21",
  "2026-06-22",
  "2026-06-23",
  "2026-06-24",
  "2026-06-25",
  "2026-06-26",
  "2026-06-27",
  "2026-06-28",
];
const SMA = [30000, 25000, 20000, 18000, 15000, 17000, 19000, 22000, 26000, 30000];

function makeBase(): SimBasePoint[] {
  return DATES.map((fullDate, i) => ({
    fullDate,
    accumulated_balance_sma: SMA[i],
  }));
}

function params(over: Partial<SimParams> = {}): SimParams {
  return {
    recebExtra: 0,
    gastoExtra: 0,
    eventos: [],
    margem: 10000,
    ...over,
  };
}

describe("simulateCashflow", () => {
  it("sem simulação: série == baseline e veredito usa menorSaldo do baseline", () => {
    const base = makeBase();
    const { series, verdict } = simulateCashflow(base, params());

    expect(series).toHaveLength(base.length);
    series.forEach((p, i) => {
      expect(p.fullDate).toBe(base[i].fullDate);
      expect(p.cenario).toBe(base[i].accumulated_balance_sma);
    });

    expect(verdict.ativa).toBe(false);
    expect(verdict.menorSaldo).toBe(Math.min(...SMA)); // 15000
    expect(verdict.valeIdx).toBe(4);
    expect(verdict.status).toBe("saudavel"); // 15000 >= 10000
  });

  it("gastoExtra empurra menorSaldo abaixo da margem → status risco + necessidadeReceitaDia > 0", () => {
    // gastoExtra=2000/dia. No vale (idx 4, diasDecorridos=5): 15000 - 2000*5 = 5000 < margem 10000.
    const base = makeBase();
    const { verdict } = simulateCashflow(base, params({ gastoExtra: 2000 }));

    expect(verdict.status).toBe("risco");
    expect(verdict.menorSaldo).toBeLessThan(10000);
    expect(verdict.necessidadeReceitaDia).toBeGreaterThan(0);
    expect(verdict.folgaGastoDia).toBe(0);
    expect(verdict.ativa).toBe(true);
  });

  it("recebExtra suficiente, baseline acima da margem → status saudável + folgaGastoDia > 0", () => {
    const base = makeBase();
    const { verdict } = simulateCashflow(base, params({ recebExtra: 1000 }));

    expect(verdict.status).toBe("saudavel");
    expect(verdict.folgaGastoDia).toBeGreaterThan(0);
    expect(verdict.necessidadeReceitaDia).toBe(0);
    expect(verdict.ativa).toBe(true);
  });

  it("evento de saída pontual rebaixa o saldo a partir da data certa (não antes)", () => {
    const base = makeBase();
    const evento: SimEvent = { valor: 5000, data: "2026-06-23", tipo: "saida" };
    const { series } = simulateCashflow(base, params({ eventos: [evento] }));

    // antes da data (índices 0..3): inalterado
    for (let i = 0; i < 4; i++) {
      expect(series[i].cenario).toBe(SMA[i]);
    }
    // a partir da data (índice 4 em diante): baseline − 5000
    for (let i = 4; i < SMA.length; i++) {
      expect(series[i].cenario).toBe(SMA[i] - 5000);
    }
  });

  it("evento de entrada pontual sobe o saldo a partir da data certa", () => {
    const base = makeBase();
    const evento: SimEvent = { valor: 4000, data: "2026-06-22", tipo: "entrada" };
    const { series } = simulateCashflow(base, params({ eventos: [evento] }));

    // antes (índices 0..2): inalterado
    for (let i = 0; i < 3; i++) {
      expect(series[i].cenario).toBe(SMA[i]);
    }
    // a partir do índice 3 (2026-06-22): baseline + 4000
    for (let i = 3; i < SMA.length; i++) {
      expect(series[i].cenario).toBe(SMA[i] + 4000);
    }
  });

  it("folga/necessidade calculadas no dia do vale correto (argmin)", () => {
    const base = makeBase();
    const { verdict } = simulateCashflow(base, params());

    expect(verdict.valeIdx).toBe(4);
    expect(verdict.diasAteVale).toBe(5); // valeIdx + 1
    expect(verdict.valeDate).toBe(DATES[4]); // 2026-06-23
    // saudável: folga = (15000 - 10000) / 5 = 1000
    expect(verdict.folgaGastoDia).toBeCloseTo(1000, 6);
    expect(verdict.necessidadeReceitaDia).toBe(0);
  });
});
