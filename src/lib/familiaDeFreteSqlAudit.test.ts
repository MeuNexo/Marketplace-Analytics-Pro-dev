/**
 * familiaDeFreteSqlAudit.test.ts — auditoria estática da migration 241-01.
 *
 * ── O DEFEITO QUE ELE TRAVA ─────────────────────────────────────────────────
 *
 * Achado pelo Wesley em 05/09/2026, comparando a tela com o app do ML no
 * pedido `2000017810721990`. O extrato mostra "Envios −R$ 68,65"; a linha
 * existe na nossa base como `CHARGE/CFFI` (R$ 68,65); o próprio card já exibia
 * `esperado_nosso = R$ 68,65` — e mesmo assim ele dizia **"Não há linha de
 * cobrança de frete para este pedido"**.
 *
 * A causa: a RPC filtrava `('CFFE','CXDE','CXDED')`. `CFFI` — "Tarifa por
 * envio interno ao município", nome dado pelo PRÓPRIO ML no campo
 * `transaction_detail` — estava fora.
 *
 * 🔴 E o netting só conhecia `BFFE`. `BXDE` e `BXDED` cancelam `CXDE` e
 * `CXDED`: sem eles, frete de devolução integralmente estornado seguia
 * contando como cobrança.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ = "supabase/migrations/20260905170000_familia_de_frete_completa.sql";
const bruto = readFileSync(resolve(process.cwd(), ARQ), "utf8");

/** Sem comentários: a frase que EXPLICA a sigla não é a sigla no filtro. */
const sql = bruto
  .split("\n")
  .map((l) => {
    const i = l.indexOf("--");
    return i === -1 ? l : l.slice(0, i);
  })
  .join("\n");

/** As quatro cobranças de frete, pelo nome que o ML dá em `transaction_detail`. */
const COBRANCAS_DE_FRETE = ["CFFE", "CFFI", "CXDE", "CXDED"];
/** Os cancelamentos correspondentes. */
const BONUS_DE_FRETE = ["BFFE", "BXDE", "BXDED"];
/** Parcelamento — começa com `CF`/`CV` e NÃO é frete. A armadilha do prefixo. */
const NAO_SAO_FRETE = ["CFONPN", "CVVFN", "CVVML", "CVVPRC"];

describe("241-01 — a família de frete completa na régua", () => {
  it("🔴 `CFFI` entrou — é o subtipo do caso que abriu a fase", () => {
    expect(sql).toContain("'CFFI'");
  });

  it("as quatro cobranças aparecem nas DUAS listas (netting e contagem)", () => {
    // `n_frete` conta só cobrança; `cobrado` soma cobrança e bônus.
    const listas = sql.match(/in \(([^)]*)\)/g) ?? [];
    const deFrete = listas.filter((l) => l.includes("CFFE"));
    expect(deFrete.length, "esperava a lista do netting e a de n_frete").toBe(2);
    for (const sub of COBRANCAS_DE_FRETE) {
      for (const lista of deFrete) {
        expect(lista, `${sub} fora de ${lista}`).toContain(`'${sub}'`);
      }
    }
  });

  it("🔴 os três bônus estão no netting — inclusive os dois que faltavam", () => {
    const netting = (sql.match(/in \(([^)]*)\)/g) ?? []).find((l) => l.includes("BFFE"));
    expect(netting).toBeDefined();
    for (const b of BONUS_DE_FRETE) {
      expect(netting!, `${b} fora do netting`).toContain(`'${b}'`);
    }
  });

  it("🔴 a contagem de frete NÃO inclui bônus — senão estorno vira cobrança", () => {
    const listas = sql.match(/in \(([^)]*)\)/g) ?? [];
    const contagem = listas.find((l) => l.includes("CFFE") && !l.includes("BFFE"));
    expect(contagem, "n_frete deve contar só CHARGE").toBeDefined();
    for (const b of BONUS_DE_FRETE) expect(contagem!).not.toContain(`'${b}'`);
  });

  it("parcelamento e comissão NÃO entram — o prefixo não decide", () => {
    const deFrete = (sql.match(/in \(([^)]*)\)/g) ?? []).filter((l) => l.includes("CFFE"));
    for (const sub of NAO_SAO_FRETE) {
      for (const lista of deFrete) {
        expect(lista, `${sub} não é frete e está em ${lista}`).not.toContain(`'${sub}'`);
      }
    }
  });

  it("🔴 sem `DROP FUNCTION` — a assinatura não muda e a ACL fica intacta", () => {
    // Foi o DROP da 239-05 que renasceu três funções com EXECUTE para
    // PUBLIC e `anon`. Aqui não há motivo para correr esse risco.
    expect(sql.toLowerCase()).not.toContain("drop function");
    expect(sql.toLowerCase()).toContain("create or replace function");
  });

  it("nenhum DELETE entra pela migration", () => {
    expect(sql.toLowerCase()).not.toMatch(/\bdelete\s+from\b/);
  });

  it("nenhuma função vira SECURITY DEFINER pelo caminho", () => {
    expect(sql.toLowerCase()).not.toContain("security definer");
  });
});
