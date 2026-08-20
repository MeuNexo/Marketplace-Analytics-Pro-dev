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
  extrairFreteComprador,
  ratearPorReceita,
  computeReceitaLiquida,
  campoReceitaLiquidaParaPatch,
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

// Mesmo envelope medido, com o comprador pagando o frete no checkout. O valor
// 39,82 e o da coluna "Envio pago pelo comprador" da amostra de 31/07 do
// relatorio de conciliacao do ML, citada em 222-CONTEXT-R2 (D-R2-04) — nao e
// numero inventado. senders[0].cost e gross_amount ficam como no envelope
// medido, de proposito: o extrator do frete do comprador nao pode confundi-los
// com receiver.cost.
const CUSTOS_COM_FRETE_DO_COMPRADOR = {
  senders: [{ cost: 0, save: 0, compensation: 0, compensations: [], charges: { charge_flex: 0 }, discounts: [] }],
  receiver: { cost: 39.82, save: 0, discounts: [] },
  gross_amount: 11,
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

// ── extrairFreteComprador (D-R2-04) ──────────────────────────────────────────

describe("extrairFreteComprador", () => {
  it("le receiver.cost do objeto de custos — R$ 39,82 da amostra de conciliacao do ML", () => {
    expect(extrairFreteComprador(CUSTOS_COM_FRETE_DO_COMPRADOR)).toBe(39.82);
  });

  it("NAO confunde receiver.cost com gross_amount nem com senders[0].cost", () => {
    // O mesmo objeto tem gross_amount 11 e senders[0].cost 0. Se o extrator
    // lesse o bruto, devolveria 11; se lesse o remetente, devolveria 0.
    expect(CUSTOS_COM_FRETE_DO_COMPRADOR.gross_amount).toBe(11);
    expect(CUSTOS_COM_FRETE_DO_COMPRADOR.senders[0].cost).toBe(0);
    expect(extrairFreteComprador(CUSTOS_COM_FRETE_DO_COMPRADOR)).not.toBe(11);
    expect(extrairFreteComprador(CUSTOS_COM_FRETE_DO_COMPRADOR)).toBe(39.82);
  });

  it("le zero da fixture medida como ZERO — o comprador comprovadamente nao pagou frete", () => {
    // CUSTOS_SELF_SERVICE_MEDIDO tem receiver.cost = 0 (envio Flex real).
    expect(CUSTOS_SELF_SERVICE_MEDIDO.receiver.cost).toBe(0);
    expect(extrairFreteComprador(CUSTOS_SELF_SERVICE_MEDIDO)).toBe(0);
  });

  it("zero e ZERO, nunca nulo — valor conhecido, nao ausencia (DM-2)", () => {
    expect(extrairFreteComprador({ receiver: { cost: 0 } })).toBe(0);
    expect(extrairFreteComprador({ receiver: { cost: 0 } })).not.toBeNull();
  });

  it("objeto nulo e NULO, nunca zero — ausencia declarada, a requisicao falhou (DM-2)", () => {
    expect(extrairFreteComprador(null)).toBeNull();
    expect(extrairFreteComprador(null)).not.toBe(0);
  });

  it("zero e ausencia sao estados DIFERENTES — um nunca e o outro", () => {
    const zero = extrairFreteComprador({ receiver: { cost: 0 } });
    const ausente = extrairFreteComprador(null);
    expect(zero).toBe(0);
    expect(ausente).toBeNull();
    expect(zero).not.toBe(ausente);
    expect(Object.is(zero, ausente)).toBe(false);
  });

  it("devolve null quando o recurso nao veio (undefined)", () => {
    expect(extrairFreteComprador(undefined)).toBeNull();
  });

  it("resposta sem o objeto receiver devolve ZERO — a resposta chegou, nao houve cobranca", () => {
    expect(extrairFreteComprador({})).toBe(0);
  });

  it("receiver presente sem o campo cost devolve ZERO", () => {
    expect(extrairFreteComprador({ receiver: {} })).toBe(0);
  });

  it("receiver explicitamente nulo devolve ZERO — a resposta chegou", () => {
    expect(extrairFreteComprador({ receiver: null })).toBe(0);
  });

  it("cost explicitamente nulo devolve ZERO — o campo veio vazio na resposta que chegou", () => {
    expect(extrairFreteComprador({ receiver: { cost: null } })).toBe(0);
  });

  it("valor negativo devolve null — nunca propaga numero invalido para a base do imposto", () => {
    expect(extrairFreteComprador({ receiver: { cost: -1 } })).toBeNull();
    expect(extrairFreteComprador({ receiver: { cost: -39.82 } })).toBeNull();
  });

  it("valor nao finito devolve null", () => {
    expect(extrairFreteComprador({ receiver: { cost: NaN } })).toBeNull();
    expect(extrairFreteComprador({ receiver: { cost: Infinity } })).toBeNull();
    expect(extrairFreteComprador({ receiver: { cost: -Infinity } })).toBeNull();
  });

  it("valor nao numerico devolve null", () => {
    expect(extrairFreteComprador({ receiver: { cost: true } })).toBeNull();
    expect(extrairFreteComprador({ receiver: { cost: {} } })).toBeNull();
    expect(extrairFreteComprador({ receiver: { cost: [] } })).toBeNull();
  });

  it("valor numerico vindo como texto e aceito e convertido", () => {
    expect(extrairFreteComprador({ receiver: { cost: "39.82" } })).toBe(39.82);
    expect(extrairFreteComprador({ receiver: { cost: " 12 " } })).toBe(12);
    expect(extrairFreteComprador({ receiver: { cost: "0" } })).toBe(0);
  });

  it("texto vazio ou nao numerico devolve null — nao vira zero por Number(\"\")", () => {
    expect(extrairFreteComprador({ receiver: { cost: "" } })).toBeNull();
    expect(extrairFreteComprador({ receiver: { cost: "   " } })).toBeNull();
    expect(extrairFreteComprador({ receiver: { cost: "R$ 39,82" } })).toBeNull();
  });

  it("NAO fica atras da guarda de Flex — le o xd_drop_off medido do mesmo jeito", () => {
    // Diferente do bonus, este campo nao depende do tipo logistico: existe em
    // qualquer envio em que o comprador tenha pago frete.
    expect(extrairFreteComprador(CUSTOS_XD_DROP_OFF_MEDIDO)).toBe(0);
    expect(ehFlex("xd_drop_off")).toBe(false);
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

// ── campoReceitaLiquidaParaPatch (Quick 260820-jic, D-jic-02) ───────────────
//
// A INVARIANTE: `receita_liquida` viaja SEMPRE junto de `tax_amount`, no mesmo
// patch, ou não viaja. O defeito medido em 20/08 é literalmente as duas colunas
// em réguas diferentes na MESMA linha — em julho/2026, 1.136 de 1.136 pedidos
// batem a receita líquida contra a régua ANTIGA (débitos sem crédito) e ZERO
// batem contra o `tax_amount` que está gravado ao lado, porque
// `recalc-order-costs` nunca escreveu a coluna.
//
// Este molde é a forma de `camposFiscaisParaUpsert(breakdown)`: devolve `{}`
// quando a régua não apurou — a AUSÊNCIA da chave é o sinal, e o patch da edge
// function respeita o padrão "só grava campo não nulo" por construção.
describe("campoReceitaLiquidaParaPatch — o molde de coluna que fecha a divergência", () => {
  const BASE = {
    receitaBruta: 692.99,
    comissao: 79.69,
    frete: 30.75,
    bonusEnvio: null,
    custoEntrega: null,
    taxAmount: 118.24,
    impostoDesconhecido: false,
  };

  it("régua apurou: devolve { receita_liquida } idêntico, ao centavo, a computeReceitaLiquida", () => {
    // Compara contra a FUNÇÃO EXISTENTE, nunca contra um número escrito à mão —
    // é assim que este teste prova REUSO e não uma segunda cópia da fórmula.
    // Três cópias divergentes desta conta foi o que criou a Fase 220.
    const esperado = computeReceitaLiquida(BASE).receitaLiquida;
    expect(esperado).not.toBeNull();

    const campo = campoReceitaLiquidaParaPatch({ ...BASE, reguaApurou: true });
    expect(campo).toEqual({ receita_liquida: esperado });
  });

  it("régua NÃO apurou: devolve {} mesmo com todos os insumos presentes e a conta dando um número bonito", () => {
    // ESTA é a invariante D-jic-02, e é o teste que impede a divergência de
    // voltar por outro caminho. A fórmula daria um número perfeitamente
    // plausível aqui — e gravá-lo numa rodada em que `tax_amount` foi
    // PRESERVADO reabriria exatamente o defeito que este quick fecha.
    expect(computeReceitaLiquida(BASE).receitaLiquida).not.toBeNull();

    const campo = campoReceitaLiquidaParaPatch({ ...BASE, reguaApurou: false });
    expect(campo).toEqual({});
    expect(Object.keys(campo)).toHaveLength(0);
    expect("receita_liquida" in campo).toBe(false);
  });

  it("impostoDesconhecido devolve {} mesmo com reguaApurou true — a guarda da Fase 220 sobrevive à composição", () => {
    const campo = campoReceitaLiquidaParaPatch({
      ...BASE,
      taxAmount: null,
      impostoDesconhecido: true,
      reguaApurou: true,
    });
    expect(campo).toEqual({});
  });

  it("receitaBruta null devolve {} — a coluna nunca é zerada", () => {
    const campo = campoReceitaLiquidaParaPatch({
      ...BASE,
      receitaBruta: null,
      reguaApurou: true,
    });
    expect(campo).toEqual({});
  });

  it("Flex com os sinais certos: bônus SOMA, custo de entrega SUBTRAI — 78,50", () => {
    // 100 − 11 − 0 + 12,50 − 8 − 15 = 78,50. Em nenhum ponto o bônus vira
    // frete de sinal invertido (D-05).
    const campo = campoReceitaLiquidaParaPatch({
      receitaBruta: 100,
      comissao: 11,
      frete: 0,
      bonusEnvio: 12.5,
      custoEntrega: 8,
      taxAmount: 15,
      impostoDesconhecido: false,
      reguaApurou: true,
    });
    expect(campo).toEqual({ receita_liquida: 78.5 });
  });

  it("Flex sem custo de entrega informado: grava assim mesmo, com o bônus somado — mesmo comportamento do sync", () => {
    const entrada = {
      receitaBruta: 100,
      comissao: 11,
      frete: 0,
      bonusEnvio: 12.5,
      custoEntrega: null,
      taxAmount: 15,
      impostoDesconhecido: false,
    };
    // O valor sai declaradamente inflado pelo custo ausente. Não inventar
    // guarda nova aqui: `computeReceitaLiquida` já nomeia o caso em
    // `custoEntregaAusente`, e o sync grava do mesmo jeito hoje.
    expect(computeReceitaLiquida(entrada).custoEntregaAusente).toBe(true);
    const campo = campoReceitaLiquidaParaPatch({ ...entrada, reguaApurou: true });
    expect(campo).toEqual({ receita_liquida: 86.5 });
  });

  it("o objeto devolvido tem NO MÁXIMO a chave receita_liquida — nenhuma outra coluna escapa por este molde", () => {
    const campo = campoReceitaLiquidaParaPatch({ ...BASE, reguaApurou: true });
    expect(Object.keys(campo)).toEqual(["receita_liquida"]);
  });
});
