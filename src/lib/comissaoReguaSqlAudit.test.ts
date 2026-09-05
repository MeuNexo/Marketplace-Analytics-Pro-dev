/**
 * comissaoReguaSqlAudit.test.ts — os portões da régua de comissão (244-03).
 *
 * ── O QUE ELES PROTEGEM ────────────────────────────────────────────────────
 *
 * A régua mora numa função SQL de 300 linhas. Nada no TypeScript obriga ela a
 * continuar honrando o contrato da fase 239 — "para ditar, precisa provar" — e
 * a fase 241 mostrou o que acontece quando uma decisão vive só em prosa: `CFFI`
 * ficou fora da régua de frete por semanas com o comentário certo ao lado.
 *
 * 🔴 Os dois testes que mais importam são os últimos: **todo motivo e todo tipo
 * que o SQL pode emitir tem rótulo na tela e família declarada**. É o par que
 * reprova no dia em que alguém acrescentar um motivo e esquecer o texto — o
 * caso em que o card mostraria o código cru para o Wesley.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMPOEM_SALE_FEE_CHARGE } from "../../supabase/functions/_shared/subtiposDeCobranca.ts";
import { rotuloMotivo, rotuloTipoCaso, rotuloSlotRecebido } from "./casoUrgencia";
import { familiaConhecida, exigeProva } from "./conciliacaoFamilias";

const MIG = "supabase/migrations/20260905220000_conciliacao_comissao_linhas.sql";
const MIG_TELA = "supabase/migrations/20260905230000_comissao_entra_na_tela.sql";

function semComentarios(caminho: string): string {
  return readFileSync(resolve(process.cwd(), caminho), "utf8")
    .split("\n")
    .map((l) => {
      const i = l.indexOf("--");
      return i === -1 ? l : l.slice(0, i);
    })
    .join("\n");
}

const sql = semComentarios(MIG);
const sqlTela = semComentarios(MIG_TELA);

/**
 * Os motivos que a cascata pode emitir, lidos do próprio SQL.
 *
 * ⚠️ O recorte para ANTES da CTE `src` é de propósito: dali para baixo os
 * mesmos literais aparecem como TIPO de caso (`comissao_a_maior`), e misturar
 * os dois faria este portão cobrar rótulo de motivo para um tipo.
 */
const cascata = sql.slice(0, sql.indexOf("src as ("));
const MOTIVOS_DO_SQL = [...new Set(
  [...cascata.matchAll(/then\s+'(comissao_[a-z_]+|regua_comissao_[a-z_]+)'/g)].map((m) => m[1]),
)].sort();

/** Os tipos de caso que o SELECT final pode emitir. */
const TIPOS_DO_SQL = [...new Set(
  [...sql.matchAll(/'(comissao_(?:a_maior|divergente|em_aberto))'/g)].map((m) => m[1]),
)].sort();

describe("244-03 — a régua de comissão honra o contrato da fase 239", () => {
  it("🔴 a lista de subtipos do SQL é exatamente `COMPOEM_SALE_FEE_CHARGE`", () => {
    // Aparece duas vezes na função (soma e contagem) e as duas têm de ser iguais.
    const listas = sql.match(/in \('CV[^)]*\)/g) ?? [];
    expect(listas.length, "a função soma e conta com a MESMA lista").toBe(2);
    for (const lista of listas) {
      const noSql = [...lista.matchAll(/'([A-Z]+)'/g)].map((m) => m[1]).sort();
      expect(noSql).toEqual(COMPOEM_SALE_FEE_CHARGE);
    }
  });

  it("🔴 D-244-05: a régua publicada só olha tarifa VIGENTE na data da venda", () => {
    // Sem esta cláusula, março seria julgado com a tabela de setembro — e a
    // alíquota mudou de 14,0% para 12,0% no meio do ano.
    expect(sql).toContain("t.vigente_desde  <= p.data_pedido");
    // E a mais recente entre as que já valiam, nunca a mais antiga.
    expect(sql).toMatch(/order by p\.ml_order_id, t\.vigente_desde desc/);
  });

  it("🔴 o estorno é decidido ANTES de qualquer comparação", () => {
    const posEstorno = sql.indexOf("'comissao_estornada'");
    const posPublicado = sql.indexOf("'comissao_confere_com_o_publicado'");
    const posPedido = sql.indexOf("'comissao_confere_com_o_pedido'");
    expect(posEstorno).toBeGreaterThan(0);
    expect(posEstorno).toBeLessThan(posPublicado);
    expect(posEstorno).toBeLessThan(posPedido);
  });

  it("🔴 a espera do ML é decidida ANTES da lacuna nossa (lição da 239-04)", () => {
    const posEspera = sql.indexOf("'comissao_nao_emitida_pelo_ml'");
    const posLacuna = sql.indexOf("'comissao_captura_pendente'");
    expect(posEspera).toBeGreaterThan(0);
    expect(posEspera).toBeLessThan(posLacuna);
  });

  it("🔴 e ela exige PROVA de que perguntamos (lição da 242-02)", () => {
    // A presunção pela idade da venda errou em 39 de 40 casos medidos.
    const ramo = sql.slice(
      sql.indexOf("c.n_comissao = 0"),
      sql.indexOf("'comissao_nao_emitida_pelo_ml'"),
    );
    expect(ramo).toContain("c.cap_id is not null");
    expect(ramo).toContain("c.ultima_tentativa");
  });

  it("🔴 a cobrança exclui o que um BONUS estornou, pelo PONTEIRO", () => {
    // 412 de 412 bônus da base carregam `charge_bonified_id`: o par é fato.
    expect(sql).toContain("charge_bonified_id");
    expect(sql).toContain("e.detail_id is null");
  });

  it("🔴 ausência viaja como ausência — nenhum `coalesce(..., 0)` no esperado", () => {
    expect(sql).not.toMatch(/coalesce\s*\(\s*ta\.sale_fee_publicado\s*,\s*0/i);
    expect(sql).not.toMatch(/coalesce\s*\(\s*capt\.sale_fee_net\s*,\s*0/i);
  });

  it("🔴 a fonte do esperado sai do MOTIVO, num lugar só", () => {
    // Antes da CTE `src` o tipo vinha de "qual diferença é calculável", e 2
    // pedidos estornados saíam rotulados `comissao_divergente`.
    expect(sql).toContain("src as (");
    // O SELECT final lê `m.fonte`, nunca as diferenças cruas.
    const selectFinal = sql.slice(sql.indexOf("select k.id"));
    expect(selectFinal).not.toMatch(/when m\.dif_publicado is not null then 'comissao/);
  });

  it("🔴 `comissao_a_maior` NUNCA nasce da comparação contra o próprio pedido", () => {
    const selectFinal = sql.slice(sql.indexOf("select k.id"));
    const trecho = selectFinal.slice(0, selectFinal.indexOf("as tipo_caso"));
    expect(trecho).toContain("when 'publicada' then 'comissao_a_maior'");
    expect(trecho).toContain("when 'pedido'    then 'comissao_divergente'");
  });

  it("🔴 o lado que não acusa existe — sem ele 'é sempre a mais' seria irrefutável", () => {
    expect(MOTIVOS_DO_SQL).toContain("comissao_com_rebate_medido");
  });

  it("🔴 acusar depende da chave de configuração, nunca do deploy", () => {
    expect(sql).toContain("acusar_comissao_a_maior");
    expect(sql).toContain("DEFAULT false");
    // E só o motivo confirmado é acionável.
    expect(sql).toContain("(m.motivo = 'comissao_a_maior_confirmada')        as acionavel");
  });

  it("🔴 a régua entra nos DOIS wrappers, não só na lista (lição G-02 da 225)", () => {
    const ocorrencias = sqlTela.match(/conciliacao_comissao_linhas\(p_org_id, p_janela_dias\)/g) ?? [];
    expect(ocorrencias.length, "get_casos_conciliacao E get_conciliacao_resumo").toBe(2);
    // E sem DROP: `DROP FUNCTION` apaga a ACL e a função renasce para `anon`.
    expect(sqlTela).not.toContain("DROP FUNCTION");
    expect(sqlTela).toContain("REVOKE ALL ON FUNCTION public.get_casos_conciliacao");
  });

  it("🔴 TODO motivo que o SQL emite tem texto na tela", () => {
    expect(MOTIVOS_DO_SQL.length).toBeGreaterThanOrEqual(13);
    const semTexto = MOTIVOS_DO_SQL.filter((m) => rotuloMotivo(m) === m);
    expect(semTexto, "motivo sem rótulo mostraria o código cru no card").toEqual([]);
  });

  it("🔴 TODO tipo que o SQL emite tem rótulo E família declarada", () => {
    expect(TIPOS_DO_SQL).toEqual(["comissao_a_maior", "comissao_divergente", "comissao_em_aberto"]);
    for (const t of TIPOS_DO_SQL) {
      expect(rotuloTipoCaso(t), t).not.toBe(t);
      expect(familiaConhecida(t), t).toBe(true);
    }
    // As duas afirmativas exigem prova; a em aberto, não.
    expect(exigeProva("comissao_a_maior")).toBe(true);
    expect(exigeProva("comissao_divergente")).toBe(true);
    expect(exigeProva("comissao_em_aberto")).toBe(false);
  });

  it("🔴 no card de comissão o slot do meio é COBRANÇA, não dinheiro recebido", () => {
    for (const t of TIPOS_DO_SQL) {
      expect(rotuloSlotRecebido(t), t).toBe("Cobrado pelo ML");
    }
    // E a régua do dinheiro continua dizendo "Recebido".
    expect(rotuloSlotRecebido("repasse_a_menor")).toBe("Recebido");
  });

  it("o rótulo de `comissao_divergente` não fala em tarifa — ele não tem fonte para isso", () => {
    const texto = rotuloTipoCaso("comissao_divergente").toLowerCase();
    expect(texto).not.toContain("tarifa");
    expect(rotuloTipoCaso("comissao_a_maior").toLowerCase()).toContain("tarifa");
  });
});
