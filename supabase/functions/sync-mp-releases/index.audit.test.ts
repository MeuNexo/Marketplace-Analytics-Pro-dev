/**
 * index.audit.test.ts — auditoria do FONTE de `sync-mp-releases`
 * (Fase 225, plano 225-01, Task 1).
 *
 * POR QUE ESTE TESTE LÊ O ARQUIVO COMO TEXTO, EM VEZ DE IMPORTAR: o `.ts` da
 * edge function importa módulos remotos do Deno
 * (`https://deno.land/std@.../http/server.ts`, `https://esm.sh/...`), que o
 * vitest (node) não resolve. Molde:
 * `supabase/functions/sync-ml-order-sale-fee/index.audit.test.ts` (223-04) —
 * leitura de arquivo do disco, sem banco e sem rede, provando propriedades do
 * FONTE em vez do comportamento em runtime.
 *
 * O QUE ESTE TESTE PROTEGE: a chave de conciliação venda↔repasse. O defeito
 * que este plano fecha já se repetiu TRÊS vezes nesta base — `sync-ml-billing`,
 * `_shared/orderSaleFee.ts` e esta função leem da API a chave que liga o
 * movimento ao pedido e a descartam no upsert. Este portão existe para reprovar
 * a quarta vez.
 *
 * ESCRITO PELA FORMA, NÃO PELA STRING DE HOJE: um portão que só conhece o texto
 * atual da linha não protege o próximo refactor. As asserções abaixo checam
 * PROPRIEDADES (a chave existe no objeto do upsert; ela é alimentada por `order`
 * do payload; a chave de conflito não mudou; a lista de status não mudou), não
 * a grafia exata da expressão.
 *
 * ── 225-09: O QUE ESTE ARQUIVO PASSOU A PROTEGER ──────────────────────────
 *
 * A ingestão aceitava uma entrada perguntando DE QUE TIPO É O PEDIDO e nunca
 * QUEM RECEBEU O DINHEIRO. `order.type === 'mercadolibre'` é verdadeiro tanto
 * quando a Pé Vermeio VENDE quanto quando o dono COMPRA no ML pagando com a
 * mesma conta Mercado Pago — e isso pôs R$ 12.232,60 de compra pessoal em 38
 * linhas dentro do caixa da empresa desde 07/01/2026, 97,6% em maio e agosto.
 *
 * 🔴 O DISCRIMINADOR NÃO É ANTI-JOIN CONTRA `orders`. As 28 vendas reais órfãs
 * (R$ 2.449,52) falham no MESMO teste de "não casa com orders" que as 38
 * compras. Quem separa é o PAR `collector_id` × `payer_id`, medido mutuamente
 * exclusivo e exaustivo em 438 de 438 linhas (225-CENSO-COLLECTOR.md).
 *
 * 🔴 O DEFEITO MAIS CARO QUE ESTE PORTÃO PEGA É SILENCIOSO: o laço grava a
 * linha INTEIRA para todo pagamento da página. Se a re-invocação apenas pular a
 * consulta de detalhe de um pagamento já conferido, a compra pessoal volta a
 * ser gravada como receita com motivo nulo — combinação que o CHECK do banco
 * ACEITA. Sem erro, sem log, sem sinal. Por isso as asserções 9 e 10.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ_FONTE = "supabase/functions/sync-mp-releases/index.ts";

function ler(caminho: string): string {
  return readFileSync(resolve(process.cwd(), caminho), "utf8");
}

/**
 * Remove comentários de linha (`//...`) e de bloco de um fonte TypeScript.
 * Sem isso, a prosa que EXPLICA a regra ("o valor era descartado aqui") seria
 * contada como se FOSSE a violação que ela documenta — a mesma colisão
 * prosa-versus-grep que já mordeu esta base (`rebateSqlAudit.test.ts`, 223-03).
 */
function semComentarios(ts: string): string {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((linha) => {
      const i = linha.indexOf("//");
      return i === -1 ? linha : linha.slice(0, i);
    })
    .join("\n");
}

/**
 * Recorta o objeto literal empurrado em `rows`, contando chaves para achar o
 * fechamento — em vez de um `slice` de N caracteres, que quebra assim que
 * alguém acrescentar um campo. Devolve o corpo do objeto, sem as chaves
 * externas.
 */
function objetoDoUpsert(corpoFonte: string): string {
  const marca = corpoFonte.indexOf("rows.push({");
  expect(marca, "`rows.push({` não encontrado no fonte").toBeGreaterThan(-1);

  const inicio = corpoFonte.indexOf("{", marca);
  let profundidade = 0;
  for (let i = inicio; i < corpoFonte.length; i++) {
    if (corpoFonte[i] === "{") profundidade++;
    else if (corpoFonte[i] === "}") {
      profundidade--;
      if (profundidade === 0) return corpoFonte.slice(inicio + 1, i);
    }
  }
  throw new Error("objeto do rows.push não fecha — fonte malformado?");
}

/**
 * 225-09 — TODOS os sítios que empurram linha no lote, não só o primeiro.
 *
 * A asserção 10 depende disto: o PostgREST monta o insert pela UNIÃO das chaves
 * do lote e preenche com nulo/default o que falta em cada objeto. Um objeto com
 * formato diferente no meio do lote produz exatamente a reversão silenciosa que
 * a asserção 9 torna MAIS provável, não menos — ao exigir que os campos de
 * procedência venham do estado lido num ramo e do payload no outro, ela empurra
 * o implementador para dois formatos de objeto.
 */
function objetosDoUpsert(corpoFonte: string): string[] {
  const achados: string[] = [];
  let cursor = 0;
  for (;;) {
    const marca = corpoFonte.indexOf("rows.push({", cursor);
    if (marca === -1) break;
    const inicio = corpoFonte.indexOf("{", marca);
    let profundidade = 0;
    let fim = -1;
    for (let i = inicio; i < corpoFonte.length; i++) {
      if (corpoFonte[i] === "{") profundidade++;
      else if (corpoFonte[i] === "}") {
        profundidade--;
        if (profundidade === 0) { fim = i; break; }
      }
    }
    if (fim === -1) throw new Error("objeto do rows.push não fecha — fonte malformado?");
    achados.push(corpoFonte.slice(inicio + 1, fim));
    cursor = fim;
  }
  return achados;
}

/**
 * 225-09 — o bloco `{ … }` que CONTÉM a posição dada, achado por contagem de
 * chaves para os dois lados. Serve para perguntar "o que mais existe dentro do
 * ramo onde esta chamada mora?" sem depender do nome da variável de condição.
 */
function blocoQueContem(corpoFonte: string, posicao: number): string {
  let profundidade = 0;
  let inicio = -1;
  for (let i = posicao; i >= 0; i--) {
    if (corpoFonte[i] === "}") profundidade++;
    else if (corpoFonte[i] === "{") {
      if (profundidade === 0) { inicio = i; break; }
      profundidade--;
    }
  }
  expect(inicio, "não achei o bloco que contém a posição " + posicao).toBeGreaterThan(-1);

  let p2 = 0;
  for (let i = inicio; i < corpoFonte.length; i++) {
    if (corpoFonte[i] === "{") p2++;
    else if (corpoFonte[i] === "}") {
      p2--;
      if (p2 === 0) return corpoFonte.slice(inicio + 1, i);
    }
  }
  throw new Error("bloco não fecha — fonte malformado?");
}

/** O valor à direita de `chave:` dentro de um objeto literal, até a quebra de linha. */
function valorDaChave(objeto: string, chave: string): string | null {
  const re = new RegExp("(^|[\\s,{])" + chave + "\\s*:\\s*([^\\n]*)");
  const m = re.exec(objeto);
  return m ? m[2] : null;
}

/** O corpo do laço que percorre os pagamentos da página. */
function corpoDoLaco(corpoFonte: string): string {
  const marca = corpoFonte.indexOf("for (const p of");
  expect(marca, "laço de pagamentos não encontrado no fonte").toBeGreaterThan(-1);
  return blocoQueContem(corpoFonte, corpoFonte.indexOf("{", marca) + 1);
}

const fonte = ler(ARQ_FONTE);
const corpo = semComentarios(fonte);
const objetoUpsert = objetoDoUpsert(corpo);
const objetosUpsert = objetosDoUpsert(corpo);
const laco = corpoDoLaco(corpo);

/** As cinco colunas de procedência que a Task 1 criou, e as duas chaves. */
const COLUNAS_DE_PROCEDENCIA = [
  "recebedor_ml_user_id",
  "pagador_ml_user_id",
  "entra_no_caixa",
  "motivo_fora_do_caixa",
  "origem_conferida_em",
] as const;

// ─── A chave de conciliação chega ao upsert ────────────────────────────────

describe("o objeto empurrado em `rows` carrega a chave de conciliação — regra: sem ml_order_id é impossível dizer se uma venda foi repassada", () => {
  it("o objeto do upsert tem uma propriedade `ml_order_id`", () => {
    expect(
      /(^|[\s,{])ml_order_id\s*:/.test(objetoUpsert),
      "a chave de conciliação foi descartada de novo no rows.push — é a quarta recaída do mesmo defeito (225-01)",
    ).toBe(true);
  });

  /**
   * 225-09 — POR QUE ESTAS DUAS ASSERÇÕES MUDARAM DE FORMA (e não de intenção).
   *
   * Até o 225-01 o campo recebia, sempre, o `order.id` do payload, e conferir a
   * EXPRESSÃO do objeto bastava. A partir do 225-09 isso deixou de ser verdade por
   * decisão de projeto: na família do frete pago pelo comprador, o id que vem no
   * bloco de pedido é o do ENVIO, e o campo passa a receber o PEDIDO RESOLVIDO pelo
   * endpoint /shipments/{id} — provado 103/103 pelo censo. Uma asserção que exigisse
   * `order.id` na própria expressão reprovaria exatamente a correção do G-06.
   *
   * A intenção continua idêntica — nunca constante, nunca payment_id, e existe
   * caminho que grava NULO em vez de string vazia — mas agora ela é conferida sobre
   * TODAS as atribuições feitas à variável dentro do laço, e não sobre uma linha.
   * Isso é estritamente mais forte: acrescenta a exigência de que o pedido resolvido
   * pelo envio realmente alimente o campo.
   */
  const nomeDaVariavelDoPedido = (() => {
    const valor = valorDaChave(objetoUpsert, "ml_order_id");
    expect(valor, "propriedade ml_order_id não encontrada").not.toBeNull();
    const m = /^\s*([A-Za-z_$][\w$]*)\s*,?\s*$/.exec(valor as string);
    expect(
      m,
      "ml_order_id deixou de ser alimentado por uma variável — valor lido: " + valor,
    ).not.toBeNull();
    return (m as RegExpExecArray)[1];
  })();

  const atribuicoesAoPedido = [
    ...laco.matchAll(new RegExp("\\b" + nomeDaVariavelDoPedido + "\\s*=(?!=)\\s*([^;\\n]*)", "g")),
  ].map((m) => m[1]);

  it("`ml_order_id` é alimentado por atribuições dentro do laço, nunca por constante", () => {
    expect(
      atribuicoesAoPedido.length,
      "a variável `" + nomeDaVariavelDoPedido + "` nunca é atribuída no laço",
    ).toBeGreaterThanOrEqual(1);
    expect(
      atribuicoesAoPedido.some((a) => /^\s*["'`]/.test(a)),
      "alguma atribuição é literal fixo: " + JSON.stringify(atribuicoesAoPedido),
    ).toBe(false);
  });

  it("uma das atribuições vem de `order.id` do payload do Mercado Pago", () => {
    expect(
      atribuicoesAoPedido.some((a) => /\border\s*\?*\.\s*id\b/.test(a)),
      "nenhuma atribuição lê o pedido do payload: " + JSON.stringify(atribuicoesAoPedido),
    ).toBe(true);
  });

  it("uma das atribuições vem do `order_id` devolvido pelo endpoint de envio — é o G-06", () => {
    expect(
      atribuicoesAoPedido.some((a) => /\border_id\b/.test(a)),
      "o pedido resolvido pelo envio não alimenta o campo: " + JSON.stringify(atribuicoesAoPedido),
    ).toBe(true);
  });

  it("nenhuma atribuição usa payment_id — são identificadores de coisas diferentes, e 7,7% dos pedidos têm mais de um pagamento", () => {
    expect(
      atribuicoesAoPedido.some((a) => /payment_id|\bp\.id\b/.test(a)),
      "atribuições lidas: " + JSON.stringify(atribuicoesAoPedido),
    ).toBe(false);
  });

  it("vazio vira NULO, não string vazia — nulo é o estado que a coluna documenta; string vazia seria um terceiro estado que nenhum filtro pega", () => {
    expect(
      atribuicoesAoPedido.some((a) => /\bnull\b/.test(a)),
      "nenhum caminho grava NULO explícito: " + JSON.stringify(atribuicoesAoPedido),
    ).toBe(true);
  });
});

// ─── O que este plano NÃO tinha o direito de mexer ─────────────────────────

describe("a chave de conflito do upsert continua sendo organização + pagamento — regra: é a idempotência que permite reprocessar janela sem duplicar", () => {
  it("o upsert de cash_inflows usa onConflict com organization_id,payment_id", () => {
    // 225-09: a partir desta fase a EF LÊ cash_inflows antes de escrever, então o
    // PRIMEIRO `from("cash_inflows")` do fonte é o SELECT de estado anterior, não o
    // upsert. Procurar o sítio pelo `.upsert(` que o segue — a versão anterior desta
    // asserção reprovava um `onConflict` intacto só porque um SELECT nasceu antes dele.
    const sitios = [...corpo.matchAll(/from\("cash_inflows"\)/g)].map((m) => m.index as number);
    expect(sitios.length, "nenhuma referência a cash_inflows no fonte").toBeGreaterThanOrEqual(1);

    const doUpsert = sitios.filter((i) => /^\s*\.\s*upsert\(/m.test(corpo.slice(i + 20, i + 80)));
    expect(
      doUpsert.length,
      "de " + sitios.length + " referência(s) a cash_inflows, " + doUpsert.length +
        " são upsert — sem sítio de escrita não há o que conferir",
    ).toBe(1);

    const trecho = corpo.slice(doUpsert[0], doUpsert[0] + 400);
    expect(
      /onConflict:\s*["']organization_id,payment_id["']/.test(trecho),
      "o onConflict mudou — reprocessar janela passa a duplicar linha de caixa",
    ).toBe(true);
  });
});

describe("a lista de status aceitos não mudou — regra: ela decide o que entra em cash_inflows, e 14 funções de caixa leem essa tabela", () => {
  it("VALID_STATUSES continua com os mesmos cinco elementos", () => {
    const m = /const\s+VALID_STATUSES\s*=\s*\[([^\]]*)\]/.exec(corpo);
    expect(m, "VALID_STATUSES não encontrado no fonte").not.toBeNull();

    const elementos = (m as RegExpExecArray)[1]
      .split(",")
      .map((s) => s.trim().replace(/^["'`]|["'`]$/g, ""))
      .filter((s) => s.length > 0);

    expect(elementos).toHaveLength(5);
    expect(elementos.sort()).toEqual(
      ["approved", "authorized", "in_mediation", "in_process", "refunded"].sort(),
    );
  });

  it("o filtro de venda do ML continua exigindo order.type === 'mercadolibre' — mudar isso muda a DRE de caixa, o saldo diário e a previsão de uma vez", () => {
    expect(/order\s*\?*\.\s*type[^\n]*!==\s*["']mercadolibre["']/.test(corpo)).toBe(true);
  });

  it("a guarda de money_release_date continua de pé — linha sem data de liberação não entra no caixa", () => {
    expect(/money_release_date/.test(corpo)).toBe(true);
    expect(/if\s*\(\s*!releaseDate\s*\)\s*continue/.test(corpo)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 225-09 — a ingestão pergunta QUEM RECEBEU antes de chamar um valor de receita
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1. A procedência chega ao upsert ──────────────────────────────────────

describe("1 — o objeto do upsert carrega a procedência — regra: classificar sem gravar a classificação é o mesmo que não classificar", () => {
  it.each([...COLUNAS_DE_PROCEDENCIA, "ml_shipment_id"])(
    "o objeto do upsert tem a propriedade `%s`",
    (coluna) => {
      expect(
        new RegExp("(^|[\\s,{])" + coluna + "\\s*:").test(objetoUpsert),
        "a coluna `" + coluna + "` não chega ao upsert — a classificação morre na memória da EF",
      ).toBe(true);
    },
  );
});

// ─── 2. A flag é derivada, nunca literal ───────────────────────────────────

describe("2 — a flag de caixa é derivada de comparação, não de constante — regra: um portão que aceite valor fixo aprovaria exatamente o defeito que ele existe para pegar", () => {
  it("`entra_no_caixa` no upsert não é `true` nem `false` literal", () => {
    const valor = valorDaChave(objetoUpsert, "entra_no_caixa");
    expect(valor, "propriedade entra_no_caixa não encontrada no objeto do upsert").not.toBeNull();
    expect(
      /^\s*(true|false)\s*,?\s*$/.test(valor as string),
      "a flag entrou como literal fixo — valor lido: " + valor,
    ).toBe(false);
  });

  it("existe comparação contra o identificador do vendedor da organização", () => {
    expect(
      /mlUserId\s*\)?\s*(===|==|!==|!=)/.test(laco) || /(===|==|!==|!=)\s*Number\(\s*mlUserId/.test(laco),
      "nada no laço compara o par lido com o vendedor da organização — a régua não sabe de quem é o dinheiro",
    ).toBe(true);
  });
});

// ─── 3. O par inteiro, não metade dele ─────────────────────────────────────

describe("3 — o fonte lê OS DOIS campos do par — regra: ler só o recebedor faria a régua depender de ausência, e o censo mostrou que ausência sozinha é insuficiente", () => {
  it("`collector_id` é lido do payload", () => {
    expect(/\bcollector_id\b/.test(corpo), "a EF continua sem perguntar quem recebeu").toBe(true);
  });

  it("`payer_id` é lido do payload", () => {
    expect(/\bpayer_id\b/.test(corpo), "falta a metade do par que decide: quem pagou").toBe(true);
  });

  it("o pagador vem da RAIZ do payload, não do objeto `payer` — que vem NULO nos dois casos e por isso não decide nada", () => {
    expect(
      /\bpayer\s*\?*\.\s*id\b/.test(corpo),
      "o fonte lê `payer.id` (o objeto), que o Mercado Pago devolve nulo tanto na venda quanto na compra — o campo que decide é `payer_id` na raiz",
    ).toBe(false);
  });
});

// ─── 4. Ausência não vira veredito ─────────────────────────────────────────

describe("4 — a ausência dos dois dispara consulta ao detalhe, num ramo condicional — regra: /v1/payments/search OMITE o recebedor quando o dono do token é o pagador; a busca dá o sinal, o detalhe dá a prova", () => {
  it("existe chamada ao endpoint de detalhe de pagamento, com o id concatenado", () => {
    expect(
      /["']\/v1\/payments\/["']\s*\+/.test(corpo),
      "não há consulta a /v1/payments/{id} — a ausência de campo estaria virando veredito direto",
    ).toBe(true);
  });

  it("a consulta ao detalhe está dentro de um ramo condicional, não no caminho reto", () => {
    const idx = corpo.search(/["']\/v1\/payments\/["']\s*\+/);
    expect(idx).toBeGreaterThan(-1);
    const antes = corpo.slice(Math.max(0, idx - 600), idx);
    expect(
      /\bif\s*\(/.test(antes),
      "a consulta de detalhe está no caminho reto — gastaria uma chamada por pagamento e estouraria o tempo da função",
    ).toBe(true);
  });
});

// ─── 5. Vocabulário fechado ────────────────────────────────────────────────

describe("5 — o motivo de exclusão vem de vocabulário fechado — regra: motivo montado em tempo de execução vira texto livre, e texto livre não se consulta", () => {
  it("o literal do motivo aparece UMA vez no fonte: declarado, e referenciado por nome daí em diante", () => {
    const ocorrencias = (corpo.match(/["']compra_do_titular["']/g) ?? []).length;
    expect(
      ocorrencias,
      "o literal do motivo aparece " + ocorrencias + " vezes — 1 significa constante, 0 significa ausente, 2+ significa vocabulário espalhado",
    ).toBe(1);
  });

  it("o motivo no upsert não é string montada (sem template, sem concatenação)", () => {
    const valor = valorDaChave(objetoUpsert, "motivo_fora_do_caixa");
    expect(valor, "propriedade motivo_fora_do_caixa não encontrada").not.toBeNull();
    expect(
      /[`+]|\$\{/.test(valor as string),
      "o motivo está sendo montado em tempo de execução — valor lido: " + valor,
    ).toBe(false);
  });
});

// ─── 6. O frete resolve o pedido real ──────────────────────────────────────

describe("6 — o ramo do frete resolve o pedido pelo endpoint de envio — regra: nesses pagamentos o `order.id` do payload É o id do ENVIO, e gravá-lo no campo de pedido é a chave que nunca casa", () => {
  it("existe chamada ao endpoint de envio, com o id concatenado", () => {
    expect(
      /["']\/shipments\/["']\s*\+/.test(corpo),
      "o frete continua sem resolver o pedido real — provado 103/103 pelo censo que /shipments/{id} responde",
    ).toBe(true);
  });

  it("o bloco onde a chamada de envio mora lê `order_id` da resposta — é dele que sai o pedido real", () => {
    const idx = corpo.search(/["']\/shipments\/["']\s*\+/);
    expect(idx).toBeGreaterThan(-1);
    const bloco = blocoQueContem(corpo, idx);
    expect(
      /\border_id\b/.test(bloco),
      "a resposta do envio não está sendo lida — a chamada existe e o resultado é descartado",
    ).toBe(true);
  });

  it("o `order.id` do payload é lido UMA única vez, antes de qualquer ramo — nenhum ramo o regrava no campo de pedido", () => {
    const ocorrencias = (corpo.match(/\border\s*\?*\.\s*id\b/g) ?? []).length;
    expect(
      ocorrencias,
      "o `order.id` do payload aparece " + ocorrencias + " vezes; com mais de uma, algum ramo pode estar regravando o identificador de ENVIO no campo de pedido",
    ).toBe(1);
  });
});

// ─── 7. A janela explícita ─────────────────────────────────────────────────

describe("7 — a requisição aceita janela explícita de início e fim — regra: a varredura ordena por data de liberação CRESCENTE, então parada por teto perde a cauda recente, que é onde estão maio e agosto (97,6% da contaminação)", () => {
  it("o corpo da requisição aceita uma data de início", () => {
    expect(
      /body\s*\.\s*\w*begin\w*/i.test(corpo) || /body\s*\.\s*\w*inicio\w*/i.test(corpo),
      "sem janela explícita não há como mirar maio e agosto, nem como o 225-11 reprocessar mês a mês",
    ).toBe(true);
  });

  it("o corpo da requisição aceita uma data de fim", () => {
    expect(
      /body\s*\.\s*\w*end_?date\w*/i.test(corpo) || /body\s*\.\s*\w*fim\w*/i.test(corpo),
      "janela com início e sem fim não é janela",
    ).toBe(true);
  });

  it("o caminho de dias-para-trás continua existindo para quando a janela vier ausente", () => {
    expect(
      /body\s*\.\s*days_back/.test(corpo),
      "o comportamento de hoje sumiu — o cron de 3 em 3 horas invoca sem janela e passaria a não processar nada",
    ).toBe(true);
  });
});

// ─── 8. O estado anterior, lido antes do laço ──────────────────────────────

describe("8 — existe leitura de estado anterior ANTES do laço, e o ramo de detalhe é condicionado a ela — regra: sem isso cada re-invocação gasta o teto nos mesmos primeiros pagamentos e o pendente nunca cai", () => {
  it("`cash_inflows` é LIDA, não só escrita", () => {
    const leituras = (corpo.match(/from\("cash_inflows"\)/g) ?? []).length;
    expect(
      leituras,
      "há " + leituras + " referência(s) a cash_inflows no fonte; com apenas uma, a função só escreve e nunca lê o que já apurou",
    ).toBeGreaterThanOrEqual(2);
  });

  it("a leitura acontece antes do laço de pagamentos", () => {
    const idxLeitura = corpo.search(/from\("cash_inflows"\)\s*\n?\s*\.\s*select/);
    const idxLaco = corpo.indexOf("for (const p of");
    expect(idxLeitura, "não achei um SELECT em cash_inflows").toBeGreaterThan(-1);
    expect(idxLaco).toBeGreaterThan(-1);
    expect(
      idxLeitura < idxLaco,
      "a leitura de estado vem depois do laço — chega tarde demais para poupar consulta de detalhe",
    ).toBe(true);
  });

  it("a leitura pagina com faixa explícita — o PostgREST trunca em 1.000 em silêncio e a tabela tem 9.891 linhas na Pé Vermeio", () => {
    const idxLeitura = corpo.search(/from\("cash_inflows"\)\s*\n?\s*\.\s*select/);
    expect(idxLeitura).toBeGreaterThan(-1);
    const trecho = corpo.slice(idxLeitura, idxLeitura + 900);
    expect(
      /\.range\(/.test(trecho),
      "leitura sem .range() — um truncamento aqui faria a função descobrir que tem trabalho a fazer para sempre",
    ).toBe(true);
  });

  it("o ramo de consulta de detalhe é condicionado ao estado lido", () => {
    const idx = laco.search(/["']\/v1\/payments\/["']\s*\+/);
    expect(idx, "a consulta de detalhe não está dentro do laço de pagamentos").toBeGreaterThan(-1);
    const antesNoLaco = laco.slice(0, idx);
    expect(
      /origem_conferida_em/.test(antesNoLaco),
      "nada entre o início do laço e a consulta de detalhe consulta o que já foi conferido — o teto seria gasto sempre nos mesmos pagamentos",
    ).toBe(true);
  });
});

// ─── 9. Já conferido reusa VERBATIM ────────────────────────────────────────

describe("9 — pagamento já conferido carrega a classificação de volta ao upsert, verbatim — regra: sem isso a segunda passada regrava compra pessoal como receita, com motivo nulo, DENTRO do que o CHECK aceita", () => {
  it.each([...COLUNAS_DE_PROCEDENCIA])(
    "`%s` é LIDA de um objeto no laço, e não só escrita — o payload do Mercado Pago não tem esse campo, então só pode vir do que já estava gravado",
    (coluna) => {
      expect(
        new RegExp("\\.\\s*" + coluna + "\\b").test(laco),
        "`" + coluna + "` nunca é lida de volta: a re-invocação vai recalcular (ou não calcular) e reverter a classificação em silêncio",
      ).toBe(true);
    },
  );

  it.each(["ml_order_id", "ml_shipment_id"])(
    "a chave `%s` já gravada também é lida de volta — falha de resolução tem de PRESERVAR, não nular",
    (chave) => {
      expect(
        new RegExp("\\.\\s*" + chave + "\\b").test(laco),
        "`" + chave + "` não é reusada: uma falha transitória de rede na segunda passada apagaria uma chave que já estava certa, e o que ficaria contado seria 'a resolução falhou', não 'a chave anterior foi perdida'",
      ).toBe(true);
    },
  );
});

// ─── 10. Lote homogêneo ────────────────────────────────────────────────────

describe("10 — todo objeto empurrado no lote carrega as chaves de procedência — regra: o PostgREST monta o insert pela UNIÃO das chaves e preenche o que falta com nulo/default, que é a reversão", () => {
  it("há pelo menos um sítio que empurra linha no lote — o denominador não pode ser zero", () => {
    expect(
      objetosUpsert.length,
      "nenhum `rows.push({` no fonte: um portão que passa com denominador zero não é aprovação",
    ).toBeGreaterThanOrEqual(1);
  });

  it("sítios que empurram linha == sítios que incluem a flag de caixa", () => {
    const comFlag = objetosUpsert.filter((o) => /(^|[\s,{])entra_no_caixa\s*:/.test(o)).length;
    expect(
      comFlag,
      "de " + objetosUpsert.length + " sítio(s) que empurram linha, só " + comFlag +
        " incluem a flag — o lote fica heterogêneo e o PostgREST reverte a classificação do que falta",
    ).toBe(objetosUpsert.length);
  });

  it("sítios que empurram linha == sítios que incluem TODAS as colunas de procedência", () => {
    for (const coluna of [...COLUNAS_DE_PROCEDENCIA, "ml_shipment_id", "ml_order_id"]) {
      const com = objetosUpsert.filter((o) =>
        new RegExp("(^|[\\s,{])" + coluna + "\\s*:").test(o),
      ).length;
      expect(
        com,
        "a coluna `" + coluna + "` está em " + com + " de " + objetosUpsert.length + " objetos do lote",
      ).toBe(objetosUpsert.length);
    }
  });
});

// ─── 11. Nenhum token vaza ─────────────────────────────────────────────────

describe("11 — nenhum caminho do código escreve token em log ou mensagem de erro", () => {
  it("nenhum console.* recebe token, Bearer ou access_token", () => {
    const vazamentos = (corpo.match(/console\.(log|warn|error)[^;]*(access_token|Bearer |\btoken\b)/g) ?? []);
    expect(vazamentos, "token indo para o log: " + JSON.stringify(vazamentos)).toHaveLength(0);
  });
});
