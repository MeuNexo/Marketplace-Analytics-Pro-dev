// ============================================================================
// frasePrevisao — testes (Fase 230 Plano 02, Task 1 · CX-05)
//
// A régua que reduz a curva de erro a UMA frase. Os pontos são montados à mão
// de propósito: nenhum teste aqui depende de rede, de fixture do banco ou da
// forma das RPCs do backtest.
// ============================================================================

import { describe, it, expect } from "vitest";
import { resolveFrasePrevisao } from "./frasePrevisao";
import { N_MINIMO_PARA_PUBLICAR, type PontoDaCurva } from "./forecastErrorCurve";

/** Ponto de curva mínimo — só o que a régua da frase lê. */
function ponto(horizonte: number, fator: number | null, n: number): PontoDaCurva {
  return {
    horizonte,
    n,
    wape: null,
    fator,
    meDiario: null,
    mae: null,
    trackingSignal: null,
    provisorio: n < N_MINIMO_PARA_PUBLICAR,
  };
}

const HORIZONTE = 9;

function resolver(curvaEntradas: PontoDaCurva[]) {
  return resolveFrasePrevisao({
    curvaEntradas,
    horizonteLimite: HORIZONTE,
    nMinimo: N_MINIMO_PARA_PUBLICAR,
  });
}

describe("resolveFrasePrevisao — o caso medido", () => {
  // O número real da PV em 21/08: fator 1,1190 em D+9 com n = 54
  // (224-CURVA.md, C-01, variante corrigida do escopo `entradas`).
  const medido = resolver([ponto(1, 1.3258, 62), ponto(HORIZONTE, 1.119, 54)]);

  it("devolve estado medido, o horizonte limite e o n que o sustenta", () => {
    expect(medido.estado).toBe("medido");
    expect(medido.horizonte).toBe(HORIZONTE);
    expect(medido.n).toBe(54);
  });

  it("converte o fator em pontos percentuais de viés", () => {
    expect(medido.viesPct).toBeCloseTo(11.9, 5);
  });

  it("escreve o dia limite e o percentual arredondado na frase", () => {
    expect(medido.texto).toContain("9");
    expect(medido.texto).toContain("12%");
  });

  it("diz que a previsão promete MAIS do que entra", () => {
    expect(medido.texto).toMatch(/a mais/);
    expect(medido.texto).not.toMatch(/a menos/);
  });

  it("qualifica o escopo: a frase fala de ENTRADAS, e diz a palavra", () => {
    // Somar entradas e saídas num número único de saldo produz um valor
    // aparentemente quase certo que está errado dos dois lados
    // (224-CURVA.md, resposta 3). Sem a palavra, a frase seria esse número.
    expect(medido.texto.toLowerCase()).toContain("entrada");
  });

  it("carrega no título o n, o caráter provisório e o sentido do viés", () => {
    expect(medido.titulo).toContain("54");
    expect(medido.titulo.toLowerCase()).toContain("provisó");
    expect(medido.titulo.toLowerCase()).toContain("subestima");
  });
});

describe("resolveFrasePrevisao — o sinal do viés", () => {
  it("fator menor que 1 inverte a frase para 'a menos'", () => {
    const r = resolver([ponto(HORIZONTE, 0.7328, 53)]);
    expect(r.estado).toBe("medido");
    expect(r.viesPct).toBeCloseTo(-26.72, 5);
    expect(r.texto).toMatch(/a menos/);
    expect(r.texto).not.toMatch(/a mais/);
    expect(r.texto).toContain("27%");
  });

  it("o sinal vem do fator, não do arredondamento: 0,998 continua sendo 'a menos'", () => {
    const r = resolver([ponto(HORIZONTE, 0.998, 40)]);
    expect(r.estado).toBe("medido");
    expect(r.texto).toMatch(/a menos/);
    expect(r.texto).not.toMatch(/a mais/);
    // Arredondar para 0% e chamar de "sem viés" seria trocar o sinal por zero.
    expect(r.texto).not.toMatch(/0%/);
    expect(r.texto.toLowerCase()).toContain("menos de 1%");
  });

  it("o sinal vem do fator, não do arredondamento: 1,002 continua sendo 'a mais'", () => {
    const r = resolver([ponto(HORIZONTE, 1.002, 40)]);
    expect(r.texto).toMatch(/a mais/);
    expect(r.texto).not.toMatch(/a menos/);
    expect(r.texto.toLowerCase()).toContain("menos de 1%");
  });

  it("fator exatamente 1 é 'sem viés sistemático medido', nunca 'erro zero'", () => {
    const r = resolver([ponto(HORIZONTE, 1, 50)]);
    expect(r.estado).toBe("medido");
    expect(r.viesPct).toBe(0);
    // O viés é razão de somas: ele não mede dispersão. Dizer "erro zero"
    // afirmaria muito mais do que a medição sustenta.
    expect(r.texto).not.toMatch(/erro zero/i);
    expect(r.texto.toLowerCase()).toContain("viés");
    expect(r.texto).not.toMatch(/a mais/);
    expect(r.texto).not.toMatch(/a menos/);
  });
});

describe("resolveFrasePrevisao — ausência sempre nomeada", () => {
  it("horizonte limite ausente da curva devolve nao_medido, sem percentual", () => {
    const r = resolver([ponto(1, 1.3258, 62), ponto(5, 1.2909, 58)]);
    expect(r.estado).toBe("nao_medido");
    expect(r.viesPct).toBeNull();
    expect(r.texto).not.toMatch(/%/);
    expect(r.texto.length).toBeGreaterThan(0);
  });

  it("ponto presente com fator nulo devolve nao_medido, nunca 0%", () => {
    const r = resolver([ponto(HORIZONTE, null, 54)]);
    expect(r.estado).toBe("nao_medido");
    expect(r.viesPct).toBeNull();
    expect(r.texto).not.toMatch(/0%/);
  });

  it("curva vazia devolve nao_medido sem lançar", () => {
    expect(() => resolver([])).not.toThrow();
    expect(resolver([]).estado).toBe("nao_medido");
  });

  it("curva nula ou entrada nula devolvem nao_medido sem lançar", () => {
    expect(resolver(null as unknown as PontoDaCurva[]).estado).toBe("nao_medido");
    expect(resolveFrasePrevisao(null as unknown as Parameters<typeof resolveFrasePrevisao>[0]).estado).toBe(
      "nao_medido",
    );
  });

  it("todo estado de ausência nomeia o motivo no texto e no título", () => {
    for (const curva of [[], [ponto(HORIZONTE, null, 54)], [ponto(1, 1.3, 62)]]) {
      const r = resolver(curva);
      expect(r.estado).toBe("nao_medido");
      expect(r.texto.trim().length).toBeGreaterThan(10);
      expect(r.titulo.trim().length).toBeGreaterThan(10);
      expect(r.texto).not.toMatch(/não sei/i);
    }
  });
});

describe("resolveFrasePrevisao — amostra pequena", () => {
  const provisorio = resolver([ponto(HORIZONTE, 1.119, N_MINIMO_PARA_PUBLICAR - 1)]);

  it("n abaixo do mínimo devolve estado provisorio, com o número ainda publicado", () => {
    expect(provisorio.estado).toBe("provisorio");
    expect(provisorio.viesPct).toBeCloseTo(11.9, 5);
    expect(provisorio.n).toBe(N_MINIMO_PARA_PUBLICAR - 1);
  });

  it("a frase declara que a amostra é pequena", () => {
    expect(provisorio.texto.toLowerCase()).toContain("amostra");
    expect(provisorio.titulo).toContain(String(N_MINIMO_PARA_PUBLICAR));
  });

  it("n exatamente no mínimo já é medido", () => {
    const r = resolver([ponto(HORIZONTE, 1.119, N_MINIMO_PARA_PUBLICAR)]);
    expect(r.estado).toBe("medido");
  });
});
