import { describe, it, expect } from "vitest";
import {
  FAMILIAS_QUE_AFIRMAM,
  FAMILIAS_QUE_NAO_AFIRMAM,
  exigeProva,
  familiaConhecida,
  linhaHonraOContrato,
  rotuloTipoCasoDaLinha,
} from "./conciliacaoFamilias";

const PROVADA = { esperado_nosso: 221.26, recebido: 247.25, diferenca: -25.99 };
const VAZIA = { esperado_nosso: null, recebido: null, diferenca: null };

describe("239-05 — a exceção sai da prosa e vira código", () => {
  it("as duas listas não se cruzam", () => {
    const cruzamento = FAMILIAS_QUE_AFIRMAM.filter((f) =>
      (FAMILIAS_QUE_NAO_AFIRMAM as readonly string[]).includes(f),
    );
    expect(cruzamento).toEqual([]);
  });

  it("todo rótulo afirmativo exige as três linhas", () => {
    for (const f of FAMILIAS_QUE_AFIRMAM) {
      expect(exigeProva(f), `${f} deveria exigir prova`).toBe(true);
      expect(linhaHonraOContrato({ tipo_caso: f, ...VAZIA }), f).toBe(false);
      expect(linhaHonraOContrato({ tipo_caso: f, ...PROVADA }), f).toBe(true);
    }
  });

  it("🔴 `entrada_sem_origem` é exceção DECLARADA, não derivada do sufixo", () => {
    expect(exigeProva("entrada_sem_origem")).toBe(false);
    expect(linhaHonraOContrato({ tipo_caso: "entrada_sem_origem", ...VAZIA })).toBe(true);
    // E a prova de que não é o sufixo que decide: ela não termina em `_em_aberto`.
    expect("entrada_sem_origem".endsWith("_em_aberto")).toBe(false);
  });

  it("os dois `_em_aberto` também não afirmam", () => {
    for (const f of ["repasse_em_aberto", "frete_em_aberto"]) {
      expect(exigeProva(f), f).toBe(false);
    }
  });

  it("🔴 família NOVA cai no lado seguro: exige prova e falha o portão", () => {
    // O cenário que a prosa não cobria — um `cobranca_em_aberto` inventado
    // amanhã. Ele NÃO pode herdar a isenção por parecer com os outros.
    expect(familiaConhecida("cobranca_em_aberto")).toBe(false);
    expect(exigeProva("cobranca_em_aberto")).toBe(true);
    expect(linhaHonraOContrato({ tipo_caso: "cobranca_em_aberto", ...VAZIA })).toBe(false);
  });

  it("nulo e vazio não viram isenção", () => {
    expect(exigeProva(null)).toBe(true);
    expect(exigeProva("")).toBe(true);
    expect(exigeProva("   ")).toBe(true);
  });

  it("as cinco famílias que a RPC emite hoje estão declaradas", () => {
    // Medido em 04/09/2026 sobre o universo inteiro (2.556 linhas, sem o teto
    // de 1.000 do `get_casos_conciliacao`): repasse_a_menor 1.242 ·
    // frete_a_maior 970 · frete_em_aberto 245 · repasse_em_aberto 90 ·
    // entrada_sem_origem 9. `repasse_ausente` é persistido em
    // `conciliacao_casos` e volta pelo join, por isso está na lista.
    for (const f of [
      "repasse_a_menor",
      "frete_a_maior",
      "frete_em_aberto",
      "repasse_em_aberto",
      "entrada_sem_origem",
    ]) {
      expect(familiaConhecida(f), `família emitida e não declarada: ${f}`).toBe(true);
    }
  });
});

describe("239-05 — o segundo portão, na tela", () => {
  const rotulo = (c: string | null | undefined) => `[${c ?? "?"}]`;

  it("linha provada mantém o rótulo que a RPC mandou", () => {
    expect(
      rotuloTipoCasoDaLinha({ tipo_caso: "repasse_a_menor", ...PROVADA }, rotulo),
    ).toBe("[repasse_a_menor]");
  });

  it("🔴 rótulo afirmativo sem as três linhas NÃO passa, mesmo vindo da RPC", () => {
    expect(rotuloTipoCasoDaLinha({ tipo_caso: "repasse_a_menor", ...VAZIA }, rotulo)).toBe(
      "Em aberto — falta prova",
    );
    expect(rotuloTipoCasoDaLinha({ tipo_caso: "frete_a_maior", ...VAZIA }, rotulo)).toBe(
      "Em aberto — falta prova",
    );
  });

  it("uma das três faltando já basta", () => {
    expect(
      rotuloTipoCasoDaLinha(
        { tipo_caso: "repasse_a_menor", esperado_nosso: 10, recebido: 8, diferenca: null },
        rotulo,
      ),
    ).toBe("Em aberto — falta prova");
  });

  it("quem não afirma passa sem prova nenhuma", () => {
    expect(rotuloTipoCasoDaLinha({ tipo_caso: "entrada_sem_origem", ...VAZIA }, rotulo)).toBe(
      "[entrada_sem_origem]",
    );
  });
});
