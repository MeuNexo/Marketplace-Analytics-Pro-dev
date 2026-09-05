/**
 * freteGratisSqlAudit.test.ts — o portão da migration 243-01.
 *
 * ── O DEFEITO, E O DEFEITO OPOSTO ───────────────────────────────────────────
 *
 * `frete_sem_cobranca_registrada` dizia "pode ser frete grátis OU lacuna da
 * nossa captura — não presumimos zero", e mandava a linha para a aba
 * **"Nosso erro"**. Era a régua certa enquanto não tínhamos perguntado.
 *
 * Medido em 05/09/2026 nos 2 casos da janela, com as três fontes:
 *   custo publicado do envio  → R$ 0,00
 *   captura de cobrança       → `ok`, tentada hoje
 *   o ML consultado ao vivo   → só CVVML e CVVPRC, zero linhas de frete
 *
 * A conta fecha em 0,00/0,00/0,00, e a tela pedia correção de quem não tem o
 * que corrigir. É o defeito das fases 239-242 na direção contrária: **ter a
 * prova e não usar**.
 *
 * 🔴 E o portão existe para impedir o exagero na volta: são TRÊS provas, nunca
 * duas. "Esperado zero" sozinho é presunção — foi assim que a 242 errou 39 de
 * 40 ao afirmar que o ML não tinha emitido.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ = "supabase/migrations/20260905190000_frete_gratis_confirmado.sql";
const sql = readFileSync(resolve(process.cwd(), ARQ), "utf8")
  .split("\n")
  .map((l) => {
    const i = l.indexOf("--");
    return i === -1 ? l : l.slice(0, i);
  })
  .join("\n");

const ramo = () => {
  const fim = sql.indexOf("'frete_gratis_confirmado'");
  return sql.slice(Math.max(0, fim - 400), fim);
};

describe("243-01 — frete grátis exige as TRÊS provas", () => {
  it("o motivo existe", () => {
    expect(sql).toContain("'frete_gratis_confirmado'");
  });

  it("🔴 prova 1 — o custo publicado do envio é zero", () => {
    expect(ramo()).toMatch(/list_cost\s*=\s*0/);
  });

  it("🔴 prova 2 — existe captura registrada para o pedido", () => {
    expect(ramo()).toMatch(/cap\.ml_order_id is not null/);
  });

  it("🔴 prova 3 — e ela é RECENTE: resposta velha não prova hoje", () => {
    expect(ramo()).toMatch(/cap\.ultima_tentativa/);
  });

  it("não há linha de frete — a quarta condição, que já existia", () => {
    expect(ramo()).toMatch(/n_frete\s*=\s*0/);
  });

  it("🔴 vem ANTES da dúvida honesta — a ordem decide o rótulo", () => {
    const confirmado = sql.indexOf("'frete_gratis_confirmado'");
    const duvida = sql.indexOf("'frete_sem_cobranca_registrada'");
    expect(confirmado).toBeGreaterThan(-1);
    expect(duvida).toBeGreaterThan(confirmado);
  });

  it("🔴 a dúvida honesta SOBREVIVE — sem as três provas, continua em aberto", () => {
    // Se este motivo sumisse, a régua teria trocado um exagero por outro.
    expect(sql).toContain("'frete_sem_cobranca_registrada'");
  });

  it("a conta fechada aparece FECHADA: zero medido, não nulo", () => {
    // O `recebido` e a `diferenca` saem 0, nunca nulo — nulo jogaria a linha no
    // balde "não apurado" da tela, que é para dúvida, e esta conta fecha.
    for (const coluna of ["recebido", "diferenca"]) {
      const alvo = sql.indexOf(`as ${coluna},`);
      expect(alvo, `coluna ${coluna} não encontrada`).toBeGreaterThan(-1);
      const trecho = sql.slice(Math.max(0, alvo - 400), alvo);
      expect(trecho, `${coluna} não emite zero no frete grátis confirmado`)
        .toMatch(/frete_gratis_confirmado'\s*then\s*0::numeric/);
    }
  });

  it("e NÃO entra na fila que promete correção", () => {
    const filas = sql.slice(sql.indexOf("then 'nosso'") - 600, sql.indexOf("then 'nosso'"));
    expect(filas).not.toContain("frete_gratis_confirmado");
  });

  it("sem DROP, sem DELETE, sem SECURITY DEFINER", () => {
    expect(sql.toLowerCase()).not.toContain("drop function");
    expect(sql.toLowerCase()).not.toMatch(/\bdelete\s+from\b/);
    expect(sql.toLowerCase()).not.toContain("security definer");
  });
});
