import { describe, it, expect } from "vitest";
import {
  classificar,
  contaNoTotal,
  valorComSinal,
  dataDoMovimento,
  totalDeSaidas,
} from "./movimentoMp";

// Linhas LITERAIS do arquivo real baixado na sonda de 03/09
// (225-SAIDAS-SPIKE.md). Nenhuma delas carrega dado de comprador — o relatorio
// nao tem coluna de pessoa, o que a varredura da sonda confirmou.
const linha = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  DATE: "2026-08-30T11:16:59.000-03:00",
  SOURCE_ID: "174980406730",
  DESCRIPTION: "payment",
  NET_CREDIT_AMOUNT: "360.74",
  NET_DEBIT_AMOUNT: "0.00",
  GROSS_AMOUNT: "459.99",
  MP_FEE_AMOUNT: "-55.20",
  TAXES_AMOUNT: "0.00",
  PAYMENT_METHOD: "visa",
  TRANSACTION_APPROVAL_DATE: "2026-08-21T15:38:19.000-03:00",
  BUSINESS_UNIT: "Mercado Libre",
  SUB_UNIT: " ",
  BALANCE_AMOUNT: "14026.69",
  PAYMENT_METHOD_TYPE: "credit_card",
  PURCHASE_ID: "",
  ...over,
});

describe("classificar — a cascata é TOTAL, nenhuma linha cai para nulo (D-225-10)", () => {
  it("saldo de abertura: sem SOURCE_ID e sem DESCRIPTION não é movimento", () => {
    // Linha 283 do arquivo real: a primeira da janela, R$ 12.671,00 de saldo.
    const abertura = linha({
      DATE: "2026-08-30T00:00:00.000-03:00",
      SOURCE_ID: "",
      DESCRIPTION: "",
      BUSINESS_UNIT: "",
      NET_CREDIT_AMOUNT: "12671.00",
    });
    expect(classificar(abertura)).toBe("saldo_de_abertura");
    expect(contaNoTotal(classificar(abertura))).toBe(false);
  });

  it("🔴 `reserve_*` é reserva — lançamento e contrapartida, não dinheiro novo", () => {
    for (const d of [
      "reserve_for_payout",
      "reserve_for_payment",
      "reserve_for_dispute",
      "reserve_for_bpp_shipping_return",
    ]) {
      expect(classificar(linha({ DESCRIPTION: d }))).toBe("reserva");
      expect(contaNoTotal("reserva")).toBe(false);
    }
  });

  it("disputa e mediação são atribuíveis a venda — BUSINESS_UNIT = Mercado Libre", () => {
    expect(classificar(linha({ DESCRIPTION: "mediation" }))).toBe("atribuivel_a_venda");
  });

  it("🔴 saque é estrutural da conta — BUSINESS_UNIT vazio, 0 de 3 atribuíveis", () => {
    // Linha real de payout: SOURCE_ID é id de transferência, não payment_id.
    const saque = linha({
      DESCRIPTION: "payout",
      SOURCE_ID: "175532075441",
      BUSINESS_UNIT: "",
      NET_CREDIT_AMOUNT: "0.00",
      NET_DEBIT_AMOUNT: "18208.95",
    });
    expect(classificar(saque)).toBe("estrutural_da_conta");
    // Aparece e é contado — o que ele nunca pode virar é acusação (T-225-04-08).
    expect(contaNoTotal(classificar(saque))).toBe(true);
  });

  it("BUSINESS_UNIT desconhecida é NOMEADA como desconhecida, não empurrada", () => {
    expect(classificar(linha({ BUSINESS_UNIT: "Mercado Pago Outro" }))).toBe("origem_desconhecida");
  });

  it("nenhuma entrada da cascata devolve nulo, vazio ou indefinido", () => {
    const casos = [
      linha(),
      linha({ DESCRIPTION: "", SOURCE_ID: "" }),
      linha({ DESCRIPTION: "reserve_for_x" }),
      linha({ BUSINESS_UNIT: "" }),
      linha({ BUSINESS_UNIT: "Coisa Nova" }),
      {},
    ];
    for (const c of casos) {
      const classe = classificar(c as Record<string, string>);
      expect(typeof classe).toBe("string");
      expect(classe.length).toBeGreaterThan(0);
    }
  });

  it("espaço em volta não muda a classe — o MP manda `\" \"` em coluna vazia", () => {
    expect(classificar(linha({ BUSINESS_UNIT: "  Mercado Libre  " }))).toBe("atribuivel_a_venda");
    expect(classificar(linha({ BUSINESS_UNIT: "   " }))).toBe("estrutural_da_conta");
  });
});

describe("valorComSinal — o sinal é decidido em UM lugar só", () => {
  it("débito vira negativo", () => {
    expect(valorComSinal(linha({ NET_DEBIT_AMOUNT: "18208.95", NET_CREDIT_AMOUNT: "0.00" }))).toBe(
      -18208.95,
    );
  });

  it("crédito fica positivo", () => {
    expect(valorComSinal(linha({ NET_CREDIT_AMOUNT: "360.74" }))).toBe(360.74);
  });

  it("linha zerada é zero, não nulo — e não vira débito por acidente", () => {
    expect(valorComSinal(linha({ NET_CREDIT_AMOUNT: "0.00", NET_DEBIT_AMOUNT: "0.00" }))).toBe(0);
  });

  it("campo ausente ou ilegível não explode nem inventa valor", () => {
    expect(valorComSinal({})).toBe(0);
    expect(valorComSinal(linha({ NET_CREDIT_AMOUNT: "n/d", NET_DEBIT_AMOUNT: "" }))).toBe(0);
  });

  it("NÃO inverte duas vezes: débito já vem positivo no CSV e sai negativo uma vez", () => {
    // GROSS_AMOUNT já vem com sinal no arquivo (-18208.95). Se alguém somasse
    // GROSS com o débito normalizado, dobraria. `valor` NÃO lê GROSS.
    const saque = linha({
      NET_DEBIT_AMOUNT: "18208.95",
      NET_CREDIT_AMOUNT: "0.00",
      GROSS_AMOUNT: "-18208.95",
    });
    expect(valorComSinal(saque)).toBe(-18208.95);
  });
});

describe("dataDoMovimento — sem reinterpretar fuso", () => {
  it("pega o dia LOCAL do carimbo, não o dia em UTC", () => {
    // 2026-08-30T23:30 BRT é 2026-08-31 em UTC. A conta é brasileira: o dia é o
    // que o extrato mostra, não o que o UTC diria.
    expect(dataDoMovimento("2026-08-30T23:30:00.000-03:00")).toBe("2026-08-30");
  });

  it("carimbo curto ou ausente devolve nulo, não uma data inventada", () => {
    expect(dataDoMovimento("")).toBeNull();
    expect(dataDoMovimento(undefined)).toBeNull();
    expect(dataDoMovimento("2026-08")).toBeNull();
    expect(dataDoMovimento("nao-e-data")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 A INVARIANTE DO PAR DE RESERVA.
//
// Medido no arquivo real de 03/09:
//   reserve_for_payout  → R$ 38.089,95 de débito
//   payout              → R$ 38.089,95 de débito
// É o MESMO saque, lançado duas vezes (reserva e contrapartida). Somar tudo o
// que tem débito DOBRA o saque. Mesma coisa com reserve_for_payment × payment
// (R$ 3.860,43 cada).
//
// Este bloco existe para reprovar o dia em que alguém somar sem tratar o par.
// ─────────────────────────────────────────────────────────────────────────────
describe("totalDeSaidas — o par de reserva não pode ser contado duas vezes", () => {
  const saque = (valor: string, descricao: string) =>
    linha({
      DESCRIPTION: descricao,
      SOURCE_ID: "175532075441",
      BUSINESS_UNIT: "",
      NET_CREDIT_AMOUNT: "0.00",
      NET_DEBIT_AMOUNT: valor,
    });

  it("🔴 conta o saque UMA vez, mesmo com a reserva presente no arquivo", () => {
    const arquivo = [saque("18208.95", "reserve_for_payout"), saque("18208.95", "payout")];
    expect(totalDeSaidas(arquivo)).toBe(-18208.95);
  });

  it("🔴 a soma ingênua DOBRARIA — é essa diferença que o tratamento evita", () => {
    const arquivo = [saque("18208.95", "reserve_for_payout"), saque("18208.95", "payout")];
    const ingenua = arquivo.reduce((s, c) => s + valorComSinal(c), 0);
    expect(ingenua).toBe(-36417.9); // o número errado
    expect(totalDeSaidas(arquivo)).not.toBe(ingenua);
  });

  it("reproduz os três saques reais da janela: R$ 38.089,95, não R$ 76.179,90", () => {
    const arquivo = [
      saque("18208.95", "reserve_for_payout"),
      saque("18208.95", "payout"),
      saque("11464.00", "reserve_for_payout"),
      saque("11464.00", "payout"),
      saque("8417.00", "reserve_for_payout"),
      saque("8417.00", "payout"),
    ];
    expect(totalDeSaidas(arquivo)).toBeCloseTo(-38089.95, 2);
  });

  it("o saldo de abertura NÃO entra na soma", () => {
    const arquivo = [
      linha({ SOURCE_ID: "", DESCRIPTION: "", BUSINESS_UNIT: "", NET_CREDIT_AMOUNT: "12671.00" }),
      saque("18208.95", "payout"),
    ];
    expect(totalDeSaidas(arquivo)).toBe(-18208.95);
  });

  it("crédito não é saída — só débito soma", () => {
    expect(totalDeSaidas([linha({ NET_CREDIT_AMOUNT: "360.74" })])).toBe(0);
  });

  it("arquivo sem nenhuma saída soma zero, não nulo", () => {
    expect(totalDeSaidas([])).toBe(0);
  });
});
