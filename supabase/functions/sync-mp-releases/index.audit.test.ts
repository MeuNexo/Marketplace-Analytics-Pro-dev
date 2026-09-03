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

const fonte = ler(ARQ_FONTE);
const corpo = semComentarios(fonte);
const objetoUpsert = objetoDoUpsert(corpo);

// ─── A chave de conciliação chega ao upsert ────────────────────────────────

describe("o objeto empurrado em `rows` carrega a chave de conciliação — regra: sem ml_order_id é impossível dizer se uma venda foi repassada", () => {
  it("o objeto do upsert tem uma propriedade `ml_order_id`", () => {
    expect(
      /(^|[\s,{])ml_order_id\s*:/.test(objetoUpsert),
      "a chave de conciliação foi descartada de novo no rows.push — é a quarta recaída do mesmo defeito (225-01)",
    ).toBe(true);
  });

  it("`ml_order_id` é alimentado por `order` do payload do Mercado Pago, não por constante nem por payment_id", () => {
    const m = /(^|[\s,{])ml_order_id\s*:\s*([^\n]*)/.exec(objetoUpsert);
    expect(m, "propriedade ml_order_id não encontrada").not.toBeNull();
    const valor = (m as RegExpExecArray)[2];

    // Vem de `order` do payload (p?.order?.id, p.order.id, order?.id, …)
    expect(
      /\border\b\s*[?.]*\s*\.?\s*id/.test(valor) || /\border\b[^,]*\bid\b/.test(valor),
      "ml_order_id precisa vir de `order.id` do payload — valor lido: " + valor,
    ).toBe(true);

    // Nunca o payment_id: são identificadores de coisas diferentes, e 7,7% dos
    // pedidos têm mais de um pagamento. Confundi-los apagaria o split payment.
    expect(/payment_id|\bp\.id\b/.test(valor)).toBe(false);

    // Nunca um literal fixo.
    expect(/^\s*["'`]/.test(valor)).toBe(false);
  });

  it("vazio vira NULO, não string vazia — nulo é o estado que a coluna documenta; string vazia seria um terceiro estado que nenhum filtro pega", () => {
    const m = /(^|[\s,{])ml_order_id\s*:\s*([^\n]*)/.exec(objetoUpsert);
    expect(m).not.toBeNull();
    expect(/\bnull\b/.test((m as RegExpExecArray)[2])).toBe(true);
  });
});

// ─── O que este plano NÃO tinha o direito de mexer ─────────────────────────

describe("a chave de conflito do upsert continua sendo organização + pagamento — regra: é a idempotência que permite reprocessar janela sem duplicar", () => {
  it("o upsert de cash_inflows usa onConflict com organization_id,payment_id", () => {
    const idx = corpo.indexOf('from("cash_inflows")');
    expect(idx, 'upsert em cash_inflows não encontrado').toBeGreaterThan(-1);
    const trecho = corpo.slice(idx, idx + 400);
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
