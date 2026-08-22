import { describe, expect, it } from "vitest";
import { IDADE_SALDO_LIMITE_DIAS, resolveConfiabilidadeSaldo } from "./saldoConfiabilidade";

const AGORA = new Date("2026-08-22T12:00:00Z");

function diasAtras(dias: number): string {
  const d = new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

describe("resolveConfiabilidadeSaldo", () => {
  it("ajuste de 2 dias atrás, com limite 30, devolve recente e não pede exibição", () => {
    const updatedAt = diasAtras(2);
    const r = resolveConfiabilidadeSaldo({
      updatedAt,
      createdAt: diasAtras(100),
      agora: AGORA,
    });
    expect(r.estado).toBe("recente");
    expect(r.idadeDias).toBe(2);
    expect(r.exibir).toBe(false);
  });

  it("ajuste de 39 dias atrás devolve envelhecido, exibição pedida, e frase com a idade e o significado", () => {
    const updatedAt = diasAtras(39);
    const r = resolveConfiabilidadeSaldo({
      updatedAt,
      createdAt: diasAtras(100),
      agora: AGORA,
    });
    expect(r.estado).toBe("envelhecido");
    expect(r.idadeDias).toBe(39);
    expect(r.exibir).toBe(true);
    expect(r.titulo).toMatch(/39/);
    expect(r.titulo).toMatch(/confer|valor rolado|sem conferência/i);
  });

  it("updated_at igual a created_at devolve nunca_carimbado — a linha existe mas nenhum ajuste registrou a própria data", () => {
    const mesmaData = diasAtras(50);
    const r = resolveConfiabilidadeSaldo({
      updatedAt: mesmaData,
      createdAt: mesmaData,
      agora: AGORA,
    });
    expect(r.estado).toBe("nunca_carimbado");
    expect(r.exibir).toBe(true);
    expect(r.titulo.length).toBeGreaterThan(0);
  });

  it("updated_at nulo devolve nao_medido com frase própria — jamais idade 0", () => {
    const r = resolveConfiabilidadeSaldo({
      updatedAt: null,
      createdAt: diasAtras(10),
      agora: AGORA,
    });
    expect(r.estado).toBe("nao_medido");
    expect(r.idadeDias).toBeNull();
    expect(r.idadeDias).not.toBe(0);
    expect(r.exibir).toBe(true);
  });

  it("updated_at ausente (undefined tratado como null) devolve nao_medido", () => {
    const r = resolveConfiabilidadeSaldo({
      updatedAt: null,
      createdAt: null,
      agora: AGORA,
    });
    expect(r.estado).toBe("nao_medido");
    expect(r.idadeDias).toBeNull();
  });

  it("data no futuro devolve nao_medido — relógio inconsistente, não 'ajuste feito amanhã'", () => {
    const futuro = new Date(AGORA.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const r = resolveConfiabilidadeSaldo({
      updatedAt: futuro,
      createdAt: diasAtras(10),
      agora: AGORA,
    });
    expect(r.estado).toBe("nao_medido");
    expect(r.idadeDias).toBeNull();
  });

  it("IDADE_SALDO_LIMITE_DIAS é 30", () => {
    expect(IDADE_SALDO_LIMITE_DIAS).toBe(30);
  });

  it("ajuste exatamente no limite (30 dias) ainda é recente; 31 já é envelhecido", () => {
    const noLimite = resolveConfiabilidadeSaldo({
      updatedAt: diasAtras(30),
      createdAt: diasAtras(100),
      agora: AGORA,
    });
    expect(noLimite.estado).toBe("recente");

    const acimaDoLimite = resolveConfiabilidadeSaldo({
      updatedAt: diasAtras(31),
      createdAt: diasAtras(100),
      agora: AGORA,
    });
    expect(acimaDoLimite.estado).toBe("envelhecido");
  });
});
