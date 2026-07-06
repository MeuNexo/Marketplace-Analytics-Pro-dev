import { describe, it, expect } from "vitest";
import {
  buildCostComposition,
  monthLabel,
  OTHER_LABEL,
  type CostByMonthRow,
} from "./costCompositionData";

describe("monthLabel", () => {
  it('formata "2026-04" como "Abr/26"', () => {
    expect(monthLabel("2026-04")).toBe("Abr/26");
  });
  it('formata "2025-12" como "Dez/25"', () => {
    expect(monthLabel("2025-12")).toBe("Dez/25");
  });
});

const rows = (...r: [string, string, number][]): CostByMonthRow[] =>
  r.map(([month, category, total]) => ({ month, category, total }));

describe("buildCostComposition", () => {
  it("pivota long→wide com uma linha por mês, ordenada por _sort", () => {
    const { wideData } = buildCostComposition(
      rows(
        ["2026-02", "Fornecedores", 100],
        ["2026-01", "Fornecedores", 50],
        ["2026-01", "Salários", 30]
      )
    );
    expect(wideData.map((w) => w.month)).toEqual(["Jan/26", "Fev/26"]);
    expect(wideData[0]["Fornecedores"]).toBe(50);
    expect(wideData[0]["Salários"]).toBe(30);
    expect(wideData[1]["Fornecedores"]).toBe(100);
  });

  it("mantém as top-N por total desc e dobra a cauda em Outros", () => {
    // 8 categorias distintas, maxSeries=3 → 3 mantidas + Outros
    const { orderedCategories, wideData } = buildCostComposition(
      rows(
        ["2026-01", "A", 100],
        ["2026-01", "B", 90],
        ["2026-01", "C", 80],
        ["2026-01", "D", 10],
        ["2026-01", "E", 5],
        ["2026-01", "F", 3]
      ),
      3
    );
    expect(orderedCategories).toEqual(["A", "B", "C", OTHER_LABEL]);
    // Outros = D+E+F = 18
    expect(wideData[0][OTHER_LABEL]).toBe(18);
    expect(wideData[0]["A"]).toBe(100);
  });

  it("Outros é sempre a última categoria (topo da pilha)", () => {
    const { orderedCategories } = buildCostComposition(
      rows(
        ["2026-01", "Z", 1],
        ["2026-01", "A", 100],
        ["2026-01", "B", 90],
        ["2026-01", "C", 80],
        ["2026-01", "D", 70],
        ["2026-01", "E", 60],
        ["2026-01", "F", 50]
      ),
      6
    );
    expect(orderedCategories[orderedCategories.length - 1]).toBe(OTHER_LABEL);
    expect(orderedCategories).toHaveLength(7); // 6 mantidas + Outros
  });

  it('"Outros" literal do Tiny nunca ocupa uma slot de cor — sempre vai pro balde', () => {
    const { orderedCategories, wideData } = buildCostComposition(
      rows(
        ["2026-01", "Outros", 999], // grande, mas é catch-all
        ["2026-01", "A", 100],
        ["2026-01", "B", 90]
      ),
      6
    );
    // Outros não entra no ranking mesmo sendo o maior total
    expect(orderedCategories).toEqual(["A", "B", OTHER_LABEL]);
    expect(wideData[0][OTHER_LABEL]).toBe(999);
  });

  it("soma cauda + Outros literal no mesmo balde", () => {
    const { wideData } = buildCostComposition(
      rows(
        ["2026-01", "A", 100],
        ["2026-01", "B", 90],
        ["2026-01", "Outros", 7], // literal
        ["2026-01", "C", 3] // cauda (fora do top-2)
      ),
      2
    );
    // Outros = literal(7) + cauda C(3) = 10
    expect(wideData[0][OTHER_LABEL]).toBe(10);
  });

  it("sem cauda e sem Outros literal → nenhuma categoria Outros", () => {
    const { orderedCategories } = buildCostComposition(
      rows(["2026-01", "A", 100], ["2026-01", "B", 90]),
      6
    );
    expect(orderedCategories).toEqual(["A", "B"]);
    expect(orderedCategories).not.toContain(OTHER_LABEL);
  });

  it("lida com dataset vazio", () => {
    const { wideData, orderedCategories } = buildCostComposition([]);
    expect(wideData).toEqual([]);
    expect(orderedCategories).toEqual([]);
  });
});
