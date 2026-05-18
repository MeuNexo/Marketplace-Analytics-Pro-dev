import { describe, it, expect } from "vitest";
import {
  getVendaDiaria,
  getPctFull,
  calcularCompra,
} from "./compraUtils";
import type { StockInputs, Multiplicador } from "./compraUtils";
import type { AnalysisSnapshot } from "@/hooks/useAnalysisSnapshots";
import type { PriceBucket } from "./types";

// ─── Helper de fixture ────────────────────────────────────────────────────────

function makeBucket(price: number, dailyAvg: number): PriceBucket {
  return {
    price,
    units: Math.round(dailyAvg * 30),
    gmv: price * Math.round(dailyAvg * 30),
    activeDays: 20,
    dailyAvg,
    volShare: 0.5,
    gmvShare: 0.5,
  };
}

function makeSnapshot(
  overrides: Partial<AnalysisSnapshot> & { priceCurve?: PriceBucket[] },
): AnalysisSnapshot {
  return {
    id: "snap-1",
    createdAt: "2024-01-01T00:00:00Z",
    mlUserId: "user-1",
    organizationId: "org-1",
    itemId: "item-1",
    productTitle: "Produto Teste",
    brand: null,
    periodStart: "2024-01-01",
    periodEnd: "2024-01-30",
    priceGmv: 50,
    priceNeutral: 55,
    priceMargin: 60,
    elasticityPct: 1.5,
    elasticityClass: "media",
    strategy: null,
    priceCurve: [],
    ...overrides,
  };
}

// ─── Testes getVendaDiaria ────────────────────────────────────────────────────

describe("getVendaDiaria", () => {
  it("strategy='gmv' → retorna dailyAvg do bucket com priceGmv", () => {
    const snapshot = makeSnapshot({
      strategy: "gmv",
      priceGmv: 50,
      priceCurve: [makeBucket(50, 10), makeBucket(55, 7), makeBucket(60, 5)],
    });
    const result = getVendaDiaria(snapshot);
    expect(result.dailyAvg).toBe(10);
    expect(result.estrategia).toBe("gmv");
    expect(result.fallback).toBe(false);
  });

  it("strategy='neutral' → retorna dailyAvg do bucket com priceNeutral", () => {
    const snapshot = makeSnapshot({
      strategy: "neutral",
      priceNeutral: 55,
      priceCurve: [makeBucket(50, 10), makeBucket(55, 7), makeBucket(60, 5)],
    });
    const result = getVendaDiaria(snapshot);
    expect(result.dailyAvg).toBe(7);
    expect(result.estrategia).toBe("neutral");
    expect(result.fallback).toBe(false);
  });

  it("strategy='margin' → retorna dailyAvg do bucket com priceMargin", () => {
    const snapshot = makeSnapshot({
      strategy: "margin",
      priceMargin: 60,
      priceCurve: [makeBucket(50, 10), makeBucket(55, 7), makeBucket(60, 5)],
    });
    const result = getVendaDiaria(snapshot);
    expect(result.dailyAvg).toBe(5);
    expect(result.estrategia).toBe("margin");
    expect(result.fallback).toBe(false);
  });

  it("strategy=null → usa priceGmv, fallback=true, estrategia='gmv'", () => {
    const snapshot = makeSnapshot({
      strategy: null,
      priceGmv: 50,
      priceCurve: [makeBucket(50, 10)],
    });
    const result = getVendaDiaria(snapshot);
    expect(result.dailyAvg).toBe(10);
    expect(result.estrategia).toBe("gmv");
    expect(result.fallback).toBe(true);
  });

  it("bucket não encontrado → dailyAvg=0, fallback=true, estrategia='gmv'", () => {
    const snapshot = makeSnapshot({
      strategy: "gmv",
      priceGmv: 50,
      priceCurve: [makeBucket(60, 5)], // sem bucket no priceGmv=50
    });
    const result = getVendaDiaria(snapshot);
    expect(result.dailyAvg).toBe(0);
    expect(result.fallback).toBe(true);
    expect(result.estrategia).toBe("gmv");
  });

  it("float equality: preço 49.99 encontrado quando target=49.99", () => {
    // O .99 pode ter problemas de representação binária — comparação via centavos
    const snapshot = makeSnapshot({
      strategy: "gmv",
      priceGmv: 49.99,
      priceCurve: [makeBucket(49.99, 8)],
    });
    const result = getVendaDiaria(snapshot);
    expect(result.dailyAvg).toBe(8);
    expect(result.fallback).toBe(false);
  });
});

// ─── Testes getPctFull ────────────────────────────────────────────────────────

describe("getPctFull", () => {
  it("COMP-04: gmv → 0.80", () => {
    expect(getPctFull("gmv")).toBe(0.80);
  });

  it("COMP-04: neutral → 0.60", () => {
    expect(getPctFull("neutral")).toBe(0.60);
  });

  it("COMP-04: margin → 0.50", () => {
    expect(getPctFull("margin")).toBe(0.50);
  });
});

// ─── Testes calcularCompra ────────────────────────────────────────────────────

describe("calcularCompra", () => {
  const baseInputs: StockInputs = {
    diasCobertura: 30,
    estoqueTotal: 100,
    estoqueFull: 60,
    estoqueCasa: 40,
  };

  // COMP-03 caso normal
  it("COMP-03 caso normal: vendaDiaria=10, mult=1.5, dias=30, estoque=100 → compra=350", () => {
    const snapshot = makeSnapshot({
      strategy: "gmv",
      priceGmv: 50,
      priceCurve: [makeBucket(50, 10)],
    });
    const inputs: StockInputs = { ...baseInputs, diasCobertura: 30, estoqueTotal: 100 };
    const result = calcularCompra(snapshot, inputs, 1.5);
    // coberturaAlvo = 10 * 1.5 * 30 = 450
    expect(result.coberturaAlvo).toBe(450);
    // compraRecomendada = max(0, ceil(450) - 100) = 350
    expect(result.compraRecomendada).toBe(350);
  });

  // COMP-03 clamp negativo
  it("COMP-03 clamp: vendaDiaria=1, mult=1.0, dias=10, estoque=100 → compra=0 (clamped)", () => {
    const snapshot = makeSnapshot({
      strategy: "gmv",
      priceGmv: 50,
      priceCurve: [makeBucket(50, 1)],
    });
    const inputs: StockInputs = {
      diasCobertura: 10,
      estoqueTotal: 100,
      estoqueFull: 60,
      estoqueCasa: 40,
    };
    const result = calcularCompra(snapshot, inputs, 1.0);
    // coberturaAlvo = 1 * 1.0 * 10 = 10
    // compraRecomendada = max(0, ceil(10) - 100) = max(0, -90) = 0
    expect(result.compraRecomendada).toBe(0);
  });

  // COMP-04: sugestaoFull por estratégia
  it("COMP-04 gmv: sugestaoFull usa 80% da coberturaAlvo", () => {
    const snapshot = makeSnapshot({
      strategy: "gmv",
      priceGmv: 50,
      priceCurve: [makeBucket(50, 10)],
    });
    const inputs: StockInputs = { diasCobertura: 30, estoqueTotal: 500, estoqueFull: 300, estoqueCasa: 200 };
    const result = calcularCompra(snapshot, inputs, 1.0);
    // coberturaAlvo = 10 * 1.0 * 30 = 300
    // sugestaoFull = min(ceil(300 * 0.80), 500) = min(240, 500) = 240
    expect(result.pctFull).toBe(0.80);
    expect(result.sugestaoFull).toBe(240);
  });

  it("COMP-04 neutral: sugestaoFull usa 60% da coberturaAlvo", () => {
    const snapshot = makeSnapshot({
      strategy: "neutral",
      priceNeutral: 55,
      priceCurve: [makeBucket(55, 10)],
    });
    const inputs: StockInputs = { diasCobertura: 30, estoqueTotal: 500, estoqueFull: 300, estoqueCasa: 200 };
    const result = calcularCompra(snapshot, inputs, 1.0);
    // coberturaAlvo = 10 * 1.0 * 30 = 300
    // sugestaoFull = min(ceil(300 * 0.60), 500) = min(180, 500) = 180
    expect(result.pctFull).toBe(0.60);
    expect(result.sugestaoFull).toBe(180);
  });

  it("COMP-04 margin: sugestaoFull usa 50% da coberturaAlvo", () => {
    const snapshot = makeSnapshot({
      strategy: "margin",
      priceMargin: 60,
      priceCurve: [makeBucket(60, 10)],
    });
    const inputs: StockInputs = { diasCobertura: 30, estoqueTotal: 500, estoqueFull: 300, estoqueCasa: 200 };
    const result = calcularCompra(snapshot, inputs, 1.0);
    // coberturaAlvo = 10 * 1.0 * 30 = 300
    // sugestaoFull = min(ceil(300 * 0.50), 500) = min(150, 500) = 150
    expect(result.pctFull).toBe(0.50);
    expect(result.sugestaoFull).toBe(150);
  });

  // sugestaoFull respeita teto estoqueTotal
  it("sugestaoFull é capped pelo estoqueTotal", () => {
    const snapshot = makeSnapshot({
      strategy: "gmv",
      priceGmv: 50,
      priceCurve: [makeBucket(50, 50)],
    });
    const inputs: StockInputs = {
      diasCobertura: 30,
      estoqueTotal: 50, // estoqueTotal pequeno
      estoqueFull: 30,
      estoqueCasa: 20,
    };
    const result = calcularCompra(snapshot, inputs, 2.0);
    // coberturaAlvo = 50 * 2.0 * 30 = 3000
    // sugestaoFull raw = ceil(3000 * 0.80) = 2400
    // capped: min(2400, 50) = 50
    expect(result.sugestaoFull).toBe(50);
  });

  // Fallback: strategy=null
  it("fallback: strategy=null → estrategiaUsada='gmv', fallbackUsed=true", () => {
    const snapshot = makeSnapshot({
      strategy: null,
      priceGmv: 50,
      priceCurve: [makeBucket(50, 5)],
    });
    const result = calcularCompra(snapshot, baseInputs, 1.0);
    expect(result.estrategiaUsada).toBe("gmv");
    expect(result.fallbackUsed).toBe(true);
    expect(result.vendaDiariaEstrategia).toBe(5);
  });

  // Float equality com preço terminado em .99
  it("float equality: priceCurve com preço 59.99, target=59.99 → bucket encontrado corretamente", () => {
    const snapshot = makeSnapshot({
      strategy: "gmv",
      priceGmv: 59.99,
      priceCurve: [makeBucket(59.99, 12)],
    });
    const inputs: StockInputs = { diasCobertura: 30, estoqueTotal: 200, estoqueFull: 100, estoqueCasa: 100 };
    const result = calcularCompra(snapshot, inputs, 1.0);
    // Se o bucket for encontrado: vendaDiariaEstrategia = 12
    expect(result.vendaDiariaEstrategia).toBe(12);
    expect(result.fallbackUsed).toBe(false);
    // coberturaAlvo = 12 * 1.0 * 30 = 360
    // compraRecomendada = max(0, ceil(360) - 200) = 160
    expect(result.compraRecomendada).toBe(160);
  });
});
