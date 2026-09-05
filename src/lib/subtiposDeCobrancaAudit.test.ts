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

  it("🔴 D-241-04: `SUBTIPOS_COMISSAO` fica INTOCADA nesta fase", () => {
    // Mexer nela altera rebate e MCO — decisão do Wesley, com a calibração na
    // frente. O teste crava o conteúdo para que ninguém a mude de raspão.
    expect([...SUBTIPOS_COMISSAO]).toEqual(["CVVML", "CVVPRC", "CVVFNU", "CVVFN"]);
  });

  it("e registra, sem corrigir, o que ela deixa de fora", () => {
    // Medido: CVML (3 pedidos), CV (2), CVAF (29) — 34 pedidos, R$ 490,52.
    // Ver `241-ACHADO-COMISSAO-INCOMPLETA.md`.
    const comissaoNoDicionario = siglasDa("comissao", "CHARGE");
    const foraDaLista = comissaoNoDicionario.filter(
      (s) => !(SUBTIPOS_COMISSAO as readonly string[]).includes(s),
    );
    expect(foraDaLista.sort()).toEqual(["CV", "CVAF", "CVML"]);
  });

  it("⚠️ e que três dos quatro nomes da lista não são comissão pelo dicionário do ML", () => {
    // `CVVPRC` é pagamento, `CVVFNU` é recebimento, `CVVFN` é parcelamento.
    // Pode estar certo (se `sale_fee.net` também os contém) ou errado — NÃO
    // foi medido, e por isso nada mudou. O teste existe para que a pergunta
    // não se perca.
    const naoSaoComissao = (SUBTIPOS_COMISSAO as readonly string[]).filter(
      (s) => familiaDe(s) !== "comissao",
    );
    expect(naoSaoComissao.sort()).toEqual(["CVVFN", "CVVFNU", "CVVPRC"]);
  });
});
