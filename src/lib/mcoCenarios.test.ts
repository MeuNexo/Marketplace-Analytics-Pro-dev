import { describe, it, expect } from "vitest";
import { computeMco, type McoInput } from "./mco";
import { computeMcoCenarios, resolveDifalCenario, type DifalSummaryInput } from "./mcoCenarios";

// Caso-prova (222-CONTEXT.md, conferido à mão pelo Wesley):
// pedido 2000017711929314, SP→MG, sem ads.
// semDifal 84,20 (12,15%) · comDifal 33,49 (4,83%) · DIFAL 50,71.
const casoProvaBase: McoInput = {
  grossRevenue: 692.99,
  cmv: 369.0,
  platformCost: 110.44, // comissão 79,69 + frete 30,75
  ads: 0,
  tax: 129.35, // imposto SEM DIFAL (ICMS + PIS/COFINS - créditos)
};

function difalSummary(overrides: Partial<DifalSummaryInput>): DifalSummaryInput {
  return {
    difal_calculado: 0,
    difal_recolhido_pela_loja: 0,
    difal_cobrado_ml: 0,
    pedidos_difal_indefinido: 0,
    regua_recolhimento_configurada: false,
    regua_cobranca_configurada: false,
    ...overrides,
  };
}

describe("computeMcoCenarios", () => {
  it("semDifal é idêntico, ao centavo, a computeMco(base) — comparação direta", () => {
    const base: McoInput = { grossRevenue: 1000, cmv: 400, platformCost: 100, ads: 50, tax: 80 };
    const result = computeMcoCenarios({ base, difal: difalSummary({}) });
    expect(result.semDifal).toEqual(computeMco(base));
  });

  it("caso-prova: semDifal 84,20 (12,15%) e comDifal 33,49 (4,83%)", () => {
    const difal = difalSummary({
      difal_calculado: 50.71,
      regua_cobranca_configurada: false,
    });
    const result = computeMcoCenarios({ base: casoProvaBase, difal });

    expect(result.semDifal.mco).toBeCloseTo(84.2, 2);
    expect(result.semDifal.pct).toBeCloseTo(12.15, 1);
    expect(result.comDifal).not.toBeNull();
    expect(result.comDifal!.mco).toBeCloseTo(33.49, 2);
    expect(result.comDifal!.pct).toBeCloseTo(4.83, 1);
    expect(result.difalAplicado).toBeCloseTo(50.71, 2);
  });

  it('procedência "calculado_nao_conciliado" quando a régua de cobrança não está configurada', () => {
    const difal = difalSummary({
      difal_calculado: 100,
      difal_cobrado_ml: 999, // não pode entrar — cobrança não conciliada
      regua_cobranca_configurada: false,
    });
    const result = computeMcoCenarios({ base: casoProvaBase, difal });

    expect(result.procedencia).toBe("calculado_nao_conciliado");
    expect(result.difalAplicado).toBe(100);
  });

  it('procedência "cobrado_mais_devido_integral" quando cobrança está configurada e recolhimento não', () => {
    const difal = difalSummary({
      difal_calculado: 60,
      difal_cobrado_ml: 40,
      difal_recolhido_pela_loja: 999, // não pode entrar — recolhimento não configurado
      regua_cobranca_configurada: true,
      regua_recolhimento_configurada: false,
    });
    const result = computeMcoCenarios({ base: casoProvaBase, difal });

    expect(result.procedencia).toBe("cobrado_mais_devido_integral");
    expect(result.difalAplicado).toBe(100); // 40 + 60, teto integral
  });

  it('procedência "cobrado_mais_recolhido" quando as duas réguas estão configuradas', () => {
    const difal = difalSummary({
      difal_calculado: 60, // não entra inteiro — só o recolhido abaixo
      difal_cobrado_ml: 40,
      difal_recolhido_pela_loja: 15,
      regua_cobranca_configurada: true,
      regua_recolhimento_configurada: true,
    });
    const result = computeMcoCenarios({ base: casoProvaBase, difal });

    expect(result.procedencia).toBe("cobrado_mais_recolhido");
    expect(result.difalAplicado).toBe(55); // 40 + 15, não 40 + 60
  });

  it('as duas réguas configuradas e nada recolhido além do cobrado: procedência continua "cobrado_mais_recolhido", não vira "só cobrado"', () => {
    const difal = difalSummary({
      difal_calculado: 60,
      difal_cobrado_ml: 40,
      difal_recolhido_pela_loja: 0, // loja declarou que não recolhe mais nada
      regua_cobranca_configurada: true,
      regua_recolhimento_configurada: true,
    });
    const result = computeMcoCenarios({ base: casoProvaBase, difal });

    expect(result.procedencia).toBe("cobrado_mais_recolhido");
    expect(result.difalAplicado).toBe(40);
  });

  it("resumo ausente (undefined): comDifal é null e não zero, procedência indisponível", () => {
    const result = computeMcoCenarios({ base: casoProvaBase, difal: undefined });

    expect(result.procedencia).toBe("indisponivel");
    expect(result.comDifal).toBeNull();
    expect(result.difalAplicado).toBeNull();
    // não é o cenário sem DIFAL disfarçado de zero:
    expect(result.comDifal).not.toEqual(result.semDifal);
  });

  it("resumo ausente (null): mesmo comportamento do undefined", () => {
    const result = computeMcoCenarios({ base: casoProvaBase, difal: null });

    expect(result.procedencia).toBe("indisponivel");
    expect(result.comDifal).toBeNull();
    expect(result.difalAplicado).toBeNull();
  });

  it("cobrado e calculado nunca somam sobre o mesmo destino — difal_previsto_nas_ufs_cobradas (extra) é ignorado mesmo se presente no objeto", () => {
    // difal_previsto_nas_ufs_cobradas nem existe na interface DifalSummaryInput
    // — mas se o chamador passar um objeto mais largo (ex.: o retorno bruto
    // da RPC, que tem o campo), a soma ingênua NÃO pode incluí-lo.
    const difalComCampoExtra = {
      ...difalSummary({
        difal_calculado: 100,
        difal_cobrado_ml: 40,
        regua_cobranca_configurada: true,
        regua_recolhimento_configurada: false,
      }),
      difal_previsto_nas_ufs_cobradas: 9999, // se somado, o teste abaixo falha
    };
    const result = computeMcoCenarios({ base: casoProvaBase, difal: difalComCampoExtra });

    expect(result.difalAplicado).toBe(140); // 40 + 100, nunca +9999
  });

  it("pedidosIndefinidos é repassado em todos os cenários de dados disponíveis", () => {
    const difal = difalSummary({ pedidos_difal_indefinido: 7, regua_cobranca_configurada: false });
    const result = computeMcoCenarios({ base: casoProvaBase, difal });
    expect(result.pedidosIndefinidos).toBe(7);
  });

  it("pedidosIndefinidos é 0 quando o resumo está indisponível", () => {
    const result = computeMcoCenarios({ base: casoProvaBase, difal: null });
    expect(result.pedidosIndefinidos).toBe(0);
  });

  it("pedidos_difal_indefinido ausente (undefined) vira 0, não undefined", () => {
    // simula resposta parcial da RPC — campo faltando no objeto, não apenas 0
    const { pedidos_difal_indefinido: _omit, ...rest } = difalSummary({
      regua_cobranca_configurada: false,
    });
    const difal = rest as unknown as DifalSummaryInput;
    const result = computeMcoCenarios({ base: casoProvaBase, difal });
    expect(result.pedidosIndefinidos).toBe(0);
  });

  it("não muta o objeto base recebido", () => {
    const base: McoInput = { grossRevenue: 500, cmv: 200, platformCost: 50, ads: 10, tax: 30 };
    const snapshot = { ...base };
    computeMcoCenarios({
      base,
      difal: difalSummary({ difal_calculado: 20, regua_cobranca_configurada: false }),
    });
    expect(base).toEqual(snapshot);
  });

  it("ads é descontado uma única vez nos dois cenários (mesmo valor de ads em semDifal e comDifal)", () => {
    const base: McoInput = { grossRevenue: 1000, cmv: 300, platformCost: 100, ads: 75, tax: 60 };
    const difal = difalSummary({ difal_calculado: 25, regua_cobranca_configurada: false });
    const result = computeMcoCenarios({ base, difal });

    // A diferença entre os dois MCOs deve ser EXATAMENTE o DIFAL aplicado —
    // se ads fosse descontado de novo em algum dos dois, a diferença desviaria.
    expect(result.semDifal.mco - result.comDifal!.mco).toBeCloseTo(25, 8);
  });
});

describe("resolveDifalCenario", () => {
  it("devolve indisponível para difal ausente, sem exigir um McoInput", () => {
    const result = resolveDifalCenario(undefined);
    expect(result.procedencia).toBe("indisponivel");
    expect(result.difalAplicado).toBeNull();
  });

  it("é a metade 'decisão de régua' usada por computeMcoCenarios — mesmo resultado nos dois", () => {
    const difal = difalSummary({
      difal_calculado: 60,
      difal_cobrado_ml: 40,
      difal_recolhido_pela_loja: 15,
      regua_cobranca_configurada: true,
      regua_recolhimento_configurada: true,
    });
    const direct = resolveDifalCenario(difal);
    const viaCenarios = computeMcoCenarios({ base: casoProvaBase, difal });

    expect(direct.difalAplicado).toBe(viaCenarios.difalAplicado);
    expect(direct.procedencia).toBe(viaCenarios.procedencia);
  });
});
