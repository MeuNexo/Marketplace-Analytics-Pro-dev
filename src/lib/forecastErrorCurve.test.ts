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

// ============================================================================
// Fase 224 Plano 07, Task 1 (ERR-04) — as bandas por faixa de horizonte.
//
// Nada abaixo desta linha altera os testes do 224-03: eles são o contrato da
// curva e continuam valendo palavra por palavra.
//
// O guardrail que estes testes existem para travar é a INVERSÃO DE SINAL. O
// erro medido é `previsto − realizado`, então o cenário ruim — a agenda
// prometeu e não entrou — é o quantil SUPERIOR. Usar o inferior daria o
// cenário bom com cara de cenário ruim, e a tela viraria máquina de otimismo.
// O Test 33 existe só para isso, com uma distribuição assimétrica em que os
// dois quantis têm sinais opostos.
// ============================================================================

import {
  quantilEmpirico,
  bandaPorFaixa,
  bandaDoSaldo,
  saldoNoPiorCaso,
  faixaDoHorizonte,
  FAIXAS_DE_HORIZONTE,
  AGREGACAO_DA_BANDA,
  type ErroBacktestRow,
  type BandaDaFaixa,
} from "./forecastErrorCurve";

/** Helper construtor de linha par a par de get_forecast_backtest_errors. */
function par(
  horizon_days: number,
  erro: number | null,
  campos: Partial<ErroBacktestRow> = {},
): ErroBacktestRow {
  return {
    escopo: "entradas",
    corrigido: true,
    agregacao: "acumulado",
    corte: "2026-07-01",
    horizon_days,
    previsto: erro == null ? null : 1000 + erro,
    realizado: 1000,
    erro,
    ...campos,
  };
}

/** Gera `quantos` pares no mesmo horizonte, com cortes distintos. */
function pares(
  horizon_days: number,
  erros: Array<number | null>,
  campos: Partial<ErroBacktestRow> = {},
): ErroBacktestRow[] {
  return erros.map((e, i) =>
    par(horizon_days, e, { corte: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, ...campos }),
  );
}

/** Acha a banda de uma faixa pelo horizonte que ela contém. */
function bandaDe(bandas: BandaDaFaixa[], horizonte: number): BandaDaFaixa {
  return bandas.find((b) => horizonte >= b.faixa.inicio && horizonte <= b.faixa.fim)!;
}

const ENTRADAS = { escopo: "entradas", corrigido: true };
const SAIDAS = { escopo: "saidas", corrigido: null };

describe("quantilEmpirico", () => {
  it("Test 27: lista vazia, nula ou indefinida devolve nulo — nunca zero", () => {
    expect(quantilEmpirico([], 0.95)).toBeNull();
    expect(quantilEmpirico(null as unknown as number[], 0.95)).toBeNull();
    expect(quantilEmpirico(undefined as unknown as number[], 0.95)).toBeNull();
  });

  it("Test 28: p igual a zero devolve o mínimo e p igual a um devolve o máximo", () => {
    const v = [5, -3, 12, 0, 7];
    expect(quantilEmpirico(v, 0)).toBe(-3);
    expect(quantilEmpirico(v, 1)).toBe(12);
  });

  it("Test 29: usa a convenção de posto inferior — índice floor(p × (n − 1))", () => {
    // 10 valores: floor(0,95 × 9) = 8 → o nono em ordem crescente, que é 90.
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(quantilEmpirico(v, 0.95)).toBe(90);
    // floor(0,90 × 9) = 8 → também 90; floor(0,5 × 9) = 4 → 50.
    expect(quantilEmpirico(v, 0.9)).toBe(90);
    expect(quantilEmpirico(v, 0.5)).toBe(50);
  });

  it("Test 30: ordena antes de escolher — a ordem de entrada não muda o resultado", () => {
    expect(quantilEmpirico([100, 10, 50], 0.5)).toBe(50);
    expect(quantilEmpirico([50, 100, 10], 0.5)).toBe(50);
  });

  it("Test 31: valores nulos e não finitos são descartados antes de ordenar", () => {
    const v = [10, null, 30, undefined, NaN, 20, Infinity] as unknown as number[];
    expect(quantilEmpirico(v, 1)).toBe(30);
    expect(quantilEmpirico(v, 0)).toBe(10);
    // Só sobraram 3 valores: o mediano é o do meio.
    expect(quantilEmpirico(v, 0.5)).toBe(20);
  });

  it("Test 32: lista de um elemento devolve esse elemento para qualquer p", () => {
    expect(quantilEmpirico([42], 0)).toBe(42);
    expect(quantilEmpirico([42], 0.5)).toBe(42);
    expect(quantilEmpirico([42], 0.95)).toBe(42);
    expect(quantilEmpirico([42], 1)).toBe(42);
  });
});

describe("bandaPorFaixa — o SINAL do pior caso", () => {
  it("Test 33: o pior caso é o quantil SUPERIOR — o inferior daria sinal oposto", () => {
    // Distribuição assimétrica: 40 observações, 36 negativas (a agenda
    // prometeu MENOS do que entrou — o cenário bom) e 4 muito positivas
    // (a agenda prometeu e não entrou — o cenário ruim).
    const erros = [...Array(36).fill(-500), 8000, 9000, 10000, 11000];
    const bandas = bandaPorFaixa(pares(1, erros), ENTRADAS);
    const b = bandaDe(bandas, 1);

    expect(b.n).toBe(40);
    // Superior: positivo, e é ele que sai como pior caso.
    expect(b.erroNoPiorCaso).toBeGreaterThan(0);
    // Inferior seria negativo — sinal OPOSTO. Se algum dia esta linha
    // quebrar porque o pior caso ficou negativo aqui, o quantil foi trocado.
    expect(quantilEmpirico(erros, 0.05)).toBeLessThan(0);
    // Mediano continua no lado negativo, provando que a distribuição é
    // assimétrica de verdade e o teste não é trivial.
    expect(b.erroMediano).toBeLessThan(0);
  });

  it("Test 34: n ≥ 40 aplica o percentil 95 e a banda não é provisória", () => {
    const erros = Array.from({ length: 40 }, (_, i) => i * 100); // 0..3900
    const b = bandaDe(bandaPorFaixa(pares(2, erros), ENTRADAS), 2);
    expect(b.n).toBe(40);
    expect(b.regua).toBe("p95");
    expect(b.quantilAplicado).toBeCloseTo(0.95, 10);
    expect(b.provisorio).toBe(false);
    // floor(0,95 × 39) = 37 → o 38º em ordem crescente = 3700.
    expect(b.erroNoPiorCaso).toBe(3700);
  });

  it("Test 35: n entre 20 e 39 cai para o percentil 90, e segue não provisória", () => {
    const erros = Array.from({ length: 20 }, (_, i) => i * 100); // 0..1900
    const b = bandaDe(bandaPorFaixa(pares(2, erros), ENTRADAS), 2);
    expect(b.n).toBe(20);
    expect(b.regua).toBe("p90");
    expect(b.quantilAplicado).toBeCloseTo(0.9, 10);
    expect(b.provisorio).toBe(false);
    // floor(0,90 × 19) = 17 → 1700.
    expect(b.erroNoPiorCaso).toBe(1700);
  });

  it("Test 36: n abaixo de 20 cai para o MÁXIMO observado e a banda sai PROVISÓRIA", () => {
    const erros = [100, 900, 400, 250];
    const b = bandaDe(bandaPorFaixa(pares(2, erros), ENTRADAS), 2);
    expect(b.n).toBe(4);
    expect(b.regua).toBe("maximo");
    expect(b.erroNoPiorCaso).toBe(900);
    expect(b.provisorio).toBe(true);
  });

  it("Test 37: n igual a zero devolve todos os números nulos e provisório verdadeiro", () => {
    const b = bandaDe(bandaPorFaixa([], ENTRADAS), 1);
    expect(b.n).toBe(0);
    expect(b.erroNoPiorCaso).toBeNull();
    expect(b.erroMediano).toBeNull();
    expect(b.quantilAplicado).toBeNull();
    expect(b.provisorio).toBe(true);
  });

  it("Test 38: faixa sem nenhuma observação continua na lista com números nulos — não some", () => {
    // Só a primeira faixa tem observação. As outras três continuam lá.
    const bandas = bandaPorFaixa(pares(1, [10, 20, 30]), ENTRADAS);
    expect(bandas).toHaveLength(FAIXAS_DE_HORIZONTE.length);
    expect(bandas).toHaveLength(4);
    expect(bandaDe(bandas, 1).n).toBe(3);
    for (const h of [4, 7, 12]) {
      expect(bandaDe(bandas, h).n).toBe(0);
      expect(bandaDe(bandas, h).erroNoPiorCaso).toBeNull();
    }
  });

  it("Test 39: linhas com erro nulo são descartadas e NÃO contam para o n", () => {
    const b = bandaDe(bandaPorFaixa(pares(1, [100, null, 200, null]), ENTRADAS), 1);
    expect(b.n).toBe(2);
    expect(b.erroNoPiorCaso).toBe(200);
  });

  it("Test 40: agrega os horizontes de dentro da faixa — D+1, D+2 e D+3 entram na mesma", () => {
    const linhas = [
      ...pares(1, [100, 200]),
      ...pares(2, [300, 400]),
      ...pares(3, [500, 600]),
    ];
    const b = bandaDe(bandaPorFaixa(linhas, ENTRADAS), 2);
    expect(b.n).toBe(6);
    expect(b.erroNoPiorCaso).toBe(600);
  });
});

describe("bandaPorFaixa — os filtros que, errados, medem outra coisa", () => {
  it("Test 41: só a agregação ACUMULADA entra — o diário mede outra pergunta", () => {
    expect(AGREGACAO_DA_BANDA).toBe("acumulado");
    const linhas = [
      ...pares(1, [100, 200]),
      ...pares(1, [90000], { agregacao: "diario" }),
    ];
    const b = bandaDe(bandaPorFaixa(linhas, ENTRADAS), 1);
    expect(b.n).toBe(2);
    expect(b.erroNoPiorCaso).toBe(200);
  });

  it("Test 42: entradas corrigidas e não corrigidas NÃO se misturam", () => {
    const linhas = [
      ...pares(1, [100, 200]),
      ...pares(1, [90000], { corrigido: false }),
    ];
    expect(bandaDe(bandaPorFaixa(linhas, ENTRADAS), 1).n).toBe(2);
    expect(bandaDe(bandaPorFaixa(linhas, { escopo: "entradas", corrigido: false }), 1).n).toBe(1);
  });

  it("Test 43: o escopo saídas casa com corrigido NULO — filtrar por verdadeiro elide as saídas inteiras", () => {
    const linhas = [
      ...pares(1, [100, 200], { escopo: "saidas", corrigido: null }),
      ...pares(1, [90000]),
    ];
    const b = bandaDe(bandaPorFaixa(linhas, SAIDAS), 1);
    expect(b.n).toBe(2);
    expect(b.erroNoPiorCaso).toBe(200);
    // E o inverso: pedir saídas corrigidas devolve faixa vazia, não as saídas.
    expect(bandaDe(bandaPorFaixa(linhas, { escopo: "saidas", corrigido: true }), 1).n).toBe(0);
  });

  it("Test 44: entrada nula, indefinida ou não-lista devolve as quatro faixas vazias, sem lançar", () => {
    for (const entrada of [null, undefined, {} as unknown]) {
      const bandas = bandaPorFaixa(entrada as ErroBacktestRow[], ENTRADAS);
      expect(bandas).toHaveLength(4);
      expect(bandas.every((b) => b.n === 0 && b.erroNoPiorCaso === null)).toBe(true);
    }
  });

  it("Test 45: horizonte fora de D+1 a D+15 não entra em faixa nenhuma", () => {
    const linhas = [...pares(1, [100]), ...pares(0, [50000]), ...pares(16, [70000])];
    const bandas = bandaPorFaixa(linhas, ENTRADAS);
    expect(bandas.reduce((soma, b) => soma + b.n, 0)).toBe(1);
  });
});

describe("bandaDoSaldo — o erro do saldo é o das entradas MENOS o das saídas", () => {
  it("Test 46: casa entradas e saídas pelo par (corte, horizonte) e subtrai", () => {
    const linhas = [
      par(1, 1000, { corte: "2026-07-01" }),
      par(1, 300, { corte: "2026-07-01", escopo: "saidas", corrigido: null }),
      par(1, 500, { corte: "2026-07-02" }),
      par(1, -100, { corte: "2026-07-02", escopo: "saidas", corrigido: null }),
    ];
    const b = bandaDe(bandaDoSaldo(linhas), 1);
    expect(b.n).toBe(2);
    // 1000 − 300 = 700 e 500 − (−100) = 600. O pior caso é o maior.
    expect(b.erroNoPiorCaso).toBe(700);
  });

  it("Test 47: par sem o lado das saídas é DESCARTADO — não vira saldo com saída zero", () => {
    const linhas = [
      par(1, 1000, { corte: "2026-07-01" }),
      par(1, 900, { corte: "2026-07-02" }),
      par(1, 300, { corte: "2026-07-02", escopo: "saidas", corrigido: null }),
    ];
    const b = bandaDe(bandaDoSaldo(linhas), 1);
    expect(b.n).toBe(1);
    expect(b.erroNoPiorCaso).toBe(600);
  });

  it("Test 48: usa a entrada CORRIGIDA — a bruta não entra no saldo", () => {
    const linhas = [
      par(1, 1000, { corte: "2026-07-01" }),
      par(1, 50000, { corte: "2026-07-01", corrigido: false }),
      par(1, 300, { corte: "2026-07-01", escopo: "saidas", corrigido: null }),
    ];
    const b = bandaDe(bandaDoSaldo(linhas), 1);
    expect(b.n).toBe(1);
    expect(b.erroNoPiorCaso).toBe(700);
  });
});

describe("saldoNoPiorCaso", () => {
  it("Test 49: subtrai o erro do pior caso do saldo projetado", () => {
    const banda: BandaDaFaixa = {
      faixa: FAIXAS_DE_HORIZONTE[0],
      n: 40,
      erroNoPiorCaso: 11_000,
      erroMediano: 2_000,
      regua: "p95",
      quantilAplicado: 0.95,
      provisorio: false,
    };
    expect(saldoNoPiorCaso(4_200, banda)).toBe(-6_800);
  });

  it("Test 50: banda nula, ou com pior caso nulo, devolve NULO — jamais o saldo projetado", () => {
    const semMedida: BandaDaFaixa = {
      faixa: FAIXAS_DE_HORIZONTE[0],
      n: 0,
      erroNoPiorCaso: null,
      erroMediano: null,
      regua: "maximo",
      quantilAplicado: null,
      provisorio: true,
    };
    expect(saldoNoPiorCaso(4_200, null)).toBeNull();
    expect(saldoNoPiorCaso(4_200, undefined as unknown as BandaDaFaixa)).toBeNull();
    expect(saldoNoPiorCaso(4_200, semMedida)).toBeNull();
  });

  it("Test 51: saldo projetado nulo devolve nulo", () => {
    const banda: BandaDaFaixa = {
      faixa: FAIXAS_DE_HORIZONTE[0],
      n: 40,
      erroNoPiorCaso: 11_000,
      erroMediano: 2_000,
      regua: "p95",
      quantilAplicado: 0.95,
      provisorio: false,
    };
    expect(saldoNoPiorCaso(null, banda)).toBeNull();
    expect(saldoNoPiorCaso(undefined as unknown as number, banda)).toBeNull();
    // Zero é MEDIDO e igual a zero — não é ausência.
    expect(saldoNoPiorCaso(0, banda)).toBe(-11_000);
  });

  it("Test 52: erro do pior caso NEGATIVO aumenta o saldo — o cenário bom não é censurado", () => {
    const banda: BandaDaFaixa = {
      faixa: FAIXAS_DE_HORIZONTE[0],
      n: 40,
      erroNoPiorCaso: -1_000,
      erroMediano: -2_000,
      regua: "p95",
      quantilAplicado: 0.95,
      provisorio: false,
    };
    expect(saldoNoPiorCaso(4_200, banda)).toBe(5_200);
  });
});

describe("faixaDoHorizonte e FAIXAS_DE_HORIZONTE", () => {
  it("Test 53: as quatro faixas cobrem D+1 a D+15 sem buraco e sem sobreposição", () => {
    expect(FAIXAS_DE_HORIZONTE.map((f) => [f.inicio, f.fim])).toEqual([
      [1, 3],
      [4, 6],
      [7, 9],
      [10, 15],
    ]);
    for (let h = 1; h <= 15; h++) {
      const achadas = FAIXAS_DE_HORIZONTE.filter((f) => h >= f.inicio && h <= f.fim);
      expect(achadas).toHaveLength(1);
    }
  });

  it("Test 54: devolve a faixa que contém o horizonte", () => {
    expect(faixaDoHorizonte(1)).toBe(FAIXAS_DE_HORIZONTE[0]);
    expect(faixaDoHorizonte(3)).toBe(FAIXAS_DE_HORIZONTE[0]);
    expect(faixaDoHorizonte(4)).toBe(FAIXAS_DE_HORIZONTE[1]);
    expect(faixaDoHorizonte(9)).toBe(FAIXAS_DE_HORIZONTE[2]);
    expect(faixaDoHorizonte(15)).toBe(FAIXAS_DE_HORIZONTE[3]);
  });

  it("Test 55: fora de D+1 a D+15 devolve nulo — inclusive hoje (D+0) e valor inválido", () => {
    expect(faixaDoHorizonte(0)).toBeNull();
    expect(faixaDoHorizonte(16)).toBeNull();
    expect(faixaDoHorizonte(-1)).toBeNull();
    expect(faixaDoHorizonte(1.5)).toBeNull();
    expect(faixaDoHorizonte(null as unknown as number)).toBeNull();
    expect(faixaDoHorizonte(NaN)).toBeNull();
  });
});
