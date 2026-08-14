/**
 * vigencia.test.ts — prova sem rede de `planejarSalvamentoVigencia`
 * (Fase 222, plano 222-05-R).
 *
 * As datas dos casos de borda são as do Junior (loja 2359559427): a vigência
 * de 6% terminou em 30/06/2026 e a de 4% começou em 01/07/2026. Salvar a
 * segunda por cima da primeira foi o que regravou 352 pedidos de 01–10/08.
 */
import { describe, it, expect } from "vitest";
import { planejarSalvamentoVigencia, type VigenciaAberta } from "./vigencia";

const CAMPOS = { regime: "simples_nacional", sn_aliquota_efetiva: 4 } as const;

const aberta = (over: Partial<VigenciaAberta> = {}): VigenciaAberta => ({
  id: "cfg-aberta",
  vigencia_inicio: "2020-01-01",
  ...over,
});

describe("planejarSalvamentoVigencia", () => {
  it("sem vigência aberta insere a primeira, com início na data informada", () => {
    const plano = planejarSalvamentoVigencia(null, "2026-07-01", CAMPOS);
    expect(plano.acao).toBe("inserir_primeira");
    if (plano.acao !== "inserir_primeira") return;
    expect(plano.vigencia_inicio).toBe("2026-07-01");
    expect(plano.campos).toEqual(CAMPOS);
  });

  it("data igual ao início da vigência aberta ATUALIZA aquela linha (correção de digitação)", () => {
    const plano = planejarSalvamentoVigencia(aberta({ vigencia_inicio: "2026-07-01" }), "2026-07-01", CAMPOS);
    expect(plano.acao).toBe("atualizar");
    if (plano.acao !== "atualizar") return;
    expect(plano.id).toBe("cfg-aberta");
    expect(plano.vigencia_inicio).toBe("2026-07-01");
  });

  it("data posterior ABRE vigência nova e fecha a anterior no dia anterior", () => {
    const plano = planejarSalvamentoVigencia(aberta(), "2026-07-01", CAMPOS);
    expect(plano.acao).toBe("abrir_nova");
    if (plano.acao !== "abrir_nova") return;
    expect(plano.id_anterior).toBe("cfg-aberta");
    expect(plano.fechar_em).toBe("2026-06-30"); // a fronteira real do Junior
    expect(plano.vigencia_inicio).toBe("2026-07-01");
  });

  it("o fechamento atravessa a virada de ano sem escorregar um dia", () => {
    const plano = planejarSalvamentoVigencia(aberta(), "2027-01-01", CAMPOS);
    if (plano.acao !== "abrir_nova") throw new Error("esperava abrir_nova");
    expect(plano.fechar_em).toBe("2026-12-31");
  });

  it("o fechamento atravessa 01 de março sem cair no bissexto errado", () => {
    const plano = planejarSalvamentoVigencia(aberta(), "2028-03-01", CAMPOS);
    if (plano.acao !== "abrir_nova") throw new Error("esperava abrir_nova");
    expect(plano.fechar_em).toBe("2028-02-29");
  });

  it("data anterior ao início da vigência aberta é RECUSADA, com motivo legível", () => {
    const plano = planejarSalvamentoVigencia(aberta({ vigencia_inicio: "2026-07-01" }), "2026-05-01", CAMPOS);
    expect(plano.acao).toBe("recusar");
    if (plano.acao !== "recusar") return;
    expect(plano.motivo).toMatch(/2026-07-01/);
    expect(plano.motivo.length).toBeGreaterThan(20);
  });

  it("data ausente é recusada — nunca cai no caminho de atualizar", () => {
    expect(planejarSalvamentoVigencia(aberta(), null, CAMPOS).acao).toBe("recusar");
    expect(planejarSalvamentoVigencia(aberta(), "", CAMPOS).acao).toBe("recusar");
    expect(planejarSalvamentoVigencia(null, undefined, CAMPOS).acao).toBe("recusar");
  });

  it("data malformada é recusada, nunca interpretada por aproximação", () => {
    expect(planejarSalvamentoVigencia(aberta(), "01/07/2026", CAMPOS).acao).toBe("recusar");
    expect(planejarSalvamentoVigencia(aberta(), "2026-13-45", CAMPOS).acao).toBe("recusar");
    expect(planejarSalvamentoVigencia(aberta(), "hoje", CAMPOS).acao).toBe("recusar");
  });

  it("vigência aberta sem início legível ABRE NOVA, nunca sobrescreve", () => {
    // Banco pré-migration: preservar o passado é a direção conservadora — o
    // pior caso vira uma linha a mais, nunca dado histórico destruído.
    const plano = planejarSalvamentoVigencia(aberta({ vigencia_inicio: null }), "2026-07-01", CAMPOS);
    expect(plano.acao).toBe("abrir_nova");
  });

  it("os campos editados são repassados intactos, sem o helper interpretar nenhum", () => {
    const campos = { regime: "lucro_real", lr_icms_debito: 12, difal_ufs_recolhidas: ["MG"] };
    const plano = planejarSalvamentoVigencia(aberta(), "2026-09-01", campos);
    if (plano.acao !== "abrir_nova") throw new Error("esperava abrir_nova");
    expect(plano.campos).toBe(campos);
  });
});
