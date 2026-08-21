/**
 * orderSaleFee.test.ts — prova o núcleo puro da ingestão de rebate por
 * pedido (Fase 223, plano 223-03, Task 1).
 *
 * Zero rede, zero banco, zero mock: toda asserção lê
 * `__fixtures__/mlOrderSaleFee.amostra.json` — os 7 pedidos reais medidos em
 * produção (223-01) — mais os valores de `orders.comissao`/`orders.quantidade`
 * documentados em `223-CONTRATO-SALE-FEE.md`, Q3. Molde de leitura de
 * arquivo: `readFileSync` + `resolve(process.cwd(), ...)`, nunca
 * `import.meta.url` (mesmo padrão de `mlOrderSaleFeeContrato.test.ts`).
 *
 * Para quantidade === 1, `orders.comissao` É `sale_fee.net` — não é
 * suposição: é o que a Identidade (II) (`net == comissao × quantidade`)
 * FORÇA quando o multiplicador é 1. Só os dois pedidos de quantidade > 1 têm
 * `comissao` documentado independentemente no contrato medido.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TAMANHO_MAXIMO_LOTE,
  agregarPorPedido,
  classificarCaptura,
  conferenciaComissao,
  detectarTruncamento,
  idsPresentesNaResposta,
  lerPedidos,
  selecionarLote,
  somaComissaoDasLinhas,
  type CapturaDecidida,
  type PedidoSaleFee,
} from "./orderSaleFee.ts";
import type { ResultadoPedidoSaleFee } from "./mlOrderSaleFeeContrato.ts";

const AMOSTRA_CAMINHO = "supabase/functions/_shared/__fixtures__/mlOrderSaleFee.amostra.json";
const CVVFN_CAMINHO = "supabase/functions/_shared/__fixtures__/mlOrderSaleFee.cvvfn.json";

interface AmostraSaleFee {
  medido_em: string;
  results: ResultadoPedidoSaleFee[];
}

function lerAmostra(): AmostraSaleFee {
  const bruto = readFileSync(resolve(process.cwd(), AMOSTRA_CAMINHO), "utf8");
  return JSON.parse(bruto) as AmostraSaleFee;
}

interface AmostraCvvfn {
  medido_em: string;
  procedencia: string;
  results: ResultadoPedidoSaleFee[];
}

function lerAmostraCvvfn(): AmostraCvvfn {
  const bruto = readFileSync(resolve(process.cwd(), CVVFN_CAMINHO), "utf8");
  return JSON.parse(bruto) as AmostraCvvfn;
}

const amostra = lerAmostra();
const amostraCvvfn = lerAmostraCvvfn();

/** Tolerância de centavo — mesmo helper de orderTaxRate.test.ts / mlOrderSaleFeeContrato.test.ts. */
const closeCents = (received: number | null, expected: number) => {
  expect(received).not.toBeNull();
  expect(Math.abs((received as number) - expected)).toBeLessThan(0.01);
};

/**
 * `orders.comissao`/`orders.quantidade` dos 7 pedidos da amostra, conforme
 * 223-CONTRATO-SALE-FEE.md Q3. Para quantidade === 1, comissao == net —
 * forçado pela própria Identidade (II), não suposto.
 */
const ORDERS_COMISSAO_QUANTIDADE: Record<string, { comissao: number; quantidade: number }> = {
  "2000017193192024": { comissao: 10.51, quantidade: 6 },
  "2000017323487432": { comissao: 62.76, quantidade: 1 },
  "2000017530819962": { comissao: 18.4, quantidade: 2 },
  "2000017605774432": { comissao: 70.66, quantidade: 1 },
  "2000017687408928": { comissao: 40.7, quantidade: 1 },
  "2000017757292324": { comissao: 21.9, quantidade: 1 },
  "2000017822557678": { comissao: 21.9, quantidade: 1 },
};

const IDS_CANCELADOS = new Set(["2000017605774432", "2000017822557678"]);

// ─── lerPedidos / agregarPorPedido — Q1, Q2 ─────────────────────────────────

describe("lerPedidos — um registro por pedido, sale_fee da raiz, linhas à parte", () => {
  const mapa = lerPedidos(amostra.results);

  it("devolve um registro por order_id, para os 7 pedidos da amostra", () => {
    expect(mapa.size).toBe(7);
    for (const id of Object.keys(ORDERS_COMISSAO_QUANTIDADE)) {
      expect(mapa.has(id)).toBe(true);
    }
  });

  it("agregarPorPedido é a mesma função (alias do nome do must_haves do plano)", () => {
    expect(agregarPorPedido).toBe(lerPedidos);
  });

  it.each(Object.keys(ORDERS_COMISSAO_QUANTIDADE))(
    "pedido %s: sale_fee lido da RAIZ, gross − rebate == net",
    (id) => {
      const pedido = mapa.get(id) as PedidoSaleFee;
      expect(pedido.saleFee.gross).not.toBeNull();
      expect(pedido.saleFee.net).not.toBeNull();
      expect(pedido.saleFee.rebate).not.toBeNull();
      closeCents(
        (pedido.saleFee.gross as number) - (pedido.saleFee.rebate as number),
        pedido.saleFee.net as number,
      );
    },
  );

  it("pedido 2000017757292324 (dentro da promoção): rebate 21,17 capturado, sem estorno", () => {
    const pedido = mapa.get("2000017757292324") as PedidoSaleFee;
    closeCents(pedido.saleFee.rebate, 21.17);
    closeCents(pedido.saleFee.gross, 43.07);
    closeCents(pedido.saleFee.net, 21.9);
    expect(pedido.temEstorno).toBe(false);
  });

  it.each([...IDS_CANCELADOS])(
    "pedido cancelado %s: sale_fee da raiz NÃO reflete o cancelamento — rebate e estorno CONVIVEM",
    (id) => {
      const pedido = mapa.get(id) as PedidoSaleFee;
      expect(pedido.temEstorno).toBe(true);
      // O sale_fee segue dizendo o que dizia antes do cancelamento — o módulo
      // NÃO apaga um fato para acomodar o outro.
      expect(pedido.saleFee.net).not.toBeNull();
      expect(pedido.saleFee.gross).not.toBeNull();
    },
  );

  it("pedido 2000017822557678: rebate 21,17 E temEstorno true, lado a lado — um não apaga o outro", () => {
    const pedido = mapa.get("2000017822557678") as PedidoSaleFee;
    closeCents(pedido.saleFee.rebate, 21.17);
    expect(pedido.temEstorno).toBe(true);
  });

  it("linha repetida no payload (mesmo detail_id) é contada uma vez só", () => {
    const original = amostra.results.find((r) => r.order_id === 2000017193192024);
    if (!original) throw new Error("pedido de fixture não encontrado");
    const duplicado = {
      ...original,
      details: [...original.details, original.details[0]],
    };
    const mapaDuplicado = lerPedidos([duplicado]);
    const pedido = mapaDuplicado.get("2000017193192024") as PedidoSaleFee;
    expect(pedido.linhas.length).toBe(original.details.length);
  });

  it("pedido sem sale_fee completo e sem linha de comissão (só frete) NÃO entra no mapa — não autoriza afirmar rebate (260821-hap, D-hap-04)", () => {
    const semComissao = {
      order_id: 9999999999999,
      // sale_fee INCOMPLETO de propósito (gross/rebate ausentes) — não é o
      // caso "sale_fee completo, zero linhas" de D-hap-04, é o caso que
      // continua fora do mapa.
      sale_fee: { gross: null, net: 10, rebate: null, discount: 0, discount_reason: null },
      details: [
        {
          items_info: [],
          sales_info: [],
          charge_info: {
            status: null,
            detail_id: 1,
            detail_type: "CHARGE",
            detail_amount: 10,
            detail_sub_type: "CFFE",
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
          marketplace_info: { marketplace: "SHIPPING" },
        },
      ],
    };
    const mapa2 = lerPedidos([semComissao]);
    expect(mapa2.has("9999999999999")).toBe(false);
  });

  it("pedido sem sale_fee nenhum e sem linha de comissão NÃO entra no mapa (260821-hap, D-hap-04)", () => {
    const semNada = {
      order_id: 8888888888888,
      // sale_fee ausente da resposta (não é objeto) — lerSaleFee devolve os
      // cinco campos null; nenhum dos dois critérios de entrada é satisfeito.
      details: [],
    };
    const mapa3 = lerPedidos([semNada]);
    expect(mapa3.has("8888888888888")).toBe(false);
  });

  it("pedido com sale_fee COMPLETO e ZERO linhas de cobrança entra no mapa, com comissaoLinhas nulo e linhas vazio (260821-hap, D-hap-04, medido 2 de 371)", () => {
    const pedidoSintetico = amostraCvvfn.results.find((r) => r.order_id === 9000000000001);
    if (!pedidoSintetico) throw new Error("pedido sintético de zero linhas não encontrado na fixture");
    expect(pedidoSintetico.details).toHaveLength(0);
    const mapa4 = lerPedidos([pedidoSintetico]);
    const pedido = mapa4.get("9000000000001");
    expect(pedido).toBeDefined();
    expect((pedido as PedidoSaleFee).comissaoLinhas).toBeNull();
    expect((pedido as PedidoSaleFee).linhas).toEqual([]);
    // Não confundir com "conferiu e deu zero" — 0 seria um valor medido,
    // null é "não confere" (mesma régua do rebate na fase 223).
    expect((pedido as PedidoSaleFee).comissaoLinhas).not.toBe(0);
  });
});

// ─── Identidade (I) — somaComissaoDasLinhas ────────────────────────────────

describe("somaComissaoDasLinhas — Identidade (I), interna à resposta do ML", () => {
  const mapa = lerPedidos(amostra.results);

  it.each(Object.keys(ORDERS_COMISSAO_QUANTIDADE))(
    "pedido %s: sale_fee.net == Σ detail_amount das linhas CVV*",
    (id) => {
      const pedido = mapa.get(id) as PedidoSaleFee;
      closeCents(pedido.comissaoLinhas, pedido.saleFee.net as number);
    },
  );

  it("frete (CFFE), parcelamento (CFONPN) e estorno (BONUS) NÃO entram na soma", () => {
    // Pedido 2000017687408928 tem CVVML 30,53 + CVVPRC 10,17 = 40,70 = net.
    // Se CFONPN (37,22) ou CFFE (39,75) entrassem, a soma explodiria.
    const pedido = mapa.get("2000017687408928") as PedidoSaleFee;
    closeCents(pedido.comissaoLinhas, 40.7);
  });

  it("pedido cancelado: somar o estorno BONUS zeraria a comissão — a soma exclui BONUS e ainda fecha com net", () => {
    const pedido = mapa.get("2000017822557678") as PedidoSaleFee;
    // As duas linhas BONUS (21,72 + 0,18 = 21,90) têm o MESMO valor das
    // linhas CHARGE que estornam. Se fossem somadas, o líquido seria zero.
    closeCents(pedido.comissaoLinhas, 21.9);
    expect(pedido.comissaoLinhas).not.toBe(0);
  });

  it("pedido 2000014566978158 (fixture cvvfn, 260821-hap): CVVPRC 9,09 + CVVML 32,09 + CVVFN 27,08 = 68,26, com CFFI 44,45 presente e FORA da soma", () => {
    const mapaCvvfn = lerPedidos(amostraCvvfn.results);
    const pedido = mapaCvvfn.get("2000014566978158") as PedidoSaleFee;
    expect(pedido).toBeDefined();
    // A linha CFFI está no pedido (prova que a soma não a ignora por
    // ausência, e sim por predicado — ehLinhaDeComissao devolve falso pra ela).
    const temCffi = pedido.linhas.some((l) => l.detail_sub_type === "CFFI");
    expect(temCffi).toBe(true);
    closeCents(pedido.comissaoLinhas, 68.26);
    closeCents(pedido.comissaoLinhas, pedido.saleFee.net as number);
  });
});

// ─── Identidade (II) — conferenciaComissao, o gate do critério 3 ───────────

describe("conferenciaComissao — Identidade (II), o gate que autoriza afirmar rebate", () => {
  const mapa = lerPedidos(amostra.results);

  it.each(Object.entries(ORDERS_COMISSAO_QUANTIDADE))(
    "pedido %s fecha: net == comissao × quantidade",
    (id, { comissao, quantidade }) => {
      const pedido = mapa.get(id) as PedidoSaleFee;
      const resultado = conferenciaComissao({ net: pedido.saleFee.net, comissao, quantidade });
      expect(resultado.fecha).toBe(true);
      closeCents(resultado.diferenca, 0);
    },
  );

  it("os dois pedidos de quantidade > 1 (6 e 2) fecham só COM o multiplicador", () => {
    const seis = conferenciaComissao({ net: 63.06, comissao: 10.51, quantidade: 6 });
    expect(seis.fecha).toBe(true);
    const dois = conferenciaComissao({ net: 36.8, comissao: 18.4, quantidade: 2 });
    expect(dois.fecha).toBe(true);
  });

  it("omitir o multiplicador (quantidade=1 num pedido de qtd=6) FALHA — a prova do defeito que a Identidade (II) evita", () => {
    // 2000017193192024: net 63,06, comissao 10,51 (por unidade). Sem o
    // multiplicador, a conferência compararia 63,06 contra 10,51 sozinho —
    // R$ 52,55 de diferença — e é exatamente isso que acusaria 62 pedidos
    // bons como divergentes na Pé Vermeio se o multiplicador fosse esquecido.
    const semMultiplicador = conferenciaComissao({ net: 63.06, comissao: 10.51, quantidade: 1 });
    expect(semMultiplicador.fecha).toBe(false);
    expect(Math.abs(semMultiplicador.diferenca as number)).toBeGreaterThan(50);
  });

  it("insumo ausente (comissao null) devolve fecha:false, diferenca:null — nunca 'fecha' por omissão", () => {
    const resultado = conferenciaComissao({ net: 63.06, comissao: null, quantidade: 6 });
    expect(resultado.fecha).toBe(false);
    expect(resultado.diferenca).toBeNull();
  });
});

// ─── selecionarLote — o teto medido (D-hap-01, 260821-hap) ─────────────────

describe("selecionarLote — nunca mais que o teto, nunca repetido", () => {
  it("nunca devolve mais que TAMANHO_MAXIMO_LOTE (o teste lê a constante, não repete o número — o valor muda nesta task)", () => {
    const pendentes = Array.from({ length: 200 }, (_, i) => `pedido-${i}`);
    const lote = selecionarLote(pendentes);
    expect(lote.length).toBe(TAMANHO_MAXIMO_LOTE);
  });

  it("devolve lote vazio para entrada vazia", () => {
    expect(selecionarLote([])).toEqual([]);
  });

  it("não repete pedido dentro do mesmo lote", () => {
    const lote = selecionarLote(["a", "b", "a", "c", "b"]);
    expect(lote).toEqual(["a", "b", "c"]);
  });

  it("respeita um tamanho customizado menor que o teto", () => {
    const lote = selecionarLote(["a", "b", "c", "d"], 2);
    expect(lote).toEqual(["a", "b"]);
  });
});

// ─── classificarCaptura — D-223-05: 206 nunca vira zero ────────────────────
// ─── + D-hap-02 (260821-hap): ausência só conclui sem_linha em lote solo ───

describe("classificarCaptura — 206 nunca vira zero, capturado nunca reconsulta, erro não grava", () => {
  const agora = new Date("2026-08-21T12:00:00Z");
  const mapa = lerPedidos(amostra.results);
  const pedidosDoLote = ["2000017193192024", "2000017757292324"];
  const presentesDoLote = idsPresentesNaResposta(amostra.results);

  it("206 (Partial Content): TODOS os pedidos do lote saem parcial, com rebate AUSENTE — nunca zero", () => {
    const decisoes = classificarCaptura({
      pedidosDoLote,
      lidos: mapa,
      presentesNaResposta: presentesDoLote,
      httpStatus: 206,
      agora,
      tentativasAtuais: {},
    });
    expect(decisoes).toHaveLength(2);
    for (const d of decisoes) {
      expect(d.status).toBe("parcial");
      expect(d.saleFee).toBeNull(); // AUSENTE, não {rebate: 0, ...}
      expect(d.proximaTentativa).not.toBeNull();
    }
  });

  it("200: pedido presente em `lidos` sai capturado (ok) e NUNCA reconsultado", () => {
    const decisoes = classificarCaptura({
      pedidosDoLote,
      lidos: mapa,
      presentesNaResposta: presentesDoLote,
      httpStatus: 200,
      agora,
      tentativasAtuais: {},
    });
    const capturado = decisoes.find((d) => d.ml_order_id === "2000017193192024") as CapturaDecidida;
    expect(capturado.status).toBe("ok");
    expect(capturado.proximaTentativa).toBeNull();
    closeCents(capturado.saleFee?.net ?? null, 63.06);
  });

  it("200, lote de UM id só, ausente da resposta: sai 'sem_linha' — ausência CONFIRMADA sozinha (D-hap-02)", () => {
    const decisoes = classificarCaptura({
      pedidosDoLote: ["pedido-fantasma"],
      lidos: mapa,
      presentesNaResposta: new Set(), // ninguém voltou — lote de 1 id
      httpStatus: 200,
      agora,
      tentativasAtuais: {},
    });
    expect(decisoes[0].status).toBe("sem_linha");
    expect(decisoes[0].proximaTentativa).not.toBeNull(); // 1ª tentativa, ainda reagenda
  });

  it("200, lote de MAIS DE UM id, um deles ausente da resposta: o ausente sai 'erro' (reagenda), NUNCA 'sem_linha' — é o defeito medido: 327 de 1.560 pedidos viraram sem_linha a partir de lote truncado (D-hap-02)", () => {
    const pedidosDoLoteMaior = ["2000017193192024", "2000017757292324", "pedido-fantasma"];
    // presentesNaResposta reflete só os dois reais — "pedido-fantasma" nunca
    // esteve na resposta (simula o truncamento medido: 60 ids -> 49 voltaram).
    const decisoes = classificarCaptura({
      pedidosDoLote: pedidosDoLoteMaior,
      lidos: mapa,
      presentesNaResposta: presentesDoLote,
      httpStatus: 200,
      agora,
      tentativasAtuais: {},
    });
    const ausente = decisoes.find((d) => d.ml_order_id === "pedido-fantasma") as CapturaDecidida;
    expect(ausente.status).toBe("erro");
    expect(ausente.status).not.toBe("sem_linha");
    expect(ausente.proximaTentativa).not.toBeNull();
    expect(ausente.saleFee).toBeNull();
    // Os dois que vieram seguem "ok" normalmente — o defeito de um não contamina o resto do lote.
    const capturado = decisoes.find((d) => d.ml_order_id === "2000017193192024") as CapturaDecidida;
    expect(capturado.status).toBe("ok");
  });

  it("200, id presente na resposta mas SEM linha de comissão e SEM sale_fee completo: sai 'sem_linha' — o ML respondeu, mas não autoriza afirmar rebate (D-hap-02/D-hap-04)", () => {
    const pedidoIncompletoRaw = {
      order_id: 7777777777777,
      sale_fee: { gross: null, net: 10, rebate: null, discount: 0, discount_reason: null },
      details: [],
    };
    const presentes = idsPresentesNaResposta([pedidoIncompletoRaw]);
    const lidos = lerPedidos([pedidoIncompletoRaw]); // não entra no mapa (D-hap-04)
    expect(lidos.has("7777777777777")).toBe(false);
    expect(presentes.has("7777777777777")).toBe(true);
    const decisoes = classificarCaptura({
      pedidosDoLote: ["7777777777777"],
      lidos,
      presentesNaResposta: presentes,
      httpStatus: 200,
      agora,
      tentativasAtuais: {},
    });
    expect(decisoes[0].status).toBe("sem_linha");
  });

  it("sem_linha: depois de 3 tentativas, deixa de ter próxima tentativa agendada", () => {
    const decisoes = classificarCaptura({
      pedidosDoLote: ["pedido-fantasma"],
      lidos: mapa,
      presentesNaResposta: new Set(),
      httpStatus: 200,
      agora,
      tentativasAtuais: { "pedido-fantasma": 2 }, // esta rodada é a 3ª
    });
    expect(decisoes[0].status).toBe("sem_linha");
    expect(decisoes[0].tentativas).toBe(3);
    expect(decisoes[0].proximaTentativa).toBeNull();
  });

  it("resposta de erro (429/5xx): lote inteiro sai 'erro', reagenda, e NÃO grava nenhum valor", () => {
    const decisoes = classificarCaptura({
      pedidosDoLote,
      lidos: mapa,
      presentesNaResposta: presentesDoLote,
      httpStatus: 429,
      agora,
      tentativasAtuais: {},
    });
    for (const d of decisoes) {
      expect(d.status).toBe("erro");
      expect(d.saleFee).toBeNull();
      expect(d.proximaTentativa).not.toBeNull();
    }
  });
});

// ─── idsPresentesNaResposta — quem voltou na resposta, sem filtro (260821-hap) ─

describe("idsPresentesNaResposta — todo order_id cru de results[], sem filtro de conteúdo (D-hap-03)", () => {
  it("devolve o order_id de todo item, inclusive o sem linha de comissão nenhuma", () => {
    const presentes = idsPresentesNaResposta(amostra.results);
    for (const r of amostra.results) {
      expect(presentes.has(String(r.order_id))).toBe(true);
    }
    expect(presentes.size).toBe(amostra.results.length);
  });

  it("ignora item malformado sem lançar", () => {
    const presentes = idsPresentesNaResposta([null, undefined, "string", 42, {}, { order_id: 123 }]);
    expect(presentes.has("123")).toBe(true);
    expect(presentes.size).toBe(1);
  });

  it("entrada vazia devolve conjunto vazio", () => {
    expect(idsPresentesNaResposta([]).size).toBe(0);
  });
});

// ─── detectarTruncamento — enviados vs presentes (260821-hap, D-hap-01/03) ──

describe("detectarTruncamento — compara o que foi enviado com o que voltou, nunca usa `lidos`", () => {
  it("25 enviados, 20 presentes: truncado verdadeiro, 5 ausentes na ordem de envio", () => {
    const enviados = Array.from({ length: 25 }, (_, i) => `p${i}`);
    const presentes = new Set(enviados.slice(0, 20));
    const resultado = detectarTruncamento({ enviados, presentes });
    expect(resultado.truncado).toBe(true);
    expect(resultado.ausentes).toEqual(enviados.slice(20));
  });

  it("todos presentes: truncado falso, lista vazia", () => {
    const enviados = ["a", "b", "c"];
    const presentes = new Set(enviados);
    const resultado = detectarTruncamento({ enviados, presentes });
    expect(resultado.truncado).toBe(false);
    expect(resultado.ausentes).toEqual([]);
  });

  it("nunca repete id na lista de ausentes, mesmo com duplicata nos enviados", () => {
    const resultado = detectarTruncamento({ enviados: ["a", "a", "b"], presentes: new Set() });
    expect(resultado.ausentes).toEqual(["a", "b"]);
  });
});
