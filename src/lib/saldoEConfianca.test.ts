// ============================================================================
// 233-07 — o portão de FONTE e QUANTIDADE da tabela "saldo × confiança"
//
// 🔴 TESTE QUE SÓ PROVA ARITMÉTICA NÃO PROTEGE NADA. O 233-03 passou com 59
// testes verdes sobre a variável errada. Este arquivo não confere números da
// M-10 — eles mudam entre planejar e executar (M-07: `entradas_hoje` caiu de
// 14.790,16 para 14.512,58 porque o MP remanejou release no meio do dia). Ele
// trava INVARIANTES:
//
//   FONTE      — o saldo da linha D+k vem da entrada cuja DATA é `hoje + k`,
//                nunca do índice do array (T-233-07-03).
//   FONTE      — confiança só é publicada onde `estado === "medido"`, inclusive
//                quando a RPC mente e manda percentual em linha de ausência
//                (T-233-07-02).
//   QUANTIDADE — sempre `horizonteMaximo` linhas, para qualquer entrada.
//   FRONTEIRA  — a faixa sai de PARÂMETRO; o módulo não conhece o número 9.
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  linhasDeSaldoEConfianca,
  type EntradaDeSaldoDiario,
} from "./saldoEConfianca";
import { textoDaAusencia, type PontoDeConfianca } from "./confiancaDoSaldo";

const HOJE = "2026-08-27";
const MAX = 30;

const somaDias = (iso: string, dias: number): string => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
};

/** Série sintética: saldo = horizonte * 100, só-agendado = horizonte * 10.
 *  Valores distintos por dia, para que um deslocamento por índice APAREÇA. */
const serieDe = (horizontes: number[]): EntradaDeSaldoDiario[] =>
  horizontes.map((h) => ({
    fullDate: somaDias(HOJE, h),
    accumulated_balance: h * 10,
    accumulated_balance_sma: h * 100,
  }));

const faixaCompleta = (): EntradaDeSaldoDiario[] =>
  serieDe(Array.from({ length: MAX }, (_, i) => i + 1));

const ponto = (p: Partial<PontoDeConfianca> & { horizonte: number }): PontoDeConfianca => ({
  confianca_pct: null,
  erro_pct: null,
  n_pares: 0,
  estado: "nao_medido",
  primeiro_alvo: null,
  ultimo_alvo: null,
  motivo_ausencia: null,
  medivel_em: null,
  ...p,
});

const chamar = (over: Partial<Parameters<typeof linhasDeSaldoEConfianca>[0]> = {}) =>
  linhasDeSaldoEConfianca({
    serie: faixaCompleta(),
    pontos: [],
    hoje: HOJE,
    ultimoDiaDeAgenda: 9,
    horizonteMaximo: MAX,
    ...over,
  });

describe("linhasDeSaldoEConfianca — QUANTIDADE", () => {
  it("devolve sempre `horizonteMaximo` linhas, de 1 a 30, na ordem", () => {
    const linhas = chamar();
    expect(linhas).toHaveLength(MAX);
    expect(linhas.map((l) => l.horizonte)).toEqual(
      Array.from({ length: MAX }, (_, i) => i + 1),
    );
  });

  it("devolve as 30 linhas mesmo com a série cobrindo só os 9 primeiros dias", () => {
    const linhas = chamar({ serie: serieDe([1, 2, 3, 4, 5, 6, 7, 8, 9]) });
    expect(linhas).toHaveLength(MAX);
    // Os dias sem entrada saem com saldo NULO — nunca zero, nunca interpolado.
    expect(linhas[9].saldo_previsto).toBeNull();
    expect(linhas[9].saldo_so_agendado).toBeNull();
  });

  it("série vazia, pontos vazios e null nas duas entradas: 30 linhas, tudo nulo, sem lançar", () => {
    for (const entrada of [
      { serie: [], pontos: [] },
      { serie: null, pontos: null },
      { serie: undefined, pontos: undefined },
    ]) {
      const linhas = chamar(entrada as never);
      expect(linhas).toHaveLength(MAX);
      expect(linhas.every((l) => l.saldo_previsto === null)).toBe(true);
      expect(linhas.every((l) => l.confianca_pct === null)).toBe(true);
      expect(linhas.every((l) => l.estado !== "medido")).toBe(true);
    }
  });

  it("horizonteMaximo diferente muda o tamanho da saída, e nada mais", () => {
    expect(chamar({ horizonteMaximo: 15 })).toHaveLength(15);
    expect(chamar({ horizonteMaximo: 1 })).toHaveLength(1);
  });
});

describe("linhasDeSaldoEConfianca — FONTE do saldo (casamento por DATA)", () => {
  it("embaralhar a série de entrada não muda nenhuma linha", () => {
    const ordenada = chamar({ serie: faixaCompleta() });
    const embaralhada = chamar({
      serie: [...faixaCompleta()].reverse(),
    });
    expect(embaralhada).toEqual(ordenada);

    const misturada = chamar({
      serie: [...faixaCompleta()].sort((a, b) => a.fullDate.localeCompare(b.fullDate) * -1 + 0.5),
    });
    expect(misturada).toEqual(ordenada);
  });

  it("remover o dia D+5 afeta SÓ a linha D+5 — casar por índice deslocaria o resto", () => {
    const completa = chamar();
    const comBuraco = chamar({
      serie: faixaCompleta().filter((e) => e.fullDate !== somaDias(HOJE, 5)),
    });

    expect(comBuraco[4].horizonte).toBe(5);
    expect(comBuraco[4].saldo_previsto).toBeNull();
    expect(comBuraco[4].saldo_so_agendado).toBeNull();

    // Todas as outras linhas continuam idênticas.
    for (let i = 0; i < MAX; i += 1) {
      if (i === 4) continue;
      expect(comBuraco[i]).toEqual(completa[i]);
    }
  });

  it("o saldo de cada linha é o da entrada cuja data é `hoje + k`", () => {
    const linhas = chamar();
    for (const l of linhas) {
      expect(l.data).toBe(somaDias(HOJE, l.horizonte));
      expect(l.saldo_previsto).toBe(l.horizonte * 100);
      expect(l.saldo_so_agendado).toBe(l.horizonte * 10);
    }
  });

  it("entrada com data fora da faixa não entra em linha nenhuma", () => {
    const linhas = chamar({
      serie: [
        ...faixaCompleta(),
        { fullDate: somaDias(HOJE, -3), accumulated_balance: 1, accumulated_balance_sma: 1 },
        { fullDate: somaDias(HOJE, 99), accumulated_balance: 2, accumulated_balance_sma: 2 },
      ],
    });
    expect(linhas).toHaveLength(MAX);
    expect(linhas.some((l) => l.saldo_previsto === 1 || l.saldo_previsto === 2)).toBe(false);
  });

  it("saldo ausente é null — nunca 0 e nunca interpolado entre vizinhos", () => {
    const linhas = chamar({ serie: serieDe([1, 3]) });
    expect(linhas[0].saldo_previsto).toBe(100);
    expect(linhas[1].saldo_previsto).toBeNull();
    expect(linhas[2].saldo_previsto).toBe(300);
  });
});

describe("linhasDeSaldoEConfianca — FONTE da confiança (T-233-07-02)", () => {
  it("publica o percentual apenas onde `estado === \"medido\"`", () => {
    const linhas = chamar({
      pontos: [
        ponto({ horizonte: 1, estado: "medido", confianca_pct: 66, n_pares: 1, erro_pct: 34 }),
        ponto({ horizonte: 2, estado: "serie_curta", motivo_ausencia: "serie_curta", medivel_em: "2026-08-28" }),
      ],
    });
    expect(linhas[0].confianca_pct).toBe(66);
    expect(linhas[1].confianca_pct).toBeNull();
  });

  it("🔴 ponto de AUSÊNCIA com percentual preenchido (contrato violado) sai SEM percentual", () => {
    for (const estado of ["serie_curta", "sem_declaracao", "sem_serie", "nao_medido", "amostra_insuficiente"] as const) {
      const linhas = chamar({
        pontos: [ponto({ horizonte: 1, estado, confianca_pct: 99, n_pares: 7 })],
      });
      expect(linhas[0].confianca_pct).toBeNull();
      expect(linhas[0].estado).toBe(estado);
    }
  });

  it("🔴 `medido` com `n_pares === 0` não existe: sai sem percentual e com ausência sem nome", () => {
    const linhas = chamar({
      pontos: [ponto({ horizonte: 1, estado: "medido", confianca_pct: 84, n_pares: 0 })],
    });
    expect(linhas[0].confianca_pct).toBeNull();
    expect(linhas[0].estado).toBe("nao_medido");
    expect(linhas[0].motivo_ausencia).toBeNull();
  });

  it("horizonte que a RPC não mandou volta como ausência declarada, nunca 0%", () => {
    const linhas = chamar({
      pontos: [ponto({ horizonte: 1, estado: "medido", confianca_pct: 66, n_pares: 1 })],
    });
    expect(linhas[1].estado).toBe("nao_medido");
    expect(linhas[1].confianca_pct).toBeNull();
    expect(linhas[1].n_pares).toBe(0);
  });

  it("motivo e data de ausência atravessam intactos — são do 233-04, não recalculados aqui", () => {
    const linhas = chamar({
      pontos: [
        ponto({ horizonte: 7, estado: "serie_curta", motivo_ausencia: "serie_curta", medivel_em: "2026-09-03" }),
      ],
    });
    expect(linhas[6].motivo_ausencia).toBe("serie_curta");
    expect(linhas[6].medivel_em).toBe("2026-09-03");
  });
});

describe("linhasDeSaldoEConfianca — FRONTEIRA por parâmetro", () => {
  it("`faixa` é `agenda` até `ultimoDiaDeAgenda` e `media` acima dele", () => {
    const linhas = chamar({ ultimoDiaDeAgenda: 9 });
    expect(linhas.filter((l) => l.faixa === "agenda").map((l) => l.horizonte)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(linhas[9].faixa).toBe("media");
    expect(linhas[MAX - 1].faixa).toBe("media");
  });

  it("🔴 chamar com `ultimoDiaDeAgenda = 5` move a fronteira para o 5", () => {
    const linhas = chamar({ ultimoDiaDeAgenda: 5 });
    expect(linhas.filter((l) => l.faixa === "agenda")).toHaveLength(5);
    expect(linhas[4].faixa).toBe("agenda");
    expect(linhas[5].faixa).toBe("media");
  });

  it("`ultimoDiaDeAgenda = 0` deixa a faixa inteira em `media`", () => {
    expect(chamar({ ultimoDiaDeAgenda: 0 }).every((l) => l.faixa === "media")).toBe(true);
  });

  it("🔴 nenhum literal de fronteira dentro do módulo puro", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fonte = readFileSync(join(__dirname, "saldoEConfianca.ts"), "utf8")
      // comentário não é código: a prosa PODE citar o 9 sem que isso seja literal
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(fonte).not.toMatch(/=\s*9\b/);
    expect(fonte).toContain("ultimoDiaDeAgenda");
  });
});

describe("linhasDeSaldoEConfianca — nunca lança", () => {
  it("entrada corrompida (linhas nulas, datas inválidas, campos ausentes) vira estado, não exceção", () => {
    expect(() =>
      chamar({
        serie: [null, undefined, { fullDate: "nao-e-data" }, { fullDate: somaDias(HOJE, 1) }] as never,
        pontos: [null, undefined, { horizonte: 3 }] as never,
        hoje: "",
      } as never),
    ).not.toThrow();
  });
});

describe("textoDaAusencia — extraído para reuso, com as frases INALTERADAS", () => {
  it("`serie_curta` diz a data e a origem da série", () => {
    expect(textoDaAusencia({ estado: "serie_curta", de: 7, ate: 7, medivel_em: "2026-08-28" })).toBe(
      "D+7 fica medível a partir de 28/08 — a série de previsões congeladas começou em 21/08.",
    );
  });

  it("faixa plural mantém a conjugação", () => {
    expect(textoDaAusencia({ estado: "serie_curta", de: 7, ate: 30, medivel_em: "2026-08-28" })).toBe(
      "D+7 a D+30 ficam medíveis a partir de 28/08 — a série de previsões congeladas começou em 21/08.",
    );
  });

  it("`sem_declaracao` diz o que destrava a medição", () => {
    expect(textoDaAusencia({ estado: "sem_declaracao", de: 3, ate: 3, medivel_em: null })).toBe(
      "D+3: sem declaração de saldo nesse dia. Corrigir o saldo do dia cria o ponto.",
    );
  });

  it("`sem_serie` e ausência sem nome continuam com texto próprio", () => {
    expect(textoDaAusencia({ estado: "sem_serie", de: 1, ate: 30, medivel_em: null })).toBe(
      "D+1 a D+30: a série de previsões congeladas ainda não existe nesta conta.",
    );
    expect(textoDaAusencia({ estado: "nao_medido", de: 12, ate: 12, medivel_em: null })).toBe(
      "D+12: o banco não devolveu este prazo — sem medição e sem motivo declarado.",
    );
  });
});
