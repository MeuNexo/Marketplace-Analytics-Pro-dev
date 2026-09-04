/**
 * aceite.test.ts — a régua de entrada do dinheiro, provada nos DOIS sentidos
 * (Fase 225, plano 225-13, Task 1).
 *
 * O defeito que este arquivo protege nasceu de uma régua que só sabia dizer sim
 * para uma LISTA de rótulos. Trocá-la por uma régua que só sabe dizer sim para
 * outra lista seria repetir o erro com o sinal invertido — e o sinal invertido é
 * PIOR: gravaria como receita dinheiro que voltou para o comprador.
 *
 * 🔴 Por isso este arquivo tem mais casos de RECUSA do que de aceite. Um portão
 * que só prova o lado que passa não protege nada.
 *
 * Importa do MÓDULO PURO, nunca de `index.ts` — o `index.ts` tem imports
 * `https://deno.land/...` que o resolvedor ESM do Node não abre.
 */
import { describe, it, expect } from "vitest";
import { aceitaPagamento, caminhoDoDinheiro, julgaPagamento } from "./aceite";

/**
 * A lista de cinco status vive em `index.ts` e é ARGUMENTO da régua, não parte
 * dela — quem trava a lista contra edição é `index.audit.test.ts`, que a lê do
 * fonte vivo. Aqui ela é só o insumo do caso de teste.
 */
const CINCO = ["approved", "authorized", "in_process", "in_mediation", "refunded"] as const;

/** Contestação encerrada A NOSSO FAVOR: o rótulo assusta, o dinheiro não. */
const CONTESTACAO_GANHA = {
  id: 172656733528,
  status: "charged_back",
  status_detail: "reimbursed",
  money_release_status: "released",
  money_release_date: "2026-08-19T00:00:00.000-04:00",
  transaction_amount_refunded: 0,
  transaction_details: { net_received_amount: 353.26 },
  order: { id: "2000017817648050", type: "mercadolibre" },
};

describe("aceita — o dinheiro liberado e sem estorno entra, qualquer que seja o rótulo", () => {
  it("contestação encerrada com dinheiro liberado e estorno zero é receita nossa — 14 pagamentos e R$ 3.330,88 em 2026", () => {
    const v = julgaPagamento(CONTESTACAO_GANHA, CINCO);
    expect(v.aceita).toBe(true);
    expect(v.via).toBe("dinheiro");
    expect(v.desfecho).toBe("liberado_sem_estorno");
  });

  it("`approved` continua entrando pelo caminho de hoje, e não pelo caminho novo — nenhum dos cinco muda de comportamento", () => {
    const v = julgaPagamento({ ...CONTESTACAO_GANHA, status: "approved" }, CINCO);
    expect(v.aceita).toBe(true);
    expect(v.via).toBe("lista");
  });

  it("`refunded` continua entrando pela lista — o sinal negativo do valor é decisão de QUEM CHAMA, não da régua", () => {
    const v = julgaPagamento(
      { ...CONTESTACAO_GANHA, status: "refunded", transaction_amount_refunded: 353.26 },
      CINCO,
    );
    expect(v.aceita).toBe(true);
    expect(v.via).toBe("lista");
  });

  it("a régua devolve booleano puro para quem só quer o veredito", () => {
    expect(aceitaPagamento(CONTESTACAO_GANHA, CINCO)).toBe(true);
  });
});

describe("recusa — o rótulo mente para o outro lado também, e aí o dinheiro saiu", () => {
  it("🔴 contestação com ESTORNO MAIOR QUE ZERO é contestação PERDIDA: o dinheiro voltou para o comprador", () => {
    const v = julgaPagamento({ ...CONTESTACAO_GANHA, transaction_amount_refunded: 353.26 }, CINCO);
    expect(v.aceita).toBe(false);
    expect(v.desfecho).toBe("estornado");
  });

  it("🔴 contestação com estorno de UM CENTAVO também é recusa — o limiar é zero, não 'quase zero'", () => {
    const v = julgaPagamento({ ...CONTESTACAO_GANHA, transaction_amount_refunded: 0.01 }, CINCO);
    expect(v.aceita).toBe(false);
    expect(v.desfecho).toBe("estornado");
  });

  it("🔴 contestação com dinheiro NÃO liberado é recusa — não há dinheiro nosso ainda", () => {
    const v = julgaPagamento({ ...CONTESTACAO_GANHA, money_release_status: "pending" }, CINCO);
    expect(v.aceita).toBe(false);
    expect(v.desfecho).toBe("nao_liberado");
  });

  it("🔴 o campo de ESTORNO ausente é RECUSA, nunca zero — ausência é ambígua e não pode virar 'não teve estorno'", () => {
    const p: Record<string, unknown> = { ...CONTESTACAO_GANHA };
    delete p.transaction_amount_refunded;
    const v = julgaPagamento(p, CINCO);
    expect(v.aceita).toBe(false);
    expect(v.desfecho).toBe("campo_ausente");
  });

  it("🔴 o campo de LIBERAÇÃO ausente é RECUSA — o outro lado do mesmo par", () => {
    const p: Record<string, unknown> = { ...CONTESTACAO_GANHA };
    delete p.money_release_status;
    const v = julgaPagamento(p, CINCO);
    expect(v.aceita).toBe(false);
    expect(v.desfecho).toBe("campo_ausente");
  });

  it("🔴 campo de estorno com texto no lugar de número é recusa — 'não entendi' não vira 'não teve'", () => {
    const v = julgaPagamento(
      { ...CONTESTACAO_GANHA, transaction_amount_refunded: "zero" },
      CINCO,
    );
    expect(v.aceita).toBe(false);
    expect(v.desfecho).toBe("campo_ausente");
  });

  it("`cancelled` sem dinheiro liberado é recusa — pagamento que nunca moveu dinheiro", () => {
    const v = julgaPagamento(
      { ...CONTESTACAO_GANHA, status: "cancelled", money_release_status: null, transaction_amount_refunded: 0 },
      CINCO,
    );
    expect(v.aceita).toBe(false);
    expect(v.desfecho).toBe("campo_ausente");
  });

  it("`rejected` sem dinheiro liberado é recusa", () => {
    const v = julgaPagamento(
      { ...CONTESTACAO_GANHA, status: "rejected", money_release_status: "pending" },
      CINCO,
    );
    expect(v.aceita).toBe(false);
  });

  it("`pending` sem dinheiro liberado é recusa", () => {
    expect(
      aceitaPagamento({ ...CONTESTACAO_GANHA, status: "pending", money_release_status: "not_released" }, CINCO),
    ).toBe(false);
  });

  it("payload vazio, nulo e indefinido são recusa — a régua não estoura e não inventa aceite", () => {
    expect(aceitaPagamento({}, CINCO)).toBe(false);
    expect(aceitaPagamento(null, CINCO)).toBe(false);
    expect(aceitaPagamento(undefined, CINCO)).toBe(false);
  });
});

describe("o caminho do dinheiro é lido dos DOIS campos, e diz POR QUE recusou", () => {
  it("os dois campos presentes e concordes devolvem liberado sem estorno", () => {
    expect(caminhoDoDinheiro(CONTESTACAO_GANHA)).toBe("liberado_sem_estorno");
  });

  it("a régua não olha o valor do pagamento — quem nega o sinal é o chamador, pelo status de estorno", () => {
    const semValor: Record<string, unknown> = { ...CONTESTACAO_GANHA };
    delete semValor.transaction_details;
    expect(caminhoDoDinheiro(semValor)).toBe("liberado_sem_estorno");
  });

  it("a liberação é comparada sem depender de caixa alta nem de espaço em volta", () => {
    expect(caminhoDoDinheiro({ ...CONTESTACAO_GANHA, money_release_status: " RELEASED " })).toBe(
      "liberado_sem_estorno",
    );
  });
});
