import { describe, it, expect } from "vitest";
import {
  calcReplenishment, resolveParams, resolveParamsBySku, REPLENISHMENT_DEFAULTS,
  calcEwmaDaily, calcSeasonalFactor, calcTrend,
  resolveSmartLeadTime, resolveVendaDiaOrigem,
  decideVendaDia, seasonalBoostOnly,
  // Phase 69 — novos símbolos (ESGOT-01/ESGOT-02)
  classifyStatusEsgotado, estimateBestRate, isDemandaEstimada,
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
    // EWMA é média ponderada entre 10 e 20, portanto entre 10/7 e 20/7
    expect(ewmaHighRecent).toBeGreaterThan(10 / 7); // puxado acima de 10/7 pelo offset=0 com qty=20
    expect(ewmaHighRecent).toBeLessThan(20 / 7);    // mas menor que 20/7 pois offset=3 draga pra baixo
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

// ─── decideVendaDia (Phase 68 — motor alta confiança) ─────────────────────────

describe("decideVendaDia", () => {

  // (a) inteligente ASSUME com todas as condições verdadeiras
  it("PH68 (a) assume: inteligente>simples + trendUp + weeks=3 + lead=60 → usa inteligente", () => {
    const r = decideVendaDia({ simples: 1.0, inteligente: 1.8, trendUp: true, weeksWithSales: 3, leadTime: 60 });
    expect(r.aplicaInteligente).toBe(true);
    expect(r.vendaDia).toBe(1.8);
  });

  // (b) NÃO assume se lead>60 → cai na simples (lead longo não persegue pico)
  it("PH68 (b) lead>60: demais condições ok mas leadTime=61 → cai na simples", () => {
    const r = decideVendaDia({ simples: 1.0, inteligente: 1.8, trendUp: true, weeksWithSales: 3, leadTime: 61 });
    expect(r.aplicaInteligente).toBe(false);
    expect(r.vendaDia).toBe(1.0);
  });

  // (c) NÃO assume se inteligente < simples (só puxa pra cima)
  it("PH68 (c) inteligente<simples: 0.8<1.0 → cai na simples (boost-only)", () => {
    const r = decideVendaDia({ simples: 1.0, inteligente: 0.8, trendUp: true, weeksWithSales: 5, leadTime: 30 });
    expect(r.aplicaInteligente).toBe(false);
    expect(r.vendaDia).toBe(1.0);
  });

  // NÃO assume se tendência não é de alta
  it("PH68 sem trendUp: trendUp=false → cai na simples", () => {
    const r = decideVendaDia({ simples: 1.0, inteligente: 2.0, trendUp: false, weeksWithSales: 5, leadTime: 30 });
    expect(r.aplicaInteligente).toBe(false);
    expect(r.vendaDia).toBe(1.0);
  });

  // NÃO assume se weeks<3 (pouco histórico)
  it("PH68 weeks<3: weeksWithSales=2 → cai na simples", () => {
    const r = decideVendaDia({ simples: 1.0, inteligente: 2.0, trendUp: true, weeksWithSales: 2, leadTime: 30 });
    expect(r.aplicaInteligente).toBe(false);
    expect(r.vendaDia).toBe(1.0);
  });

  // NÃO assume se inteligente=null (sem sinal)
  it("PH68 inteligente=null: sem sinal → cai na simples", () => {
    const r = decideVendaDia({ simples: 1.5, inteligente: null, trendUp: true, weeksWithSales: 5, leadTime: 30 });
    expect(r.aplicaInteligente).toBe(false);
    expect(r.vendaDia).toBe(1.5);
  });

});

// ─── seasonalBoostOnly (Phase 68 — sazonal nunca corta) ───────────────────────

describe("seasonalBoostOnly", () => {

  // (d) sazonal NUNCA < 1,0 — fator abaixo de 1 vira 1,0
  it("PH68 (d) clamp: fator 0.6 → 1.0 (nunca corta)", () => {
    expect(seasonalBoostOnly(0.6)).toBe(1.0);
  });

  it("PH68 (d) clamp: fator null → 1.0", () => {
    expect(seasonalBoostOnly(null)).toBe(1.0);
  });

  it("PH68 boost preservado: fator 1.8 → 1.8 (só soma)", () => {
    expect(seasonalBoostOnly(1.8)).toBe(1.8);
  });

  it("PH68 exato 1.0 → 1.0", () => {
    expect(seasonalBoostOnly(1.0)).toBe(1.0);
  });

});

// ─── classifyStatusEsgotado (Phase 69 — ESGOT-01) ────────────────────────────

describe("classifyStatusEsgotado", () => {

  // com_giro: tem estoque
  it("ESGOT-01 com_giro: skuStock=10, venda30d=0 → 'com_giro' (tem estoque)", () => {
    expect(classifyStatusEsgotado({ skuStock: 10, venda30d: 0, lastSaleDays: null })).toBe("com_giro");
  });

  // com_giro: tem venda recente (mesmo sem estoque)
  it("ESGOT-01 com_giro: skuStock=0, venda30d=5 → 'com_giro' (tem venda recente)", () => {
    expect(classifyStatusEsgotado({ skuStock: 0, venda30d: 5, lastSaleDays: 90 })).toBe("com_giro");
  });

  // com_giro: ambos > 0
  it("ESGOT-01 com_giro: skuStock=1, venda30d=3 → 'com_giro'", () => {
    expect(classifyStatusEsgotado({ skuStock: 1, venda30d: 3, lastSaleDays: 10 })).toBe("com_giro");
  });

  // repor_esgotado: exatamente 90 dias (limite do balde)
  it("ESGOT-01 repor_esgotado: esgotado + lastSaleDays=90 → 'repor_esgotado' (limite exato)", () => {
    expect(classifyStatusEsgotado({ skuStock: 0, venda30d: 0, lastSaleDays: 90 })).toBe("repor_esgotado");
  });

  // repor_esgotado: 30 dias (dentro do balde)
  it("ESGOT-01 repor_esgotado: esgotado + lastSaleDays=30 → 'repor_esgotado'", () => {
    expect(classifyStatusEsgotado({ skuStock: 0, venda30d: 0, lastSaleDays: 30 })).toBe("repor_esgotado");
  });

  // repor_esgotado: 1 dia
  it("ESGOT-01 repor_esgotado: esgotado + lastSaleDays=1 → 'repor_esgotado'", () => {
    expect(classifyStatusEsgotado({ skuStock: 0, venda30d: 0, lastSaleDays: 1 })).toBe("repor_esgotado");
  });

  // revisar_esgotado: exatamente 91 dias (limite do próximo balde)
  it("ESGOT-01 revisar_esgotado: esgotado + lastSaleDays=91 → 'revisar_esgotado' (limite exato)", () => {
    expect(classifyStatusEsgotado({ skuStock: 0, venda30d: 0, lastSaleDays: 91 })).toBe("revisar_esgotado");
  });

  // revisar_esgotado: exatamente 365 dias (limite superior)
  it("ESGOT-01 revisar_esgotado: esgotado + lastSaleDays=365 → 'revisar_esgotado' (limite exato)", () => {
    expect(classifyStatusEsgotado({ skuStock: 0, venda30d: 0, lastSaleDays: 365 })).toBe("revisar_esgotado");
  });

  // revisar_esgotado: 180 dias (dentro do balde)
  it("ESGOT-01 revisar_esgotado: esgotado + lastSaleDays=180 → 'revisar_esgotado'", () => {
    expect(classifyStatusEsgotado({ skuStock: 0, venda30d: 0, lastSaleDays: 180 })).toBe("revisar_esgotado");
  });

  // descontinuar: 366 dias (acima do limite)
  it("ESGOT-01 descontinuar: esgotado + lastSaleDays=366 → 'descontinuar'", () => {
    expect(classifyStatusEsgotado({ skuStock: 0, venda30d: 0, lastSaleDays: 366 })).toBe("descontinuar");
  });

  // descontinuar: lastSaleDays=null (nunca vendeu)
  it("ESGOT-01 descontinuar: esgotado + lastSaleDays=null → 'descontinuar'", () => {
    expect(classifyStatusEsgotado({ skuStock: 0, venda30d: 0, lastSaleDays: null })).toBe("descontinuar");
  });

  // descontinuar: muito antigo
  it("ESGOT-01 descontinuar: esgotado + lastSaleDays=1000 → 'descontinuar'", () => {
    expect(classifyStatusEsgotado({ skuStock: 0, venda30d: 0, lastSaleDays: 1000 })).toBe("descontinuar");
  });

});

// ─── estimateBestRate (Phase 69 — ESGOT-02) ──────────────────────────────────

describe("estimateBestRate", () => {

  // distinctSaleDays >= 2, best window > 0 → historico_esgotado
  it("ESGOT-02 historico: distinctDays=3, vendas em 3 dias → best/30, origem='historico_esgotado'", () => {
    // dias 0,1,2 com qty=10 cada → best window [0,29] = 30 → vendaDia=30/30=1
    const sales = [
      { dayOffset: 0, qty: 10 },
      { dayOffset: 1, qty: 10 },
      { dayOffset: 2, qty: 10 },
    ];
    const result = estimateBestRate({ dailySales: sales, distinctSaleDays: 3, sum90d: 30 });
    expect(result.origem).toBe("historico_esgotado");
    expect(result.vendaDia).toBeCloseTo(30 / 30, 6); // 1.0/d
  });

  // anti-pico: distinctSaleDays < 2 → conservador (sum90d/90)
  it("ESGOT-02 anti-pico: distinctDays=1 (1 dia com 100 un) → sum90d/90, origem='conservador'", () => {
    const sales = [{ dayOffset: 0, qty: 100 }];
    const result = estimateBestRate({ dailySales: sales, distinctSaleDays: 1, sum90d: 100 });
    expect(result.origem).toBe("conservador");
    expect(result.vendaDia).toBeCloseTo(100 / 90, 6);
  });

  // best window selects peak: 50 em window 0-29, 10 em window 30-59
  it("ESGOT-02 pico: melhor janela [0-29] com 50 un vence janela [30-59] com 10 → best=50, vendaDia=50/30", () => {
    // 2 dias com venda na janela 0-29 → distinctSaleDays >= 2
    const sales = [
      { dayOffset: 5,  qty: 30 },  // dentro da janela 0-29
      { dayOffset: 10, qty: 20 },  // dentro da janela 0-29; soma=50 nessa janela
      { dayOffset: 35, qty: 10 },  // dentro da janela 30-64 mas não na 0-29
    ];
    const result = estimateBestRate({ dailySales: sales, distinctSaleDays: 3, sum90d: 60 });
    expect(result.origem).toBe("historico_esgotado");
    // melhor janela tem 50 unidades → vendaDia = 50/30
    expect(result.vendaDia).toBeCloseTo(50 / 30, 5);
  });

  // best window = 0 → conservador (sem vendas nos 180 dias, mas distinctDays poderia ser >= 2 por bug de dados)
  it("ESGOT-02 sem vendas: dailySales=[] → best=0, cai em conservador", () => {
    const result = estimateBestRate({ dailySales: [], distinctSaleDays: 0, sum90d: 0 });
    expect(result.origem).toBe("conservador");
    expect(result.vendaDia).toBe(0); // 0/90 = 0
  });

  // distinctSaleDays=0 → conservador mesmo com dailySales contendo dados (defesa extra)
  it("ESGOT-02 anti-pico distinctDays=0 → conservador", () => {
    const result = estimateBestRate({ dailySales: [{ dayOffset: 5, qty: 50 }], distinctSaleDays: 0, sum90d: 50 });
    expect(result.origem).toBe("conservador");
  });

  // janelas fora dos 180 dias são ignoradas (offset >= 180)
  it("ESGOT-02 offset fora dos 180d: dayOffset=200 ignorado, best=0 → conservador", () => {
    const sales = [
      { dayOffset: 200, qty: 100 },
      { dayOffset: 205, qty: 100 },
    ];
    const result = estimateBestRate({ dailySales: sales, distinctSaleDays: 2, sum90d: 0 });
    // offsets >=180 não entram na janela; best=0 → cai na conservadora
    expect(result.origem).toBe("conservador");
    expect(result.vendaDia).toBe(0);
  });

});

// ─── isDemandaEstimada (Phase 69 — ESGOT-03) ─────────────────────────────────

describe("isDemandaEstimada", () => {

  it("ESGOT-03 historico_esgotado → true", () => {
    expect(isDemandaEstimada("historico_esgotado")).toBe(true);
  });

  it("ESGOT-03 ewma_sazonal → false", () => {
    expect(isDemandaEstimada("ewma_sazonal")).toBe(false);
  });

  it("ESGOT-03 ewma → false", () => {
    expect(isDemandaEstimada("ewma")).toBe(false);
  });

  it("ESGOT-03 simples → false", () => {
    expect(isDemandaEstimada("simples")).toBe(false);
  });

});
