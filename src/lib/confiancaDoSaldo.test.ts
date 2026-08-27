// 233-02 — a confiança do saldo. O teste central é o dos estados nomeados:
// sem amostra a resposta é `nao_medido`, NUNCA 0% (que diria "erra tudo") nem
// 100% (que diria "é perfeita").
import { describe, expect, it } from "vitest";
import {
  HORIZONTE_MINIMO,
  confiancaDoSaldo,
  resumoDaConfianca,
  seloDeProvisorio,
} from "./confiancaDoSaldo";

const linha = (h: number, n: number, erro: number | null, conf: number | null) => ({
  horizon_days: h, n_pares: n, erro_pct: erro, confianca_pct: conf,
  primeiro_alvo: "2026-08-27", ultimo_alvo: "2026-08-27",
});

describe("confiancaDoSaldo", () => {
  it("converte a leitura REAL de 27/08 preservando os números", () => {
    // Medido contra o saldo declarado de R$ 37.430.
    const r = confiancaDoSaldo([
      linha(1, 1, 34.1, 65.9), linha(4, 1, 7.2, 92.8), linha(5, 1, 5.2, 94.8),
    ]);
    expect(r.map((p) => p.confianca_pct)).toEqual([65.9, 92.8, 94.8]);
    expect(r.every((p) => p.estado === "medido")).toBe(true);
  });

  it("🔴 sem par observado devolve `nao_medido` e null — nunca 0 nem 100", () => {
    const r = confiancaDoSaldo([linha(9, 0, null, null)]);
    expect(r[0].estado).toBe("nao_medido");
    expect(r[0].confianca_pct).toBeNull();
    expect(r[0].confianca_pct).not.toBe(0);
    expect(r[0].confianca_pct).not.toBe(100);
  });

  it("erro acima de 100% vira confiança ZERO, nunca negativa", () => {
    expect(confiancaDoSaldo([linha(3, 2, 150, -50)])[0].confianca_pct).toBe(0);
  });

  it("confiança acima de 100 é limitada a 100", () => {
    expect(confiancaDoSaldo([linha(3, 2, -5, 105)])[0].confianca_pct).toBe(100);
  });

  it("nunca lança: nulo, vazio e linha nula são estados, não exceções", () => {
    expect(confiancaDoSaldo(null)).toEqual([]);
    expect(confiancaDoSaldo(undefined)).toEqual([]);
    expect(confiancaDoSaldo([])).toEqual([]);
    // @ts-expect-error — entrada suja de propósito
    expect(() => confiancaDoSaldo([null, undefined])).not.toThrow();
  });

  it("ordena por horizonte, venha como vier do banco", () => {
    const r = confiancaDoSaldo([linha(6, 1, 14.8, 85.2), linha(1, 1, 34.1, 65.9)]);
    expect(r.map((p) => p.horizonte)).toEqual([1, 6]);
  });

  it("aceita número em string, como o PostgREST devolve numeric", () => {
    const r = confiancaDoSaldo([
      { horizon_days: "4", n_pares: "1", erro_pct: "7.2", confianca_pct: "92.8" },
    ]);
    expect(r[0].confianca_pct).toBe(92.8);
    expect(r[0].horizonte).toBe(4);
  });

  it("🔴 o horizonte ZERO fica fora por construção — a regra dos relógios", () => {
    // O cron roda às 04h e a declaração vem de tarde: o snapshot do próprio dia
    // foi congelado ANTES da correção, e compará-lo mediria a correção.
    expect(HORIZONTE_MINIMO).toBe(1);
  });
});

describe("resumoDaConfianca", () => {
  it("acha o melhor e o pior horizonte medido", () => {
    const r = resumoDaConfianca(confiancaDoSaldo([
      linha(1, 1, 34.1, 65.9), linha(5, 1, 5.2, 94.8), linha(2, 1, 50.3, 49.7),
    ]));
    expect(r.melhor?.horizonte).toBe(5);
    expect(r.pior?.horizonte).toBe(2);
    expect(r.n_horizontes_medidos).toBe(3);
    expect(r.total_pares).toBe(3);
  });

  it("sem nada medido devolve nulos, não zeros", () => {
    const r = resumoDaConfianca(confiancaDoSaldo([linha(9, 0, null, null)]));
    expect(r.melhor).toBeNull();
    expect(r.n_horizontes_medidos).toBe(0);
  });
});

describe("seloDeProvisorio", () => {
  it("🔴 diz a DIREÇÃO do viés, não só que é provisório", () => {
    const selo = seloDeProvisorio(6, 7);
    expect(selo).toContain("PIOR");
    expect(selo).toContain("subestima");
    expect(selo).toContain("6 pares observados");
  });

  it("some quando a amostra amadurece", () => {
    expect(seloDeProvisorio(20, 15)).toBeNull();
  });

  it("concorda em número no singular", () => {
    expect(seloDeProvisorio(1, 1)).toContain("1 par observado");
  });
});
