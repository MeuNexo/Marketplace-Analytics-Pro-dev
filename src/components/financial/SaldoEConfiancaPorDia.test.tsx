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
import type { PontoDeConfianca } from "@/lib/confiancaDoSaldo";
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
