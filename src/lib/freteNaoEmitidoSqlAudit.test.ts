/**
 * freteNaoEmitidoSqlAudit.test.ts — o portão da migration 242-02.
 *
 * ── O DEFEITO QUE ELE TRAVA ─────────────────────────────────────────────────
 *
 * `frete_cobranca_nao_emitida` AFIRMA sobre o Mercado Livre: "ele ainda não
 * emitiu". Até 05/09/2026 essa afirmação era derivada da IDADE DA VENDA — um
 * relógio NOSSO — e não de ter perguntado.
 *
 * Medido contra a API ao vivo, amostra de 40 pedidos que o rótulo classificava
 * assim: **39 já tinham o frete no ML** e a nossa base não. R$ 1.577,43 só na
 * amostra. Errado em ~97% dos casos, com um texto que soava cuidadoso.
 *
 * 🔴 É o mesmo defeito que a fase 239 existe para matar — afirmar sem provar —
 * reintroduzido num rótulo de aparência inofensiva. Este portão existe para que
 * ele não volte: sem a tabela de captura no ramo, o rótulo volta a falar do ML
 * a partir do nosso calendário.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ = "supabase/migrations/20260905180000_frete_nao_emitido_exige_prova.sql";
const bruto = readFileSync(resolve(process.cwd(), ARQ), "utf8");

const sql = bruto
  .split("\n")
  .map((l) => {
    const i = l.indexOf("--");
    return i === -1 ? l : l.slice(0, i);
  })
  .join("\n");

describe("242-02 — afirmar sobre o ML exige ter perguntado", () => {
  it("🔴 o ramo que culpa o ML exige captura registrada", () => {
    // A janela entre o predicado e o rótulo tem de conter a prova.
    const trecho = sql.slice(
      Math.max(0, sql.indexOf("'frete_cobranca_nao_emitida'") - 500),
      sql.indexOf("'frete_cobranca_nao_emitida'"),
    );
    expect(trecho, "sem a tabela de captura, o rótulo volta a presumir pela idade")
      .toMatch(/cap\.ml_order_id is not null/);
  });

  it("🔴 e exige que a tentativa seja RECENTE — resposta velha não prova hoje", () => {
    const trecho = sql.slice(
      Math.max(0, sql.indexOf("'frete_cobranca_nao_emitida'") - 500),
      sql.indexOf("'frete_cobranca_nao_emitida'"),
    );
    expect(trecho).toMatch(/cap\.ultima_tentativa/);
  });

  it("o motivo que assume a lacuna como NOSSA existe", () => {
    expect(sql).toContain("'frete_captura_pendente'");
  });

  it("e vem DEPOIS do que culpa o ML — a ordem decide o rótulo", () => {
    const ml = sql.indexOf("'frete_cobranca_nao_emitida'");
    const nosso = sql.indexOf("'frete_captura_pendente'");
    expect(ml).toBeGreaterThan(-1);
    expect(nosso).toBeGreaterThan(ml);
  });

  it("o join da prova é 1:1 pela chave primária — não multiplica linha", () => {
    expect(sql).toMatch(/left join public\.ml_order_sale_fee_captura cap/);
    expect(sql).toMatch(/cap\.organization_id\s*=\s*p_org_id/);
    expect(sql).toMatch(/cap\.ml_order_id\s*=\s*c\.ml_order_id/);
  });

  it("🔴 LEFT join, nunca INNER — a ausência de tentativa é uma das respostas", () => {
    const antes = sql.slice(0, sql.indexOf("public.ml_order_sale_fee_captura cap"));
    expect(antes.trimEnd().endsWith("left join")).toBe(true);
  });

  it("sem DROP: a assinatura não muda e a ACL fica intacta", () => {
    expect(sql.toLowerCase()).not.toContain("drop function");
    expect(sql.toLowerCase()).toContain("create or replace function");
  });

  it("nenhum DELETE, nenhum SECURITY DEFINER", () => {
    expect(sql.toLowerCase()).not.toMatch(/\bdelete\s+from\b/);
    expect(sql.toLowerCase()).not.toContain("security definer");
  });
});
