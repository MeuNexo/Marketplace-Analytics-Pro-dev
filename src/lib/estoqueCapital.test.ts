// ============================================================================
// estoqueCapital.test.ts — Fase 213, Plano 01, Task 2
//
// Prova de que capital imobilizado é sempre CMV × quantidade, nunca preço, e
// de que SKU sem custo fica declarado — nunca zerado nem substituído (CR-05).
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  custoDoItem,
  agregarCapitalPorClasse,
  type EntradaCusto,
  type ItemEstoqueCapital,
} from "./estoqueCapital";
import type { CoverageClass } from "@/hooks/useMLCoverage";

const classe = (pairs: [string, CoverageClass][]) => new Map<string, CoverageClass>(pairs);

describe("custoDoItem", () => {
  it("Test 1: resolve o custo primeiro pelo item_id e, na ausência, pelo SKU do anúncio", () => {
    const porItem = new Map<string, EntradaCusto>([["MLB1", { cost: 40 }]]);
    const porSku = new Map<string, EntradaCusto>([["SKU-A", { cost: 25 }]]);

    // Tem entrada por item_id → usa ela, ignora o SKU
    expect(custoDoItem("MLB1", "SKU-A", porItem, porSku)).toBe(40);

    // Sem entrada por item_id → cai para o SKU
    expect(custoDoItem("MLB2", "SKU-A", porItem, porSku)).toBe(25);
  });

  it("Test 2: devolve ausência explícita quando não há custo em nenhum dos dois índices — nunca zero, nunca o preço", () => {
    const porItem = new Map<string, EntradaCusto>();
    const porSku = new Map<string, EntradaCusto>();

    expect(custoDoItem("MLB1", "SKU-A", porItem, porSku)).toBeNull();
    expect(custoDoItem("MLB1", null, porItem, porSku)).toBeNull();
  });
});

describe("agregarCapitalPorClasse", () => {
  it("Test 3: soma custo × quantidade por classe de cobertura", () => {
    const itens: ItemEstoqueCapital[] = [
      { id: "MLB1", available_quantity: 10, seller_custom_field: "SKU-A" },
      { id: "MLB2", available_quantity: 5, seller_custom_field: "SKU-B" },
    ];
    const classePorItem = classe([
      ["MLB1", "critico"],
      ["MLB2", "ok"],
    ]);
    const custosPorItem = new Map<string, EntradaCusto>([
      ["MLB1", { cost: 40 }],
      ["MLB2", { cost: 20 }],
    ]);
    const custosPorSku = new Map<string, EntradaCusto>();

    const resultado = agregarCapitalPorClasse(itens, classePorItem, custosPorItem, custosPorSku);

    expect(resultado.porClasse.critico).toBe(400); // 40 × 10
    expect(resultado.porClasse.ok).toBe(100); // 20 × 5
    expect(resultado.risco).toBe(400); // ruptura(0) + critico(400)
    expect(resultado.saudavel).toBe(100);
  });

  it("Test 4: item sem custo não entra em nenhuma classe do total em reais, e aparece na contagem de faltantes com suas unidades", () => {
    const itens: ItemEstoqueCapital[] = [
      { id: "MLB1", available_quantity: 10, seller_custom_field: "SKU-A" },
      { id: "MLB2", available_quantity: 7, seller_custom_field: null },
    ];
    const classePorItem = classe([
      ["MLB1", "critico"],
      ["MLB2", "sem_giro"],
    ]);
    const custosPorItem = new Map<string, EntradaCusto>([["MLB1", { cost: 40 }]]);
    const custosPorSku = new Map<string, EntradaCusto>();

    const resultado = agregarCapitalPorClasse(itens, classePorItem, custosPorItem, custosPorSku);

    expect(resultado.porClasse.sem_giro).toBe(0); // MLB2 não entra no total em reais
    expect(resultado.skusSemCusto).toBe(1);
    expect(resultado.unidadesSemCusto).toBe(7);
  });

  it("Test 5: item com quantidade zero contribui zero para o capital, seja qual for o custo", () => {
    const itens: ItemEstoqueCapital[] = [
      { id: "MLB1", available_quantity: 0, seller_custom_field: "SKU-A" },
    ];
    const classePorItem = classe([["MLB1", "ruptura"]]);
    const custosPorItem = new Map<string, EntradaCusto>([["MLB1", { cost: 999 }]]);
    const custosPorSku = new Map<string, EntradaCusto>();

    const resultado = agregarCapitalPorClasse(itens, classePorItem, custosPorItem, custosPorSku);

    expect(resultado.porClasse.ruptura).toBe(0);
    expect(resultado.risco).toBe(0);
  });

  it("Test 6: cobertura de CMV é a razão entre SKUs com custo e SKUs considerados, e é nula quando não há SKU nenhum", () => {
    const itens: ItemEstoqueCapital[] = [
      { id: "MLB1", available_quantity: 1, seller_custom_field: null },
      { id: "MLB2", available_quantity: 1, seller_custom_field: null },
      { id: "MLB3", available_quantity: 1, seller_custom_field: null },
    ];
    const classePorItem = classe([
      ["MLB1", "ok"],
      ["MLB2", "ok"],
      ["MLB3", "ok"],
    ]);
    const custosPorItem = new Map<string, EntradaCusto>([["MLB1", { cost: 10 }]]);
    const custosPorSku = new Map<string, EntradaCusto>();

    const resultado = agregarCapitalPorClasse(itens, classePorItem, custosPorItem, custosPorSku);
    expect(resultado.coberturaCmvPct).toBeCloseTo(33.333, 2); // 1 de 3

    const vazio = agregarCapitalPorClasse([], new Map(), new Map(), new Map());
    expect(vazio.coberturaCmvPct).toBeNull(); // nunca 100% por divisão vazia
  });

  it("Test 7 (caso medido CR-05): dois itens, um a preço 100 e custo 40 com 10 unidades e outro sem custo, produzem capital de R$ 400 e um faltante", () => {
    // item 1: preço 100, custo 40, 10 unidades — capital a preço seria 1000, a custo é 400
    // item 2: sem custo cadastrado, preço 100, 10 unidades — não entra no total em reais
    const itens: ItemEstoqueCapital[] = [
      { id: "MLB1", available_quantity: 10, seller_custom_field: "SKU-A" },
      { id: "MLB2", available_quantity: 10, seller_custom_field: "SKU-B" },
    ];
    const classePorItem = classe([
      ["MLB1", "ok"],
      ["MLB2", "ok"],
    ]);
    const custosPorItem = new Map<string, EntradaCusto>([["MLB1", { cost: 40 }]]);
    const custosPorSku = new Map<string, EntradaCusto>();

    const resultado = agregarCapitalPorClasse(itens, classePorItem, custosPorItem, custosPorSku);

    expect(resultado.saudavel).toBe(400); // não 1000 (preço) nem um preço disfarçado de custo
    expect(resultado.porClasse.ok).toBe(400);
    expect(resultado.skusSemCusto).toBe(1);
    expect(resultado.unidadesSemCusto).toBe(10);
  });
});
