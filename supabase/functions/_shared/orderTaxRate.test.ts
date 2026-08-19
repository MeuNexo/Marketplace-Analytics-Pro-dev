/**
 * orderTaxRate.test.ts — prova a fonte única da alíquota por pedido (Fase
 * 220, TAX-01).
 *
 * O caso central é o de destino desconhecido: até esta fase, as três cópias
 * da fórmula devolviam a alíquota intraestadual (a MAIS ALTA) quando o
 * destino não era conhecido. Este arquivo prova que o módulo novo devolve
 * `rate: null` nesse caso — nenhum teste aqui usa rede, mock de `fetch` ou
 * banco.
 */
import { describe, it, expect } from "vitest";
import {
  computeOrderTaxRate,
  computeOrderTax,
  isReducedInterstateDest,
  UF_REGION,
  type OrderTaxConfig,
  type OrderTaxInput,
  type DifalFonte,
} from "./orderTaxRate";
import { calculateEffectiveRate } from "../../../src/lib/tax/index";

/** Compara com tolerância de centavo (R$ 0,01) — o módulo não arredonda. */
const closeCents = (received: number | null, expected: number) => {
  expect(received).not.toBeNull();
  expect(Math.abs((received as number) - expected)).toBeLessThan(0.01);
};

// Config real da Pé Vermeio (conferida em CONTEXT.md): lucro_real, origem SP,
// ICMS intra 18%, inter Sul/Sudeste 12%, inter Norte/Nordeste/Centro-Oeste 7%.
const CFG_PE_VERMEIO: OrderTaxConfig = {
  regime: "lucro_real",
  uf_origem: "SP",
  sn_aliquota_efetiva: null,
  lp_pis: null,
  lp_cofins: null,
  lp_irpj: null,
  lp_csll: null,
  lr_icms_aliquota_intra: 18,
  lr_icms_aliquota_inter_sul_sudeste: 12,
  lr_icms_aliquota_inter_norte_nordeste: 7,
  lr_icms_debito: null,
};

describe("computeOrderTaxRate — lucro_real, config real da Pé Vermeio", () => {
  it("destino SP (igual à origem) devolve a alíquota intraestadual exata", () => {
    const r = computeOrderTaxRate(CFG_PE_VERMEIO, "SP");
    expect(r.rate).toBe(25.585);
    expect(r.motivo).toBe("intraestadual");
  });

  it.each(["MG", "RJ", "PR", "SC", "RS"])(
    "destino %s (Sul/Sudeste exceto ES) devolve a alíquota interestadual normal exata",
    (uf) => {
      const r = computeOrderTaxRate(CFG_PE_VERMEIO, uf);
      expect(r.rate).toBe(20.14);
      expect(r.motivo).toBe("interestadual");
    },
  );

  it("destino ES devolve a alíquota reduzida, não a normal — ES é Sudeste mas tem alíquota reduzida", () => {
    const r = computeOrderTaxRate(CFG_PE_VERMEIO, "ES");
    expect(r.rate).toBe(15.6025);
    expect(r.motivo).toBe("interestadual");
  });

  // Varredura completa das 27 UFs, com o valor esperado escrito literalmente
  // (tirado da tabela do CONTEXT.md) — nunca derivado da própria função.
  const ESPERADO_POR_UF: Record<string, number> = {
    SP: 25.585,
    MG: 20.14, RJ: 20.14, PR: 20.14, SC: 20.14, RS: 20.14,
    ES: 15.6025,
    AC: 15.6025, AP: 15.6025, AM: 15.6025, PA: 15.6025, RO: 15.6025, RR: 15.6025, TO: 15.6025,
    AL: 15.6025, BA: 15.6025, CE: 15.6025, MA: 15.6025, PB: 15.6025, PE: 15.6025, PI: 15.6025, RN: 15.6025, SE: 15.6025,
    DF: 15.6025, GO: 15.6025, MT: 15.6025, MS: 15.6025,
  };

  it("cobre as 27 UFs exatamente", () => {
    expect(Object.keys(ESPERADO_POR_UF)).toHaveLength(27);
  });

  it.each(Object.entries(ESPERADO_POR_UF))(
    "destino %s devolve exatamente o valor esperado da tabela literal",
    (uf, esperado) => {
      const r = computeOrderTaxRate(CFG_PE_VERMEIO, uf);
      expect(r.rate).toBe(esperado);
    },
  );
});

describe("computeOrderTaxRate — destino desconhecido nunca vira a alíquota de SP (o bug do TAX-01)", () => {
  it("destino null devolve rate null e motivo destino_desconhecido — NUNCA 25.585", () => {
    const r = computeOrderTaxRate(CFG_PE_VERMEIO, null);
    expect(r.rate).toBeNull();
    expect(r.motivo).toBe("destino_desconhecido");
  });

  it("destino undefined recebe o mesmo tratamento de null", () => {
    const r = computeOrderTaxRate(CFG_PE_VERMEIO, undefined);
    expect(r.rate).toBeNull();
    expect(r.motivo).toBe("destino_desconhecido");
  });

  it("destino string vazia é ausência, não UF", () => {
    const r = computeOrderTaxRate(CFG_PE_VERMEIO, "");
    expect(r.rate).toBeNull();
    expect(r.motivo).toBe("destino_desconhecido");
  });

  it("destino só espaços é ausência, não UF", () => {
    const r = computeOrderTaxRate(CFG_PE_VERMEIO, "   ");
    expect(r.rate).toBeNull();
    expect(r.motivo).toBe("destino_desconhecido");
  });
});

describe("computeOrderTaxRate — normalização do destino", () => {
  it("destino em minúsculas é normalizado", () => {
    const r = computeOrderTaxRate(CFG_PE_VERMEIO, "mg");
    expect(r.rate).toBe(20.14);
  });

  it("destino com espaço em volta é normalizado", () => {
    const r = computeOrderTaxRate(CFG_PE_VERMEIO, " MG ");
    expect(r.rate).toBe(20.14);
  });
});

describe("computeOrderTaxRate — regimes fixos, imunes ao destino", () => {
  it("simples_nacional com destino null devolve a alíquota fixa, não null — a conta Junior é imune", () => {
    const cfg: OrderTaxConfig = {
      regime: "simples_nacional",
      uf_origem: null,
      sn_aliquota_efetiva: 6.5,
      lp_pis: null, lp_cofins: null, lp_irpj: null, lp_csll: null,
      lr_icms_aliquota_intra: null, lr_icms_aliquota_inter_sul_sudeste: null,
      lr_icms_aliquota_inter_norte_nordeste: null, lr_icms_debito: null,
    };
    const r = computeOrderTaxRate(cfg, null);
    expect(r.rate).toBe(6.5);
    expect(r.motivo).toBe("regime_fixo");
  });

  it("lucro_presumido soma os quatro componentes, também sem depender do destino", () => {
    const cfg: OrderTaxConfig = {
      regime: "lucro_presumido",
      uf_origem: null,
      sn_aliquota_efetiva: null,
      lp_pis: 0.65, lp_cofins: 3.0, lp_irpj: 1.2, lp_csll: 1.08,
      lr_icms_aliquota_intra: null, lr_icms_aliquota_inter_sul_sudeste: null,
      lr_icms_aliquota_inter_norte_nordeste: null, lr_icms_debito: null,
    };
    const r = computeOrderTaxRate(cfg, null);
    expect(r.rate).toBeCloseTo(5.93, 6);
    expect(r.motivo).toBe("regime_fixo");
  });
});

describe("computeOrderTaxRate — bordas de configuração", () => {
  it("config null devolve rate null e motivo sem_config", () => {
    const r = computeOrderTaxRate(null, "MG");
    expect(r.rate).toBeNull();
    expect(r.motivo).toBe("sem_config");
  });

  it("config undefined devolve rate null e motivo sem_config", () => {
    const r = computeOrderTaxRate(undefined, "MG");
    expect(r.rate).toBeNull();
    expect(r.motivo).toBe("sem_config");
  });

  it("lucro_real sem uf_origem mantém o comportamento antigo para destino conhecido", () => {
    const cfg: OrderTaxConfig = {
      regime: "lucro_real",
      uf_origem: null,
      sn_aliquota_efetiva: null, lp_pis: null, lp_cofins: null, lp_irpj: null, lp_csll: null,
      lr_icms_aliquota_intra: 18,
      lr_icms_aliquota_inter_sul_sudeste: 12,
      lr_icms_aliquota_inter_norte_nordeste: 7,
      lr_icms_debito: null,
    };
    const r = computeOrderTaxRate(cfg, "MG");
    expect(r.rate).toBe(20.14);
    expect(r.motivo).toBe("sem_uf_origem");
  });

  it("lucro_real sem uf_origem E com destino desconhecido devolve null", () => {
    const cfg: OrderTaxConfig = {
      regime: "lucro_real",
      uf_origem: null,
      sn_aliquota_efetiva: null, lp_pis: null, lp_cofins: null, lp_irpj: null, lp_csll: null,
      lr_icms_aliquota_intra: 18,
      lr_icms_aliquota_inter_sul_sudeste: 12,
      lr_icms_aliquota_inter_norte_nordeste: 7,
      lr_icms_debito: null,
    };
    const r = computeOrderTaxRate(cfg, null);
    expect(r.rate).toBeNull();
    expect(r.motivo).toBe("destino_desconhecido");
  });

  it("lr_icms_aliquota_intra ausente cai no fallback legado lr_icms_debito", () => {
    const cfg: OrderTaxConfig = {
      regime: "lucro_real",
      uf_origem: "SP",
      sn_aliquota_efetiva: null, lp_pis: null, lp_cofins: null, lp_irpj: null, lp_csll: null,
      lr_icms_aliquota_intra: null,
      lr_icms_aliquota_inter_sul_sudeste: null,
      lr_icms_aliquota_inter_norte_nordeste: null,
      lr_icms_debito: 18,
    };
    const r = computeOrderTaxRate(cfg, "SP");
    expect(r.rate).toBe(25.585);
    expect(r.motivo).toBe("intraestadual");
  });
});

describe("isReducedInterstateDest", () => {
  it("ES é true mesmo sendo Sudeste", () => {
    expect(isReducedInterstateDest("ES")).toBe(true);
  });

  it("Norte/Nordeste/Centro-Oeste são true", () => {
    expect(isReducedInterstateDest("AM")).toBe(true);
    expect(isReducedInterstateDest("BA")).toBe(true);
    expect(isReducedInterstateDest("GO")).toBe(true);
  });

  it("Sul/Sudeste (exceto ES) são false", () => {
    expect(isReducedInterstateDest("SP")).toBe(false);
    expect(isReducedInterstateDest("MG")).toBe(false);
    expect(isReducedInterstateDest("PR")).toBe(false);
  });

  it("ausente é false", () => {
    expect(isReducedInterstateDest(null)).toBe(false);
    expect(isReducedInterstateDest(undefined)).toBe(false);
  });
});

describe("UF_REGION", () => {
  it("tem exatamente 27 UFs", () => {
    expect(Object.keys(UF_REGION)).toHaveLength(27);
  });
});

describe("calculateEffectiveRate — a alíquota de exibição da tela de precificação não muda (Task 2)", () => {
  it("sobre a config da Pé Vermeio devolve 25.585, o mesmo número exibido hoje sem UF de destino escolhida", () => {
    const rate = calculateEffectiveRate({
      regime: "lucro_real",
      lr_icms_aliquota_intra: 18,
      lr_icms_aliquota_inter_sul_sudeste: 12,
      lr_icms_aliquota_inter_norte_nordeste: 7,
    });
    expect(rate).toBe(25.585);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fase 222 — Plano 03, Task 2: computeOrderTax — componentes, créditos e
// tax_rate derivado (FISC-01, FISC-02). DIFAL entra na Task 3; aqui os
// campos de DIFAL só existem na interface, saindo null.
// ═══════════════════════════════════════════════════════════════════════════

describe("computeOrderTax — caso-prova 2000017711929314 (Wesley conferiu à mão, SP→MG)", () => {
  const inputCasoProva: OrderTaxInput = {
    config: CFG_PE_VERMEIO,
    ufDestino: "MG",
    receitaBruta: 692.99,
    comissao: 79.69,
    frete: 30.75,
    tabelaUf: null,
  };

  it("icmsDebito · pisCofinsDebito · os três créditos · taxAmount · taxRate fecham ao centavo, no mesmo bloco", () => {
    const r = computeOrderTax(inputCasoProva);
    closeCents(r.icmsDebito, 83.16);
    closeCents(r.pisCofinsDebito, 56.41);
    closeCents(r.creditoPcComissao, 7.37);
    // D-10.2: crédito de ICMS sobre o frete (novo) e PIS/COFINS sobre o frete
    // LÍQUIDO de ICMS — 27,06, não os 30,75 cheios que a régua antiga usava.
    closeCents(r.creditoIcmsFrete, 3.69);
    closeCents(r.creditoPcFrete, 2.50);
    closeCents(r.taxAmount, 126.00);
    closeCents(r.taxRate, 18.18);
  });

  it("taxRate é derivado — igual a taxAmount dividido por receitaBruta vezes cem, não uma constante", () => {
    const r = computeOrderTax(inputCasoProva);
    expect(r.taxAmount).not.toBeNull();
    expect(r.taxRate).toBeCloseTo((r.taxAmount as number) / 692.99 * 100, 9);
  });
});

describe("computeOrderTax — créditos entram sempre, sem toggle (D-01)", () => {
  const input: OrderTaxInput = {
    config: CFG_PE_VERMEIO,
    ufDestino: "MG",
    receitaBruta: 692.99,
    comissao: 79.69,
    frete: 30.75,
    tabelaUf: null,
  };

  it("os créditos saem preenchidos sem nenhum parâmetro de ativação — a superfície de OrderTaxInput não tem campo de liga/desliga", () => {
    const r = computeOrderTax(input);
    expect(r.creditoPcComissao).not.toBeNull();
    expect(r.creditoPcFrete).not.toBeNull();
    const camposPermitidos = ["config", "ufDestino", "receitaBruta", "comissao", "frete", "tabelaUf"];
    expect(Object.keys(input).sort()).toEqual([...camposPermitidos].sort());
  });

  it("frete 0 (valor conhecido, o ML não cobrou) devolve creditoPcFrete 0, nunca null", () => {
    const r = computeOrderTax({ ...input, frete: 0 });
    expect(r.creditoPcFrete).toBe(0);
  });

  it("frete null (ausência) devolve creditoPcFrete null — distinto de frete 0", () => {
    const r = computeOrderTax({ ...input, frete: null });
    expect(r.creditoPcFrete).toBeNull();
  });

  it("comissão null (ausência) devolve creditoPcComissao null", () => {
    const r = computeOrderTax({ ...input, comissao: null });
    expect(r.creditoPcComissao).toBeNull();
  });

  it("comissão 0 (valor conhecido) devolve creditoPcComissao 0, nunca null", () => {
    const r = computeOrderTax({ ...input, comissao: 0 });
    expect(r.creditoPcComissao).toBe(0);
  });

  it("base ausente não vira crédito zero disfarçado: soma trata null como ausência de crédito, mas taxAmount continua calculável", () => {
    const r = computeOrderTax({ ...input, frete: null, comissao: null });
    expect(r.creditoPcFrete).toBeNull();
    expect(r.creditoPcComissao).toBeNull();
    expect(r.taxAmount).not.toBeNull();
    closeCents(r.taxAmount, 83.1588 + 56.4094); // só débitos, sem nenhum crédito
  });
});

describe("computeOrderTax — Simples Nacional bate com computeOrderTaxRate para a mesma entrada (a conta Junior não muda)", () => {
  const cfgSimples: OrderTaxConfig = {
    regime: "simples_nacional",
    uf_origem: null,
    sn_aliquota_efetiva: 6.5,
    lp_pis: null, lp_cofins: null, lp_irpj: null, lp_csll: null,
    lr_icms_aliquota_intra: null, lr_icms_aliquota_inter_sul_sudeste: null,
    lr_icms_aliquota_inter_norte_nordeste: null, lr_icms_debito: null,
  };

  it("taxRate bate exatamente com computeOrderTaxRate; créditos e DIFAL ficam null", () => {
    const receita = 500;
    const antigo = computeOrderTaxRate(cfgSimples, "MG");
    const r = computeOrderTax({
      config: cfgSimples,
      ufDestino: "MG",
      receitaBruta: receita,
      comissao: 40,
      frete: 20,
      tabelaUf: null,
    });
    expect(antigo.rate).not.toBeNull();
    expect(r.taxRate).toBe(antigo.rate);
    expect(r.taxAmount).toBeCloseTo(receita * ((antigo.rate as number) / 100), 9);
    expect(r.creditoPcComissao).toBeNull();
    expect(r.creditoPcFrete).toBeNull();
    expect(r.difalAmount).toBeNull();
  });

  it("destino null também bate — o destino não entra na conta do Simples", () => {
    const receita = 300;
    const antigo = computeOrderTaxRate(cfgSimples, null);
    const r = computeOrderTax({
      config: cfgSimples,
      ufDestino: null,
      receitaBruta: receita,
      comissao: null,
      frete: null,
      tabelaUf: null,
    });
    expect(r.taxRate).toBe(antigo.rate);
    expect(r.taxAmount).toBeCloseTo(receita * ((antigo.rate as number) / 100), 9);
  });
});

describe("computeOrderTax — Lucro Presumido soma os quatro componentes fixos", () => {
  const cfgPresumido: OrderTaxConfig = {
    regime: "lucro_presumido",
    uf_origem: null,
    sn_aliquota_efetiva: null,
    lp_pis: 0.65, lp_cofins: 3.0, lp_irpj: 1.2, lp_csll: 1.08,
    lr_icms_aliquota_intra: null, lr_icms_aliquota_inter_sul_sudeste: null,
    lr_icms_aliquota_inter_norte_nordeste: null, lr_icms_debito: null,
  };

  it("taxRate = 5,93 (soma fixa), taxAmount = receita × 5,93%, sem crédito e sem DIFAL", () => {
    const receita = 1000;
    const r = computeOrderTax({
      config: cfgPresumido,
      ufDestino: null,
      receitaBruta: receita,
      comissao: 50,
      frete: 10,
      tabelaUf: null,
    });
    expect(r.taxRate).toBeCloseTo(5.93, 6);
    expect(r.taxAmount).toBeCloseTo(59.3, 6);
    expect(r.creditoPcComissao).toBeNull();
    expect(r.creditoPcFrete).toBeNull();
    expect(r.difalAmount).toBeNull();
  });
});

describe("computeOrderTax — destino desconhecido (FISC-05)", () => {
  it("todos os componentes saem null, motivo destino_desconhecido — nunca zero", () => {
    const r = computeOrderTax({
      config: CFG_PE_VERMEIO,
      ufDestino: null,
      receitaBruta: 692.99,
      comissao: 79.69,
      frete: 30.75,
      tabelaUf: null,
    });
    expect(r.motivo).toBe("destino_desconhecido");
    expect(r.icmsDebito).toBeNull();
    expect(r.pisCofinsDebito).toBeNull();
    expect(r.creditoPcComissao).toBeNull();
    expect(r.creditoPcFrete).toBeNull();
    expect(r.taxAmount).toBeNull();
    expect(r.taxRate).toBeNull();
    expect(r.difalAmount).toBeNull();
    expect(r.difalBase).toBeNull();
    expect(r.fcpAmount).toBeNull();
    expect(r.difalFonte).toBeNull();
  });
});

describe("computeOrderTax — sem config", () => {
  it("motivo sem_config, tudo null — a fronteira da Fase 220 continua existindo", () => {
    const r = computeOrderTax({
      config: null,
      ufDestino: "MG",
      receitaBruta: 692.99,
      comissao: 79.69,
      frete: 30.75,
      tabelaUf: null,
    });
    expect(r.motivo).toBe("sem_config");
    expect(r.icmsDebito).toBeNull();
    expect(r.taxAmount).toBeNull();
    expect(r.taxRate).toBeNull();
    expect(r.difalAmount).toBeNull();
  });
});

describe("computeOrderTax — DIFAL ainda não ligado nesta task (Task 3 é quem liga)", () => {
  it("difalAmount, difalBase, fcpAmount e difalFonte saem null mesmo com destino conhecido e créditos calculados", () => {
    const r = computeOrderTax({
      config: CFG_PE_VERMEIO,
      ufDestino: "MG",
      receitaBruta: 692.99,
      comissao: 79.69,
      frete: 30.75,
      tabelaUf: null,
    });
    expect(r.taxAmount).not.toBeNull();
    expect(r.difalAmount).toBeNull();
    expect(r.difalBase).toBeNull();
    expect(r.fcpAmount).toBeNull();
    expect(r.difalFonte).toBeNull();
  });
});

describe("computeOrderTax — sem crédito (comissão e frete = 0), a decomposição bate com computeOrderTaxRate para as 27 UFs", () => {
  // Prova de regressão: quando não há base de crédito, taxAmount vira a
  // MESMA conta que computeOrderTaxRate já fazia — a decomposição não é uma
  // fórmula nova, é a mesma fórmula quebrada em componentes.
  const ESPERADO_POR_UF: Record<string, number> = {
    SP: 25.585,
    MG: 20.14, RJ: 20.14, PR: 20.14, SC: 20.14, RS: 20.14,
    ES: 15.6025,
    AC: 15.6025, AP: 15.6025, AM: 15.6025, PA: 15.6025, RO: 15.6025, RR: 15.6025, TO: 15.6025,
    AL: 15.6025, BA: 15.6025, CE: 15.6025, MA: 15.6025, PB: 15.6025, PE: 15.6025, PI: 15.6025, RN: 15.6025, SE: 15.6025,
    DF: 15.6025, GO: 15.6025, MT: 15.6025, MS: 15.6025,
  };

  it.each(Object.entries(ESPERADO_POR_UF))(
    "destino %s: taxRate sem crédito bate com a alíquota antiga (%s)",
    (uf, esperado) => {
      const r = computeOrderTax({
        config: CFG_PE_VERMEIO,
        ufDestino: uf,
        receitaBruta: 1000,
        comissao: 0,
        frete: 0,
        tabelaUf: null,
      });
      expect(r.creditoPcComissao).toBe(0);
      expect(r.creditoPcFrete).toBe(0);
      expect(r.taxRate).toBeCloseTo(esperado, 6);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Fase 222 — Plano 03-R: DIFAL por BASE SIMPLES (D-08), créditos de D-10 e as
// guardas de ausência (FISC-03, FISC-05, FISC-07).
//
// A régua mudou em 13/08/2026: a planilha de precificação da Pé Vermeio virou
// a fonte fiscal, e a contadora confirmou os pontos de D-10. Ver 222-CONTEXT.md.
// ═══════════════════════════════════════════════════════════════════════════

/** MG nacional: interestadual 12%, DIFAL 6% — direto da planilha (D-09). */
const TABELA_MG_CONFIRMADA = {
  MG: { nacional: { aliqInterestadual: 12, pctDifal: 6, fcp: 0, confirmado: true } },
};

const INPUT_CASO_PROVA_DIFAL: OrderTaxInput = {
  config: CFG_PE_VERMEIO,
  ufDestino: "MG",
  receitaBruta: 692.99,
  comissao: 79.69,
  frete: 30.75,
  tabelaUf: TABELA_MG_CONFIRMADA,
};

describe("computeOrderTax — caso-prova 2000017711929314 na régua D-08/D-10 (base simples)", () => {
  it("DIFAL = receita × pct, sem base dupla: 692,99 × 6% ≈ 41,58", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.difalBase, 692.99); // base SIMPLES é a própria receita
    closeCents(r.difalAmount, 41.58);
  });

  it("imposto COM DIFAL ≈ 163,74 e alíquota implícita ≈ 23,63%", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.taxAmountComDifal, 163.74);
    expect(r.taxRateComDifal).not.toBeNull();
    expect(Math.abs((r.taxRateComDifal as number) - 23.63)).toBeLessThan(0.01);
  });

  it("taxAmount continua sendo o cenário SEM DIFAL ≈ 126,00 — nunca soma difalAmount por dentro", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.taxAmount, 126.00);
    expect(r.taxAmountComDifal).not.toBeCloseTo(r.taxAmount as number, 1);
  });

  it("a base DUPLA daria ≈ 50,71 — e NÃO é esse o número devolvido (a régua mudou em 13/08)", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    const icmsDebito = r.icmsDebito as number;
    const difalComBaseDupla = ((692.99 - icmsDebito) / (1 - 0.18)) * 0.18 - icmsDebito;
    expect(difalComBaseDupla).toBeGreaterThan((r.difalAmount as number) + 1);
    closeCents(difalComBaseDupla, 50.71);
  });

  it("D-10.1: a base do PIS/COFINS COM DIFAL desconta o DIFAL; a SEM DIFAL, não", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    const icms = r.icmsDebito as number;
    const difal = r.difalAmount as number;
    closeCents(r.pisCofinsDebito, (692.99 - icms) * 0.0925);
    closeCents(r.pisCofinsDebitoComDifal, (692.99 - icms - difal) * 0.0925);
    expect(r.pisCofinsDebitoComDifal as number).toBeLessThan(r.pisCofinsDebito as number);
  });

  it("D-10.2: existe crédito de ICMS sobre o frete, e o PIS/COFINS do frete usa base líquida de ICMS", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.creditoIcmsFrete, 30.75 * 0.12); // 3,69
    closeCents(r.creditoPcFrete, (30.75 - 3.69) * 0.0925); // sobre 27,06, não sobre 30,75
    // o frete cheio daria um crédito maior — provar que não é esse
    expect(r.creditoPcFrete as number).toBeLessThan(30.75 * 0.0925);
  });

  it("crédito de comissão sem rebate = comissão cheia × 9,25%", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.creditoPcComissao, 79.69 * 0.0925);
  });

  it("DIFAL não gera crédito — nenhum dos três créditos varia quando o DIFAL entra", () => {
    const comDifal = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    const semDifal = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, tabelaUf: {} });
    expect(semDifal.creditoPcComissao).toBe(comDifal.creditoPcComissao);
    expect(semDifal.creditoPcFrete).toBe(comDifal.creditoPcFrete);
    expect(semDifal.creditoIcmsFrete).toBe(comDifal.creditoIcmsFrete);
  });
});

describe("computeOrderTax — D-10.3: a comissão JÁ chega líquida de rebate", () => {
  // Medido em 14/08/2026 contra a API do ML e os pedidos reais: o ML abate a
  // parte dele da promoção cofinanciada na PRÓPRIA comissão, antes de reportar
  // o `sale_fee` de onde `orders.comissao` nasce. MLB7070651566: 11,00% fora da
  // promoção × 6,10% dentro. Logo D-10.3 está satisfeita pelo dado, e subtrair
  // um rebate aqui seria dupla contagem.

  it("o crédito de comissão é a comissão gravada × 9,25% — sem nenhum abatimento extra", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.creditoPcComissao, 79.69 * 0.0925);
  });

  it("comissão menor (pedido em promoção cofinanciada) gera crédito proporcionalmente menor", () => {
    // 21,90 é a comissão real de MLB7070651566 dentro da promoção (era 39,48
    // pela alíquota cheia). O crédito acompanha o que o ML cobrou, não o cheio.
    const emPromocao = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, comissao: 21.9 });
    closeCents(emPromocao.creditoPcComissao, 21.9 * 0.0925);
  });

  it("NÃO existe parâmetro `rebate` — passá-lo não pode alterar o resultado", () => {
    // Guarda contra reintrodução: se alguém voltar a aceitar `rebate` no input,
    // este teste passa a falhar e a dupla contagem é pega antes do deploy.
    const base = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    const comCampoIntruso = computeOrderTax(
      { ...INPUT_CASO_PROVA_DIFAL, rebate: 20 } as unknown as Parameters<typeof computeOrderTax>[0],
    );
    expect(comCampoIntruso.creditoPcComissao).toBe(base.creditoPcComissao);
    expect(comCampoIntruso.taxAmount).toBe(base.taxAmount);
  });
});

describe("computeOrderTax — D-11: procedência escolhe a linha da tabela", () => {
  const TABELA_MG_DUAS_PROCEDENCIAS = {
    MG: {
      nacional:  { aliqInterestadual: 12, pctDifal: 6, fcp: 0,  confirmado: true },
      importado: { aliqInterestadual: 4,  pctDifal: 14, fcp: 0, confirmado: true },
    },
  };

  it("sem procedência informada usa nacional — comportamento idêntico ao de antes da fase", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, tabelaUf: TABELA_MG_DUAS_PROCEDENCIAS });
    closeCents(r.difalAmount, 692.99 * 0.06);
  });

  it("procedência importado usa a linha de 4% e o DIFAL maior", () => {
    const r = computeOrderTax({
      ...INPUT_CASO_PROVA_DIFAL,
      tabelaUf: TABELA_MG_DUAS_PROCEDENCIAS,
      procedencia: "importado",
    });
    closeCents(r.difalAmount, 692.99 * 0.14);
  });

  it("UF sem a procedência pedida → uf_fora_da_tabela, nunca cai para a outra procedência em silêncio", () => {
    const r = computeOrderTax({
      ...INPUT_CASO_PROVA_DIFAL,
      tabelaUf: TABELA_MG_CONFIRMADA, // só tem nacional
      procedencia: "importado",
    });
    expect(r.difalMotivoAusencia).toBe("uf_fora_da_tabela");
    expect(r.difalAmount).toBeNull();
  });
});

describe("computeOrderTax — as cinco guardas de ausência do DIFAL, nenhuma delas aceitando zero (FISC-05)", () => {
  it("destino desconhecido → difalMotivoAusencia destino_desconhecido, difalAmount null (nunca zero)", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, ufDestino: null });
    expect(r.difalMotivoAusencia).toBe("destino_desconhecido");
    expect(r.difalAmount).toBeNull();
    expect(r.difalAmount).not.toBe(0);
  });

  it("pedido intraestadual (origem igual ao destino) → difalMotivoAusencia intraestadual, difalAmount null", () => {
    const r = computeOrderTax({
      ...INPUT_CASO_PROVA_DIFAL,
      ufDestino: "SP",
      tabelaUf: { SP: { nacional: { aliqInterestadual: 18, pctDifal: 0, fcp: 0, confirmado: true } } },
    });
    expect(r.motivo).toBe("intraestadual");
    expect(r.difalMotivoAusencia).toBe("intraestadual");
    expect(r.difalAmount).toBeNull();
    expect(r.difalAmount).not.toBe(0);
    // O imposto base continua calculado normalmente — só o DIFAL fica ausente.
    expect(r.taxAmount).not.toBeNull();
  });

  it("regime diferente de lucro_real → difalMotivoAusencia regime_nao_aplicavel, difalAmount null", () => {
    const cfgSimples: OrderTaxConfig = {
      regime: "simples_nacional",
      uf_origem: null,
      sn_aliquota_efetiva: 6.5,
      lp_pis: null, lp_cofins: null, lp_irpj: null, lp_csll: null,
      lr_icms_aliquota_intra: null, lr_icms_aliquota_inter_sul_sudeste: null,
      lr_icms_aliquota_inter_norte_nordeste: null, lr_icms_debito: null,
    };
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, config: cfgSimples });
    expect(r.difalMotivoAusencia).toBe("regime_nao_aplicavel");
    expect(r.difalAmount).toBeNull();
    expect(r.difalAmount).not.toBe(0);
  });

  it("UF sem linha na tabela recebida → difalMotivoAusencia uf_fora_da_tabela, difalAmount null", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, tabelaUf: {} });
    expect(r.difalMotivoAusencia).toBe("uf_fora_da_tabela");
    expect(r.difalAmount).toBeNull();
    expect(r.difalAmount).not.toBe(0);
    // O imposto base continua calculado normalmente — só o DIFAL fica ausente.
    expect(r.taxAmount).not.toBeNull();
  });

  it("UF com linha não confirmada por nenhuma fonte → difalMotivoAusencia uf_nao_confirmada, difalAmount null", () => {
    const r = computeOrderTax({
      ...INPUT_CASO_PROVA_DIFAL,
      tabelaUf: { MG: { nacional: { aliqInterestadual: 12, pctDifal: 6, fcp: 0, confirmado: false } } },
    });
    expect(r.difalMotivoAusencia).toBe("uf_nao_confirmada");
    expect(r.difalAmount).toBeNull();
    expect(r.difalAmount).not.toBe(0);
    expect(r.taxAmount).not.toBeNull();
  });
});

describe("computeOrderTax — FCP embutido no percentual (D-09), nunca somado à parte", () => {
  it("fcpAmount é 0 quando há DIFAL — valor conhecido, não ausência", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    expect(r.fcpAmount).toBe(0);
    expect(r.fcpAmount).not.toBeNull();
  });

  it("RJ a 10% já embute os 2 pp de FCP — o DIFAL sai de um percentual só", () => {
    const r = computeOrderTax({
      ...INPUT_CASO_PROVA_DIFAL,
      ufDestino: "RJ",
      tabelaUf: { RJ: { nacional: { aliqInterestadual: 12, pctDifal: 10, fcp: 0, confirmado: true } } },
    });
    closeCents(r.difalAmount, 692.99 * 0.10);
    expect(r.fcpAmount).toBe(0);
  });
});

describe("computeOrderTax — procedência do DIFAL, os estados de D-07 sobre o MESMO pedido", () => {
  it("lista de UFs cobradas pelo ML nula (222-02 ainda não cruzou) → nao_conciliado", () => {
    const cfg: OrderTaxConfig = { ...CFG_PE_VERMEIO, difal_ufs_cobradas_pelo_ml: null };
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, config: cfg });
    expect(r.difalFonte).toBe("nao_conciliado");
    expect(r.difalAmount).not.toBeNull();
  });

  it("lista preenchida (inclusive vazia) e sem a UF de destino → calculado", () => {
    const cfg: OrderTaxConfig = { ...CFG_PE_VERMEIO, difal_ufs_cobradas_pelo_ml: [] };
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, config: cfg });
    expect(r.difalFonte).toBe("calculado");

    const cfg2: OrderTaxConfig = { ...CFG_PE_VERMEIO, difal_ufs_cobradas_pelo_ml: ["RJ", "SC"] };
    const r2 = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, config: cfg2 });
    expect(r2.difalFonte).toBe("calculado");
  });

  it("lista preenchida e contém a UF de destino → cobrado_ml", () => {
    const cfg: OrderTaxConfig = { ...CFG_PE_VERMEIO, difal_ufs_cobradas_pelo_ml: ["MG"] };
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, config: cfg });
    expect(r.difalFonte).toBe("cobrado_ml");
    // O valor calculado continua existindo como previsão informativa.
    expect(r.difalAmount).not.toBeNull();
  });

  it("comparação de sigla é insensível a caixa e a espaço em branco", () => {
    const cfg: OrderTaxConfig = { ...CFG_PE_VERMEIO, difal_ufs_cobradas_pelo_ml: [" mg "] };
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, config: cfg });
    expect(r.difalFonte).toBe("cobrado_ml");
  });

  it("difalFonte nunca é dois estados ao mesmo tempo — é um campo só, não vários booleanos", () => {
    const cfgCobrado: OrderTaxConfig = { ...CFG_PE_VERMEIO, difal_ufs_cobradas_pelo_ml: ["MG"] };
    const rCobrado = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, config: cfgCobrado });
    expect(rCobrado.difalFonte).toBe("cobrado_ml");
    expect(rCobrado.difalFonte).not.toBe("calculado");
    expect(rCobrado.difalFonte).not.toBe("documento_fiscal");

    const cfgCalculado: OrderTaxConfig = { ...CFG_PE_VERMEIO, difal_ufs_cobradas_pelo_ml: ["RJ"] };
    const rCalculado = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, config: cfgCalculado });
    expect(rCalculado.difalFonte).toBe("calculado");
    expect(rCalculado.difalFonte).not.toBe("cobrado_ml");
  });

  it("D-12: documento_fiscal é um valor VÁLIDO do tipo — reservado para a Fase 223, ninguém escreve nele ainda", () => {
    const reservado: DifalFonte = "documento_fiscal";
    expect(reservado).toBe("documento_fiscal");
    // Nenhum caminho de computeOrderTax pode produzi-lo hoje.
    const estados = [null, [], ["MG"], ["RJ"]].map((lista) =>
      computeOrderTax({
        ...INPUT_CASO_PROVA_DIFAL,
        config: { ...CFG_PE_VERMEIO, difal_ufs_cobradas_pelo_ml: lista as string[] | null },
      }).difalFonte
    );
    expect(estados).not.toContain("documento_fiscal");
  });
});
