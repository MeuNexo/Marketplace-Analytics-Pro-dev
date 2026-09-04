/**
 * pontaDoCompradorSqlAudit.test.ts — auditoria estática da migration 239-05.
 *
 * POR QUE ELE LÊ O `.sql` DO DISCO: aplicar migration é portão do orquestrador;
 * o executor não alcança `ckcdevcxgvueywivefgx`. Sem esta auditoria, três erros
 * saem PLAUSÍVEIS — nenhum teste quebra e nenhuma tela pisca:
 *
 *  1. coalescer a ausência de captura para zero, que faria a régua ACUSAR por
 *     não ter perguntado (a lição do par recebedor × pagador, 225-09);
 *  2. atribuir a ponta inteira a cada pedido de um envio com dois pedidos,
 *     contando o mesmo dinheiro duas vezes (5 dos 1.209 envios medidos);
 *  3. o DROP renascer a função com EXECUTE para PUBLIC/`anon` — o DROP apaga a
 *     ACL e o default do Postgres é mais FROUXO que a ACL anterior.
 *
 * Molde: `src/lib/conciliacaoSqlAudit.test.ts` (225-02).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ = "supabase/migrations/20260905140000_ponta_do_comprador.sql";
const bruto = readFileSync(resolve(process.cwd(), ARQ), "utf8");

/** Remove comentários `--` antes de contar: uma frase de cabeçalho que EXPLICA
 *  o que é proibido não pode ser contada como se FOSSE a coisa proibida. */
const sql = bruto
  .split("\n")
  .map((l) => {
    const i = l.indexOf("--");
    return i === -1 ? l : l.slice(0, i);
  })
  .join("\n");

describe("239-05 — a ponta do comprador entra na base", () => {
  it("as três funções do union são recriadas juntas", () => {
    for (const f of [
      "conciliacao_base_linhas",
      "conciliacao_frete_linhas",
      "get_casos_conciliacao",
    ]) {
      expect(sql, `função não recriada: ${f}`).toMatch(
        new RegExp(`create or replace function public\\.${f}\\(`, "i"),
      );
      expect(sql, `função não derrubada antes: ${f}`).toMatch(
        new RegExp(`drop function if exists public\\.${f}\\(`, "i"),
      );
    }
  });

  it("as três emitem a coluna nova — senão o union all quebra", () => {
    const assinaturas = sql.match(/valor_estimado boolean, ponta_comprador numeric\)/gi) ?? [];
    expect(assinaturas.length).toBe(3);
  });

  it("🔴 a ponta é NULA sem captura — nunca zero por omissão", () => {
    // A guarda tem de exigir a captura ANTES de qualquer coalesce. Um
    // `coalesce(e.custo_comprador, 0)` solto, fora do `case`, aceitaria a
    // ausência como zero e a régua voltaria a acusar sem ter perguntado.
    expect(sql).toMatch(/case\s+when\s+e\.tem_captura\s+and\s+e\.n_pedidos_no_envio\s*=\s*1/i);
  });

  it("🔴 envio com mais de um pedido não recebe ponta atribuída", () => {
    expect(sql).toMatch(/n_pedidos_no_envio\s*=\s*1/);
    expect(sql).toMatch(/count\(\*\)\s+over\s+\(partition by sp\.shipment_id\)/i);
  });

  it("🔴 o motivo novo vem ANTES do que acusa a nossa base", () => {
    const novo = sql.indexOf("'base_sem_ponta_do_comprador'");
    const acusa = sql.indexOf("'divergencia_da_nossa_base'");
    expect(novo).toBeGreaterThan(-1);
    expect(acusa).toBeGreaterThan(-1);
    expect(novo, "a acusação viria primeiro e engoliria a lacuna").toBeLessThan(acusa);
  });

  it("o motivo novo não é acionável — a lacuna é nossa, não dinheiro deles", () => {
    // `acionavel_calc` é a única régua de acionabilidade; o motivo novo não
    // pode aparecer nela.
    const m = sql.match(/acionavel_calc[\s\S]{0,240}/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toContain("base_sem_ponta_do_comprador");
  });

  it("🔴 o DROP afrouxa a ACL, e a migration reverte os dois lados", () => {
    for (const f of [
      "conciliacao_base_linhas",
      "conciliacao_frete_linhas",
      "get_casos_conciliacao",
    ]) {
      expect(sql, `sem grant: ${f}`).toMatch(
        new RegExp(`grant execute on function public\\.${f}\\([^)]*\\)\\s+to authenticated, service_role`, "i"),
      );
      expect(sql, `sem revoke de public/anon: ${f}`).toMatch(
        new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\)\\s+from public, anon`, "i"),
      );
    }
  });

  it("nenhuma função vira SECURITY DEFINER pelo caminho", () => {
    expect(sql.toLowerCase()).not.toContain("security definer");
  });

  it("nenhum DELETE entra pela migration", () => {
    expect(sql.toLowerCase()).not.toMatch(/\bdelete\s+from\b/);
  });
});
