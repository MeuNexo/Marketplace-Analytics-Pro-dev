// ============================================================================
// impostoProvisaoErro.test.ts — Fase 224 Plano 04, Task 2 (TDD)
// Testa o módulo puro que mede o erro da provisão de imposto que o sistema
// já faz (get_dre_cash_forecast/previsao_calc), contra o realizado nas duas
// réguas que a RPC get_imposto_provisao_erro devolve (Fase 224 ERR-05).
//
// Espelho estrutural de dreCashForecast.test.ts (Phase 100): helper de row
// crua, null-safety em todos os campos, razão de somas (nunca média de
// razões) no resumo.
//
// Não há tabela de terceira régua aqui: 'caixa' e 'apuracao_m_mais_1' são as
// duas únicas opções, e a escolha é OBRIGATÓRIA (o defeito que este plano
// corrigiu era decidir a régua pelo número que ela produz).
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  construirErroDaProvisao,
  resumirErroDaProvisao,
  N_MINIMO_DE_MESES,
  type ImpostoProvisaoErroRow,
} from "./impostoProvisaoErro";

// Helper de construção de linha crua — espelho de row() em dreCashForecast.test.ts.
function row(opts: Partial<ImpostoProvisaoErroRow> & { mesVenda: string }): ImpostoProvisaoErroRow {
  return {
    mesVenda: opts.mesVenda,
    faturamento: opts.faturamento ?? 100000,
    taxaMediaPrevista: opts.taxaMediaPrevista ?? null,
    nMesesBase: opts.nMesesBase ?? 3,
    provisaoPrevista: opts.provisaoPrevista ?? null,
    guiaCaixaNoMes: opts.guiaCaixaNoMes ?? null,
    nGuiasCaixa: opts.nGuiasCaixa ?? 0,
    competenciaApuracao: opts.competenciaApuracao ?? opts.mesVenda,
    guiaApuracaoMMaisUm: opts.guiaApuracaoMMaisUm ?? null,
    nLinhasApuracao: opts.nLinhasApuracao ?? 0,
  };
}

describe("construirErroDaProvisao — régua obrigatória", () => {
  it("compila só quando a régua é passada explicitamente", () => {
    const rows: ImpostoProvisaoErroRow[] = [row({ mesVenda: "2026-01-01" })];
    // @ts-expect-error régua não tem valor padrão e não se herda: escolher
    // por omissão é exatamente o defeito que este plano corrigiu.
    construirErroDaProvisao(rows);
  });

  it("aceita 'caixa' e 'apuracao_m_mais_1' como únicas réguas válidas", () => {
    const rows: ImpostoProvisaoErroRow[] = [row({ mesVenda: "2026-01-01" })];
    expect(() => construirErroDaProvisao(rows, "caixa")).not.toThrow();
    expect(() => construirErroDaProvisao(rows, "apuracao_m_mais_1")).not.toThrow();
  });
});

describe("construirErroDaProvisao — provisão nula", () => {
  it("mês sem base suficiente (provisaoPrevista null) devolve erro nulo e não avaliável", () => {
    const rows = [
      row({ mesVenda: "2026-01-01", provisaoPrevista: null, guiaCaixaNoMes: 5000, nGuiasCaixa: 3 }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    expect(itens).toHaveLength(1);
    expect(itens[0].avaliavel).toBe(false);
    expect(itens[0].erroReais).toBeNull();
    expect(itens[0].erroPct).toBeNull();
  });
});

describe("construirErroDaProvisao — guia ausente (lacuna) x guia zero", () => {
  it("guia null (lacuna declarada pela RPC) devolve não avaliável, nunca erro de 0", () => {
    const rows = [
      row({ mesVenda: "2026-11-01", provisaoPrevista: 3000, guiaCaixaNoMes: null, nGuiasCaixa: 0 }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    expect(itens[0].avaliavel).toBe(false);
    expect(itens[0].erroReais).toBeNull();
    expect(itens[0].erroPct).toBeNull();
  });

  it("guia igual a zero na régua escolhida devolve erroPct nulo, nunca infinito", () => {
    const rows = [
      row({ mesVenda: "2026-02-01", provisaoPrevista: 500, guiaCaixaNoMes: 0, nGuiasCaixa: 2 }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    expect(itens[0].avaliavel).toBe(true);
    expect(itens[0].erroReais).toBe(500);
    expect(itens[0].erroPct).toBeNull();
    expect(Number.isFinite(itens[0].erroPct as number)).toBe(false);
  });
});

describe("construirErroDaProvisao — sinal e valor do erro em reais", () => {
  it("erroReais = provisão prevista menos guia, positivo é provisionar a mais", () => {
    const rows = [
      row({ mesVenda: "2026-03-01", provisaoPrevista: 12000, guiaCaixaNoMes: 10000, nGuiasCaixa: 3 }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    expect(itens[0].erroReais).toBe(2000);
    expect(itens[0].erroPct).toBeCloseTo(20, 5);
  });

  it("erroReais negativo quando a provisão fica abaixo do que de fato saiu", () => {
    const rows = [
      row({ mesVenda: "2026-04-01", provisaoPrevista: 8000, guiaCaixaNoMes: 10000, nGuiasCaixa: 3 }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    expect(itens[0].erroReais).toBe(-2000);
    expect(itens[0].erroPct).toBeCloseTo(-20, 5);
  });
});

describe("construirErroDaProvisao — régua de apuração carrega a competência", () => {
  it("no item da régua de apuração, competenciaApuracao vem preenchida", () => {
    const rows = [
      row({
        mesVenda: "2026-06-01",
        provisaoPrevista: 4000,
        guiaApuracaoMMaisUm: 4200,
        nLinhasApuracao: 5,
        competenciaApuracao: "2026-06-01",
      }),
    ];
    const itens = construirErroDaProvisao(rows, "apuracao_m_mais_1");
    expect(itens[0].competenciaApuracao).toBe("2026-06-01");
    expect(itens[0].erroReais).toBe(-200);
  });

  it("na régua de caixa o item também expõe competenciaApuracao vinda da linha crua (não recalcula)", () => {
    const rows = [
      row({ mesVenda: "2026-06-01", provisaoPrevista: 4000, guiaCaixaNoMes: 4200, competenciaApuracao: "2026-06-01" }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    expect(itens[0].competenciaApuracao).toBe("2026-06-01");
  });
});

describe("construirErroDaProvisao — robustez de entrada", () => {
  it("lista vazia devolve lista vazia", () => {
    expect(construirErroDaProvisao([], "caixa")).toEqual([]);
  });

  it("lista nula ou indefinida devolve lista vazia, nunca lança", () => {
    expect(construirErroDaProvisao(null as unknown as ImpostoProvisaoErroRow[], "caixa")).toEqual([]);
    expect(construirErroDaProvisao(undefined as unknown as ImpostoProvisaoErroRow[], "caixa")).toEqual([]);
  });

  it("ordena por mesVenda ascendente independente da ordem de entrada", () => {
    const rows = [
      row({ mesVenda: "2026-03-01" }),
      row({ mesVenda: "2026-01-01" }),
      row({ mesVenda: "2026-02-01" }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    expect(itens.map((i) => i.mesVenda)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });
});

describe("resumirErroDaProvisao — razão de somas, não média de razões", () => {
  it("fator é a razão da soma das provisões pela soma das guias, não a média das razões mensais", () => {
    // Mês A: provisão 100, guia 10 -> razão 10. Mês B: provisão 100, guia 1000 -> razão 0,1.
    // Média das razões = 5,05 (dominada pelo mês pequeno). Razão de somas = 200/1010 ≈ 0,198.
    const rows = [
      row({ mesVenda: "2026-01-01", provisaoPrevista: 100, guiaCaixaNoMes: 10 }),
      row({ mesVenda: "2026-02-01", provisaoPrevista: 100, guiaCaixaNoMes: 1000 }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    const resumo = resumirErroDaProvisao(itens);
    expect(resumo.fator).not.toBeCloseTo(5.05, 1);
    expect(resumo.fator).toBeCloseTo(200 / 1010, 5);
  });

  it("wape é a soma dos erros absolutos dividida pela soma das guias", () => {
    const rows = [
      row({ mesVenda: "2026-01-01", provisaoPrevista: 120, guiaCaixaNoMes: 100 }),
      row({ mesVenda: "2026-02-01", provisaoPrevista: 80, guiaCaixaNoMes: 100 }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    const resumo = resumirErroDaProvisao(itens);
    // erros abs: 20 + 20 = 40; soma guias: 200 -> wape 0,2
    expect(resumo.wape).toBeCloseTo(0.2, 5);
  });

  it("mesesAvaliaveis conta só os meses avaliáveis (provisão e guia não nulos)", () => {
    const rows = [
      row({ mesVenda: "2026-01-01", provisaoPrevista: 100, guiaCaixaNoMes: 100 }),
      row({ mesVenda: "2026-02-01", provisaoPrevista: null, guiaCaixaNoMes: 100 }),
      row({ mesVenda: "2026-03-01", provisaoPrevista: 100, guiaCaixaNoMes: null }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    const resumo = resumirErroDaProvisao(itens);
    expect(resumo.mesesAvaliaveis).toBe(1);
  });

  it("suficiente é falso quando mesesAvaliaveis é menor que N_MINIMO_DE_MESES", () => {
    expect(N_MINIMO_DE_MESES).toBe(4);
    const rows = [
      row({ mesVenda: "2026-01-01", provisaoPrevista: 100, guiaCaixaNoMes: 100 }),
      row({ mesVenda: "2026-02-01", provisaoPrevista: 100, guiaCaixaNoMes: 100 }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    const resumo = resumirErroDaProvisao(itens);
    expect(resumo.suficiente).toBe(false);
  });

  it("suficiente é verdadeiro quando mesesAvaliaveis atinge N_MINIMO_DE_MESES", () => {
    const rows = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"].map((m) =>
      row({ mesVenda: m, provisaoPrevista: 100, guiaCaixaNoMes: 100 }),
    );
    const itens = construirErroDaProvisao(rows, "caixa");
    const resumo = resumirErroDaProvisao(itens);
    expect(resumo.suficiente).toBe(true);
    expect(resumo.mesesAvaliaveis).toBe(4);
  });

  it("soma das guias igual a zero devolve fator e wape nulos", () => {
    const rows = [
      row({ mesVenda: "2026-01-01", provisaoPrevista: 100, guiaCaixaNoMes: 0 }),
      row({ mesVenda: "2026-02-01", provisaoPrevista: 200, guiaCaixaNoMes: 0 }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    const resumo = resumirErroDaProvisao(itens);
    expect(resumo.fator).toBeNull();
    expect(resumo.wape).toBeNull();
  });

  it("nenhum mês avaliável devolve tudo nulo e suficiente falso", () => {
    const rows = [
      row({ mesVenda: "2026-01-01", provisaoPrevista: null, guiaCaixaNoMes: 100 }),
    ];
    const itens = construirErroDaProvisao(rows, "caixa");
    const resumo = resumirErroDaProvisao(itens);
    expect(resumo.fator).toBeNull();
    expect(resumo.wape).toBeNull();
    expect(resumo.mesesAvaliaveis).toBe(0);
    expect(resumo.suficiente).toBe(false);
  });

  it("lista vazia não lança e devolve resumo nulo/insuficiente", () => {
    const resumo = resumirErroDaProvisao([]);
    expect(resumo.fator).toBeNull();
    expect(resumo.wape).toBeNull();
    expect(resumo.mesesAvaliaveis).toBe(0);
    expect(resumo.suficiente).toBe(false);
  });
});

describe("construirErroDaProvisao — cenário real (forma de 12 meses)", () => {
  it("12 meses com os 3 primeiros sem base suficiente e um mês sem guia não quebra a montagem", () => {
    const meses = [
      "2025-10-01", "2025-11-01", "2025-12-01",
      "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01",
      "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01",
    ];
    const rows = meses.map((m, idx) =>
      row({
        mesVenda: m,
        provisaoPrevista: idx < 3 ? null : 5000 + idx * 100,
        guiaCaixaNoMes: m === "2026-06-01" ? null : 4800 + idx * 90,
        nGuiasCaixa: m === "2026-06-01" ? 0 : 3,
      }),
    );
    const itens = construirErroDaProvisao(rows, "caixa");
    expect(itens).toHaveLength(12);
    const naoAvaliaveis = itens.filter((i) => !i.avaliavel);
    // 3 primeiros meses (sem provisão) + o mês sem guia (2026-06)
    expect(naoAvaliaveis).toHaveLength(4);
    const resumo = resumirErroDaProvisao(itens);
    expect(resumo.mesesAvaliaveis).toBe(8);
    expect(resumo.suficiente).toBe(true);
  });
});
