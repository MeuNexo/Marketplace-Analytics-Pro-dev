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
import { computeOrderTaxRate, isReducedInterstateDest, UF_REGION, type OrderTaxConfig } from "./orderTaxRate";
import { calculateEffectiveRate } from "../../../src/lib/tax/index";

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
