// ============================================================================
// dreOperational.test — pure-function coverage for the resultado-líquido math.
//
// No RPC/supabase reference here — this tests only the pure module.
// Phase: 88-dre-frontend-resultado-completo-vendas / Plan 01
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  aggregateOperationalBlocks,
  computeResultadoLiquido,
  evaluateGuiaReal,
  resolveTaxAndCmv,
  type DreOperationalRow,
  type ImpostoGuiaRow,
} from "./dreOperational";

function row(partial: Partial<DreOperationalRow>): DreOperationalRow {
  return {
    bloco: "pessoal",
    category: "Salários",
    total: 0,
    n: 1,
    financeiro_is_approximate: false,
    ...partial,
  };
}

function guiaRow(partial: Partial<ImpostoGuiaRow>): ImpostoGuiaRow {
  return {
    category: "Imposto Venda - ICMS/PIS/COFINS",
    total: 0,
    status: "paid",
    ...partial,
  };
}

// June/2026 validated fixture (project memory: reconciles to ≈ −R$29.094):
// margem +20.888 − pessoal 27.852 − financeiro 20.027 − serviços 1.953 − outros 150
const JUNE_ROWS: DreOperationalRow[] = [
  row({ bloco: "pessoal", category: "Salários", total: 27852 }),
  row({ bloco: "financeiro", category: "Empréstimo", total: 20027, financeiro_is_approximate: true }),
  row({ bloco: "servicos", category: "Contabilidade", total: 1953 }),
  row({ bloco: "outros_operacionais", category: "Outros", total: 150 }),
  // estrutura: no row this month — must default to 0
];
const JUNE_MARGEM = 20888;

describe("aggregateOperationalBlocks", () => {
  it("sums total per allow-listed bloco, defaulting missing blocos to 0", () => {
    const blocks = aggregateOperationalBlocks(JUNE_ROWS);
    expect(blocks.pessoal).toBe(27852);
    expect(blocks.estrutura).toBe(0);
    expect(blocks.servicos).toBe(1953);
    expect(blocks.outros_operacionais).toBe(150);
    expect(blocks.financeiro).toBe(20027);
  });

  it("excludes impostos_venda and excluido rows from every sum (allow-list proof)", () => {
    const rowsWithNoise: DreOperationalRow[] = [
      ...JUNE_ROWS,
      row({ bloco: "impostos_venda", category: "ICMS", total: 53000 }),
      row({ bloco: "excluido", category: "Fornecedores", total: 9000 }),
    ];
    const baseline = aggregateOperationalBlocks(JUNE_ROWS);
    const withNoise = aggregateOperationalBlocks(rowsWithNoise);
    expect(withNoise).toEqual(baseline);
  });

  it("derives financeiro_is_approximate via .some() over financeiro rows, false when no financeiro rows exist", () => {
    const approx = aggregateOperationalBlocks([
      row({ bloco: "financeiro", category: "Empréstimo", total: 100, financeiro_is_approximate: true }),
    ]);
    expect(approx.financeiro_is_approximate).toBe(true);

    const notApprox = aggregateOperationalBlocks([
      row({ bloco: "financeiro", category: "Empréstimo", total: 100, financeiro_is_approximate: false }),
    ]);
    expect(notApprox.financeiro_is_approximate).toBe(false);

    const noFinanceiro = aggregateOperationalBlocks([
      row({ bloco: "pessoal", category: "Salários", total: 100 }),
    ]);
    expect(noFinanceiro.financeiro_is_approximate).toBe(false);
  });

  it("derives financeiro_is_approximate per-bloco (.some), not from an arbitrary row/.find", () => {
    // If a future category is added to financeiro and only the SECOND row is approximate,
    // .some() must still catch it — proves intent-based derivation, not incidental row order.
    const blocks = aggregateOperationalBlocks([
      row({ bloco: "financeiro", category: "Empréstimo", total: 100, financeiro_is_approximate: false }),
      row({ bloco: "financeiro", category: "Juros diversos", total: 50, financeiro_is_approximate: true }),
    ]);
    expect(blocks.financeiro_is_approximate).toBe(true);
    expect(blocks.financeiro).toBe(150);
  });
});

describe("computeResultadoLiquido", () => {
  it("computes resultadoOperacional and resultadoLiquido from margem + blocks", () => {
    const blocks = aggregateOperationalBlocks(JUNE_ROWS);
    const { resultadoOperacional, resultadoLiquido } = computeResultadoLiquido(JUNE_MARGEM, blocks);
    // resultadoOperacional = 20888 - 27852 - 0 - 1953 - 150 = -9067
    expect(resultadoOperacional).toBe(-9067);
    // resultadoLiquido = -9067 - 20027 = -29094
    expect(resultadoLiquido).toBe(-29094);
  });

  it("June/2026 fixture: resultadoLiquido reconciles to ≈ −R$29.094", () => {
    const blocks = aggregateOperationalBlocks(JUNE_ROWS);
    const { resultadoLiquido } = computeResultadoLiquido(JUNE_MARGEM, blocks);
    expect(Math.round(resultadoLiquido)).toBe(-29094);
    expect(Math.abs(resultadoLiquido - -29094)).toBeLessThanOrEqual(1);
  });

  it("exclusion proof: adding impostos_venda/excluido rows to the June fixture does not change resultadoLiquido", () => {
    const rowsWithNoise: DreOperationalRow[] = [
      ...JUNE_ROWS,
      row({ bloco: "impostos_venda", category: "ICMS", total: 53000 }),
      row({ bloco: "excluido", category: "Fornecedores", total: 9000 }),
    ];
    const cleanBlocks = aggregateOperationalBlocks(JUNE_ROWS);
    const noisyBlocks = aggregateOperationalBlocks(rowsWithNoise);
    const clean = computeResultadoLiquido(JUNE_MARGEM, cleanBlocks);
    const noisy = computeResultadoLiquido(JUNE_MARGEM, noisyBlocks);
    expect(noisy.resultadoLiquido).toBe(clean.resultadoLiquido);
    expect(Math.round(noisy.resultadoLiquido)).toBe(-29094);
  });
});

// ============================================================================
// evaluateGuiaReal + resolveTaxAndCmv — Phase 90 / Plan 03
// Fixtures reais de 90-DATA-FINDINGS.md: Maio (real), Junho (placeholder),
// Jul (previsão/pending).
// ============================================================================

describe("evaluateGuiaReal", () => {
  it("linhas vazias → não real", () => {
    expect(evaluateGuiaReal([])).toEqual({ hasGuiaReal: false, totalReal: 0 });
  });

  it("Maio: ICMS 12000 + PIS 716.19 + COFINS 3298.87, todas paid > R$1 → real, total 16015.06", () => {
    const rows = [
      guiaRow({ category: "ICMS", total: 12000 }),
      guiaRow({ category: "PIS", total: 716.19 }),
      guiaRow({ category: "COFINS", total: 3298.87 }),
    ];
    const result = evaluateGuiaReal(rows);
    expect(result.hasGuiaReal).toBe(true);
    expect(Math.round(result.totalReal * 100) / 100).toBe(16015.06);
  });

  it("Junho: ICMS 4793.21 paid + PIS 0.01 paid + COFINS 0.01 paid → placeholder reprova (não real)", () => {
    const rows = [
      guiaRow({ category: "ICMS", total: 4793.21 }),
      guiaRow({ category: "PIS", total: 0.01 }),
      guiaRow({ category: "COFINS", total: 0.01 }),
    ];
    expect(evaluateGuiaReal(rows)).toEqual({ hasGuiaReal: false, totalReal: 0 });
  });

  it("Jul: 3 linhas pending de 16015.06 (previsão) → nenhuma paid → não real", () => {
    const rows = [
      guiaRow({ category: "ICMS", total: 12000, status: "pending" }),
      guiaRow({ category: "PIS", total: 716.19, status: "pending" }),
      guiaRow({ category: "COFINS", total: 3298.87, status: "pending" }),
    ];
    expect(evaluateGuiaReal(rows)).toEqual({ hasGuiaReal: false, totalReal: 0 });
  });

  it("mistura paid + pending na mesma competência → considera só paid", () => {
    const rows = [
      guiaRow({ category: "ICMS", total: 12000, status: "paid" }),
      guiaRow({ category: "PIS", total: 716.19, status: "paid" }),
      guiaRow({ category: "COFINS", total: 3298.87, status: "pending" }), // ignorada
    ];
    const result = evaluateGuiaReal(rows);
    expect(result.hasGuiaReal).toBe(true);
    expect(Math.round(result.totalReal * 100) / 100).toBe(12716.19);
  });

  it("histórico com 2 categorias (ICMS+PIS, ambas paid > R$1) → real", () => {
    const rows = [
      guiaRow({ category: "ICMS", total: 17000, status: "paid" }),
      guiaRow({ category: "PIS", total: 740.79, status: "paid" }),
    ];
    const result = evaluateGuiaReal(rows);
    expect(result.hasGuiaReal).toBe(true);
    expect(Math.round(result.totalReal * 100) / 100).toBe(17740.79);
  });
});

describe("resolveTaxAndCmv", () => {
  const guiaAberta = { hasGuiaReal: false, totalReal: 0 };
  const guiaFechadaMaio = { hasGuiaReal: true, totalReal: 16015.06 };

  it("aberto, has_tax_data true → impostosMes = estimatedTax, fonte provisao", () => {
    const result = resolveTaxAndCmv({
      estimatedTax: 5000,
      hasTaxData: true,
      custoMedio: 140607.33,
      hasCmv: true,
      cmvCheio: null,
      hasCmvCheio: false,
      guia: guiaAberta,
    });
    expect(result.impostosMes).toBe(5000);
    expect(result.impostoFonte).toBe("provisao");
  });

  it("aberto, has_tax_data false → impostosMes null", () => {
    const result = resolveTaxAndCmv({
      estimatedTax: 5000,
      hasTaxData: false,
      custoMedio: null,
      hasCmv: false,
      cmvCheio: null,
      hasCmvCheio: false,
      guia: guiaAberta,
    });
    expect(result.impostosMes).toBeNull();
  });

  it("aberto, has_cmv true → cmvMes = custoMedio, fonte medio", () => {
    const result = resolveTaxAndCmv({
      estimatedTax: null,
      hasTaxData: false,
      custoMedio: 140607.33,
      hasCmv: true,
      cmvCheio: null,
      hasCmvCheio: false,
      guia: guiaAberta,
    });
    expect(result.cmvMes).toBe(140607.33);
    expect(result.cmvFonte).toBe("medio");
  });

  it("aberto, has_cmv false → cmvMes null", () => {
    const result = resolveTaxAndCmv({
      estimatedTax: null,
      hasTaxData: false,
      custoMedio: null,
      hasCmv: false,
      cmvCheio: null,
      hasCmvCheio: false,
      guia: guiaAberta,
    });
    expect(result.cmvMes).toBeNull();
  });

  it("fechado → impostosMes = totalReal da guia, fonte real (ignora estimatedTax)", () => {
    const result = resolveTaxAndCmv({
      estimatedTax: 999999,
      hasTaxData: true,
      custoMedio: 140607.33,
      hasCmv: true,
      cmvCheio: 168486.68,
      hasCmvCheio: true,
      guia: guiaFechadaMaio,
    });
    expect(result.impostosMes).toBe(16015.06);
    expect(result.impostoFonte).toBe("real");
  });

  it("fechado, has_cmv_cheio true → cmvMes = cmvCheio, fonte cheio", () => {
    const result = resolveTaxAndCmv({
      estimatedTax: null,
      hasTaxData: false,
      custoMedio: 140607.33,
      hasCmv: true,
      cmvCheio: 168486.68,
      hasCmvCheio: true,
      guia: guiaFechadaMaio,
    });
    expect(result.cmvMes).toBe(168486.68);
    expect(result.cmvFonte).toBe("cheio");
  });

  it("fechado, has_cmv_cheio false + has_cmv true → cmvMes = custoMedio, fonte medio_fallback", () => {
    const result = resolveTaxAndCmv({
      estimatedTax: null,
      hasTaxData: false,
      custoMedio: 140607.33,
      hasCmv: true,
      cmvCheio: null,
      hasCmvCheio: false,
      guia: guiaFechadaMaio,
    });
    expect(result.cmvMes).toBe(140607.33);
    expect(result.cmvFonte).toBe("medio_fallback");
  });

  it("fechado, ambos cmv ausentes → cmvMes null, fonte medio_fallback", () => {
    const result = resolveTaxAndCmv({
      estimatedTax: null,
      hasTaxData: false,
      custoMedio: null,
      hasCmv: false,
      cmvCheio: null,
      hasCmvCheio: false,
      guia: guiaFechadaMaio,
    });
    expect(result.cmvMes).toBeNull();
    expect(result.cmvFonte).toBe("medio_fallback");
  });

  it("ZERO-REGRESSÃO: mês aberto devolve exatamente o par legado (has_tax_data ? total_tax : null, has_cmv ? cmv : null)", () => {
    const cenarios = [
      { total_tax: 5432.1, has_tax_data: true, cmv: 140607.33, has_cmv: true },
      { total_tax: 0, has_tax_data: false, cmv: 0, has_cmv: false },
      { total_tax: 12000, has_tax_data: true, cmv: 0, has_cmv: false },
      { total_tax: 0, has_tax_data: false, cmv: 99999.99, has_cmv: true },
    ];

    for (const c of cenarios) {
      // Expressões LEGADAS de MercadoLivre.tsx (linhas 258-260):
      const legacyCmvMes = (c.has_cmv ? c.cmv : null) ?? null;
      const legacyImpostosMes = (c.has_tax_data ? c.total_tax : null) ?? null;

      const result = resolveTaxAndCmv({
        estimatedTax: c.total_tax,
        hasTaxData: c.has_tax_data,
        custoMedio: c.cmv,
        hasCmv: c.has_cmv,
        cmvCheio: null,
        hasCmvCheio: false,
        guia: guiaAberta,
      });

      expect(result.impostosMes).toBe(legacyImpostosMes);
      expect(result.cmvMes).toBe(legacyCmvMes);
    }
  });
});
