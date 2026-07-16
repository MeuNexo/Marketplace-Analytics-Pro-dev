// ============================================================================
// dreCloseGate.test.ts — Phase 96 Plan 02, Task 1 (TDD)
//
// Prova o SC4: o gate de apuração de imposto olha SÓ o `status` das 3 guias
// da competência M+1 — NUNCA o valor. R$0,01 pago = apurado, deu zero por
// crédito de Lucro Real (Wesley, 2026-07-15); NÃO é placeholder.
// O placeholder real é `status='pending'`, qualquer que seja o valor.
//
// resolveCloseGate combina esse gate de imposto com o gate de CMV cheio
// (gaps de custo faltante) e falha fechado (`blocked: true`) quando o dado
// ainda não chegou (gaps === null).
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  canApurarImposto,
  resolveCloseGate,
  type CmvCheioGap,
} from "./dreCloseGate";
import type { GuiaRealCategoryTotal } from "./dreRegime";

// Helper para montar uma linha de guia real.
function guia(category: string, total: number, status: string): GuiaRealCategoryTotal {
  return { category, total, status };
}

describe("canApurarImposto — o sinal é status, NUNCA o valor", () => {
  it("Test 1: maio PASSA — 3 guias pagas, duas em R$0,01 (crédito, não placeholder)", () => {
    const result = canApurarImposto([
      guia("Imposto Venda - ICMS", 4793.21, "paid"),
      guia("Imposto Venda - PIS", 0.01, "paid"),
      guia("Imposto Venda - COFINS", 0.01, "paid"),
    ]);
    expect(result).toEqual({ ok: true, missing: [], pending: [] });
  });

  it("Test 2: o placeholder real — 3 guias pending, valores ALTOS e mesmo assim rejeita", () => {
    const result = canApurarImposto([
      guia("Imposto Venda - ICMS", 12000, "pending"),
      guia("Imposto Venda - PIS", 716.19, "pending"),
      guia("Imposto Venda - COFINS", 3298.87, "pending"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.pending.sort()).toEqual(
      [
        "Imposto Venda - ICMS",
        "Imposto Venda - PIS",
        "Imposto Venda - COFINS",
      ].sort(),
    );
  });

  it("Test 3: categoria duplicada (RPC agrupa por categoria×status) — uma linha não-paga contamina a categoria inteira", () => {
    const result = canApurarImposto([
      guia("Imposto Venda - ICMS", 4000, "paid"),
      guia("Imposto Venda - ICMS", 793.21, "pending"),
      guia("Imposto Venda - PIS", 0.01, "paid"),
      guia("Imposto Venda - COFINS", 0.01, "paid"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.pending).toEqual(["Imposto Venda - ICMS"]);
  });

  it("Test 4: guia faltando (sem COFINS) → missing", () => {
    const result = canApurarImposto([
      guia("Imposto Venda - ICMS", 4793.21, "paid"),
      guia("Imposto Venda - PIS", 0.01, "paid"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["Imposto Venda - COFINS"]);
  });

  it("Test 5: null e [] → ok:false, missing com as 3 categorias, pending vazio", () => {
    const nullResult = canApurarImposto(null);
    expect(nullResult.ok).toBe(false);
    expect(nullResult.missing.sort()).toEqual(
      [
        "Imposto Venda - ICMS",
        "Imposto Venda - PIS",
        "Imposto Venda - COFINS",
      ].sort(),
    );
    expect(nullResult.pending).toEqual([]);

    const emptyResult = canApurarImposto([]);
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.missing.sort()).toEqual(
      [
        "Imposto Venda - ICMS",
        "Imposto Venda - PIS",
        "Imposto Venda - COFINS",
      ].sort(),
    );
    expect(emptyResult.pending).toEqual([]);
  });

  it("Test 6 (blindagem contra a regressão do C7): guia toda paga com todos os totais em 0.01 → ok:true", () => {
    const result = canApurarImposto([
      guia("Imposto Venda - ICMS", 0.01, "paid"),
      guia("Imposto Venda - PIS", 0.01, "paid"),
      guia("Imposto Venda - COFINS", 0.01, "paid"),
    ]);
    expect(result).toEqual({ ok: true, missing: [], pending: [] });
  });

  // ── Contas canceladas (Wesley 2026-07-16): crédito sem guia ────────────────

  it("Test 6a (junho/2026 real): ICMS pago + PIS/COFINS cancelados (crédito, dono cancelou no Tiny) → ok:true", () => {
    const result = canApurarImposto([
      guia("Imposto Venda - ICMS", 5151.56, "paid"),
      guia("Imposto Venda - PIS", 716.19, "cancelled"),
      guia("Imposto Venda - COFINS", 3298.87, "cancelled"),
    ]);
    expect(result).toEqual({ ok: true, missing: [], pending: [] });
  });

  it("Test 6b: cancelada NÃO mascara pendente — categoria com linha cancelled + linha pending continua bloqueando", () => {
    const result = canApurarImposto([
      guia("Imposto Venda - ICMS", 5151.56, "paid"),
      guia("Imposto Venda - PIS", 716.19, "cancelled"),
      guia("Imposto Venda - PIS", 500, "pending"),
      guia("Imposto Venda - COFINS", 3298.87, "cancelled"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.pending).toEqual(["Imposto Venda - PIS"]);
  });

  it("Test 6c: categoria SÓ com cancelada não vira missing — apuração aconteceu, deu crédito", () => {
    const result = canApurarImposto([
      guia("Imposto Venda - ICMS", 5151.56, "paid"),
      guia("Imposto Venda - PIS", 716.19, "cancelled"),
      guia("Imposto Venda - COFINS", 3298.87, "cancelled"),
    ]);
    expect(result.missing).toEqual([]);
  });

  it("Test 6d: categoria ausente continua bloqueando mesmo com as outras canceladas", () => {
    const result = canApurarImposto([
      guia("Imposto Venda - PIS", 716.19, "cancelled"),
      guia("Imposto Venda - COFINS", 3298.87, "cancelled"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["Imposto Venda - ICMS"]);
  });
});

describe("resolveCloseGate — combina o gate de imposto com o de CMV cheio", () => {
  const guiaPaga: GuiaRealCategoryTotal[] = [
    guia("Imposto Venda - ICMS", 4793.21, "paid"),
    guia("Imposto Venda - PIS", 0.01, "paid"),
    guia("Imposto Venda - COFINS", 0.01, "paid"),
  ];

  const guiaPendente: GuiaRealCategoryTotal[] = [
    guia("Imposto Venda - ICMS", 12000, "pending"),
    guia("Imposto Venda - PIS", 716.19, "pending"),
    guia("Imposto Venda - COFINS", 3298.87, "pending"),
  ];

  function gap(sku: string, receita: number): CmvCheioGap {
    return {
      sku,
      marca: null,
      linhas: 1,
      unidades: 1,
      receita,
      temCustoMedio: true,
    };
  }

  it("Test 7 (maio hoje): 39 gaps somando receita 23828.31 + guia toda paga → bloqueado só pelo CMV", () => {
    const gaps: CmvCheioGap[] = Array.from({ length: 38 }, (_, i) =>
      gap(`SKU-${i}`, 600),
    );
    gaps.push(gap("SKU-39", 23828.31 - 38 * 600));

    const result = resolveCloseGate({ gaps, guia: guiaPaga });

    expect(result.blocked).toBe(true);
    expect(result.skusFaltando).toBe(39);
    expect(result.receitaFaltando).toBe(23828.31);
    expect(result.reasons.length).toBe(1);
  });

  it("Test 8 (os dois motivos): gaps não-vazio + guia pendente → blocked, 2 motivos", () => {
    const result = resolveCloseGate({ gaps: [gap("SKU-1", 100)], guia: guiaPendente });
    expect(result.blocked).toBe(true);
    expect(result.reasons.length).toBe(2);
  });

  it("Test 9 (liberado): gaps vazio + guia toda paga → blocked:false, reasons vazio", () => {
    const result = resolveCloseGate({ gaps: [], guia: guiaPaga });
    expect(result.blocked).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("Test 10 (dado ainda carregando): gaps null → blocked:true (fail-closed)", () => {
    const result = resolveCloseGate({ gaps: null, guia: guiaPaga });
    expect(result.blocked).toBe(true);
  });
});
