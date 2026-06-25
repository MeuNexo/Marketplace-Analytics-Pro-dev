import { describe, it, expect } from "vitest";
import { calcReplenishment, resolveParams, REPLENISHMENT_DEFAULTS } from "./replenishmentUtils";
import type { ReplenishmentParams } from "./replenishmentUtils";

// ─── Helper ───────────────────────────────────────────────────────────────────

function defaultParams(overrides?: Partial<ReplenishmentParams>): ReplenishmentParams {
  return { ...REPLENISHMENT_DEFAULTS, ...overrides };
}

// ─── calcReplenishment ────────────────────────────────────────────────────────

describe("calcReplenishment", () => {

  // Test 1 (normal): parâmetros default, gatilho ativo
  it("REPL-11/04 normal: estoque=100, vendaDia=10, default → compraSugerida=570, gatilhoAtivo=true", () => {
    // ponto = 10*(30+7) = 370; 100 ≤ 370 → gatilho ativo
    // alvo  = 10*(60+7) = 670
    // nec.  = max(0, 670−100) = 570
    // pack=1: ceil(570/1)*1 = 570; max(570, 1) = 570
    const result = calcReplenishment(100, 10, defaultParams());
    expect(result.compraSugerida).toBe(570);
    expect(result.gatilhoAtivo).toBe(true);
    expect(result.semGiro).toBe(false);
    expect(result.pontoReposicao).toBe(370);
    expect(result.alvo).toBe(670);
    expect(result.coberturaAtual).toBe(10); // 100/10 = 10
  });

  // Test 2 (estoque>ponto): gatilho NÃO ativo → compra=0
  it("REPL-04 estoque>ponto: estoque=1000, vendaDia=10 → compraSugerida=0, gatilhoAtivo=false", () => {
    // ponto = 10*(30+7) = 370; 1000 > 370 → gatilho NÃO ativo
    const result = calcReplenishment(1000, 10, defaultParams());
    expect(result.compraSugerida).toBe(0);
    expect(result.gatilhoAtivo).toBe(false);
    expect(result.semGiro).toBe(false);
    expect(result.coberturaAtual).toBe(100); // 1000/10 = 100
  });

  // Test 3 (sem giro): vendaDia=0, estoque>0
  it("REPL-08 sem giro: vendaDia=0, estoque=50 → semGiro=true, compraSugerida=0, coberturaAtual=null", () => {
    const result = calcReplenishment(50, 0, defaultParams());
    expect(result.semGiro).toBe(true);
    expect(result.compraSugerida).toBe(0);
    expect(result.gatilhoAtivo).toBe(false);
    expect(result.coberturaAtual).toBeNull();
  });

  // Test 4 (MOQ): necessidade < moq → compra arredonda para moq
  it("REPL-06 MOQ: necessidade=7, pack=1, moq=10 → compraSugerida=10", () => {
    // estoque=30, vendaDia=1
    // ponto = 1*(40+7) = 47; 30 ≤ 47 → gatilho ativo
    // alvo  = 1*(30+7) = 37; nec = 37−30 = 7
    // pack=1: ceil(7/1)*1 = 7; max(7, 10) = 10
    const params = defaultParams({ leadTimeDias: 40, metaCoberturaDias: 30, moq: 10, packMultiple: 1 });
    const result = calcReplenishment(30, 1, params);
    expect(result.compraSugerida).toBe(10);
    expect(result.gatilhoAtivo).toBe(true);
  });

  // Test 5 (pack): arredondamento pra cima por múltiplo de embalagem
  it("REPL-06 pack: necessidade=7, pack=5, moq=1 → ceil(7/5)*5=10", () => {
    // estoque=30, vendaDia=1
    // ponto = 1*(40+7) = 47; 30 ≤ 47 → gatilho ativo
    // alvo  = 1*(30+7) = 37; nec = 7
    // pack=5: ceil(7/5)*5 = 2*5 = 10; max(10, 1) = 10
    const params = defaultParams({ leadTimeDias: 40, metaCoberturaDias: 30, moq: 1, packMultiple: 5 });
    const result = calcReplenishment(30, 1, params);
    expect(result.compraSugerida).toBe(10);
    expect(result.gatilhoAtivo).toBe(true);
  });

  // Test 6 (custo nulo): custoAusente=true, valorEstimado=null, compra calculada normalmente
  it("REPL-07 custo nulo: cost=null → custoAusente=true, valorEstimado=null, compraSugerida inalterada", () => {
    // mesmos inputs do caso normal → compra=570
    const result = calcReplenishment(100, 10, defaultParams(), null);
    expect(result.custoAusente).toBe(true);
    expect(result.valorEstimado).toBeNull();
    expect(result.compraSugerida).toBe(570); // cálculo não muda por falta de custo
  });

  // Bônus: custo fornecido → valorEstimado = compraSugerida × cost
  it("cost fornecido → valorEstimado = compraSugerida × cost", () => {
    // compra=570, custo=10 → valor=5700
    const result = calcReplenishment(100, 10, defaultParams(), 10);
    expect(result.custoAusente).toBe(false);
    expect(result.valorEstimado).toBe(5700);
  });

});

// ─── resolveParams ────────────────────────────────────────────────────────────

describe("resolveParams", () => {

  // Test 7 (override marca): marcaRow tem prioridade sobre globalRow
  it("REPL-05 override marca: marcaRow presente → usa valores da marca, origem='marca'", () => {
    const globalRow: Partial<ReplenishmentParams> = {
      leadTimeDias: 30, metaCoberturaDias: 60, safetyDays: 7, moq: 1, packMultiple: 1,
    };
    const marcaRow: Partial<ReplenishmentParams> = {
      leadTimeDias: 45, metaCoberturaDias: 90, safetyDays: 10, moq: 5, packMultiple: 2,
    };
    const { params, origem } = resolveParams("MarcaX", globalRow, marcaRow);
    expect(origem).toBe("marca");
    expect(params.leadTimeDias).toBe(45);
    expect(params.metaCoberturaDias).toBe(90);
    expect(params.safetyDays).toBe(10);
    expect(params.moq).toBe(5);
    expect(params.packMultiple).toBe(2);
  });

  // Test 8 (fallback sem global): sem linha global → cai no default 30/60/7/1/1, origem='global'
  it("REPL-05 fallback sem global: globalRow=null, marcaRow=null → default 30/60/7/1/1, origem='global'", () => {
    const { params, origem } = resolveParams("MarcaY", null, null);
    expect(origem).toBe("global");
    expect(params.leadTimeDias).toBe(30);
    expect(params.metaCoberturaDias).toBe(60);
    expect(params.safetyDays).toBe(7);
    expect(params.moq).toBe(1);
    expect(params.packMultiple).toBe(1);
  });

  // Bônus: global sem marca → usa global, origem='global'
  it("global sem marca: marcaRow=null, globalRow com valores → usa global, origem='global'", () => {
    const globalRow: Partial<ReplenishmentParams> = {
      leadTimeDias: 20, metaCoberturaDias: 45, safetyDays: 5, moq: 3, packMultiple: 6,
    };
    const { params, origem } = resolveParams("MarcaZ", globalRow, null);
    expect(origem).toBe("global");
    expect(params.leadTimeDias).toBe(20);
    expect(params.metaCoberturaDias).toBe(45);
    expect(params.safetyDays).toBe(5);
    expect(params.moq).toBe(3);
    expect(params.packMultiple).toBe(6);
  });

});
