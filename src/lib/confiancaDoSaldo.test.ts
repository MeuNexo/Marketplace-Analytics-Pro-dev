// 233-02 — a confiança do saldo. O teste central é o dos estados nomeados:
// sem amostra a resposta é `nao_medido`, NUNCA 0% (que diria "erra tudo") nem
// 100% (que diria "é perfeita").
import { describe, expect, it } from "vitest";
import {
  HORIZONTE_MINIMO,
  confiancaDoSaldo,
  resumoDaConfianca,
  preencherFaixa,
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

// ============================================================================
// 233-04 — o horizonte INTEIRO, com o motivo da ausência e a data em que abre
//
// 🔴 O defeito que estes testes travam: a RPC só emitia horizonte COM par, e a
// tela descartava o resto. Somados, os dois produziam a afirmação que ninguém
// escreveu — *"o sistema só sabe prever 6 dias"*. É falsa: a série de snapshots
// começou em 21/08 e D+7 só fica medível em 28/08.
// ============================================================================

const linhaComMotivo = (
  h: number,
  motivo: "serie_curta" | "sem_declaracao" | "sem_serie",
  medivel: string | null,
) => ({
  horizon_days: h,
  n_pares: 0,
  erro_pct: null,
  confianca_pct: null,
  primeiro_alvo: null,
  ultimo_alvo: null,
  motivo_ausencia: motivo,
  medivel_em: medivel,
});

describe("233-04 — os três motivos de ausência viram estado nomeado", () => {
  it("🔴 idade da série: `serie_curta` carrega a data em que o horizonte abre", () => {
    // A série de `saldo_projetado` começou em 2026-08-21: D+7 abre em 28/08.
    const r = confiancaDoSaldo([linhaComMotivo(7, "serie_curta", "2026-08-28")]);
    expect(r[0].estado).toBe("serie_curta");
    expect(r[0].medivel_em).toBe("2026-08-28");
    expect(r[0].confianca_pct).toBeNull();
    expect(r[0].erro_pct).toBeNull();
  });

  it("🔴 falta de declaração: `sem_declaracao` NÃO tem data — esperar não resolve", () => {
    const r = confiancaDoSaldo([linhaComMotivo(3, "sem_declaracao", null)]);
    expect(r[0].estado).toBe("sem_declaracao");
    expect(r[0].medivel_em).toBeNull();
  });

  it("organização sem nenhum snapshot: `sem_serie` em toda a faixa", () => {
    const r = confiancaDoSaldo([linhaComMotivo(1, "sem_serie", null), linhaComMotivo(2, "sem_serie", null)]);
    expect(r.map((p) => p.estado)).toEqual(["sem_serie", "sem_serie"]);
    expect(r.every((p) => p.medivel_em === null)).toBe(true);
  });

  it("🔴 as duas escassezes são estados DIFERENTES — confundi-las faz a tela mentir", () => {
    const r = confiancaDoSaldo([
      linhaComMotivo(7, "serie_curta", "2026-08-28"),
      linhaComMotivo(3, "sem_declaracao", null),
    ]);
    expect(r[0].estado).not.toBe(r[1].estado);
  });

  it("horizonte COM par ignora motivo e continua `medido`, sem `medivel_em`", () => {
    const r = confiancaDoSaldo([
      { ...linha(4, 1, 7.2, 92.8), motivo_ausencia: null, medivel_em: null },
    ]);
    expect(r[0].estado).toBe("medido");
    expect(r[0].confianca_pct).toBe(92.8);
    expect(r[0].medivel_em).toBeNull();
  });

  it("motivo desconhecido não vira estado inventado — cai em `nao_medido`", () => {
    const r = confiancaDoSaldo([
      // @ts-expect-error — motivo fora do contrato, de propósito
      { ...linha(9, 0, null, null), motivo_ausencia: "banana", medivel_em: null },
    ]);
    expect(r[0].estado).toBe("nao_medido");
  });
});

describe("🔴 PORTÃO — preencherFaixa devolve a faixa INTEIRA, para qualquer entrada", () => {
  const FAIXA_MIN = 1;
  const FAIXA_MAX = 30;

  /**
   * Por PROPRIEDADE, não pelos seis horizontes de hoje: a tela nunca mais pode
   * receber só o que existe. Se a RPC regredir e voltar a omitir horizonte, o
   * ponto volta como `nao_medido` — some, nunca.
   */
  it("qualquer subconjunto da faixa sai com o tamanho exato da faixa", () => {
    const recortes: number[][] = [
      [],
      [1],
      [1, 2, 3, 4, 5, 6],
      [30],
      [2, 17, 29],
      Array.from({ length: 30 }, (_, i) => i + 1),
      [5, 5, 5], // repetido de propósito
    ];

    for (const recorte of recortes) {
      const pontos = confiancaDoSaldo(recorte.map((h) => linha(h, 1, 7.2, 92.8)));
      const cheia = preencherFaixa(pontos, FAIXA_MIN, FAIXA_MAX);

      expect(cheia).toHaveLength(FAIXA_MAX - FAIXA_MIN + 1);
      expect(cheia.map((p) => p.horizonte)).toEqual(
        Array.from({ length: FAIXA_MAX - FAIXA_MIN + 1 }, (_, i) => i + FAIXA_MIN),
      );
    }
  });

  it("o que a RPC omitiu volta como `nao_medido` — nunca 0%, nunca 100%", () => {
    const cheia = preencherFaixa(confiancaDoSaldo([linha(1, 1, 34.1, 65.9)]), 1, 5);
    const ausentes = cheia.filter((p) => p.horizonte > 1);
    expect(ausentes).toHaveLength(4);
    expect(ausentes.every((p) => p.estado === "nao_medido")).toBe(true);
    expect(ausentes.every((p) => p.confianca_pct === null)).toBe(true);
    expect(ausentes.every((p) => p.n_pares === 0)).toBe(true);
  });

  it("preserva o ponto medido e o motivo que a RPC já trouxe", () => {
    const cheia = preencherFaixa(
      confiancaDoSaldo([linha(2, 1, 5.2, 94.8), linhaComMotivo(4, "serie_curta", "2026-08-28")]),
      1,
      4,
    );
    expect(cheia.map((p) => p.estado)).toEqual([
      "nao_medido", "medido", "nao_medido", "serie_curta",
    ]);
    expect(cheia[3].medivel_em).toBe("2026-08-28");
  });

  it("faixa invertida ou degenerada não lança e não inventa ponto", () => {
    expect(preencherFaixa([], 5, 4)).toEqual([]);
    expect(preencherFaixa(null as never, 1, 3)).toHaveLength(3);
    expect(preencherFaixa([], 7, 7)).toHaveLength(1);
  });

  it("horizonte fora da faixa pedida é descartado, não empurra o tamanho", () => {
    const cheia = preencherFaixa(confiancaDoSaldo([linha(99, 1, 1, 99)]), 1, 3);
    expect(cheia).toHaveLength(3);
    expect(cheia.every((p) => p.estado === "nao_medido")).toBe(true);
  });
});
