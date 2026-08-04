/**
 * Testes de `custoFaltante` — Fase 213, Plano 05, Task 1 (AV-03).
 *
 * A régua sob teste: contar quantos anúncios do conjunto EXIBIDO estão sem CMV,
 * e decidir quando o aviso agregado é obrigatório. Sem limiar mágico — o
 * critério é a existência de ao menos um faltante.
 */

import { describe, it, expect } from "vitest";
import { contarSemCusto, avisoCustoObrigatorio, type LinhaCusto } from "./custoFaltante";

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
