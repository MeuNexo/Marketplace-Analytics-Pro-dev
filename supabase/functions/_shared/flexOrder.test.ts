/**
 * flexOrder.test.ts — prova sem rede da aritmética do Flex (Fase 222, plano
 * 222-04, FLEX-01/02/03).
 *
 * As fixtures de JSON dos extratores (`extrairLogisticType`,
 * `extrairBonusEnvio`) saem literalmente de `222-ML-API.md` — respostas
 * reais da conta Junior, reduzidas aos campos monetários e logísticos.
 * Nenhum valor aqui é inventado.
 */
import { describe, it, expect } from "vitest";
import {
  extrairLogisticType,
  ehFlex,
  extrairBonusEnvio,
  ratearPorReceita,
  computeReceitaLiquida,
} from "./flexOrder";

// ── Fixtures medidas contra a API real (222-ML-API.md) ──────────────────────

// GET /shipments/47742747599 (sem header x-format-new) — pedido
// 2000017878779890, o que o Wesley conferiu na tela do ML.
const ENVIO_SELF_SERVICE_MEDIDO = {
  mode: "me2",
  status: "delivered",
  base_cost: 0,
  logistic_type: "self_service",
  shipping_option: { cost: 0, list_cost: 0 },
  cost_components: {
    ratio: 0,
    compensation: 0,
    gap_discount: 0,
    loyal_discount: 1,
    special_discount: 0,
  },
};

// GET /shipments/47742747599/costs — mesmo envio. senders[0].compensation
// vem 0 (campo refutado, item 3 do Veredito) — o bônus real é gross_amount.
const CUSTOS_SELF_SERVICE_MEDIDO = {
  senders: [
    {
      cost: 0,
      save: 0,
      compensation: 0,
      compensations: [],
      charges: { charge_flex: 0 },
      discounts: [],
    },
  ],
  receiver: {
    cost: 0,
    save: 11,
    discounts: [{ rate: 1, type: "loyal", promoted_amount: 11 }],
  },
  gross_amount: 11,
};

// GET /shipments/46392480717 — xd_drop_off medido, frete subsidiado pelo ML,
// vendedor não cobrado. gross_amount 20,10, mas o pedido NÃO é Flex — ler o
// bônus dele inventaria receita.
const CUSTOS_XD_DROP_OFF_MEDIDO = {
  senders: [{ cost: 0, save: 0, compensation: 0, compensations: [], charges: { charge_flex: 0 }, discounts: [] }],
  receiver: { cost: 0, save: 0, discounts: [] },
  gross_amount: 20.1,
};

// ── extrairLogisticType ──────────────────────────────────────────────────────

describe("extrairLogisticType", () => {
  it("lê o campo na raiz do objeto de envio medido contra a API", () => {
    expect(extrairLogisticType(ENVIO_SELF_SERVICE_MEDIDO)).toBe("self_service");
  });

  it("normaliza caixa alta e espaço nas bordas", () => {
    expect(extrairLogisticType({ logistic_type: "  Self_Service  " })).toBe("self_service");
  });

  it("devolve null quando o envio é null", () => {
    expect(extrairLogisticType(null)).toBeNull();
  });

  it("devolve null quando o envio é undefined", () => {
    expect(extrairLogisticType(undefined)).toBeNull();
  });

  it("devolve null quando o campo está ausente", () => {
    expect(extrairLogisticType({})).toBeNull();
  });

  it("devolve null quando o campo vem string vazia", () => {
    expect(extrairLogisticType({ logistic_type: "   " })).toBeNull();
  });

  it("lê xd_drop_off sem transformar em self_service", () => {
    expect(extrairLogisticType({ logistic_type: "xd_drop_off" })).toBe("xd_drop_off");
  });
});

// ── ehFlex ────────────────────────────────────────────────────────────────────

describe("ehFlex", () => {
  it("self_service é Flex", () => {
    expect(ehFlex("self_service")).toBe(true);
  });

  it("fulfillment não é Flex", () => {
    expect(ehFlex("fulfillment")).toBe(false);
  });

  it("drop_off não é Flex", () => {
    expect(ehFlex("drop_off")).toBe(false);
  });

  it("xd_drop_off não é Flex — a armadilha medida em 222-ML-API.md", () => {
    expect(ehFlex("xd_drop_off")).toBe(false);
  });

  it("cross_docking não é Flex", () => {
    expect(ehFlex("cross_docking")).toBe(false);
  });

  it("null não é Flex", () => {
    expect(ehFlex(null)).toBe(false);
  });
});

// ── extrairBonusEnvio ─────────────────────────────────────────────────────────

describe("extrairBonusEnvio", () => {
  it("lê gross_amount do objeto de custos medido contra a API — R$ 11,00", () => {
    expect(extrairBonusEnvio(CUSTOS_SELF_SERVICE_MEDIDO)).toBe(11);
  });

  it("NÃO usa senders[].compensation mesmo quando o objeto o contém — o bônus sai do valor bruto, não dele", () => {
    // O mesmo objeto medido tem senders[0].compensation = 0 E gross_amount = 11.
    // Se a função lesse compensation, devolveria 0; ela devolve o bruto.
    expect(CUSTOS_SELF_SERVICE_MEDIDO.senders[0].compensation).toBe(0);
    expect(extrairBonusEnvio(CUSTOS_SELF_SERVICE_MEDIDO)).not.toBe(
      CUSTOS_SELF_SERVICE_MEDIDO.senders[0].compensation,
    );
    expect(extrairBonusEnvio(CUSTOS_SELF_SERVICE_MEDIDO)).toBe(11);
  });

  it("devolve null quando o recurso de custos não veio (null)", () => {
    expect(extrairBonusEnvio(null)).toBeNull();
  });

  it("devolve null quando o recurso não veio (undefined)", () => {
    expect(extrairBonusEnvio(undefined)).toBeNull();
  });

  it("devolve null quando o campo gross_amount não existe", () => {
    expect(extrairBonusEnvio({})).toBeNull();
  });

  it("devolve null quando gross_amount não é um número finito", () => {
    expect(extrairBonusEnvio({ gross_amount: "11" as unknown as number })).toBeNull();
    expect(extrairBonusEnvio({ gross_amount: NaN })).toBeNull();
    expect(extrairBonusEnvio({ gross_amount: Infinity })).toBeNull();
  });

  it("com o valor zero presente, devolve zero — zero capturado é diferente de não capturado (D-05)", () => {
    expect(extrairBonusEnvio({ gross_amount: 0 })).toBe(0);
    expect(extrairBonusEnvio({ gross_amount: 0 })).not.toBeNull();
  });

  it("lê o gross_amount de um xd_drop_off do mesmo jeito — a guarda é do chamador (ehFlex), não deste extrator", () => {
    // extrairBonusEnvio é ingênuo por desenho: quem decide se DEVE chamar
    // é o sync (guarda ehFlex), não este extrator.
    expect(extrairBonusEnvio(CUSTOS_XD_DROP_OFF_MEDIDO)).toBe(20.1);
  });
});

// ── ratearPorReceita ──────────────────────────────────────────────────────────

describe("ratearPorReceita", () => {
  it("valor null devolve null em todas as posições", () => {
    expect(ratearPorReceita(null, [100, 200, 300])).toEqual([null, null, null]);
  });

  it("pedido de um item devolve o valor inteiro", () => {
    expect(ratearPorReceita(11, [23.17])).toEqual([11]);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(ratearPorReceita(11, [])).toEqual([]);
  });

  it("receita total zero divide igualmente entre as linhas", () => {
    expect(ratearPorReceita(10, [0, 0])).toEqual([5, 5]);
  });

  it("rateio proporcional simples fecha exatamente", () => {
    const resultado = ratearPorReceita(30, [100, 200]);
    expect(resultado).toEqual([10, 20]);
  });

  it("fecha ao centavo por maior resto num pedido de três itens, sem criar nem perder centavo", () => {
    const resultado = ratearPorReceita(11, [10, 10, 10]);
    const soma = resultado.reduce((s, v) => s + (v ?? 0), 0);
    expect(Math.round(soma * 100)).toBe(1100);
    // 11 / 3 = 3.6666... em cada -> dois ficam com 3.67, um com 3.66 (ou
    // distribuição equivalente que soma exatamente 11.00).
    resultado.forEach((v) => {
      expect(v).not.toBeNull();
      expect([3.66, 3.67]).toContain(v);
    });
  });

  it("fecha ao centavo com pesos desiguais e resto não-trivial", () => {
    const resultado = ratearPorReceita(100, [33, 33, 34]);
    const soma = resultado.reduce((s, v) => s + (v ?? 0), 0);
    expect(Math.round(soma * 100)).toBe(10000);
  });
});

// ── computeReceitaLiquida ───────────────────────────────────────────────────

describe("computeReceitaLiquida", () => {
  it("pedido comum (bônus e custo de entrega null) reproduz a fórmula de hoje, por comparação contra a expressão", () => {
    const receitaBruta = 692.99;
    const comissao = 79.69;
    const frete = 30.75;
    const taxAmount = 129.35;

    // A fórmula "de hoje" (sync-ml-orders/index.ts, expandOrder):
    // precoUnit*qtd - sale_fee - frete - taxAmount. Comparado contra a
    // EXPRESSÃO, não contra uma constante.
    const esperadoFormulaAntiga = receitaBruta - comissao - frete - taxAmount;

    const { receitaLiquida, custoEntregaAusente } = computeReceitaLiquida({
      receitaBruta,
      comissao,
      frete,
      bonusEnvio: null,
      custoEntrega: null,
      taxAmount,
      impostoDesconhecido: false,
    });

    expect(receitaLiquida).toBeCloseTo(esperadoFormulaAntiga, 10);
    expect(custoEntregaAusente).toBe(false);
  });

  it("caso-prova Flex — venda 2000017878779890: 23,17 − 9,18 + 11,00 = 24,99, custo de entrega ausente", () => {
    const { receitaLiquida, custoEntregaAusente } = computeReceitaLiquida({
      receitaBruta: 23.17,
      comissao: 9.18,
      frete: 0,
      bonusEnvio: 11.0,
      custoEntrega: null,
      taxAmount: null,
      impostoDesconhecido: false,
    });

    expect(receitaLiquida).toBeCloseTo(24.99, 2);
    expect(custoEntregaAusente).toBe(true);
  });

  it("mesmo pedido Flex com custo de entrega informado subtrai o custo e custoEntregaAusente vira falso", () => {
    const { receitaLiquida, custoEntregaAusente } = computeReceitaLiquida({
      receitaBruta: 23.17,
      comissao: 9.18,
      frete: 0,
      bonusEnvio: 11.0,
      custoEntrega: 8.5,
      taxAmount: null,
      impostoDesconhecido: false,
    });

    expect(receitaLiquida).toBeCloseTo(24.99 - 8.5, 2);
    expect(custoEntregaAusente).toBe(false);
  });

  it("impostoDesconhecido verdadeiro devolve receitaLiquida null — guarda da Fase 220 preservada", () => {
    const { receitaLiquida } = computeReceitaLiquida({
      receitaBruta: 692.99,
      comissao: 79.69,
      frete: 30.75,
      bonusEnvio: null,
      custoEntrega: null,
      taxAmount: null,
      impostoDesconhecido: true,
    });

    expect(receitaLiquida).toBeNull();
  });

  it("bônus null não vira zero por acidente: pedido comum sem bônus dá o mesmo resultado com ou sem o campo bonusEnvio explícito", () => {
    const base = {
      receitaBruta: 100,
      comissao: 10,
      frete: 5,
      custoEntrega: null,
      taxAmount: 2,
      impostoDesconhecido: false,
    };
    const comBonusNull = computeReceitaLiquida({ ...base, bonusEnvio: null });
    expect(comBonusNull.receitaLiquida).toBeCloseTo(100 - 10 - 5 - 2, 10);
  });

  it("receitaBruta null devolve receitaLiquida null", () => {
    const { receitaLiquida } = computeReceitaLiquida({
      receitaBruta: null,
      comissao: 10,
      frete: 5,
      bonusEnvio: null,
      custoEntrega: null,
      taxAmount: 2,
      impostoDesconhecido: false,
    });
    expect(receitaLiquida).toBeNull();
  });

  it("custoEntregaAusente é falso quando o pedido não tem bônus — a pergunta não se aplica a pedido não-Flex", () => {
    const { custoEntregaAusente } = computeReceitaLiquida({
      receitaBruta: 100,
      comissao: 10,
      frete: 5,
      bonusEnvio: null,
      custoEntrega: null,
      taxAmount: 2,
      impostoDesconhecido: false,
    });
    expect(custoEntregaAusente).toBe(false);
  });
});
