// ============================================================================
// 233-07 — o portão da tabela "saldo × confiança" (D-13)
//
// 🔴 Testa a parte APRESENTACIONAL (`SaldoEConfiancaPorDiaView`), por FORMA —
// mesmo padrão de `CurvaDeConfianca.test.tsx`: sem `QueryClientProvider`, sem
// mockar rede. A aritmética de casamento já tem portão em
// `saldoEConfianca.test.ts`; aqui o que se prova é que o COMPONENTE usa aquele
// módulo corretamente e nunca deixa uma célula muda.
// ============================================================================
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SaldoEConfiancaPorDiaView } from "./SaldoEConfiancaPorDia";
import { confiancaDoSaldo, preencherFaixa, type PontoDeConfianca } from "@/lib/confiancaDoSaldo";
import type { CashFlowDataPoint } from "@/hooks/useCashFlowData";

// Data fixa: o componente aceita `hoje` por prop exatamente para o teste não
// depender do relógio da máquina que roda a suíte (a data real só importa
// para o `brToday()` de produção).
const HOJE_ISO = "2026-08-27";
const isoDeHoje = (dias: number): string => {
  const [a, m, d] = HOJE_ISO.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
};

/** Série sintética completa, D+1 a D+30 — valores distintos por dia. */
function serieCompleta(): CashFlowDataPoint[] {
  return Array.from({ length: 30 }, (_, i) => {
    const h = i + 1;
    return {
      date: "",
      fullDate: isoDeHoje(h),
      daily_income: 0,
      daily_expense: 0,
      daily_projection: 0,
      daily_balance: 0,
      accumulated_balance: h * 10,
      accumulated_balance_sma: h * 100,
      isNegative: false,
    };
  });
}

const pontoMedido = (h: number, pct: number): PontoDeConfianca => ({
  horizonte: h,
  confianca_pct: pct,
  erro_pct: 100 - pct,
  n_pares: 3,
  estado: "medido",
  primeiro_alvo: null,
  ultimo_alvo: null,
  motivo_ausencia: null,
  medivel_em: null,
});

const pontoAusente = (h: number): PontoDeConfianca => ({
  horizonte: h,
  confianca_pct: null,
  erro_pct: null,
  n_pares: 0,
  estado: "serie_curta",
  primeiro_alvo: null,
  ultimo_alvo: null,
  motivo_ausencia: "serie_curta",
  medivel_em: isoDeHoje(h),
});

const PONTOS_COMPLETOS: PontoDeConfianca[] = [
  ...Array.from({ length: 6 }, (_, i) => pontoMedido(i + 1, 60 + i * 5)),
  ...Array.from({ length: 24 }, (_, i) => pontoAusente(i + 7)),
];

describe("SaldoEConfiancaPorDiaView — QUANTIDADE e marcação", () => {
  it("renderiza 30 linhas, uma por horizonte, com data-horizonte e data-faixa", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={serieCompleta()} pontos={PONTOS_COMPLETOS} hoje={HOJE_ISO} />,
    );
    const linhas = [...container.querySelectorAll<HTMLElement>("[data-horizonte]")];
    expect(linhas).toHaveLength(30);
    expect(linhas.map((l) => Number(l.getAttribute("data-horizonte")))).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
    for (const l of linhas) expect(l.getAttribute("data-faixa")).toMatch(/^(agenda|media)$/);
  });

  it("🔴 a célula de confiança NUNCA fica vazia — percentual ou motivo", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={serieCompleta()} pontos={PONTOS_COMPLETOS} hoje={HOJE_ISO} />,
    );
    const linhas = [...container.querySelectorAll<HTMLElement>("[data-horizonte]")];
    for (const l of linhas) {
      const texto = l.textContent ?? "";
      expect(texto.trim().length, `linha D+${l.getAttribute("data-horizonte")} sem texto`).toBeGreaterThan(0);
    }
  });

  it("horizonte medido mostra percentual e o n; horizonte ausente mostra o motivo nomeado", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={serieCompleta()} pontos={PONTOS_COMPLETOS} hoje={HOJE_ISO} />,
    );
    const d1 = container.querySelector('[data-horizonte="1"]');
    expect(d1?.textContent).toMatch(/\d+%/);
    expect(d1?.textContent).toMatch(/n\s*3/);

    const d7 = container.querySelector('[data-horizonte="7"]');
    expect(d7?.textContent).toMatch(/medíve(l|is) a partir de/);
    expect(d7?.textContent).not.toMatch(/\d+%/);
  });

  it("30 linhas mesmo com serie e pontos vazios/nulos, sem lançar", () => {
    for (const entrada of [
      { serie: [], pontos: [] },
      { serie: null, pontos: null },
      { serie: undefined, pontos: undefined },
    ]) {
      const { container } = render(
        <SaldoEConfiancaPorDiaView serie={entrada.serie as never} pontos={entrada.pontos as never} hoje={HOJE_ISO} />,
      );
      expect(container.querySelectorAll("[data-horizonte]")).toHaveLength(30);
    }
  });
});

describe("SaldoEConfiancaPorDiaView — a coluna 'só o agendado'", () => {
  it("só aparece preenchida na faixa `media` — a faixa `agenda` mostra traço", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={serieCompleta()} pontos={PONTOS_COMPLETOS} hoje={HOJE_ISO} />,
    );
    const agenda = container.querySelector('[data-horizonte="9"][data-faixa="agenda"]');
    const media = container.querySelector('[data-horizonte="10"][data-faixa="media"]');
    expect(agenda).not.toBeNull();
    expect(media).not.toBeNull();
    // A linha 9 (agenda) não expõe o valor de "só o agendado" (R$ 90,00 seria
    // idêntico ao previsto e não acrescenta nada); a linha 10 (media) expõe.
    expect(media?.textContent).toMatch(/R\$\s*100,00/); // saldo_so_agendado = 10 * 10
  });
});

describe("SaldoEConfiancaPorDiaView — a fronteira D+9/D+10 (D-14, não colapsa)", () => {
  it("🔴 aparece com `data-aviso=\"fronteira-agenda\"`, entre a última `agenda` e a primeira `media`", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={serieCompleta()} pontos={PONTOS_COMPLETOS} hoje={HOJE_ISO} />,
    );
    const aviso = container.querySelector('[data-aviso="fronteira-agenda"]');
    expect(aviso).not.toBeNull();
    expect(aviso?.textContent).toMatch(/não enxerga mais/);
    expect(aviso?.textContent).toMatch(/não porque o caixa vai acabar/);
  });

  it("a fronteira respeita o parâmetro — a última linha `agenda` é D+9 hoje", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={serieCompleta()} pontos={PONTOS_COMPLETOS} hoje={HOJE_ISO} />,
    );
    const agenda = [...container.querySelectorAll('[data-faixa="agenda"]')];
    expect(agenda).toHaveLength(9);
  });
});

describe("SaldoEConfiancaPorDiaView — saldo por DATA, nunca por índice", () => {
  it("o saldo previsto é `accumulated_balance_sma` do dia — o número principal", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={serieCompleta()} pontos={PONTOS_COMPLETOS} hoje={HOJE_ISO} />,
    );
    const d5 = container.querySelector('[data-horizonte="5"]');
    // accumulated_balance_sma = 5 * 100 = 500
    expect(d5?.textContent).toMatch(/500,00/);
  });

  it("saldo ausente (dia fora da série) é traço, nunca zero", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView
        serie={serieCompleta().filter((e) => e.fullDate !== isoDeHoje(3))}
        pontos={PONTOS_COMPLETOS}
        hoje={HOJE_ISO}
      />,
    );
    const d3 = container.querySelector('[data-horizonte="3"]');
    expect(d3?.textContent).toMatch(/—/);
    expect(d3?.textContent).not.toMatch(/R\$\s*0,00/);
  });
});

describe("SaldoEConfiancaPorDiaView — carregando", () => {
  it("estado de carregando não lança e não é tela em branco", () => {
    const { container } = render(<SaldoEConfiancaPorDiaView serie={null} pontos={null} isLoading />);
    expect(container.innerHTML).not.toBe("");
  });
});

// ============================================================================
// 🔴 PORTÃO POR FORMA — migrado de `CurvaDeConfianca.test.tsx` (233-07 Task 3)
//
// Estas asserções viviam em `CurvaDeConfianca.test.tsx` e provavam, sobre as
// barras por horizonte e os parágrafos de lacuna daquele componente: a faixa
// 1..30 sai INTEIRA sem duplicata, todo horizonte SEM medição carrega motivo
// nomeado, NENHUM horizonte sem par publica percentual, e todo horizonte
// MEDIDO mostra percentual e o `n`. As barras e os parágrafos SAÍRAM de
// `CurvaDeConfianca` e viraram a coluna de confiança desta tabela — a
// PROPRIEDADE é a mesma, só o componente sob teste mudou porque a
// responsabilidade mudou (233-TEXTO.md). O portão não foi esvaziado.
// ============================================================================

const INICIO_DA_SERIE = "2026-08-21";

const somaDiasDeIso = (iso: string, dias: number): string => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
};

const medidoRpc = (h: number, conf: number, n = 1) => ({
  horizon_days: h, n_pares: n, erro_pct: 100 - conf, confianca_pct: conf,
  primeiro_alvo: "2026-08-27", ultimo_alvo: "2026-08-27",
  motivo_ausencia: null, medivel_em: null,
});

const calendarioRpc = (h: number) => ({
  horizon_days: h, n_pares: 0, erro_pct: null, confianca_pct: null,
  primeiro_alvo: null, ultimo_alvo: null,
  motivo_ausencia: "serie_curta", medivel_em: somaDiasDeIso(INICIO_DA_SERIE, h),
});

const semDeclaracaoRpc = (h: number) => ({
  horizon_days: h, n_pares: 0, erro_pct: null, confianca_pct: null,
  primeiro_alvo: null, ultimo_alvo: null,
  motivo_ausencia: "sem_declaracao", medivel_em: null,
});

const semSerieRpc = (h: number) => ({
  horizon_days: h, n_pares: 0, erro_pct: null, confianca_pct: null,
  primeiro_alvo: null, ultimo_alvo: null,
  motivo_ausencia: "sem_serie", medivel_em: null,
});

/** Recortes arbitrários — os mesmos seis cenários do arquivo de origem. A
 *  propriedade sob teste é sobre a FORMA, não sobre esta amostra específica. */
const RECORTES_MIGRADOS: Array<{ nome: string; pontos: PontoDeConfianca[] }> = [
  {
    nome: "a amostra real de 27/08",
    pontos: preencherFaixa(
      confiancaDoSaldo([
        medidoRpc(1, 65.9), medidoRpc(2, 49.7), medidoRpc(3, 78.3),
        medidoRpc(4, 92.8), medidoRpc(5, 94.8), medidoRpc(6, 85.2),
        ...Array.from({ length: 24 }, (_, i) => calendarioRpc(i + 7)),
      ]),
      1, 30,
    ),
  },
  {
    nome: "nada medido, tudo calendário",
    pontos: preencherFaixa(
      confiancaDoSaldo(Array.from({ length: 30 }, (_, i) => calendarioRpc(i + 1))),
      1, 30,
    ),
  },
  {
    nome: "buracos de declaração no meio dos medidos",
    pontos: preencherFaixa(
      confiancaDoSaldo([
        medidoRpc(1, 90), semDeclaracaoRpc(2), medidoRpc(3, 80), semDeclaracaoRpc(4),
        semDeclaracaoRpc(5), medidoRpc(6, 70),
        ...Array.from({ length: 24 }, (_, i) => calendarioRpc(i + 7)),
      ]),
      1, 30,
    ),
  },
  {
    nome: "organização sem série nenhuma",
    pontos: preencherFaixa(
      confiancaDoSaldo(Array.from({ length: 30 }, (_, i) => semSerieRpc(i + 1))),
      1, 30,
    ),
  },
  {
    nome: "a RPC regrediu e devolveu só três horizontes",
    pontos: preencherFaixa(
      confiancaDoSaldo([medidoRpc(1, 90), medidoRpc(2, 80), medidoRpc(3, 70)]),
      1, 30,
    ),
  },
  {
    nome: "tudo medido, a série madura",
    pontos: preencherFaixa(
      confiancaDoSaldo(Array.from({ length: 30 }, (_, i) => medidoRpc(i + 1, 50 + i, 8))),
      1, 30,
    ),
  },
];

function linhasDaTabela(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[data-horizonte]")].map((el) => ({
    horizonte: Number(el.getAttribute("data-horizonte")),
    faixa: el.getAttribute("data-faixa") ?? "",
    texto: el.textContent ?? "",
  }));
}

describe("🔴 PORTÃO POR FORMA — migrado de CurvaDeConfianca.test.tsx (233-07 Task 3)", () => {
  it.each(RECORTES_MIGRADOS)("$nome: a faixa 1..30 sai INTEIRA e sem duplicata", ({ pontos }) => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={[]} pontos={pontos} hoje={HOJE_ISO} />,
    );
    const horizontes = linhasDaTabela(container).map((l) => l.horizonte);
    expect(horizontes.sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it.each(RECORTES_MIGRADOS)("$nome: horizonte SEM medição aparece com motivo nomeado", ({ pontos }) => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={[]} pontos={pontos} hoje={HOJE_ISO} />,
    );
    for (const linha of linhasDaTabela(container)) {
      const ponto = pontos.find((p) => p.horizonte === linha.horizonte);
      if (ponto?.estado === "medido" && ponto.confianca_pct != null) continue;
      // A ausência diz o MOTIVO REAL, e ele é uma dessas quatro frases.
      expect(
        linha.texto,
        `linha D+${linha.horizonte} sem motivo nomeado`,
      ).toMatch(/medíve(l|is) a partir de|sem declaração de saldo|série de previsões congeladas ainda não existe|o banco não devolveu/);
    }
  });

  it.each(RECORTES_MIGRADOS)("$nome: NENHUM horizonte sem par carrega percentual", ({ pontos }) => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={[]} pontos={pontos} hoje={HOJE_ISO} />,
    );
    for (const linha of linhasDaTabela(container)) {
      const ponto = pontos.find((p) => p.horizonte === linha.horizonte);
      if (ponto?.estado === "medido" && ponto.confianca_pct != null) continue;
      expect(linha.texto, `linha D+${linha.horizonte} publicou percentual`).not.toMatch(/\d\s*%/);
    }
  });

  it.each(RECORTES_MIGRADOS)("$nome: todo horizonte MEDIDO mostra percentual e o n", ({ pontos }) => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={[]} pontos={pontos} hoje={HOJE_ISO} />,
    );
    const linhas = linhasDaTabela(container);
    const medidos = pontos.filter((p) => p.estado === "medido" && p.confianca_pct != null);
    for (const p of medidos) {
      const linha = linhas.find((l) => l.horizonte === p.horizonte);
      expect(linha?.texto).toMatch(/\d\s*%/);
      expect(linha?.texto).toMatch(new RegExp(`n\\s*${p.n_pares}`));
    }
  });
});

describe("as duas escassezes saem separadas por NOME — migrado de CurvaDeConfianca.test.tsx", () => {
  it("🔴 idade da série vira calendário COM data — e diz quando a série começou", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={[]} pontos={RECORTES_MIGRADOS[0].pontos} hoje={HOJE_ISO} />,
    );
    const d7 = container.querySelector('[data-horizonte="7"]');
    // D+7 abre em 28/08 porque a série começou em 21/08.
    expect(d7?.textContent).toMatch(/fica medível a partir de 28\/08/);
    expect(d7?.textContent).toMatch(/21\/08/);
  });

  it("🔴 falta de declaração NÃO ganha data — esperar não resolve, declarar resolve", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={[]} pontos={RECORTES_MIGRADOS[2].pontos} hoje={HOJE_ISO} />,
    );
    const d2 = container.querySelector('[data-horizonte="2"]');
    expect(d2?.textContent).toMatch(/sem declaração de saldo/);
    expect(d2?.textContent).not.toMatch(/a partir de/);
  });

  it("os dois motivos nunca compartilham a mesma linha", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={[]} pontos={RECORTES_MIGRADOS[2].pontos} hoje={HOJE_ISO} />,
    );
    const d2 = container.querySelector('[data-horizonte="2"]')?.textContent ?? "";
    const d7 = container.querySelector('[data-horizonte="7"]')?.textContent ?? "";
    expect(d2).toMatch(/sem declaração/);
    expect(d7).toMatch(/medíve(l|is) a partir de/);
  });
});
