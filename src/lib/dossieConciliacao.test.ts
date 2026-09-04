// ============================================================================
// 225-05 Task 1 (RED) — o texto que vai DENTRO de um chamado do Mercado Livre
//
// 🔴 Este módulo não é puro por purismo. O texto que ele monta é copiado e
// colado num chamado de suporte do ML. Um `undefined` no meio dele não é um
// bug de tela: é uma credencial queimada com o suporte, e D-225-07 diz que o
// custo disso não é o valor do caso — é a credibilidade do PRÓXIMO chamado.
//
// As sete asserções de comportamento vêm do <behavior> do plano, e cada uma
// existe porque a falha correspondente é silenciosa: campo vazio parece só
// feio, plural errado parece só desleixo, e valor estimado apresentado como
// apurado é uma acusação que a nossa própria régua não sustenta.
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  AVISO_CONTESTACAO_CARTAO,
  LINHA_PROCEDENCIA_ESPERADO,
  montarDossie,
  type CasoDossie,
} from "./dossieConciliacao";

/** Data de montagem SEMPRE explícita: função que lê o relógio não tem teste. */
const MONTADO_EM = "2026-09-03";

const CASO_A_MENOR: CasoDossie = {
  ml_order_id: "2000017817648050",
  tipo_caso: "repasse_a_menor",
  motivo: "repasse_a_menor_confirmado",
  estado: "aberto",
  titulo: "Chapéu Country Pralana Aba 10",
  sku: "PRL-CH-0010",
  quantidade: 2,
  retido_de_fato: 123.45,
  cobranca_declarada: 100.4,
  residuo_ml: 23.05,
  esperado_nosso: 420.5,
  recebido: 397.45,
  residuo_nosso: 23.05,
  diferenca: 23.05,
  data_pedido: "2026-08-07",
  data_evento: "2026-08-10",
  dias_restantes: 5,
  n_pagamentos: 1,
  payment_ids: ["172656733528"],
  release_date_max: "2026-08-25",
  valor_estimado: false,
};

const CASO_AUSENTE: CasoDossie = {
  ...CASO_A_MENOR,
  tipo_caso: "repasse_ausente",
  motivo: "sem_repasse_confirmado",
  recebido: 0,
  diferenca: 439.25,
};

describe("🔴 o dossiê de repasse a menor traz tudo que D-225-12 exige", () => {
  const texto = montarDossie(CASO_A_MENOR, { montadoEm: MONTADO_EM });

  it("1/7 — carrega pedido, produto, SKU, as duas datas e o prazo", () => {
    expect(texto).toContain("2000017817648050");
    expect(texto).toContain("Chapéu Country Pralana Aba 10");
    expect(texto).toContain("PRL-CH-0010");
    expect(texto, "data da venda em dd/mm/aaaa").toContain("07/08/2026");
    expect(texto, "data do evento em dd/mm/aaaa").toContain("10/08/2026");
    expect(texto, "os dias restantes vêm da RPC, o texto só rotula").toContain("5 dias");
  });

  it("1b/7 — as DUAS fontes aparecem NOMEADAS, com o valor de cada uma", () => {
    // 🔴 A acusação é ML contra ML. Um número sem procedência num chamado é um
    // número que o ML devolve.
    expect(texto).toContain("Mercado Pago (retido de fato)");
    expect(texto).toContain("Fatura do Mercado Livre (cobrança declarada)");
    expect(texto).toContain("R$ 123,45");
    expect(texto).toContain("R$ 100,40");
    expect(texto, "a diferença é o que se cobra").toContain("R$ 23,05");
  });

  it("1c/7 — a procedência do 'esperado' está escrita, para quando o ML perguntar", () => {
    expect(texto).toContain(LINHA_PROCEDENCIA_ESPERADO);
    expect(LINHA_PROCEDENCIA_ESPERADO).toContain("nunca a comissão por unidade");
  });

  it("1d/7 — é texto simples: o campo do chamado do ML não renderiza markdown", () => {
    expect(texto).not.toMatch(/^#{1,6}\s/m);
    expect(texto).not.toMatch(/\*\*/);
    expect(texto).not.toMatch(/^\s*\|/m);
  });
});

describe("🔴 o dossiê de AUSÊNCIA nunca sai sem o aviso de contestação de cartão", () => {
  it("2/7 — o aviso está presente, e traz o número medido em C-06", () => {
    const texto = montarDossie(CASO_AUSENTE, { montadoEm: MONTADO_EM });
    expect(texto).toContain(AVISO_CONTESTACAO_CARTAO);
    // Número torna o aviso acionável em vez de decorativo: os 5 únicos pedidos
    // sem repasse em 75 dias voltaram 5/5 chargeback (R$ 2.278,22).
    expect(AVISO_CONTESTACAO_CARTAO).toContain("5 de 5");
    expect(AVISO_CONTESTACAO_CARTAO).toContain("Mercado Pago");
  });

  it("2b/7 — o dossiê de repasse a menor NÃO carrega esse aviso", () => {
    // Ele fala de ausência de repasse; colar isso num caso de valor a menor
    // enfraquece o próprio chamado com um parágrafo que não se aplica.
    const texto = montarDossie(CASO_A_MENOR, { montadoEm: MONTADO_EM });
    expect(texto).not.toContain(AVISO_CONTESTACAO_CARTAO);
  });

  it("2c/7 — o aviso resiste a campo faltando: ausência sem prazo ainda avisa", () => {
    const texto = montarDossie(
      { tipo_caso: "repasse_ausente" },
      { montadoEm: MONTADO_EM },
    );
    expect(texto).toContain(AVISO_CONTESTACAO_CARTAO);
  });
});

describe("🔴 valor estimado nunca é apresentado como número apurado", () => {
  it("3/7 — o caso marcado como estimativa diz que é estimativa", () => {
    const texto = montarDossie(
      { ...CASO_A_MENOR, valor_estimado: true },
      { montadoEm: MONTADO_EM },
    );
    expect(texto.toLowerCase()).toContain("estimativa");
  });

  it("3b/7 — e o caso apurado NÃO usa a palavra", () => {
    const texto = montarDossie(CASO_A_MENOR, { montadoEm: MONTADO_EM });
    expect(texto.toLowerCase()).not.toContain("estimativa");
  });
});

describe("🔴 os identificadores de pagamento: todos, e no plural certo", () => {
  it("4/7 — dois pagamentos listam os DOIS e o texto diz que são dois", () => {
    const texto = montarDossie(
      {
        ...CASO_A_MENOR,
        n_pagamentos: 2,
        payment_ids: ["172656733528", "171656032162"],
      },
      { montadoEm: MONTADO_EM },
    );
    expect(texto).toContain("172656733528");
    expect(texto).toContain("171656032162");
    expect(texto).toContain("2 pagamentos");
  });

  it("4b/7 — um pagamento não fala em plural", () => {
    const texto = montarDossie(CASO_A_MENOR, { montadoEm: MONTADO_EM });
    expect(texto).toContain("1 pagamento");
    expect(texto).not.toContain("1 pagamentos");
  });

  it("4c/7 — sem pagamento identificado, o texto NOMEIA a ausência", () => {
    const texto = montarDossie(
      { ...CASO_A_MENOR, n_pagamentos: 0, payment_ids: [] },
      { montadoEm: MONTADO_EM },
    );
    expect(texto).toContain("nenhum pagamento identificado");
  });
});

describe("🔴 formatação: real brasileiro e data brasileira, sem segunda régua", () => {
  it("5/7 — dinheiro sai com vírgula decimal e as datas em dd/mm/aaaa", () => {
    const texto = montarDossie(
      { ...CASO_A_MENOR, retido_de_fato: 1234.5 },
      { montadoEm: MONTADO_EM },
    );
    expect(texto).toMatch(/R\$\s?1\.234,50/);
    expect(texto).toContain("07/08/2026");
    expect(texto, "a data de montagem também é brasileira").toContain("03/09/2026");
    expect(texto, "nenhuma data ISO crua vaza para o chamado").not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("🔴 campo ausente vira a palavra que o nomeia — NUNCA undefined/null/vazio", () => {
  const VAZIO: CasoDossie = { tipo_caso: "repasse_a_menor" };

  it("6/7 — o caso totalmente vazio ainda produz um bloco legível", () => {
    const texto = montarDossie(VAZIO, { montadoEm: MONTADO_EM });
    expect(texto.length).toBeGreaterThan(200);
    expect(texto).toContain("não informado");
    // 🔴 `formatCurrency` do repositório devolve "R$ 0,00" para nulo. A onda 2
    // removeu esse `coalesce` do SQL de propósito: zero é uma afirmação, nulo
    // é a ausência dela. Um chamado que acusa "R$ 0,00" é pior que nenhum.
    expect(texto).toContain("não apurado");
    expect(texto).not.toContain("R$ 0,00");
  });

  it("6b/7 — nenhuma saída do módulo contém `undefined` ou `null`", () => {
    const casos: CasoDossie[] = [
      CASO_A_MENOR,
      CASO_AUSENTE,
      VAZIO,
      { tipo_caso: "repasse_ausente" },
      { ...CASO_A_MENOR, payment_ids: null, n_pagamentos: null },
      { ...CASO_A_MENOR, titulo: null, sku: null, quantidade: null },
      { ...CASO_A_MENOR, data_pedido: null, data_evento: null, release_date_max: null },
      { ...CASO_A_MENOR, dias_restantes: null, valor_estimado: null },
      { ...CASO_A_MENOR, retido_de_fato: null, cobranca_declarada: null, diferenca: null },
      { ...CASO_A_MENOR, esperado_nosso: null, recebido: null },
      {},
    ];
    for (const c of casos) {
      const texto = montarDossie(c, { montadoEm: MONTADO_EM });
      expect(texto, `undefined vazou: ${JSON.stringify(c).slice(0, 80)}`).not.toContain(
        "undefined",
      );
      expect(texto, `null vazou: ${JSON.stringify(c).slice(0, 80)}`).not.toContain("null");
      expect(texto).not.toContain("NaN");
    }
  });

  it("6c/7 — tipo de caso desconhecido aparece feio, nunca some", () => {
    const texto = montarDossie(
      { ...CASO_A_MENOR, tipo_caso: "tipo_que_o_banco_inventou" },
      { montadoEm: MONTADO_EM },
    );
    expect(texto).toContain("tipo_que_o_banco_inventou");
  });
});

describe("🔴 determinismo: mesma entrada, mesmo texto", () => {
  it("7/7 — duas montagens seguidas produzem exatamente o mesmo bloco", () => {
    const a = montarDossie(CASO_A_MENOR, { montadoEm: MONTADO_EM });
    const b = montarDossie(CASO_A_MENOR, { montadoEm: MONTADO_EM });
    expect(a).toBe(b);
  });

  it("7b/7 — a data de montagem entra por PARÂMETRO, não pelo relógio", () => {
    const a = montarDossie(CASO_A_MENOR, { montadoEm: "2026-09-03" });
    const b = montarDossie(CASO_A_MENOR, { montadoEm: "2026-01-15" });
    expect(a).not.toBe(b);
    expect(b).toContain("15/01/2026");
    // ⚠️ A VPS desta casa já marcou três dias à frente do banco. Relógio local
    // não decide nada que vá para dentro de um chamado.
    expect(a).not.toContain("15/01/2026");
  });

  it("7c/7 — aceita Date além de string ISO, sem deslocar o dia por fuso", () => {
    const texto = montarDossie(CASO_A_MENOR, {
      montadoEm: new Date(2026, 8, 3, 23, 30),
    });
    expect(texto).toContain("03/09/2026");
  });
});

describe("🔴 o bloco copiado diz, ele mesmo, quando o caso NÃO é acionável", () => {
  // Um dossiê copiado circula sozinho. Fora da tela, ninguém que o lê sabe se
  // a linha era acionável no dia em que foi copiada — e hoje quase nenhuma é.
  it("8/7 — caso não acionável carrega o aviso e o motivo real", () => {
    const texto = montarDossie(
      { ...CASO_A_MENOR, acionavel: false, motivo: "regua_nao_liberada" },
      { montadoEm: MONTADO_EM },
    );
    expect(texto).toContain("AINDA NÃO É ACIONÁVEL");
    expect(texto, "o motivo real, não um genérico").toContain("55,3%");
  });

  it("8b/7 — caso acionável NÃO carrega o aviso", () => {
    const texto = montarDossie(
      { ...CASO_A_MENOR, acionavel: true },
      { montadoEm: MONTADO_EM },
    );
    expect(texto).not.toContain("AINDA NÃO É ACIONÁVEL");
  });

  it("8c/7 — sem a flag, o texto assume o lado seguro: não acionável", () => {
    const texto = montarDossie(CASO_A_MENOR, { montadoEm: MONTADO_EM });
    expect(texto).toContain("AINDA NÃO É ACIONÁVEL");
  });
});
