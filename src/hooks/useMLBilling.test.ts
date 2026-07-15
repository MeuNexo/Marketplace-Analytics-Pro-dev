// ============================================================================
// useMLBilling.test.ts — Phase 96 Plan 01, Task 1 (TDD)
// Testa groupBillingCharges (função pura) — blacklist do parcelamento (C2/C5).
// Fixtures de maio/2026, org Pé Vermeio, valores reconciliados no 96-CONTEXT.md.
// ============================================================================

import { describe, it, expect } from "vitest";
import { groupBillingCharges } from "./useMLBilling";

type Charge = { type: string; label: string; amount: number };

describe("groupBillingCharges — blacklist do parcelamento (C2/C5)", () => {
  it("Test 1 (a armadilha): BFONPN não pode cair em Cancelamentos — soma em parcelamento", () => {
    const charges: Charge[] = [
      { type: "CFONPN", label: "Parcelamento sem juros", amount: 12187.14 },
      { type: "BFONPN", label: "Estorno de parcelamento", amount: -1361.32 },
    ];

    const { groups } = groupBillingCharges(charges);

    const parcelamento = groups.find((g) => g.key === "parcelamento");
    const cancelamentos = groups.find((g) => g.key === "cancelamentos");

    expect(parcelamento?.amount).toBeCloseTo(10825.82, 2);
    expect(cancelamentos?.amount).toBe(0);
  });

  it("Test 2: grupo parcelamento vem com excluded:true; os demais sem a flag (ou false)", () => {
    const charges: Charge[] = [
      { type: "CFONPN", label: "Parcelamento sem juros", amount: 12187.14 },
      { type: "BFONPN", label: "Estorno de parcelamento", amount: -1361.32 },
      { type: "CVVML", label: "Tarifa de venda", amount: 1000 },
    ];

    const { groups } = groupBillingCharges(charges);

    const parcelamento = groups.find((g) => g.key === "parcelamento");
    expect(parcelamento?.excluded).toBe(true);

    const others = groups.filter((g) => g.key !== "parcelamento");
    expect(others.every((g) => !g.excluded)).toBe(true);
  });

  it("Test 3: totalTarifas NÃO inclui o valor do grupo parcelamento", () => {
    const charges: Charge[] = [
      { type: "CFONPN", label: "Parcelamento sem juros", amount: 12187.14 },
      { type: "BFONPN", label: "Estorno de parcelamento", amount: -1361.32 },
      { type: "CVVML", label: "Tarifa de venda", amount: 1000 },
    ];

    const { totalTarifas } = groupBillingCharges(charges);

    expect(totalTarifas).toBeCloseTo(1000, 2);
  });

  it("Test 4 (prova do SC2): fixture de maio 74.704,19 bruto por competência → totalTarifas === 63878.37", () => {
    const charges: Charge[] = [
      { type: "CVVML", label: "Tarifa de venda", amount: 34878.37 },
      { type: "CFFE", label: "Frete Full", amount: 20000 },
      { type: "PADS", label: "Publicidade", amount: 5000 },
      { type: "CDIFAL", label: "DIFAL", amount: 3000 },
      { type: "CESM", label: "Minha Página", amount: 1000 },
      { type: "CVAF", label: "Afiliados", amount: 500 },
      { type: "BVVML", label: "Cancelamento tarifa de venda", amount: -500 },
      { type: "CFONPN", label: "Parcelamento sem juros", amount: 12187.14 },
      { type: "BFONPN", label: "Estorno de parcelamento", amount: -1361.32 },
    ];

    const grossSum = charges.reduce((s, c) => s + c.amount, 0);
    expect(grossSum).toBeCloseTo(74704.19, 2);

    const { totalTarifas } = groupBillingCharges(charges);

    expect(totalTarifas).toBeCloseTo(63878.37, 2);
  });

  it("Test 5 (não-regressão): demais B* continuam somando em cancelamentos e dentro de totalTarifas", () => {
    const charges: Charge[] = [
      { type: "BVVML", label: "Cancelamento tarifa de venda", amount: -500 },
      { type: "BFFE", label: "Cancelamento frete Full", amount: -200 },
    ];

    const { groups, totalTarifas } = groupBillingCharges(charges);

    const cancelamentos = groups.find((g) => g.key === "cancelamentos");
    expect(cancelamentos?.amount).toBeCloseTo(-700, 2);
    expect(totalTarifas).toBeCloseTo(-700, 2);
  });

  it("Test 6 (não-regressão): CESM e CDSDB continuam no bucket afiliados_outras e dentro de totalTarifas", () => {
    const charges: Charge[] = [
      { type: "CESM", label: "Minha Página", amount: 300 },
      { type: "CDSDB", label: "Devolução", amount: 150 },
    ];

    const { groups, totalTarifas } = groupBillingCharges(charges);

    const afiliadosOutras = groups.find((g) => g.key === "afiliados_outras");
    expect(afiliadosOutras?.amount).toBeCloseTo(450, 2);
    expect(totalTarifas).toBeCloseTo(450, 2);
  });
});
