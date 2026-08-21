/**
 * Testes do componente único de apresentação dos dois cenários de REBATE
 * (Fase 223, plano 223-02).
 *
 * Mesmo requisito de CONFERÊNCIA que a 222 cravou para o DIFAL: os dois
 * números ficam visíveis ao mesmo tempo, nunca por alternador, sempre com
 * valor E percentual. O que muda aqui é a régua — desconto de comissão
 * medido na fatura, não imposto estimado — e um TERCEIRO motivo de ausência
 * que a medição do 223-01 obrigou a existir: a conferência que não fecha.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RebateDoisCenarios, RebateDoisCenariosCabecalho } from "./RebateDoisCenarios";
import { resolveLinhaRebate, REBATE_CENARIO_LABEL } from "@/lib/rebateLinhaCenarios";

const CENARIOS_OK = resolveLinhaRebate({
  comRebate: { valor: 21.9, pct: 6.1 },
  semRebate: { valor: 43.07, pct: 12.0 },
  rebateEfeito: 18.5,
  rebateBruto: 21.17,
  pedidosSemCaptura: 0,
  pedidosNaoConferidos: 0,
});

describe("RebateDoisCenarios — densidade de bloco", () => {
  it("mostra os dois cenários ao mesmo tempo, sem clique e sem seletor", () => {
    render(<RebateDoisCenarios cenarios={CENARIOS_OK} densidade="bloco" />);

    expect(screen.getByText(/21,90/)).toBeInTheDocument();
    expect(screen.getByText(/6\.1%/)).toBeInTheDocument();
    expect(screen.getByText(/43,07/)).toBeInTheDocument();
    expect(screen.getByText(/12\.0%/)).toBeInTheDocument();
  });

  it("traz valor E percentual nos dois cenários (regra da casa)", () => {
    const { container } = render(<RebateDoisCenarios cenarios={CENARIOS_OK} densidade="bloco" />);
    const texto = container.textContent ?? "";

    expect(texto).toContain("21,90");
    expect(texto).toContain("43,07");
    expect(texto).toMatch(/6\.1%/);
    expect(texto).toMatch(/12\.0%/);
  });

  it("rotula o segundo cenário com a palavra que vem da constante única", () => {
    const { container } = render(<RebateDoisCenarios cenarios={CENARIOS_OK} densidade="bloco" />);

    expect(container.textContent).toContain(REBATE_CENARIO_LABEL);
  });

  it("marca a régua no DOM, e o papel de cor — número que muda de régua não muda em silêncio", () => {
    const { container } = render(
      <RebateDoisCenarios cenarios={CENARIOS_OK} densidade="bloco" role="good" />,
    );
    const raiz = container.querySelector("[data-rebate-regua]");

    expect(raiz).not.toBeNull();
    expect(raiz?.getAttribute("data-rebate-regua")).toBe("ok");
    expect(raiz?.getAttribute("data-mco-role")).toBe("good");
  });
});

describe("RebateDoisCenarios — o semáforo não é recalculado aqui", () => {
  it("aplica o papel de cor ao PRIMEIRO cenário (o real, com rebate); o segundo sai neutro", () => {
    const { container } = render(
      <RebateDoisCenarios cenarios={CENARIOS_OK} densidade="celula" role="critical" />,
    );

    const colorido = container.querySelector(".text-destructive");
    expect(colorido).not.toBeNull();
    expect(colorido?.textContent).toContain("21,90");
    // O segundo cenário não pode carregar a classe de cor do semáforo.
    const segundo = screen.getByText(/43,07/).closest("span");
    expect(segundo?.className ?? "").not.toContain("text-destructive");
  });

  it("sem papel de cor informado, não inventa nenhum", () => {
    const { container } = render(<RebateDoisCenarios cenarios={CENARIOS_OK} densidade="celula" />);

    expect(container.querySelector("[data-mco-role]")?.getAttribute("data-mco-role")).toBe(
      "neutral",
    );
  });
});

describe("RebateDoisCenarios — ausência aparece em palavras, nunca como zero", () => {
  const casos = [
    {
      motivo: "sem_campanha_no_periodo",
      entrada: {
        comRebate: { valor: 62.76, pct: 12.0 },
        semRebate: { valor: 62.76, pct: 12.0 },
        rebateEfeito: 0,
        rebateBruto: 0,
        pedidosSemCaptura: 0,
        pedidosNaoConferidos: 0,
      },
      frase: /nenhum pedido/i,
    },
    {
      motivo: "nao_capturado",
      entrada: {
        comRebate: { valor: 62.76, pct: 12.0 },
        semRebate: null,
        rebateEfeito: null,
        rebateBruto: null,
        pedidosSemCaptura: 15,
        pedidosNaoConferidos: 0,
      },
      frase: /ainda não vieram na fatura/i,
    },
    {
      motivo: "conferencia_nao_fecha",
      entrada: {
        comRebate: { valor: 62.76, pct: 12.0 },
        semRebate: null,
        rebateEfeito: null,
        rebateBruto: null,
        pedidosSemCaptura: 0,
        pedidosNaoConferidos: 4,
      },
      frase: /conciliada/i,
    },
    {
      motivo: "indisponivel",
      entrada: {
        comRebate: { valor: 62.76, pct: 12.0 },
        semRebate: null,
        rebateEfeito: null,
        rebateBruto: null,
        pedidosSemCaptura: 0,
        pedidosNaoConferidos: 0,
      },
      frase: /não carregou/i,
    },
  ] as const;

  it.each(casos)("motivo $motivo: diz o porquê em palavras", ({ entrada, frase }) => {
    const { container } = render(
      <RebateDoisCenarios cenarios={resolveLinhaRebate(entrada)} densidade="bloco" />,
    );

    expect(container.textContent).toMatch(frase);
  });

  it.each(casos)("motivo $motivo: NÃO exibe R$ 0,00 no lugar do segundo número", ({ entrada }) => {
    const { container } = render(
      <RebateDoisCenarios cenarios={resolveLinhaRebate(entrada)} densidade="bloco" />,
    );
    const texto = container.textContent ?? "";
    const zeros = texto.match(/R\$\s*0,00/g) ?? [];

    // Exceção esperada: "sem_campanha_no_periodo" É medição zero por natureza
    // (o valor apurado do rebate É zero) — mas o número exibido no lugar do
    // segundo cenário nunca é "R$ 0,00", é a frase. Confere só nos motivos de
    // lacuna/indisponibilidade, onde zero nunca pode aparecer.
    if (entrada.pedidosSemCaptura > 0 || entrada.pedidosNaoConferidos > 0 || entrada.rebateEfeito === null) {
      expect(zeros).toHaveLength(0);
    }
  });

  it.each(casos)("motivo $motivo: marca a régua no DOM com o motivo", ({ motivo, entrada }) => {
    const { container } = render(
      <RebateDoisCenarios cenarios={resolveLinhaRebate(entrada)} densidade="celula" />,
    );

    expect(
      container.querySelector("[data-rebate-regua]")?.getAttribute("data-rebate-regua"),
    ).toBe(motivo);
  });

  it("motivo 'conferencia_nao_fecha': a frase nomeia o problema como nosso e traz a contagem", () => {
    const { container } = render(
      <RebateDoisCenarios
        cenarios={resolveLinhaRebate({
          comRebate: { valor: 62.76, pct: 12.0 },
          semRebate: null,
          rebateEfeito: null,
          rebateBruto: null,
          pedidosSemCaptura: 0,
          pedidosNaoConferidos: 6,
        })}
        densidade="bloco"
      />,
    );

    expect(container.textContent).toMatch(/conciliada/i);
    expect(container.textContent).toContain("6");
  });
});

describe("RebateDoisCenarios — lacuna parcial aparece MESMO com segundo cenário presente", () => {
  it("quando parte dos pedidos não foi capturada, os dois números E a frase da lacuna aparecem juntos", () => {
    const cenarios = resolveLinhaRebate({
      comRebate: { valor: 62.76, pct: 12.0 },
      semRebate: { valor: 62.76, pct: 12.0 },
      rebateEfeito: 0,
      rebateBruto: 0,
      pedidosSemCaptura: 3,
      pedidosNaoConferidos: 0,
    });
    expect(cenarios.motivo).toBe("ok");

    const { container } = render(<RebateDoisCenarios cenarios={cenarios} densidade="bloco" />);
    const texto = container.textContent ?? "";

    expect(texto).toContain("62,76");
    expect(texto).toMatch(/fatura/i);
    expect(texto).toContain("3");
  });

  it("quando parte não foi conferida, a causa vem nomeada junto com os dois números", () => {
    const cenarios = resolveLinhaRebate({
      comRebate: { valor: 62.76, pct: 12.0 },
      semRebate: { valor: 62.76, pct: 12.0 },
      rebateEfeito: 0,
      rebateBruto: 0,
      pedidosSemCaptura: 0,
      pedidosNaoConferidos: 2,
    });
    expect(cenarios.motivo).toBe("ok");

    const { container } = render(<RebateDoisCenarios cenarios={cenarios} densidade="bloco" />);
    const texto = container.textContent ?? "";

    expect(texto).toContain("62,76");
    expect(texto).toMatch(/conciliada/i);
    expect(texto).toContain("2");
  });
});

describe("RebateDoisCenarios — omitirCenarioReal (Quick 260821-nof, D-selo-03)", () => {
  it("com omitirCenarioReal, NÃO renderiza o valor com rebate, mas continua renderizando a tarifa cheia", () => {
    const { container } = render(
      <RebateDoisCenarios cenarios={CENARIOS_OK} densidade="bloco" omitirCenarioReal />,
    );

    expect(container.textContent).not.toContain("21,90");
    expect(container.textContent).toContain("43,07");
  });

  it("com omitirCenarioReal e tarifa cheia ausente, continua mostrando a frase do motivo", () => {
    const cenarios = resolveLinhaRebate({
      comRebate: { valor: 62.76, pct: 12.0 },
      semRebate: null,
      rebateEfeito: null,
      rebateBruto: null,
      pedidosSemCaptura: 0,
      pedidosNaoConferidos: 6,
    });
    const { container } = render(
      <RebateDoisCenarios cenarios={cenarios} densidade="bloco" omitirCenarioReal />,
    );

    expect(container.textContent).not.toContain("62,76");
    expect(container.textContent).toMatch(/conciliada/i);
  });

  it("sem a propriedade (padrão false), rende exatamente o que rendia antes — regressão", () => {
    const { container } = render(<RebateDoisCenarios cenarios={CENARIOS_OK} densidade="bloco" />);

    expect(container.textContent).toContain("21,90");
    expect(container.textContent).toContain("43,07");
  });
});

describe("RebateDoisCenarios — frases longas cabem no bloco (Quick 260821-nof)", () => {
  it("a frase de lacuna (o defeito relatado) tem limite de largura e quebra de palavra", () => {
    const cenarios = resolveLinhaRebate({
      comRebate: { valor: 62.76, pct: 12.0 },
      semRebate: { valor: 62.76, pct: 12.0 },
      rebateEfeito: 0,
      rebateBruto: 0,
      pedidosSemCaptura: 3,
      pedidosNaoConferidos: 0,
    });
    const { container } = render(<RebateDoisCenarios cenarios={cenarios} densidade="bloco" />);
    const alvo = Array.from(container.querySelectorAll("span")).find(
      (s) => s.children.length === 0 && (s.textContent ?? "").match(/fora desta conta/i),
    );

    expect(alvo?.className).toMatch(/max-w-/);
    expect(alvo?.className).toContain("break-words");
  });

  it("a frase de ausência também tem limite de largura e quebra de palavra", () => {
    const cenarios = resolveLinhaRebate({
      comRebate: { valor: 62.76, pct: 12.0 },
      semRebate: null,
      rebateEfeito: null,
      rebateBruto: null,
      pedidosSemCaptura: 0,
      pedidosNaoConferidos: 6,
    });
    const { container } = render(<RebateDoisCenarios cenarios={cenarios} densidade="bloco" />);
    const alvo = Array.from(container.querySelectorAll("span")).find(
      (s) => s.children.length === 0 && (s.textContent ?? "").match(/conciliada/i),
    );

    expect(alvo?.className).toMatch(/max-w-/);
    expect(alvo?.className).toContain("break-words");
  });
});

describe("RebateDoisCenarios — densidade de célula", () => {
  it("mostra valor e percentual nos DOIS cenários também na tabela densa", () => {
    const { container } = render(<RebateDoisCenarios cenarios={CENARIOS_OK} densidade="celula" />);
    const texto = container.textContent ?? "";

    expect(texto).toContain("21,90");
    expect(texto).toContain("43,07");
    expect(texto).toMatch(/6\.1%/);
    expect(texto).toMatch(/12\.0%/);
  });

  it("não repete o rótulo do cenário em cada linha quando ele já está no cabeçalho", () => {
    const { container } = render(
      <RebateDoisCenarios cenarios={CENARIOS_OK} densidade="celula" ressalvaNoCabecalho />,
    );

    expect(container.textContent).not.toContain(REBATE_CENARIO_LABEL);
    expect(container.textContent).toContain("43,07");
  });
});

describe("RebateDoisCenariosCabecalho", () => {
  it("renderiza o título e a ressalva uma vez só", () => {
    const { container } = render(<RebateDoisCenariosCabecalho titulo="Margem" />);

    expect(container.textContent).toContain("Margem");
    expect(container.textContent).toContain(REBATE_CENARIO_LABEL);
  });

  it("a ressalva vem da mesma constante que o componente principal usa", () => {
    const { container } = render(<RebateDoisCenariosCabecalho />);

    expect(container.textContent).toContain(REBATE_CENARIO_LABEL);
  });
});
