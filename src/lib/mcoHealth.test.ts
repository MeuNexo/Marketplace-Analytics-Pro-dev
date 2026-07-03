/**
 * Testes do helper puro de classificação de saúde do MCO% (semáforo).
 *
 * Cobre as bordas exatas dos cortes travados por Wesley (Phase 83):
 *   🔴 vermelho: MCO% <= 5 · 🟡 amarelo: 5 < MCO% < 9 · 🟢 verde: MCO% >= 9
 *   ⚪ indefinido: custo ausente (null/undefined)
 *
 * Phase: 83-produtos-vendidos-mco-redesign / Plan 01 (TDD RED → GREEN)
 */

import { describe, it, expect } from "vitest";
import { MCO_SAUDAVEL_PCT, classifyMcoHealth, mcoHealthRole } from "./mcoHealth";

describe("MCO_SAUDAVEL_PCT", () => {
  it("expõe os cortes red=5 e green=9", () => {
    expect(MCO_SAUDAVEL_PCT.red).toBe(5);
    expect(MCO_SAUDAVEL_PCT.green).toBe(9);
  });
});

describe("classifyMcoHealth", () => {
  it("classifica 4 como vermelho (< corte)", () => {
    expect(classifyMcoHealth(4)).toBe("vermelho");
  });

  it("classifica 5 como vermelho (borda: <=5)", () => {
    expect(classifyMcoHealth(5)).toBe("vermelho");
  });

  it("classifica 6 como amarelo", () => {
    expect(classifyMcoHealth(6)).toBe("amarelo");
  });

  it("classifica 8 como amarelo", () => {
    expect(classifyMcoHealth(8)).toBe("amarelo");
  });

  it("classifica 8.9 como amarelo (borda: <9)", () => {
    expect(classifyMcoHealth(8.9)).toBe("amarelo");
  });

  it("classifica 9 como verde (borda: >=9)", () => {
    expect(classifyMcoHealth(9)).toBe("verde");
  });

  it("classifica 12.3 como verde", () => {
    expect(classifyMcoHealth(12.3)).toBe("verde");
  });

  it("classifica null como indefinido (custo ausente)", () => {
    expect(classifyMcoHealth(null)).toBe("indefinido");
  });

  it("classifica undefined como indefinido (custo ausente)", () => {
    expect(classifyMcoHealth(undefined)).toBe("indefinido");
  });
});

describe("mcoHealthRole", () => {
  it("mapeia vermelho para critical", () => {
    expect(mcoHealthRole("vermelho")).toBe("critical");
  });

  it("mapeia amarelo para warning", () => {
    expect(mcoHealthRole("amarelo")).toBe("warning");
  });

  it("mapeia verde para good", () => {
    expect(mcoHealthRole("verde")).toBe("good");
  });

  it("mapeia indefinido para neutral", () => {
    expect(mcoHealthRole("indefinido")).toBe("neutral");
  });
});
