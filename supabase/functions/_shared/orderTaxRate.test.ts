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
  reguaApurouNestaRodada,
  camposFiscaisParaUpsert,
  TAX_VERSAO_REGUA_NOVA,
  ehPosicaoCredora,
  liquidoSemDifalBruto,
  type OrderTaxConfig,
  type OrderTaxInput,
  type OrderTaxBreakdown,
  type TabelaDifal,
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
    // D-R2-01 (19/08): a base do crédito da comissão passou a ser a comissão
    // LÍQUIDA do ICMS de referência — 70,1272, não os 79,69 cheios. O crédito
    // caiu de 7,371325 para 6,486766, e com ele o imposto subiu R$ 0,88.
    closeCents(r.creditoPcComissao, 6.486766);
    // D-10.2: crédito de ICMS sobre o frete (novo) e PIS/COFINS sobre o frete
    // LÍQUIDO de ICMS — 27,06, não os 30,75 cheios que a régua antiga usava.
    closeCents(r.creditoIcmsFrete, 3.69);
    closeCents(r.creditoPcFrete, 2.50);
    // D-R2-01: era 126,003811 na régua da comissão cheia.
    closeCents(r.taxAmount, 126.88837);
    closeCents(r.taxRate, 18.310274);
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

  it("imposto COM DIFAL ≈ 164,62 e alíquota implícita ≈ 23,76%", () => {
    // D-R2-01: era 163,737116 / 23,63% na régua da comissão cheia. O DIFAL não
    // mudou (41,5794) — o que mudou foi o crédito da comissão.
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.taxAmountComDifal, 164.621676);
    expect(r.taxRateComDifal).not.toBeNull();
    expect(Math.abs((r.taxRateComDifal as number) - 23.755274)).toBeLessThan(0.01);
  });

  it("taxAmount continua sendo o cenário SEM DIFAL ≈ 126,89 — nunca soma difalAmount por dentro", () => {
    // D-R2-01: era 126,003811. A composição não mudou — o DIFAL continua
    // entrando POR CIMA, em taxAmountComDifal, nunca por dentro de taxAmount.
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.taxAmount, 126.88837);
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

  it("crédito de comissão sem rebate = comissão LÍQUIDA do ICMS de referência × 9,25% (D-R2-01)", () => {
    // Revogado em 19/08: a base era a comissão cheia (79,69 × 9,25% = 7,371325).
    // Agora é 79,69 − 79,69×12% = 70,1272, e o crédito é 6,486766.
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.creditoPcComissao, (79.69 - 79.69 * 0.12) * 0.0925);
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

  it("o crédito nasce da comissão GRAVADA — sem nenhum abatimento de rebate por cima (D-R2-01 muda a base, não a tese)", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.creditoPcComissao, (79.69 - 79.69 * 0.12) * 0.0925);
  });

  it("comissão menor (pedido em promoção cofinanciada) gera crédito proporcionalmente menor", () => {
    // 21,90 é a comissão real de MLB7070651566 dentro da promoção (era 39,48
    // pela alíquota cheia). O crédito acompanha o que o ML cobrou, não o cheio.
    const emPromocao = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, comissao: 21.9 });
    // D-R2-01: a base é a comissão líquida do ICMS de referência, e ela
    // acompanha proporcionalmente a comissão menor.
    closeCents(emPromocao.creditoPcComissao, (21.9 - 21.9 * 0.12) * 0.0925);
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

// ⚠️ Este bloco afirmava a régua REVOGADA por D-R2-03 ("RJ a 10% já embute os
// 2 pp de FCP — o DIFAL sai de um percentual só"). A planilha oficial diz que a
// interna do RJ é 20, não 22: os 2 pp presumidos nunca existiram, e o RJ oficial
// é 20 − 12 = 8 de DIFAL, com FCP em campo próprio (222-10-R2 corrigiu a seed).
// O bloco foi reescrito para afirmar o contrário do que afirmava.
describe("computeOrderTax — FCP é parcela PRÓPRIA (D-R2-03), calculada do campo da tabela", () => {
  it("fcpAmount é 0 quando a tabela traz FCP 0 — valor conhecido, e agora porque a FONTE diz zero", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    expect(r.fcpAmount).toBe(0);
    expect(r.fcpAmount).not.toBeNull();
  });

  it("RJ pela folha oficial: 20 − 12 = 8 de DIFAL, e o FCP NÃO está embutido nesse percentual", () => {
    const r = computeOrderTax({
      ...INPUT_CASO_PROVA_DIFAL,
      ufDestino: "RJ",
      tabelaUf: { RJ: { nacional: { aliqInterestadual: 12, pctDifal: 8, fcp: 0, confirmado: true } } },
    });
    closeCents(r.difalAmount, 692.99 * 0.08);
    expect(r.fcpAmount).toBe(0);
    // A régua antiga daria 69,299 (10%) — 5,54 a mais de DIFAL inventado.
    expect(Math.abs((r.difalAmount as number) - 692.99 * 0.10)).toBeGreaterThan(1);
  });

  it("quando uma UF ganhar FCP, ele soma À PARTE — o percentual do DIFAL não se mexe", () => {
    const rj = (fcp: number): OrderTaxInput => ({
      ...INPUT_CASO_PROVA_DIFAL,
      ufDestino: "RJ",
      tabelaUf: { RJ: { nacional: { aliqInterestadual: 12, pctDifal: 8, fcp, confirmado: true } } },
    });
    const semFcp = computeOrderTax(rj(0));
    const comFcp = computeOrderTax(rj(2));
    expect(comFcp.difalAmount).toBe(semFcp.difalAmount);
    closeCents(comFcp.fcpAmount, 692.99 * 0.02);
    expect(comFcp.taxAmountComDifal as number).toBeGreaterThan(semFcp.taxAmountComDifal as number);
    // E o cenário SEM DIFAL segue intocado pelo FCP.
    expect(comFcp.taxAmount).toBe(semFcp.taxAmount);
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

// ═══════════════════════════════════════════════════════════════════════════
// Fase 222 — Plano 12-R2: a régua que a CONTADORA APROVOU.
//
// Rodando o módulo fiscal do arquivo aprovado e o nosso no MESMO pedido real,
// uma única linha divergia — a base do crédito da comissão. Estes blocos
// fecham as três decisões de R2 que faltavam (222-CONTEXT-R2.md):
//
//   D-R2-01  a base do crédito de PIS/COFINS sobre a comissão é a comissão
//            LÍQUIDA de um ICMS de referência, que NÃO é crédito
//   D-R2-03  o FCP é parcela própria, calculada do campo da tabela de UF,
//            e não mais presunção embutida no percentual do DIFAL
//   D-R2-04  o frete pago pelo COMPRADOR entra em dois lugares: soma na base
//            tributável (a NF-e cobre produto + frete cobrado do cliente) e
//            soma ao frete do vendedor para formar o frete total do crédito
//
// 🔴 A ÂNCORA: `icmsDebito + pisCofinsDebito` do caso-prova tem de continuar
// dando 139,568186 — é o `orders.tax_amount` gravado hoje em produção. Se uma
// mudança move a BASE, ela quebra a fase inteira, não só um teste.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Soma dos créditos que de fato ABATEM o imposto. `icmsRefComissao`
 * deliberadamente não está aqui: comissão é prestação de serviço e não gera
 * crédito de ICMS de fato (D-R2-01). Se ele entrasse, o total viraria
 * 22,242616 em vez de 12,679816 — crédito inventado (T-222-R2-11).
 */
const somaCreditos = (r: OrderTaxBreakdown): number =>
  (r.creditoIcmsFrete ?? 0) + (r.creditoPcFrete ?? 0) + (r.creditoPcComissao ?? 0);

/**
 * R$ 39,82 — não é número inventado: é o "Envio pago pelo comprador" medido
 * numa botina no relatório de conciliação do ML de 31/07 (D-R2-04).
 */
const FRETE_COMPRADOR_MEDIDO = 39.82;

describe("computeOrderTax — D-R2-01: o crédito da comissão nasce da comissão LÍQUIDA de um ICMS de referência", () => {
  it("caso-prova cenário A: ICMS de referência 9,562800 · base 70,127200 · crédito 6,486766 (era 7,371325)", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    expect(typeof r.icmsRefComissao).toBe("number");
    expect(typeof r.creditoComissaoBase).toBe("number");
    closeCents(r.icmsRefComissao, 9.5628);
    closeCents(r.creditoComissaoBase, 70.1272);
    closeCents(r.creditoPcComissao, 6.486766);
    // A régua antiga (comissão CHEIA) dava 7,371325 — 0,88 a mais de crédito
    // por pedido de Lucro Real interestadual. Provar que não é mais esse.
    expect(Math.abs((r.creditoPcComissao as number) - 79.69 * 0.0925)).toBeGreaterThan(0.5);
  });

  it("caso-prova cenário A: imposto SEM DIFAL 126,888370 e COM DIFAL 164,621676", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(r.taxAmount, 126.88837);
    closeCents(r.taxAmountComDifal, 164.621676);
    closeCents(r.taxRate, 18.310274);
    closeCents(r.taxRateComDifal, 23.755274);
  });

  it("T-222-R2-11: o ICMS de referência NÃO entra no total de créditos — 12,679816, jamais 22,242616", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    closeCents(somaCreditos(r), 12.679816);
    // 22,242616 é exatamente o total que sairia se icmsRefComissao fosse somado.
    expect(Math.abs(somaCreditos(r) - 22.242616)).toBeGreaterThan(1);
    // E a identidade fecha: débitos − créditos = taxAmount, sem sobra nenhuma.
    expect(
      (r.icmsDebito as number) + (r.pisCofinsDebito as number) - somaCreditos(r),
    ).toBeCloseTo(r.taxAmount as number, 9);
  });

  it("comissão zero (valor conhecido): ICMS de referência 0, base 0 e crédito 0 — nunca negativo", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, comissao: 0 });
    expect(r.icmsRefComissao).toBe(0);
    expect(r.creditoComissaoBase).toBe(0);
    expect(r.creditoPcComissao).toBe(0);
    expect(r.creditoComissaoBase as number).not.toBeLessThan(0);
  });

  it("comissão ausente: os três campos ficam null — ausência não vira zero (FISC-05)", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, comissao: null });
    expect(r.icmsRefComissao).toBeNull();
    expect(r.creditoComissaoBase).toBeNull();
    expect(r.creditoPcComissao).toBeNull();
  });

  it("venda intraestadual: o ICMS de referência usa a alíquota INTERNA da config (18%), não a interestadual", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, ufDestino: "SP" });
    expect(r.motivo).toBe("intraestadual");
    closeCents(r.icmsRefComissao, 79.69 * 0.18); // 14,3442 — não 9,5628
    closeCents(r.creditoComissaoBase, 65.3458);
    closeCents(r.creditoPcComissao, 6.044486);
  });

  it("a guarda de tabela ausente não engole os campos novos: sem DIFAL, o crédito da comissão continua inteiro", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, tabelaUf: {} });
    expect(r.difalMotivoAusencia).toBe("uf_fora_da_tabela");
    closeCents(r.icmsRefComissao, 9.5628);
    closeCents(r.creditoComissaoBase, 70.1272);
    closeCents(r.creditoPcComissao, 6.486766);
    closeCents(r.taxAmount, 126.88837);
  });
});

describe("computeOrderTax — D-R2-03: o FCP é parcela PRÓPRIA, calculada do campo da tabela de UF", () => {
  const tabelaMg = (fcp: number): TabelaDifal => ({
    MG: { nacional: { aliqInterestadual: 12, pctDifal: 6, fcp, confirmado: true } },
  });

  it("UF com FCP zero na tabela: fcpAmount é 0 (valor conhecido, não nulo) e o imposto com DIFAL não muda", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, tabelaUf: tabelaMg(0) });
    expect(r.fcpAmount).toBe(0);
    expect(r.fcpAmount).not.toBeNull();
    closeCents(r.taxAmountComDifal, 164.621676);
  });

  it("UF com FCP 2: fcpAmount = base × 2% = 13,859800, entra no imposto com DIFAL E reduz a base do PIS/COFINS com DIFAL", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, tabelaUf: tabelaMg(2) });
    closeCents(r.fcpAmount, 13.8598);
    // (692,99 − 83,1588 − 41,5794 − 13,8598) × 9,25% — o FCP deduz junto com o DIFAL
    closeCents(r.pisCofinsDebitoComDifal, 51.28126);
    closeCents(r.taxAmountComDifal, 177.199444);
  });

  it("o FCP vive só no cenário COM DIFAL: taxAmount, pisCofinsDebito e a âncora não sentem o FCP", () => {
    const semFcp = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, tabelaUf: tabelaMg(0) });
    const comFcp = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, tabelaUf: tabelaMg(2) });
    expect(comFcp.taxAmount).toBe(semFcp.taxAmount);
    expect(comFcp.pisCofinsDebito).toBe(semFcp.pisCofinsDebito);
    expect(comFcp.icmsDebito).toBe(semFcp.icmsDebito);
    closeCents(comFcp.taxAmount, 126.88837);
    expect(comFcp.taxAmountComDifal as number).toBeGreaterThan(semFcp.taxAmountComDifal as number);
  });

  it("linha sem FCP válido não vira FCP zero: o DIFAL sai ausente com uf_fora_da_tabela (FISC-05)", () => {
    const semFcp = {
      MG: { nacional: { aliqInterestadual: 12, pctDifal: 6, confirmado: true } },
    } as unknown as TabelaDifal;
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, tabelaUf: semFcp });
    expect(r.difalMotivoAusencia).toBe("uf_fora_da_tabela");
    expect(r.difalAmount).toBeNull();
    expect(r.fcpAmount).toBeNull();
    expect(r.fcpAmount).not.toBe(0);
    // O imposto base continua calculado normalmente — só o DIFAL fica ausente.
    closeCents(r.taxAmount, 126.88837);
  });

  it("FCP não finito também descarta a linha inteira, nunca propaga NaN para a soma", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, tabelaUf: tabelaMg(Number.NaN) });
    expect(r.difalMotivoAusencia).toBe("uf_fora_da_tabela");
    expect(r.difalAmount).toBeNull();
    expect(r.fcpAmount).toBeNull();
    expect(Number.isNaN(r.taxAmount as number)).toBe(false);
  });
});

describe("computeOrderTax — D-R2-04: o frete pago pelo COMPRADOR entra em dois lugares", () => {
  const COM_FRETE_COMPRADOR: OrderTaxInput = {
    ...INPUT_CASO_PROVA_DIFAL,
    freteComprador: FRETE_COMPRADOR_MEDIDO,
  };

  it("cenário B, lugar 1 (base tributável): base 732,81 · ICMS 87,937200 · DIFAL 43,968600 · PIS/COFINS 59,650734", () => {
    const r = computeOrderTax(COM_FRETE_COMPRADOR);
    closeCents(r.icmsDebito, 87.9372);
    closeCents(r.pisCofinsDebito, 59.650734);
    closeCents(r.difalBase, 732.81); // base do DIFAL também é a tributável
    closeCents(r.difalAmount, 43.9686);
    closeCents(r.pisCofinsDebitoComDifal, 55.583639);
  });

  it("cenário B, lugar 2 (frete total 70,57): crédito de ICMS 8,468400 e de PIS/COFINS 5,744398", () => {
    const r = computeOrderTax(COM_FRETE_COMPRADOR);
    closeCents(r.creditoIcmsFrete, 8.4684);
    closeCents(r.creditoPcFrete, 5.744398);
    closeCents(somaCreditos(r), 20.699564);
  });

  it("cenário B: o crédito da comissão NÃO se move — a comissão não tem frete na base", () => {
    const r = computeOrderTax(COM_FRETE_COMPRADOR);
    closeCents(r.icmsRefComissao, 9.5628);
    closeCents(r.creditoComissaoBase, 70.1272);
    closeCents(r.creditoPcComissao, 6.486766);
  });

  it("cenário B: imposto SEM DIFAL 126,888370 (o mesmo do cenário A) e COM DIFAL 166,789875", () => {
    const r = computeOrderTax(COM_FRETE_COMPRADOR);
    closeCents(r.taxAmount, 126.88837);
    closeCents(r.taxAmountComDifal, 166.789875);
  });

  it("INVARIANTE DE NEUTRALIDADE: variando só o frete do comprador, taxAmount e taxRate são IDÊNTICOS; com DIFAL a diferença é 2,168199", () => {
    const a = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, freteComprador: 0 });
    const b = computeOrderTax(COM_FRETE_COMPRADOR);

    // Sem DIFAL ele é exatamente neutro: soma o mesmo valor ao débito e ao
    // crédito, porque a alíquota do débito e a do crédito de frete são a mesma.
    expect(b.taxAmount).toBeCloseTo(a.taxAmount as number, 9);
    expect(b.taxRate).toBeCloseTo(a.taxRate as number, 9);
    closeCents(a.taxAmount, 126.88837);
    closeCents(b.taxAmount, 126.88837);

    // Com DIFAL ele NÃO é neutro: o DIFAL incide sobre a base e não gera crédito.
    const custoDoDifal = (b.taxAmountComDifal as number) - (a.taxAmountComDifal as number);
    expect(Math.abs(custoDoDifal - 2.168199)).toBeLessThan(1e-4);
    expect(custoDoDifal).toBeGreaterThan(0);
  });

  it("frete do comprador nulo dá os MESMOS números que zero, mas marca a base como incompleta (T-222-R2-13)", () => {
    const zero = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, freteComprador: 0 });
    const ausente = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, freteComprador: null });

    expect(ausente.taxAmount).toBe(zero.taxAmount);
    expect(ausente.taxAmountComDifal).toBe(zero.taxAmountComDifal);
    expect(ausente.icmsDebito).toBe(zero.icmsDebito);

    // A diferença não está no número — está na declaração de que ele saiu de
    // uma base que podia estar incompleta.
    expect(zero.baseIncompleta).toBe(false);
    expect(ausente.baseIncompleta).toBe(true);
  });

  it("frete do comprador simplesmente não informado é ausência, igual a null", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL); // sem a chave freteComprador
    expect(r.baseIncompleta).toBe(true);
    closeCents(r.taxAmount, 126.88837);
  });

  it.each([
    ["negativo", -39.82],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["texto", "39.82" as unknown as number],
  ])("frete do comprador %s é tratado como ausência — nunca somado à base", (_nome, valor) => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, freteComprador: valor as number });
    closeCents(r.icmsDebito, 83.1588); // base continua 692,99
    closeCents(r.taxAmount, 126.88837);
    expect(r.baseIncompleta).toBe(true);
  });

  it("frete do vendedor ausente e do comprador presente: o frete total é só o do comprador, e os dois créditos saem dele", () => {
    const r = computeOrderTax({
      ...INPUT_CASO_PROVA_DIFAL,
      frete: null,
      freteComprador: FRETE_COMPRADOR_MEDIDO,
    });
    closeCents(r.creditoIcmsFrete, 4.7784); // 39,82 × 12%
    closeCents(r.creditoPcFrete, 3.241348); // (39,82 − 4,7784) × 9,25%
    expect(r.baseIncompleta).toBe(false);
  });

  it("os dois fretes ausentes mantêm os créditos de frete NULL — ausência dupla não vira frete total zero", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, frete: null, freteComprador: null });
    expect(r.creditoIcmsFrete).toBeNull();
    expect(r.creditoPcFrete).toBeNull();
    expect(r.taxAmount).not.toBeNull();
  });
});

describe("computeOrderTax — a ÂNCORA de produção e a não-regressão dos outros regimes", () => {
  it("ÂNCORA: ICMS débito + PIS/COFINS débito = 139,568186 — e é exatamente taxAmount + os três créditos", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    // Este é o orders.tax_amount gravado hoje em produção. Se ele se mover,
    // a mudança moveu a BASE e quebrou a fase.
    closeCents((r.icmsDebito as number) + (r.pisCofinsDebito as number), 139.568186);
    // A mesma âncora vista do outro lado: só os créditos mudaram nesta rodada.
    closeCents((r.taxAmount as number) + somaCreditos(r), 139.568186);
  });

  it("ÂNCORA: frete do comprador ZERO não a move — 139,568186 com 0 e sem o campo", () => {
    const semCampo = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    const comZero = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, freteComprador: 0 });
    closeCents((semCampo.icmsDebito as number) + (semCampo.pisCofinsDebito as number), 139.568186);
    closeCents((comZero.icmsDebito as number) + (comZero.pisCofinsDebito as number), 139.568186);
    closeCents((comZero.taxAmount as number) + somaCreditos(comZero), 139.568186);
  });

  it("Simples Nacional: resultado idêntico com e sem frete do comprador — a conta do Junior não se move", () => {
    const cfgSimples: OrderTaxConfig = {
      regime: "simples_nacional",
      uf_origem: null,
      sn_aliquota_efetiva: 6.5,
      lp_pis: null, lp_cofins: null, lp_irpj: null, lp_csll: null,
      lr_icms_aliquota_intra: null, lr_icms_aliquota_inter_sul_sudeste: null,
      lr_icms_aliquota_inter_norte_nordeste: null, lr_icms_debito: null,
    };
    const base: OrderTaxInput = {
      config: cfgSimples, ufDestino: "MG", receitaBruta: 692.99,
      comissao: 79.69, frete: 30.75, tabelaUf: TABELA_MG_CONFIRMADA,
    };
    const semFc = computeOrderTax(base);
    const comFc = computeOrderTax({ ...base, freteComprador: FRETE_COMPRADOR_MEDIDO });

    expect(comFc).toEqual(semFc);
    expect(semFc.taxAmount).toBeCloseTo(692.99 * 0.065, 9);
    expect(semFc.taxRate).toBe(6.5);
    // A base do Simples não usa o frete do comprador — logo ela não está
    // incompleta por ele faltar. Marcar seria alarme falso no 222-13-R2.
    expect(semFc.baseIncompleta).toBe(false);
    expect(comFc.baseIncompleta).toBe(false);
  });

  it("Lucro Presumido: resultado idêntico com e sem frete do comprador", () => {
    const cfgPresumido: OrderTaxConfig = {
      regime: "lucro_presumido",
      uf_origem: null,
      sn_aliquota_efetiva: null,
      lp_pis: 0.65, lp_cofins: 3.0, lp_irpj: 1.2, lp_csll: 1.08,
      lr_icms_aliquota_intra: null, lr_icms_aliquota_inter_sul_sudeste: null,
      lr_icms_aliquota_inter_norte_nordeste: null, lr_icms_debito: null,
    };
    const base: OrderTaxInput = {
      config: cfgPresumido, ufDestino: "MG", receitaBruta: 1000,
      comissao: 50, frete: 10, tabelaUf: TABELA_MG_CONFIRMADA,
    };
    const semFc = computeOrderTax(base);
    const comFc = computeOrderTax({ ...base, freteComprador: FRETE_COMPRADOR_MEDIDO });

    expect(comFc).toEqual(semFc);
    expect(semFc.taxAmount).toBeCloseTo(59.3, 6);
    expect(semFc.baseIncompleta).toBe(false);
  });

  it("destino desconhecido com frete do comprador preenchido continua INTEIRAMENTE nulo", () => {
    const r = computeOrderTax({
      ...INPUT_CASO_PROVA_DIFAL,
      ufDestino: null,
      freteComprador: FRETE_COMPRADOR_MEDIDO,
    });
    expect(r.motivo).toBe("destino_desconhecido");
    expect(r.icmsDebito).toBeNull();
    expect(r.taxAmount).toBeNull();
    expect(r.icmsRefComissao).toBeNull();
    expect(r.creditoComissaoBase).toBeNull();
    expect(r.fcpAmount).toBeNull();
    // Nada foi calculado — não há base para estar incompleta.
    expect(r.baseIncompleta).toBe(false);
  });

  it("sem config com frete do comprador preenchido continua INTEIRAMENTE nulo", () => {
    const r = computeOrderTax({
      ...INPUT_CASO_PROVA_DIFAL,
      config: null,
      freteComprador: FRETE_COMPRADOR_MEDIDO,
    });
    expect(r.motivo).toBe("sem_config");
    expect(r.taxAmount).toBeNull();
    expect(r.icmsRefComissao).toBeNull();
    expect(r.creditoComissaoBase).toBeNull();
    expect(r.baseIncompleta).toBe(false);
  });
});

// ── Sentinela de intenção do upsert incremental (Quick 260820-3aa) ────────────
//
// O defeito medido em produção em 20/08: uma rodada incremental sem endereço
// (destino desconhecido) apagava os 11 campos fiscais que o backfill já tinha
// gravado, porque a atribuição direta no DO UPDATE SET não distinguia "não
// apurei" de "apurei e o valor é null". Estes testes provam o predicado e o
// molde que fecham o buraco do lado CLIENTE — a metade SQL é a migration
// 20260820210000.
describe("reguaApurouNestaRodada / camposFiscaisParaUpsert — a sentinela de intenção (Quick 260820-3aa)", () => {
  it("destino_desconhecido: não apurou — camposFiscaisParaUpsert devolve objeto vazio, nenhuma chave presente", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, ufDestino: null });
    expect(r.motivo).toBe("destino_desconhecido");
    expect(reguaApurouNestaRodada(r)).toBe(false);

    const campos = camposFiscaisParaUpsert(r);
    expect(Object.keys(campos)).toHaveLength(0);
    expect(Object.prototype.hasOwnProperty.call(campos, "tax_versao")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(campos, "icms_debito")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(campos, "difal_amount")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(campos, "credito_pc_frete")).toBe(false);
  });

  it("sem_config: não apurou — objeto vazio", () => {
    const r = computeOrderTax({ ...INPUT_CASO_PROVA_DIFAL, config: null });
    expect(r.motivo).toBe("sem_config");
    expect(reguaApurouNestaRodada(r)).toBe(false);
    expect(Object.keys(camposFiscaisParaUpsert(r))).toHaveLength(0);
  });

  it("Lucro Real com destino resolvido: apurou — as chaves fiscais estão presentes com os valores do breakdown, marcador vale a constante exportada", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    expect(reguaApurouNestaRodada(r)).toBe(true);

    const campos = camposFiscaisParaUpsert(r);
    expect(campos.tax_versao).toBe(TAX_VERSAO_REGUA_NOVA);
    expect(campos.icms_debito).toBe(r.icmsDebito);
    expect(campos.pis_cofins_debito).toBe(r.pisCofinsDebito);
    expect(campos.pis_cofins_debito_com_difal).toBe(r.pisCofinsDebitoComDifal);
    expect(campos.credito_pc_comissao).toBe(r.creditoPcComissao);
    expect(campos.credito_pc_frete).toBe(r.creditoPcFrete);
    expect(campos.credito_icms_frete).toBe(r.creditoIcmsFrete);
    expect(campos.difal_base).toBe(r.difalBase);
    expect(campos.difal_amount).toBe(r.difalAmount);
    expect(campos.fcp_amount).toBe(r.fcpAmount);
    expect(campos.difal_fonte).toBe(r.difalFonte);
  });

  it("Simples Nacional (regime fixo) com ufDestino null: APUROU mesmo sem destino — trava da conta do Junior, ela não pode se mover", () => {
    const cfgSimples: OrderTaxConfig = {
      regime: "simples_nacional",
      uf_origem: null,
      sn_aliquota_efetiva: 4,
      lp_pis: null, lp_cofins: null, lp_irpj: null, lp_csll: null,
      lr_icms_aliquota_intra: null, lr_icms_aliquota_inter_sul_sudeste: null,
      lr_icms_aliquota_inter_norte_nordeste: null, lr_icms_debito: null,
    };
    const r = computeOrderTax({
      config: cfgSimples,
      ufDestino: null,
      receitaBruta: 500,
      comissao: 40,
      frete: 20,
      tabelaUf: null,
    });
    expect(r.motivo).toBe("regime_fixo");
    expect(r.taxAmount).not.toBeNull();
    expect(reguaApurouNestaRodada(r)).toBe(true);

    const campos = camposFiscaisParaUpsert(r);
    // Presente e marcador vale a constante — idêntico ao comportamento de hoje.
    expect(campos.tax_versao).toBe(TAX_VERSAO_REGUA_NOVA);
    // Presente e NULA: componente do regime fixo é ausência LEGÍTIMA, mas a
    // CHAVE existe — presente-e-nula é diferente de ausente (é o que faz a
    // sentinela SQL preservar corretamente linhas de outro regime na mesma
    // tabela sem tocar nesta).
    expect(Object.prototype.hasOwnProperty.call(campos, "icms_debito")).toBe(true);
    expect(campos.icms_debito).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(campos, "difal_amount")).toBe(true);
    expect(campos.difal_amount).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(campos, "credito_pc_comissao")).toBe(true);
    expect(campos.credito_pc_comissao).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Quick 260820-ikj — CLAMP EM ZERO do imposto por pedido.
//
// A auditoria independente de 20/08/2026 varreu os 8.544 pedidos da régua nova
// e achou UMA divergência real: 7 pedidos com imposto NEGATIVO, somando
// −R$ 9,46 (pior caso −R$ 3,20). A aritmética está certa — é POSIÇÃO CREDORA:
// em 5 deles o frete que o vendedor absorve supera a própria receita, e os
// créditos de PIS/COFINS e de ICMS sobre esse frete superam os débitos da
// venda. O arquivo fiscal que a CONTADORA APROVOU clampa
// (`netAmount = Math.max(0, totalDebits - totalCredits)`); a nossa régua não.
// Decisão do Wesley em 20/08: "precisa ser exatamente como está na cópia que
// te enviei".
//
// O pedido-prova deste bloco é REAL: `2000017173622482` — SP→MT, receita
// R$ 36,85, comissão R$ 2,95, frete R$ 55,74, nacional. Hoje devolve
// `taxAmount = −3,201086`.
// ═══════════════════════════════════════════════════════════════════════════

/** MT nacional: interestadual 7% (Centro-Oeste), interna 17 → DIFAL 10%, sem FCP. */
const TABELA_MT_CONFIRMADA: TabelaDifal = {
  MT: { nacional: { aliqInterestadual: 7, pctDifal: 10, fcp: 0, confirmado: true } },
};

/** Entrada do pedido REAL `2000017173622482`, medido em produção em 20/08/2026. */
const INPUT_PEDIDO_CREDOR: OrderTaxInput = {
  config: CFG_PE_VERMEIO,
  ufDestino: "MT",
  receitaBruta: 36.85,
  comissao: 2.95,
  frete: 55.74,
  freteComprador: 0,
  tabelaUf: TABELA_MT_CONFIRMADA,
  procedencia: "nacional",
};

describe("computeOrderTax — clamp em zero (Quick 260820-ikj, pedido real 2000017173622482)", () => {
  it("TESTE 1 — o caso do Wesley: taxAmount e taxRate saem EXATAMENTE zero, não −3,201086", () => {
    const r = computeOrderTax(INPUT_PEDIDO_CREDOR);
    // Zero clampado é valor EXATO, não aproximação de centavo.
    expect(r.taxAmount).toBe(0);
    // D-ikj-02: a taxa DERIVA do valor já clampado — nunca um Math.max na
    // própria taxa, que quebraria a identidade
    // `tax_amount = preco_unit × quantidade × tax_rate / 100`.
    expect(r.taxRate).toBe(0);
  });

  it("TESTE 2 — D-ikj-03: os componentes ficam CRUS; a subtração continua valendo −3,201086 com o total zerado", () => {
    const r = computeOrderTax(INPUT_PEDIDO_CREDOR);
    expect(r.icmsDebito).toBeCloseTo(2.5795, 6);
    expect(r.pisCofinsDebito).toBeCloseTo(3.17002125, 6);
    expect(r.creditoPcComissao).toBeCloseTo(0.25377375, 6);
    expect(r.creditoPcFrete).toBeCloseTo(4.7950335, 6);
    expect(r.creditoIcmsFrete).toBeCloseTo(3.9018, 6);

    // Clampar COMPONENTE inventaria número: se o total zera porque os créditos
    // superam os débitos, qual crédito seria cortado? Não há resposta fiscal.
    // O clamp é decisão de LANÇAMENTO sobre o total, não correção dos fatos.
    const bruto =
      (r.icmsDebito as number) + (r.pisCofinsDebito as number) - somaCreditos(r);
    expect(bruto).toBeCloseTo(-3.201086, 6);
    expect(r.taxAmount).toBe(0);
  });

  it("TESTE 3 — D-ikj-03: o estado ganha NOME (posicaoCredora), aqui true e no caso-prova false", () => {
    const credor = computeOrderTax(INPUT_PEDIDO_CREDOR);
    expect(credor.posicaoCredora).toBe(true);

    // Caso-prova 2000017711929314 (SP→MG): imposto largamente positivo.
    const positivo = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    expect(positivo.posicaoCredora).toBe(false);

    // O mesmo predicado que a fórmula usa é o que a TELA consome — um dono só
    // da conta "débitos − créditos". Três cópias divergentes dela criaram a
    // Fase 220.
    expect(ehPosicaoCredora(credor)).toBe(true);
    expect(ehPosicaoCredora(positivo)).toBe(false);
    expect(liquidoSemDifalBruto(credor)).toBeCloseTo(-3.201086, 6);
    expect(liquidoSemDifalBruto(positivo)).toBeCloseTo(126.88837, 6);
  });

  it("TESTE 4 — neste pedido o cenário COM DIFAL já é POSITIVO: o clamp é inerte ali, e nada se move", () => {
    const r = computeOrderTax(INPUT_PEDIDO_CREDOR);
    // O DIFAL de MT (10% sobre 36,85 = 3,685) cobre a posição credora.
    expect(r.difalAmount).toBeCloseTo(3.685, 6);
    expect(r.pisCofinsDebitoComDifal).toBeCloseTo(2.82915875, 6);
    expect(r.taxAmountComDifal).toBeCloseTo(0.1430515, 6);
    expect(r.taxRateComDifal).toBeCloseTo(0.38819945725915483, 6);
    // Positivo não é tocado pelo clamp.
    expect(r.taxAmountComDifal as number).toBeGreaterThan(0);
  });

  it("TESTE 5 — D-ikj-01, o caso que decide: com frete R$ 80 os DOIS brutos são negativos e os DOIS clampam", () => {
    const semClamp = { bruto: -6.9862525, brutoComDifal: -3.642115 };
    const r = computeOrderTax({ ...INPUT_PEDIDO_CREDOR, frete: 80 });

    // A aritmética crua continua sendo a de sempre — só o lançamento clampa.
    const bruto =
      (r.icmsDebito as number) + (r.pisCofinsDebito as number) - somaCreditos(r);
    expect(bruto).toBeCloseTo(semClamp.bruto, 6);
    const brutoComDifal =
      (r.icmsDebito as number) + (r.difalAmount as number) +
      (r.pisCofinsDebitoComDifal as number) + (r.fcpAmount ?? 0) - somaCreditos(r);
    expect(brutoComDifal).toBeCloseTo(semClamp.brutoComDifal, 6);

    // Clampar SÓ o cenário sem DIFAL mostraria "sem DIFAL = 0" e
    // "com DIFAL = −3,64" — o cenário mais caro exibido como o mais barato,
    // nas duas faixas de MCO que a 222-15 pôs em TODAS as telas.
    expect(r.taxAmount).toBe(0);
    expect(r.taxAmountComDifal).toBe(0);
    expect(r.taxRate).toBe(0);
    expect(r.taxRateComDifal).toBe(0);
    expect(r.posicaoCredora).toBe(true);
  });

  // Grade determinística compartilhada pelos testes 6 e 8. Não é aleatória:
  // as mesmas 75 combinações rodam em toda execução, sempre.
  const RECEITAS = [20, 36.85, 100, 400, 692.99];
  const FRETES = [0, 5, 55.74, 80, 200];
  const DESTINOS = ["MG", "MT", "SP"];
  const TABELA_VARREDURA: TabelaDifal = {
    MG: { nacional: { aliqInterestadual: 12, pctDifal: 6, fcp: 0, confirmado: true } },
    MT: { nacional: { aliqInterestadual: 7, pctDifal: 10, fcp: 0, confirmado: true } },
  };

  const varrer = (): OrderTaxBreakdown[] => {
    const out: OrderTaxBreakdown[] = [];
    for (const receitaBruta of RECEITAS) {
      for (const frete of FRETES) {
        for (const ufDestino of DESTINOS) {
          out.push(
            computeOrderTax({
              config: CFG_PE_VERMEIO,
              ufDestino,
              receitaBruta,
              comissao: receitaBruta * 0.08,
              frete,
              freteComprador: 0,
              tabelaUf: TABELA_VARREDURA,
              procedencia: "nacional",
            }),
          );
        }
      }
    }
    return out;
  };

  it("TESTE 6 — invariante de ordem (D-ikj-01): o cenário COM DIFAL nunca fica MENOR que o SEM DIFAL", () => {
    const linhas = varrer();
    expect(linhas).toHaveLength(RECEITAS.length * FRETES.length * DESTINOS.length);

    let comparadas = 0;
    for (const r of linhas) {
      // SP é intraestadual: o cenário com DIFAL sai nulo por desenho, e a
      // invariante não se enuncia sobre ele.
      if (r.taxAmount === null || r.taxAmountComDifal === null) continue;
      comparadas += 1;
      expect(r.taxAmountComDifal as number).toBeGreaterThanOrEqual(r.taxAmount as number);
    }
    // Math.max é monotônico: clampar os DOIS preserva a ordem. Clampar um só
    // a destrói — e a comparação abaixo prova que a grade de fato exercitou o
    // cenário com DIFAL, em vez de pular tudo em silêncio.
    expect(comparadas).toBe(RECEITAS.length * FRETES.length * 2);
  });

  it("TESTE 7 — ÂNCORA 2000017711929314: a base NÃO pode se mover (139,568186)", () => {
    const r = computeOrderTax(INPUT_CASO_PROVA_DIFAL);
    expect(
      (r.icmsDebito as number) + (r.pisCofinsDebito as number),
    ).toBeCloseTo(139.568186, 6);
    expect(r.taxAmount).toBeCloseTo(126.88837, 6);
    expect(r.taxAmountComDifal).toBeCloseTo(164.6216755, 6);
  });

  it("TESTE 8 — NENHUM POSITIVO MUDA: onde o bruto é > 0, taxAmount é igual a ele com 9 casas", () => {
    const linhas = varrer();
    let positivos = 0;
    for (const r of linhas) {
      if (r.taxAmount === null) continue;
      // O bruto é RECOMPUTADO dos componentes devolvidos — o teste mede a
      // fórmula, nunca reimporta a constante interna de PIS/COFINS para
      // repeti-la.
      const bruto =
        (r.icmsDebito as number) + (r.pisCofinsDebito as number) - somaCreditos(r);
      if (bruto > 0) {
        positivos += 1;
        expect(r.taxAmount as number).toBeCloseTo(bruto, 9);
      } else {
        expect(r.taxAmount).toBe(0);
      }
    }
    // A grade tem de conter positivos de verdade, senão a trava é vazia.
    expect(positivos).toBeGreaterThan(30);
  });
});
