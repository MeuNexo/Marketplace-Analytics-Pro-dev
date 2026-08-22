// ============================================================================
// cicloCaixa.test.ts — Fase 230, Plano 03, Task 2 (CX-02)
//
// Prova de que o ciclo de conversão de caixa aparece DECOMPOSTO, de que nenhum
// componente ausente vira zero somado no meio da conta, e de que a parcela que
// hoje sai de um valor preso no limite nunca se apresenta como medição.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  resolveCicloCaixa,
  resolveDinheiroPreso,
  BENCHMARK_CCC_VAREJO,
  type InsumosCicloCaixa,
} from "./cicloCaixa";

/** Os insumos medidos em 21/08 (230-MEDICOES-CAIXA.md), org Pé Vermeio. */
const MEDIDOS: InsumosCicloCaixa = {
  valorEstoque: 189277.32,
  unidadesEstoque: 2995,
  unidadesSemCusto: 0,
  skusSemCusto: 0,
  cmvDiario: 4586.71,
  cmvPedidos: 3119,
  dsoDias: 7,
  dsoN: 412,
  dsoNoLimite: true,
  dpoDias: 12,
  dpoN: 198,
  janelaDias: 90,
};

const comp = (r: ReturnType<typeof resolveCicloCaixa>, chave: "dio" | "dso" | "dpo") =>
  r.componentes.find((c) => c.chave === chave)!;

describe("resolveCicloCaixa", () => {
  it("Test 1: reproduz o DIO de 41,3 e o CCC de 36,3 medidos em 21/08", () => {
    const r = resolveCicloCaixa({ ...MEDIDOS, dsoNoLimite: false });

    expect(comp(r, "dio").dias).toBeCloseTo(41.3, 1);
    expect(comp(r, "dso").dias).toBe(7);
    expect(comp(r, "dpo").dias).toBe(12);
    expect(r.ciclo).toBeCloseTo(36.3, 1);
  });

  it("Test 2: o ciclo sai sempre decomposto em três componentes rotulados em português", () => {
    const r = resolveCicloCaixa(MEDIDOS);

    expect(r.componentes.map((c) => c.chave)).toEqual(["dio", "dso", "dpo"]);
    // Rótulo de negócio, não a sigla sozinha — um número que não decompõe não
    // dispara ação (critério 2 da fase).
    for (const c of r.componentes) {
      expect(c.rotulo.length).toBeGreaterThan(6);
      expect(c.rotulo).not.toMatch(/^(DIO|DSO|DPO)$/);
      expect(c.titulo.length).toBeGreaterThan(10);
    }
  });

  it("Test 3: CMV diário nulo ou zero devolve DIO null e CCC null, com o motivo nomeado", () => {
    for (const cmvDiario of [null, 0]) {
      const r = resolveCicloCaixa({ ...MEDIDOS, cmvDiario });

      expect(comp(r, "dio").dias).toBeNull();
      expect(comp(r, "dio").estado).toBe("nao_medido");
      // Nunca infinito, nunca um ciclo somado pela metade.
      expect(r.ciclo).toBeNull();
      expect(r.estado).toBe("nao_medido");
      expect(r.frasesDeRessalva.join(" ")).toMatch(/custo das vendas|CMV/i);
    }
  });

  it("Test 4: componente ausente NÃO é tratado como zero no ciclo", () => {
    const semDpo = resolveCicloCaixa({ ...MEDIDOS, dpoDias: null, dpoN: 0 });

    expect(comp(semDpo, "dpo").dias).toBeNull();
    expect(comp(semDpo, "dpo").estado).toBe("nao_medido");
    // Somar tratando ausente como zero daria ~48,3 dias e apontaria a decisão
    // errada (o ciclo pareceria pior do que é).
    expect(semDpo.ciclo).toBeNull();
    expect(semDpo.frasesDeRessalva.join(" ")).toMatch(/fornecedor/i);
  });

  it("Test 5: DSO no limite devolve o valor E o aviso de que não é medição livre", () => {
    const r = resolveCicloCaixa(MEDIDOS);
    const dso = comp(r, "dso");

    expect(dso.dias).toBe(7);
    expect(dso.estado).toBe("no_limite");
    expect(dso.titulo).toMatch(/limite/i);
    // O ciclo inteiro herda a fragilidade: é um piso, nunca um valor exato.
    expect(r.ciclo).toBeCloseTo(36.3, 1);
    expect(r.estado).toBe("no_limite");
    expect(r.texto).toMatch(/pelo menos|no mínimo/i);
    expect(r.frasesDeRessalva.join(" ")).toMatch(/limite/i);
  });

  it("Test 6: DSO medido livremente não carrega o aviso", () => {
    const r = resolveCicloCaixa({ ...MEDIDOS, dsoDias: 11, dsoNoLimite: false });

    expect(comp(r, "dso").estado).toBe("medido");
    expect(r.estado).toBe("medido");
    expect(r.frasesDeRessalva.join(" ")).not.toMatch(/limite/i);
  });

  it("Test 7: DPO com amostra pequena sai marcado como provisório, com o n junto", () => {
    const r = resolveCicloCaixa({ ...MEDIDOS, dsoNoLimite: false, dpoN: 4 });
    const dpo = comp(r, "dpo");

    expect(dpo.dias).toBe(12);
    expect(dpo.estado).toBe("provisorio");
    expect(dpo.titulo).toMatch(/4/);
    expect(r.ciclo).toBeCloseTo(36.3, 1);
    expect(r.estado).toBe("provisorio");
  });

  it("Test 8: unidades sem custo viram frase de cobertura mesmo com o ciclo medido", () => {
    const r = resolveCicloCaixa({
      ...MEDIDOS,
      dsoNoLimite: false,
      unidadesSemCusto: 94,
      skusSemCusto: 9,
    });

    expect(r.ciclo).toBeCloseTo(36.3, 1);
    const ressalvas = r.frasesDeRessalva.join(" ");
    expect(ressalvas).toMatch(/94/);
    expect(ressalvas).toMatch(/unidade/i);
  });

  it("Test 9: a leitura diz se o ciclo está dentro do intervalo de referência", () => {
    const dentro = resolveCicloCaixa({ ...MEDIDOS, dsoNoLimite: false });
    expect(dentro.texto).toMatch(/36/);
    expect(dentro.titulo).toMatch(String(BENCHMARK_CCC_VAREJO.minimo));

    // Ciclo longo: estoque muito maior sobre o mesmo CMV.
    const longo = resolveCicloCaixa({
      ...MEDIDOS,
      dsoNoLimite: false,
      valorEstoque: 500000,
    });
    expect(longo.ciclo!).toBeGreaterThan(BENCHMARK_CCC_VAREJO.maximo);
    expect(longo.texto).not.toEqual(dentro.texto);
  });
});

describe("resolveDinheiroPreso", () => {
  it("Test 10: estoque contra caixa devolve a razão de 12,9× e a leitura em uma frase", () => {
    const r = resolveDinheiroPreso({ valorEstoque: 189277.32, caixa: 14650.34 });

    expect(r.razao).toBeCloseTo(12.9, 1);
    expect(r.texto).toMatch(/mercadoria/i);
    expect(r.texto).toMatch(/12,9|12.9/);
    expect(r.titulo.length).toBeGreaterThan(10);
  });

  it("Test 11: caixa zero, negativo ou ausente devolve razão null com motivo nomeado", () => {
    for (const caixa of [0, -1200, null]) {
      const r = resolveDinheiroPreso({ valorEstoque: 189277.32, caixa });

      expect(r.razao).toBeNull();
      expect(r.texto.length).toBeGreaterThan(10);
      expect(r.texto).not.toMatch(/^—$/);
    }
    // Dividir por caixa negativo produz número sem sentido — a frase precisa
    // dizer isso, não devolver um múltiplo negativo.
    expect(resolveDinheiroPreso({ valorEstoque: 1, caixa: -1 }).texto).toMatch(/negativ/i);
  });

  it("Test 12: estoque ausente também é nomeado, nunca exibido como zero", () => {
    const r = resolveDinheiroPreso({ valorEstoque: null, caixa: 14650.34 });

    expect(r.razao).toBeNull();
    expect(r.texto).toMatch(/estoque/i);
  });
});
