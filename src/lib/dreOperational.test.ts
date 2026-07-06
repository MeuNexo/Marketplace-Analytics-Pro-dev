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
  type DreOperationalRow,
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
