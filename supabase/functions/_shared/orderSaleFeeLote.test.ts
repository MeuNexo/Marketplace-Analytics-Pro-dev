/**
 * orderSaleFeeLote.test.ts — prova o módulo de resolução de lote com
 * truncamento (Fase 223, quick 260821-hap, Task 2), com uma CHAMADA FALSA
 * injetada — zero rede, zero Deno, zero banco. O defeito medido: 60
 * `order_ids` enviados devolvendo envelope `limit:150 · total:49 ·
 * results:49 · linhas:150` (11 pedidos SUMIRAM), e 327 de 1.560 pedidos
 * gravados `sem_linha` sendo que a API os devolve normalmente.
 */
import { describe, expect, it } from "vitest";
import {
  resolverLoteComTruncamento,
  type ChamarResultado,
} from "./orderSaleFeeLote.ts";
import type { CapturaDecidida } from "./orderSaleFee.ts";

const AGORA = new Date("2026-08-21T12:00:00Z");

/** Fabrica um item de `results[]` mínimo, válido o suficiente para `lerPedidos`. */
function pedidoValido(orderId: string, net = 10): Record<string, unknown> {
  return {
    order_id: orderId,
    sale_fee: { gross: net, net, rebate: 0, discount: 0, discount_reason: null },
    details: [
      {
        items_info: [],
        sales_info: [],
        charge_info: {
          status: null,
          detail_id: Number(orderId) || Math.floor(Math.random() * 1e9),
          detail_type: "CHARGE",
          detail_amount: net,
          detail_sub_type: "CVVML",
          charge_bonified_id: null,
          creation_date_time: "",
          status_description: null,
          transaction_detail: "",
          legal_document_number: null,
          legal_document_status: "",
          debited_from_operation: "",
          legal_document_status_description: "",
          debited_from_operation_description: "",
        },
        currency_info: { currency_id: "BRL" },
        discount_info: {
          rebate: null,
          discount_amount: null,
          discount_reason: null,
          charge_amount_without_discount: null,
        },
        document_info: { document_id: 1 },
        shipping_info: { pack_id: null, shipping_id: "1", receiver_shipping_cost: 0 },
        marketplace_info: { marketplace: "CORE" },
      },
    ],
  };
}

/**
 * Chamada falsa "programável": recebe um mapa de `ids.join(",")` para a
 * resposta a devolver, e registra CADA CONJUNTO de ids recebido, em ordem —
 * as asserções de "uma chamada só" e "cinco solos, uma por id" leem esse
 * registro, não um contador agregado. Também mede sobreposição: incrementa
 * um contador ao entrar e decrementa ao sair; se o máximo observado passar
 * de 1, alguma chamada rodou em paralelo com outra.
 */
function chamadaFalsa(respostasPorConjunto: Map<string, ChamarResultado | (() => ChamarResultado)>) {
  const chamadasRecebidas: string[][] = [];
  let emVoo = 0;
  let maxEmVoo = 0;

  const chamar = async (ids: readonly string[]): Promise<ChamarResultado> => {
    emVoo += 1;
    maxEmVoo = Math.max(maxEmVoo, emVoo);
    chamadasRecebidas.push([...ids]);
    try {
      const chave = [...ids].join(",");
      const programado = respostasPorConjunto.get(chave);
      if (!programado) {
        throw new Error(`chamada falsa: nenhuma resposta programada para [${chave}]`);
      }
      const resposta = typeof programado === "function" ? programado() : programado;
      return resposta;
    } finally {
      emVoo -= 1;
    }
  };

  return { chamar, chamadasRecebidas, maxEmVoo: () => maxEmVoo };
}

const pausasFalsas: number[] = [];
function pausarFalsa() {
  pausasFalsas.length = 0;
  return async (ms: number) => {
    pausasFalsas.push(ms);
  };
}

describe("resolverLoteComTruncamento — o caso medido: lote truncado resolve os ausentes sozinho", () => {
  it("25 enviados, 20 presentes: os 20 saem classificados na hora; os 5 ausentes disparam 5 solos — 3 voltam ok, 2 saem sem_linha (confirmado sozinho)", async () => {
    const enviados = Array.from({ length: 25 }, (_, i) => `p${i}`);
    const presentes = enviados.slice(0, 20);
    const ausentes = enviados.slice(20); // p20..p24

    const mapa = new Map<string, ChamarResultado>();
    mapa.set(enviados.join(","), {
      httpStatus: 200,
      results: presentes.map((id) => pedidoValido(id)),
    });
    // 3 solos voltam com conteúdo (ok); 2 voltam vazios (sem_linha).
    for (const id of ["p20", "p21", "p22"]) {
      mapa.set(id, { httpStatus: 200, results: [pedidoValido(id)] });
    }
    for (const id of ["p23", "p24"]) {
      mapa.set(id, { httpStatus: 200, results: [] });
    }

    const { chamar, chamadasRecebidas, maxEmVoo } = chamadaFalsa(mapa);
    const resultado = await resolverLoteComTruncamento({
      lote: enviados,
      agora: AGORA,
      tentativasAtuais: {},
      chamar,
      pausar: pausarFalsa(),
      pausaMs: 1,
      maxSolo: 10,
    });

    expect(resultado.truncamentoDetectado).toBe(true);
    expect(resultado.solosUsados).toBe(5);
    expect(resultado.interrompidoPor429).toBe(false);
    expect(resultado.decisoes).toHaveLength(25);

    const porId = new Map(resultado.decisoes.map((d) => [d.ml_order_id, d]));
    for (const id of presentes) {
      expect(porId.get(id)?.status).toBe("ok");
    }
    for (const id of ["p20", "p21", "p22"]) {
      expect(porId.get(id)?.status).toBe("ok");
    }
    for (const id of ["p23", "p24"]) {
      expect(porId.get(id)?.status).toBe("sem_linha");
    }

    // 1 chamada principal + 5 solos = 6 conjuntos de ids recebidos.
    expect(chamadasRecebidas).toHaveLength(6);
    expect(chamadasRecebidas[0]).toEqual(enviados);
    expect(chamadasRecebidas.slice(1).map((c) => c.join(","))).toEqual([
      "p20",
      "p21",
      "p22",
      "p23",
      "p24",
    ]);
    expect(maxEmVoo()).toBe(1); // nenhuma chamada se sobrepõe
  });

  it("sem truncamento: 25 enviados, 25 devolvidos — uma única chamada, nenhuma solo", async () => {
    const enviados = Array.from({ length: 25 }, (_, i) => `q${i}`);
    const mapa = new Map<string, ChamarResultado>();
    mapa.set(enviados.join(","), {
      httpStatus: 200,
      results: enviados.map((id) => pedidoValido(id)),
    });
    const { chamar, chamadasRecebidas } = chamadaFalsa(mapa);
    const resultado = await resolverLoteComTruncamento({
      lote: enviados,
      agora: AGORA,
      tentativasAtuais: {},
      chamar,
      pausar: pausarFalsa(),
      pausaMs: 1,
      maxSolo: 10,
    });
    expect(resultado.truncamentoDetectado).toBe(false);
    expect(resultado.solosUsados).toBe(0);
    expect(chamadasRecebidas).toHaveLength(1);
    expect(resultado.decisoes.every((d) => d.status === "ok")).toBe(true);
  });
});

describe("resolverLoteComTruncamento — 429: interrompe tudo, nunca insiste", () => {
  it("429 no lote principal: todos saem erro, interrompidoPor429 verdadeiro, nenhuma chamada solo acontece", async () => {
    const lote = ["a", "b", "c"];
    const mapa = new Map<string, ChamarResultado>();
    mapa.set(lote.join(","), { httpStatus: 429, results: [] });
    const { chamar, chamadasRecebidas } = chamadaFalsa(mapa);
    const resultado = await resolverLoteComTruncamento({
      lote,
      agora: AGORA,
      tentativasAtuais: {},
      chamar,
      pausar: pausarFalsa(),
      pausaMs: 1,
      maxSolo: 10,
    });
    expect(resultado.interrompidoPor429).toBe(true);
    expect(resultado.decisoes.every((d) => d.status === "erro")).toBe(true);
    expect(resultado.solosUsados).toBe(0);
    expect(chamadasRecebidas).toHaveLength(1); // só o lote principal
  });

  it("429 no meio das solos: as já resolvidas mantêm o que ficou, as restantes saem erro, nenhuma chamada depois do 429", async () => {
    const lote = ["a", "b", "c"]; // 3 ids, nenhum presente -> 3 ausentes -> 3 solos
    const mapa = new Map<string, ChamarResultado>();
    mapa.set(lote.join(","), { httpStatus: 200, results: [] }); // nenhum presente
    mapa.set("a", { httpStatus: 200, results: [pedidoValido("a")] }); // 1ª solo: resolve ok
    mapa.set("b", { httpStatus: 429, results: [] }); // 2ª solo: bloqueio
    // "c" nunca deveria ser chamada — se for, o mapa não tem entrada e a
    // chamada falsa lança, o que também prova a regra (falha o teste).

    const { chamar, chamadasRecebidas } = chamadaFalsa(mapa);
    const resultado = await resolverLoteComTruncamento({
      lote,
      agora: AGORA,
      tentativasAtuais: {},
      chamar,
      pausar: pausarFalsa(),
      pausaMs: 1,
      maxSolo: 10,
    });

    expect(resultado.interrompidoPor429).toBe(true);
    const porId = new Map(resultado.decisoes.map((d) => [d.ml_order_id, d]));
    expect(porId.get("a")?.status).toBe("ok"); // já resolvida antes do 429, mantém
    expect(porId.get("b")?.status).toBe("erro"); // o próprio 429
    expect(porId.get("c")?.status).toBe("erro"); // nunca chamada, reagenda
    // lote principal + solo "a" + solo "b" (429) = 3. "c" NUNCA é chamada.
    expect(chamadasRecebidas).toHaveLength(3);
    expect(chamadasRecebidas.some((c) => c.join(",") === "c")).toBe(false);
  });
});

describe("resolverLoteComTruncamento — 206: parcial, sale_fee nulo, nenhuma solo", () => {
  it("206 no lote inteiro: todos parcial, saleFee nulo, nenhuma solo disparada", async () => {
    const lote = ["a", "b"];
    const mapa = new Map<string, ChamarResultado>();
    mapa.set(lote.join(","), { httpStatus: 206, results: [] });
    const { chamar, chamadasRecebidas } = chamadaFalsa(mapa);
    const resultado = await resolverLoteComTruncamento({
      lote,
      agora: AGORA,
      tentativasAtuais: {},
      chamar,
      pausar: pausarFalsa(),
      pausaMs: 1,
      maxSolo: 10,
    });
    expect(resultado.decisoes.every((d) => d.status === "parcial")).toBe(true);
    expect(resultado.decisoes.every((d) => d.saleFee === null)).toBe(true);
    expect(resultado.solosUsados).toBe(0);
    expect(chamadasRecebidas).toHaveLength(1);
  });
});

describe("resolverLoteComTruncamento — 404 do lote inteiro: normalizado para resposta vazia, NUNCA sem_linha direto", () => {
  it("404 do lote: todos ficam ausentes, cada um é reconsultado sozinho; o que voltar 404 sozinho sai sem_linha", async () => {
    const lote = ["a", "b"];
    const mapa = new Map<string, ChamarResultado>();
    mapa.set(lote.join(","), { httpStatus: 404, results: [] });
    mapa.set("a", { httpStatus: 200, results: [pedidoValido("a")] });
    mapa.set("b", { httpStatus: 404, results: [] }); // 404 sozinho também
    const { chamar, chamadasRecebidas } = chamadaFalsa(mapa);
    const resultado = await resolverLoteComTruncamento({
      lote,
      agora: AGORA,
      tentativasAtuais: {},
      chamar,
      pausar: pausarFalsa(),
      pausaMs: 1,
      maxSolo: 10,
    });
    const porId = new Map(resultado.decisoes.map((d) => [d.ml_order_id, d]));
    expect(porId.get("a")?.status).toBe("ok");
    expect(porId.get("b")?.status).toBe("sem_linha");
    // Nenhum decisão do lote de 2 (multi-id) pode ter concluído sem_linha
    // diretamente do 404 do lote — só depois da reconsulta solo.
    expect(chamadasRecebidas).toHaveLength(3); // lote + solo a + solo b
  });
});

describe("resolverLoteComTruncamento — orçamento de solos esgotado: sobra vira erro, nunca sem_linha", () => {
  it("maxSolo 2, 5 ausentes: 2 reconsultados, 3 restantes saem erro, ausentesNaoResolvidos = 3", async () => {
    const lote = ["a", "b", "c", "d", "e"];
    const mapa = new Map<string, ChamarResultado>();
    mapa.set(lote.join(","), { httpStatus: 200, results: [] }); // todos ausentes
    mapa.set("a", { httpStatus: 200, results: [pedidoValido("a")] });
    mapa.set("b", { httpStatus: 200, results: [pedidoValido("b")] });
    // c, d, e NUNCA devem ser chamados — orçamento esgota em 2.

    const { chamar, chamadasRecebidas } = chamadaFalsa(mapa);
    const resultado = await resolverLoteComTruncamento({
      lote,
      agora: AGORA,
      tentativasAtuais: {},
      chamar,
      pausar: pausarFalsa(),
      pausaMs: 1,
      maxSolo: 2,
    });

    expect(resultado.solosUsados).toBe(2);
    expect(resultado.ausentesNaoResolvidos).toBe(3);
    const porId = new Map(resultado.decisoes.map((d) => [d.ml_order_id, d]));
    expect(porId.get("a")?.status).toBe("ok");
    expect(porId.get("b")?.status).toBe("ok");
    for (const id of ["c", "d", "e"]) {
      expect(porId.get(id)?.status).toBe("erro");
      expect(porId.get(id)?.status).not.toBe("sem_linha");
    }
    expect(chamadasRecebidas).toHaveLength(3); // lote + solo a + solo b, nunca c/d/e
  });
});

describe("resolverLoteComTruncamento — lote de um id só: recursão termina por construção", () => {
  it("resposta vazia sai sem_linha e NENHUMA chamada extra é feita", async () => {
    const mapa = new Map<string, ChamarResultado>();
    mapa.set("solo-1", { httpStatus: 200, results: [] });
    const { chamar, chamadasRecebidas } = chamadaFalsa(mapa);
    const resultado = await resolverLoteComTruncamento({
      lote: ["solo-1"],
      agora: AGORA,
      tentativasAtuais: {},
      chamar,
      pausar: pausarFalsa(),
      pausaMs: 1,
      maxSolo: 10,
    });
    expect(resultado.decisoes).toHaveLength(1);
    expect(resultado.decisoes[0].status).toBe("sem_linha");
    expect(resultado.solosUsados).toBe(0);
    expect(chamadasRecebidas).toHaveLength(1); // só a própria chamada, nenhuma extra
  });
});

describe("resolverLoteComTruncamento — pedidosLidos acumula lote principal + solos", () => {
  it("pedidosLidos contém tanto os presentes do lote principal quanto os resolvidos via solo", async () => {
    const lote = ["a", "b"]; // a presente, b ausente
    const mapa = new Map<string, ChamarResultado>();
    mapa.set(lote.join(","), { httpStatus: 200, results: [pedidoValido("a")] });
    mapa.set("b", { httpStatus: 200, results: [pedidoValido("b")] });
    const { chamar } = chamadaFalsa(mapa);
    const resultado = await resolverLoteComTruncamento({
      lote,
      agora: AGORA,
      tentativasAtuais: {},
      chamar,
      pausar: pausarFalsa(),
      pausaMs: 1,
      maxSolo: 10,
    });
    expect(resultado.pedidosLidos.has("a")).toBe(true);
    expect(resultado.pedidosLidos.has("b")).toBe(true);
  });
});
