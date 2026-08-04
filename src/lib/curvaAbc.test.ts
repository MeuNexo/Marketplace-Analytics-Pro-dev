// ============================================================================
// curvaAbc.test.ts — Fase 213, Plano 04, Task 1 (CR-06, AV-06)
//
// Prova de que a classificação ABC é aritmética pura sobre a receita que o
// chamador entrega, e não sobre uma receita que o módulo inventa. O teste
// central é o do CR-06: um anúncio com receita vitalícia alta e receita do
// período zero sai da Curva A quando a entrada passa a ser a receita do
// período. Os demais provam os cortes de 80 e 95, o empate determinístico, o
// conjunto vazio, a receita total zero e a participação sobre o conjunto
// recebido (AV-06).
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  classificarCurvaAbc,
  calcularParticipacao,
  type EntradaCurvaAbc,
} from "./curvaAbc";

// ─── classificarCurvaAbc ───────────────────────────────────────────────────

describe("classificarCurvaAbc", () => {
  it("Test 1: receitas de 80, 15 e 5 recebem as curvas A, B e C nessa ordem", () => {
    const r = classificarCurvaAbc([
      { id: "MLB1", receita: 80 },
      { id: "MLB2", receita: 15 },
      { id: "MLB3", receita: 5 },
    ]);

    expect(r.itens.map((i) => i.id)).toEqual(["MLB1", "MLB2", "MLB3"]);
    expect(r.itens.map((i) => i.curva)).toEqual(["A", "B", "C"]);
    expect(r.itens.map((i) => i.rank)).toEqual([1, 2, 3]);
    expect(r.itens[0].pct).toBeCloseTo(80, 6);
    expect(r.itens[1].pct).toBeCloseTo(15, 6);
    expect(r.itens[2].pct).toBeCloseTo(5, 6);
  });

  it("Test 2: a entrada é ordenada por receita decrescente, não pela ordem recebida", () => {
    const r = classificarCurvaAbc([
      { id: "baixa", receita: 5 },
      { id: "alta", receita: 80 },
      { id: "media", receita: 15 },
    ]);

    expect(r.itens.map((i) => i.id)).toEqual(["alta", "media", "baixa"]);
    expect(r.itens.map((i) => i.rank)).toEqual([1, 2, 3]);
  });

  it("Test 3: o acumulado da última posição é exatamente cem por cento", () => {
    // Receitas que não fecham redondo em base 2 — o acumulado ainda tem de
    // terminar em 100 exato, nunca em 99,999999.
    const r = classificarCurvaAbc([
      { id: "a", receita: 33.33 },
      { id: "b", receita: 21.11 },
      { id: "c", receita: 17.07 },
      { id: "d", receita: 9.91 },
      { id: "e", receita: 3.03 },
    ]);

    expect(r.itens[r.itens.length - 1].cumPct).toBe(100);
    // e o acumulado é monotônico
    for (let i = 1; i < r.itens.length; i++) {
      expect(r.itens[i].cumPct).toBeGreaterThanOrEqual(r.itens[i - 1].cumPct);
    }
  });

  it("Test 4: conjunto vazio devolve lista vazia e resumo com zeros, sem divisão por zero", () => {
    const r = classificarCurvaAbc([]);

    expect(r.itens).toEqual([]);
    expect(r.resumo.total).toBe(0);
    expect(r.resumo.receitaTotal).toBe(0);
    expect(r.resumo.A).toEqual({ count: 0, revenue: 0, pct: 0 });
    expect(r.resumo.B).toEqual({ count: 0, revenue: 0, pct: 0 });
    expect(r.resumo.C).toEqual({ count: 0, revenue: 0, pct: 0 });
  });

  it("Test 5: receita total zero devolve todos na curva C, com acumulado numérico", () => {
    const r = classificarCurvaAbc([
      { id: "a", receita: 0 },
      { id: "b", receita: 0 },
      { id: "c", receita: 0 },
    ]);

    expect(r.itens.map((i) => i.curva)).toEqual(["C", "C", "C"]);
    for (const item of r.itens) {
      expect(Number.isFinite(item.pct)).toBe(true);
      expect(Number.isFinite(item.cumPct)).toBe(true);
      expect(item.pct).toBe(0);
      expect(item.cumPct).toBe(0);
    }
    expect(r.resumo.C.count).toBe(3);
    expect(Number.isFinite(r.resumo.C.pct)).toBe(true);
    expect(r.resumo.C.pct).toBe(0);
  });

  it("Test 6: empate de receita é desempatado por identificador — classificação determinística", () => {
    const entrada: EntradaCurvaAbc[] = [
      { id: "zzz", receita: 50 },
      { id: "aaa", receita: 50 },
      { id: "mmm", receita: 50 },
    ];

    const primeira = classificarCurvaAbc(entrada);
    const segunda = classificarCurvaAbc([...entrada].reverse());

    expect(primeira.itens.map((i) => i.id)).toEqual(["aaa", "mmm", "zzz"]);
    // a mesma entrada em outra ordem produz exatamente a mesma classificação
    expect(segunda.itens.map((i) => i.id)).toEqual(primeira.itens.map((i) => i.id));
    expect(segunda.itens.map((i) => i.curva)).toEqual(primeira.itens.map((i) => i.curva));
  });

  it("Test 7: item com receita zero nunca cai na curva A, mesmo quando é o único item", () => {
    const sozinho = classificarCurvaAbc([{ id: "unico", receita: 0 }]);
    expect(sozinho.itens[0].curva).toBe("C");

    // e também quando acompanha itens com receita
    const misto = classificarCurvaAbc([
      { id: "vende", receita: 100 },
      { id: "parado", receita: 0 },
    ]);
    expect(misto.itens.find((i) => i.id === "parado")?.curva).toBe("C");
    expect(misto.itens.find((i) => i.id === "vende")?.curva).toBe("A");
  });

  it("Test 7b: o item de maior receita é sempre curva A, inclusive quando sozinho responde por cem por cento", () => {
    // Caso degenerado: com o corte por acumulado INCLUSIVO, quem responde por
    // 100% da receita tem acumulado 100 e cairia na curva C.
    const unico = classificarCurvaAbc([{ id: "dominante", receita: 5000 }]);
    expect(unico.itens[0].cumPct).toBe(100);
    expect(unico.itens[0].curva).toBe("A");

    const concentrado = classificarCurvaAbc([
      { id: "dominante", receita: 9900 },
      { id: "resto", receita: 100 },
    ]);
    expect(concentrado.itens[0].curva).toBe("A");
  });

  it("Test 8: o resumo soma contagem e receita por curva e fecha em cem por cento", () => {
    const r = classificarCurvaAbc([
      { id: "a", receita: 60 },
      { id: "b", receita: 20 },
      { id: "c", receita: 15 },
      { id: "d", receita: 5 },
    ]);

    expect(r.resumo.total).toBe(4);
    expect(r.resumo.receitaTotal).toBeCloseTo(100, 6);
    const soma =
      r.resumo.A.count + r.resumo.B.count + r.resumo.C.count;
    expect(soma).toBe(4);
    expect(r.resumo.A.pct + r.resumo.B.pct + r.resumo.C.pct).toBeCloseTo(100, 6);
    expect(r.resumo.A.revenue + r.resumo.B.revenue + r.resumo.C.revenue).toBeCloseTo(100, 6);
  });

  it("Test 9: campos extras do chamador sobrevivem à classificação", () => {
    const r = classificarCurvaAbc([
      { id: "MLB1", receita: 10, title: "Bota", stock: 3 },
      { id: "MLB2", receita: 90, title: "Chapéu", stock: 0 },
    ]);

    expect(r.itens[0].title).toBe("Chapéu");
    expect(r.itens[0].stock).toBe(0);
    expect(r.itens[1].title).toBe("Bota");
  });

  it("Test 10: receita não finita ou negativa é tratada como zero, sem contaminar o total", () => {
    const r = classificarCurvaAbc([
      { id: "ok", receita: 100 },
      { id: "nan", receita: Number.NaN },
      { id: "neg", receita: -50 },
    ]);

    expect(r.resumo.receitaTotal).toBeCloseTo(100, 6);
    expect(r.itens.every((i) => Number.isFinite(i.pct) && Number.isFinite(i.cumPct))).toBe(true);
    expect(r.itens.find((i) => i.id === "nan")?.curva).toBe("C");
    expect(r.itens.find((i) => i.id === "neg")?.curva).toBe("C");
  });

  // ─── O caso medido do CR-06 ──────────────────────────────────────────────

  it("Test 11 (CR-06): anúncio com receita vitalícia alta e receita do período zero sai da Curva A", () => {
    // Carteira em miniatura. `aposentado` acumulou receita ao longo de anos e
    // não vende NADA no período escolhido. Sob a régua vitalícia ele está na
    // Curva A por mérito do acumulado — não pela guarda do primeiro colocado,
    // que aqui é outro item.
    const vitalicia = [
      { id: "topo", receita: 45_000 },
      { id: "aposentado", receita: 30_000 },
      { id: "medio", receita: 15_000 },
      { id: "cauda", receita: 7_000 },
      { id: "resto", receita: 3_000 },
    ];
    const periodo = vitalicia.map((i) =>
      i.id === "aposentado" ? { ...i, receita: 0 } : i,
    );

    const antes = classificarCurvaAbc(vitalicia);
    const depois = classificarCurvaAbc(periodo);

    expect(antes.itens.find((i) => i.id === "aposentado")?.rank).toBe(2);
    expect(antes.itens.find((i) => i.id === "aposentado")?.curva).toBe("A");
    expect(antes.resumo.A.count).toBe(2);

    // Com a receita do período, o aposentado sai da Curva A e vai para o fim
    expect(depois.itens.find((i) => i.id === "aposentado")?.curva).toBe("C");
    expect(depois.itens.find((i) => i.id === "aposentado")?.rank).toBe(5);
    // e quem realmente gira no período segue na Curva A
    expect(depois.itens.find((i) => i.id === "topo")?.curva).toBe("A");
  });
});

// ─── calcularParticipacao (AV-06) ──────────────────────────────────────────

describe("calcularParticipacao", () => {
  it("Test 12: a participação divide pela soma do conjunto recebido e fecha em cem", () => {
    const r = calcularParticipacao([
      { id: "a", receita: 25 },
      { id: "b", receita: 50 },
      { id: "c", receita: 25 },
    ]);

    expect(r.map((i) => i.participacao)).toEqual([25, 50, 25]);
    expect(r.reduce((s, i) => s + i.participacao, 0)).toBeCloseTo(100, 6);
  });

  it("Test 13 (AV-06): passando o conjunto FILTRADO, as participações somam cem — não a fração do total geral", () => {
    const carteira = [
      { id: "a", receita: 300, brand: "Pé Vermeio" },
      { id: "b", receita: 100, brand: "Pé Vermeio" },
      { id: "c", receita: 600, brand: "Outra" },
    ];

    // A régua errada: dividir pelo total da carteira depois de filtrar
    const totalGeral = carteira.reduce((s, i) => s + i.receita, 0);
    const filtrado = carteira.filter((i) => i.brand === "Pé Vermeio");
    const somaErrada = filtrado.reduce((s, i) => s + (i.receita / totalGeral) * 100, 0);
    expect(somaErrada).toBeCloseTo(40, 6); // não fecha em cem

    // A régua certa: dividir pelo conjunto recebido
    const r = calcularParticipacao(filtrado);
    expect(r.reduce((s, i) => s + i.participacao, 0)).toBeCloseTo(100, 6);
    expect(r.find((i) => i.id === "a")?.participacao).toBeCloseTo(75, 6);
    expect(r.find((i) => i.id === "b")?.participacao).toBeCloseTo(25, 6);
  });

  it("Test 14: preserva a ordem recebida e os campos extras do chamador", () => {
    const r = calcularParticipacao([
      { id: "primeiro", receita: 10, title: "X" },
      { id: "segundo", receita: 30, title: "Y" },
    ]);

    expect(r.map((i) => i.id)).toEqual(["primeiro", "segundo"]);
    expect(r[0].title).toBe("X");
    expect(r[0].participacao).toBeCloseTo(25, 6);
  });

  it("Test 15: conjunto vazio devolve lista vazia; soma zero devolve participação zero, nunca NaN", () => {
    expect(calcularParticipacao([])).toEqual([]);

    const zerados = calcularParticipacao([
      { id: "a", receita: 0 },
      { id: "b", receita: 0 },
    ]);
    expect(zerados.every((i) => i.participacao === 0)).toBe(true);
    expect(zerados.every((i) => Number.isFinite(i.participacao))).toBe(true);
  });

  it("Test 16: receita não finita ou negativa vira zero na participação", () => {
    const r = calcularParticipacao([
      { id: "ok", receita: 100 },
      { id: "nan", receita: Number.NaN },
      { id: "neg", receita: -10 },
    ]);

    expect(r.find((i) => i.id === "ok")?.participacao).toBeCloseTo(100, 6);
    expect(r.find((i) => i.id === "nan")?.participacao).toBe(0);
    expect(r.find((i) => i.id === "neg")?.participacao).toBe(0);
  });
});
