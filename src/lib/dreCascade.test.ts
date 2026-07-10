// ============================================================================
// dreCascade.test.ts — Phase 88 Plan 01, Task 1 (TDD)
// Testa a função pura que monta a cascata do DRE a partir das linhas da RPC 87
// (get_dre_operational_by_competence). Cobre o guardrail anti dupla-contagem
// (SC-3: impostos_venda/excluido NUNCA entram nos subtotais), a matemática dos
// subtotais, a propagação de double_count_risk, "nao_classificado" como linha
// própria e a fixture de reconciliação de junho/2026 (Phase 87, delta R$0,00).
// ============================================================================

import { describe, it, expect } from "vitest";
import { buildDreCascade, OPERACIONAL_BLOCOS, type DreOperationalRow } from "./dreCascade";

// Helper para montar linhas cruas da RPC com defaults sensatos.
function row(
  bloco: DreOperationalRow["bloco"],
  total: number,
  opts: { category?: string; n?: number; double_count_risk?: boolean } = {},
): DreOperationalRow {
  return {
    bloco,
    category: opts.category ?? bloco,
    total,
    n: opts.n ?? 1,
    double_count_risk: opts.double_count_risk ?? false,
  };
}

describe("buildDreCascade — SC-3 guardrail (impostos_venda + excluido)", () => {
  it("Test 1: NUNCA renderiza nem soma impostos_venda/excluido em nenhum subtotal", () => {
    const rows: DreOperationalRow[] = [
      row("impostos_venda", 4793),
      row("excluido", 139968),
      row("pessoal", 10000),
      row("financeiro", 2000),
    ];
    const margem = 100000;
    const c = buildDreCascade(rows, margem);

    // Nenhum bloco operacional é impostos_venda/excluido
    expect(c.operacionalBlocos.map((b) => b.bloco)).toEqual(["pessoal"]);
    // financeiro não é contaminado
    expect(c.financeiro?.total).toBe(2000);
    // Deduções operacionais = só pessoal (impostos_venda/excluido fora)
    expect(c.totalOperacionalDeducoes).toBe(10000);
    // Subtotais não incluem 4793 nem 139968
    expect(c.resultadoOperacional).toBe(90000); // 100000 - 10000
    expect(c.resultadoLiquido).toBe(88000); // 90000 - 2000
  });
});

describe("buildDreCascade — matemática dos subtotais", () => {
  it("Test 2: resultadoOperacional = margem − Σ deduções; resultadoLiquido = operacional − financeiro", () => {
    const rows: DreOperationalRow[] = [
      row("pessoal", 5000),
      row("estrutura", 3000),
      row("servicos", 1000),
      row("operacional", 2000),
      row("nao_classificado", 500),
      row("financeiro", 1500),
    ];
    const margem = 50000;
    const c = buildDreCascade(rows, margem);

    expect(c.totalOperacionalDeducoes).toBe(11500); // 5000+3000+1000+2000+500
    expect(c.resultadoOperacional).toBe(38500); // 50000 - 11500
    expect(c.totalFinanceiro).toBe(1500);
    expect(c.resultadoLiquido).toBe(37000); // 38500 - 1500
  });

  it("financeiro ausente → totalFinanceiro 0 e resultadoLiquido = resultadoOperacional", () => {
    const rows: DreOperationalRow[] = [row("pessoal", 1000)];
    const c = buildDreCascade(rows, 10000);
    expect(c.financeiro).toBeNull();
    expect(c.totalFinanceiro).toBe(0);
    expect(c.resultadoLiquido).toBe(c.resultadoOperacional);
    expect(c.resultadoLiquido).toBe(9000);
  });
});

describe("buildDreCascade — double_count_risk", () => {
  it("Test 3: double_count_risk propaga para o bloco correspondente (Cartão de crédito em operacional)", () => {
    const rows: DreOperationalRow[] = [
      row("operacional", 15715, { category: "Cartão de crédito", double_count_risk: true }),
      row("pessoal", 27852),
    ];
    const c = buildDreCascade(rows, 100000);

    const operacional = c.operacionalBlocos.find((b) => b.bloco === "operacional");
    const pessoal = c.operacionalBlocos.find((b) => b.bloco === "pessoal");
    expect(operacional?.doubleCountRisk).toBe(true);
    expect(pessoal?.doubleCountRisk).toBe(false);
  });
});

describe("buildDreCascade — nao_classificado visível", () => {
  it("Test 4: nao_classificado com dados sai como linha própria (não somado em operacional)", () => {
    const rows: DreOperationalRow[] = [
      row("operacional", 2000),
      row("nao_classificado", 7360, { category: "Outros" }),
    ];
    const c = buildDreCascade(rows, 50000);

    const naoClass = c.operacionalBlocos.find((b) => b.bloco === "nao_classificado");
    const operacional = c.operacionalBlocos.find((b) => b.bloco === "operacional");
    expect(naoClass).toBeDefined();
    expect(naoClass?.total).toBe(7360);
    expect(naoClass?.label).toBe("Não classificado");
    // Linha própria, não fundida com "operacional"
    expect(operacional?.total).toBe(2000);
    // Ordem fixa: operacional antes de nao_classificado
    expect(c.operacionalBlocos.map((b) => b.bloco)).toEqual(["operacional", "nao_classificado"]);
  });
});

describe("buildDreCascade — fixture reconciliação junho/2026 (Phase 87)", () => {
  it("Test 5: subtotais batem com a reconciliação provada no backend", () => {
    // Conjunto real de junho/2026 (87-01-SUMMARY.md):
    // excluido 139968 · pessoal 27852 · financeiro 20027 · operacional 15715 (dcr) ·
    // nao_classificado 7360 · impostos_venda 4793 · servicos 2103
    const rows: DreOperationalRow[] = [
      row("excluido", 139968),
      row("pessoal", 27852),
      row("financeiro", 20027),
      row("operacional", 15715, { category: "Cartão de crédito", double_count_risk: true }),
      row("nao_classificado", 7360, { category: "Outros" }),
      row("impostos_venda", 4793),
      row("servicos", 2103),
    ];
    const margem = 200000; // valor arbitrário — o teste foca nas deduções/financeiro
    const c = buildDreCascade(rows, margem);

    // Deduções operacionais: 27852 + 2103 + 15715 + 7360 = 53030 (estrutura ausente)
    expect(c.totalOperacionalDeducoes).toBe(53030);
    // Financeiro: 20027 (impostos_venda 4793 e excluido 139968 FORA)
    expect(c.totalFinanceiro).toBe(20027);
    // Guardrail: nenhum bloco operacional é impostos_venda/excluido
    expect(c.operacionalBlocos.map((b) => b.bloco)).toEqual([
      "pessoal",
      "servicos",
      "operacional",
      "nao_classificado",
    ]);
    // Subtotais derivados
    expect(c.resultadoOperacional).toBe(200000 - 53030); // 146970
    expect(c.resultadoLiquido).toBe(146970 - 20027); // 126943
    // OPERACIONAL_BLOCOS não contém impostos_venda/excluido/financeiro
    expect(OPERACIONAL_BLOCOS).not.toContain("impostos_venda");
    expect(OPERACIONAL_BLOCOS).not.toContain("excluido");
    expect(OPERACIONAL_BLOCOS).not.toContain("financeiro");
  });
});
