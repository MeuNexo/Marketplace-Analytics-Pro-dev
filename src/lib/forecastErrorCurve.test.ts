// ============================================================================
// forecastErrorCurve.test.ts — Fase 224 Plano 03, Task 2 (TDD)
// Testa o módulo puro que transforma as linhas cruas de
// get_forecast_backtest_curve na curva de erro por horizonte: WAPE, fator de
// viés (razão de SOMAS), ME diário, MAE, tracking signal, marcação de
// provisório, a medida do viés importado do futuro e o horizonte útil.
//
// Espelho estrutural de src/lib/dreCashForecast.test.ts: helper construtor de
// linha, casos sintéticos cobrindo cada item do contrato, e um cenário com a
// forma real da curva medida (fator perto de 1,1 nos primeiros horizontes,
// n decrescente, um horizonte com realizado zero).
//
// Guardrail que estes testes existem para travar: nulo é NÃO MEDIDO, zero é
// MEDIDO E IGUAL A ZERO. Nenhum indicador vira 0 por omissão.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  construirCurva,
  medirViesImportado,
  horizonteUtil,
  N_MINIMO_PARA_PUBLICAR,
  type CurvaBacktestRow,
  type PontoDaCurva,
} from "./forecastErrorCurve";

/** Helper construtor de linha crua — molde do row() de dreCashForecast.test.ts. */
function row(
  horizon_days: number,
  campos: Partial<CurvaBacktestRow> = {},
): CurvaBacktestRow {
  return {
    escopo: "entradas",
    corrigido: true,
    agregacao: "diario",
    horizon_days,
    n: 40,
    soma_previsto: 110,
    soma_realizado: 100,
    soma_erro_abs: 10,
    soma_erro_sinal: 10,
    ...campos,
  };
}

const ENTRADAS_DIARIO_CORR = { escopo: "entradas", agregacao: "diario", corrigido: true };

/** Ponto sintético para os testes de horizonteUtil. */
function ponto(horizonte: number, fator: number | null, provisorio = false): PontoDaCurva {
  return {
    horizonte,
    n: provisorio ? 5 : 40,
    wape: 0.1,
    fator,
    meDiario: 1,
    mae: 1,
    trackingSignal: 1,
    provisorio,
  };
}

describe("construirCurva — entrada degenerada", () => {
  it("Test 1: lista vazia devolve lista vazia, não lança", () => {
    expect(construirCurva([], ENTRADAS_DIARIO_CORR)).toEqual([]);
  });

  it("Test 2: entrada nula ou indefinida devolve lista vazia, não lança", () => {
    expect(construirCurva(null as unknown as CurvaBacktestRow[], ENTRADAS_DIARIO_CORR)).toEqual([]);
    expect(construirCurva(undefined as unknown as CurvaBacktestRow[], ENTRADAS_DIARIO_CORR)).toEqual([]);
  });

  it("Test 3: nenhuma linha casa com o filtro — lista vazia", () => {
    const rows = [row(1, { escopo: "saidas", corrigido: null })];
    expect(construirCurva(rows, ENTRADAS_DIARIO_CORR)).toEqual([]);
  });
});

describe("construirCurva — o filtro por escopo, agregação e correção", () => {
  it("Test 4: separa entradas de saídas e diário de acumulado, sem misturar", () => {
    const rows = [
      row(1, { escopo: "entradas", agregacao: "diario", corrigido: true, soma_previsto: 110 }),
      row(1, { escopo: "entradas", agregacao: "diario", corrigido: false, soma_previsto: 105 }),
      row(1, { escopo: "entradas", agregacao: "acumulado", corrigido: true, soma_previsto: 120 }),
      row(1, { escopo: "saidas", agregacao: "diario", corrigido: null, soma_previsto: 130 }),
    ];
    expect(construirCurva(rows, ENTRADAS_DIARIO_CORR)[0].fator).toBeCloseTo(1.1, 10);
    expect(
      construirCurva(rows, { escopo: "entradas", agregacao: "diario", corrigido: false })[0].fator,
    ).toBeCloseTo(1.05, 10);
    expect(
      construirCurva(rows, { escopo: "entradas", agregacao: "acumulado", corrigido: true })[0].fator,
    ).toBeCloseTo(1.2, 10);
  });

  it("Test 5: escopo saídas casa com corrigido nulo — o SQL devolve NULL nessa coluna", () => {
    const rows = [row(1, { escopo: "saidas", agregacao: "diario", corrigido: null, soma_previsto: 130 })];
    const pontos = construirCurva(rows, { escopo: "saidas", agregacao: "diario", corrigido: null });
    expect(pontos).toHaveLength(1);
    expect(pontos[0].fator).toBeCloseTo(1.3, 10);
  });
});

describe("construirCurva — as fórmulas", () => {
  it("Test 6: wape é o erro absoluto sobre o MÓDULO do realizado", () => {
    const p = construirCurva([row(1, { soma_erro_abs: 25, soma_realizado: -200 })], ENTRADAS_DIARIO_CORR)[0];
    expect(p.wape).toBeCloseTo(0.125, 10);
  });

  it("Test 7: fator é RAZÃO DE SOMAS, não média de razões", () => {
    // Um dia grande (R$ 50.000 realizado, previsto 55.000) e um dia pequeno
    // (R$ 200 realizado, previsto 5.000). A média de razões daria (1,1+25)/2
    // = 13,05 — dominada pelo dia pequeno. A razão de somas dá 60.000/50.200.
    const p = construirCurva(
      [row(1, { soma_previsto: 60000, soma_realizado: 50200, soma_erro_abs: 9800, soma_erro_sinal: 9800, n: 2 })],
      ENTRADAS_DIARIO_CORR,
    )[0];
    expect(p.fator).toBeCloseTo(60000 / 50200, 10);
    expect(p.fator).toBeLessThan(1.2);
    expect(p.fator).not.toBeCloseTo(13.05, 2);
  });

  it("Test 8: meDiario é o erro com sinal dividido por n, e mae é o erro absoluto dividido por n", () => {
    const p = construirCurva([row(1, { n: 40, soma_erro_sinal: -800, soma_erro_abs: 2000 })], ENTRADAS_DIARIO_CORR)[0];
    expect(p.meDiario).toBeCloseTo(-20, 10);
    expect(p.mae).toBeCloseTo(50, 10);
  });

  it("Test 9: trackingSignal é n vezes o erro com sinal sobre o erro absoluto", () => {
    const p = construirCurva([row(1, { n: 40, soma_erro_sinal: 400, soma_erro_abs: 800 })], ENTRADAS_DIARIO_CORR)[0];
    expect(p.trackingSignal).toBeCloseTo(20, 10);
  });
});

describe("construirCurva — nulo é não medido, jamais zero", () => {
  it("Test 10: realizado zero devolve wape e fator NULOS, nunca zero e nunca infinito", () => {
    const p = construirCurva([row(1, { soma_realizado: 0 })], ENTRADAS_DIARIO_CORR)[0];
    expect(p.wape).toBeNull();
    expect(p.fator).toBeNull();
    expect(Number.isFinite(p.wape as number)).toBe(false);
  });

  it("Test 11: erro absoluto zero devolve trackingSignal nulo (mae e wape seguem medidos e valem zero)", () => {
    const p = construirCurva([row(1, { soma_erro_abs: 0, soma_erro_sinal: 0 })], ENTRADAS_DIARIO_CORR)[0];
    expect(p.trackingSignal).toBeNull();
    expect(p.mae).toBe(0);
    expect(p.wape).toBe(0);
  });

  it("Test 12: n igual a zero devolve TODOS os indicadores nulos", () => {
    const p = construirCurva([row(1, { n: 0 })], ENTRADAS_DIARIO_CORR)[0];
    expect(p.wape).toBeNull();
    expect(p.fator).toBeNull();
    expect(p.meDiario).toBeNull();
    expect(p.mae).toBeNull();
    expect(p.trackingSignal).toBeNull();
    expect(p.n).toBe(0);
  });

  it("Test 13: soma nula na entrada devolve o indicador correspondente nulo, nunca zero por omissão", () => {
    const semPrevisto = construirCurva([row(1, { soma_previsto: null })], ENTRADAS_DIARIO_CORR)[0];
    expect(semPrevisto.fator).toBeNull();
    expect(semPrevisto.wape).toBeCloseTo(0.1, 10);

    const semErroAbs = construirCurva([row(1, { soma_erro_abs: null })], ENTRADAS_DIARIO_CORR)[0];
    expect(semErroAbs.wape).toBeNull();
    expect(semErroAbs.mae).toBeNull();
    expect(semErroAbs.trackingSignal).toBeNull();

    const semErroSinal = construirCurva([row(1, { soma_erro_sinal: null })], ENTRADAS_DIARIO_CORR)[0];
    expect(semErroSinal.meDiario).toBeNull();
    expect(semErroSinal.trackingSignal).toBeNull();

    const semRealizado = construirCurva([row(1, { soma_realizado: null })], ENTRADAS_DIARIO_CORR)[0];
    expect(semRealizado.wape).toBeNull();
    expect(semRealizado.fator).toBeNull();
  });
});

describe("construirCurva — provisório e ordenação", () => {
  it("Test 14: provisorio é verdadeiro quando n é menor que N_MINIMO_PARA_PUBLICAR", () => {
    expect(N_MINIMO_PARA_PUBLICAR).toBe(20);
    expect(construirCurva([row(1, { n: 19 })], ENTRADAS_DIARIO_CORR)[0].provisorio).toBe(true);
    expect(construirCurva([row(1, { n: 20 })], ENTRADAS_DIARIO_CORR)[0].provisorio).toBe(false);
    expect(construirCurva([row(1, { n: 21 })], ENTRADAS_DIARIO_CORR)[0].provisorio).toBe(false);
  });

  it("Test 15: horizontes saem em ordem crescente mesmo com a entrada fora de ordem", () => {
    const rows = [row(15), row(3), row(1), row(9)];
    expect(construirCurva(rows, ENTRADAS_DIARIO_CORR).map((p) => p.horizonte)).toEqual([1, 3, 9, 15]);
  });
});

describe("medirViesImportado", () => {
  it("Test 16: a diferença é positiva quando a correção aumenta o fator — o esperado", () => {
    const bruta = construirCurva([row(1, { soma_previsto: 100, corrigido: false })], {
      escopo: "entradas",
      agregacao: "diario",
      corrigido: false,
    });
    const corrigida = construirCurva([row(1, { soma_previsto: 112 })], ENTRADAS_DIARIO_CORR);
    const vies = medirViesImportado(bruta, corrigida);
    expect(vies).toHaveLength(1);
    expect(vies[0].horizonte).toBe(1);
    expect(vies[0].fatorBruto).toBeCloseTo(1.0, 10);
    expect(vies[0].fatorCorrigido).toBeCloseTo(1.12, 10);
    expect(vies[0].diferenca).toBeCloseTo(0.12, 10);
    expect(vies[0].diferenca).toBeGreaterThan(0);
  });

  it("Test 17: horizonte presente em uma lista e ausente na outra é IGNORADO, não vira nulo", () => {
    const bruta = [ponto(1, 1.0), ponto(2, 1.0), ponto(3, 1.0)];
    const corrigida = [ponto(2, 1.1)];
    const vies = medirViesImportado(bruta, corrigida);
    expect(vies.map((v) => v.horizonte)).toEqual([2]);
  });

  it("Test 18: qualquer dos dois fatores nulo produz diferença nula, e o horizonte continua na lista", () => {
    const vies = medirViesImportado([ponto(1, null), ponto(2, 1.0)], [ponto(1, 1.1), ponto(2, null)]);
    expect(vies).toHaveLength(2);
    expect(vies[0].diferenca).toBeNull();
    expect(vies[1].diferenca).toBeNull();
  });

  it("Test 19: listas vazias, nulas ou indefinidas devolvem lista vazia", () => {
    expect(medirViesImportado([], [])).toEqual([]);
    expect(medirViesImportado(null as unknown as PontoDaCurva[], [ponto(1, 1)])).toEqual([]);
    expect(medirViesImportado([ponto(1, 1)], undefined as unknown as PontoDaCurva[])).toEqual([]);
  });
});

describe("horizonteUtil — a tolerância é do Wesley (D-6), não do código", () => {
  it("Test 20: devolve o maior horizonte sem buraco dentro de mais ou menos a tolerância em torno de 1", () => {
    const pontos = [ponto(1, 1.02), ponto(2, 1.04), ponto(3, 1.09), ponto(4, 1.01)];
    expect(horizonteUtil(pontos, 0.05)).toBe(2);
    expect(horizonteUtil(pontos, 0.1)).toBe(4);
  });

  it("Test 21: se nem D+1 passar, devolve nulo", () => {
    expect(horizonteUtil([ponto(1, 1.3), ponto(2, 1.0)], 0.05)).toBeNull();
    expect(horizonteUtil([], 0.05)).toBeNull();
    expect(horizonteUtil(null as unknown as PontoDaCurva[], 0.05)).toBeNull();
  });

  it("Test 22: ponto provisório interrompe a sequência — horizonte sem amostra não se declara útil", () => {
    expect(horizonteUtil([ponto(1, 1.0), ponto(2, 1.0, true), ponto(3, 1.0)], 0.05)).toBe(1);
  });

  it("Test 23: fator nulo interrompe a sequência, e horizonte ausente também", () => {
    expect(horizonteUtil([ponto(1, 1.0), ponto(2, null), ponto(3, 1.0)], 0.05)).toBe(1);
    expect(horizonteUtil([ponto(1, 1.0), ponto(3, 1.0)], 0.05)).toBe(1);
  });

  it("Test 24: a tolerância é argumento OBRIGATÓRIO — chamar sem ela não compila (D-6)", () => {
    // @ts-expect-error a tolerância não tem valor padrão e não se herda:
    // o limiar da PV é decisão do Wesley depois de ver a curva.
    expect(() => horizonteUtil([ponto(1, 1.0)])).not.toThrow();
  });

  it("Test 25: fator abaixo de 1 também conta — a tolerância é simétrica", () => {
    expect(horizonteUtil([ponto(1, 0.96), ponto(2, 0.94)], 0.05)).toBe(1);
  });
});

describe("cenário com a forma real da curva medida", () => {
  it("Test 26: fator perto de 1,1 no curto prazo, n decrescente, um horizonte com realizado zero", () => {
    const rows: CurvaBacktestRow[] = [
      row(1, { n: 44, soma_previsto: 1_100_000, soma_realizado: 1_000_000, soma_erro_abs: 120_000, soma_erro_sinal: 100_000 }),
      row(2, { n: 43, soma_previsto: 1_090_000, soma_realizado: 1_000_000, soma_erro_abs: 130_000, soma_erro_sinal: 90_000 }),
      row(3, { n: 42, soma_previsto: 0, soma_realizado: 0, soma_erro_abs: 0, soma_erro_sinal: 0 }),
      row(14, { n: 12, soma_previsto: 600_000, soma_realizado: 900_000, soma_erro_abs: 400_000, soma_erro_sinal: -300_000 }),
    ];
    const curva = construirCurva(rows, ENTRADAS_DIARIO_CORR);

    expect(curva.map((p) => p.horizonte)).toEqual([1, 2, 3, 14]);
    expect(curva[0].fator).toBeCloseTo(1.1, 10);
    expect(curva[0].wape).toBeCloseTo(0.12, 10);
    expect(curva[0].provisorio).toBe(false);

    // Horizonte com realizado zero: não medido, não "perfeito".
    expect(curva[2].fator).toBeNull();
    expect(curva[2].wape).toBeNull();

    // Horizonte longo: amostra fina, previsão abaixo do realizado.
    expect(curva[3].provisorio).toBe(true);
    expect(curva[3].fator).toBeCloseTo(2 / 3, 10);
    expect(curva[3].meDiario).toBeCloseTo(-25_000, 10);

    // A curva quebra em D+3 porque lá não há realizado — e horizonteUtil
    // para antes de inventar continuidade.
    expect(horizonteUtil(curva, 0.15)).toBe(2);
  });
});
