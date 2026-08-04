/**
 * Testes de `custoFaltante` — Fase 213, Plano 05, Task 1 (AV-03).
 *
 * A régua sob teste: contar quantos anúncios do conjunto EXIBIDO estão sem CMV,
 * e decidir quando o aviso agregado é obrigatório. Sem limiar mágico — o
 * critério é a existência de ao menos um faltante.
 */

import { describe, it, expect } from "vitest";
import {
  contarSemCusto,
  avisoCustoObrigatorio,
  avaliarConfiabilidadeMargem,
  LIMIAR_CUSTO_FALTANTE_PCT,
  type LinhaCusto,
} from "./custoFaltante";

/** n linhas, das quais `semCusto` primeiras não têm custo. */
function linhas(total: number, semCusto: number): LinhaCusto[] {
  return Array.from({ length: total }, (_, i) => ({ temCusto: i >= semCusto }));
}

describe("contarSemCusto", () => {
  it("com dez anúncios e três sem custo devolve três de dez e trinta por cento", () => {
    const c = contarSemCusto(linhas(10, 3));
    expect(c.semCusto).toBe(3);
    expect(c.total).toBe(10);
    expect(c.pctSemCusto).toBe(30);
    expect(c.todosSemCusto).toBe(false);
  });

  it("conjunto vazio devolve zero de zero e percentual indefinido — nunca cem por divisão vazia", () => {
    const c = contarSemCusto([]);
    expect(c.semCusto).toBe(0);
    expect(c.total).toBe(0);
    expect(c.pctSemCusto).toBeNull();
    expect(c.todosSemCusto).toBe(false);
  });

  it("todos com custo devolve zero faltantes e o aviso não é obrigatório", () => {
    const c = contarSemCusto(linhas(7, 0));
    expect(c.semCusto).toBe(0);
    expect(c.pctSemCusto).toBe(0);
    expect(c.todosSemCusto).toBe(false);
    expect(avisoCustoObrigatorio(c)).toBe(false);
  });

  it("todos sem custo devolve o total como faltante e o aviso é obrigatório", () => {
    const c = contarSemCusto(linhas(52, 52));
    expect(c.semCusto).toBe(52);
    expect(c.total).toBe(52);
    expect(c.pctSemCusto).toBe(100);
    expect(c.todosSemCusto).toBe(true);
    expect(avisoCustoObrigatorio(c)).toBe(true);
  });

  it("percentual quebrado é arredondado a uma casa, sem esconder o faltante", () => {
    const c = contarSemCusto(linhas(3, 1));
    expect(c.pctSemCusto).toBe(33.3);
  });

  it("conjunto vazio não torna o aviso obrigatório", () => {
    expect(avisoCustoObrigatorio(contarSemCusto([]))).toBe(false);
  });
});

describe("avisoCustoObrigatorio", () => {
  it("um único anúncio sem custo em cem já torna o aviso obrigatório", () => {
    const c = contarSemCusto(linhas(100, 1));
    expect(c.semCusto).toBe(1);
    expect(c.pctSemCusto).toBe(1);
    expect(avisoCustoObrigatorio(c)).toBe(true);
  });

  it("a régua é a existência de faltante, não um limiar de percentual", () => {
    // 1 em 1000 = 0,1% — arredondado para uma casa continua > 0 e o aviso vale.
    const c = contarSemCusto(linhas(1000, 1));
    expect(avisoCustoObrigatorio(c)).toBe(true);
  });
});

// ─── avaliarConfiabilidadeMargem — Fase 213, Plano 08, Task 3 (AV-09) ───────
//
// Aqui existe limiar, e existe por um motivo diferente do aviso acima. O aviso
// responde "há dado faltando?" — e um faltante já basta. Este responde "o
// indicador AGREGADO ainda decide?" — e um agregado tolera ruído até certo
// ponto. Acima do limiar a margem média deixa de ser um número com margem de
// erro e vira propaganda: numa conta 100% sem CMV ela é positiva por construção.

describe("avaliarConfiabilidadeMargem", () => {
  it("sem nenhum faltante o indicador é confiável", () => {
    const r = avaliarConfiabilidadeMargem(0, 50);
    expect(r.confiavel).toBe(true);
    expect(r.semCusto).toBe(0);
    expect(r.pctSemCusto).toBe(0);
  });

  it("exatamente no limiar o indicador ainda é confiável — a supressão é ACIMA dele", () => {
    const r = avaliarConfiabilidadeMargem(20, 100);
    expect(r.pctSemCusto).toBe(LIMIAR_CUSTO_FALTANTE_PCT);
    expect(r.confiavel).toBe(true);
  });

  it("um ponto acima do limiar o indicador é suprimido", () => {
    const r = avaliarConfiabilidadeMargem(21, 100);
    expect(r.pctSemCusto).toBe(21);
    expect(r.confiavel).toBe(false);
  });

  it("conta 100% sem custo — o caso real da organização Thales — nunca exibe margem", () => {
    const r = avaliarConfiabilidadeMargem(437, 437);
    expect(r.pctSemCusto).toBe(100);
    expect(r.confiavel).toBe(false);
    expect(r.semCusto).toBe(437);
  });

  it("conjunto vazio não é confiável e não devolve percentual — não há o que afirmar", () => {
    const r = avaliarConfiabilidadeMargem(0, 0);
    expect(r.confiavel).toBe(false);
    expect(r.pctSemCusto).toBeNull();
  });

  it("o limiar viaja no resultado, para a tela poder explicar a supressão", () => {
    const r = avaliarConfiabilidadeMargem(50, 100);
    expect(r.limiarPct).toBe(LIMIAR_CUSTO_FALTANTE_PCT);
    expect(r.total).toBe(100);
  });

  it("o limiar é vinte por cento — mudá-lo é uma decisão consciente, num só lugar", () => {
    expect(LIMIAR_CUSTO_FALTANTE_PCT).toBe(20);
  });

  it("entrada inválida não produz NaN nem confiabilidade acidental", () => {
    const negativo = avaliarConfiabilidadeMargem(-3, 10);
    expect(negativo.semCusto).toBe(0);
    expect(negativo.confiavel).toBe(true);

    const maiorQueTotal = avaliarConfiabilidadeMargem(30, 10);
    expect(maiorQueTotal.semCusto).toBe(10);
    expect(maiorQueTotal.pctSemCusto).toBe(100);
    expect(maiorQueTotal.confiavel).toBe(false);

    const nan = avaliarConfiabilidadeMargem(Number.NaN, Number.NaN);
    expect(nan.confiavel).toBe(false);
    expect(nan.pctSemCusto).toBeNull();
  });

  it("aceita também a contagem já pronta de contarSemCusto", () => {
    const c = contarSemCusto(linhas(10, 5));
    const r = avaliarConfiabilidadeMargem(c.semCusto, c.total);
    expect(r.pctSemCusto).toBe(50);
    expect(r.confiavel).toBe(false);
  });
});
