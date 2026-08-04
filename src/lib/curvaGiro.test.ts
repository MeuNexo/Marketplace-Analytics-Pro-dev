// ============================================================================
// curvaGiro.test.ts — Fase 213, Plano 08, Task 2 (RE-04)
//
// Prova de que a curva de `/estoque` classifica GIRO — unidades por dia — e não
// receita. O teste central é o par de itens com a MESMA receita e giros
// diferentes: numa curva de receita eles empatariam; numa curva de giro eles
// recebem classes diferentes. É esse teste que impede que os dois módulos
// voltem a ser o mesmo relatório com dois nomes.
//
// Os demais provam: item sem giro nunca é prioridade máxima, giro total zero
// não divide por zero nem promove ninguém, o empate é determinístico e o
// conjunto vazio devolve resumo com zeros.
// ============================================================================

import { describe, it, expect } from "vitest";
import { classificarCurvaGiro, type EntradaCurvaGiro } from "./curvaGiro";

describe("classificarCurvaGiro", () => {
  it("Test 1: ordena por unidades por dia decrescente e classifica por concentração de giro", () => {
    const r = classificarCurvaGiro([
      { id: "MLB1", unidadesPorDia: 80 },
      { id: "MLB2", unidadesPorDia: 15 },
      { id: "MLB3", unidadesPorDia: 5 },
    ]);

    expect(r.itens.map((i) => i.id)).toEqual(["MLB1", "MLB2", "MLB3"]);
    expect(r.itens.map((i) => i.prioridade)).toEqual(["A", "B", "C"]);
    expect(r.itens.map((i) => i.rank)).toEqual([1, 2, 3]);
    expect(r.itens[0].pct).toBeCloseTo(80, 6);
    expect(r.itens[1].pct).toBeCloseTo(15, 6);
    expect(r.itens[2].pct).toBeCloseTo(5, 6);
  });

  it("Test 2: a ordem recebida não influencia a classificação", () => {
    const r = classificarCurvaGiro([
      { id: "devagar", unidadesPorDia: 5 },
      { id: "rapido", unidadesPorDia: 80 },
      { id: "medio", unidadesPorDia: 15 },
    ]);

    expect(r.itens.map((i) => i.id)).toEqual(["rapido", "medio", "devagar"]);
    expect(r.itens.map((i) => i.rank)).toEqual([1, 2, 3]);
  });

  it("Test 3: é o GIRO que decide, não a receita — dois itens de mesma receita e giros diferentes recebem classes diferentes", () => {
    // Este é o teste que distingue `curvaGiro` de `curvaAbc`.
    //
    // Item "gira" — 90 unidades/dia a R$ 1,00 → receita 90/dia.
    // Item "parado" — 1 unidade/dia a R$ 90,00 → receita 90/dia, a MESMA.
    //
    // Numa curva de receita os dois empatam e o desempate é arbitrário. Numa
    // curva de giro, "gira" é prioridade máxima de reposição e "parado" não é:
    // repor primeiro o que sai da prateleira é a decisão de quem compra.
    const gira = { id: "gira", unidadesPorDia: 90, precoUnitario: 1 };
    const parado = { id: "parado", unidadesPorDia: 1, precoUnitario: 90 };
    const outro = { id: "outro", unidadesPorDia: 9, precoUnitario: 10 };

    expect(gira.unidadesPorDia * gira.precoUnitario).toBe(
      parado.unidadesPorDia * parado.precoUnitario,
    );

    const r = classificarCurvaGiro([parado, gira, outro]);
    const porId = new Map(r.itens.map((i) => [i.id, i]));

    expect(porId.get("gira")!.prioridade).toBe("A");
    expect(porId.get("parado")!.prioridade).not.toBe("A");
    expect(porId.get("gira")!.prioridade).not.toBe(porId.get("parado")!.prioridade);
  });

  it("Test 4: item sem giro nenhum nunca cai na classe de maior prioridade, mesmo sendo o único item", () => {
    const r = classificarCurvaGiro([{ id: "encalhe", unidadesPorDia: 0 }]);

    expect(r.itens).toHaveLength(1);
    expect(r.itens[0].prioridade).toBe("C");
    expect(r.itens[0].pct).toBe(0);
    expect(r.resumo.A.count).toBe(0);
    expect(r.resumo.C.count).toBe(1);
  });

  it("Test 5: o item de maior giro é prioridade A mesmo quando responde sozinho por todo o giro", () => {
    const r = classificarCurvaGiro([
      { id: "unico", unidadesPorDia: 12 },
      { id: "zerado", unidadesPorDia: 0 },
    ]);

    expect(r.itens[0].id).toBe("unico");
    expect(r.itens[0].prioridade).toBe("A");
    expect(r.itens[1].prioridade).toBe("C");
  });

  it("Test 6: giro total zero não divide por zero e não promove ninguém", () => {
    const r = classificarCurvaGiro([
      { id: "a", unidadesPorDia: 0 },
      { id: "b", unidadesPorDia: 0 },
      { id: "c", unidadesPorDia: 0 },
    ]);

    for (const item of r.itens) {
      expect(Number.isNaN(item.pct)).toBe(false);
      expect(Number.isNaN(item.cumPct)).toBe(false);
      expect(item.pct).toBe(0);
      expect(item.cumPct).toBe(0);
      expect(item.prioridade).toBe("C");
    }
    expect(r.resumo.A.count).toBe(0);
    expect(r.resumo.B.count).toBe(0);
    expect(r.resumo.C.count).toBe(3);
    expect(r.resumo.giroTotal).toBe(0);
  });

  it("Test 7: empate de giro é desempatado pelo identificador — a mesma carteira produz sempre a mesma curva", () => {
    const entrada: EntradaCurvaGiro[] = [
      { id: "zz", unidadesPorDia: 10 },
      { id: "aa", unidadesPorDia: 10 },
      { id: "mm", unidadesPorDia: 10 },
    ];

    const primeira = classificarCurvaGiro(entrada);
    const segunda = classificarCurvaGiro([...entrada].reverse());

    expect(primeira.itens.map((i) => i.id)).toEqual(["aa", "mm", "zz"]);
    expect(segunda.itens.map((i) => i.id)).toEqual(["aa", "mm", "zz"]);
    expect(segunda.itens.map((i) => i.prioridade)).toEqual(
      primeira.itens.map((i) => i.prioridade),
    );
  });

  it("Test 8: conjunto vazio devolve lista vazia e resumo com zeros", () => {
    const r = classificarCurvaGiro([]);

    expect(r.itens).toEqual([]);
    expect(r.resumo.total).toBe(0);
    expect(r.resumo.giroTotal).toBe(0);
    expect(r.resumo.A).toEqual({ count: 0, giro: 0, pct: 0 });
    expect(r.resumo.B).toEqual({ count: 0, giro: 0, pct: 0 });
    expect(r.resumo.C).toEqual({ count: 0, giro: 0, pct: 0 });
  });

  it("Test 9: o acumulado da última posição com giro é exatamente cem por cento", () => {
    const r = classificarCurvaGiro([
      { id: "a", unidadesPorDia: 3.33 },
      { id: "b", unidadesPorDia: 2.11 },
      { id: "c", unidadesPorDia: 1.07 },
      { id: "d", unidadesPorDia: 0.91 },
      { id: "e", unidadesPorDia: 0.03 },
    ]);

    expect(r.itens[r.itens.length - 1].cumPct).toBe(100);
  });

  it("Test 10: giro não finito ou negativo é ruído de fonte e vira zero, sem contaminar o total", () => {
    const r = classificarCurvaGiro([
      { id: "bom", unidadesPorDia: 10 },
      { id: "negativo", unidadesPorDia: -5 },
      { id: "nan", unidadesPorDia: Number.NaN },
    ]);

    expect(r.resumo.giroTotal).toBe(10);
    const porId = new Map(r.itens.map((i) => [i.id, i]));
    expect(porId.get("negativo")!.prioridade).toBe("C");
    expect(porId.get("nan")!.prioridade).toBe("C");
    expect(porId.get("bom")!.prioridade).toBe("A");
    expect(Number.isNaN(porId.get("nan")!.pct)).toBe(false);
  });

  it("Test 11: o resumo soma o giro de cada classe e as três participações fecham em cem", () => {
    const r = classificarCurvaGiro([
      { id: "a", unidadesPorDia: 60 },
      { id: "b", unidadesPorDia: 20 },
      { id: "c", unidadesPorDia: 14 },
      { id: "d", unidadesPorDia: 6 },
    ]);

    expect(r.resumo.total).toBe(4);
    expect(r.resumo.giroTotal).toBeCloseTo(100, 6);
    expect(r.resumo.A.count + r.resumo.B.count + r.resumo.C.count).toBe(4);
    expect(r.resumo.A.giro + r.resumo.B.giro + r.resumo.C.giro).toBeCloseTo(100, 6);
    expect(r.resumo.A.pct + r.resumo.B.pct + r.resumo.C.pct).toBeCloseTo(100, 6);
  });

  it("Test 12: campos extras do chamador sobrevivem à classificação", () => {
    const r = classificarCurvaGiro([
      { id: "MLB1", unidadesPorDia: 4, titulo: "Bota", estoque: 12 },
      { id: "MLB2", unidadesPorDia: 1, titulo: "Chapéu", estoque: 3 },
    ]);

    expect(r.itens[0].titulo).toBe("Bota");
    expect(r.itens[0].estoque).toBe(12);
    expect(r.itens[1].titulo).toBe("Chapéu");
  });
});
