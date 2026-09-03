import { describe, it, expect } from "vitest";
import { lerCsv, chaveDoMovimento } from "./csvSimples";

// ─────────────────────────────────────────────────────────────────────────────
// 225-04 — o leitor de CSV do relatório de liberações do Mercado Pago.
//
// POR QUE UM LEITOR PRÓPRIO: a auditoria de legitimidade da fase registra que
// nenhuma dependência nova entra. Um leitor de CSV correto cabe em poucas
// dezenas de linhas testadas — e o arquivo real do MP usa `;` como separador,
// que metade dos pacotes de prateleira assume ser `,`.
//
// O arquivo real medido na sonda: 15 colunas, separador `;`, 292 linhas.
// ─────────────────────────────────────────────────────────────────────────────

const CAB_MP =
  "DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;" +
  "MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;BUSINESS_UNIT;" +
  "SUB_UNIT;BALANCE_AMOUNT;PAYMENT_METHOD_TYPE;PURCHASE_ID";

describe("lerCsv — separador, aspas e campo vazio", () => {
  it("separa campo pelo delimitador configurado (o MP usa `;`, não `,`)", () => {
    const { cabecalho, linhas } = lerCsv("a;b;c\n1;2;3", { separador: ";" });
    expect(cabecalho).toEqual(["a", "b", "c"]);
    expect(linhas[0].campos).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("respeita aspas duplas — separador dentro do campo não separa", () => {
    const { linhas } = lerCsv('a;b\n"um;dois";tres', { separador: ";" });
    expect(linhas[0].valores).toEqual(["um;dois", "tres"]);
  });

  it("entende aspas escapadas dentro do campo (`\"\"` vira uma aspa)", () => {
    const { linhas } = lerCsv('a;b\n"ele disse ""oi""";fim', { separador: ";" });
    expect(linhas[0].valores).toEqual(['ele disse "oi"', "fim"]);
  });

  it("não quebra em campo vazio no FIM da linha — o CSV do MP termina em `;`", () => {
    // A linha real do MP termina com PURCHASE_ID vazio, ou seja, com `;` final.
    const { linhas } = lerCsv("a;b;c\n1;2;", { separador: ";" });
    expect(linhas[0].valores).toEqual(["1", "2", ""]);
    expect(linhas[0].divergente).toBe(false);
  });

  it("campo vazio no meio e no começo também contam como campo", () => {
    const { linhas } = lerCsv("a;b;c\n;2;", { separador: ";" });
    expect(linhas[0].valores).toEqual(["", "2", ""]);
  });

  it("a linha de saldo de abertura do MP (quase toda vazia) é lida inteira", () => {
    const corpo =
      CAB_MP +
      "\n2026-08-30T00:00:00.000-03:00;;;12671.00;0.00;12671.00;0.00;0.00;;;;;12671.00;;";
    const { linhas } = lerCsv(corpo, { separador: ";" });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].divergente).toBe(false);
    expect(linhas[0].campos.SOURCE_ID).toBe("");
    expect(linhas[0].campos.DESCRIPTION).toBe("");
    expect(linhas[0].campos.NET_CREDIT_AMOUNT).toBe("12671.00");
    expect(linhas[0].campos.PURCHASE_ID).toBe("");
  });
});

describe("lerCsv — cabeçalho, objetos por nome e coluna a mais", () => {
  it("a primeira linha é cabeçalho e as demais viram objetos por nome de coluna", () => {
    const { cabecalho, linhas } = lerCsv("x;y\n1;2\n3;4", { separador: ";" });
    expect(cabecalho).toEqual(["x", "y"]);
    expect(linhas).toHaveLength(2);
    expect(linhas[1].campos.y).toBe("4");
  });

  it("coluna A MAIS no arquivo não derruba a leitura — vai para `extras`", () => {
    // O MP pode acrescentar coluna sem avisar. Isso não pode quebrar a ingestão.
    const { linhas } = lerCsv("a;b\n1;2;COLUNA_NOVA", { separador: ";" });
    expect(linhas[0].campos).toEqual({ a: "1", b: "2" });
    expect(linhas[0].extras).toEqual(["COLUNA_NOVA"]);
    expect(linhas[0].divergente).toBe(true);
  });

  it("lê as 15 colunas do arquivo real do MP sem perder nenhuma", () => {
    const { cabecalho } = lerCsv(CAB_MP + "\n", { separador: ";" });
    expect(cabecalho).toHaveLength(15);
    expect(cabecalho[0]).toBe("DATE");
    expect(cabecalho[14]).toBe("PURCHASE_ID");
  });
});

describe("lerCsv — quebra de linha dentro de campo entre aspas", () => {
  it("não parte o registro quando há `\\n` dentro de aspas", () => {
    const { linhas } = lerCsv('a;b\n"linha1\nlinha2";fim', { separador: ";" });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].valores[0]).toBe("linha1\nlinha2");
    expect(linhas[0].valores[1]).toBe("fim");
  });

  it("trata CRLF como fim de registro, sem deixar `\\r` grudado no último campo", () => {
    const { linhas } = lerCsv("a;b\r\n1;2\r\n3;4", { separador: ";" });
    expect(linhas[0].valores).toEqual(["1", "2"]);
    expect(linhas[1].valores).toEqual(["3", "4"]);
  });

  it("CRLF dentro de aspas é preservado como está, sem virar fim de registro", () => {
    const { linhas } = lerCsv('a;b\n"x\r\ny";z', { separador: ";" });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].valores[0]).toBe("x\r\ny");
  });
});

describe("lerCsv — linha divergente é MARCADA, nunca descartada em silêncio", () => {
  it("linha com campos A MENOS que o cabeçalho é devolvida e marcada", () => {
    const { linhas } = lerCsv("a;b;c\n1;2", { separador: ";" });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].divergente).toBe(true);
    expect(linhas[0].valores).toEqual(["1", "2"]);
    // as colunas que faltaram existem no objeto, como ausência explícita
    expect(linhas[0].campos.c).toBe("");
  });

  it("linha com campos A MAIS é devolvida e marcada", () => {
    const { linhas } = lerCsv("a;b\n1;2;3;4", { separador: ";" });
    expect(linhas[0].divergente).toBe(true);
    expect(linhas[0].extras).toEqual(["3", "4"]);
  });

  it("nenhuma linha some: total lido = total de registros do texto", () => {
    const { linhas } = lerCsv("a;b\n1;2\n9\n3;4;5\n6;7", { separador: ";" });
    expect(linhas).toHaveLength(4);
    expect(linhas.filter((l) => l.divergente)).toHaveLength(2);
  });

  it("cada linha carrega o número dela no arquivo, para o erro ser localizável", () => {
    const { linhas } = lerCsv("a;b\n1;2\n3;4", { separador: ";" });
    expect(linhas[0].numeroDaLinha).toBe(2);
    expect(linhas[1].numeroDaLinha).toBe(3);
  });

  it("quebra de linha final não fabrica um registro vazio", () => {
    const { linhas } = lerCsv("a;b\n1;2\n", { separador: ";" });
    expect(linhas).toHaveLength(1);
  });

  it("linha em branco NO MEIO do arquivo é mantida e marcada, não sumida", () => {
    const { linhas } = lerCsv("a;b\n1;2\n\n3;4", { separador: ";" });
    expect(linhas).toHaveLength(3);
    expect(linhas[1].divergente).toBe(true);
  });

  it("texto vazio devolve cabeçalho vazio e nenhuma linha, sem lançar", () => {
    expect(lerCsv("", { separador: ";" })).toEqual({ cabecalho: [], linhas: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A chave de idempotência.
//
// 🔴 MEDIDO NA SONDA: nenhuma coluna sozinha serve. `SOURCE_ID` repete (161
// distintos para 291 linhas), porque o mesmo pagamento aparece como
// `reserve_for_payment`, `payment`, `reserve_for_dispute` e `mediation`.
// A tripla (DATE, SOURCE_ID, DESCRIPTION) ainda deixa 30 grupos duplicados —
// o par reserva/contrapartida tem o MESMO instante, id e descrição, diferindo
// SÓ nas colunas de crédito e débito. A 6-tupla dá 0 duplicados.
// ─────────────────────────────────────────────────────────────────────────────

describe("chaveDoMovimento — a 6-tupla, porque nenhuma coluna sozinha serve", () => {
  const base = {
    DATE: "2026-08-30T07:26:57.000-03:00",
    SOURCE_ID: "175389161449",
    DESCRIPTION: "reserve_for_payment",
    GROSS_AMOUNT: "-1108.14",
    NET_CREDIT_AMOUNT: "0.00",
    NET_DEBIT_AMOUNT: "1108.14",
  };

  it("é determinística — a mesma linha dá sempre a mesma chave", async () => {
    expect(await chaveDoMovimento(base)).toBe(await chaveDoMovimento({ ...base }));
  });

  it("🔴 separa o par reserva/contrapartida, que difere SÓ em crédito e débito", async () => {
    // As duas linhas reais 284 e 285 do arquivo: mesmo instante, mesmo SOURCE_ID,
    // mesma DESCRIPTION. Se a chave fosse a tripla, uma engoliria a outra.
    const debito = base;
    const credito = {
      ...base,
      GROSS_AMOUNT: "1108.14",
      NET_CREDIT_AMOUNT: "1108.14",
      NET_DEBIT_AMOUNT: "0.00",
    };
    expect(await chaveDoMovimento(debito)).not.toBe(await chaveDoMovimento(credito));
  });

  it("muda quando QUALQUER uma das seis colunas muda", async () => {
    const seis = [
      "DATE",
      "SOURCE_ID",
      "DESCRIPTION",
      "GROSS_AMOUNT",
      "NET_CREDIT_AMOUNT",
      "NET_DEBIT_AMOUNT",
    ] as const;
    for (const coluna of seis) {
      expect(await chaveDoMovimento({ ...base, [coluna]: "OUTRO" })).not.toBe(await chaveDoMovimento(base));
    }
  });

  it("NÃO depende de coluna volátil — BALANCE_AMOUNT depende da ordem do arquivo", async () => {
    // BALANCE_AMOUNT é saldo corrido: muda se a janela pedida mudar. Entrar na
    // chave faria a MESMA linha gerar chave diferente em janelas diferentes,
    // e reprocessar duplicaria tudo.
    const outro = { ...base, BALANCE_AMOUNT: "99999.99", PAYMENT_METHOD: "pix" };
    expect(await chaveDoMovimento(outro)).toBe(await chaveDoMovimento(base));
  });

  it("a ocorrência desempata linhas idênticas nas seis colunas, sem colapsar nenhuma", async () => {
    // Medido: 0 grupos duplicados nas 291 linhas do arquivo real. Mas "0 hoje"
    // não é "0 sempre" — se duas linhas vierem idênticas, elas são DUAS, e a
    // ingestão não pode transformá-las em uma.
    expect(await chaveDoMovimento(base, 2)).not.toBe(await chaveDoMovimento(base, 1));
    expect(await chaveDoMovimento(base, 1)).toBe(await chaveDoMovimento(base));
  });

  it("normaliza espaço em volta do valor — o MP manda `\" \"` em coluna vazia", async () => {
    expect(await chaveDoMovimento({ ...base, SOURCE_ID: " 175389161449 " })).toBe(await chaveDoMovimento(base));
  });

  it("é estável no tamanho, seja qual for o tamanho do campo", async () => {
    const chave = await chaveDoMovimento({ ...base, DESCRIPTION: "x".repeat(5000) });
    expect(chave).toHaveLength(64);
    expect(chave).toMatch(/^[0-9a-f]{64}$/);
  });
});
