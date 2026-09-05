/**
 * parcelamentoNaoRetidoSqlAudit.test.ts — o portão do achado 244-04.
 *
 * ── O QUE ELE PROTEGE ──────────────────────────────────────────────────────
 *
 * `CFONPN` é o espelho contábil do acréscimo que o COMPRADOR pagou, não uma
 * cobrança nossa. Somá-la ao `declarado` fazia `(gross − net) = declarado`
 * fechar em **0 de 2.762** pedidos parcelados e exibia na tela um vazamento de
 * R$ 43.960,50 que ninguém perdeu.
 *
 * 🔴 O risco que este arquivo cobre não é alguém "desfazer a correção de
 * propósito": é alguém reescrever a CTE `tar` numa fase futura — ela já foi
 * reescrita mais de uma vez — e restaurar o `sum` sem filtro sem perceber que
 * havia uma exceção medida ali dentro.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NAO_RETIDOS_DO_REPASSE,
  SUBTIPOS,
} from "../../supabase/functions/_shared/subtiposDeCobranca.ts";

const MIG = "supabase/migrations/20260905240000_declarado_exclui_parcelamento.sql";
const sql = readFileSync(resolve(process.cwd(), MIG), "utf8")
  .split("\n")
  .map((l) => {
    const i = l.indexOf("--");
    return i === -1 ? l : l.slice(0, i);
  })
  .join("\n");

describe("244-04 — o `declarado` soma só o que o Mercado Livre RETÉM", () => {
  it("🔴 a CTE `tar` exclui exatamente `NAO_RETIDOS_DO_REPASSE`", () => {
    const m = sql.match(/detail_sub_type not in \(([^)]*)\)/);
    expect(m, "a exclusão sumiu da CTE `tar`").not.toBeNull();
    const noSql = [...m![1].matchAll(/'([A-Z]+)'/g)].map((x) => x[1]).sort();
    expect(noSql).toEqual(NAO_RETIDOS_DO_REPASSE);
    expect(noSql).toEqual(["BFONPN", "CFONPN"]);
  });

  it("🔴 e o dicionário concorda: só as duas de parcelamento não são retidas", () => {
    const naoRetidos = Object.entries(SUBTIPOS)
      .filter(([, v]) => !v.retidoDoRepasse)
      .map(([k]) => k)
      .sort();
    expect(naoRetidos).toEqual(["BFONPN", "CFONPN"]);
    // O contador: gate verde com zero item não é aprovação.
    expect(Object.keys(SUBTIPOS).length).toBe(20);
  });

  it("⚠️ `CVVFN`, que o ML também chama de parcelamento, CONTINUA retida", () => {
    // A pergunta é "sai do nosso bolso?", nunca "é da família parcelamento?".
    expect(SUBTIPOS.CVVFN.retidoDoRepasse).toBe(true);
    expect(SUBTIPOS.CVVFN.compoeSaleFee).toBe(true);
    expect(SUBTIPOS.CFONPN.retidoDoRepasse).toBe(false);
    expect(SUBTIPOS.CFONPN.compoeSaleFee).toBe(false);
  });

  it("🔴 as três perguntas do dicionário são independentes — nenhuma se deduz da outra", () => {
    // Se `retidoDoRepasse` fosse sempre igual a `compoeSaleFee`, o campo seria
    // redundante e alguém acabaria colapsando os dois. O frete prova que não:
    // ele é retido e NÃO compõe o `sale_fee`.
    expect(SUBTIPOS.CFFE.retidoDoRepasse).toBe(true);
    expect(SUBTIPOS.CFFE.compoeSaleFee).toBe(false);
  });

  it("o netting de C-02 continua intacto — o BONUS repete o valor do CHARGE", () => {
    expect(sql).toContain("f.detail_type = 'BONUS' or f.charge_bonified_id is not null");
  });

  it("🔴 sem DROP FUNCTION: ele apaga a ACL e a função renasce para `anon`", () => {
    expect(sql).not.toContain("DROP FUNCTION");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.conciliacao_base_linhas");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.conciliacao_base_linhas(uuid, integer) FROM anon");
  });

  it("a ponta do comprador (239-05) sobreviveu à reescrita", () => {
    // A CTE `tar` foi reescrita a partir do corpo VIVO do banco, não do repo —
    // este teste é a prova de que nada mais foi perdido no caminho.
    expect(sql).toContain("base_sem_ponta_do_comprador");
    expect(sql).toContain("n_pedidos_no_envio");
  });
});
