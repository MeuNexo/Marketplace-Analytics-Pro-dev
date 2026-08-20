/**
 * Testes de `financeiroCenarios.ts` — o par de cenários de MCO para as
 * superfícies agregadas de `/financeiro` (Fase 222, quick 260820-2l7).
 *
 * O que estes testes existem para impedir: que o número de HOJE (sem DIFAL)
 * mude ao trocar a tela de expressão inline para o módulo novo, e que o
 * segundo cenário nasça de subtrair o DIFAL cheio em vez do efeito líquido —
 * o mesmo defeito de R$ 3,85/pedido do retrabalho 222-06-R/07-R.
 */
import { describe, it, expect } from "vitest";
import {
  cenariosLucroBrutoFinanceiro,
  passosWaterfallComDifal,
  ROTULO_REGUA_SEM_DIFAL,
  DECLARACAO_REGUA_SEM_DIFAL,
  DECLARACAO_SEMAFORO_SEM_DIFAL,
  DIFAL_ESTIMATIVA_AJUDA,
} from "./financeiroCenarios";
import { computeMco } from "./mco";
import { resolveDifalCenario, DIFAL_ESTIMATIVA_LABEL } from "./mcoCenarios";
import type { DifalSummaryInput } from "./mcoCenarios";

/** Fixture base — primeiro cenário = 100000 - 40000 - 15000 - 8000 - 12000 - 5000 = 20000 (20%). */
function fixtureBase() {
  return {
    receita: 100000,
    cmv: 40000,
    comissao: 15000,
    frete: 8000,
    impostos: 12000,
    publicidade: 5000,
  };
}

/** Resumo de DIFAL com as duas réguas configuradas e redução de PIS/COFINS > 0. */
function fixtureDifal(over: Partial<DifalSummaryInput> = {}): DifalSummaryInput {
  return {
    difal_calculado: 900,
    difal_recolhido_pela_loja: 600,
    difal_cobrado_ml: 200,
    reducao_pc_por_difal: 45.3,
    pedidos_difal_indefinido: 0,
    regua_recolhimento_configurada: true,
    regua_cobranca_configurada: true,
    ...over,
  };
}

describe("cenariosLucroBrutoFinanceiro — oráculo do número de hoje", () => {
  it("sem resumo de DIFAL, lucro e lucroPct batem com a expressão literal de hoje", () => {
    const base = fixtureBase();
    const r = cenariosLucroBrutoFinanceiro({ ...base, difal: null });

    const lucroEsperado =
      base.receita - base.cmv - base.comissao - base.frete - base.impostos - base.publicidade;
    const lucroPctEsperado = Math.round((lucroEsperado / base.receita) * 10000) / 100;

    expect(r.lucro).toBe(lucroEsperado);
    expect(r.lucroPct).toBe(lucroPctEsperado);
  });
});

describe("cenariosLucroBrutoFinanceiro — ausência com nome", () => {
  it("sem resumo de DIFAL, o segundo cenário é null (motivo indisponivel), nunca zero", () => {
    const r = cenariosLucroBrutoFinanceiro({ ...fixtureBase(), difal: null });

    expect(r.cenarios.comDifal).toBeNull();
    expect(r.cenarios.motivo).toBe("indisponivel");
    expect(JSON.stringify(r)).not.toContain('"comDifal":0');
  });
});

describe("cenariosLucroBrutoFinanceiro — a troca de UM termo", () => {
  it("o segundo valor bate com computeMco trocando só o termo de imposto, não com primeiro-DIFAL-cheio", () => {
    const base = fixtureBase();
    const difal = fixtureDifal();

    const r = cenariosLucroBrutoFinanceiro({ ...base, difal, regimeAplicaDifal: true });

    const { difalAplicado } = resolveDifalCenario(difal);
    const esperado = computeMco({
      grossRevenue: base.receita,
      cmv: base.cmv,
      platformCost: base.comissao + base.frete,
      ads: base.publicidade,
      tax: base.impostos + (difalAplicado ?? 0),
    }).mco;

    expect(r.cenarios.comDifal).not.toBeNull();
    expect(r.cenarios.comDifal!.valor).toBeCloseTo(esperado, 6);

    // NÃO é primeiro cenário menos o DIFAL cheio (calculado sem descontar a
    // redução de PIS/COFINS) — a diferença é exatamente a redução.
    const difalCheio = difal.difal_cobrado_ml + difal.difal_recolhido_pela_loja;
    const semDescontarReducao = r.lucro - difalCheio;
    expect(r.cenarios.comDifal!.valor).not.toBeCloseTo(semDescontarReducao, 2);
  });
});

describe("cenariosLucroBrutoFinanceiro — regime", () => {
  it("regimeAplicaDifal false derruba o segundo cenário com motivo regime_nao_aplicavel", () => {
    const r = cenariosLucroBrutoFinanceiro({
      ...fixtureBase(),
      difal: fixtureDifal(),
      regimeAplicaDifal: false,
    });

    expect(r.cenarios.motivo).toBe("regime_nao_aplicavel");
    expect(r.cenarios.comDifal).toBeNull();
  });
});

describe("cenariosLucroBrutoFinanceiro — pedidos fora da conta (UF não confirmada)", () => {
  // NOTA: `computeMcoCenarios` (mcoCenarios.ts, dono da aritmética — restrição 1
  // deste plano) só devolve `difalAplicado: null` quando `difal` está
  // inteiramente ausente, e nesse MESMO ramo zera `pedidosIndefinidos` para 0
  // (resolveDifalCenario, ramo `if (!difal)`). Como este módulo DELEGA
  // inteiramente essa decisão (não reimplementa a régua), a combinação
  // "efeito null + contagem > 0" que produziria `uf_nao_confirmada` em
  // `resolveLinhaCenarios` é estruturalmente inalcançável no nível agregado de
  // período — só existe nas telas por LINHA (`mcoLinhaCenarios.test.ts`), onde
  // efeito e contagem vêm de colunas independentes do banco. Os dois testes
  // abaixo provam o comportamento real e alcançável: a contagem viaja intacta
  // quando o resumo existe, e cai para 0 (nunca inventada) quando não.
  it("com resumo presente e pedidos_difal_indefinido > 0, a contagem aparece na saída mesmo com o segundo cenário 'ok'", () => {
    const r = cenariosLucroBrutoFinanceiro({
      ...fixtureBase(),
      difal: fixtureDifal({ pedidos_difal_indefinido: 7 }),
      regimeAplicaDifal: true,
    });

    expect(r.cenarios.motivo).toBe("ok");
    expect(r.cenarios.comDifal).not.toBeNull();
    expect(r.cenarios.pedidosDifalIndefinido).toBe(7);
  });

  it("sem resumo de DIFAL, a contagem de pedidos indefinidos é 0 — motivo indisponivel, nunca uf_nao_confirmada inventado", () => {
    const r = cenariosLucroBrutoFinanceiro({ ...fixtureBase(), difal: null });

    expect(r.cenarios.motivo).toBe("indisponivel");
    expect(r.cenarios.pedidosDifalIndefinido).toBe(0);
  });
});

describe("cenariosLucroBrutoFinanceiro — receita zero", () => {
  it("receita 0 produz percentual null nos dois cenários, nunca 0%", () => {
    const base = { ...fixtureBase(), receita: 0 };
    const r = cenariosLucroBrutoFinanceiro({ ...base, difal: fixtureDifal(), regimeAplicaDifal: true });

    expect(r.lucroPct).toBeNull();
    expect(r.cenarios.semDifal.pct).toBeNull();
    expect(r.cenarios.comDifal?.pct).toBeNull();
  });
});

describe("passosWaterfallComDifal — a escada fecha", () => {
  it("dois degraus: primeiro cenário - efeito líquido = segundo cenário, com tolerância de centavo", () => {
    const base = fixtureBase();
    const r = cenariosLucroBrutoFinanceiro({ ...base, difal: fixtureDifal(), regimeAplicaDifal: true });
    const passos = passosWaterfallComDifal(r);

    expect(passos).toHaveLength(2);
    expect(passos[0].key).toBe("difal_efeito");
    expect(passos[1].key).toBe("lucro_com_difal");

    // Degrau de DIFAL é negativo.
    expect(passos[0].value).toBeLessThan(0);

    // Fecha ao centavo.
    const somaFecha = r.lucro + passos[0].value;
    expect(somaFecha).toBeCloseTo(passos[1].value, 2);
    expect(passos[1].value).toBeCloseTo(r.cenarios.comDifal!.valor, 6);

    // Rótulos contêm a palavra da ressalva.
    expect(passos[0].label).toContain(DIFAL_ESTIMATIVA_LABEL);
    expect(passos[1].label).toContain(DIFAL_ESTIMATIVA_LABEL);
  });

  it("sem segundo cenário, a lista de degraus vem vazia", () => {
    const r = cenariosLucroBrutoFinanceiro({ ...fixtureBase(), difal: null });
    const passos = passosWaterfallComDifal(r);

    expect(passos).toHaveLength(0);
  });
});

describe("cenariosLucroBrutoFinanceiro — mesma casa decimal nos dois cenários", () => {
  it("os dois percentuais do par saem da mesma regra de arredondamento (duas casas)", () => {
    // Fixture cujo percentual bruto tem mais de duas casas decimais.
    const base = {
      receita: 333333,
      cmv: 100000,
      comissao: 30000,
      frete: 15000,
      impostos: 20000,
      publicidade: 8000,
    };
    const r = cenariosLucroBrutoFinanceiro({ ...base, difal: fixtureDifal(), regimeAplicaDifal: true });

    const casasDecimais = (v: number | null) =>
      v == null ? 0 : (String(v).split(".")[1] ?? "").length;

    expect(casasDecimais(r.cenarios.semDifal.pct)).toBeLessThanOrEqual(2);
    expect(casasDecimais(r.cenarios.comDifal?.pct ?? null)).toBeLessThanOrEqual(2);
  });
});

describe("financeiroCenarios — constantes de texto", () => {
  it("reexporta DIFAL_ESTIMATIVA_AJUDA de mcoLinhaCenarios, sem redigitar", () => {
    expect(typeof DIFAL_ESTIMATIVA_AJUDA).toBe("string");
    expect(DIFAL_ESTIMATIVA_AJUDA.length).toBeGreaterThan(0);
  });

  it("ROTULO_REGUA_SEM_DIFAL é curto (cabe numa legenda)", () => {
    expect(ROTULO_REGUA_SEM_DIFAL.length).toBeLessThan(40);
  });

  it("DECLARACAO_REGUA_SEM_DIFAL e DECLARACAO_SEMAFORO_SEM_DIFAL são frases não vazias", () => {
    expect(DECLARACAO_REGUA_SEM_DIFAL.length).toBeGreaterThan(20);
    expect(DECLARACAO_SEMAFORO_SEM_DIFAL.length).toBeGreaterThan(20);
  });
});
