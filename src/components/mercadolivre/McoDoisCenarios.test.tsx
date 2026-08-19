/**
 * Testes do componente único de apresentação dos dois cenários de MCO
 * (Fase 222, plano 222-15-R2).
 *
 * O requisito do Wesley (19/08) é de CONFERÊNCIA, não de leitura: ele vai
 * percorrer tela por tela validando que onde há margem aparecem os dois
 * números. Por isso não existe alternador — os dois ficam visíveis ao mesmo
 * tempo, nas duas densidades, sempre com valor E percentual, e o segundo
 * sempre acompanhado da palavra "estimativa" vinda da constante única.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { McoDoisCenarios, McoDoisCenariosCabecalho } from "./McoDoisCenarios";
import { resolveLinhaCenarios } from "@/lib/mcoLinhaCenarios";
import { DIFAL_ESTIMATIVA_LABEL } from "@/lib/mcoCenarios";

const CENARIOS_OK = resolveLinhaCenarios({
  semDifal: { valor: 84.2, pct: 12.15 },
  comDifal: { valor: 33.49, pct: 4.83 },
  difalEfeito: 50.71,
  pedidosDifalIndefinido: 0,
  temOperacaoInterestadual: true,
  regimeAplicaDifal: true,
});

describe("McoDoisCenarios — densidade de bloco", () => {
  it("mostra os dois cenários ao mesmo tempo, sem clique e sem seletor", () => {
    render(<McoDoisCenarios cenarios={CENARIOS_OK} densidade="bloco" />);

    expect(screen.getByText(/84,20/)).toBeInTheDocument();
    expect(screen.getByText(/12\.2%/)).toBeInTheDocument();
    expect(screen.getByText(/33,49/)).toBeInTheDocument();
    expect(screen.getByText(/4\.8%/)).toBeInTheDocument();
  });

  it("traz valor E percentual nos dois cenários (regra da casa)", () => {
    const { container } = render(<McoDoisCenarios cenarios={CENARIOS_OK} densidade="bloco" />);
    const texto = container.textContent ?? "";

    expect(texto).toContain("84,20");
    expect(texto).toContain("33,49");
    expect(texto).toMatch(/12\.2%/);
    expect(texto).toMatch(/4\.8%/);
  });

  it("rotula o segundo cenário com a palavra que vem da constante única", () => {
    const { container } = render(<McoDoisCenarios cenarios={CENARIOS_OK} densidade="bloco" />);

    expect(container.textContent).toContain(DIFAL_ESTIMATIVA_LABEL);
  });

  it("marca a régua no DOM, para a conferência não depender de abrir o código", () => {
    const { container } = render(<McoDoisCenarios cenarios={CENARIOS_OK} densidade="bloco" />);
    const raiz = container.querySelector("[data-difal-regua]");

    expect(raiz).not.toBeNull();
    expect(raiz?.getAttribute("data-difal-regua")).toBe("ok");
  });
});

describe("McoDoisCenarios — densidade de célula", () => {
  it("mostra valor e percentual nos DOIS cenários também na tabela densa", () => {
    const { container } = render(<McoDoisCenarios cenarios={CENARIOS_OK} densidade="celula" />);
    const texto = container.textContent ?? "";

    expect(texto).toContain("84,20");
    expect(texto).toContain("33,49");
    expect(texto).toMatch(/12\.2%/);
    expect(texto).toMatch(/4\.8%/);
  });

  it("não repete a ressalva de estimativa em cada linha quando ela já está no cabeçalho", () => {
    const { container } = render(
      <McoDoisCenarios cenarios={CENARIOS_OK} densidade="celula" ressalvaNoCabecalho />,
    );

    // A palavra tem de informar, não virar ruído em centenas de linhas.
    expect(container.textContent).not.toContain(DIFAL_ESTIMATIVA_LABEL);
    expect(container.textContent).toContain("33,49");
  });

  it("o cabeçalho da coluna carrega a ressalva UMA vez, da mesma constante", () => {
    const { container } = render(<McoDoisCenariosCabecalho />);

    expect(container.textContent).toContain(DIFAL_ESTIMATIVA_LABEL);
  });
});

describe("McoDoisCenarios — ausência aparece em palavras, nunca como zero", () => {
  const casos = [
    {
      motivo: "sem_operacao_interestadual",
      entrada: {
        semDifal: { valor: 84.2, pct: 12.15 },
        comDifal: { valor: 84.2, pct: 12.15 },
        difalEfeito: 0,
        pedidosDifalIndefinido: 0,
        temOperacaoInterestadual: false,
        regimeAplicaDifal: true,
      },
      frase: /dentro do estado|não se aplica/i,
    },
    {
      motivo: "regime_nao_aplicavel",
      entrada: {
        semDifal: { valor: 84.2, pct: 12.15 },
        comDifal: null,
        difalEfeito: null,
        pedidosDifalIndefinido: 0,
        temOperacaoInterestadual: true,
        regimeAplicaDifal: false,
      },
      frase: /regime/i,
    },
    {
      motivo: "uf_nao_confirmada",
      entrada: {
        semDifal: { valor: 84.2, pct: 12.15 },
        comDifal: null,
        difalEfeito: null,
        pedidosDifalIndefinido: 7,
        temOperacaoInterestadual: true,
        regimeAplicaDifal: true,
      },
      frase: /alíquota|confirmad/i,
    },
    {
      motivo: "indisponivel",
      entrada: {
        semDifal: { valor: 84.2, pct: 12.15 },
        comDifal: null,
        difalEfeito: null,
        pedidosDifalIndefinido: 0,
        temOperacaoInterestadual: true,
        regimeAplicaDifal: true,
      },
      frase: /não carregou|indisponível/i,
    },
  ] as const;

  it.each(casos)("motivo $motivo: diz o porquê em palavras", ({ entrada, frase }) => {
    const { container } = render(
      <McoDoisCenarios cenarios={resolveLinhaCenarios(entrada)} densidade="bloco" />,
    );

    expect(container.textContent).toMatch(frase);
  });

  it.each(casos)("motivo $motivo: NÃO exibe R$ 0,00 no lugar do segundo número", ({ entrada }) => {
    const { container } = render(
      <McoDoisCenarios cenarios={resolveLinhaCenarios(entrada)} densidade="bloco" />,
    );
    const texto = container.textContent ?? "";
    const zeros = texto.match(/R\$\s*0,00/g) ?? [];

    expect(zeros).toHaveLength(0);
  });

  it.each(casos)("motivo $motivo: marca a régua no DOM com o motivo", ({ motivo, entrada }) => {
    const { container } = render(
      <McoDoisCenarios cenarios={resolveLinhaCenarios(entrada)} densidade="celula" />,
    );

    expect(container.querySelector("[data-difal-regua]")?.getAttribute("data-difal-regua")).toBe(
      motivo,
    );
  });

  it("com UF não confirmada, a contagem de pedidos fora da conta aparece", () => {
    const { container } = render(
      <McoDoisCenarios
        cenarios={resolveLinhaCenarios({
          semDifal: { valor: 84.2, pct: 12.15 },
          comDifal: null,
          difalEfeito: null,
          pedidosDifalIndefinido: 7,
          temOperacaoInterestadual: true,
          regimeAplicaDifal: true,
        })}
        densidade="bloco"
      />,
    );

    expect(container.textContent).toContain("7");
  });

  it("dois números iguais nunca ficam mudos: o efeito nulo é declarado", () => {
    const { container } = render(
      <McoDoisCenarios
        cenarios={resolveLinhaCenarios({
          semDifal: { valor: 84.2, pct: 12.15 },
          comDifal: { valor: 84.2, pct: 12.15 },
          difalEfeito: 0,
          pedidosDifalIndefinido: 0,
          temOperacaoInterestadual: true,
          regimeAplicaDifal: true,
        })}
        densidade="bloco"
      />,
    );

    expect(container.textContent).toMatch(/não muda|sem efeito/i);
  });
});

describe("McoDoisCenarios — o semáforo não é recalculado aqui", () => {
  it("aceita o papel de cor por propriedade e o aplica ao PRIMEIRO cenário", () => {
    const { container } = render(
      <McoDoisCenarios cenarios={CENARIOS_OK} densidade="celula" role="critical" />,
    );

    expect(container.querySelector("[data-mco-role]")?.getAttribute("data-mco-role")).toBe(
      "critical",
    );
  });

  it("sem papel de cor informado, não inventa nenhum", () => {
    const { container } = render(<McoDoisCenarios cenarios={CENARIOS_OK} densidade="celula" />);

    expect(container.querySelector("[data-mco-role]")?.getAttribute("data-mco-role")).toBe(
      "neutral",
    );
  });
});
