import { describe, expect, it } from "vitest";
import {
  FAIXA_REFERENCIA_VAREJO,
  MESES_NA_JANELA_DO_BURN,
  resolveDiasDeCaixa,
  saidaDiariaDeBurnRate,
} from "./diasDeCaixa";

describe("saidaDiariaDeBurnRate", () => {
  it("divide o burn mensal por 30, nunca por 3 (o burn da RPC já é mensal)", () => {
    // get_treasury_panel soma 90 dias e divide por 3 — já entrega média MENSAL.
    expect(saidaDiariaDeBurnRate(21879.54)).toBeCloseTo(729.318, 3);
  });

  it("burn nulo devolve null", () => {
    expect(saidaDiariaDeBurnRate(null)).toBeNull();
  });

  it("burn zero devolve null — ausência, não zero dividido", () => {
    expect(saidaDiariaDeBurnRate(0)).toBeNull();
  });
});

describe("resolveDiasDeCaixa", () => {
  it("saldo 14650.34 e burn mensal 21879.54 medem ~2,0 dias", () => {
    const r = resolveDiasDeCaixa({ saldo: 14650.34, burnMensal: 21879.54 });
    expect(r.estado).toBe("medido");
    expect(r.dias).toBeCloseTo(20.09, 1); // 14650.34 / 729.318
    expect(r.saidaDiaria).toBeCloseTo(729.318, 3);
    expect(r.saldo).toBe(14650.34);
    expect(r.titulo).toMatch(/90 dias/);
    expect(r.titulo).toMatch(/zero entrada|nenhuma entrada/);
  });

  it("burn mensal nulo devolve sem_saida_medida, dias null, e nomeia o motivo — nunca dias 0", () => {
    const r = resolveDiasDeCaixa({ saldo: 14650.34, burnMensal: null });
    expect(r.estado).toBe("sem_saida_medida");
    expect(r.dias).toBeNull();
    expect(r.dias).not.toBe(0);
    expect(r.titulo.length).toBeGreaterThan(0);
  });

  it("burn mensal zero devolve o mesmo estado de ausência — nunca divisão por zero nem Infinity", () => {
    const r = resolveDiasDeCaixa({ saldo: 14650.34, burnMensal: 0 });
    expect(r.estado).toBe("sem_saida_medida");
    expect(r.dias).toBeNull();
    expect(Number.isFinite(r.dias as number)).toBe(false); // null não é finito nem Infinity
    expect(r.dias).not.toBe(Infinity);
  });

  it("saldo negativo devolve caixa_negativo com dias null — 'menos dois dias' não existe", () => {
    const r = resolveDiasDeCaixa({ saldo: -500, burnMensal: 21879.54 });
    expect(r.estado).toBe("caixa_negativo");
    expect(r.dias).toBeNull();
  });

  it("saldo zero com burn positivo devolve dias 0 — zero aqui é medição, não ausência", () => {
    const r = resolveDiasDeCaixa({ saldo: 0, burnMensal: 21879.54 });
    expect(r.estado).toBe("medido");
    expect(r.dias).toBe(0);
  });

  it("saldo nulo devolve sem_saida_medida-like ausência nomeada, nunca dias 0", () => {
    const r = resolveDiasDeCaixa({ saldo: null, burnMensal: 21879.54 });
    expect(r.dias).toBeNull();
    expect(r.estado).not.toBe("medido");
    expect(r.titulo.length).toBeGreaterThan(0);
  });
});

describe("constantes declaradas", () => {
  it("MESES_NA_JANELA_DO_BURN é 3 — a janela do burn_rate da RPC", () => {
    expect(MESES_NA_JANELA_DO_BURN).toBe(3);
  });

  it("FAIXA_REFERENCIA_VAREJO declara 60-180 dias, referência de literatura", () => {
    expect(FAIXA_REFERENCIA_VAREJO.minimo).toBe(60);
    expect(FAIXA_REFERENCIA_VAREJO.maximo).toBe(180);
  });
});
