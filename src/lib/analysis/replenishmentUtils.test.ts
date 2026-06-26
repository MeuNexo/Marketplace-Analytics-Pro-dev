import { describe, it, expect } from "vitest";
import {
  calcReplenishment, resolveParams, resolveParamsBySku, REPLENISHMENT_DEFAULTS,
  calcEwmaDaily, calcSeasonalFactor, calcTrend,
  resolveSmartLeadTime, resolveVendaDiaOrigem,
} from "./replenishmentUtils";
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

// ─── resolveParamsBySku ───────────────────────────────────────────────────────

describe("resolveParamsBySku", () => {

  // CMP-05 / D-08 precedência SKU > marca > global > defaults

  // Caso 1: skuRow presente vence tudo (origem 'sku')
  it("CMP-05 precedência sku: skuRow presente vence marcaRow e globalRow → origem='sku'", () => {
    const skuRow: Partial<ReplenishmentParams>   = { leadTimeDias: 10, metaCoberturaDias: 30, safetyDays: 3, moq: 12, packMultiple: 6 };
    const marcaRow: Partial<ReplenishmentParams> = { leadTimeDias: 45, metaCoberturaDias: 90, safetyDays: 10, moq: 5, packMultiple: 2 };
    const globalRow: Partial<ReplenishmentParams>= { leadTimeDias: 30, metaCoberturaDias: 60, safetyDays: 7, moq: 1, packMultiple: 1 };
    const { params, origem } = resolveParamsBySku(skuRow, null, marcaRow, globalRow);
    expect(origem).toBe("sku");
    expect(params.leadTimeDias).toBe(10);
    expect(params.metaCoberturaDias).toBe(30);
    expect(params.safetyDays).toBe(3);
    expect(params.moq).toBe(12);
    expect(params.packMultiple).toBe(6);
  });

  // Caso 2: skuRow ausente, marcaRow presente vence globalRow (origem 'marca')
  it("CMP-05 precedência marca: skuRow=null, marcaRow presente → usa marca, origem='marca'", () => {
    const marcaRow: Partial<ReplenishmentParams> = { leadTimeDias: 45, metaCoberturaDias: 90, safetyDays: 10, moq: 5, packMultiple: 2 };
    const globalRow: Partial<ReplenishmentParams>= { leadTimeDias: 30, metaCoberturaDias: 60, safetyDays: 7, moq: 1, packMultiple: 1 };
    const { params, origem } = resolveParamsBySku(null, null, marcaRow, globalRow);
    expect(origem).toBe("marca");
    expect(params.leadTimeDias).toBe(45);
    expect(params.metaCoberturaDias).toBe(90);
    expect(params.safetyDays).toBe(10);
    expect(params.moq).toBe(5);
    expect(params.packMultiple).toBe(2);
  });

  // Caso 3: somente globalRow (origem 'global')
  it("CMP-05 somente global: skuRow=null, marcaRow=null, globalRow presente → usa global, origem='global'", () => {
    const globalRow: Partial<ReplenishmentParams> = { leadTimeDias: 20, metaCoberturaDias: 45, safetyDays: 5, moq: 3, packMultiple: 4 };
    const { params, origem } = resolveParamsBySku(null, null, null, globalRow);
    expect(origem).toBe("global");
    expect(params.leadTimeDias).toBe(20);
    expect(params.metaCoberturaDias).toBe(45);
    expect(params.safetyDays).toBe(5);
    expect(params.moq).toBe(3);
    expect(params.packMultiple).toBe(4);
  });

  // Caso 4: nenhum row → origem='global', valores defaults 30/60/7/1/1
  it("CMP-05 todos null: skuRow=null, marcaRow=null, globalRow=null → defaults hardcoded, origem='global'", () => {
    const { params, origem } = resolveParamsBySku(null, null, null, null);
    expect(origem).toBe("global");
    expect(params.leadTimeDias).toBe(30);
    expect(params.metaCoberturaDias).toBe(60);
    expect(params.safetyDays).toBe(7);
    expect(params.moq).toBe(1);
    expect(params.packMultiple).toBe(1);
  });

  // Bônus: skuRow override altera ponto/alvo via calcReplenishment
  it("skuRow override muda ponto e alvo via calcReplenishment", () => {
    // skuRow curto: leadTime=5, safety=2 → ponto = vendaDia * 7
    const skuRow: Partial<ReplenishmentParams> = {
      leadTimeDias: 5, metaCoberturaDias: 14, safetyDays: 2, moq: 1, packMultiple: 1,
    };
    const { params } = resolveParamsBySku(skuRow, null, null, null);
    // estoque=10, vendaDia=2 → ponto=2*(5+2)=14; 10 ≤ 14 → gatilho ativo
    // alvo=2*(14+2)=32; nec=32-10=22; pack=1: 22; max(22,1)=22
    const result = calcReplenishment(10, 2, params);
    expect(result.pontoReposicao).toBe(14);
    expect(result.alvo).toBe(32);
    expect(result.compraSugerida).toBe(22);
    expect(result.gatilhoAtivo).toBe(true);
  });

  // FORN-05: Caso: fornecedorRow presente, skuRow ausente → usa fornecedor (origem='fornecedor')
  it("FORN-05 precedência fornecedor: fornecedorRow presente, skuRow=null → usa fornecedor, origem='fornecedor'", () => {
    const fornecedorRow: Partial<ReplenishmentParams> = { leadTimeDias: 20, metaCoberturaDias: 45, safetyDays: 5, moq: 6, packMultiple: 3 };
    const marcaRow: Partial<ReplenishmentParams>      = { leadTimeDias: 45, metaCoberturaDias: 90, safetyDays: 10, moq: 5, packMultiple: 2 };
    const globalRow: Partial<ReplenishmentParams>     = { leadTimeDias: 30, metaCoberturaDias: 60, safetyDays: 7, moq: 1, packMultiple: 1 };
    const { params, origem } = resolveParamsBySku(null, fornecedorRow, marcaRow, globalRow);
    expect(origem).toBe("fornecedor");
    expect(params.leadTimeDias).toBe(20);
  });

  // FORN-05: Caso: skuRow presente vence fornecedor (sku > fornecedor)
  it("FORN-05 sku > fornecedor: skuRow presente vence fornecedorRow → origem='sku'", () => {
    const skuRow: Partial<ReplenishmentParams>        = { leadTimeDias: 5, metaCoberturaDias: 14, safetyDays: 2, moq: 12, packMultiple: 6 };
    const fornecedorRow: Partial<ReplenishmentParams> = { leadTimeDias: 20, metaCoberturaDias: 45, safetyDays: 5, moq: 6, packMultiple: 3 };
    const { params, origem } = resolveParamsBySku(skuRow, fornecedorRow, null, null);
    expect(origem).toBe("sku");
    expect(params.leadTimeDias).toBe(5);
  });

  // FORN-05: Caso: fornecedorRow=null (SKU sem OC), marcaRow presente → marca vence (pula fornecedor)
  it("FORN-05 fornecedor=null pula para marca: fornecedorRow=null, marcaRow presente → origem='marca'", () => {
    const marcaRow: Partial<ReplenishmentParams>  = { leadTimeDias: 45, metaCoberturaDias: 90, safetyDays: 10, moq: 5, packMultiple: 2 };
    const globalRow: Partial<ReplenishmentParams> = { leadTimeDias: 30, metaCoberturaDias: 60, safetyDays: 7, moq: 1, packMultiple: 1 };
    const { params, origem } = resolveParamsBySku(null, null, marcaRow, globalRow);
    expect(origem).toBe("marca");
    expect(params.leadTimeDias).toBe(45);
  });

  // FORN-05: Caso: fornecedorRow presente mas marcaRow ausente → fornecedor vence global
  it("FORN-05 fornecedor > global: fornecedorRow presente, marcaRow=null → usa fornecedor, origem='fornecedor'", () => {
    const fornecedorRow: Partial<ReplenishmentParams> = { leadTimeDias: 20, metaCoberturaDias: 45, safetyDays: 5, moq: 6, packMultiple: 3 };
    const globalRow: Partial<ReplenishmentParams>     = { leadTimeDias: 30, metaCoberturaDias: 60, safetyDays: 7, moq: 1, packMultiple: 1 };
    const { params, origem } = resolveParamsBySku(null, fornecedorRow, null, globalRow);
    expect(origem).toBe("fornecedor");
    expect(params.leadTimeDias).toBe(20);
  });

  // FORN-05: Caso: todos null → defaults hardcoded (sem regressão)
  it("FORN-05 todos null → defaults 30/60/7/1/1, origem='global'", () => {
    const { params, origem } = resolveParamsBySku(null, null, null, null);
    expect(origem).toBe("global");
    expect(params.leadTimeDias).toBe(30);
  });

});

// ─── calcEwmaDaily ────────────────────────────────────────────────────────────

describe("calcEwmaDaily", () => {

  // SMART-01: comportamento base com >=2 semanas
  it("SMART-01 base: 2 semanas (offset 0 e 1, alpha=0.3) → valor correto / 7", () => {
    // offset 0: qty=14, peso=0.7^0=1.0 → contrib=14
    // offset 1: qty=7,  peso=0.7^1=0.7 → contrib=4.9
    // numerator=18.9, denominator=1.7, ewma_daily=18.9/1.7/7 ≈ 1.5882...
    const obs = [{ weekOffset: 0, qty: 14 }, { weekOffset: 1, qty: 7 }];
    const result = calcEwmaDaily(obs);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(18.9 / 1.7 / 7, 6);
  });

  // SMART-01: fallback com <2 semanas → null
  it("SMART-01 fallback <2 semanas: 1 obs → null", () => {
    const obs = [{ weekOffset: 0, qty: 10 }];
    expect(calcEwmaDaily(obs)).toBeNull();
  });

  // SMART-01: fallback com 0 semanas → null
  it("SMART-01 fallback 0 obs → null", () => {
    expect(calcEwmaDaily([])).toBeNull();
  });

  // SMART-01: offset real preservado — semana 0 pesa mais que semana 3
  it("SMART-01 offset real: offset=0 tem mais peso que offset=3 (POWER(0.7,0)=1 > POWER(0.7,3)=0.343)", () => {
    // Dois cenários: mesma qty mas em semanas diferentes
    // caso A: qty=10 em offset=0, qty=10 em offset=3 → ewma puxado pra offset=0
    // caso B: qty=10 em offset=3, qty=10 em offset=0 (mesmo, apenas confirma decaimento)
    const obs = [
      { weekOffset: 0, qty: 10 },
      { weekOffset: 3, qty: 10 },
    ];
    const ewma = calcEwmaDaily(obs)!;
    // Com quantidades iguais e offsets diferentes, EWMA == média plana = 10/7
    // pois sum(qty*w)/sum(w) = 10*(1+0.343)/(1+0.343) = 10 → ewma_daily = 10/7
    expect(ewma).toBeCloseTo(10 / 7, 6);

    // Agora offset=0 com qty MAIOR → ewma > média simples de 10/7
    const obsHighRecent = [
      { weekOffset: 0, qty: 20 },
      { weekOffset: 3, qty: 10 },
    ];
    const ewmaHighRecent = calcEwmaDaily(obsHighRecent)!;
    // w0=1.0, w3=0.343; num=20*1+10*0.343=23.43; den=1.343; daily=23.43/1.343/7≈2.49
    expect(ewmaHighRecent).toBeGreaterThan(20 / 7); // puxado para 20/7 pelo offset=0
    expect(ewmaHighRecent).toBeLessThan(20 / 7 * 1.01); // mas limitado pelo decaimento
  });

  // SMART-01: alpha customizado (ex: 0.5) muda resultado
  it("SMART-01 alpha customizado 0.5 (decay=0.5) → pesos diferentes de alpha=0.3", () => {
    const obs = [{ weekOffset: 0, qty: 14 }, { weekOffset: 1, qty: 7 }];
    const r03 = calcEwmaDaily(obs, 0.3)!;
    const r05 = calcEwmaDaily(obs, 0.5)!;
    // alpha=0.5 → decay=0.5; offset1 pesa 0.5 (menos que 0.7); soma pesa menos o antigo → r05 > r03
    expect(r05).not.toBeCloseTo(r03, 4); // devem ser diferentes
    // Com decay=0.5: num=14*1+7*0.5=17.5, den=1.5, daily=17.5/1.5/7≈1.667
    expect(r05).toBeCloseTo(17.5 / 1.5 / 7, 6);
  });

});

// ─── calcSeasonalFactor ───────────────────────────────────────────────────────

describe("calcSeasonalFactor", () => {

  // SMART-01: fallback <12 meses → factor=1.0, active=false
  it("SMART-01 fallback <12 meses: 11 meses → {factor:1.0, active:false}", () => {
    const map = new Map<number, number>();
    for (let m = 1; m <= 11; m++) map.set(m, 10);
    const result = calcSeasonalFactor(map, 6);
    expect(result.factor).toBe(1.0);
    expect(result.active).toBe(false);
  });

  // SMART-01: exato 12 meses → ativa o índice
  it("SMART-01 exato 12 meses: factor calculado e active=true", () => {
    // Todos os meses = 10, logo globalAvg=10, targetAvg=10 → factor=1.0 clamped → 1.0, active=true
    const map = new Map<number, number>();
    for (let m = 1; m <= 12; m++) map.set(m, 10);
    const result = calcSeasonalFactor(map, 6);
    expect(result.active).toBe(true);
    expect(result.factor).toBeCloseTo(1.0, 6);
  });

  // SMART-01: fator acima de 1 (mês de pico)
  it("SMART-01 fator pico: mês 6 vendas=24, outros=10 → factor>1", () => {
    const map = new Map<number, number>();
    for (let m = 1; m <= 12; m++) map.set(m, m === 6 ? 24 : 10);
    const result = calcSeasonalFactor(map, 6);
    expect(result.active).toBe(true);
    // globalAvg = (10*11 + 24)/12 = (110+24)/12 = 134/12 ≈ 11.167
    // factor = 24/11.167 ≈ 2.149 (dentro de [0.5,2.5])
    expect(result.factor).toBeCloseTo(24 / (134 / 12), 4);
    expect(result.factor).toBeGreaterThan(1.0);
  });

  // SMART-01: clamp superior 2.5 (pico extremo)
  it("SMART-01 clamp superior: fator extremo → clamped para 2.5", () => {
    const map = new Map<number, number>();
    for (let m = 1; m <= 12; m++) map.set(m, m === 8 ? 1000 : 1);
    const result = calcSeasonalFactor(map, 8);
    expect(result.active).toBe(true);
    expect(result.factor).toBe(2.5);
  });

  // SMART-01: clamp inferior 0.5 (mês morto)
  it("SMART-01 clamp inferior: fator extremo → clamped para 0.5", () => {
    const map = new Map<number, number>();
    for (let m = 1; m <= 12; m++) map.set(m, m === 2 ? 0.001 : 1000);
    const result = calcSeasonalFactor(map, 2);
    expect(result.active).toBe(true);
    expect(result.factor).toBe(0.5);
  });

  // SMART-01: targetMonth ausente no map → {factor:1.0, active:false}
  it("SMART-01 mês ausente: mês=13 não existe no map → {factor:1.0, active:false}", () => {
    const map = new Map<number, number>();
    for (let m = 1; m <= 12; m++) map.set(m, 10);
    const result = calcSeasonalFactor(map, 13); // mês inexistente
    expect(result.factor).toBe(1.0);
    expect(result.active).toBe(false);
  });

  // SMART-01: globalAvg=0 → {factor:1.0, active:false}
  it("SMART-01 globalAvg=0: todos os meses=0 → {factor:1.0, active:false}", () => {
    const map = new Map<number, number>();
    for (let m = 1; m <= 12; m++) map.set(m, 0);
    const result = calcSeasonalFactor(map, 6);
    expect(result.factor).toBe(1.0);
    expect(result.active).toBe(false);
  });

});

// ─── calcTrend ────────────────────────────────────────────────────────────────

describe("calcTrend", () => {

  // SMART-01: tendência de alta (recente > antigo * 1.20)
  it("SMART-01 alta: recent=1.25, older=1.0, threshold=0.20 → '↑'", () => {
    expect(calcTrend(1.25, 1.0)).toBe("↑");
  });

  // SMART-01: exatamente no limiar → ainda é '↑'
  it("SMART-01 limiar superior exato: recent=1.201, older=1.0 → '↑'", () => {
    expect(calcTrend(1.201, 1.0)).toBe("↑");
  });

  // SMART-01: tendência de queda (recente < antigo * 0.80)
  it("SMART-01 queda: recent=0.75, older=1.0, threshold=0.20 → '↓'", () => {
    expect(calcTrend(0.75, 1.0)).toBe("↓");
  });

  // SMART-01: exatamente no limiar → ainda é '↓'
  it("SMART-01 limiar inferior exato: recent=0.799, older=1.0 → '↓'", () => {
    expect(calcTrend(0.799, 1.0)).toBe("↓");
  });

  // SMART-01: estável (entre os limiares) → '~'
  it("SMART-01 estável: recent=1.10, older=1.0, threshold=0.20 → '~'", () => {
    expect(calcTrend(1.10, 1.0)).toBe("~");
  });

  // SMART-01: null/zero → '~'
  it("SMART-01 null recent → '~'", () => {
    expect(calcTrend(null, 1.0)).toBe("~");
  });

  it("SMART-01 null older → '~'", () => {
    expect(calcTrend(1.5, null)).toBe("~");
  });

  it("SMART-01 older=0 → '~'", () => {
    expect(calcTrend(1.5, 0)).toBe("~");
  });

  // SMART-01: threshold customizado
  it("SMART-01 threshold 0.10: recent=1.11, older=1.0 → '↑'", () => {
    expect(calcTrend(1.11, 1.0, 0.10)).toBe("↑");
  });

});

// ─── resolveSmartLeadTime ─────────────────────────────────────────────────────

describe("resolveSmartLeadTime", () => {

  // SMART-02: smart=true, ocCount>=2, medianLeadDays>0 → fornecedor_real
  it("SMART-02 fornecedor_real: smart=true, ocCount=2, medianLeadDays=15 → {leadTime:15, origem:'fornecedor_real'}", () => {
    const result = resolveSmartLeadTime({ medianLeadDays: 15, ocCount: 2 }, 30, true);
    expect(result.leadTime).toBe(15);
    expect(result.origem).toBe("fornecedor_real");
  });

  // SMART-02/03: smart=false → param
  it("SMART-03 smart=false → {leadTime: param, origem:'param'}", () => {
    const result = resolveSmartLeadTime({ medianLeadDays: 15, ocCount: 3 }, 30, false);
    expect(result.leadTime).toBe(30);
    expect(result.origem).toBe("param");
  });

  // SMART-02/03: ocCount<2 → param
  it("SMART-03 ocCount<2 (1 OC): → {leadTime: param, origem:'param'}", () => {
    const result = resolveSmartLeadTime({ medianLeadDays: 10, ocCount: 1 }, 30, true);
    expect(result.leadTime).toBe(30);
    expect(result.origem).toBe("param");
  });

  // SMART-02/03: medianLeadDays=0 → param
  it("SMART-03 medianLeadDays=0 → {leadTime: param, origem:'param'}", () => {
    const result = resolveSmartLeadTime({ medianLeadDays: 0, ocCount: 3 }, 30, true);
    expect(result.leadTime).toBe(30);
    expect(result.origem).toBe("param");
  });

  // SMART-02/03: sem mediana (null) → param
  it("SMART-03 medianLeadDays=null → {leadTime: param, origem:'param'}", () => {
    const result = resolveSmartLeadTime({ medianLeadDays: null, ocCount: 3 }, 30, true);
    expect(result.leadTime).toBe(30);
    expect(result.origem).toBe("param");
  });

  // SMART-02: ocCount=0 (sem OCs) → param
  it("SMART-03 ocCount=0: → {leadTime: param, origem:'param'}", () => {
    const result = resolveSmartLeadTime({ medianLeadDays: 20, ocCount: 0 }, 30, true);
    expect(result.leadTime).toBe(30);
    expect(result.origem).toBe("param");
  });

});

// ─── resolveVendaDiaOrigem ────────────────────────────────────────────────────

describe("resolveVendaDiaOrigem", () => {

  // SMART-01: smart=true, weeks>=2, sazonal ativa → 'ewma_sazonal'
  it("SMART-01 ewma_sazonal: smart=true, weeks=3, sazonalAtiva=true → 'ewma_sazonal'", () => {
    expect(resolveVendaDiaOrigem(3, true, true)).toBe("ewma_sazonal");
  });

  // SMART-01: smart=true, weeks>=2, sazonal inativa → 'ewma'
  it("SMART-01 ewma: smart=true, weeks=2, sazonalAtiva=false → 'ewma'", () => {
    expect(resolveVendaDiaOrigem(2, false, true)).toBe("ewma");
  });

  // SMART-03: smart=false → 'simples'
  it("SMART-03 simples por smart=false: smart=false → 'simples'", () => {
    expect(resolveVendaDiaOrigem(5, true, false)).toBe("simples");
  });

  // SMART-03: smart=true, weeks<2 → 'simples'
  it("SMART-03 simples por weeks<2: smart=true, weeks=1 → 'simples'", () => {
    expect(resolveVendaDiaOrigem(1, true, true)).toBe("simples");
  });

  // SMART-03: smart=true, weeks=0 → 'simples'
  it("SMART-03 simples por weeks=0: smart=true, weeks=0 → 'simples'", () => {
    expect(resolveVendaDiaOrigem(0, false, true)).toBe("simples");
  });

  // SMART-01: exato limiar weeks=2 com sazonal → 'ewma_sazonal'
  it("SMART-01 limiar exato weeks=2 com sazonal → 'ewma_sazonal'", () => {
    expect(resolveVendaDiaOrigem(2, true, true)).toBe("ewma_sazonal");
  });

});
