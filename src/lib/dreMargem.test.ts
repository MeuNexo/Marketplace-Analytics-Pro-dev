import { describe, it, expect } from "vitest";
import { computeMargemContribuicao } from "./dreMargem";

// Fixture reconciliada de maio/2026 (96-CONTEXT.md §2 e §3 [C1]).
const MAIO_CORRIGIDO = {
  receitaBruta: 261666.41,
  cancelamentosVendas: 14450.29,
  totalTarifas: 63878.37,
  cmvMes: 126574.59,
  impostosMes: 4793.23,
};

describe("computeMargemContribuicao", () => {
  it("Test 1 — a ARMADILHA: o cancelamento está DENTRO da fórmula (maio corrigido = 51969.93)", () => {
    // Se alguém tirar o cancelamento da fórmula, o resultado vira 66420.22 —
    // R$14.450,29 inflados. Este teste prova que NÃO é isso que acontece.
    const result = computeMargemContribuicao(MAIO_CORRIGIDO);
    expect(result).toBe(51969.93);
    expect(result).not.toBe(66420.22);
  });

  it("Test 2 — equivalência com a expressão legada (SC5): bruta-menos-cancelamento === líquida", () => {
    const resultFromBruta = computeMargemContribuicao(MAIO_CORRIGIDO);
    const resultFromLiquida =
      247216.12 -
      MAIO_CORRIGIDO.totalTarifas -
      MAIO_CORRIGIDO.cmvMes -
      MAIO_CORRIGIDO.impostosMes;
    expect(resultFromBruta).toBe(Math.round(resultFromLiquida * 100) / 100);
  });

  it("Test 3 — maio 'se fechar hoje' (antes das correções) = 30833.05", () => {
    const result = computeMargemContribuicao({
      receitaBruta: 261666.41,
      cancelamentosVendas: 14450.29,
      totalTarifas: 75127.33,
      cmvMes: 136462.51,
      impostosMes: 4793.23,
    });
    expect(result).toBe(30833.05);
  });

  it("Test 4 — identidade que protege o swing: receitaBruta - cancelamentosVendas === 247216.12", () => {
    // O reembolso de R$386,39 soma na bruta E sai no cancelamento — a líquida
    // não se move. Se alguém adicionar o reembolso só num dos lados, este
    // teste (via a mesma fixture do Test 1) pega.
    const liquida =
      Math.round(
        (MAIO_CORRIGIDO.receitaBruta - MAIO_CORRIGIDO.cancelamentosVendas) * 100,
      ) / 100;
    expect(liquida).toBe(247216.12);
  });

  it("Test 5 — cmvMes e impostosMes null são tratados como 0", () => {
    const result = computeMargemContribuicao({
      receitaBruta: 100000,
      cancelamentosVendas: 0,
      totalTarifas: 10000,
      cmvMes: null,
      impostosMes: null,
    });
    expect(result).toBe(90000);
  });

  it("Test 6 — cancelamentosVendas: 0 não muda o resultado (mês sem cancelamento)", () => {
    const result = computeMargemContribuicao({
      receitaBruta: 100000,
      cancelamentosVendas: 0,
      totalTarifas: 10000,
      cmvMes: 20000,
      impostosMes: 5000,
    });
    expect(result).toBe(65000);
  });

  it("Test 7 — o retorno é arredondado a 2 casas", () => {
    const result = computeMargemContribuicao({
      receitaBruta: 100000.111,
      cancelamentosVendas: 1000.222,
      totalTarifas: 5000.333,
      cmvMes: 2000.444,
      impostosMes: 1000.555,
    });
    // 100000.111 - 1000.222 - 5000.333 - 2000.444 - 1000.555 = 90998.557 → round2 = 90998.56
    expect(result).toBe(90998.56);
    expect(Number.isInteger(result * 100)).toBe(true);
  });
});
