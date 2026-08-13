/**
 * tabelaUf.test.ts — prova sem rede de `montarTabelaAliquotas` (Fase 222,
 * plano 222-05).
 *
 * As linhas de fixture têm o formato de `aliquota_interna_vigente(date)`
 * (222-01-SUMMARY.md): `{ uf, aliq_interna, aliq_fcp, confirmado }`. Alguns
 * casos usam `aliq_interna`/`aliq_fcp` como STRING de propósito — é o
 * formato real que o driver Postgres/PostgREST costuma devolver para
 * `numeric`, e este módulo não pode depender do chamador já ter convertido.
 */
import { describe, it, expect } from "vitest";
import { montarTabelaAliquotas, type LinhaAliquotaUf } from "./tabelaUf";

describe("montarTabelaAliquotas", () => {
  it("array vazio devolve objeto vazio — a tabela não carregou", () => {
    expect(montarTabelaAliquotas([])).toEqual({});
  });

  it("null/undefined devolvem objeto vazio, nunca lançam", () => {
    expect(montarTabelaAliquotas(null)).toEqual({});
    expect(montarTabelaAliquotas(undefined)).toEqual({});
  });

  it("chaveia por sigla em caixa alta", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "sp", aliq_interna: 18, aliq_fcp: 2, confirmado: true },
    ];
    const tabela = montarTabelaAliquotas(linhas);
    expect(tabela.SP).toBeDefined();
    expect(tabela.sp).toBeUndefined();
  });

  it("apara espaço da sigla", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "  MG  ", aliq_interna: 18, aliq_fcp: 2, confirmado: true },
    ];
    const tabela = montarTabelaAliquotas(linhas);
    expect(tabela.MG).toBeDefined();
  });

  it("linha sem confirmação humana vira confirmado: false", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "RJ", aliq_interna: 20, aliq_fcp: 4, confirmado: false },
    ];
    expect(montarTabelaAliquotas(linhas).RJ.confirmado).toBe(false);
  });

  it("linha confirmada vira confirmado: true", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "RJ", aliq_interna: 20, aliq_fcp: 4, confirmado: true },
    ];
    expect(montarTabelaAliquotas(linhas).RJ.confirmado).toBe(true);
  });

  it("confirmado ausente (campo não veio) vira false, nunca true por omissão", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "BA", aliq_interna: 18, aliq_fcp: 0 } as LinhaAliquotaUf,
    ];
    expect(montarTabelaAliquotas(linhas).BA.confirmado).toBe(false);
  });

  it("duas linhas para a mesma UF (mesma grafia) lançam erro", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "SP", aliq_interna: 18, aliq_fcp: 2, confirmado: true },
      { uf: "SP", aliq_interna: 18, aliq_fcp: 2, confirmado: true },
    ];
    expect(() => montarTabelaAliquotas(linhas)).toThrow();
  });

  it("duas linhas para a mesma UF (grafia diferente) também lançam erro — comparação normalizada", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "sp", aliq_interna: 18, aliq_fcp: 2, confirmado: true },
      { uf: " SP ", aliq_interna: 18, aliq_fcp: 2, confirmado: true },
    ];
    expect(() => montarTabelaAliquotas(linhas)).toThrow();
  });

  it("alíquota não numérica descarta a linha inteira, nunca vira zero silencioso", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "AC", aliq_interna: "não é número", aliq_fcp: 0, confirmado: true },
    ];
    expect(montarTabelaAliquotas(linhas)).toEqual({});
  });

  it("alíquota negativa descarta a linha inteira", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "AC", aliq_interna: -5, aliq_fcp: 0, confirmado: true },
    ];
    expect(montarTabelaAliquotas(linhas)).toEqual({});
  });

  it("alíquota não finita (NaN/Infinity) descarta a linha inteira", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "AC", aliq_interna: NaN, aliq_fcp: 0, confirmado: true },
      { uf: "AP", aliq_interna: Infinity, aliq_fcp: 0, confirmado: true },
    ];
    expect(montarTabelaAliquotas(linhas)).toEqual({});
  });

  it("FCP ausente (null) vira zero — valor conhecido, não ausência", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "SC", aliq_interna: 17, aliq_fcp: null, confirmado: true },
    ];
    expect(montarTabelaAliquotas(linhas).SC).toEqual({
      aliqInterna: 17,
      aliqFcp: 0,
      confirmado: true,
    });
  });

  it("FCP ausente (campo não veio) também vira zero", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "SC", aliq_interna: 17, confirmado: true } as LinhaAliquotaUf,
    ];
    expect(montarTabelaAliquotas(linhas).SC.aliqFcp).toBe(0);
  });

  it("FCP inválido (negativo) descarta a linha inteira, não só o FCP", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "PR", aliq_interna: 18, aliq_fcp: -1, confirmado: true },
    ];
    expect(montarTabelaAliquotas(linhas)).toEqual({});
  });

  it("FCP inválido (não numérico) descarta a linha inteira", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "PR", aliq_interna: 18, aliq_fcp: "abc", confirmado: true },
    ];
    expect(montarTabelaAliquotas(linhas)).toEqual({});
  });

  it("aceita aliq_interna/aliq_fcp como STRING numérica — formato real do driver Postgres para numeric", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "SP", aliq_interna: "18.00", aliq_fcp: "2.00", confirmado: true },
    ];
    expect(montarTabelaAliquotas(linhas).SP).toEqual({
      aliqInterna: 18,
      aliqFcp: 2,
      confirmado: true,
    });
  });

  it("monta a tabela inteira com múltiplas UFs válidas de uma vez, preservando cada uma", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "SP", aliq_interna: 18, aliq_fcp: 2, confirmado: true },
      { uf: "MG", aliq_interna: 18, aliq_fcp: 2, confirmado: false },
      { uf: "AM", aliq_interna: 20, aliq_fcp: 0, confirmado: true },
    ];
    const tabela = montarTabelaAliquotas(linhas);
    expect(Object.keys(tabela).sort()).toEqual(["AM", "MG", "SP"]);
    expect(tabela.AM).toEqual({ aliqInterna: 20, aliqFcp: 0, confirmado: true });
  });

  it("uma linha descartada não impede as outras válidas de entrarem na tabela", () => {
    const linhas: LinhaAliquotaUf[] = [
      { uf: "SP", aliq_interna: 18, aliq_fcp: 2, confirmado: true },
      { uf: "AC", aliq_interna: -1, aliq_fcp: 0, confirmado: true },
    ];
    const tabela = montarTabelaAliquotas(linhas);
    expect(tabela.SP).toBeDefined();
    expect(tabela.AC).toBeUndefined();
  });
});
