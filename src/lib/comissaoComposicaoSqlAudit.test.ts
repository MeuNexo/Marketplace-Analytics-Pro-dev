/**
 * comissaoComposicaoSqlAudit.test.ts — o portão que impede a lista de comissão
 * de divergir entre o TypeScript e o SQL.
 *
 * ── A CAUSA RAIZ QUE ELE FECHA ─────────────────────────────────────────────
 *
 * É a mesma da fase 241, e por isso ele nasce junto com a decisão em vez de
 * depois dela: `CFFI` ficou fora da régua de frete por semanas porque a lista
 * vivia como LITERAL REPETIDO em arquivos que não se falam. A migration
 * `20260905200000` repete as sete siglas dentro de um `IN (...)`; nada, além
 * deste arquivo, obriga esse `IN` a concordar com o dicionário.
 *
 * 🔴 O teste que importa é o primeiro: **o `IN` do SQL é exatamente
 * `COMPOEM_SALE_FEE_CHARGE`.** Ele reprova nos dois sentidos — sigla a mais no
 * SQL e sigla a mais no dicionário.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMPOEM_SALE_FEE_CHARGE,
  SUBTIPOS,
} from "../../supabase/functions/_shared/subtiposDeCobranca.ts";
import { SUBTIPOS_COMISSAO } from "../../supabase/functions/_shared/mlOrderSaleFeeContrato.ts";

const MIG = "supabase/migrations/20260905200000_comissao_linhas_composicao_do_sale_fee.sql";

/** O SQL sem comentários — senão as siglas citadas na prosa entram na conta. */
const sql = readFileSync(resolve(process.cwd(), MIG), "utf8")
  .split("\n")
  .map((l) => {
    const i = l.indexOf("--");
    return i === -1 ? l : l.slice(0, i);
  })
  .join("\n");

describe("244-01 — a composição do sale_fee é a mesma no SQL e no dicionário", () => {
  it("🔴 o `IN (...)` da migration é exatamente `COMPOEM_SALE_FEE_CHARGE`", () => {
    const listas = sql.match(/IN \(([^)]*)\)/gi) ?? [];
    expect(listas.length, "a migration deve ter UMA lista de subtipos").toBe(1);
    const noSql = [...listas[0].matchAll(/'([A-Z]+)'/g)].map((m) => m[1]).sort();
    expect(noSql).toEqual(COMPOEM_SALE_FEE_CHARGE);
    // O contador, não só o veredito — gate verde com zero item não é aprovação.
    expect(noSql.length).toBe(7);
  });

  it("🔴 `CVAF` não aparece no SQL — 29 de 29 pedidos com ela fecham SEM ela", () => {
    expect(sql).not.toContain("'CVAF'");
    expect(SUBTIPOS.CVAF.compoeSaleFee).toBe(false);
  });

  it("nenhuma sigla de frete nem `CFONPN` entra no `IN` da migration", () => {
    for (const proibida of ["CFFE", "CFFI", "CXDE", "CXDED", "CFONPN"]) {
      expect(sql, proibida).not.toContain(`'${proibida}'`);
    }
  });

  it("a migration só toca linhas de COBRANÇA — bônus somado zeraria a comissão do período", () => {
    expect(sql).toContain("detail_type = 'CHARGE'");
    expect(sql).not.toContain("'BONUS'");
  });

  it("🔴 nulo continua nulo: o UPDATE não inventa zero onde não há linha", () => {
    // Sem `LEFT JOIN`, o pedido sem nenhuma linha de comissão simplesmente não
    // aparece na subconsulta e não é tocado. `0` ali leria "o ML não cobrou".
    expect(sql).not.toMatch(/coalesce\s*\(\s*sum/i);
    expect(sql).toContain("IS DISTINCT FROM");
  });

  it("e o contrato TypeScript não diverge do dicionário", () => {
    expect([...SUBTIPOS_COMISSAO].sort()).toEqual(COMPOEM_SALE_FEE_CHARGE);
  });
});
