// ============================================================================
// snapshotRows.test.ts — TDD RED antes de snapshotRows.ts existir com
// implementação real. Cobre cada item do <behavior> do plano 224-06.
// ============================================================================
import { describe, it, expect } from "vitest";
import { montarLinhasDeSnapshot, FONTES_DE_SNAPSHOT } from "./snapshotRows.ts";

const ORG = "7f615df7-7bac-45e5-8a93-827fb9ddeec7";
const SNAPSHOT_DATE = "2026-08-21";

/** Constrói uma linha crua no formato devolvido por get_cashflow. */
function linhaRpc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    date: "2026-08-22",
    daily_income: 1000,
    daily_expense: 200,
    daily_projection: 50,
    daily_balance: 800,
    accumulated_balance: 5000,
    accumulated_balance_sma: 5050,
    ...overrides,
  };
}

describe("montarLinhasDeSnapshot", () => {
  it("gera quatro linhas por dia, uma por fonte gravada, na ordem de FONTES_DE_SNAPSHOT", () => {
    const { linhas } = montarLinhasDeSnapshot(ORG, SNAPSHOT_DATE, [linhaRpc()], 0.95);
    expect(linhas).toHaveLength(4);
    expect(linhas.map((l) => l.fonte)).toEqual([...FONTES_DE_SNAPSHOT]);
  });

  it("FONTES_DE_SNAPSHOT tem exatamente as quatro fontes gravadas, nesta ordem", () => {
    expect(FONTES_DE_SNAPSHOT).toEqual([
      "mercado_pago",
      "faturamento_medio",
      "saida_prevista",
      "saldo_projetado",
    ]);
  });

  it("dia com valor zero é emitido, nunca omitido", () => {
    const { linhas } = montarLinhasDeSnapshot(
      ORG,
      SNAPSHOT_DATE,
      [linhaRpc({ daily_income: 0, daily_expense: 0, daily_projection: 0, accumulated_balance: 0 })],
      null,
    );
    expect(linhas).toHaveLength(4);
    for (const l of linhas) expect(l.valor_previsto).toBe(0);
  });

  it("linha cuja data-alvo é anterior à data do snapshot é descartada", () => {
    const { linhas } = montarLinhasDeSnapshot(
      ORG,
      SNAPSHOT_DATE,
      [linhaRpc({ date: "2026-08-20" })],
      null,
    );
    expect(linhas).toHaveLength(0);
  });

  it("data-alvo igual à data do snapshot (horizonte zero) É mantida", () => {
    const { linhas } = montarLinhasDeSnapshot(
      ORG,
      SNAPSHOT_DATE,
      [linhaRpc({ date: SNAPSHOT_DATE })],
      null,
    );
    expect(linhas).toHaveLength(4);
  });

  it("a coluna de horizonte não é incluída na saída", () => {
    const { linhas } = montarLinhasDeSnapshot(ORG, SNAPSHOT_DATE, [linhaRpc()], null);
    for (const l of linhas) {
      expect(l).not.toHaveProperty("horizon_days");
    }
  });

  it("o deflator é propagado igual em todas as linhas", () => {
    const { linhas } = montarLinhasDeSnapshot(ORG, SNAPSHOT_DATE, [linhaRpc()], 0.87);
    for (const l of linhas) expect(l.deflator).toBe(0.87);
  });

  it("deflator nulo permanece nulo em todas as linhas, nunca vira 1.00", () => {
    const { linhas } = montarLinhasDeSnapshot(ORG, SNAPSHOT_DATE, [linhaRpc()], null);
    for (const l of linhas) expect(l.deflator).toBeNull();
  });

  it("valores são arredondados a duas casas", () => {
    const { linhas } = montarLinhasDeSnapshot(
      ORG,
      SNAPSHOT_DATE,
      [linhaRpc({ daily_income: 1000.4567 })],
      null,
    );
    const mp = linhas.find((l) => l.fonte === "mercado_pago");
    expect(mp?.valor_previsto).toBe(1000.46);
  });

  it("mapeia cada fonte para o campo certo da RPC", () => {
    const { linhas } = montarLinhasDeSnapshot(
      ORG,
      SNAPSHOT_DATE,
      [
        linhaRpc({
          daily_income: 111,
          daily_projection: 222,
          daily_expense: 333,
          accumulated_balance: 444,
        }),
      ],
      null,
    );
    const porFonte = Object.fromEntries(linhas.map((l) => [l.fonte, l.valor_previsto]));
    expect(porFonte.mercado_pago).toBe(111);
    expect(porFonte.faturamento_medio).toBe(222);
    expect(porFonte.saida_prevista).toBe(333);
    expect(porFonte.saldo_projetado).toBe(444);
  });

  it("data de snapshot fora do formato AAAA-MM-DD lança erro com a data no texto", () => {
    expect(() => montarLinhasDeSnapshot(ORG, "21/08/2026", [linhaRpc()], null)).toThrowError(
      /21\/08\/2026/,
    );
  });

  it("lista de linhas vazia devolve lista vazia, nunca lança", () => {
    const { linhas, valoresInvalidos } = montarLinhasDeSnapshot(ORG, SNAPSHOT_DATE, [], null);
    expect(linhas).toEqual([]);
    expect(valoresInvalidos).toBe(0);
  });

  it("lista de linhas nula devolve lista vazia, nunca lança", () => {
    const { linhas } = montarLinhasDeSnapshot(ORG, SNAPSHOT_DATE, null as unknown as [], null);
    expect(linhas).toEqual([]);
  });

  it("lista de linhas indefinida devolve lista vazia, nunca lança", () => {
    const { linhas } = montarLinhasDeSnapshot(ORG, SNAPSHOT_DATE, undefined, null);
    expect(linhas).toEqual([]);
  });

  it("valor ausente numa linha da RPC vira zero e é contado em valoresInvalidos", () => {
    const { linhas, valoresInvalidos } = montarLinhasDeSnapshot(
      ORG,
      SNAPSHOT_DATE,
      [linhaRpc({ daily_income: null })],
      null,
    );
    const mp = linhas.find((l) => l.fonte === "mercado_pago");
    expect(mp?.valor_previsto).toBe(0);
    expect(valoresInvalidos).toBe(1);
  });

  it("valor não numérico numa linha da RPC vira zero e é contado em valoresInvalidos", () => {
    const { linhas, valoresInvalidos } = montarLinhasDeSnapshot(
      ORG,
      SNAPSHOT_DATE,
      [linhaRpc({ daily_expense: "não é número" })],
      null,
    );
    const sp = linhas.find((l) => l.fonte === "saida_prevista");
    expect(sp?.valor_previsto).toBe(0);
    expect(valoresInvalidos).toBe(1);
  });

  it("todas as linhas trazem organization_id e snapshot_date corretos", () => {
    const { linhas } = montarLinhasDeSnapshot(ORG, SNAPSHOT_DATE, [linhaRpc()], null);
    for (const l of linhas) {
      expect(l.organization_id).toBe(ORG);
      expect(l.snapshot_date).toBe(SNAPSHOT_DATE);
      expect(l.target_date).toBe("2026-08-22");
    }
  });
});
