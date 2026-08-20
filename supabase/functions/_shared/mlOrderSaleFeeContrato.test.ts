/**
 * mlOrderSaleFeeContrato.test.ts — teste de caracterização sobre a amostra
 * medida de `/group/ML/order/details` (Fase 223, 223-01, Task 2).
 *
 * Zero rede, zero banco, zero mock: toda asserção aqui lê
 * `__fixtures__/mlOrderSaleFee.amostra.json` — a resposta real e higienizada
 * de 7 pedidos da Pé Vermeio (seller 1639558873), medida em produção pelo
 * orquestrador (Task 1) e documentada, campo a campo, em
 * `.planning/phases/223-rebate-do-ml-por-pedido.../223-CONTRATO-SALE-FEE.md`.
 *
 * Molde de leitura de arquivo: `readFileSync` + `resolve(process.cwd(), ...)`,
 * NUNCA `import.meta.url` — a suíte roda em jsdom, onde `import.meta.url` é
 * uma URL `http://` do servidor do Vite e `fileURLToPath` recusa (mesmo
 * padrão de `src/lib/fiscal/recalcOrderCostsContrato.test.ts`).
 *
 * DIVERGÊNCIAS ENTRE O `<behavior>` DO PLANO 223-01 E O QUE A MEDIÇÃO MOSTROU
 * (a Task 2 seguiu a amostra, não o plano — registrado aqui e no SUMMARY
 * porque muda a leitura do 223-03):
 *
 * 1. A amostra tem SETE pedidos, não seis — a medição (Task 1) decidiu que
 *    precisava de mais um caso do que o plano previu.
 * 2. Não existe "pedido de carrinho": `orders` é 1:1 com `ml_order_id`
 *    (Q3 do contrato, zero pedidos multilinha medidos em julho/2026). O que
 *    multiplica `sale_fee.net` acima de `orders.comissao` é o campo
 *    `quantidade` do pedido — não múltiplas linhas em `orders`. As duas
 *    identidades medidas (`net == Σ detail_amount` das linhas de comissão, e
 *    `net == orders.comissao × orders.quantidade`) substituem o teste de
 *    "carrinho" do plano original.
 * 3. `ehLinhaDeComissao` opera sobre uma LINHA de `details[]` — onde vivem
 *    `charge_info.detail_type`/`detail_sub_type` — não sobre `sale_fee`, que
 *    só existe UMA VEZ, na raiz do pedido (Q1). O predicado verifica
 *    `charge_info.detail_amount`, não `sale_fee.gross`/`net`, porque
 *    `sale_fee` não existe nessa granularidade.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ehLinhaDeComissao,
  SUBTIPOS_COMISSAO,
  type LinhaOrderDetail,
  type ResultadoPedidoSaleFee,
  type SaleFee,
} from "./mlOrderSaleFeeContrato";

const AMOSTRA_CAMINHO =
  "supabase/functions/_shared/__fixtures__/mlOrderSaleFee.amostra.json";

interface AmostraSaleFee {
  medido_em: string;
  endpoint: string;
  conta: string;
  higienizacao: string;
  results: ResultadoPedidoSaleFee[];
}

function lerAmostra(): AmostraSaleFee {
  const bruto = readFileSync(resolve(process.cwd(), AMOSTRA_CAMINHO), "utf8");
  return JSON.parse(bruto) as AmostraSaleFee;
}

const amostra = lerAmostra();

function pedido(orderId: number): ResultadoPedidoSaleFee {
  const encontrado = amostra.results.find((r) => r.order_id === orderId);
  if (!encontrado) {
    throw new Error(`pedido ${orderId} não está na amostra medida`);
  }
  return encontrado;
}

function linhasDeComissao(r: ResultadoPedidoSaleFee): LinhaOrderDetail[] {
  return r.details.filter(ehLinhaDeComissao);
}

/** Tolerância de centavo — mesmo helper de orderTaxRate.test.ts. */
const closeCents = (received: number | null, expected: number) => {
  expect(received).not.toBeNull();
  expect(Math.abs((received as number) - expected)).toBeLessThan(0.01);
};

// Os dois pedidos com sale_fee.rebate > 0 na amostra — um pago, um
// cancelado. É o segundo (2000017822557678) que prova Q4: o sale_fee da
// raiz NÃO enxerga o cancelamento.
const PEDIDO_COM_REBATE_PAGO = 2000017757292324;
const PEDIDO_CANCELADO_COM_REBATE = 2000017822557678;
// O outro pedido cancelado da amostra — sem rebate, só para provar que
// ehLinhaDeComissao rejeita BONUS também fora do caso "armadilha".
const PEDIDO_CANCELADO_SEM_REBATE = 2000017605774432;

const TODOS_OS_ORDER_IDS = [
  2000017193192024, 2000017323487432, 2000017530819962, 2000017605774432,
  2000017687408928, 2000017757292324, 2000017822557678,
];

describe("amostra medida — forma e higienização (must_haves da Task 1)", () => {
  it("tem os sete pedidos medidos — o plano previu seis, a medição achou sete", () => {
    expect(amostra.results).toHaveLength(7);
    expect(amostra.results.map((r) => r.order_id).sort()).toEqual(
      [...TODOS_OS_ORDER_IDS].sort(),
    );
  });

  it("não contém nenhum campo de identificação de comprador", () => {
    const bruto = JSON.stringify(amostra).toLowerCase();
    for (const termo of [
      "payer_nickname",
      "payer",
      "buyer",
      "receiver_name",
      "receiver_address",
      "nickname",
    ]) {
      expect(bruto).not.toContain(termo);
    }
  });

  it("um result por order_id — nunca um por linha de cobrança (Q1)", () => {
    const idsUnicos = new Set(amostra.results.map((r) => r.order_id));
    expect(idsUnicos.size).toBe(amostra.results.length);
  });

  it("charge_info.detail_id existe, é numérico e único em toda linha de details[] (Q2)", () => {
    const todasAsLinhas = amostra.results.flatMap((r) => r.details);
    const ids = todasAsLinhas.map((l) => l.charge_info.detail_id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => typeof id === "number")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("sale_fee da raiz — gross, net, rebate (Q1, Q4)", () => {
  it.each(amostra.results)(
    "pedido $order_id: gross - rebate == net, dentro de um centavo",
    (r: ResultadoPedidoSaleFee) => {
      const { gross, net, rebate }: SaleFee = r.sale_fee;
      expect(gross).not.toBeNull();
      expect(rebate).not.toBeNull();
      closeCents(net, (gross as number) - (rebate as number));
    },
  );

  it("nos cinco pedidos fora de campanha, rebate é exatamente 0 (number) — nunca null", () => {
    const foraDeCampanha = amostra.results.filter(
      (r) =>
        r.order_id !== PEDIDO_COM_REBATE_PAGO &&
        r.order_id !== PEDIDO_CANCELADO_COM_REBATE,
    );
    expect(foraDeCampanha).toHaveLength(5);
    for (const r of foraDeCampanha) {
      expect(r.sale_fee.rebate).not.toBeNull();
      expect(typeof r.sale_fee.rebate).toBe("number");
      expect(r.sale_fee.rebate).toBe(0);
    }
  });

  it("nos dois pedidos dentro da campanha, rebate > 0 e gross > net", () => {
    for (const orderId of [PEDIDO_COM_REBATE_PAGO, PEDIDO_CANCELADO_COM_REBATE]) {
      const { gross, net, rebate } = pedido(orderId).sale_fee;
      expect(rebate as number).toBeGreaterThan(0);
      expect(gross as number).toBeGreaterThan(net as number);
    }
  });

  it("Q4 — pedido cancelado com rebate: sale_fee da raiz fica intacto, como se a venda valesse", () => {
    const { gross, net, rebate } = pedido(PEDIDO_CANCELADO_COM_REBATE).sale_fee;
    closeCents(gross, 43.07);
    closeCents(net, 21.9);
    closeCents(rebate, 21.17);
  });
});

describe("ehLinhaDeComissao — separa comissão de estorno por cancelamento (Q2, Q4)", () => {
  it("verdadeiro para toda linha CHARGE cujo subtipo está em SUBTIPOS_COMISSAO", () => {
    const subtiposComissao: readonly string[] = SUBTIPOS_COMISSAO;
    let algumaComissaoEncontrada = false;
    for (const r of amostra.results) {
      for (const linha of r.details) {
        const éComissao =
          linha.charge_info.detail_type === "CHARGE" &&
          subtiposComissao.includes(linha.charge_info.detail_sub_type);
        if (éComissao) {
          algumaComissaoEncontrada = true;
          expect(ehLinhaDeComissao(linha)).toBe(true);
        }
      }
    }
    expect(algumaComissaoEncontrada).toBe(true);
  });

  it("falso para as duas linhas BONUS do pedido cancelado COM rebate — a armadilha que o predicado existe pra pegar", () => {
    const linhasBonus = pedido(PEDIDO_CANCELADO_COM_REBATE).details.filter(
      (d) => d.charge_info.detail_type === "BONUS",
    );
    expect(linhasBonus).toHaveLength(2);
    expect(
      linhasBonus.map((d) => d.charge_info.detail_sub_type).sort(),
    ).toEqual(["BVVML", "BVVPRC"]);
    for (const linha of linhasBonus) {
      expect(ehLinhaDeComissao(linha)).toBe(false);
    }
  });

  it("falso para as duas linhas BONUS do outro pedido cancelado (sem rebate)", () => {
    const linhasBonus = pedido(PEDIDO_CANCELADO_SEM_REBATE).details.filter(
      (d) => d.charge_info.detail_type === "BONUS",
    );
    expect(linhasBonus).toHaveLength(2);
    for (const linha of linhasBonus) {
      expect(ehLinhaDeComissao(linha)).toBe(false);
    }
  });

  it("falso para linhas de frete (CFFE) e de parcelamento (CFONPN) — não são comissão", () => {
    const linhasNaoComissao: LinhaOrderDetail[] = amostra.results
      .flatMap((r) => r.details)
      .filter((d) => ["CFFE", "CFONPN"].includes(d.charge_info.detail_sub_type));
    expect(linhasNaoComissao.length).toBeGreaterThan(0);
    for (const linha of linhasNaoComissao) {
      expect(ehLinhaDeComissao(linha)).toBe(false);
    }
  });

  it("falso quando detail_type é BONUS mesmo que o subtipo coincida com um subtipo de comissão", () => {
    expect(
      ehLinhaDeComissao({
        charge_info: {
          detail_type: "BONUS",
          detail_sub_type: "CVVML",
          detail_amount: 10,
        },
      }),
    ).toBe(false);
  });

  it("falso para entrada malformada — charge_info ausente ou detail_amount que não é número finito (substitui o `sale_fee` do <behavior> original: nesta granularidade quem carrega o valor monetário é detail_amount, não sale_fee — Q1)", () => {
    expect(ehLinhaDeComissao(null)).toBe(false);
    expect(ehLinhaDeComissao(undefined)).toBe(false);
    expect(ehLinhaDeComissao("uma string qualquer")).toBe(false);
    expect(ehLinhaDeComissao({})).toBe(false);
    expect(ehLinhaDeComissao({ charge_info: null })).toBe(false);
    expect(
      ehLinhaDeComissao({
        charge_info: { detail_type: "CHARGE", detail_sub_type: "CVVML" },
      }),
    ).toBe(false); // detail_amount ausente
    expect(
      ehLinhaDeComissao({
        charge_info: {
          detail_type: "CHARGE",
          detail_sub_type: "CVVML",
          detail_amount: "62.61",
        },
      }),
    ).toBe(false); // detail_amount veio string, não number
    expect(
      ehLinhaDeComissao({
        charge_info: {
          detail_type: "CHARGE",
          detail_sub_type: "CVVML",
          detail_amount: NaN,
        },
      }),
    ).toBe(false); // number, mas não finito
  });
});

describe("SUBTIPOS_COMISSAO", () => {
  it("contém exatamente CVVML, CVVPRC e CVVFNU", () => {
    expect(SUBTIPOS_COMISSAO).toEqual(["CVVML", "CVVPRC", "CVVFNU"]);
  });

  it("CVVFNU não foi observado na amostra — mantido pela doc do ML, registrado aqui", () => {
    const subtiposObservados = new Set(
      amostra.results.flatMap((r) =>
        r.details.map((d) => d.charge_info.detail_sub_type),
      ),
    );
    expect(subtiposObservados.has("CVVFNU")).toBe(false);
    expect(subtiposObservados.has("CVVML")).toBe(true);
    expect(subtiposObservados.has("CVVPRC")).toBe(true);
  });

  it("o código genérico CV (o exemplo da doc oficial) nunca aparece — confirma que o filtro tem que ser pelos subtipos medidos", () => {
    const subtiposObservados = new Set(
      amostra.results.flatMap((r) =>
        r.details.map((d) => d.charge_info.detail_sub_type),
      ),
    );
    expect(subtiposObservados.has("CV")).toBe(false);
  });
});

describe("Q3 — net é o total do pedido, não a comissão por unidade (identidades medidas)", () => {
  it.each(amostra.results)(
    "pedido $order_id: sale_fee.net == Σ detail_amount das linhas de comissão (CHARGE + subtipo CVV*)",
    (r: ResultadoPedidoSaleFee) => {
      const soma = linhasDeComissao(r).reduce(
        (s, linha) => s + linha.charge_info.detail_amount,
        0,
      );
      closeCents(r.sale_fee.net, soma);
    },
  );

  // Os dois únicos pedidos com quantidade > 1 na amostra — e os dois únicos
  // onde 223-CONTRATO-SALE-FEE.md (Q3) registra orders.comissao ao lado do
  // net medido. Substitui o teste de "pedido de carrinho" do plano
  // original: não existe carrinho (orders é 1:1 com ml_order_id) — o que
  // multiplica net acima de orders.comissao é orders.quantidade.
  it("pedido 2000017193192024 (quantidade 6): net == orders.comissao × orders.quantidade", () => {
    const ORDERS_COMISSAO = 10.51; // 223-CONTRATO-SALE-FEE.md, Q3
    const ORDERS_QUANTIDADE = 6;
    closeCents(
      pedido(2000017193192024).sale_fee.net,
      ORDERS_COMISSAO * ORDERS_QUANTIDADE,
    );
  });

  it("pedido 2000017530819962 (quantidade 2): net == orders.comissao × orders.quantidade", () => {
    const ORDERS_COMISSAO = 18.4; // 223-CONTRATO-SALE-FEE.md, Q3
    const ORDERS_QUANTIDADE = 2;
    closeCents(
      pedido(2000017530819962).sale_fee.net,
      ORDERS_COMISSAO * ORDERS_QUANTIDADE,
    );
  });
});
