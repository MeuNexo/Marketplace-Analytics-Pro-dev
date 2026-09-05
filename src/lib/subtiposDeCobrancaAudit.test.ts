/**
 * subtiposDeCobrancaAudit.test.ts — o portão que teria pego o `CFFI` sozinho.
 *
 * ── A CAUSA RAIZ QUE ELE FECHA (241-02) ─────────────────────────────────────
 *
 * `CFFI` não passou por descuido: passou porque os subtipos do ML eram
 * literais repetidos em três lugares que não se falam, com listas diferentes.
 * A RPC do frete filtrava CFFE/CXDE/CXDED; `SUBTIPOS_COMISSAO` lista outras
 * quatro siglas; a soma do `declarado` não filtra nada. Nada obrigava as três
 * a concordarem.
 *
 * 🔴 O teste que importa é o último: **toda sigla que o ML EMITE HOJE tem
 * família declarada.** É ele que teria reprovado no dia em que `CFFI` apareceu
 * na base pela primeira vez, em vez de esperar o Wesley abrir o app do ML.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SUBTIPOS,
  familiaDe,
  siglasDa,
  FRETE_COBRANCA,
  FRETE_BONUS,
  SIGLAS_QUE_COMPOEM_SALE_FEE,
  COMPOEM_SALE_FEE_CHARGE,
} from "../../supabase/functions/_shared/subtiposDeCobranca.ts";
import { SUBTIPOS_COMISSAO } from "../../supabase/functions/_shared/mlOrderSaleFeeContrato.ts";

/**
 * Os subtipos PRESENTES na base da Pé Vermeio, medidos em 05/09/2026 com
 * `select distinct detail_sub_type from ml_order_sale_fee`. A data está aqui
 * de propósito: quando o ML emitir uma sigla nova, este teste falha e alguém
 * lê o nome dela em `transaction_detail` antes de decidir a família.
 */
const SIGLAS_MEDIDAS_NO_BANCO = [
  "BFFE",
  "BFONPN",
  "BVVFNU",
  "BVVML",
  "BVVPRC",
  "BXDE",
  "BXDED",
  "CFFE",
  "CFFI",
  "CFONPN",
  "CV",
  "CVAF",
  "CVML",
  "CVMP",
  "CVVFN",
  "CVVFNU",
  "CVVML",
  "CVVPRC",
  "CXDE",
  "CXDED"
];

const MIG_FRETE = "supabase/migrations/20260905170000_familia_de_frete_completa.sql";
const sqlFrete = readFileSync(resolve(process.cwd(), MIG_FRETE), "utf8")
  .split("\n")
  .map((l) => {
    const i = l.indexOf("--");
    return i === -1 ? l : l.slice(0, i);
  })
  .join("\n");

describe("241-02 — o dicionário é fonte única, e o desconhecido não passa calado", () => {
  it("🔴 toda sigla que o ML emite HOJE tem família declarada", () => {
    const semFamilia = SIGLAS_MEDIDAS_NO_BANCO.filter((s) => familiaDe(s) === "desconhecida");
    expect(
      semFamilia,
      "leia o `transaction_detail` do ML antes de classificar — nunca deduza pela sigla",
    ).toEqual([]);
    // O contador, não só o veredito: gate verde com zero item não é aprovação.
    expect(SIGLAS_MEDIDAS_NO_BANCO.length).toBe(20);
  });

  it("sigla que ninguém declarou responde `desconhecida`, nunca uma família por engano", () => {
    for (const inventada of ["CZZZ", "BZZZ", "", "   ", "cffe_errado"]) {
      expect(familiaDe(inventada), inventada).toBe("desconhecida");
    }
  });

  it("a sigla é normalizada, mas não adivinhada", () => {
    expect(familiaDe(" cffi ")).toBe("frete");
    expect(familiaDe(null)).toBe("desconhecida");
  });

  it("🔴 o prefixo NÃO decide a família — `CFONPN` começa com CF e é parcelamento", () => {
    expect(familiaDe("CFONPN")).toBe("parcelamento");
    expect(familiaDe("CVVFN")).toBe("parcelamento");
    expect(familiaDe("CFFI")).toBe("frete");
  });

  it("nenhuma sigla aparece em duas famílias", () => {
    const todas = Object.keys(SUBTIPOS);
    expect(new Set(todas).size).toBe(todas.length);
  });

  it("todo BONUS declarado cancela alguma coisa, e fica na família do que cancela", () => {
    for (const [sigla, v] of Object.entries(SUBTIPOS)) {
      if (v.natureza !== "BONUS") continue;
      expect(v.nomeDoML.toLowerCase(), sigla).toContain("cancelamento");
      expect(sigla.startsWith("B"), sigla).toBe(true);
    }
  });

  it("todo nome tem procedência do ML — nenhum vazio, nenhum inventado curto", () => {
    for (const [sigla, v] of Object.entries(SUBTIPOS)) {
      expect(v.nomeDoML.trim().length, sigla).toBeGreaterThan(10);
    }
  });

  it("🔴 a RPC do frete e o dicionário concordam, sigla por sigla", () => {
    const listas = sqlFrete.match(/in \(([^)]*)\)/g) ?? [];
    const deFrete = listas.filter((l) => l.includes("CFFE"));
    expect(deFrete.length).toBe(2);
    const noSql = new Set<string>();
    for (const l of deFrete) for (const m of l.matchAll(/'([A-Z]+)'/g)) noSql.add(m[1]);

    // Tudo que o SQL filtra é frete no dicionário...
    for (const s of noSql) {
      expect(familiaDe(s), `o SQL filtra ${s}, que o dicionário não chama de frete`).toBe("frete");
    }
    // ...e tudo que o dicionário chama de frete está no SQL.
    for (const s of [...FRETE_COBRANCA, ...FRETE_BONUS]) {
      expect(noSql.has(s), `o dicionário tem ${s} como frete e o SQL não filtra`).toBe(true);
    }
  });

  it("as quatro cobranças e os três bônus de frete estão declarados", () => {
    expect(FRETE_COBRANCA).toEqual(["CFFE", "CFFI", "CXDE", "CXDED"]);
    expect(FRETE_BONUS).toEqual(["BFFE", "BXDE", "BXDED"]);
  });

  // ── 🔴 244-01: A LISTA É COMPOSIÇÃO, E O PORTÃO É POR MUTAÇÃO ────────────
  //
  // A 241 deixou a lista intocada e registrou a dúvida. A 244 mediu e decidiu
  // com dinheiro. Os três testes abaixo são o que impede a decisão de ser
  // desfeita por alguém "completando a lista" pelo nome das siglas.

  it("🔴 D-244-01: `SUBTIPOS_COMISSAO` é DERIVADA do dicionário, nunca escrita à mão", () => {
    expect([...SUBTIPOS_COMISSAO].sort()).toEqual(COMPOEM_SALE_FEE_CHARGE);
    // O contador, não só o veredito.
    expect(COMPOEM_SALE_FEE_CHARGE.length).toBe(7);
  });

  it("🔴 D-244-01: as sete parcelas de cobrança do `sale_fee`, medidas em 8.136 pedidos", () => {
    expect(COMPOEM_SALE_FEE_CHARGE).toEqual([
      "CV", "CVML", "CVMP", "CVVFN", "CVVFNU", "CVVML", "CVVPRC",
    ]);
  });

  it("🔴 D-244-02: `CVAF` NÃO compõe o `sale_fee` — 29 de 29 fecham SEM ela", () => {
    // Teste negativo, no molde do que a 241 escreveu para `CFFI`. Incluí-la
    // inflaria a comissão em R$ 277,06 e quebraria 29 identidades que fecham.
    expect(SUBTIPOS.CVAF.compoeSaleFee).toBe(false);
    expect(SUBTIPOS_COMISSAO).not.toContain("CVAF");
    // E ela continua sendo comissão de FAMÍLIA: o que muda é onde o dinheiro
    // mora, não o que a cobrança é.
    expect(familiaDe("CVAF")).toBe("comissao");
  });

  it("🔴 `CFONPN` não compõe e `CVVFN` compõe — por isso o campo é separado da família", () => {
    // As duas são "taxa de parcelamento" para o ML. Só uma está dentro da
    // tarifa do pedido. Provado em 21/08 no `2000014566978158`:
    // 41,18 + CVVFN 27,08 = 68,26 = `sale_fee.net`.
    expect(SUBTIPOS.CFONPN.compoeSaleFee).toBe(false);
    expect(SUBTIPOS.CVVFN.compoeSaleFee).toBe(true);
    expect(familiaDe("CFONPN")).toBe("parcelamento");
    expect(familiaDe("CVVFN")).toBe("parcelamento");
  });

  it("nenhuma sigla de FRETE compõe o `sale_fee` — a régua do frete é outra conta", () => {
    for (const s of [...FRETE_COBRANCA, ...FRETE_BONUS]) {
      expect(SUBTIPOS[s].compoeSaleFee, s).toBe(false);
    }
  });

  it("toda sigla declarada responde `compoeSaleFee` — nenhuma indefinida", () => {
    for (const [sigla, v] of Object.entries(SUBTIPOS)) {
      expect(typeof v.compoeSaleFee, sigla).toBe("boolean");
    }
    expect(SIGLAS_QUE_COMPOEM_SALE_FEE.length).toBe(10);
  });
});
